import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { test, type TestContext } from 'node:test';
import { createApp } from '../src/server.ts';
import { openStore } from '../src/store.ts';

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'backlog-tags-test-'));
  const dbPath = join(directory, 'test.sqlite');
  const modelPath = join(directory, 'model.json');
  let server = createApp({ dbPath, modelPath, webRoot: directory });
  let base = '';
  async function start() {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    base = `http://127.0.0.1:${address.port}`;
  }
  async function close() {
    const closed = once(server, 'close');
    server.close();
    server.closeAllConnections();
    await closed;
  }
  await start();
  t.after(async () => { await close(); await rm(directory, { recursive: true, force: true }); });
  return {
    async restart() { await close(); server = createApp({ dbPath, modelPath, webRoot: directory }); await start(); },
    async request(path: string, method = 'GET', body?: unknown) {
      const response = await fetch(base + path, {
        method,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = response.status === 204 ? undefined : await response.json();
      return { status: response.status, data };
    },
  };
}

test('tag CRUD trims names, enforces case-insensitive uniqueness and validates input', async (t) => {
  const f = await fixture(t);
  assert.deepEqual((await f.request('/api/tags')).data, { tags: [] });
  const created = await f.request('/api/tags', 'POST', { name: '  Work  ', color: 'blue' });
  assert.equal(created.status, 201);
  const tag = created.data.tag;
  assert.equal(tag.name, 'Work');
  assert.equal(tag.color, 'blue');
  assert.match(tag.id, /^[a-f0-9-]{36}$/);
  assert.equal(new Date(tag.createdAt).toISOString(), tag.createdAt);

  for (const body of [null, [], {}, { name: '' }, { name: '   ' }, { name: 'x'.repeat(51) }, { name: 'Work', color: 'blue', extra: 1 }, { name: 'Work', color: 'pink' }, { name: 'Work', color: null }, { name: 4, color: 'blue' }]) {
    const result = await f.request('/api/tags', 'POST', body);
    assert.equal(result.status, 400, JSON.stringify(body));
    assert.equal(typeof result.data.error, 'string');
  }
  assert.equal((await f.request('/api/tags', 'POST', { name: 'work', color: 'teal' })).status, 400);

  const renamed = await f.request(`/api/tags/${tag.id}`, 'PATCH', { name: ' Personal ', color: 'gold' });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.data.tag.name, 'Personal');
  assert.equal(renamed.data.tag.color, 'gold');
  const second = (await f.request('/api/tags', 'POST', { name: 'Home', color: 'slate' })).data.tag;
  assert.equal((await f.request(`/api/tags/${second.id}`, 'PATCH', { name: 'PERSONAL' })).status, 400);
  for (const body of [null, [], {}, { color: 'pink' }, { name: 'x'.repeat(51) }, { name: 4 }]) {
    assert.equal((await f.request(`/api/tags/${tag.id}`, 'PATCH', body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await f.request(`/api/tags/${randomUUID()}`, 'PATCH', { name: 'Missing' })).status, 404);
  assert.equal((await f.request('/api/tags/not-an-id', 'PATCH', { name: 'Missing' })).status, 400);
  assert.equal((await f.request(`/api/tags/${second.id}`, 'DELETE')).status, 204);
  assert.equal((await f.request(`/api/tags/${second.id}`, 'DELETE')).status, 404);
  assert.deepEqual((await f.request('/api/tags')).data.tags.map((item: { name: string }) => item.name), ['Personal']);
});

test('task tag assignments roundtrip, preserve on partial updates and cascade with deletions', async (t) => {
  const f = await fixture(t);
  const project = (await f.request('/api/projects', 'POST', { name: 'Tagged' })).data.project;
  const work = (await f.request('/api/tags', 'POST', { name: 'Work', color: 'blue' })).data.tag;
  const home = (await f.request('/api/tags', 'POST', { name: 'Home', color: 'teal' })).data.tag;
  const created = await f.request('/api/tasks', 'POST', { projectId: project.id, title: 'Tagged task', tagIds: [work.id, home.id, work.id] });
  assert.equal(created.status, 201);
  const task = created.data.task;
  assert.deepEqual(task.tagIds, [work.id, home.id].sort());
  assert.deepEqual((await f.request('/api/tasks')).data.tasks, [task]);

  const partial = await f.request(`/api/tasks/${task.id}`, 'PATCH', { title: 'Renamed' });
  assert.deepEqual(partial.data.task.tagIds, task.tagIds);
  const replaced = await f.request(`/api/tasks/${task.id}`, 'PATCH', { tagIds: [home.id] });
  assert.deepEqual(replaced.data.task.tagIds, [home.id]);
  const cleared = await f.request(`/api/tasks/${task.id}`, 'PATCH', { tagIds: [] });
  assert.deepEqual(cleared.data.task.tagIds, []);

  for (const tagIds of [['not-an-id'], [randomUUID()], [work.id, randomUUID()], 'all', [1], null]) {
    const rejected = await f.request(`/api/tasks/${task.id}`, 'PATCH', { tagIds });
    assert.equal(rejected.status, 400, JSON.stringify(tagIds));
  }
  assert.deepEqual((await f.request('/api/tasks')).data.tasks, [cleared.data.task]);

  await f.request(`/api/tasks/${task.id}`, 'PATCH', { tagIds: [work.id, home.id] });
  assert.equal((await f.request(`/api/tags/${work.id}`, 'DELETE')).status, 204);
  assert.deepEqual((await f.request('/api/tasks')).data.tasks[0].tagIds, [home.id]);
  assert.equal((await f.request(`/api/projects/${project.id}`, 'DELETE')).status, 204);
  assert.deepEqual((await f.request('/api/tasks')).data.tasks, []);
  assert.deepEqual((await f.request('/api/tags')).data.tags.map((item: { name: string }) => item.name), ['Home']);
});

test('tags and assignments survive restart', async (t) => {
  const f = await fixture(t);
  const project = (await f.request('/api/projects', 'POST', { name: 'Persistent' })).data.project;
  const tag = (await f.request('/api/tags', 'POST', { name: 'Keep', color: 'purple' })).data.tag;
  const task = (await f.request('/api/tasks', 'POST', { projectId: project.id, title: 'Keep tags', tagIds: [tag.id] })).data.task;
  await f.restart();
  assert.deepEqual((await f.request('/api/tags')).data.tags, [tag]);
  assert.deepEqual((await f.request('/api/tasks')).data.tasks, [task]);
});

test('a v2 database upgrades to tags without changing existing rows', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'backlog-tags-migration-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'test.sqlite');
  {
    using legacy = new DatabaseSync(path);
    legacy.exec(`
      CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, createdAt TEXT NOT NULL);
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', priority TEXT NOT NULL DEFAULT 'medium',
        dueDate TEXT, status TEXT NOT NULL DEFAULT 'backlog', createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
        dueTime TEXT
      );
      CREATE INDEX tasks_projectId ON tasks(projectId);
      INSERT INTO projects VALUES ('p1', 'Project', 'created');
      INSERT INTO tasks VALUES ('t1', 'p1', 'Task', 'Details', 'high', '2028-02-29', 'in_progress', 'created', 'updated', NULL);
      PRAGMA user_version = 2;
    `);
  }
  const store = openStore(path);
  try {
    assert.equal(store.backendSchema().userVersion, 3);
    assert.deepEqual(store.projects().map(row => ({ ...row })), [{ id: 'p1', name: 'Project', createdAt: 'created' }]);
    assert.deepEqual(store.tasks(), [{ id: 't1', projectId: 'p1', title: 'Task', description: 'Details', priority: 'high',
      dueDate: '2028-02-29', dueTime: null, status: 'in_progress', createdAt: 'created', updatedAt: 'updated', tagIds: [] }]);
    const tag = store.createTag({ name: 'Migrated', color: 'teal' });
    assert.deepEqual(store.updateTask('t1', { tagIds: [tag.id] }).tagIds, [tag.id]);
  } finally { store.close(); }
});
