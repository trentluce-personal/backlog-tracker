import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const children = new Set();
const intentionalStops = new WeakSet();
let stopping = false;
let watcher;
let debounce;
let restart = Promise.resolve();

async function terminate(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  intentionalStops.add(child);
  await new Promise((done) => {
    child.once('exit', done);
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      killer.on('error', () => child.kill());
    } else child.kill('SIGTERM');
  });
}

async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  clearTimeout(debounce);
  watcher?.close();
  // Stop the proxy before releasing the API port.
  await terminate(frontend);
  await Promise.all([...children].map(terminate));
}

function launch(args, options = {}) {
  const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit', ...options });
  children.add(child);
  child.on('error', (error) => { console.error(error.message); void stop(1); });
  child.on('exit', (code, signal) => {
    children.delete(child);
    if (!stopping && !intentionalStops.has(child)) {
      console.error(`Development child exited (${signal ?? code}). Stopping development servers.`);
      void stop(1);
    }
  });
  return child;
}

let api;
let frontend;
async function startServers() {
  if (stopping) return;
  api = launch(['apps/api/src/server.ts'], { stdio: ['inherit', 'inherit', 'inherit', 'ipc'] });
  const ownedApi = api;
  await new Promise((ready, reject) => {
    const timeout = setTimeout(() => finish(new Error('Owned API did not report readiness within 15 seconds.')), 15000);
    const onExit = () => finish(new Error('Owned API exited before reporting readiness.'));
    const onError = (error) => finish(error);
    const onMessage = (message) => {
      if (message?.type === 'backlog:listening') finish();
    };
    function finish(error) {
      clearTimeout(timeout);
      ownedApi.off('exit', onExit);
      ownedApi.off('error', onError);
      ownedApi.off('message', onMessage);
      if (error) reject(error);
      else ready();
    }
    ownedApi.once('exit', onExit);
    ownedApi.once('error', onError);
    ownedApi.on('message', onMessage);
  });
  if (stopping || ownedApi.exitCode !== null || ownedApi.signalCode !== null) return;
  frontend = launch([resolve(root, 'scripts/vite-dev.mjs')], { cwd: resolve(root, 'apps/web') });
}

process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
try {
  await startServers();
  if (!stopping) {
    watcher = watch(resolve(root, 'apps/api/src'), { recursive: true }, () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        restart = restart.then(async () => {
          if (stopping) return;
          console.log('API source changed; restarting development servers.');
          await terminate(frontend);
          await terminate(api);
          await startServers();
        }).catch((error) => { console.error(error.message); return stop(1); });
      }, 100);
    });
    watcher.on('error', (error) => { console.error(error.message); void stop(1); });
  }
} catch (error) {
  console.error(error.message);
  await stop(1);
}
