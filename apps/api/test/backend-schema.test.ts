import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { request as httpRequest } from 'node:http';
import { createApp } from '../src/server.ts';
import { openStore, type BackendSchemaResponse } from '../src/store.ts';

async function fixture(t: TestContext, extraSchema = false) {
  const directory = await mkdtemp(join(tmpdir(), 'backend-schema-test-'));
  const dbPath = join(directory, 'test.sqlite');
  const modelPath = join(directory, 'model.json');
  const store = openStore(dbPath);
  const project = store.createProject('PRIVATE PROJECT SENTINEL');
  store.createTask({ projectId: project.id, title: 'PRIVATE TASK SENTINEL', description: 'PRIVATE DESCRIPTION SENTINEL' });
  store.close();
  await writeFile(modelPath, 'PRIVATE GRAPH SENTINEL');
  await writeFile(join(directory, 'erd-00000000-0000-4000-8000-000000000000.json'), 'PRIVATE ERD SENTINEL');
  const db = new DatabaseSync(dbPath);
  if (extraSchema) db.exec(`CREATE TABLE "quoted""table" ("quoted""column" INTEGER NOT NULL DEFAULT 7 CHECK ("quoted""column" > 0));
    CREATE UNIQUE INDEX "quoted""index" ON "quoted""table" ("quoted""column") WHERE "quoted""column" > 1;
    CREATE INDEX "quoted""expr" ON "quoted""table" (lower("quoted""column")) WHERE "quoted""column" > 2;`);
  const server = createApp({ dbPath, modelPath, webRoot: directory });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    const closed = once(server, 'close');
    server.close(); server.closeAllConnections(); await closed;
    db.close(); await rm(directory, { recursive: true, force: true });
  });
  async function bytes() {
    return Promise.all((await readdir(directory)).sort().map(async name => [name, await readFile(join(directory, name))]));
  }
  return { db, directory, base, bytes, get: () => fetch(base + '/api/backend-schema') };
}

test('backend schema matches live SQLite metadata, exact DDL, defaults, keys and indexes', async t => {
  const f = await fixture(t);
  const response = await f.get();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  const data = await response.json() as BackendSchemaResponse;
  assert.deepEqual(Object.keys(data).sort(), ['jsonStorage', 'sqlite']);
  assert.equal(data.sqlite.userVersion, f.db.prepare('PRAGMA user_version').get()!.user_version);
  assert.equal(data.sqlite.userVersion, 2);
  assert.deepEqual(data.sqlite.tables.map(table => table.name), ['projects', 'tasks']);
  for (const table of data.sqlite.tables) {
    assert.equal(table.ddl, f.db.prepare('SELECT sql FROM sqlite_schema WHERE name = ?').get(table.name)!.sql);
    assert.deepEqual(table.columns, f.db.prepare(`PRAGMA table_info("${table.name}")`).all().map(c => ({
      position: c.cid, name: c.name, declaredType: c.type, notNull: Boolean(c.notnull), defaultSql: c.dflt_value, primaryKeyPosition: c.pk,
    })));
    assert.deepEqual(table.foreignKeys, f.db.prepare(`PRAGMA foreign_key_list("${table.name}")`).all().map(k => ({
      id: k.id, sequence: k.seq, table: k.table, from: k.from, to: k.to, onUpdate: k.on_update, onDelete: k.on_delete, match: k.match,
    })));
    const indexes = f.db.prepare(`PRAGMA index_list("${table.name}")`).all();
    assert.equal(table.indexes.length, indexes.length);
    for (const index of table.indexes) {
      const pragma = indexes.find(i => i.name === index.name)!;
      assert.equal(index.unique, Boolean(pragma.unique));
      assert.equal(index.origin, pragma.origin);
      assert.equal(index.partial, Boolean(pragma.partial));
      assert.equal(index.ddl, f.db.prepare('SELECT sql FROM sqlite_schema WHERE name = ?').get(index.name)!.sql);
      assert.deepEqual(index.columns, f.db.prepare(`PRAGMA index_info("${index.name}")`).all().map(c => ({ sequence: c.seqno, position: c.cid, name: c.name })));
    }
    assert.equal(table.columns[0]!.notNull, false);
    assert.equal(table.columns[0]!.primaryKeyPosition, 1);
    assert.equal(table.indexes.find(i => i.origin === 'pk')!.ddl, null);
  }
  const tasks = data.sqlite.tables[1]!;
  assert.deepEqual(tasks.columns.map(c => c.name), ['id', 'projectId', 'title', 'description', 'priority', 'dueDate', 'status', 'createdAt', 'updatedAt', 'dueTime']);
  assert.deepEqual(tasks.columns.at(-1), { position: 9, name: 'dueTime', declaredType: 'TEXT', notNull: false, defaultSql: null, primaryKeyPosition: 0 });
  assert.equal(tasks.columns.find(c => c.name === 'description')!.defaultSql, "''");
  assert.equal(tasks.columns.find(c => c.name === 'priority')!.defaultSql, "'medium'");
  assert.equal(tasks.columns.find(c => c.name === 'status')!.defaultSql, "'backlog'");
  assert.equal(tasks.foreignKeys[0]!.onDelete, 'CASCADE');
  assert.match(tasks.ddl!, /CHECK \(priority IN/);
  assert.match(tasks.ddl!, /dueTime TEXT CHECK/);
  assert.deepEqual(data.jsonStorage.map(s => [s.name, s.schemaVersion]), [['Graph model', 3], ['PostgreSQL ERD', 1]]);
});

test('schema reads are GET-only, guarded, content-redacted and do not mutate persistence', async t => {
  const f = await fixture(t);
  const before = await f.bytes();
  const initial = await (await f.get()).text();
  assert.doesNotMatch(initial, /PRIVATE|SENTINEL|test\.sqlite|model\.json|rowCount|rows|dbPath|modelPath/);
  assert.ok(!initial.includes(f.directory));
  for (const query of ['?sql=DROP%20TABLE%20projects', '?table=tasks%22);DROP%20TABLE%20projects;--']) {
    assert.equal(await (await fetch(f.base + '/api/backend-schema' + query)).text(), initial);
  }
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
    const response = await fetch(f.base + '/api/backend-schema', { method });
    assert.equal(response.status, 404, method);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  const hostStatus = await new Promise<number>((resolve, reject) => {
    const request = httpRequest(f.base + '/api/backend-schema', { headers: { Host: 'evil.example' } }, response => {
      response.resume(); response.on('end', () => resolve(response.statusCode!));
    });
    request.on('error', reject); request.end();
  });
  assert.equal(hostStatus, 403);
  assert.equal((await fetch(f.base + '/api/backend-schema', { method: 'POST', headers: { Origin: 'http://evil.example' } })).status, 403);
  assert.equal((await fetch(f.base + '/api/backend-schema', { method: 'DELETE', headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  // Existing protection permits cross-origin GETs, but never untrusted Hosts.
  assert.equal((await fetch(f.base + '/api/backend-schema', { headers: { Origin: 'http://evil.example' } })).status, 200);
  assert.deepEqual(await f.bytes(), before);
  assert.equal(f.db.prepare('SELECT name FROM projects').get()!.name, 'PRIVATE PROJECT SENTINEL');
});

test('schema introspection reflects added metadata and safely quotes schema-sourced identifiers', async t => {
  const f = await fixture(t, true);
  const before = await f.bytes();
  const data = await (await f.get()).json() as BackendSchemaResponse;
  const table = data.sqlite.tables.find(table => table.name === 'quoted"table')!;
  assert.ok(table);
  assert.deepEqual(table.columns, [{ position: 0, name: 'quoted"column', declaredType: 'INTEGER', notNull: true, defaultSql: '7', primaryKeyPosition: 0 }]);
  assert.equal(table.ddl, f.db.prepare('SELECT sql FROM sqlite_schema WHERE name = ?').get(table.name)!.sql);
  assert.equal(table.indexes.length, 2);
  const partial = table.indexes.find(index => index.name === 'quoted"index')!;
  assert.equal(partial.unique, true);
  assert.equal(partial.origin, 'c');
  assert.equal(partial.partial, true);
  assert.equal(partial.ddl, f.db.prepare('SELECT sql FROM sqlite_schema WHERE name = ?').get('quoted"index')!.sql);
  assert.deepEqual(partial.columns, [{ sequence: 0, position: 0, name: 'quoted"column' }]);
  const expression = table.indexes.find(index => index.name === 'quoted"expr')!;
  assert.equal(expression.unique, false);
  assert.equal(expression.origin, 'c');
  assert.equal(expression.partial, true);
  assert.equal(expression.ddl, f.db.prepare('SELECT sql FROM sqlite_schema WHERE name = ?').get('quoted"expr')!.sql);
  assert.deepEqual(expression.columns, f.db.prepare(`PRAGMA index_info("quoted""expr")`).all().map(c => ({ sequence: c.seqno, position: c.cid, name: c.name })));
  assert.equal(expression.columns[0]!.name, null);
  assert.ok(expression.columns[0]!.position < 0);
  assert.deepEqual(await f.bytes(), before);
});
