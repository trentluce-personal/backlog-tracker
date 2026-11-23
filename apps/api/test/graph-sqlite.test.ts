import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test, type TestContext } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { emptyModel, type ModelInput } from '../src/model-schema.ts';
import { importModelDocuments } from '../src/model-sqlite.ts';
import { createApp } from '../src/server.ts';
import { openStore } from '../src/store.ts';

const a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const b = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const c = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const d = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const erd = { kind: 'sql', schemaVersion: 1, dialect: 'postgresql', tables: [{ id: 'table-1', name: 'people', x: 60, y: 60,
  columns: [{ id: 'column-1', name: 'id', dataType: 'integer', primaryKey: true, nullable: false, unique: false }] }], foreignKeys: [] };
const cli = fileURLToPath(new URL('../src/model-import.ts', import.meta.url));
const serverEntry = fileURLToPath(new URL('../src/server.ts', import.meta.url));
const node = { kind: 'definition', id: 'node-1', name: 'Person', x: 60, y: 60, classification: 'Transactional', draft: false, impliedLabels: [], properties: [] } as const;
const reference = (modelId: string): ModelInput => ({ ...emptyModel(), nodes: [{ kind: 'reference', id: 'node-2', name: 'Alias', x: 60, y: 60,
  classification: 'External Reference', target: { modelId, nodeId: node.id } }] });

async function fixture(t: TestContext, singleton = 'model.json') {
  const directory = await mkdtemp(join(tmpdir(), 'backlog-graph-sqlite-'));
  const servers: ReturnType<typeof createApp>[] = [];
  async function stop() {
    for (const server of servers.splice(0)) {
      const closed = once(server, 'close');
      server.close(); server.closeAllConnections(); await closed;
    }
  }
  t.after(async () => {
    await stop();
    await rm(directory, { recursive: true, force: true });
  });
  // Every path handed to the CLI is built inside this fresh directory. Its CLI
  // has no default paths and these children do not inherit owner configuration.
  const dbPath = join(directory, 'fixture.sqlite');
  const models = join(directory, 'models');
  const modelPath = join(models, singleton);
  await mkdir(models);
  if (process.platform !== 'win32') await writeFile(dbPath, '', { flag: 'wx', mode: 0o600 });
  openStore(dbPath).close();
  const isolatedEnv = process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot } : {};
  function command(...args: string[]) {
    const result = spawnSync(process.execPath, [cli, ...args], { cwd: directory, env: isolatedEnv, encoding: 'utf8', timeout: 10000 });
    assert.ifError(result.error);
    return { status: result.status, stderr: result.stderr, report: result.stdout.trim() ? JSON.parse(result.stdout) : undefined };
  }
  const run = (action: '--dry-run' | '--apply') => command(action, '--db', dbPath, '--model', modelPath);
  const ready = (mode: 'live' | 'offline' = 'live') => {
    const url = pathToFileURL(dbPath);
    // Even read-only queries can leave WAL/SHM files. Use immutable mode only
    // for offline checks, where there are no uncheckpointed writes to observe.
    if (mode === 'offline') url.search = '?immutable=1';
    const db = new DatabaseSync(url, { readOnly: true });
    try { return db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND (name LIKE 'named_graph_%' OR name IN ('legacy_graph_document', 'erd_documents')) ORDER BY name").all().map(row => row.name); }
    finally { db.close(); }
  };
  const app = (namedModelStorage?: 'file' | 'sqlite') => createApp({ dbPath, modelPath, webRoot: directory, namedModelStorage });
  let lastPort: number | undefined;
  async function serve(namedModelStorage: 'file' | 'sqlite') {
    const server = app(namedModelStorage);
    servers.push(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    lastPort = address.port;
    return async (path: string, method = 'GET', data?: unknown) => {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/${path}`, {
        method, ...(data === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }),
      });
      return { status: response.status, body: response.status === 204 ? undefined : await response.json() };
    };
  }
  function startWithoutStorageFlag() {
    assert.ok(lastPort);
    return spawnSync(process.execPath, [serverEntry], { cwd: directory, encoding: 'utf8', timeout: 5000,
      env: { ...isolatedEnv, BACKLOG_DB_PATH: dbPath, BACKLOG_MODEL_PATH: modelPath, PORT: String(lastPort) } });
  }
  return { directory, dbPath, models, modelPath, file: (id: string) => join(models, id + '.json'), command, run, ready, app, serve, stop, startWithoutStorageFlag };
}

test('fresh dry-run is read-only and apply preserves exact bytes of all model kinds, including shared UUIDs', async t => {
  const f = await fixture(t, b + '.json');
  const old = { schemaVersion: 1, name: 'Same name', revision: 7, nodes: [{ id: node.id, name: node.name, x: 60, y: 60 }],
    relationships: [{ id: 'relationship-1', name: 'KNOWS', source: node.id, target: node.id }] };
  const current = { ...reference(d), name: 'Same name', revision: 13 };
  current.nodes.push({ ...node, id: 'node-3', name: 'Draft', x: 260, draft: true, impliedLabels: [], properties: [] });
  const source = new Map([[f.file(a), Buffer.from(JSON.stringify(old, null, 2) + '\r\n')],
    [f.file(c), Buffer.from(JSON.stringify(current))], [f.modelPath, Buffer.from(' ' + JSON.stringify({ ...emptyModel(), revision: 4 }) + '\n')],
    [f.file(d.toUpperCase()), Buffer.from('wrong case')], [f.file('ERD-' + d), Buffer.from('wrong prefix')],
    [f.file('erd-' + c.toUpperCase()), Buffer.from('wrong UUID case')], [f.file('erd-' + a), Buffer.from(JSON.stringify({ ...erd, name: 'People §', revision: 9 }, null, 2) + '\r\n')]]);
  for (const [path, bytes] of source) await writeFile(path, bytes);
  await mkdir(f.file('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'));
  await mkdir(f.file('erd-' + b));
  assert.equal(f.command('--apply').status, 1);
  const before = await readFile(f.dbPath);
  const entries = await readdir(f.directory);
  assert.throws(() => f.app('sqlite'), /not ready/);
  const missing = f.command('--apply', '--db', join(f.directory, 'missing.sqlite'), '--model', f.modelPath);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /requires an existing regular SQLite file/);
  const dry = f.run('--dry-run');
  assert.equal(dry.status, 0, dry.stderr);
  assert.deepEqual(dry.report, { mode: 'dry-run', source: 'files', imported: false,
    eligibleIds: { named: [a, c], legacy: ['legacy'], erds: [a] }, failedIds: { named: [], legacy: [], erds: [] } });
  assert.deepEqual(await readdir(f.directory), entries);
  assert.deepEqual(await readFile(f.dbPath), before);
  assert.deepEqual(f.ready(), []);
  const applied = f.run('--apply');
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(applied.report.imported, true);
  const db = new DatabaseSync(f.dbPath, { readOnly: true });
  try {
    const rows = db.prepare('SELECT id, CAST(document AS BLOB) AS bytes FROM named_graph_documents ORDER BY id').all();
    assert.deepEqual(rows.map(r => r.id), [a, c]);
    assert.deepEqual(Buffer.from(rows[0]!.bytes as Uint8Array), source.get(f.file(a)));
    assert.deepEqual(Buffer.from(rows[1]!.bytes as Uint8Array), source.get(f.file(c)));
    assert.deepEqual(db.prepare('SELECT id FROM erd_documents').get()?.id, a);
    for (const [table, path] of [['legacy_graph_document', f.modelPath], ['erd_documents', f.file('erd-' + a)]]) {
      assert.deepEqual(Buffer.from(db.prepare(`SELECT CAST(document AS BLOB) AS bytes FROM ${table}`).get()!.bytes as Uint8Array), source.get(path!));
    }
    assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, 3);
  } finally { db.close(); }
  for (const [path, bytes] of source) assert.deepEqual(await readFile(path), bytes);
  const api = await f.serve('sqlite');
  assert.equal((await api('model-catalog')).body.models.find((row: { id: string }) => row.id === a).sourceSchemaVersion, 1);
});

test('eligible corrupt files and destination conflicts fail closed; an insert failure rolls back schema and rows', async t => {
  const f = await fixture(t);
  await writeFile(f.file(a), JSON.stringify({ ...emptyModel(), name: 'Valid', revision: 2 }));
  await writeFile(f.file(b), 'PRIVATE_CORRUPT_SOURCE');
  await writeFile(f.file('erd-' + a), Buffer.from([0xff]));
  await mkdir(f.modelPath);
  const before = await readFile(f.dbPath);
  for (const action of ['--dry-run', '--apply'] as const) {
    const failed = f.run(action);
    assert.equal(failed.status, 1);
    assert.deepEqual(failed.report.failedIds, { named: [b], legacy: ['legacy'], erds: [a] });
    assert.doesNotMatch(failed.stderr, /PRIVATE_CORRUPT_SOURCE|fixture\.sqlite/);
    assert.deepEqual(f.ready(), []);
    assert.deepEqual(await readFile(f.dbPath), before);
  }
  assert.equal(await readFile(f.file(b), 'utf8'), 'PRIVATE_CORRUPT_SOURCE');
  assert.deepEqual(await readFile(f.file('erd-' + a)), Buffer.from([0xff]));
  assert.ok((await lstat(f.modelPath)).isDirectory());
  const db = new DatabaseSync(f.dbPath);
  try {
    const named = { id: a, document: JSON.stringify({ ...emptyModel(), name: 'Valid', revision: 2 }) };
    const duplicate = { id: a, document: JSON.stringify({ ...erd, name: 'Duplicate', revision: 1 }) };
    assert.throws(() => importModelDocuments(db, 'files', { named: [named], erds: [duplicate, duplicate] }), /UNIQUE/);
    assert.deepEqual(f.ready(), []);
    db.exec('CREATE TABLE named_graph_documents (id TEXT PRIMARY KEY);');
    db.prepare('INSERT INTO named_graph_documents VALUES (?)').run(a);
  } finally { db.close(); }
  await rm(f.file(b));
  assert.match(f.run('--dry-run').stderr, /cannot be repeated or merged/);
  assert.match(f.run('--apply').stderr, /cannot be repeated or merged/);
  assert.deepEqual(f.ready(), ['named_graph_documents']);
  assert.throws(() => f.app('sqlite'), /not ready/);
});

for (const [scenario, sql] of [
  ['v1 with dueTime', 'PRAGMA user_version = 1'],
  ['v1 with a case-variant generated dueTime', `ALTER TABLE tasks DROP COLUMN dueTime;
    ALTER TABLE tasks ADD COLUMN DUETIME TEXT GENERATED ALWAYS AS (NULL) VIRTUAL; PRAGMA user_version = 1`],
  ['v2 without dueTime', 'ALTER TABLE tasks DROP COLUMN dueTime'],
  ['v2 with a generated dueTime', `ALTER TABLE tasks DROP COLUMN dueTime;
    ALTER TABLE tasks ADD COLUMN dueTime TEXT GENERATED ALWAYS AS (NULL) VIRTUAL`],
  ['missing projects table replaced by a view', 'ALTER TABLE projects RENAME TO old_projects; CREATE VIEW projects AS SELECT * FROM old_projects'],
  ['missing tasks table', 'DROP TABLE tasks'],
  ['missing essential project column', 'ALTER TABLE projects DROP COLUMN createdAt'],
  ['missing essential task column', 'ALTER TABLE tasks DROP COLUMN updatedAt'],
] as const) {
  test(`destination preflight rejects ${scenario} without changing bytes`, async t => {
    const f = await fixture(t);
    const source = Buffer.from(JSON.stringify({ ...emptyModel(), name: 'Fixture', revision: 1 }));
    await writeFile(f.file(a), source);
    {
      using db = new DatabaseSync(f.dbPath);
      db.exec(sql);
    }
    const before = await readFile(f.dbPath);
    const entries = await readdir(f.directory);
    for (const action of ['--dry-run', '--apply'] as const) {
      await t.test(action, async () => {
        const refused = f.run(action);
        assert.ok((await readFile(f.dbPath)).equals(before), 'database bytes changed');
        assert.ok((await readFile(f.file(a))).equals(source), 'source bytes changed');
        assert.deepEqual(await readdir(f.directory), entries, 'database directory entries');
        assert.equal(refused.status, 1, refused.stderr);
        assert.match(refused.stderr, /requires an existing backlog database/);
        assert.equal(refused.report, undefined);
      });
    }
  });
}

test('consistent backlog v1 can cut over and migrate dueTime on startup', async t => {
  const f = await fixture(t);
  {
    using db = new DatabaseSync(f.dbPath);
    db.exec('DROP TABLE task_tags; DROP TABLE tags; ALTER TABLE tasks DROP COLUMN dueTime; PRAGMA user_version = 1');
  }
  for (const action of ['--dry-run', '--apply'] as const) {
    const result = f.run(action);
    assert.equal(result.status, 0, result.stderr);
  }
  const readVersion = () => {
    using db = new DatabaseSync(f.dbPath, { readOnly: true });
    return db.prepare('PRAGMA user_version').get()?.user_version;
  };
  assert.equal(readVersion(), 1);
  const api = await f.serve('sqlite');
  assert.equal((await api('models')).status, 200);
  assert.equal(readVersion(), 3);
});

test('unused index corruption blocks import preflight and the write transaction without changing bytes', async t => {
  const f = await fixture(t);
  const source = Buffer.from(JSON.stringify({ ...emptyModel(), revision: 1 }));
  await writeFile(f.modelPath, source);
  let offset: number;
  {
    using db = new DatabaseSync(f.dbPath);
    const page = Number(db.prepare("SELECT rootpage FROM sqlite_schema WHERE name = 'tasks_projectId'").get()?.rootpage);
    offset = (page - 1) * Number(db.prepare('PRAGMA page_size').get()?.page_size);
    // Keep the fixture in rollback mode for the direct write-transaction check.
    db.exec('PRAGMA journal_mode = DELETE');
  }
  const corrupted = await readFile(f.dbPath);
  assert.equal(corrupted[offset], 10); // Empty SQLite index b-tree leaf page.
  corrupted[offset] = 0;
  await writeFile(f.dbPath, corrupted);
  const entries = (await readdir(f.directory)).sort();
  async function unchanged() {
    assert.ok((await readFile(f.dbPath)).equals(corrupted), 'database bytes changed');
    assert.ok((await readFile(f.modelPath)).equals(source), 'source bytes changed');
    assert.deepEqual((await readdir(f.directory)).sort(), entries);
    assert.deepEqual(f.ready('offline'), []);
  }
  for (const action of ['--dry-run', '--apply'] as const) {
    await t.test(action, async () => {
      const refused = f.run(action);
      await unchanged();
      assert.equal(refused.status, 1, refused.stderr);
      assert.match(refused.stderr, /integrity check failed/);
      assert.equal(refused.report, undefined);
    });
  }
  await t.test('write transaction bypassing CLI preflight', async () => {
    const path = join(f.directory, 'transaction.sqlite');
    await writeFile(path, corrupted, { mode: 0o600 });
    {
      using db = new DatabaseSync(path);
      assert.throws(() => importModelDocuments(db, 'files', { named: [], erds: [] }), /integrity check failed/);
      assert.equal(db.isTransaction, false);
    }
    assert.ok((await readFile(path)).equals(corrupted), 'database bytes changed');
    assert.deepEqual((await readdir(f.directory)).sort(), [...entries, 'transaction.sqlite'].sort());
  });
});

test('offline preflight refuses pending journals and nonregular sidecars without modifying them', async t => {
  const f = await fixture(t);
  const before = await readFile(f.dbPath);
  const pending = Buffer.from('pending fixture state');
  for (const suffix of ['-wal', '-journal']) {
    const sidecar = f.dbPath + suffix;
    await writeFile(sidecar, pending, { flag: 'wx', mode: 0o600 });
    for (const action of ['--dry-run', '--apply'] as const) assert.match(f.run(action).stderr, /pending WAL or journal/);
    assert.deepEqual(await readFile(sidecar), pending);
    assert.deepEqual(await readFile(f.dbPath), before);
    await rm(sidecar);
  }
  const sharedMemory = f.dbPath + '-shm';
  await mkdir(sharedMemory);
  for (const action of ['--dry-run', '--apply'] as const) assert.match(f.run(action).stderr, /sidecars must be regular files/);
  assert.ok((await lstat(sharedMemory)).isDirectory());
  assert.deepEqual(await readFile(f.dbPath), before);
});

test('import refuses broader POSIX permissions on the database and its companions', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t);
  await chmod(f.dbPath, 0o640);
  const before = await readFile(f.dbPath);
  for (const action of ['--dry-run', '--apply'] as const) {
    const refused = f.run(action);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /owner-only POSIX permissions/);
  }
  assert.equal((await lstat(f.dbPath)).mode & 0o777, 0o640);
  assert.deepEqual(await readFile(f.dbPath), before);
  assert.deepEqual(f.ready('offline'), []);
  await chmod(f.dbPath, 0o600);
  for (const suffix of ['-wal', '-shm', '-journal']) {
    const path = f.dbPath + suffix;
    await writeFile(path, '', { flag: 'wx', mode: 0o600 });
    await chmod(path, 0o644);
    const refused = f.run('--apply');
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /owner-only POSIX permissions/);
    assert.equal((await lstat(path)).mode & 0o777, 0o644);
    await rm(path);
  }
  const link = join(f.directory, 'link.sqlite');
  await symlink(f.dbPath, link);
  assert.match(f.command('--apply', '--db', link, '--model', f.modelPath).stderr, /existing regular SQLite file/);
  await symlink(f.dbPath, f.dbPath + '-shm');
  assert.match(f.run('--apply').stderr, /must be regular files/);
  await rm(f.dbPath + '-shm');
  assert.deepEqual(await readFile(f.dbPath), before);
  assert.deepEqual(f.ready('offline'), []);
  const applied = f.run('--apply');
  assert.equal(applied.status, 0, applied.stderr);
  await chmod(f.dbPath, 0o644);
  assert.throws(() => f.app('sqlite'), /owner-only POSIX permissions/);
  assert.equal((await lstat(f.dbPath)).mode & 0o777, 0o644);
});

test('nonregular UUID entries are excluded and an explicit empty import enables SQLite', async t => {
  const f = await fixture(t);
  const outside = join(f.directory, 'outside.json');
  await writeFile(outside, JSON.stringify({ ...emptyModel(), name: 'Do not follow', revision: 1 }));
  try {
    await symlink(outside, f.file(a), 'file');
    await symlink(outside, f.file('erd-' + a), 'file');
  }
  catch (error) {
    if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') {
      t.diagnostic('Windows file symlink creation unavailable; exercising a UUID-named directory junction instead.');
      const outsideDirectory = join(f.directory, 'outside');
      await mkdir(outsideDirectory);
      await symlink(outsideDirectory, f.file(a), 'junction');
      await symlink(outsideDirectory, f.file('erd-' + a), 'junction');
    } else throw error;
  }
  const empty = f.run('--apply');
  assert.equal(empty.status, 0, empty.stderr);
  assert.deepEqual(empty.report.eligibleIds, { named: [], legacy: [], erds: [] });
  const api = await f.serve('sqlite');
  assert.deepEqual((await api('models')).body, { models: [] });
  assert.equal((await api('models/' + a)).status, 404);
});

test('SQLite HTTP routes share the cutover store for revisions, catalogs, composition/export and legacy target lookup', async t => {
  const f = await fixture(t);
  const graph = { ...emptyModel(), nodes: [node] };
  const original = JSON.stringify({ ...graph, name: 'Imported', revision: 7 });
  await writeFile(f.file(a), original);
  const originalEr = JSON.stringify({ ...erd, revision: 3, name: 'ERD fixture' });
  const originalLegacy = JSON.stringify({ ...graph, revision: 4 });
  await writeFile(f.modelPath, originalLegacy);
  await writeFile(f.file('erd-' + a), originalEr);
  const applied = f.run('--apply');
  assert.equal(applied.status, 0, applied.stderr);
  // Diverge the source directory after cutover: no named route can read this file.
  await writeFile(f.file(b), JSON.stringify({ ...graph, name: 'File only', revision: 1 }));
  const api = await f.serve('sqlite');
  const otherWriter = await f.serve('sqlite');
  assert.equal((await api('models/' + b)).status, 404);
  assert.equal((await api('erd-models/' + a)).body.model.revision, 3);
  assert.equal((await api('model')).body.model.revision, 4);
  const metadata = await api('backend-schema');
  const table = metadata.body.sqlite.tables.find((row: { name: string }) => row.name === 'named_graph_documents');
  assert.ok(table.indexes.some((index: { origin: string }) => index.origin === 'pk'));
  assert.deepEqual(metadata.body.sqlite.tables.map((row: { name: string }) => row.name),
    ['erd_documents', 'legacy_graph_document', 'named_graph_cutover', 'named_graph_documents', 'projects', 'tags', 'task_tags', 'tasks']);
  assert.deepEqual(metadata.body.jsonStorage.map((row: { name: string }) => row.name),
    ['Graph model (named and singleton documents in SQLite)', 'PostgreSQL ERD (SQLite documents)']);
  assert.doesNotMatch(JSON.stringify(metadata.body), /fixture\.sqlite|Imported|ERD fixture/);

  const saves = await Promise.all([api, otherWriter].map((request, i) => request('models/' + a, 'PUT', {
    expectedRevision: 7, name: `Updated ${i}`, model: graph,
  })));
  assert.deepEqual(saves.map(result => result.status).sort(), [200, 409]);
  assert.equal((await api('models/' + a)).body.model.revision, 8);
  const catalog = await api('model-catalog');
  assert.deepEqual(catalog.body.models.map((row: { id: string }) => row.id).sort(), [a, 'legacy']);
  assert.equal(catalog.body.models.find((row: { id: string }) => row.id === a).sourceSchemaVersion, 3);
  assert.equal((await api('model-node-definitions')).body.models.find((row: { id: string }) => row.id === a).definitions[0].id, node.id);

  const model = reference(a);
  const validation = await api('model-validation', 'POST', { modelId: 'legacy', model });
  assert.equal(validation.body.valid, true);
  assert.deepEqual(validation.body.dependencies, [{ modelId: a, revision: 8 }]);
  const exported = await api('model-export', 'POST', { modelId: 'legacy', model, format: 'json' });
  assert.equal(exported.status, 200);
  assert.equal(JSON.parse(exported.body.content).fragments.find((item: { modelId: string }) => item.modelId === a).model.nodes[0].name, node.name);
  const legacyRef = await api('models', 'POST', { model: reference('legacy'), name: 'References SQLite singleton' });
  assert.equal(legacyRef.status, 201);
  assert.deepEqual((await api('model-validation', 'POST', { modelId: legacyRef.body.id, model: reference('legacy') })).body.dependencies,
    [{ modelId: 'legacy', revision: 4 }]);
  assert.equal((await api('model', 'PUT', { model, expectedRevision: 4 })).status, 200);
  const created = await api('models', 'POST', { model, name: 'SQL only' });
  assert.equal(created.status, 201);
  assert.equal(created.body.model.revision, 1);
  assert.equal((await api('models/' + a, 'DELETE', { expectedRevision: 7 })).status, 409);
  assert.equal((await api('models/' + a, 'DELETE', { expectedRevision: 8 })).status, 204);
  assert.equal((await otherWriter('models/' + a)).status, 404);
  assert.equal((await api('model-export', 'POST', { modelId: 'legacy', model, format: 'json' })).status, 422);
  assert.equal((await api('models', 'POST', { model, name: 'Missing SQL target' })).status, 400);
  // Existing unresolved placements may be retained; a newly added one cannot resolve from disk.
  assert.equal((await api('models/' + created.body.id, 'PUT', { model, name: 'Preserved', expectedRevision: 1 })).status, 200);
  assert.equal((await api('model', 'PUT', { model: { ...model, nodes: [{ ...model.nodes[0], id: 'node-4' }] }, expectedRevision: 5 })).status, 400);
  assert.equal((await api('model')).body.model.revision, 5);
  assert.equal((await api('models/legacy', 'DELETE', { expectedRevision: 4 })).status, 409);
  assert.equal((await api('models/legacy', 'DELETE', { expectedRevision: 5 })).status, 204);
  assert.equal((await api('models/legacy', 'DELETE', { expectedRevision: 0 })).status, 404);
  assert.deepEqual((await api('erd-models')).body.models, [{ id: a, name: 'ERD fixture', revision: 3, available: true }]);
  const erSaves = await Promise.all([api, otherWriter].map((request, i) => request('erd-models/' + a, 'PUT', {
    expectedRevision: 3, name: `ERD updated ${i}`, model: erd,
  })));
  assert.deepEqual(erSaves.map(result => result.status).sort(), [200, 409]);
  assert.equal((await api('erd-models/' + a)).body.model.revision, 4);
  assert.equal((await api('erd-models/' + a, 'DELETE', { expectedRevision: 3 })).status, 409);
  assert.equal((await api('erd-models/' + a, 'DELETE', { expectedRevision: 4 })).status, 204);
  assert.equal((await api('erd-models/' + a, 'PUT', { name: 'Missing', model: erd, expectedRevision: 4 })).status, 404);
  const failedWhileOpen = f.run('--dry-run');
  assert.equal(failedWhileOpen.status, 1);
  assert.match(failedWhileOpen.stderr, /pending WAL or journal/);
  await f.stop();
  assert.match(f.run('--apply').stderr, /cannot be repeated/);
  const unflagged = f.startWithoutStorageFlag();
  assert.ifError(unflagged.error);
  assert.equal(unflagged.status, 1, unflagged.stderr);
  assert.match(unflagged.stderr, /BACKLOG_NAMED_MODEL_STORAGE=sqlite/);
  assert.doesNotMatch(unflagged.stdout, /listening/);
  assert.throws(() => f.app('file'), /BACKLOG_NAMED_MODEL_STORAGE=sqlite/);
  const reopened = await f.serve('sqlite');
  assert.equal((await reopened('models/' + a)).status, 404);
  assert.equal((await reopened('erd-models/' + a)).status, 404);
  assert.deepEqual((await reopened('erd-models')).body, { models: [] });
  assert.deepEqual((await reopened('model')).body.model, { ...emptyModel(), revision: 0 });
  assert.ok(!(await reopened('models')).body.models.some((row: { id: string }) => row.id === 'legacy'));
  assert.equal((await reopened('models', 'POST', { model: reference('legacy'), name: 'Missing legacy target' })).status, 400);
  assert.equal(await readFile(f.file(a), 'utf8'), original);
  assert.equal(await readFile(f.file('erd-' + a), 'utf8'), originalEr);
  assert.equal(await readFile(f.modelPath, 'utf8'), originalLegacy);
  assert.ok(!(await readdir(f.models)).includes(created.body.id + '.json'));
});

test('v2 starts and serves every model kind with the source directory gone', async t => {
  const f = await fixture(t);
  await writeFile(f.file(a), JSON.stringify({ ...emptyModel(), name: 'Imported', revision: 1, nodes: [node] }));
  const applied = f.run('--apply');
  assert.equal(applied.status, 0, applied.stderr);
  // ENOTDIR is deterministic across platforms and doesn't rely on the test user's privileges.
  await rename(f.models, f.models + '-retained');
  await writeFile(f.models, 'not a directory');
  const api = await f.serve('sqlite');
  const endpoints = ['models', 'model-node-definitions', 'model-catalog'];
  for (const endpoint of endpoints) {
    const response = await api(endpoint);
    assert.equal(response.status, 200, endpoint);
    assert.deepEqual(response.body.models.map((row: { id: string }) => row.id), [a]);
  }

  assert.deepEqual((await api('models/legacy')).body.model, { ...emptyModel(), revision: 0 });
  const model = reference('legacy');
  const validation = await api('model-validation', 'POST', { modelId: a, model });
  assert.equal(validation.status, 200);
  assert.equal(validation.body.valid, false);
  assert.ok(validation.body.issues.some((issue: { code: string }) => issue.code === 'UNRESOLVED_REFERENCE'));
  assert.equal((await api('models', 'POST', { model, name: 'Unresolved legacy target' })).status, 400);
  const graph = { ...emptyModel(), nodes: [node] };
  assert.equal((await api('model', 'PUT', { model: graph, expectedRevision: 0 })).body.model.revision, 1);
  assert.equal((await api('model', 'PUT', { model: graph, expectedRevision: 0 })).status, 409);
  assert.equal((await api('models', 'POST', { model, name: 'SQLite legacy target' })).status, 201);
  assert.deepEqual((await api('erd-models')).body, { models: [] });
  const created = await api('erd-models', 'POST', { name: 'People', model: erd });
  assert.equal(created.status, 201);
  assert.deepEqual((await api('erd-models/' + created.body.id)).body, created.body);
  const { revision, ...draft } = created.body.model;
  assert.equal(revision, 1);
  const exported = await api('erd-export', 'POST', { model: draft });
  assert.equal(exported.status, 200);
  assert.match(exported.body.content, /CREATE TABLE "people"/);
  assert.equal(await readFile(f.models, 'utf8'), 'not a directory');

  const db = new DatabaseSync(f.dbPath);
  try { db.exec('DROP TABLE named_graph_documents'); }
  finally { db.close(); }
  for (const endpoint of endpoints) {
    assert.deepEqual(await api(endpoint), { status: 500, body: { error: 'Unable to list SQLite graph storage.' } });
  }
  await f.stop();
  assert.throws(() => f.app('sqlite'), /not ready.*offline all-model importer/);
});

test('v1 upgrade preserves the authoritative rows, ignores retained named files, and replaces the old fence atomically', async t => {
  const f = await fixture(t);
  const document = '  ' + JSON.stringify({ ...emptyModel(), name: 'Saved in v1', revision: 11, nodes: [node] }, null, 2) + '\r\n';
  const legacy = JSON.stringify({ ...reference(a), revision: 6 });
  const er = JSON.stringify({ ...erd, name: 'ERD in v1', revision: 8 });
  const files = [[f.file(a), 'stale and invalid named backup'], [f.file(b), JSON.stringify({ ...emptyModel(), name: 'Deleted in v1', revision: 1 })],
    [f.modelPath, legacy], [f.file('erd-' + a), er]] as const;
  for (const [path, content] of files) await writeFile(path, content);
  const db = new DatabaseSync(f.dbPath);
  const v1Tables = ['named_graph_cutover', 'named_graph_documents'];
  try {
    // Exact schema emitted by the old importer.
    db.exec(`PRAGMA journal_mode = DELETE;
    CREATE TABLE named_graph_documents (
      id TEXT NOT NULL PRIMARY KEY,
      document TEXT NOT NULL CHECK (json_valid(document))
    ) STRICT;
    CREATE TABLE named_graph_cutover (
      version INTEGER PRIMARY KEY CHECK (version = 1)
    ) STRICT;
    INSERT INTO named_graph_cutover VALUES (1);`);
    const insert = db.prepare('INSERT INTO named_graph_documents VALUES (?, ?)');
    insert.run(a, document);
    assert.throws(() => f.app('sqlite'), /not ready.*offline all-model importer/);
    assert.throws(() => f.app('file'), /offline all-model cutover/);
    const before = await readFile(f.dbPath);
    const dry = f.run('--dry-run');
    assert.equal(dry.status, 0, dry.stderr);
    assert.equal(dry.report.source, 'named-v1');
    assert.deepEqual(dry.report.eligibleIds, { named: [], legacy: ['legacy'], erds: [a] });
    assert.deepEqual(await readFile(f.dbPath), before);
    insert.run(b, '{}');
    assert.match(f.run('--dry-run').stderr, /named-only v1 document is invalid/);
    assert.match(f.run('--apply').stderr, /named-only v1 document is invalid/);
    assert.deepEqual(f.ready(), v1Tables);
    db.prepare('DELETE FROM named_graph_documents WHERE id = ?').run(b);

    const row = { id: a, document: er };
    assert.throws(() => importModelDocuments(db, 'named-v1', { named: [], legacy: { id: 'legacy', document: legacy }, erds: [row, row] }), /UNIQUE/);
    assert.deepEqual(f.ready(), v1Tables);
    assert.equal(db.prepare('SELECT version FROM named_graph_cutover').get()?.version, 1);
    assert.equal(db.prepare('SELECT document FROM named_graph_documents WHERE id = ?').get(a)?.document, document);
  } finally { db.close(); }

  await writeFile(f.file('erd-' + a), '{}');
  const before = await readFile(f.dbPath);
  const invalidEr = f.run('--apply');
  assert.equal(invalidEr.status, 1);
  assert.deepEqual(invalidEr.report.failedIds.erds, [a]);
  assert.deepEqual(await readFile(f.dbPath), before);
  assert.deepEqual(f.ready(), v1Tables);
  await writeFile(f.file('erd-' + a), er);

  const applied = f.run('--apply');
  assert.equal(applied.status, 0, applied.stderr);
  const result = new DatabaseSync(f.dbPath, { readOnly: true });
  try {
    assert.equal(result.prepare('SELECT version FROM named_graph_cutover').get()?.version, 2);
    // These are the exact old v1 runtime gates.
    assert.ok(result.prepare("SELECT 1 FROM sqlite_schema WHERE name COLLATE NOCASE = 'named_graph_cutover'").get());
    assert.equal(result.prepare('SELECT 1 FROM named_graph_cutover WHERE version = 1').get(), undefined);
    const rows = result.prepare('SELECT id, CAST(document AS BLOB) AS bytes FROM named_graph_documents').all();
    assert.deepEqual(rows.map(row => row.id), [a]);
    assert.deepEqual(Buffer.from(rows[0]!.bytes as Uint8Array), Buffer.from(document));
  } finally { result.close(); }
  for (const [path, content] of files) assert.equal(await readFile(path, 'utf8'), content);
  assert.match(f.run('--dry-run').stderr, /cannot be repeated/);
  const api = await f.serve('sqlite');
  assert.equal((await api('models/' + b)).status, 404);
  assert.equal((await api('models/' + a)).body.model.revision, 11);
  assert.equal((await api('model')).body.model.revision, 6);
  assert.equal((await api('erd-models/' + a)).body.model.revision, 8);
});
