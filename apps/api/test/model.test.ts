import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { createApp } from '../src/server.ts';
import { openModelStore, openNamedModelStore } from '../src/model-store.ts';

const empty = { schemaVersion: 2, nodes: [], relationships: [] };
const relationship = (id: string, name: string, source: string, target: string) => ({
  id, name, source, target, sourceCardinality: '0..*', targetCardinality: '0..*',
});
const graph = {
  schemaVersion: 2,
  nodes: [
    { kind: 'definition', id: 'node-1', name: 'Person', x: 60, y: 60, classification: 'Transactional', draft: false, properties: [] },
    { kind: 'definition', id: 'node-2', name: 'Company', x: 240, y: 60, classification: 'Master Data', draft: true, properties: [] },
  ],
  relationships: [
    relationship('relationship-1', 'WORKS_FOR', 'node-1', 'node-2'),
    relationship('relationship-2', 'WORKS_FOR', 'node-2', 'node-1'),
    relationship('relationship-3', 'KNOWS', 'node-1', 'node-2'),
    relationship('relationship-4', 'KNOWS', 'node-1', 'node-1'),
  ],
};

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'backlog-model-test-'));
  const modelPath = join(directory, 'models', 'model.json');
  const servers: ReturnType<typeof createApp>[] = [];
  async function app() {
    const server = createApp({ dbPath: join(directory, `db-${servers.length}.sqlite`), modelPath, webRoot: directory });
    servers.push(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    return `http://127.0.0.1:${address.port}`;
  }
  async function close() {
    for (const server of servers) {
      if (!server.listening) continue;
      const closed = once(server, 'close');
      server.close();
      server.closeAllConnections();
      await closed;
    }
  }
  t.after(async () => { await close(); await rm(directory, { recursive: true, force: true }); });
  const base = await app();
  const put = (model: unknown, expectedRevision: unknown = 0, target = base) => fetch(target + '/api/model', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision, model }),
  });
  return { directory, modelPath, base, app, close, put };
}

test('model GET is read-only; save roundtrips schema, self/reverse/parallel relationships and restart', async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await (await fetch(f.base + '/api/model')).json(), { model: { ...empty, revision: 0 } });
  await assert.rejects(readFile(f.modelPath), { code: 'ENOENT' });
  assert.ok(!(await readdir(f.directory)).includes('models'));
  const saved = await f.put(graph);
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { model: { ...graph, revision: 1 } });
  assert.deepEqual(JSON.parse(await readFile(f.modelPath, 'utf8')), { ...graph, revision: 1 });
  assert.deepEqual(await readdir(join(f.directory, 'models')), ['model.json']);
  await f.close();
  const restarted = await f.app();
  assert.deepEqual(await (await fetch(restarted + '/api/model')).json(), { model: { ...graph, revision: 1 } });
  assert.equal((await f.put(empty, 1, restarted)).status, 200);
  assert.deepEqual(await (await fetch(restarted + '/api/model')).json(), { model: { ...empty, revision: 2 } });
});

test('all classifications and draft flags survive save, rename/move and restart', async (t) => {
  const f = await fixture(t);
  const nodes = ['Transactional', 'Master Data', 'Reference Data', 'Metadata'].flatMap((classification, i) =>
    [false, true].map((draft, j) => ({
      kind: 'definition', id: `node-${i * 2 + j}`, name: `Node${String.fromCharCode(65 + i * 2 + j)}`,
      x: 60 + (i * 2 + j) * 200, y: 60, classification, draft, properties: [],
    })));
  const model = { ...empty, nodes };
  const saved = await f.put(model);
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { model: { ...model, revision: 1 } });
  assert.deepEqual(JSON.parse(await readFile(f.modelPath, 'utf8')), { ...model, revision: 1 });
  await f.close();
  const restarted = await f.app();
  assert.deepEqual(await (await fetch(restarted + '/api/model')).json(), { model: { ...model, revision: 1 } });
  const moved = { ...model, nodes: nodes.map(node => ({ ...node, name: node.name + 'Renamed', y: 260 })) };
  const renamed = await f.put(moved, 1, restarted);
  assert.equal(renamed.status, 200);
  assert.deepEqual(await renamed.json(), { model: { ...moved, revision: 2 } });
  await f.close();
  const reopened = await f.app();
  assert.deepEqual(await (await fetch(reopened + '/api/model')).json(), { model: { ...moved, revision: 2 } });
});

test('legacy metadata omissions default independently on GET and PUT without read-time migration', async (t) => {
  const f = await fixture(t);
  const base = { id: 'node-1', name: 'Person', x: 60, y: 60 };
  const cases = [
    { input: base, expected: { ...base, classification: 'Transactional', draft: false, properties: [] } },
    { input: { ...base, draft: true }, expected: { ...base, classification: 'Transactional', draft: true, properties: [] } },
    { input: { ...base, classification: 'Reference Data' }, expected: { ...base, classification: 'Reference Data', draft: false, properties: [] } },
  ];
  await mkdir(join(f.directory, 'models'));
  for (const { input, expected } of cases) {
    const legacy = { ...empty, schemaVersion: 1, nodes: [input] };
    const normalized = { ...empty, nodes: [{ ...expected, kind: 'definition' }] };
    const content = JSON.stringify({ ...legacy, revision: 7 }, null, 4) + '\n';
    await writeFile(f.modelPath, content);
    const before = await stat(f.modelPath);
    const loaded = await fetch(f.base + '/api/model');
    assert.equal(loaded.status, 200);
    assert.deepEqual(await loaded.json(), { model: { ...normalized, revision: 7 } });
    assert.equal(await readFile(f.modelPath, 'utf8'), content);
    const after = await stat(f.modelPath);
    assert.equal(after.mtimeMs, before.mtimeMs);
    assert.equal(after.ino, before.ino);
    assert.equal((await f.put(legacy, 6)).status, 409);
    assert.equal(await readFile(f.modelPath, 'utf8'), content);
    const saved = await f.put(legacy, 7);
    assert.equal(saved.status, 200);
    assert.deepEqual(await saved.json(), { model: { ...normalized, revision: 8 } });
    assert.deepEqual(JSON.parse(await readFile(f.modelPath, 'utf8')), { ...normalized, revision: 8 });
  }
});

test('invalid supplied metadata rejects requests and stored files without changing bytes or revisions', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.put(graph)).status, 200);
  const bytes = await readFile(f.modelPath);
  const invalid = [
    ...['transactional', 'MasterData', 'Reference', 'Metadata ', '', null, 0, true, [], {}].map(classification => ({ classification })),
    ...['false', 'true', '', null, 0, 1, [], {}].map(draft => ({ draft })),
    { classification: 'Metadata', draft: true, extra: true },
  ];
  for (const metadata of invalid) {
    const model = { ...graph, nodes: [{ ...graph.nodes[0], ...metadata }], relationships: [] };
    const response = await f.put(model, 1);
    assert.equal(response.status, 400, JSON.stringify(metadata));
    assert.equal(typeof (await response.json()).error, 'string');
    assert.deepEqual(await readFile(f.modelPath), bytes);
    assert.deepEqual(await (await fetch(f.base + '/api/model')).json(), { model: { ...graph, revision: 1 } });
    const corrupt = JSON.stringify({ ...model, revision: 1 });
    await writeFile(f.modelPath, corrupt);
    for (const result of [await fetch(f.base + '/api/model'), await f.put(graph, 1)]) {
      assert.equal(result.status, 500);
      assert.match((await result.json()).error, /invalid or unsupported/);
    }
    assert.equal(await readFile(f.modelPath, 'utf8'), corrupt);
    await writeFile(f.modelPath, bytes);
  }
});

test('invalid model and revision inputs leave exact saved bytes unchanged', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.put(graph)).status, 200);
  const bytes = await readFile(f.modelPath);
  const node = graph.nodes[0]!;
  const relationship = graph.relationships[0]!;
  const invalidNodes = [
    null, {}, { ...node, extra: true }, { ...node, id: 'node--1' }, { ...node, id: 'node-9007199254740992' },
    { ...node, id: 'node-1.0' }, { ...node, id: 'relationship-1' },
    { ...node, id: 'node-1\n' },
    ...['person', 'Person Name', 'Éclair', 'Person1', 'Person\n', '', 'A'.repeat(25)].map(name => ({ ...node, name })),
    ...[0, 40, 61, 100020, null, '60', 1e100].map(x => ({ ...node, x })),
    { ...node, y: 61 },
  ];
  const invalidModels: unknown[] = [
    null, [], {}, { ...empty, schemaVersion: 3 }, { ...empty, revision: 1 }, { ...empty, extra: true },
    { ...empty, nodes: null }, { ...empty, relationships: null },
    ...invalidNodes.map(node => ({ ...empty, nodes: [node] })),
    { ...graph, nodes: [node, node] },
    { ...graph, nodes: [node, { ...graph.nodes[1], name: node.name }] },
    { ...empty, nodes: [node, { ...graph.nodes[1], x: 220 }] },
    { ...empty, nodes: [node, { ...graph.nodes[1], x: 180, y: 180 }] },
    { ...graph, relationships: [relationship, relationship] },
    { ...graph, relationships: [relationship, { ...relationship, id: 'relationship-99' }] },
    ...[
      { ...relationship, id: 'relationship-9007199254740992' }, { ...relationship, id: 'edge-1' },
      { ...relationship, name: 'Works_For' }, { ...relationship, name: 'WORKS__FOR' },
      { ...relationship, name: '_WORKS' }, { ...relationship, name: 'WORKS_' },
      { ...relationship, name: 'KNOWS\n' }, { ...relationship, id: 'relationship-1\n' },
      { ...relationship, name: 'A'.repeat(25) }, { ...relationship, source: 'node-3' },
      { ...relationship, target: 'node-3' }, { ...relationship, extra: true }, null,
    ].map(relationship => ({ ...graph, relationships: [relationship] })),
    { ...empty, nodes: Array(201).fill(node) },
    { ...graph, relationships: Array(1001).fill(relationship) },
  ];
  for (const model of invalidModels) {
    const response = await f.put(model, 1);
    assert.equal(response.status, 400, JSON.stringify(model));
    assert.equal(typeof (await response.json()).error, 'string');
    assert.deepEqual(await readFile(f.modelPath), bytes);
  }
  for (const expected of [-1, 0.1, null, '1', Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal((await f.put(graph, expected)).status, 400);
  }
  for (const payload of [{ model: empty }, { expectedRevision: 1 }, { expectedRevision: 1, model: empty, extra: 1 }]) {
    assert.equal((await fetch(f.base + '/api/model', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })).status, 400);
  }
  assert.deepEqual(await readFile(f.modelPath), bytes);
});

test('atomic saves keep new files private and preserve existing regular-file permission bits', { skip: process.platform === 'win32' }, async (t) => {
  const f = await fixture(t);
  assert.equal((await f.put(empty)).status, 200);
  assert.equal((await stat(f.modelPath)).mode & 0o777, 0o600);
  for (const [index, mode] of [0o660, 0o640, 0o600].entries()) {
    await chmod(f.modelPath, mode);
    assert.equal((await f.put(graph, index + 1)).status, 200);
    assert.equal((await stat(f.modelPath)).mode & 0o777, mode);
    assert.equal(JSON.parse(await readFile(f.modelPath, 'utf8')).revision, index + 2);
    assert.deepEqual(await readdir(join(f.directory, 'models')), ['model.json']);
  }
});

test('legacy routes reject symlinks, dangling symlinks, directories and FIFOs without following or hanging', { skip: process.platform === 'win32' }, async (t) => {
  const f = await fixture(t);
  const target = join(f.directory, 'target.json');
  const content = JSON.stringify({ ...empty, revision: 1 });
  await writeFile(target, content);
  await mkdir(join(f.directory, 'models'));
  for (const kind of ['symlink', 'dangling', 'directory', 'fifo']) {
    if (kind === 'symlink' || kind === 'dangling') await symlink(kind === 'symlink' ? target : join(f.directory, 'missing.json'), f.modelPath);
    if (kind === 'directory') await mkdir(f.modelPath);
    if (kind === 'fifo') execFileSync('mkfifo', [f.modelPath]);
    const before = await lstat(f.modelPath);
    for (const route of ['/api/model', '/api/models/legacy']) {
      const response = await fetch(f.base + route, { signal: AbortSignal.timeout(2000) });
      assert.equal(response.status, 500, `${kind}: ${route}`);
      assert.match((await response.json()).error, /read the model file/);
    }
    assert.equal((await f.put(graph, 1)).status, 500, kind);
    assert.equal(await readFile(target, 'utf8'), content);
    const after = await lstat(f.modelPath);
    assert.equal(after.ino, before.ino);
    assert.equal(after.mode, before.mode);
    assert.equal(after.mtimeMs, before.mtimeMs);
    assert.deepEqual(await readdir(join(f.directory, 'models')), ['model.json']);
    await rm(f.modelPath, { recursive: kind === 'directory' });
  }
  for (const route of ['/api/model', '/api/models/legacy']) {
    assert.deepEqual((await (await fetch(f.base + route)).json()).model, { ...empty, revision: 0 });
  }
  await assert.rejects(lstat(f.modelPath), { code: 'ENOENT' });
});

test('safe ID suffix, coordinate, name and collection boundaries are accepted', async (t) => {
  const f = await fixture(t);
  const nodes = Array.from({ length: 200 }, (_, i) => ({
    id: `node-${i}`, name: `N${String.fromCharCode(65 + Math.floor(i / 26))}${String.fromCharCode(65 + i % 26)}`, x: 60 + i * 200, y: 100000,
  }));
  nodes[0] = { id: `node-${Number.MAX_SAFE_INTEGER}`, name: 'A'.repeat(24), x: 100000, y: 60 };
  const relationships = Array.from({ length: 1000 }, (_, i) => ({
    id: `relationship-${i}`, name: 'A'.repeat(24), source: nodes[Math.floor(i / 200)]!.id, target: nodes[i % 200]!.id,
  }));
  relationships[0]!.id = `relationship-${Number.MAX_SAFE_INTEGER}`;
  assert.equal((await f.put({ schemaVersion: 1, nodes, relationships })).status, 200);
  // Direct-store probes cover non-finite numbers that JSON itself cannot represent.
  for (const x of [NaN, Infinity, -Infinity]) {
    await assert.rejects(openModelStore(f.modelPath).save({ expectedRevision: 1, model: { ...empty, nodes: [{ ...nodes[0], x }] } }), { status: 400 });
  }
});

test('fresh disk reads, stale revisions and simultaneous app instances never lose a save', async (t) => {
  const f = await fixture(t);
  const second = await f.app();
  const responses = await Promise.all(Array.from({ length: 12 }, (_, i) => f.put(i % 2 ? graph : empty, 0, i % 2 ? second : f.base)));
  assert.equal(responses.filter(r => r.status === 200).length, 1);
  assert.equal(responses.filter(r => r.status === 409).length, 11);
  const bytes = await readFile(f.modelPath);
  assert.equal((await f.put(graph, 0)).status, 409);
  assert.deepEqual(await readFile(f.modelPath), bytes);
  await writeFile(f.modelPath, JSON.stringify({ ...graph, revision: 12 }));
  assert.deepEqual(await (await fetch(f.base + '/api/model')).json(), { model: { ...graph, revision: 12 } });
  assert.equal((await f.put(empty, 1)).status, 409);
  assert.equal((await f.put(empty, 12, second)).status, 200);
  assert.equal(JSON.parse(await readFile(f.modelPath, 'utf8')).revision, 13);
});

test('corrupt and unsupported disk data never resets or overwrites; errors redact content', async (t) => {
  const f = await fixture(t);
  await mkdir(join(f.directory, 'models'));
  const corrupt = [
    '{private-secret', 'null', JSON.stringify({ ...empty, revision: -1 }), JSON.stringify({ ...empty, revision: 1.5 }),
    JSON.stringify({ ...empty, revision: 0, schemaVersion: 3 }), JSON.stringify({ ...empty, revision: 0, secret: 'private-secret' }),
    JSON.stringify(empty), JSON.stringify({ ...graph, revision: 0, nodes: [{ ...graph.nodes[0], extra: true }] }),
  ];
  for (const content of corrupt) {
    await writeFile(f.modelPath, content);
    for (const response of [await fetch(f.base + '/api/model'), await f.put(empty)]) {
      assert.equal(response.status, 500);
      const { error } = await response.json();
      assert.match(error, /invalid or unsupported/);
      assert.ok(!error.includes('private-secret'));
    }
    assert.equal(await readFile(f.modelPath, 'utf8'), content);
  }
  await writeFile(f.modelPath, JSON.stringify({ ...empty, revision: Number.MAX_SAFE_INTEGER }));
  assert.equal((await f.put(empty, Number.MAX_SAFE_INTEGER)).status, 500);
  assert.equal(JSON.parse(await readFile(f.modelPath, 'utf8')).revision, Number.MAX_SAFE_INTEGER);
});

test('read and write failures are meaningful, preserve existing data, clean temporary files and recover', async (t) => {
  const f = await fixture(t);
  await mkdir(f.modelPath, { recursive: true });
  const readFailure = await fetch(f.base + '/api/model');
  assert.equal(readFailure.status, 500);
  assert.match((await readFailure.json()).error, /read the model file/);
  assert.equal((await f.put(empty)).status, 500);
  await rm(join(f.directory, 'models'), { recursive: true });
  await writeFile(join(f.directory, 'models'), 'preserve this blocking file');
  const writeFailure = await f.put(empty);
  assert.equal(writeFailure.status, 500);
  assert.match((await writeFailure.json()).error, /read the model file/);
  assert.equal(await readFile(join(f.directory, 'models'), 'utf8'), 'preserve this blocking file');
  await rm(join(f.directory, 'models'));
  assert.equal((await f.put(empty)).status, 200);
  if (process.platform !== 'win32' && process.getuid?.() !== 0) {
    const bytes = await readFile(f.modelPath);
    await chmod(f.modelPath, 0o000);
    try {
      assert.equal((await fetch(f.base + '/api/model')).status, 500);
      assert.equal((await f.put(graph, 1)).status, 500);
    } finally { await chmod(f.modelPath, 0o600); }
    assert.deepEqual(await readFile(f.modelPath), bytes);
    await chmod(join(f.directory, 'models'), 0o500);
    try {
      const failed = await f.put(graph, 1);
      assert.equal(failed.status, 500);
      assert.match((await failed.json()).error, /save the model file/);
      assert.deepEqual(await readFile(f.modelPath), bytes);
    } finally { await chmod(join(f.directory, 'models'), 0o700); }
    assert.equal((await f.put(graph, 1)).status, 200);
  } else t.diagnostic('Directory permission write-failure probe requires a non-root Unix user.');
  assert.deepEqual(await readdir(join(f.directory, 'models')), ['model.json']);
});

test('model inherits host/origin/media guards and only its body limit increases to 512 KiB', async (t) => {
  const f = await fixture(t);
  for (const headers of [{ Origin: 'https://example.com' }, { Origin: 'null' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    assert.equal((await fetch(f.base + '/api/model', {
      method: 'PUT', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ expectedRevision: 0, model: graph }),
    })).status, 403);
  }
  for (const method of ['GET', 'PUT']) {
    const status = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(f.base + '/api/model', { method, headers: { Host: 'attacker.example' } }, response => {
        response.resume(); response.on('end', () => resolve(response.statusCode!));
      });
      request.on('error', reject); request.end();
    });
    assert.equal(status, 403);
  }
  for (const [content, type] of [['{broken', 'application/json'], ['{}', 'text/plain'], ['{}', '']]) {
    assert.equal((await fetch(f.base + '/api/model', { method: 'PUT', headers: { 'Content-Type': type! }, body: content })).status, 400);
  }
  const payload = JSON.stringify({ expectedRevision: 0, model: graph });
  const exact = await fetch(f.base + '/api/model', {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Origin: f.base }, body: payload.padEnd(512 * 1024, ' '),
  });
  assert.equal(exact.status, 200);
  const bytes = await readFile(f.modelPath);
  assert.equal((await fetch(f.base + '/api/model', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: payload.padEnd(512 * 1024 + 1, ' ') })).status, 400);
  assert.equal((await fetch(f.base + '/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Fine' }).padEnd(32769, ' ') })).status, 400);
  assert.deepEqual(await readFile(f.modelPath), bytes);
});

const uuidA = '11111111-1111-4111-8111-111111111111';
const uuidB = '22222222-2222-4222-8222-222222222222';
const namedRequest = (base: string, method: string, payload: unknown, id = '') => fetch(base + '/api/models' + (id ? '/' + id : ''), {
  method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
});

const reference = (modelId = 'legacy', nodeId = 'node-1', internal = true) => ({
  kind: 'reference', id: 'node-3', name: 'Alias', x: 440, y: 60,
  classification: internal ? 'Internal Reference' : 'External Reference', target: { modelId, nodeId },
});

test('mixed references roundtrip singleton and named; POST rebases all internals and preserves externals', async t => {
  const f = await fixture(t);
  const target = await (await namedRequest(f.base, 'POST', { name: 'Target', model: graph })).json();
  const internal = reference();
  const external = { ...reference(target.id, 'node-2', false), id: 'node-4', name: 'Remote', x: 640 };
  const secondInternal = { ...reference(uuidB, 'node-2'), id: 'node-5', name: 'Second', x: 840 };
  const mixed = { ...graph, nodes: [...graph.nodes, internal, external], relationships: [
    ...graph.relationships, relationship('relationship-5', 'LINKS', internal.id, external.id),
  ] };
  assert.equal((await f.put(mixed)).status, 200);
  assert.deepEqual((await (await fetch(f.base + '/api/model')).json()).model, { ...mixed, revision: 1 });
  const copy = await (await namedRequest(f.base, 'POST', { name: 'Copy', model: { ...mixed, nodes: [...mixed.nodes, secondInternal] } })).json();
  const expected = { ...mixed, nodes: [...graph.nodes, { ...internal, target: { ...internal.target, modelId: copy.id } }, external,
    { ...secondInternal, target: { ...secondInternal.target, modelId: copy.id } }] };
  assert.deepEqual(copy.model, { ...expected, revision: 1 });
  assert.equal((await namedRequest(f.base, 'PUT', { name: 'Copy renamed', expectedRevision: 1, model: expected }, copy.id)).status, 200);
  await f.close();
  const restarted = await f.app();
  assert.deepEqual((await (await fetch(restarted + '/api/models/' + copy.id)).json()).model, { ...expected, revision: 2 });
  // An external reference cannot target the newly allocated containing UUID.
  const store = openNamedModelStore(f.modelPath, { generateId: () => uuidA });
  await assert.rejects(store.create({ name: 'Invalid', model: { ...graph, nodes: [...graph.nodes, reference(uuidA, 'node-1', false)] } }), { status: 400 });
});

test('new reference variants, context, aliases, unavailable targets and chains reject with 400 without writes', async t => {
  const f = await fixture(t);
  assert.equal((await f.put(graph)).status, 200);
  const bytes = await readFile(f.modelPath);
  const valid = reference();
  const invalid = [
    { ...valid, draft: false }, { ...valid, properties: [] }, { ...valid, target: { ...valid.target, extra: true } },
    { ...valid, target: null }, { ...valid, target: { modelId: '../private', nodeId: 'node-1' } },
    { ...valid, target: { modelId: uuidA.toUpperCase(), nodeId: 'node-1' } },
    { ...valid, target: { modelId: 'legacy', nodeId: 'node-9007199254740992' } },
    reference(uuidA), reference('legacy', 'node-1', false), reference(uuidA, 'node-1', false),
    reference('legacy', 'node-99'), reference('legacy', 'node-3'),
    { ...valid, name: 'Person' }, { ...valid, classification: 'Metadata' }, { ...valid, kind: 'other' },
  ];
  for (const node of invalid) {
    assert.equal((await f.put({ ...graph, nodes: [...graph.nodes, node] }, 1)).status, 400, JSON.stringify(node));
    assert.deepEqual(await readFile(f.modelPath), bytes);
  }
  const { kind: _kind, ...withoutKind } = graph.nodes[0]!;
  for (const model of [
    { ...graph, nodes: [withoutKind], relationships: [] },
    { ...graph, nodes: [{ ...graph.nodes[0], target: valid.target }], relationships: [] },
    { ...graph, schemaVersion: 1, nodes: [...graph.nodes, valid] },
  ]) assert.equal((await f.put(model, 1)).status, 400);
  for (const field of ['kind', 'classification', 'draft', 'properties']) {
    const node: Record<string, unknown> = { ...graph.nodes[0] };
    delete node[field];
    assert.equal((await f.put({ ...empty, nodes: [node] }, 1)).status, 400, field);
  }
  const chainTarget = await (await namedRequest(f.base, 'POST', { name: 'Chain', model: { ...graph, nodes: [...graph.nodes, valid] } })).json();
  assert.equal((await f.put({ ...graph, nodes: [...graph.nodes, reference(chainTarget.id, 'node-3', false)] }, 1)).status, 400);
});

test('internal validation uses submitted unsaved graph and retains removed or replaced definition targets', async t => {
  const f = await fixture(t);
  const model = { ...graph, nodes: [...graph.nodes, reference()] };
  assert.equal((await f.put(model)).status, 200);
  const removed = { ...empty, nodes: [{ ...reference(), name: 'Unresolved' }] };
  assert.equal((await f.put(removed, 1)).status, 200);
  assert.deepEqual((await (await fetch(f.base + '/api/model')).json()).model, { ...removed, revision: 2 });
  assert.equal((await f.put({ ...removed, nodes: [{ ...removed.nodes[0], id: 'node-4' }] }, 2)).status, 400);
  assert.equal((await f.put({ ...removed, nodes: [{ ...removed.nodes[0], target: { modelId: 'legacy', nodeId: 'node-2' } }] }, 2)).status, 400);
  assert.equal((await f.put({ ...empty, nodes: [graph.nodes[0]!, reference()] }, 2)).status, 200);
  // A new internal reference cannot resolve through a definition only on disk.
  assert.equal((await f.put({ ...empty, nodes: [{ ...reference(), id: 'node-4' }] }, 3)).status, 400);
  // Replacing a retained target with a reference keeps the old reference unresolved.
  const replacement = { ...reference(), id: 'node-1', name: 'Replacement', x: 60, target: { modelId: 'legacy', nodeId: 'node-2' } };
  const replaced = { ...empty, nodes: [replacement, graph.nodes[1]!, reference()] };
  assert.equal((await f.put(replaced, 3)).status, 200);
  assert.deepEqual((await (await fetch(f.base + '/api/model')).json()).model, { ...replaced, revision: 4 });
});

test('external target loss, corruption or replacement by reference never blocks unchanged source read/save/delete', async t => {
  const f = await fixture(t);
  const target = await (await namedRequest(f.base, 'POST', { name: 'Target', model: graph })).json();
  const model = { ...graph, nodes: [...graph.nodes, reference(target.id, 'node-1', false)] };
  const source = await (await namedRequest(f.base, 'POST', { name: 'Source', model })).json();
  const targetPath = join(f.directory, 'models', target.id + '.json');
  const sourcePath = join(f.directory, 'models', source.id + '.json');
  let revision = 1;
  for (const state of ['corrupt', 'reference', 'missing']) {
    if (state === 'corrupt') await writeFile(targetPath, '{private-secret');
    if (state === 'reference') await writeFile(targetPath, JSON.stringify({ ...empty, name: 'Target', revision: 1,
      nodes: [{ ...reference(target.id, 'node-99'), id: 'node-1' }] }));
    if (state === 'missing') assert.equal((await namedRequest(f.base, 'DELETE', { expectedRevision: 1 }, target.id)).status, 204);
    const before = await readFile(sourcePath);
    assert.deepEqual((await (await fetch(f.base + '/api/models/' + source.id)).json()).model, { ...model, revision });
    const list = (await (await fetch(f.base + '/api/models')).json()).models;
    assert.equal(list.find((entry: { id: string }) => entry.id === source.id).available, true);
    assert.deepEqual(await readFile(sourcePath), before);
    assert.equal((await namedRequest(f.base, 'PUT', { name: 'Source', expectedRevision: revision++, model }, source.id)).status, 200);
    const changed = { ...model, nodes: [...graph.nodes, reference(target.id, 'node-99', false)] };
    assert.equal((await namedRequest(f.base, 'PUT', { name: 'Source', expectedRevision: revision, model: changed }, source.id)).status, 400);
  }
  assert.equal((await namedRequest(f.base, 'DELETE', { expectedRevision: revision }, source.id)).status, 204);
});

test('definition discovery is physical-only, redacted, fresh, definition-only and read-only with safe filenames', async t => {
  const f = await fixture(t);
  const catalog = async () => {
    const response = await fetch(f.base + '/api/model-node-definitions');
    assert.equal(response.status, 200);
    return response.json();
  };
  assert.deepEqual(await catalog(), { models: [] });
  assert.ok(!(await readdir(f.directory)).includes('models'));
  const target = await (await namedRequest(f.base, 'POST', { name: 'Target', model: graph })).json();
  const source = await (await namedRequest(f.base, 'POST', { name: 'Source', model: {
    ...graph, nodes: [...graph.nodes, reference(target.id, 'node-1', false)],
  } })).json();
  const directory = join(f.directory, 'models');
  const sourcePath = join(directory, source.id + '.json');
  const sourceBytes = await readFile(sourcePath);
  await writeFile(join(directory, uuidA + '.json'), '{private-secret');
  await writeFile(f.modelPath, '{legacy-private-secret');
  const outside = join(f.directory, 'outside.json');
  await writeFile(outside, 'outside-private-secret');
  if (process.platform !== 'win32') await symlink(outside, join(directory, uuidB + '.json'));
  await writeFile(join(directory, 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA.json'), 'unsupported');
  await writeFile(join(directory, '44444444-4444-4444-8444-444444444444.JSON'), 'unsupported');
  const paths = (await readdir(directory)).map(file => join(directory, file));
  const before = await Promise.all(paths.map(async path => ({ path, bytes: await readFile(path), info: await lstat(path) })));
  const result = await catalog();
  assert.equal(JSON.stringify(result).includes('private-secret'), false);
  assert.equal(result.models.length, 4);
  for (const id of ['legacy', uuidA]) {
    const entry = result.models.find((entry: { id: string }) => entry.id === id);
    assert.deepEqual(Object.keys(entry).sort(), ['available', 'error', 'id', 'name']);
    assert.equal(entry.available, false);
  }
  const definitions = graph.nodes.map(({ id, name, classification, draft, properties }) => ({ id, name, classification, draft, properties }));
  assert.deepEqual(result.models.find((entry: { id: string }) => entry.id === source.id), {
    id: source.id, name: 'Source', available: true, revision: 1, definitions,
  });
  for (const { path, bytes, info } of before) {
    assert.deepEqual(await readFile(path), bytes);
    const after = await lstat(path);
    assert.equal(after.ino, info.ino);
    assert.equal(after.mtimeMs, info.mtimeMs);
  }
  const renamed = { ...graph, nodes: graph.nodes.map(node => ({ ...node, name: node.name + 'Renamed' })) };
  assert.equal((await namedRequest(f.base, 'PUT', { name: 'Latest', expectedRevision: 1, model: renamed }, target.id)).status, 200);
  const latest = (await catalog()).models.find((entry: { id: string }) => entry.id === target.id);
  assert.equal(latest.revision, 2);
  assert.equal(latest.definitions[0].name, 'PersonRenamed');
  assert.deepEqual(await readFile(sourcePath), sourceBytes);
  assert.equal(await readFile(outside, 'utf8'), 'outside-private-secret');
  await writeFile(join(directory, target.id + '.json'), '{now-corrupt');
  assert.equal((await catalog()).models.find((entry: { id: string }) => entry.id === target.id).available, false);
});

const property = {
  name: 'identifier', dataType: 'arbitrary custom type [] | 模型', description: '  First line\nSecond\tline\r\n😀  ',
  nodeKey: false, uniqueness: false, mustExist: false, index: 'None',
};

for (const named of [false, true]) {
  const route = named ? 'named' : 'legacy';
  async function propertyTarget(f: Awaited<ReturnType<typeof fixture>>) {
    if (!named) {
      assert.equal((await f.put(graph)).status, 200);
      return {
        path: f.modelPath,
        get: (base = f.base) => fetch(base + '/api/model'),
        save: (model: unknown, revision = 1, base = f.base) => f.put(model, revision, base),
        stored: (model: unknown, revision: number) => ({ ...model as object, revision }),
      };
    }
    const response = await namedRequest(f.base, 'POST', { name: 'Properties', model: graph });
    assert.equal(response.status, 201);
    const created = await response.json();
    return {
      path: join(f.directory, 'models', created.id + '.json'),
      get: (base = f.base) => fetch(base + '/api/models/' + created.id),
      save: (model: unknown, revision = 1, base = f.base) => namedRequest(base, 'PUT', {
        name: 'Properties renamed', expectedRevision: revision, model,
      }, created.id),
      stored: (model: unknown, revision: number) => ({ ...model as object, revision, name: 'Properties' }),
    };
  }

  test(`${route} all nine cardinality pairs preserve loops, reverse links and reference endpoints across restart`, async t => {
    const f = await fixture(t);
    const target = await propertyTarget(f);
    const remoteResponse = await namedRequest(f.base, 'POST', { name: 'Remote', model: graph });
    assert.equal(remoteResponse.status, 201);
    const remote = await remoteResponse.json();
    const containingId = named ? basename(target.path, '.json') : 'legacy';
    const internal = reference(containingId);
    const external = { ...reference(remote.id, 'node-2', false), id: 'node-4', name: 'Remote', x: 640 };
    const ends = ['0..*', '1..*', '1..1'];
    const relationships = ends.flatMap((sourceCardinality, i) => ends.map((targetCardinality, j) => ({
      ...relationship(`relationship-${i * 3 + j}`, `LINK_${String.fromCharCode(65 + i * 3 + j)}`,
        j === 1 ? external.id : internal.id, j === 0 ? internal.id : j === 1 ? internal.id : external.id),
      sourceCardinality, targetCardinality,
    })));
    const model = { ...graph, nodes: [...graph.nodes, internal, external], relationships };
    const saved = await target.save(model);
    assert.equal(saved.status, 200);
    assert.deepEqual((await saved.json()).model, { ...model, revision: 2 });
    assert.deepEqual(JSON.parse(await readFile(target.path, 'utf8')), {
      ...target.stored(model, 2), ...(named ? { name: 'Properties renamed' } : {}),
    });
    if (named) {
      const created = await namedRequest(f.base, 'POST', { name: 'Cardinality copy', model });
      assert.equal(created.status, 201);
      const copy = await created.json();
      assert.deepEqual(copy.model, { ...model, revision: 1, nodes: [...graph.nodes,
        { ...internal, target: { ...internal.target, modelId: copy.id } }, external] });
    }
    await f.close();
    const restarted = await f.app();
    assert.deepEqual((await (await target.get(restarted)).json()).model, { ...model, revision: 2 });
    const before = await readFile(target.path);
    // Cardinalities do not distinguish duplicate directed named connections or IDs.
    for (const duplicate of [
      { ...relationships[0], id: 'relationship-99', sourceCardinality: '1..1', targetCardinality: '1..1' },
      { ...relationships[0], name: 'OTHER' },
    ]) {
      assert.equal((await target.save({ ...model, relationships: [...relationships, duplicate] }, 2, restarted)).status, 400);
      assert.deepEqual(await readFile(target.path), before);
    }
    // Unavailable targets do not block retained local relationships or annotation edits.
    assert.equal((await namedRequest(restarted, 'DELETE', { expectedRevision: 1 }, remote.id)).status, 204);
    const edited = { ...model, relationships: relationships.map(edge => ({ ...edge, sourceCardinality: '1..1' })) };
    const resaved = await target.save(edited, 2, restarted);
    assert.equal(resaved.status, 200);
    assert.deepEqual((await resaved.json()).model, { ...edited, revision: 3 });
    await f.close();
    const reopened = await f.app();
    assert.deepEqual((await (await target.get(reopened)).json()).model, { ...edited, revision: 3 });
  });

  test(`${route} schema 1/2 missing cardinalities default independently without read-time writes`, async t => {
    const f = await fixture(t);
    const target = await propertyTarget(f);
    for (const schemaVersion of [1, 2]) {
      for (let mask = 0; mask < 4; mask++) {
        const edge = { id: 'relationship-1', name: 'KNOWS', source: 'node-1', target: 'node-1',
          ...(mask & 1 ? { sourceCardinality: '1..1' } : {}),
          ...(mask & 2 ? { targetCardinality: '1..*' } : {}),
        };
        const model = { ...graph, schemaVersion, relationships: [edge] };
        const normalized = { ...model, schemaVersion: 2, relationships: [{ ...edge,
          sourceCardinality: mask & 1 ? '1..1' : '0..*', targetCardinality: mask & 2 ? '1..*' : '0..*' }] };
        const bytes = JSON.stringify(target.stored(model, 7), null, 4) + '\n';
        await writeFile(target.path, bytes);
        const before = await stat(target.path);
        await f.close();
        const restarted = await f.app();
        assert.deepEqual((await (await target.get(restarted)).json()).model, { ...normalized, revision: 7 });
        if (!named) assert.deepEqual((await (await fetch(restarted + '/api/models/legacy')).json()).model, { ...normalized, revision: 7 });
        for (const route of ['/api/models', '/api/model-node-definitions']) {
          const response = await fetch(restarted + route);
          assert.equal(response.status, 200);
          assert.ok((await response.json()).models.every((entry: { available: boolean }) => entry.available));
        }
        assert.equal(await readFile(target.path, 'utf8'), bytes);
        const after = await stat(target.path);
        assert.equal(after.ino, before.ino);
        assert.equal(after.mtimeMs, before.mtimeMs);
        assert.equal((await target.save(model, 6, restarted)).status, 409);
        assert.equal(await readFile(target.path, 'utf8'), bytes);
        if (named) {
          const response = await namedRequest(restarted, 'POST', { name: 'Legacy copy', model });
          assert.equal(response.status, 201);
          assert.deepEqual((await response.json()).model, { ...normalized, revision: 1 });
        }
        const saved = await target.save(model, 7, restarted);
        assert.equal(saved.status, 200);
        assert.deepEqual((await saved.json()).model, { ...normalized, revision: 8 });
        assert.deepEqual(JSON.parse(await readFile(target.path, 'utf8')), {
          ...target.stored(normalized, 8), ...(named ? { name: 'Properties renamed' } : {}),
        });
      }
    }
  });

  test(`${route} invalid cardinalities reject schema 1/2 requests and storage without byte/revision changes`, async t => {
    const f = await fixture(t);
    const target = await propertyTarget(f);
    const bytes = await readFile(target.path);
    const invalid = [null, true, false, 0, 1, [], {}, '', '0..1', '*', 'many', '0..* ', ' 1..1', '1..1\n', '1..2', '0..∞'];
    for (const schemaVersion of [1, 2]) {
      const patches = [
        ...['sourceCardinality', 'targetCardinality'].flatMap(field => invalid.map(value => ({ [field]: value }))),
        { cardinality: '1..1' }, { sourceCardinalty: '1..1' },
      ];
      for (const patch of patches) {
        const model = { ...graph, schemaVersion, relationships: [{ ...graph.relationships[0], ...patch }] };
        const response = await target.save(model);
        assert.equal(response.status, 400, JSON.stringify(patch));
        assert.equal(typeof (await response.json()).error, 'string');
        if (named) assert.equal((await namedRequest(f.base, 'POST', { name: 'Invalid', model })).status, 400);
        assert.deepEqual(await readFile(target.path), bytes);
        assert.deepEqual((await (await target.get()).json()).model, { ...graph, revision: 1 });
        const corrupt = JSON.stringify(target.stored(model, 1));
        await writeFile(target.path, corrupt);
        for (const result of [await target.get(), await target.save(graph)]) {
          assert.equal(result.status, 500);
          assert.match((await result.json()).error, /invalid or unsupported/);
        }
        for (const route of ['/api/models', '/api/model-node-definitions']) {
          const { models } = await (await fetch(f.base + route)).json();
          assert.equal(models.find((entry: { id: string }) => entry.id === (named ? basename(target.path, '.json') : 'legacy')).available, false);
        }
        assert.equal(await readFile(target.path, 'utf8'), corrupt);
        await writeFile(target.path, bytes);
      }
    }
    // Explicit undefined is invalid too, even though JSON cannot encode it.
    for (const field of ['sourceCardinality', 'targetCardinality']) {
      const model = { ...graph, relationships: [{ ...graph.relationships[0], [field]: undefined }] };
      const operation = named
        ? openNamedModelStore(f.modelPath).save(basename(target.path, '.json'), { name: 'Invalid', expectedRevision: 1, model })
        : openModelStore(f.modelPath).save({ expectedRevision: 1, model });
      await assert.rejects(operation, { status: 400 });
      assert.deepEqual(await readFile(target.path), bytes);
    }
  });

  test(`${route} properties normalize legacy boolean index flags, free text and Unicode limits across rename/move/restart`, async (t) => {
    const f = await fixture(t);
    const target = await propertyTarget(f);
    const properties = Array.from({ length: 100 }, (_, i) => ({
      ...property, name: `  Property ${i}  `,
      nodeKey: !!(i & 1), uniqueness: !!(i & 2), mustExist: !!(i & 4), index: !!(i & 8),
    }));
    properties[0] = { ...properties[0]!, name: '  ' + '😀'.repeat(100) + '  ',
      dataType: '  ' + '😀'.repeat(100) + '  ', description: '😀'.repeat(2000) };
    properties[1]!.name = 'Case';
    properties[2]!.name = 'case';
    // A property name can be reused on a different node; no flag implies another.
    const model = { ...graph, schemaVersion: 1, nodes: graph.nodes.map(node => ({ ...node, properties })) };
    const normalized = { ...model, schemaVersion: 2, nodes: model.nodes.map(node => ({ ...node,
      properties: node.properties.map(p => ({ ...p, name: p.name.trim(), dataType: p.dataType.trim(), index: p.index ? 'Range' : 'None' })),
    })) };
    if (named) {
      const created = await namedRequest(f.base, 'POST', { name: 'Property copy', model });
      assert.equal(created.status, 201);
      const copy = await created.json();
      assert.deepEqual(copy.model, { ...normalized, revision: 1 });
      assert.deepEqual(JSON.parse(await readFile(join(f.directory, 'models', copy.id + '.json'), 'utf8')).nodes, normalized.nodes);
      await assert.rejects(readFile(f.modelPath), { code: 'ENOENT' });
    }
    const saved = await target.save(model);
    assert.equal(saved.status, 200);
    assert.deepEqual((await saved.json()).model, { ...normalized, revision: 2 });
    assert.deepEqual(JSON.parse(await readFile(target.path, 'utf8')).nodes, normalized.nodes);
    await f.close();
    const restarted = await f.app();
    assert.deepEqual((await (await target.get(restarted)).json()).model, { ...normalized, revision: 2 });
    const moved = { ...normalized, nodes: normalized.nodes.map(node => ({ ...node, name: node.name + 'Renamed', y: 260 })) };
    const updated = await target.save(moved, 2, restarted);
    assert.equal(updated.status, 200);
    const result = await updated.json();
    assert.deepEqual(result.model, { ...moved, revision: 3 });
    if (named) assert.equal(result.name, 'Properties renamed');
    await f.close();
    const reopened = await f.app();
    assert.deepEqual((await (await target.get(reopened)).json()).model, { ...moved, revision: 3 });
    assert.deepEqual(JSON.parse(await readFile(target.path, 'utf8')).nodes, moved.nodes);
  });

  test(`${route} all four canonical indexes roundtrip independently of every boolean flag combination`, async (t) => {
    const f = await fixture(t);
    const target = await propertyTarget(f);
    const properties = ['None', 'Range', 'Text', 'Point'].flatMap(index =>
      Array.from({ length: 8 }, (_, mask) => ({ ...property, name: `${index} ${mask}`, index,
        nodeKey: !!(mask & 1), uniqueness: !!(mask & 2), mustExist: !!(mask & 4) })));
    const model = { ...empty, nodes: [{ ...graph.nodes[0], properties }] };
    if (named) {
      const response = await namedRequest(f.base, 'POST', { name: 'Index copy', model });
      assert.equal(response.status, 201);
      const copy = await response.json();
      assert.deepEqual(copy.model, { ...model, revision: 1 });
      assert.deepEqual(JSON.parse(await readFile(join(f.directory, 'models', copy.id + '.json'), 'utf8')).nodes, model.nodes);
    }
    const response = await target.save(model);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).model, { ...model, revision: 2 });
    assert.deepEqual(JSON.parse(await readFile(target.path, 'utf8')).nodes, model.nodes);
    await f.close();
    const restarted = await f.app();
    assert.deepEqual((await (await target.get(restarted)).json()).model, { ...model, revision: 2 });
    const resaved = await target.save(model, 2, restarted);
    assert.equal(resaved.status, 200);
    assert.deepEqual((await resaved.json()).model, { ...model, revision: 3 });
    assert.deepEqual(JSON.parse(await readFile(target.path, 'utf8')), {
      ...target.stored(model, 3), ...(named ? { name: 'Properties renamed' } : {}),
    });
  });

  test(`${route} legacy true/false indexes normalize after restart without GET/list writes; next save is canonical`, async (t) => {
    const f = await fixture(t);
    const target = await propertyTarget(f);
    const properties = [true, false].map((index, i) => ({ ...property, name: `Legacy ${i}`, index,
      nodeKey: index, uniqueness: !index, mustExist: index }));
    const model = { ...empty, schemaVersion: 1, nodes: [{ ...graph.nodes[0], properties }] };
    const normalized = { ...model, schemaVersion: 2, nodes: model.nodes.map(node => ({ ...node,
      properties: node.properties.map(p => ({ ...p, index: p.index ? 'Range' : 'None' })),
    })) };
    const bytes = JSON.stringify(target.stored(model, 7), null, 4) + '\n';
    await writeFile(target.path, bytes);
    const before = await stat(target.path);
    await f.close();
    const restarted = await f.app();
    const loaded = await target.get(restarted);
    assert.equal(loaded.status, 200);
    assert.deepEqual((await loaded.json()).model, { ...normalized, revision: 7 });
    if (!named) {
      assert.deepEqual((await (await fetch(restarted + '/api/models/legacy')).json()).model, { ...normalized, revision: 7 });
    }
    const listing = await fetch(restarted + '/api/models');
    assert.equal(listing.status, 200);
    assert.ok((await listing.json()).models.every((entry: { available: boolean }) => entry.available));
    assert.equal(await readFile(target.path, 'utf8'), bytes);
    const after = await stat(target.path);
    assert.equal(after.ino, before.ino);
    assert.equal(after.mtimeMs, before.mtimeMs);
    assert.equal((await target.save(model, 6, restarted)).status, 409);
    assert.equal(await readFile(target.path, 'utf8'), bytes);
    const saved = await target.save(model, 7, restarted);
    assert.equal(saved.status, 200);
    assert.deepEqual((await saved.json()).model, { ...normalized, revision: 8 });
    assert.deepEqual(JSON.parse(await readFile(target.path, 'utf8')), {
      ...target.stored(normalized, 8), ...(named ? { name: 'Properties renamed' } : {}),
    });
    await f.close();
    const reopened = await f.app();
    assert.deepEqual((await (await target.get(reopened)).json()).model, { ...normalized, revision: 8 });
  });

  test(`${route} schema-2 boolean indexes reject input and stored files without byte/revision changes`, async t => {
    const f = await fixture(t);
    const target = await propertyTarget(f);
    const bytes = await readFile(target.path);
    for (const index of [true, false]) {
      const model = { ...empty, nodes: [{ ...graph.nodes[0], properties: [{ ...property, index }] }] };
      assert.equal((await target.save(model)).status, 400);
      if (named) assert.equal((await namedRequest(f.base, 'POST', { name: 'Invalid', model })).status, 400);
      assert.deepEqual(await readFile(target.path), bytes);
      assert.deepEqual((await (await target.get()).json()).model, { ...graph, revision: 1 });
      const corrupt = JSON.stringify(target.stored(model, 1));
      await writeFile(target.path, corrupt);
      for (const response of [await target.get(), await target.save(graph)]) {
        assert.equal(response.status, 500);
        assert.match((await response.json()).error, /invalid or unsupported/);
      }
      for (const route of ['/api/models', '/api/model-node-definitions']) {
        const { models } = await (await fetch(f.base + route)).json();
        assert.equal(models.find((entry: { id: string }) => entry.id === (named ? basename(target.path, '.json') : 'legacy')).available, false);
      }
      assert.equal(await readFile(target.path, 'utf8'), corrupt);
      await writeFile(target.path, bytes);
    }
  });

  test(`${route} missing schema-1 properties and metadata normalize without GET/list writes; next PUT persists schema 2`, async (t) => {
    const f = await fixture(t);
    const target = await propertyTarget(f);
    for (let mask = 0; mask < 8; mask++) {
      const node = { id: 'node-1', name: 'Person', x: 60, y: 60,
        ...(mask & 1 ? { classification: 'Metadata' } : {}),
        ...(mask & 2 ? { draft: true } : {}),
        ...(mask & 4 ? { properties: [property] } : {}),
      };
      const model = { ...empty, schemaVersion: 1, nodes: [node] };
      const expected = { ...empty, nodes: [{ ...node, kind: 'definition', classification: mask & 1 ? 'Metadata' : 'Transactional',
        draft: !!(mask & 2), properties: mask & 4 ? [{ ...property, index: 'None' }] : [] }], revision: 7 };
      const bytes = JSON.stringify(target.stored(model, 7), null, 4) + '\n';
      await writeFile(target.path, bytes);
      const before = await stat(target.path);
      assert.deepEqual((await (await target.get()).json()).model, expected);
      if (!named) assert.deepEqual((await (await fetch(f.base + '/api/models/legacy')).json()).model, expected);
      const listing = await fetch(f.base + '/api/models');
      assert.equal(listing.status, 200);
      assert.ok((await listing.json()).models.every((entry: { available: boolean }) => entry.available));
      assert.equal(await readFile(target.path, 'utf8'), bytes);
      const after = await stat(target.path);
      assert.equal(after.ino, before.ino);
      assert.equal(after.mtimeMs, before.mtimeMs);
      assert.equal((await target.save(model, 6)).status, 409);
      assert.equal(await readFile(target.path, 'utf8'), bytes);
      const saved = await target.save(model, 7);
      assert.equal(saved.status, 200);
      assert.deepEqual((await saved.json()).model, { ...expected, revision: 8 });
      assert.equal(JSON.parse(await readFile(target.path, 'utf8')).schemaVersion, 2);
      assert.deepEqual(JSON.parse(await readFile(target.path, 'utf8')).nodes, expected.nodes);
    }
  });

  test(`${route} invalid properties reject strict fields, types, duplicates and limits without byte/revision changes`, async (t) => {
    const f = await fixture(t);
    const target = await propertyTarget(f);
    const bytes = await readFile(target.path);
    const fields = ['name', 'dataType', 'description', 'nodeKey', 'uniqueness', 'mustExist', 'index'] as const;
    const invalid: unknown[] = [null, {}, '', false, 0, [null], [[]], [{}], [{ ...property, extra: true }],
      [property, property], [property, { ...property, name: '  identifier  ' }],
      Array.from({ length: 101 }, (_, i) => ({ ...property, name: `Property ${i}` })),
    ];
    for (const field of fields) {
      const missing: Partial<typeof property> = { ...property };
      delete missing[field];
      invalid.push([missing]);
      const values = field === 'name' || field === 'dataType'
        ? [null, 1, false, [], {}, '', '   ', '😀'.repeat(101), 'a'.repeat(101),
          ...['\0', '\t', '\n', '\r', '\u001f', '\u007f', '\u0085', '\u009f'].map(control => ` ${control}Text `)]
        : field === 'description' ? [null, 0, false, [], {}, 'a\0b', '😀'.repeat(2001), 'a'.repeat(2001)]
          : field === 'index' ? [null, 0, 1, -1, '', 'false', 'true', 'range', 'Unknown', 'Range ', ' None', [], {}]
            : [null, 0, 1, '', 'false', 'true', 'Range', [], {}];
      for (const value of values) invalid.push([{ ...property, [field]: value }]);
    }
    for (const properties of invalid) {
      const model = { ...empty, nodes: [{ ...graph.nodes[0], properties }] };
      const response = await target.save(model);
      assert.equal(response.status, 400, JSON.stringify(properties));
      assert.equal(typeof (await response.json()).error, 'string');
      if (named) {
        assert.equal((await namedRequest(f.base, 'POST', { name: 'Invalid properties', model })).status, 400);
        assert.deepEqual(await readdir(join(f.directory, 'models')), [basename(target.path)]);
      }
      assert.deepEqual(await readFile(target.path), bytes);
      assert.deepEqual((await (await target.get()).json()).model, { ...graph, revision: 1 });
      const corrupt = JSON.stringify(target.stored(model, 1));
      await writeFile(target.path, corrupt);
      for (const result of [await target.get(), await target.save(graph)]) {
        assert.equal(result.status, 500);
        assert.match((await result.json()).error, /invalid or unsupported/);
      }
      const listing = (await (await fetch(f.base + '/api/models')).json()).models;
      assert.equal(listing.find((entry: { id: string }) => entry.id === (named ? basename(target.path, '.json') : 'legacy')).available, false);
      assert.equal(await readFile(target.path, 'utf8'), corrupt);
      await writeFile(target.path, bytes);
    }
  });
}

test('model lists omit missing legacy files without creating directories or changing existing files', async (t) => {
  const f = await fixture(t);
  const before = await readdir(f.directory);
  for (let i = 0; i < 2; i++) {
    const response = await fetch(f.base + '/api/models');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { models: [] });
  }
  assert.deepEqual(await readdir(f.directory), before);
  await assert.rejects(lstat(join(f.directory, 'models')), { code: 'ENOENT' });
  await mkdir(join(f.directory, 'models'));
  assert.deepEqual(await (await fetch(f.base + '/api/models')).json(), { models: [] });
  assert.deepEqual(await readdir(join(f.directory, 'models')), []);

  const createdResponse = await namedRequest(f.base, 'POST', { name: 'Default model', model: empty });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  assert.deepEqual(created, { id: created.id, name: 'Default model', model: { ...empty, revision: 1 } });
  const path = join(f.directory, 'models', created.id + '.json');
  const bytes = await readFile(path);
  assert.deepEqual(await (await fetch(f.base + '/api/models')).json(), {
    models: [{ id: created.id, name: 'Default model', revision: 1, available: true, deletable: true }],
  });
  assert.deepEqual(await (await fetch(f.base + '/api/models/' + created.id)).json(), created);
  assert.deepEqual(await readFile(path), bytes);
  assert.deepEqual(await readdir(join(f.directory, 'models')), [created.id + '.json']);
  await assert.rejects(lstat(f.modelPath), { code: 'ENOENT' });
});

test('physical legacy wrappers use the fixed Legacy model name without changing the singleton graph or bytes', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.put(graph)).status, 200);
  const bytes = await readFile(f.modelPath);
  const before = await stat(f.modelPath);
  assert.deepEqual(await (await fetch(f.base + '/api/models/legacy')).json(), {
    id: 'legacy', name: 'Legacy model', model: { ...graph, revision: 1 },
  });
  assert.deepEqual(await (await fetch(f.base + '/api/models')).json(), {
    models: [{ id: 'legacy', name: 'Legacy model', revision: 1, available: true, deletable: true }],
  });
  assert.deepEqual(await (await fetch(f.base + '/api/model')).json(), { model: { ...graph, revision: 1 } });
  assert.deepEqual(await readFile(f.modelPath), bytes);
  const after = await stat(f.modelPath);
  assert.equal(after.ino, before.ino);
  assert.equal(after.mtimeMs, before.mtimeMs);
});

test('physical legacy symlinks are unavailable without following or changing them or named siblings', { skip: process.platform === 'win32' }, async (t) => {
  const f = await fixture(t);
  const sibling = await (await namedRequest(f.base, 'POST', { name: 'Keep', model: graph })).json();
  const siblingPath = join(f.directory, 'models', sibling.id + '.json');
  const siblingBytes = await readFile(siblingPath);
  const outside = join(f.directory, 'outside.json');
  const bytes = JSON.stringify({ ...graph, revision: 7 });
  await writeFile(outside, bytes);
  for (const target of [outside, join(f.directory, 'missing.json')]) {
    await symlink(target, f.modelPath);
    const before = await lstat(f.modelPath);
    const response = await fetch(f.base + '/api/models');
    assert.equal(response.status, 200);
    const { models } = await response.json();
    assert.deepEqual(models.find((entry: { id: string }) => entry.id === sibling.id), {
      id: sibling.id, name: 'Keep', revision: 1, available: true, deletable: true,
    });
    const legacy = models.find((entry: { id: string }) => entry.id === 'legacy');
    assert.equal(models.length, 2);
    assert.equal(legacy.name, 'Legacy model');
    assert.equal(legacy.available, false);
    assert.equal(legacy.deletable, false);
    assert.equal(Object.hasOwn(legacy, 'revision'), false);
    assert.equal((await fetch(f.base + '/api/models/legacy')).status, 500);
    assert.deepEqual(await readFile(outside, 'utf8'), bytes);
    assert.deepEqual(await readFile(siblingPath), siblingBytes);
    const after = await lstat(f.modelPath);
    assert.ok(after.isSymbolicLink());
    assert.equal(after.ino, before.ino);
    assert.equal(after.mtimeMs, before.mtimeMs);
    await rm(f.modelPath);
  }
});

test('named models create separate graphs with duplicate Unicode names, reopen, rename and restart without legacy writes', async (t) => {
  const f = await fixture(t);
  const initial = { models: [] };
  assert.deepEqual(await (await fetch(f.base + '/api/models')).json(), initial);
  assert.deepEqual(await (await fetch(f.base + '/api/models/legacy')).json(), { id: 'legacy', name: 'Legacy model', model: { ...empty, revision: 0 } });
  assert.ok(!(await readdir(f.directory)).includes('models'));
  assert.equal((await f.put(graph)).status, 200);
  const legacyBytes = await readFile(f.modelPath);
  const firstResponse = await namedRequest(f.base, 'POST', { name: '  Équipe 模型 😀  ', model: graph });
  assert.equal(firstResponse.status, 201);
  const first = await firstResponse.json();
  assert.match(first.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.deepEqual(first, { id: first.id, name: 'Équipe 模型 😀', model: { ...graph, revision: 1 } });
  const secondResponse = await namedRequest(f.base, 'POST', { name: first.name, model: empty });
  assert.equal(secondResponse.status, 201);
  const second = await secondResponse.json();
  assert.notEqual(first.id, second.id);
  const firstPath = join(f.directory, 'models', `${first.id}.json`);
  assert.deepEqual(JSON.parse(await readFile(firstPath, 'utf8')), { ...graph, revision: 1, name: first.name });
  assert.equal((await stat(firstPath)).mode & 0o777, 0o600);
  const renamed = await namedRequest(f.base, 'PUT', { expectedRevision: 1, name: 'Renamed', model: graph }, first.id);
  assert.equal(renamed.status, 200);
  assert.deepEqual(await renamed.json(), { id: first.id, name: 'Renamed', model: { ...graph, revision: 2 } });
  await f.close();
  const restarted = await f.app();
  assert.deepEqual(await (await fetch(restarted + '/api/models/' + first.id)).json(), { id: first.id, name: 'Renamed', model: { ...graph, revision: 2 } });
  assert.deepEqual(await (await fetch(restarted + '/api/models/' + second.id)).json(), second);
  const expected = [
    { id: 'legacy', name: 'Legacy model', revision: 1, available: true, deletable: true },
    { id: first.id, name: 'Renamed', revision: 2, available: true, deletable: true },
    { id: second.id, name: second.name, revision: 1, available: true, deletable: true },
  ];
  assert.deepEqual(await (await fetch(restarted + '/api/models')).json(), { models: expected });
  assert.deepEqual(await readFile(f.modelPath), legacyBytes);
  assert.equal((await namedRequest(restarted, 'PUT', { expectedRevision: 1, name: 'Changed', model: empty }, 'legacy')).status, 404);
  assert.deepEqual(await readFile(f.modelPath), legacyBytes);
});

test('named name, envelope, graph and metadata validation is strict and non-mutating', async (t) => {
  const f = await fixture(t);
  const created = await (await namedRequest(f.base, 'POST', { name: 'Valid', model: graph })).json();
  const path = join(f.directory, 'models', `${created.id}.json`);
  const bytes = await readFile(path);
  for (const name of ['', '   ', null, 1, [], {}, 'a'.repeat(101), 'x\ny', '\tName', 'Name\u0000', 'Name\u007f', 'Name\u0085']) {
    assert.equal((await namedRequest(f.base, 'POST', { name, model: empty })).status, 400, JSON.stringify(name));
    assert.equal((await namedRequest(f.base, 'PUT', { expectedRevision: 1, name, model: graph }, created.id)).status, 400);
  }
  const invalidModels = [
    { ...empty, name: 'Nested' }, { ...empty, revision: 1 }, { ...empty, schemaVersion: 3 },
    ...[null, 'false', 0].map(draft => ({ ...empty, nodes: [{ ...graph.nodes[0], draft }] })),
    ...[null, 'metadata', 0].map(classification => ({ ...empty, nodes: [{ ...graph.nodes[0], classification }] })),
  ];
  for (const model of invalidModels) {
    assert.equal((await namedRequest(f.base, 'POST', { name: 'Valid', model })).status, 400);
    assert.equal((await namedRequest(f.base, 'PUT', { name: 'Valid', expectedRevision: 1, model }, created.id)).status, 400);
  }
  for (const payload of [{ model: empty }, { name: 'Valid' }, { name: 'Valid', model: empty, id: uuidA }, { name: 'Valid', model: empty, expectedRevision: 0 }]) {
    assert.equal((await namedRequest(f.base, 'POST', payload)).status, 400);
  }
  for (const payload of [{ name: 'Valid', model: empty }, { name: 'Valid', model: empty, expectedRevision: -1 }, { name: 'Valid', model: empty, expectedRevision: 1, extra: true }]) {
    assert.equal((await namedRequest(f.base, 'PUT', payload, created.id)).status, 400);
  }
  assert.deepEqual(await readFile(path), bytes);
  assert.deepEqual(await readdir(join(f.directory, 'models')), [`${created.id}.json`]);
  const boundary = await namedRequest(f.base, 'POST', { name: '😀'.repeat(100), model: { ...empty, schemaVersion: 1, nodes: [{ id: 'node-1', name: 'Person', x: 60, y: 60 }] } });
  assert.equal(boundary.status, 201);
  const result = await boundary.json();
  assert.deepEqual(result.model.nodes, [{ ...graph.nodes[0] }]);
});

test('named missing and unsafe IDs never auto-create; arbitrary JSON and nonregular entries are ignored', async (t) => {
  const f = await fixture(t);
  for (const id of [uuidA, '../private', '%2e%2e%2fprivate', '%00', '%0a', 'legacy%00', 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA', uuidA + '%0a', 'not-an-id']) {
    for (const response of [await fetch(f.base + '/api/models/' + id), await namedRequest(f.base, 'PUT', { expectedRevision: 0, name: 'Valid', model: empty }, id)]) {
      assert.ok(response.status === 400 || response.status === 404, `${id}: ${response.status}`);
    }
  }
  assert.ok(!(await readdir(f.directory)).includes('models'));
  await mkdir(join(f.directory, 'models'));
  const unsupported = ['arbitrary.json', 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA.json', '44444444-4444-4444-8444-444444444444.JSON', '33333333-3333-3333-8333-333333333333.json'];
  for (const file of unsupported) await writeFile(join(f.directory, 'models', file), 'private-secret');
  for (const id of ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '44444444-4444-4444-8444-444444444444']) {
    assert.equal((await fetch(f.base + '/api/models/' + id)).status, 404);
    assert.equal((await namedRequest(f.base, 'PUT', { expectedRevision: 0, name: 'Valid', model: empty }, id)).status, 404);
  }
  await mkdir(join(f.directory, 'models', uuidA + '.json'));
  if (process.platform !== 'win32') await symlink(f.modelPath, join(f.directory, 'models', uuidB + '.json'));
  assert.deepEqual(await (await fetch(f.base + '/api/models')).json(), { models: [] });
  assert.equal((await fetch(f.base + '/api/models/' + uuidA)).status, 500);
  if (process.platform !== 'win32') assert.equal((await fetch(f.base + '/api/models/' + uuidB)).status, 500);
  assert.equal((await namedRequest(f.base, 'POST', { name: 'New', model: empty })).status, 201);
  for (const file of unsupported) assert.equal(await readFile(join(f.directory, 'models', file), 'utf8'), 'private-secret');
});

test('named corrupt entries list independently with redacted fallback names and block overwrites', async (t) => {
  const f = await fixture(t);
  const sibling = await (await namedRequest(f.base, 'POST', { name: 'Keep', model: graph })).json();
  const siblingPath = join(f.directory, 'models', sibling.id + '.json');
  const siblingBytes = await readFile(siblingPath);
  const corrupt = [
    '{private-secret', JSON.stringify({ ...empty, name: 'private-secret', revision: -1 }),
    JSON.stringify({ ...empty, name: 'private-secret', revision: 1, id: uuidA }),
    JSON.stringify({ ...graph, name: 'private-secret', revision: 1, nodes: [{ ...graph.nodes[0], draft: null }] }),
    JSON.stringify({ ...empty, name: ' private-secret ', revision: 1 }),
  ];
  for (const content of corrupt) {
    await writeFile(join(f.directory, 'models', uuidA + '.json'), content);
    await writeFile(f.modelPath, '{legacy-private-secret');
    const listing = await fetch(f.base + '/api/models');
    assert.equal(listing.status, 200);
    const text = await listing.text();
    assert.ok(!text.includes('private-secret'));
    const entries = JSON.parse(text).models;
    assert.equal(entries.length, 3);
    assert.deepEqual(entries.find((entry: { id: string }) => entry.id === sibling.id), {
      id: sibling.id, name: 'Keep', revision: 1, available: true, deletable: true,
    });
    for (const entry of entries.filter((entry: { id: string }) => entry.id !== sibling.id)) {
      assert.equal(entry.available, false);
      assert.equal(entry.deletable, false);
      assert.equal(entry.name, entry.id === 'legacy' ? 'Legacy model' : entry.id);
      assert.equal(typeof entry.error, 'string');
      assert.equal(Object.hasOwn(entry, 'revision'), false);
    }
    for (const response of [await fetch(f.base + '/api/models/' + uuidA), await namedRequest(f.base, 'PUT', { name: 'New', model: empty, expectedRevision: 1 }, uuidA)]) {
      assert.equal(response.status, 500);
      assert.ok(!(await response.text()).includes('private-secret'));
    }
    assert.equal(await readFile(join(f.directory, 'models', uuidA + '.json'), 'utf8'), content);
    assert.equal(await readFile(f.modelPath, 'utf8'), '{legacy-private-secret');
    assert.deepEqual(await readFile(siblingPath), siblingBytes);
  }
});

test('named creates never clobber collisions, clean temps, and sort duplicate names by ID', async (t) => {
  const f = await fixture(t);
  const store = openNamedModelStore(f.modelPath, { generateId: () => uuidA });
  await store.create({ name: 'Same', model: graph });
  const path = join(f.directory, 'models', uuidA + '.json');
  const bytes = await readFile(path);
  await assert.rejects(store.create({ name: 'Other', model: empty }), { status: 500 });
  assert.deepEqual(await readFile(path), bytes);
  const ids = [uuidA, uuidB];
  const retry = openNamedModelStore(f.modelPath, { generateId: () => ids.shift()! });
  await retry.create({ name: 'Same', model: empty });
  assert.deepEqual((await retry.list()).map(entry => entry.id), [uuidA, uuidB]);
  assert.deepEqual((await readdir(join(f.directory, 'models'))).sort(), [uuidA + '.json', uuidB + '.json']);
  assert.deepEqual(await readFile(path), bytes);
});

test('named updates serialize revision checks across app instances, preserve modes, and recover from failures', async (t) => {
  const f = await fixture(t);
  const created = await (await namedRequest(f.base, 'POST', { name: 'Original', model: graph })).json();
  const path = join(f.directory, 'models', created.id + '.json');
  const second = await f.app();
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => namedRequest(i % 2 ? f.base : second, 'PUT', {
    expectedRevision: 1, name: `Name ${i}`, model: graph,
  }, created.id)));
  assert.equal(results.filter(result => result.status === 200).length, 1);
  assert.equal(results.filter(result => result.status === 409).length, 11);
  let bytes = await readFile(path);
  assert.equal((await namedRequest(f.base, 'PUT', { expectedRevision: 1, name: 'Stale', model: empty }, created.id)).status, 409);
  assert.deepEqual(await readFile(path), bytes);
  if (process.platform !== 'win32') {
    for (const [i, mode] of [0o660, 0o640, 0o600].entries()) {
      await chmod(path, mode);
      assert.equal((await namedRequest(f.base, 'PUT', { expectedRevision: 2 + i, name: 'Updated', model: empty }, created.id)).status, 200);
      assert.equal((await stat(path)).mode & 0o777, mode);
    }
    bytes = await readFile(path);
    if (process.getuid?.() !== 0) {
      await chmod(path, 0o000);
      try {
        const list = await (await fetch(f.base + '/api/models')).json();
        assert.equal(list.models.find((entry: { id: string }) => entry.id === created.id).available, false);
        assert.equal((await namedRequest(f.base, 'PUT', { expectedRevision: 5, name: 'Bad', model: empty }, created.id)).status, 500);
      } finally { await chmod(path, 0o600); }
      await chmod(join(f.directory, 'models'), 0o500);
      try {
        assert.equal((await namedRequest(f.base, 'POST', { name: 'Bad', model: empty })).status, 500);
        assert.equal((await namedRequest(f.base, 'PUT', { expectedRevision: 5, name: 'Bad', model: empty }, created.id)).status, 500);
      } finally { await chmod(join(f.directory, 'models'), 0o700); }
      assert.deepEqual(await readFile(path), bytes);
      assert.equal((await namedRequest(f.base, 'PUT', { expectedRevision: 5, name: 'Recovered', model: empty }, created.id)).status, 200);
    }
    await rm(path);
    const target = join(f.directory, 'target.json');
    await writeFile(target, bytes);
    await symlink(target, path);
    assert.equal((await namedRequest(f.base, 'PUT', { expectedRevision: 5, name: 'Bad', model: empty }, created.id)).status, 500);
    assert.deepEqual(await readFile(target), bytes);
  }
  assert.deepEqual(await readdir(join(f.directory, 'models')), [created.id + '.json']);
});

test('named routes retain host/origin/content-type protections and 512 KiB body limits', async (t) => {
  const f = await fixture(t);
  const payload = JSON.stringify({ name: 'Valid', model: graph });
  for (const headers of [{ Origin: 'https://example.com' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    assert.equal((await fetch(f.base + '/api/models', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: payload })).status, 403);
  }
  for (const [content, type] of [['{broken', 'application/json'], [payload, 'text/plain']]) {
    assert.equal((await fetch(f.base + '/api/models', { method: 'POST', headers: { 'Content-Type': type! }, body: content })).status, 400);
  }
  const response = await fetch(f.base + '/api/models', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: f.base }, body: payload.padEnd(512 * 1024, ' ') });
  assert.equal(response.status, 201);
  const entry = await response.json();
  const path = join(f.directory, 'models', entry.id + '.json');
  const bytes = await readFile(path);
  for (const [suffix, method, value] of [['', 'POST', payload], ['/' + entry.id, 'PUT', JSON.stringify({ name: 'Valid', model: empty, expectedRevision: 1 })]]) {
    assert.equal((await fetch(f.base + '/api/models' + suffix, { method, headers: { 'Content-Type': 'application/json' }, body: value!.padEnd(512 * 1024 + 1, ' ') })).status, 400);
  }
  assert.deepEqual(await readFile(path), bytes);
});

for (const legacy of [false, true]) {
  const label = legacy ? 'legacy' : 'UUID';
  async function deletionTarget(f: Awaited<ReturnType<typeof fixture>>) {
    if (legacy) {
      assert.equal((await f.put(graph)).status, 200);
      return { id: 'legacy', path: f.modelPath };
    }
    const created = await (await namedRequest(f.base, 'POST', { name: 'Same', model: graph })).json();
    return { id: created.id, path: join(f.directory, 'models', created.id + '.json') };
  }

  test(`${label} DELETE removes only the exact file, preserves siblings and SQLite, and survives restart`, async (t) => {
    const f = await fixture(t);
    const target = await deletionTarget(f);
    const sibling = await (await namedRequest(f.base, 'POST', { name: 'Same', model: graph })).json();
    if (!legacy) assert.equal((await f.put(graph)).status, 200);
    const projectResponse = await fetch(f.base + '/api/projects', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Keep' }),
    });
    const { project } = await projectResponse.json();
    const taskResponse = await fetch(f.base + '/api/tasks', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: project.id, title: 'Keep' }),
    });
    const { task } = await taskResponse.json();
    const preserved = [join(f.directory, 'models', sibling.id + '.json'), ...(legacy ? [] : [f.modelPath]),
      target.path + '.backup', target.path + '-prefix.json', join(f.directory, 'db-0.sqlite')];
    await writeFile(target.path + '.backup', 'backup');
    await writeFile(target.path + '-prefix.json', 'prefix');
    const before = await Promise.all(preserved.map(path => readFile(path)));
    const result = await namedRequest(f.base, 'DELETE', { expectedRevision: 1 }, target.id);
    assert.equal(result.status, 204);
    assert.equal(await result.text(), '');
    await assert.rejects(lstat(target.path), { code: 'ENOENT' });
    for (const [i, path] of preserved.entries()) assert.deepEqual(await readFile(path), before[i]);
    assert.deepEqual(await (await fetch(f.base + '/api/projects')).json(), { projects: [project] });
    assert.deepEqual(await (await fetch(f.base + '/api/tasks')).json(), { tasks: [task] });
    assert.equal((await namedRequest(f.base, 'DELETE', { expectedRevision: 1 }, target.id)).status, 404);
    await f.close();
    const restarted = await f.app();
    const listing = (await (await fetch(restarted + '/api/models')).json()).models;
    if (legacy) {
      assert.ok(!listing.some((entry: { id: string }) => entry.id === 'legacy'));
      assert.deepEqual((await (await fetch(restarted + '/api/models/legacy')).json()).model, { ...empty, revision: 0 });
      assert.deepEqual(await (await fetch(restarted + '/api/model')).json(), { model: { ...empty, revision: 0 } });
      await assert.rejects(lstat(target.path), { code: 'ENOENT' });
      assert.equal((await f.put(empty, 0, restarted)).status, 200);
    } else {
      assert.ok(!listing.some((entry: { id: string }) => entry.id === target.id));
      assert.equal((await fetch(restarted + '/api/models/' + target.id)).status, 404);
      assert.equal((await namedRequest(restarted, 'PUT', { expectedRevision: 0, name: 'Same', model: empty }, target.id)).status, 404);
      await assert.rejects(lstat(target.path), { code: 'ENOENT' });
    }
  });

  test(`${label} DELETE validates strict bodies and revision, host, origin and media before changing bytes`, async (t) => {
    const f = await fixture(t);
    const target = await deletionTarget(f);
    const bytes = await readFile(target.path);
    for (const payload of [null, [], {}, { revision: 1 }, { expectedRevision: 1, extra: true },
      ...[-1, 0.1, null, '1', true, {}, [], Number.MAX_SAFE_INTEGER + 1].map(expectedRevision => ({ expectedRevision }))]) {
      assert.equal((await namedRequest(f.base, 'DELETE', payload, target.id)).status, 400, JSON.stringify(payload));
    }
    for (const expectedRevision of [0, 2, Number.MAX_SAFE_INTEGER]) {
      assert.equal((await namedRequest(f.base, 'DELETE', { expectedRevision }, target.id)).status, 409);
    }
    for (const headers of [{ Origin: 'https://example.com' }, { Origin: 'null' }, { Origin: 'http://127.0.0.1:9999' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
      assert.equal((await fetch(f.base + '/api/models/' + target.id, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json', ...headers }, body: '{"expectedRevision":1}',
      })).status, 403);
    }
    const status = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(f.base + '/api/models/' + target.id, { method: 'DELETE', headers: { Host: 'attacker.example' } }, response => {
        response.resume(); response.on('end', () => resolve(response.statusCode!));
      });
      request.on('error', reject); request.end();
    });
    assert.equal(status, 403);
    for (const [body, type] of [['', 'application/json'], ['{broken', 'application/json'], ['{}', 'text/plain'], ['{}', ''],
      ['{"expectedRevision":1}'.padEnd(32769, ' '), 'application/json']]) {
      assert.equal((await fetch(f.base + '/api/models/' + target.id, {
        method: 'DELETE', headers: { 'Content-Type': type! }, body,
      })).status, 400);
    }
    assert.deepEqual(await readFile(target.path), bytes);
    assert.equal((await fetch(f.base + '/api/models/' + target.id, {
      method: 'DELETE', headers: { 'Content-Type': 'Application/JSON; charset=utf-8', Origin: f.base },
      body: '{"expectedRevision":1}'.padEnd(32768, ' '),
    })).status, 204);
  });

  test(`${label} DELETE refuses corrupt, unsupported, symlink, wrong-case and directory targets without purging`, async (t) => {
    const f = await fixture(t);
    const target = await deletionTarget(f);
    const bytes = await readFile(target.path);
    for (const content of ['{private-secret', 'null', JSON.stringify({ ...empty, revision: -1, ...(legacy ? {} : { name: 'Same' }) }),
      JSON.stringify({ ...empty, revision: 1, schemaVersion: 3, ...(legacy ? {} : { name: 'Same' }) })]) {
      await writeFile(target.path, content);
      const result = await namedRequest(f.base, 'DELETE', { expectedRevision: 1 }, target.id);
      assert.equal(result.status, 500);
      assert.ok(!(await result.text()).includes('private-secret'));
      assert.equal(await readFile(target.path, 'utf8'), content);
      const list = (await (await fetch(f.base + '/api/models')).json()).models;
      const summary = list.find((entry: { id: string }) => entry.id === target.id);
      assert.equal(summary.available, false);
      assert.equal(summary.deletable, false);
    }
    await writeFile(target.path, bytes);
    await rename(target.path, target.path + '.upper');
    await rename(target.path + '.upper', target.path.slice(0, -5) + '.JSON');
    assert.equal((await namedRequest(f.base, 'DELETE', { expectedRevision: 1 }, target.id)).status, 404);
    assert.deepEqual(await readFile(target.path.slice(0, -5) + '.JSON'), bytes);
    await rm(target.path.slice(0, -5) + '.JSON');
    await mkdir(target.path);
    await writeFile(join(target.path, 'keep'), 'nested');
    assert.equal((await namedRequest(f.base, 'DELETE', { expectedRevision: 1 }, target.id)).status, 500);
    assert.equal(await readFile(join(target.path, 'keep'), 'utf8'), 'nested');
    await rm(target.path, { recursive: true });
    if (process.platform !== 'win32') {
      const outside = join(f.directory, 'outside.json');
      await writeFile(outside, bytes);
      await symlink(outside, target.path);
      assert.equal((await namedRequest(f.base, 'DELETE', { expectedRevision: 1 }, target.id)).status, 500);
      assert.ok((await lstat(target.path)).isSymbolicLink());
      assert.deepEqual(await readFile(outside), bytes);
      const list = (await (await fetch(f.base + '/api/models')).json()).models;
      assert.ok(!list.some((entry: { id: string; deletable: boolean }) => entry.id === target.id && entry.deletable));
    }
  });

  test(`${label} DELETE permission failures preserve bytes and recover`, { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async (t) => {
    const f = await fixture(t);
    const target = await deletionTarget(f);
    const bytes = await readFile(target.path);
    await chmod(target.path, 0o000);
    try {
      assert.equal((await namedRequest(f.base, 'DELETE', { expectedRevision: 1 }, target.id)).status, 500);
      const list = (await (await fetch(f.base + '/api/models')).json()).models;
      assert.equal(list.find((entry: { id: string }) => entry.id === target.id).deletable, false);
    } finally { await chmod(target.path, 0o600); }
    await chmod(join(f.directory, 'models'), 0o500);
    try {
      assert.equal((await namedRequest(f.base, 'DELETE', { expectedRevision: 1 }, target.id)).status, 500);
      assert.deepEqual(await readFile(target.path), bytes);
    } finally { await chmod(join(f.directory, 'models'), 0o700); }
    assert.deepEqual(await readFile(target.path), bytes);
    assert.equal((await namedRequest(f.base, 'DELETE', { expectedRevision: 1 }, target.id)).status, 204);
  });

  test(`${label} PUT and DELETE share the per-path queue across store instances in either order`, async (t) => {
    const f = await fixture(t);
    const target = await deletionTarget(f);
    const deleting = openNamedModelStore(f.modelPath);
    const save = () => legacy ? openModelStore(f.modelPath).save({ expectedRevision: 1, model: empty })
      : openNamedModelStore(f.modelPath).save(target.id, { expectedRevision: 1, name: 'Updated', model: empty });
    let results = await Promise.allSettled([save(), deleting.delete(target.id, { expectedRevision: 1 })]);
    assert.equal(results[0]!.status, 'fulfilled');
    assert.equal(results[1]!.status, 'rejected');
    if (results[1]!.status === 'rejected') assert.equal(results[1]!.reason.status, 409);
    assert.equal(JSON.parse(await readFile(target.path, 'utf8')).revision, 2);
    results = await Promise.allSettled([deleting.delete(target.id, { expectedRevision: 2 }), save()]);
    assert.equal(results[0]!.status, 'fulfilled');
    assert.equal(results[1]!.status, 'rejected');
    if (results[1]!.status === 'rejected') assert.equal(results[1]!.reason.status, legacy ? 409 : 404);
    await assert.rejects(lstat(target.path), { code: 'ENOENT' });
  });

  test(`${label} simultaneous DELETE requests across app instances unlink once`, async (t) => {
    const f = await fixture(t);
    const target = await deletionTarget(f);
    const second = await f.app();
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) =>
      namedRequest(i % 2 ? f.base : second, 'DELETE', { expectedRevision: 1 }, target.id)));
    assert.equal(results.filter(result => result.status === 204).length, 1);
    assert.equal(results.filter(result => result.status === 404).length, 7);
    await assert.rejects(lstat(target.path), { code: 'ENOENT' });
  });
}

test('DELETE missing and unsafe IDs is read-only, including a UUID configured as the legacy filename', async (t) => {
  const f = await fixture(t);
  for (const id of ['legacy', uuidA, '../private', '%2e%2e%2fprivate', '%00', '%0a', 'legacy%00',
    'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA', uuidA + '%0a', 'not-an-id']) {
    const result = await namedRequest(f.base, 'DELETE', { expectedRevision: 0 }, id);
    assert.ok(result.status === 400 || result.status === 404, `${id}: ${result.status}`);
  }
  assert.ok(!(await readdir(f.directory)).includes('models'));
  const configured = join(f.directory, 'models', uuidA + '.json');
  await openModelStore(configured).save({ expectedRevision: 0, model: graph });
  const bytes = await readFile(configured);
  const store = openNamedModelStore(configured);
  await assert.rejects(store.delete(uuidA, { expectedRevision: 1 }), { status: 404 });
  assert.deepEqual(await readFile(configured), bytes);
  assert.deepEqual(await store.list(), [{ id: 'legacy', name: 'Legacy model', revision: 1, available: true, deletable: true }]);
  await store.delete('legacy', { expectedRevision: 1 });
  await assert.rejects(lstat(configured), { code: 'ENOENT' });
});
