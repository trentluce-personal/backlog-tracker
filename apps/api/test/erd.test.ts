import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { createApp } from '../src/server.ts';
import { ER_DATA_TYPES, erModelInput, type ErColumn, type ErModel } from '../src/erd-schema.ts';
import { exportErModel } from '../src/erd-export.ts';
import { openErStore } from '../src/erd-store.ts';

const empty: ErModel = { kind: 'sql', schemaVersion: 1, dialect: 'postgresql', tables: [], foreignKeys: [] };
const column = (id: string, primaryKey = false): ErColumn => ({ id, name: id, dataType: 'integer', nullable: !primaryKey, primaryKey, unique: false });
function schema(): ErModel {
  return { ...empty, tables: [
    { id: 'a', name: 'Account', x: 0, y: 20000, columns: [column('a-id', true), column('a-parent')] },
    { id: 'b', name: 'Entry', x: 120.5, y: 0, columns: [column('b-id', true), column('b-account')] },
  ], foreignKeys: [{ id: 'fk-1', name: 'entry_account', sourceTableId: 'b', sourceColumnId: 'b-account', targetTableId: 'a', targetColumnId: 'a-id' }] };
}
const status = (expected: number) => (error: unknown) => !!error && typeof error === 'object' && 'status' in error && error.status === expected;

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'backlog-erd-test-'));
  const modelPath = join(directory, 'models', 'model.json');
  const servers: ReturnType<typeof createApp>[] = [];
  async function app() {
    const server = createApp({ dbPath: join(directory, `test-${servers.length}.sqlite`), modelPath, webRoot: directory });
    servers.push(server); server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address(); assert.ok(address && typeof address === 'object');
    return `http://127.0.0.1:${address.port}`;
  }
  async function close() {
    for (const server of servers) {
      if (!server.listening) continue;
      const closed = once(server, 'close'); server.close(); server.closeAllConnections(); await closed;
    }
  }
  t.after(async () => { await close(); await rm(directory, { recursive: true, force: true }); });
  const base = await app();
  const request = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}, target = base) => fetch(target + '/api/' + path, {
    method, headers: { 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { directory, modelPath, base, app, close, request, path: (id: string) => join(directory, 'models', `erd-${id}.json`) };
}

test('HTTP SQL CRUD is explicit, revisioned, graph-isolated and persistent after restart', async t => {
  const f = await fixture(t);
  assert.deepEqual(await (await f.request('erd-models')).json(), { models: [] });
  await assert.rejects(lstat(join(f.directory, 'models')), { code: 'ENOENT' });
  const response = await f.request('erd-models', 'POST', { name: '  SQL design  ', model: schema() });
  assert.equal(response.status, 201);
  const created = await response.json();
  assert.deepEqual(created, { id: created.id, name: 'SQL design', model: { ...schema(), revision: 1 } });
  assert.equal((await lstat(f.path(created.id))).mode & 0o777, 0o600);
  assert.deepEqual(await (await f.request('erd-models')).json(), { models: [{ id: created.id, name: 'SQL design', available: true, revision: 1 }] });
  assert.deepEqual(await (await f.request('models')).json(), { models: [] });
  assert.deepEqual(await (await f.request('model-catalog')).json(), { models: [] });
  const graph = await f.request('models', 'POST', { name: 'Graph only', model: { schemaVersion: 3, nodes: [], relationshipTypes: [], relationships: [], constraints: [], indexes: [] } });
  assert.equal(graph.status, 201); const graphEntry = await graph.json();
  assert.equal((await (await f.request('erd-models')).json()).models.length, 1);
  assert.equal((await f.request(`models/${created.id}`)).status, 404);
  assert.equal((await f.request(`erd-models/${graphEntry.id}`)).status, 404);
  await chmod(f.path(created.id), 0o640);
  const updated = await f.request(`erd-models/${created.id}`, 'PUT', { name: 'Renamed', model: empty, expectedRevision: 1 });
  assert.equal(updated.status, 200);
  const expected = { id: created.id, name: 'Renamed', model: { ...empty, revision: 2 } };
  assert.deepEqual(await updated.json(), expected);
  assert.equal((await lstat(f.path(created.id))).mode & 0o777, 0o640);
  await f.close(); const restarted = await f.app();
  assert.deepEqual(await (await f.request(`erd-models/${created.id}`, 'GET', undefined, {}, restarted)).json(), expected);
  assert.equal((await f.request(`erd-models/${created.id}`, 'DELETE', { expectedRevision: 1 }, {}, restarted)).status, 409);
  const deleted = await f.request(`erd-models/${created.id}`, 'DELETE', { expectedRevision: 2 }, {}, restarted);
  assert.equal(deleted.status, 204); assert.equal(await deleted.text(), '');
  assert.equal((await f.request(`erd-models/${created.id}`, 'GET', undefined, {}, restarted)).status, 404);
  await assert.rejects(lstat(f.path(created.id)), { code: 'ENOENT' });
});

test('concurrent app instances serialize writes; stale and invalid writes preserve exact bytes', async t => {
  const f = await fixture(t), second = await f.app();
  const created = await (await f.request('erd-models', 'POST', { name: 'SQL', model: schema() })).json();
  const results = await Promise.all([f.base, second].map(target => f.request(`erd-models/${created.id}`, 'PUT', { name: 'SQL', model: empty, expectedRevision: 1 }, {}, target)));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  const bytes = await readFile(f.path(created.id));
  for (const body of [
    { name: 'SQL', model: schema(), expectedRevision: 1 },
    { name: 'SQL', model: schema(), expectedRevision: -1 },
    { name: 'SQL', model: { ...schema(), revision: 2 }, expectedRevision: 2 },
  ]) assert.ok([400, 409].includes((await f.request(`erd-models/${created.id}`, 'PUT', body)).status));
  assert.deepEqual(await readFile(f.path(created.id)), bytes);
  assert.ok(!(await readdir(join(f.directory, 'models'))).some(name => name.endsWith('.tmp')));
});

test('corrupt and unsupported physical files are unavailable and never overwritten or deleted', async t => {
  const f = await fixture(t);
  const created = await (await f.request('erd-models', 'POST', { name: 'SQL', model: schema() })).json();
  for (const content of ['{broken', JSON.stringify({ ...schema(), name: 'SQL', revision: 1, schemaVersion: 2 }), JSON.stringify({ ...schema(), name: 'SQL', revision: -1 })]) {
    await writeFile(f.path(created.id), content);
    for (const [method, body] of [['GET', undefined], ['PUT', { name: 'SQL', model: empty, expectedRevision: 1 }], ['DELETE', { expectedRevision: 1 }]] as const) {
      const response = await f.request(`erd-models/${created.id}`, method, body);
      assert.equal(response.status, 500); const error = (await response.json()).error;
      assert.equal(typeof error, 'string'); assert.ok(!error.includes(f.directory));
      assert.equal(await readFile(f.path(created.id), 'utf8'), content);
    }
    assert.deepEqual(await (await f.request('erd-models')).json(), { models: [{ id: created.id, name: created.id, available: false, error: 'The SQL model file is invalid or unsupported. Restore a valid backup before saving.' }] });
  }
});

test('symlinks, directories, collisions and failed publication preserve existing data', async t => {
  const f = await fixture(t); await mkdir(join(f.directory, 'models'));
  const id = '11111111-1111-4111-8111-111111111111', path = f.path(id), outside = join(f.directory, 'outside.json');
  const bytes = JSON.stringify({ ...schema(), name: 'Outside', revision: 1 });
  await writeFile(outside, bytes); await symlink(outside, path);
  const colliding = openErStore(f.modelPath, { generateId: () => id });
  await assert.rejects(colliding.create({ name: 'New', model: empty }), status(500));
  for (const [method, body] of [['GET', undefined], ['PUT', { name: 'New', model: empty, expectedRevision: 1 }], ['DELETE', { expectedRevision: 1 }]] as const) {
    assert.equal((await f.request(`erd-models/${id}`, method, body)).status, 500);
  }
  assert.ok((await lstat(path)).isSymbolicLink()); assert.equal(await readFile(outside, 'utf8'), bytes);
  assert.deepEqual(await colliding.list(), []);
  await rm(path); await mkdir(path);
  await assert.rejects(colliding.create({ name: 'New', model: empty }), status(500));
  assert.equal((await f.request(`erd-models/${id}`)).status, 500); assert.ok((await lstat(path)).isDirectory());
  await rm(path, { recursive: true }); await writeFile(path, '{corrupt');
  await assert.rejects(colliding.create({ name: 'New', model: empty }), status(500));
  assert.equal(await readFile(path, 'utf8'), '{corrupt');
  const blocked = join(f.directory, 'not-a-directory'); await writeFile(blocked, 'keep');
  await assert.rejects(openErStore(join(blocked, 'model.json')).create({ name: 'New', model: empty }), status(500));
  assert.equal(await readFile(blocked, 'utf8'), 'keep');
  assert.ok(!(await readdir(join(f.directory, 'models'))).some(name => name.endsWith('.tmp')));
});

test('SQL model validation rejects dangling, incompatible, duplicate and unsupported keys', () => {
  const invalid: ((model: ErModel) => void)[] = [
    m => { m.foreignKeys[0]!.sourceTableId = 'missing'; },
    m => { m.foreignKeys[0]!.targetColumnId = 'missing'; },
    m => { m.foreignKeys[0]!.sourceColumnId = 'a-parent'; },
    m => { m.tables[1]!.columns[1]!.dataType = 'bigint'; },
    m => { m.tables[0]!.columns[0]!.primaryKey = false; },
    m => { m.tables[0]!.columns[0]!.nullable = true; },
    m => { Object.assign(m.tables[0]!.columns[1]!, { primaryKey: true, nullable: false }); },
    m => { m.foreignKeys.push({ ...m.foreignKeys[0]!, id: 'fk-2', name: 'other' }); },
    m => { m.foreignKeys.push({ ...m.foreignKeys[0]!, id: 'fk-2', sourceColumnId: 'b-id' }); },
    m => { m.foreignKeys.push({ ...m.foreignKeys[0]!, name: 'other', sourceColumnId: 'b-id' }); },
    m => { m.tables[1]!.columns[0]!.id = 'a-id'; },
    m => { m.tables[1]!.id = 'a'; },
    m => { m.tables[1]!.name = 'Account'; },
    m => { m.tables[0]!.columns[1]!.name = 'a-id'; },
    m => { m.tables[0]!.columns[0]!.dataType = 'integer; DROP TABLE users' as 'integer'; },
    m => { m.foreignKeys[0] = { ...m.foreignKeys[0]!, sourceTableId: 'a', sourceColumnId: 'a-id' }; },
  ];
  for (const [index, change] of invalid.entries()) {
    const model = schema(); change(model); assert.throws(() => erModelInput(model), status(400), `case ${index}`);
  }
});

test('permission failures preserve SQL model bytes and revision, clean temps, and recover', async t => {
  const f = await fixture(t);
  const created = await (await f.request('erd-models', 'POST', { name: 'SQL', model: schema() })).json();
  const directory = join(f.directory, 'models'), bytes = await readFile(f.path(created.id));
  await chmod(directory, 0o500);
  try {
    for (const [method, body] of [
      ['PUT', { name: 'Changed', model: empty, expectedRevision: 1 }],
      ['DELETE', { expectedRevision: 1 }],
    ] as const) {
      assert.equal((await f.request(`erd-models/${created.id}`, method, body)).status, 500);
      assert.deepEqual(await readFile(f.path(created.id)), bytes);
    }
    assert.equal((await f.request('erd-models', 'POST', { name: 'New', model: empty })).status, 500);
    assert.deepEqual(await readdir(directory), [`erd-${created.id}.json`]);
  } finally { await chmod(directory, 0o700); }
  assert.equal((await f.request(`erd-models/${created.id}`, 'PUT', { name: 'Changed', model: empty, expectedRevision: 1 })).status, 200);
  assert.equal((await f.request(`erd-models/${created.id}`, 'DELETE', { expectedRevision: 2 })).status, 204);
});

test('strict shapes, UTF-8 identifier limits, exact-case uniqueness, flags and coordinate bounds', () => {
  for (const name of ['', 'a\0b', 'a\nb', '\u007f', '\u0085', '\ud800', '\udfff', 'é'.repeat(32), 'a'.repeat(64)]) {
    const model = schema(); model.tables[0]!.name = name; assert.throws(() => erModelInput(model), status(400), JSON.stringify(name));
  }
  for (const value of [-1, 20001, Infinity, NaN, '0', null]) {
    const model = schema(); model.tables[0]!.x = value as number; assert.throws(() => erModelInput(model), status(400));
  }
  for (const value of [null, [], {}, { ...empty, extra: true }, { ...empty, revision: 1 }, { ...empty, dialect: 'mysql' }, { ...empty, kind: 'graph' }, { ...empty, tables: null }]) assert.throws(() => erModelInput(value), status(400));
  const valid = schema(); valid.tables[0]!.name = 'é'.repeat(31) + 'a'; valid.tables[1]!.name = valid.tables[0]!.name.toUpperCase();
  valid.tables[0]!.columns[1]!.name = 'A-ID'; assert.deepEqual(erModelInput(valid), valid);
  valid.tables[0]!.name = '😀'.repeat(15); assert.doesNotThrow(() => erModelInput(valid));
  for (const field of ['nullable', 'primaryKey', 'unique']) {
    const model = schema(); Object.assign(model.tables[0]!.columns[0]!, { [field]: 'false' }); assert.throws(() => erModelInput(model), status(400));
  }
  const model = schema(); Object.assign(model.tables[0]!.columns[0]!, { default: 'NOW()' }); assert.throws(() => erModelInput(model), status(400));
});

for (const name of ['tableoid', 'ctid', 'xmin', 'xmax', 'cmin', 'cmax']) {
  test(`PostgreSQL system column ${name} is rejected in save/export candidates and preserves invalid storage`, async t => {
    const model = schema(); model.tables[0]!.columns[0]!.name = name;
    const expectedError = { status: 400, message: `Column name "${name}" is reserved for a PostgreSQL system column. Choose a different column name.` };
    assert.throws(() => erModelInput(model), expectedError);
    assert.throws(() => exportErModel({ model }), expectedError);
    const f = await fixture(t);
    for (const [route, body] of [
      ['erd-models', { name: 'SQL', model }], ['erd-export', { model }],
    ] as const) {
      const response = await f.request(route, 'POST', body);
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: expectedError.message });
    }
    await assert.rejects(lstat(join(f.directory, 'models')), { code: 'ENOENT' });
    const created = await (await f.request('erd-models', 'POST', { name: 'SQL', model: schema() })).json();
    const path = f.path(created.id), bytes = await readFile(path);
    assert.equal((await f.request(`erd-models/${created.id}`, 'PUT', { name: 'SQL', model, expectedRevision: 1 })).status, 400);
    assert.deepEqual(await readFile(path), bytes);
    const invalidBytes = JSON.stringify({ ...model, name: 'SQL', revision: 1 });
    await writeFile(path, invalidBytes);
    for (const [method, body] of [
      ['GET', undefined], ['PUT', { name: 'SQL', model: schema(), expectedRevision: 1 }], ['DELETE', { expectedRevision: 1 }],
    ] as const) {
      const response = await f.request(`erd-models/${created.id}`, method, body);
      assert.equal(response.status, 500);
      assert.match((await response.json()).error, /invalid or unsupported/);
      assert.equal(await readFile(path, 'utf8'), invalidBytes);
    }
    const summary = (await (await f.request('erd-models')).json()).models[0];
    assert.equal(summary.available, false);
    assert.deepEqual(await readdir(join(f.directory, 'models')), [`erd-${created.id}.json`]);
  });
}

test('system column restrictions are exact-case and do not restrict table, constraint or ID names', () => {
  for (const name of ['tableoid', 'ctid', 'xmin', 'xmax', 'cmin', 'cmax']) {
    const model = schema();
    model.tables[0]!.name = name;
    model.tables[0]!.columns[0]!.name = name.toUpperCase();
    model.tables[0]!.columns[1]!.id = name;
    model.foreignKeys[0]!.name = name;
    assert.deepEqual(erModelInput(model), model);
    const sql = exportErModel({ model }).content;
    assert.ok(sql.includes(`CREATE TABLE "${name}" (`));
    assert.ok(sql.includes(`"${name.toUpperCase()}" integer`));
    assert.ok(sql.includes(`ADD CONSTRAINT "${name}" FOREIGN KEY`));
  }
});

test('table, column and foreign key count limits are enforced', () => {
  assert.throws(() => erModelInput({ ...empty, tables: Array.from({ length: 101 }, (_, i) => ({ id: `t${i}`, name: `t${i}`, x: 0, y: 0, columns: [] })) }), status(400));
  const model = schema(); model.tables[0]!.columns = Array.from({ length: 101 }, (_, i) => column(`c${i}`));
  assert.throws(() => erModelInput(model), status(400));
  assert.throws(() => erModelInput({ ...schema(), foreignKeys: Array.from({ length: 501 }, () => schema().foreignKeys[0]) }), status(400));
});

test('export quotes every identifier, fixes type vocabulary, and reserves generated constraint names', () => {
  const model = schema();
  model.tables[0]!.name = 'users"; DROP TABLE secrets;--';
  model.tables[0]!.columns[0]!.name = 'id"value';
  model.tables[1]!.name = 'erd_pk_1'; model.foreignKeys[0]!.name = 'erd_pk_2';
  model.tables[1]!.columns[1]!.name = 'user";--';
  const result = exportErModel({ model });
  assert.equal(result.filename, 'schema.sql'); assert.equal(result.mediaType, 'application/sql');
  assert.match(result.content, /CREATE TABLE "users""; DROP TABLE secrets;--"/);
  assert.match(result.content, /"id""value" integer NOT NULL CONSTRAINT "erd_pk_3" PRIMARY KEY/);
  assert.match(result.content, /ALTER TABLE "erd_pk_1" ADD CONSTRAINT "erd_pk_2" FOREIGN KEY \("user"";--"\) REFERENCES "users""; DROP TABLE secrets;--" \("id""value"\);/);
  const types = { ...empty, tables: [{ id: 'types', name: 'select', x: 0, y: 0, columns: ER_DATA_TYPES.map((dataType, i) => ({ ...column(`c${i}`), dataType, unique: true })) }] };
  const sql = exportErModel({ model: types }).content;
  for (const [i, type] of ER_DATA_TYPES.entries()) assert.ok(sql.includes(`"c${i}" ${type} CONSTRAINT`));
});

test('self references, cycles and unique targets export after all CREATE TABLE statements', () => {
  const model = schema(); model.tables[0]!.columns[0]!.primaryKey = false; model.tables[0]!.columns[0]!.unique = true;
  model.foreignKeys.push(
    { id: 'self', name: 'self', sourceTableId: 'a', sourceColumnId: 'a-parent', targetTableId: 'a', targetColumnId: 'a-id' },
    { id: 'cycle', name: 'entry_account', sourceTableId: 'a', sourceColumnId: 'a-id', targetTableId: 'b', targetColumnId: 'b-id' },
  );
  assert.deepEqual(erModelInput(model), model);
  const sql = exportErModel({ model }).content;
  assert.ok(sql.lastIndexOf('CREATE TABLE') < sql.indexOf('ALTER TABLE'));
  assert.match(sql, /CONSTRAINT "erd_unique_1" UNIQUE/);
  assert.match(sql, /ALTER TABLE "Account" ADD CONSTRAINT "self" FOREIGN KEY \("a-parent"\) REFERENCES "Account" \("a-id"\)/);
});

test('empty drafts save while SQL export requires tables and columns; export never persists', async t => {
  const f = await fixture(t);
  for (const model of [empty, { ...empty, tables: [{ id: 'draft', name: 'Draft', x: 0, y: 0, columns: [] }] }]) {
    const result = await f.request('erd-export', 'POST', { model }); assert.equal(result.status, 400);
    assert.match((await result.json()).error, /Add at least one (table|column)/);
    assert.equal((await f.request('erd-models', 'POST', { name: 'Draft', model })).status, 201);
  }
  const before = await readdir(join(f.directory, 'models'));
  const response = await f.request('erd-export', 'POST', { model: schema() });
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), exportErModel({ model: schema() }));
  assert.deepEqual(await readdir(join(f.directory, 'models')), before);
});

test('HTTP names, malformed input, missing IDs, body bounds and localhost protections', async t => {
  const f = await fixture(t);
  for (const name of ['', '  ', 'a'.repeat(101), 'line\nbreak', '\ud800', null]) assert.equal((await f.request('erd-models', 'POST', { name, model: empty })).status, 400);
  for (const body of [{ model: empty }, { name: 'SQL', model: empty, extra: true }, { name: 'SQL', model: { ...empty, revision: 0 } }]) assert.equal((await f.request('erd-models', 'POST', body)).status, 400);
  assert.equal((await f.request('erd-models/not-a-uuid')).status, 400);
  const missing = 'erd-models/11111111-1111-4111-8111-111111111111';
  for (const [method, body] of [['GET', undefined], ['PUT', { name: 'SQL', model: empty, expectedRevision: 0 }], ['DELETE', { expectedRevision: 0 }]] as const) assert.equal((await f.request(missing, method, body)).status, 404);
  for (const route of ['erd-models', 'erd-export']) {
    assert.equal((await f.request(route, 'POST', { name: 'SQL', model: empty }, { Origin: 'https://other.invalid' })).status, 403);
    assert.equal((await f.request(route, 'POST', {}, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    assert.equal((await f.request(route, 'POST', {}, { 'Content-Type': 'text/plain' })).status, 400);
    const malformed = await fetch(f.base + '/api/' + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{invalid' }); assert.equal(malformed.status, 400);
    const large = await f.request(route, 'POST', { model: empty, padding: 'x'.repeat(2 * 1024 * 1024) }); assert.equal(large.status, 400); assert.match((await large.json()).error, /too large/);
  }
  const foreignHostStatus = await new Promise<number | undefined>((resolve, reject) => {
    const request = httpRequest(f.base + '/api/erd-models', { headers: { Host: 'evil.invalid' } }, response => {
      response.resume(); response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject); request.end();
  });
  assert.equal(foreignHostStatus, 403);
  await assert.rejects(lstat(join(f.directory, 'models')), { code: 'ENOENT' });
});
