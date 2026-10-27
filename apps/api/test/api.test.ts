import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { request as httpRequest, createServer } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test, type TestContext } from 'node:test';
import { createApp } from '../src/server.ts';

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'backlog-api-test-'));
  const dbPath = join(directory, 'test.sqlite');
  let server = createApp({ dbPath, webRoot: directory });
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
    directory,
    origin: () => base,
    async restart() { await close(); server = createApp({ dbPath, webRoot: directory }); await start(); },
    async request(path: string, method = 'GET', body?: unknown, headers?: Record<string, string>) {
      if (headers?.Host) {
        return new Promise<{ status: number; data: any; headers: unknown }>((resolve, reject) => {
          const request = httpRequest(base + path, {
            method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
          }, (response) => {
            const chunks: Buffer[] = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => resolve({ status: response.statusCode!, data: JSON.parse(Buffer.concat(chunks).toString()), headers: response.headers }));
          });
          request.on('error', reject);
          request.end(body === undefined ? undefined : JSON.stringify(body));
        });
      }
      const response = await fetch(base + path, {
        method,
        headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = response.status === 204 ? undefined : await response.json();
      return { status: response.status, data, headers: response.headers };
    },
  };
}

test('empty database, project CRUD, defaults, task editing and individual deletion', async (t) => {
  const f = await fixture(t);
  assert.deepEqual((await f.request('/api/projects')).data, { projects: [] });
  assert.deepEqual((await f.request('/api/tasks')).data, { tasks: [] });
  const created = await f.request('/api/projects', 'POST', { name: '  Personal  ' });
  assert.equal(created.status, 201);
  const project = created.data.project;
  assert.equal(project.name, 'Personal');
  assert.match(project.id, /^[a-f0-9-]{36}$/);
  assert.equal(new Date(project.createdAt).toISOString(), project.createdAt);
  assert.equal((await f.request(`/api/projects/${project.id}`, 'PATCH', { name: 'Weekend' })).data.project.name, 'Weekend');
  const result = await f.request('/api/tasks', 'POST', { projectId: project.id, title: '  Start tracker  ' });
  assert.equal(result.status, 201);
  const task = result.data.task;
  assert.deepEqual(task, {
    id: task.id, projectId: project.id, title: 'Start tracker', description: '', priority: 'medium',
    dueDate: null, status: 'backlog', createdAt: task.createdAt, updatedAt: task.createdAt,
  });
  const second = (await f.request('/api/projects', 'POST', { name: 'Work' })).data.project;
  const changed = await f.request(`/api/tasks/${task.id}`, 'PATCH', {
    projectId: second.id, title: 'Finish tracker', description: 'All the details\nSecond line',
    priority: 'high', dueDate: '2028-02-29', status: 'in_progress',
  });
  assert.equal(changed.status, 200);
  assert.equal(changed.data.task.createdAt, task.createdAt);
  assert.ok(changed.data.task.updatedAt >= task.updatedAt);
  assert.deepEqual((await f.request('/api/tasks')).data.tasks, [changed.data.task]);
  const done = await f.request(`/api/tasks/${task.id}`, 'PATCH', { status: 'done', priority: 'low', dueDate: null });
  assert.equal(done.data.task.status, 'done');
  assert.equal(done.data.task.priority, 'low');
  assert.equal(done.data.task.dueDate, null);
  assert.equal(done.data.task.description, changed.data.task.description);
  assert.equal((await f.request(`/api/tasks/${task.id}`, 'DELETE')).status, 204);
  assert.deepEqual((await f.request('/api/tasks')).data.tasks, []);
  assert.equal((await f.request(`/api/projects/${project.id}`, 'DELETE')).status, 204);
  assert.deepEqual((await f.request('/api/projects')).data.projects, [second]);
});

test('restart persists all task fields; project deletion cascades only associated tasks', async (t) => {
  const f = await fixture(t);
  const first = (await f.request('/api/projects', 'POST', { name: 'First' })).data.project;
  const second = (await f.request('/api/projects', 'POST', { name: 'Second' })).data.project;
  const tasks = [];
  for (const projectId of [first.id, first.id, second.id]) {
    const result = await f.request('/api/tasks', 'POST', {
      projectId, title: 'Persistent task', description: 'Keep me', priority: 'high', dueDate: '2026-12-31', status: 'done',
    });
    assert.equal(result.status, 201);
    tasks.push(result.data.task);
  }
  await f.restart();
  assert.deepEqual((await f.request('/api/projects')).data.projects.map((p: { id: string }) => p.id).sort(), [first.id, second.id].sort());
  assert.deepEqual((await f.request('/api/tasks')).data.tasks.sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id)), tasks.sort((a, b) => a.id.localeCompare(b.id)));
  assert.equal((await f.request(`/api/projects/${first.id}`, 'DELETE')).status, 204);
  await f.restart();
  assert.deepEqual((await f.request('/api/projects')).data.projects, [second]);
  assert.deepEqual((await f.request('/api/tasks')).data.tasks, tasks.filter((task) => task.projectId === second.id));
  assert.equal((await f.request(`/api/projects/${first.id}`, 'DELETE')).status, 404);
  assert.equal((await f.request('/api/projects', 'POST', { name: 'Transaction still works' })).status, 201);
});

test('invalid project input and invalid IDs return errors without changing stored data', async (t) => {
  const f = await fixture(t);
  const project = (await f.request('/api/projects', 'POST', { name: 'Original' })).data.project;
  for (const body of [null, [], {}, { name: '' }, { name: '  ' }, { name: 4 }, { name: true }, { name: 'a'.repeat(101) }, { name: 'Valid', extra: 1 }]) {
    for (const [path, method] of [['/api/projects', 'POST'], [`/api/projects/${project.id}`, 'PATCH']]) {
      const result = await f.request(path!, method!, body);
      assert.equal(result.status, 400, JSON.stringify(body));
      assert.equal(typeof result.data.error, 'string');
    }
  }
  for (const collection of ['projects', 'tasks']) {
    for (const method of ['PATCH', 'DELETE']) {
      assert.equal((await f.request(`/api/${collection}/not-an-id`, method, method === 'PATCH' ? {} : undefined)).status, 400);
      assert.equal((await f.request(`/api/${collection}/${randomUUID()}`, method, method === 'PATCH' ? (collection === 'projects' ? { name: 'Valid' } : { title: 'Valid' }) : undefined)).status, 404);
    }
  }
  assert.deepEqual((await f.request('/api/projects')).data.projects, [project]);
  assert.deepEqual((await f.request('/api/tasks')).data.tasks, []);
});

test('invalid task fields, impossible dates and missing projects leave existing task unchanged', async (t) => {
  const f = await fixture(t);
  const project = (await f.request('/api/projects', 'POST', { name: 'Validation' })).data.project;
  const valid = { projectId: project.id, title: 'Original' };
  const task = (await f.request('/api/tasks', 'POST', valid)).data.task;
  const invalid = [
    { projectId: randomUUID() }, { projectId: 'bad' }, { projectId: null }, { projectId: 123 },
    { title: '' }, { title: '   ' }, { title: false }, { title: null }, { title: 'x'.repeat(201) },
    { description: 1 }, { description: null }, { description: 'x'.repeat(5001) },
    { priority: 'urgent' }, { priority: null }, { priority: 1 },
    { status: 'finished' }, { status: null }, { status: false },
    { dueDate: '2026-02-29' }, { dueDate: '2024-02-30' }, { dueDate: '2026-04-31' },
    { dueDate: '2026-13-01' }, { dueDate: '2026-00-10' }, { dueDate: '0000-01-01' },
    { dueDate: '2026-1-01' }, { dueDate: '2026-01-01T00:00:00Z' }, { dueDate: '' }, { dueDate: 20260101 },
    { extra: 'unknown' },
  ];
  for (const input of invalid) {
    assert.equal((await f.request('/api/tasks', 'POST', { ...valid, ...input })).status, 400, JSON.stringify(input));
    const patched = await f.request(`/api/tasks/${task.id}`, 'PATCH', { title: 'Would change', ...input });
    assert.equal(patched.status, 400, JSON.stringify(input));
    assert.equal(typeof patched.data.error, 'string');
    assert.deepEqual((await f.request('/api/tasks')).data.tasks, [task]);
  }
  for (const input of [null, [], {}, { title: 'Missing project' }, { projectId: project.id }]) {
    assert.equal((await f.request('/api/tasks', 'POST', input)).status, 400);
  }
  assert.equal((await f.request(`/api/tasks/${task.id}`, 'PATCH', {})).status, 400);
});

test('length boundaries, calendar dates and SQL-like strings roundtrip safely', async (t) => {
  const f = await fixture(t);
  const project = (await f.request('/api/projects', 'POST', { name: 'x'.repeat(100) })).data.project;
  assert.equal(project.name.length, 100);
  const task = (await f.request('/api/tasks', 'POST', {
    projectId: project.id, title: 'x'.repeat(200), description: 'x'.repeat(5000), dueDate: '2000-02-29',
  })).data.task;
  assert.equal(task.title.length, 200);
  assert.equal(task.description.length, 5000);
  const title = "Robert'); DROP TABLE tasks; --";
  assert.equal((await f.request(`/api/tasks/${task.id}`, 'PATCH', { title })).data.task.title, title);
  assert.equal((await f.request('/api/tasks')).data.tasks.length, 1);
  for (const dueDate of ['0001-01-01', '9999-12-31', '2026-02-28']) {
    assert.equal((await f.request(`/api/tasks/${task.id}`, 'PATCH', { dueDate })).data.task.dueDate, dueDate);
  }
});

test('same-origin protections reject foreign origins, fetch metadata and nonlocal hosts', async (t) => {
  const f = await fixture(t);
  for (const headers of [
    { Origin: 'https://example.com' },
    { Origin: 'null' },
    { Origin: 'http://127.0.0.1:9999' },
    { 'Sec-Fetch-Site': 'cross-site' },
    { Host: 'attacker.example' },
  ]) {
    const result = await f.request('/api/projects', 'POST', { name: 'Rejected' }, headers);
    assert.equal(result.status, 403, JSON.stringify(headers));
    assert.equal(typeof result.data.error, 'string');
  }
  assert.deepEqual((await f.request('/api/projects')).data.projects, []);
  assert.equal((await f.request('/api/projects', 'GET', undefined, { Host: 'attacker.example' })).status, 403);
  assert.equal((await f.request('/api/projects', 'POST', { name: 'Same origin' }, { Origin: f.origin() })).status, 201);
  assert.equal((await f.request('/api/projects', 'POST', { name: 'Proxy origin' }, { Host: '127.0.0.1:5173', Origin: 'http://127.0.0.1:5173' })).status, 201);
});

test('malformed JSON, types, oversized bodies and unknown endpoints produce JSON errors', async (t) => {
  const f = await fixture(t);
  for (const [content, contentType] of [
    ['{broken', 'application/json'], ['{"name":"Bad type"}', 'text/plain'],
    [JSON.stringify({ name: 'x'.repeat(40000) }), 'application/json'],
  ]) {
    const response = await fetch(f.origin() + '/api/projects', { method: 'POST', headers: { 'Content-Type': contentType! }, body: content });
    assert.equal(response.status, 400);
    assert.equal(typeof (await response.json()).error, 'string');
  }
  assert.equal((await f.request('/api/unknown')).status, 404);
  assert.equal((await f.request('/api/projects', 'PUT', { name: 'No route' })).status, 404);
  assert.deepEqual((await f.request('/api/projects')).data.projects, []);
});

test('built frontend static serving and API coexist on the local server', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.directory, 'index.html'), '<!doctype html><title>Backlog</title>');
  await writeFile(join(f.directory, 'app.js'), 'console.log("Backlog");');
  for (const [path, type] of [['/', 'text/html'], ['/app.js', 'text/javascript']]) {
    const response = await fetch(f.origin() + path);
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-type')?.startsWith(type!));
    assert.ok((await response.text()).includes('Backlog'));
  }
  assert.equal((await fetch(f.origin(), { method: 'HEAD' })).status, 200);
  assert.equal((await f.request('/missing.js')).status, 404);
  assert.equal((await f.request('/%2e%2e%2foutside.txt')).status, 404);
  assert.equal((await f.request('/api/projects')).status, 200);
});

for (const host of [undefined, '0.0.0.0']) test(`standalone Node entrypoint (${host ?? 'default loopback'}) persists and retains request guards`, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'backlog-process-test-'));
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const address = probe.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;
  await new Promise<void>((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  let child: ChildProcess | undefined;
  let output = '';
  const entry = fileURLToPath(new URL('../src/server.ts', import.meta.url));
  async function start() {
    output = '';
    const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(port), BACKLOG_DB_PATH: join(directory, 'isolated.sqlite') };
    delete env.BACKLOG_HOST;
    if (host) env.BACKLOG_HOST = host;
    child = spawn(process.execPath, [entry], {
      cwd: directory,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const running = child;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Server startup timed out: ${output}`)), 10000);
      running.once('error', (error) => { clearTimeout(timeout); reject(error); });
      running.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Server exited ${code}: ${output}`)); });
      running.stderr!.on('data', (chunk) => { output += chunk; });
      running.stdout!.on('data', (chunk) => {
        output += chunk;
        if (output.includes('Backlog Tracker listening')) { clearTimeout(timeout); resolve(); }
      });
    });
  }
  async function stop() {
    if (!child || child.exitCode !== null) return;
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  }
  t.after(async () => { await stop(); await rm(directory, { recursive: true, force: true }); });
  await start();
  assert.ok(output.includes(`http://${host ?? '127.0.0.1'}:${port}`), output);
  const base = `http://127.0.0.1:${port}`;
  const response = await fetch(base + '/api/projects', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ name: 'Restart proof' }),
  });
  assert.equal(response.status, 201);
  const { project } = await response.json();
  await stop();
  await start();
  assert.deepEqual(await (await fetch(base + '/api/projects')).json(), { projects: [project] });
  assert.equal((await fetch(base + `/api/projects/${project.id}`, {
    method: 'DELETE', headers: { Origin: 'https://example.com' },
  })).status, 403);
  const invalidHostStatus = await new Promise<number>((resolve, reject) => {
    const request = httpRequest(base + '/api/projects', { headers: { Host: 'attacker.example' } }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode!));
    });
    request.on('error', reject);
    request.end();
  });
  assert.equal(invalidHostStatus, 403);
  assert.deepEqual(await (await fetch(base + '/api/projects')).json(), { projects: [project] });
});
