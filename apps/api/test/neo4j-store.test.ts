import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/server.ts';
import { openNeo4jBacklogStore } from '../src/neo4j-store.ts';
import { assert } from './expected-v3.ts';

const uri = process.env.NEO4J_TEST_URI;
const password = process.env.NEO4J_TEST_PASSWORD;
const enabled = Boolean(uri && password);

if (uri && /:7687(?:\/|$)/.test(uri) && process.env.NEO4J_TEST_ALLOW_PROD !== '1') {
  throw new Error('Refusing to run Neo4j tests against the production port 7687.');
}

test('Neo4j backlog store CRUD, tags, cascade and schema bootstrap', { skip: !enabled && 'Set NEO4J_TEST_URI and NEO4J_TEST_PASSWORD to run.' }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'backlog-neo4j-test-'));
  const backlogStore = openNeo4jBacklogStore({
    uri: uri!,
    user: process.env.NEO4J_TEST_USER ?? 'neo4j',
    password: password!,
    database: process.env.NEO4J_TEST_DATABASE ?? 'neo4j',
  });
  await backlogStore.ready().catch(async (error) => { await backlogStore.close(); throw error; });
  const server = createApp({
    dbPath: join(directory, 'test.sqlite'),
    modelPath: join(directory, 'model.json'),
    webRoot: directory,
    backlogStore,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const projects: string[] = [];
  const tags: string[] = [];

  async function request(path: string, method = 'GET', body?: unknown) {
    const response = await fetch(base + path, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: response.status === 204 ? undefined : await response.json() };
  }

  t.after(async () => {
    for (const id of projects) await request(`/api/projects/${id}`, 'DELETE').catch(() => {});
    for (const id of tags) await request(`/api/tags/${id}`, 'DELETE').catch(() => {});
    const closed = once(server, 'close');
    server.close();
    server.closeAllConnections();
    await closed;
    await backlogStore.close();
    await rm(directory, { recursive: true, force: true });
  });

  const suffix = randomUUID().slice(0, 8);

  const project = await request('/api/projects', 'POST', { name: `Neo4j project ${suffix}` });
  assert.equal(project.status, 201);
  projects.push(project.data.project.id);
  assert.equal(project.data.project.name, `Neo4j project ${suffix}`);
  assert.match(project.data.project.id, /^[a-f0-9-]{36}$/);

  const tag = await request('/api/tags', 'POST', { name: `neo4j-tag-${suffix}`, color: 'teal' });
  assert.equal(tag.status, 201);
  tags.push(tag.data.tag.id);
  assert.equal(tag.data.tag.color, 'teal');

  const duplicate = await request('/api/tags', 'POST', { name: `NEO4J-TAG-${suffix}`, color: 'red' });
  assert.equal(duplicate.status, 400);

  const task = await request('/api/tasks', 'POST', {
    projectId: project.data.project.id,
    title: '  Neo4j task  ',
    description: 'Roundtrip',
    priority: 'high',
    dueDate: '2026-12-01',
    dueTime: '09:30',
    status: 'in_progress',
    tagIds: [tag.data.tag.id],
  });
  assert.equal(task.status, 201);
  assert.equal(task.data.task.title, 'Neo4j task');
  assert.equal(task.data.task.description, 'Roundtrip');
  assert.equal(task.data.task.priority, 'high');
  assert.equal(task.data.task.dueDate, '2026-12-01');
  assert.equal(task.data.task.dueTime, '09:30');
  assert.equal(task.data.task.status, 'in_progress');
  assert.deepEqual(task.data.task.tagIds, [tag.data.tag.id]);

  const listed = await request('/api/tasks');
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.data.tasks.find((candidate: { id: string }) => candidate.id === task.data.task.id), task.data.task);

  const cleared = await request(`/api/tasks/${task.data.task.id}`, 'PATCH', { status: 'done', tagIds: [] });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.data.task.status, 'done');
  assert.deepEqual(cleared.data.task.tagIds, []);

  const second = await request('/api/projects', 'POST', { name: `Neo4j project two ${suffix}` });
  assert.equal(second.status, 201);
  projects.push(second.data.project.id);

  const moved = await request(`/api/tasks/${task.data.task.id}`, 'PATCH', { projectId: second.data.project.id });
  assert.equal(moved.status, 200);
  assert.equal(moved.data.task.projectId, second.data.project.id);

  assert.equal((await request(`/api/projects/${project.data.project.id}`, 'DELETE')).status, 204);
  assert.equal((await request(`/api/projects/${second.data.project.id}`, 'DELETE')).status, 204);
  const remaining = await request('/api/tasks');
  assert.equal(remaining.data.tasks.some((candidate: { id: string }) => candidate.id === task.data.task.id), false);

  assert.equal((await request(`/api/tags/${tag.data.tag.id}`, 'DELETE')).status, 204);
  assert.equal((await request(`/api/tags/${tag.data.tag.id}`, 'DELETE')).status, 404);

  const missingProject = await request('/api/tasks', 'POST', { projectId: randomUUID(), title: 'Missing project' });
  assert.equal(missingProject.status, 400);
  const third = await request('/api/projects', 'POST', { name: `Neo4j project three ${suffix}` });
  assert.equal(third.status, 201);
  projects.push(third.data.project.id);
  const missingTag = await request('/api/tasks', 'POST', { projectId: third.data.project.id, title: 'Missing tag', tagIds: [randomUUID()] });
  assert.equal(missingTag.status, 400);
});
