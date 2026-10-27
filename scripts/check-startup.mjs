import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, stat, utimes } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../apps/api/src/server.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = await mkdtemp(join(tmpdir(), 'backlog-startup-check-'));
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run through npm run test:startup.');
let child;
let logs = '';
async function port() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const value = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return value;
}
const apiPort = await port();
let webPort = await port();
while (webPort === apiPort) webPort = await port();
const dbPath = join(directory, 'isolated.sqlite');
const watchedSource = join(root, 'apps/api/src/server.ts');
const sourceTimes = await stat(watchedSource);
let touchedSource = false;
function start(script, database = dbPath) {
  logs = '';
  child = spawn(process.execPath, [npm, 'run', script], {
    cwd: root,
    detached: process.platform !== 'win32',
    env: { ...process.env, PORT: String(apiPort), BACKLOG_WEB_PORT: String(webPort), BACKLOG_DB_PATH: database },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => { logs += chunk; });
  child.stderr.on('data', (chunk) => { logs += chunk; });
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const exited = once(child, 'exit');
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    await once(killer, 'exit');
  } else process.kill(-child.pid, 'SIGTERM');
  await exited;
}
async function ready(url) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Startup exited: ${logs}`);
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Startup timed out: ${logs}`);
}
const api = `http://127.0.0.1:${apiPort}`;
const web = `http://127.0.0.1:${webPort}`;
async function rejectsStartup(label, database, expectedError) {
  start('dev', database);
  const deadline = Date.now() + 10000;
  let exposed = false;
  let proxyData;
  while (Date.now() < deadline && child.exitCode === null) {
    try {
      if ((await fetch(web, { signal: AbortSignal.timeout(250) })).ok) {
        exposed = true;
        try { proxyData = await (await fetch(web + '/api/projects')).json(); } catch {}
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  console.log(logs.trim());
  console.log(`${label}: launcher exit=${child.exitCode}, frontend exposed=${exposed}, proxy data=${JSON.stringify(proxyData)}`);
  assert.equal(exposed, false, `${label}: frontend must never be exposed`);
  assert.notEqual(child.exitCode, null, `${label}: launcher must exit rather than wait for changes`);
  assert.notEqual(child.exitCode, 0, `${label}: launcher must fail`);
  assert.match(logs, expectedError, `${label}: expected startup failure must be reported`);
  assert.doesNotMatch(logs, /Local:|\u001b\[1mLocal/, `${label}: Vite must not start`);
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(webPort, '127.0.0.1', () => probe.close(resolve));
  });
  console.log(`PASS ${label}: nonzero exit, frontend never exposed, web port released.`);
}
try {
  const existing = createApp({ dbPath: join(directory, 'server-a.sqlite') });
  existing.listen(apiPort, '127.0.0.1');
  await once(existing, 'listening');
  try {
    const response = await fetch(api + '/api/projects', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Server A only' }),
    });
    assert.equal(response.status, 201);
    const { project } = await response.json();
    await rejectsStartup('Busy API port / isolated databases A and B', join(directory, 'server-b.sqlite'), /EADDRINUSE/);
    assert.deepEqual(await (await fetch(api + '/api/projects')).json(), { projects: [project] });
    console.log('PASS existing server A remains running with its original project unchanged.');
  } finally {
    await stop();
    const closed = once(existing, 'close');
    existing.close();
    existing.closeAllConnections();
    await closed;
  }
  await rejectsStartup('Invalid database path (directory)', directory, /unable to open database file/);
  start('dev');
  await ready(api + '/api/projects');
  await ready(web);
  assert.deepEqual(await (await fetch(web + '/api/projects')).json(), { projects: [] });
  const response = await fetch(web + '/api/projects', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: web },
    body: JSON.stringify({ name: 'Isolated startup proof' }),
  });
  assert.equal(response.status, 201);
  const { project } = await response.json();
  console.log(logs.trim());
  console.log(`PASS npm run dev: ${web}, API ${api}; same-origin proxy POST returned 201.`);
  touchedSource = true;
  await utimes(watchedSource, sourceTimes.atime, new Date());
  const reloadDeadline = Date.now() + 10000;
  while ((logs.match(/Backlog Tracker listening/g)?.length ?? 0) < 2 && Date.now() < reloadDeadline) {
    assert.equal(child.exitCode, null, logs);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(logs.match(/Backlog Tracker listening/g)?.length, 2, 'API source change must restart the owned child.');
  await ready(web);
  assert.deepEqual(await (await fetch(web + '/api/projects')).json(), { projects: [project] });
  console.log('PASS API source watch: owned API restarted, frontend resumed, persisted project unchanged.');
  await stop();
  start('start');
  await ready(api);
  const html = await (await fetch(api)).text();
  assert.match(html, /<html/i);
  const asset = html.match(/src="([^"]+\.js)"/)?.[1];
  assert.ok(asset, 'Built frontend must reference JavaScript bundle.');
  assert.equal((await fetch(api + asset)).status, 200);
  assert.deepEqual(await (await fetch(api + '/api/projects')).json(), { projects: [project] });
  const rejected = await fetch(api + `/api/projects/${project.id}`, {
    method: 'DELETE', headers: { Origin: 'https://example.com' },
  });
  assert.equal(rejected.status, 403);
  console.log(logs.trim());
  console.log(`PASS npm start: ${api}; HTML/bundle 200, persisted project present, cross-origin DELETE 403.`);
  console.log(`PASS isolated SQLite target: ${dbPath}; 5 startup scenarios passed.`);
} catch (error) {
  console.error(logs);
  throw error;
} finally {
  await stop();
  if (touchedSource) await utimes(watchedSource, sourceTimes.atime, sourceTimes.mtime);
  await rm(directory, { recursive: true, force: true });
}
