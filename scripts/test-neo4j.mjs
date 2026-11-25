import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import neo4j from 'neo4j-driver';

const root = fileURLToPath(new URL('../', import.meta.url));
const image = process.env.NEO4J_TEST_IMAGE ?? 'neo4j:5.26.33';
const name = `backlog-neo4j-test-${process.pid}`;
const password = randomBytes(16).toString('hex');

function freePort() {
  return new Promise((ready, fail) => {
    const server = createServer();
    server.on('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => ready(address.port));
    });
  });
}

function run(command, args, options = {}) {
  return new Promise((ready, fail) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.on('error', fail);
    child.on('exit', (code, signal) => code === 0 ? ready() : fail(new Error(`${command} exited (${signal ?? code})`)));
  });
}

const port = await freePort();
const uri = `bolt://127.0.0.1:${port}`;
let started = false;
try {
  await run('docker', ['run', '--rm', '-d', '--name', name, '-p', `127.0.0.1:${port}:7687`, '-e', `NEO4J_AUTH=neo4j/${password}`, image]);
  started = true;
  const driver = neo4j.driver(uri, neo4j.auth.basic('neo4j', password), { disableLosslessIntegers: true, connectionTimeout: 5000 });
  const deadline = Date.now() + 180_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      await driver.verifyConnectivity();
      lastError = undefined;
      break;
    } catch (error) {
      lastError = error;
      await new Promise((done) => setTimeout(done, 2000));
    }
  }
  await driver.close();
  if (lastError) throw lastError;
  await run(process.execPath, ['--test', 'test/neo4j-store.test.ts'], {
    cwd: resolve(root, 'apps/api'),
    env: { ...process.env, NEO4J_TEST_URI: uri, NEO4J_TEST_PASSWORD: password },
  });
} finally {
  if (started) await run('docker', ['rm', '-f', name]).catch(() => {});
}
