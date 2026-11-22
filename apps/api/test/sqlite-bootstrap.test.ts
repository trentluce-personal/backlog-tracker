import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test, type TestContext } from 'node:test';
import { pathToFileURL } from 'node:url';
import { createApp } from '../src/server.ts';
import { bootstrapSqlite } from '../src/sqlite-bootstrap.ts';
import { openStore } from '../src/store.ts';

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'backlog-bootstrap-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, dbPath: join(directory, 'backlog.sqlite') };
}

test('SQLite first start serves an empty backlog and all models without opening JSON paths', async t => {
  const { directory, dbPath } = await fixture(t);
  const models = join(directory, 'not-a-directory');
  await writeFile(models, 'no file storage');
  const app = createApp({ dbPath, namedModelStorage: 'sqlite', modelPath: join(models, 'model.json'), webRoot: directory });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  const address = app.address();
  assert.ok(address && typeof address === 'object');
  try {
    async function get(endpoint: string) {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/${endpoint}`);
      assert.equal(response.status, 200);
      return response.json();
    }
    assert.deepEqual(await get('projects'), { projects: [] });
    assert.deepEqual(await get('tasks'), { tasks: [] });
    assert.deepEqual(await get('models'), { models: [] });
    assert.equal((await get('model')).model.revision, 0);
    assert.deepEqual(await get('erd-models'), { models: [] });
  } finally {
    const closed = once(app, 'close');
    app.close();
    await closed;
  }
  assert.throws(() => openStore(dbPath), /BACKLOG_NAMED_MODEL_STORAGE=sqlite/);
  assert.deepEqual((await readdir(directory)).sort(), ['backlog.sqlite', 'not-a-directory']);
});

test('SQLite mode refuses an existing empty or corrupt DB and orphaned sidecars', async t => {
  const { directory, dbPath } = await fixture(t);
  for (const contents of ['', 'not a SQLite database'.repeat(128)]) {
    await writeFile(dbPath, contents, { mode: 0o600 });
    assert.throws(() => openStore(dbPath, true), /offline all-model importer.*restore a valid v2 backup/);
    assert.equal(await readFile(dbPath, 'utf8'), contents);
    assert.deepEqual(await readdir(directory), [basename(dbPath)]);
  }
  await rm(dbPath);
  await writeFile(dbPath + '-wal', 'orphaned fixture', { mode: 0o600 });
  assert.throws(() => openStore(dbPath, true), /offline all-model importer/);
  assert.deepEqual(await readdir(directory), [basename(dbPath) + '-wal']);
  assert.equal(await readFile(dbPath + '-wal', 'utf8'), 'orphaned fixture');
});

async function leaveCommittedWal(t: TestContext, cutover: boolean) {
  const paths = await fixture(t);
  await writeFile(paths.dbPath, '', { mode: 0o600 });
  openStore(paths.dbPath).close();
  const importer = new URL('../src/model-sqlite.ts', import.meta.url).href;
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { DatabaseSync } from 'node:sqlite';
    import { importModelDocuments } from ${JSON.stringify(importer)};
    const db = new DatabaseSync(process.argv[1]);
    db.exec('PRAGMA wal_autocheckpoint = 0');
    if (${cutover}) importModelDocuments(db, 'files', { named: [], erds: [] });
    db.exec("INSERT INTO projects VALUES ('wal-id', 'Committed in WAL', 'fixture')");
    process.send('committed');
    process.once('message', () => process.exit(37));`, paths.dbPath],
  { cwd: paths.directory, stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  const [message] = await Promise.race([
    once(child, 'message'), once(child, 'exit').then(result => assert.fail(`WAL writer exited early: ${result}`)),
  ]);
  assert.equal(message, 'committed');
  async function crash() {
    const exited = once(child, 'exit');
    child.send('exit');
    assert.deepEqual(await exited, [37, null]);
  }
  const uri = pathToFileURL(paths.dbPath);
  uri.search = '?immutable=1';
  using main = new DatabaseSync(uri, { readOnly: true });
  assert.equal(main.prepare("SELECT name FROM sqlite_schema WHERE name = 'named_graph_cutover'").get(), undefined);
  assert.equal(main.prepare('SELECT id FROM projects').get(), undefined);
  assert.ok((await stat(paths.dbPath + '-wal')).size > 0);
  return { ...paths, crash };
}

test('rejected SQLite startup leaves the unmarked main file and committed WAL sidecars byte-identical', async t => {
  const { directory, dbPath, crash } = await leaveCommittedWal(t, false);
  await crash();
  const entries = (await readdir(directory)).sort();
  assert.deepEqual(entries, ['backlog.sqlite', 'backlog.sqlite-shm', 'backlog.sqlite-wal']);
  const before = await Promise.all(entries.map(name => readFile(join(directory, name))));
  assert.throws(() => openStore(dbPath, true), /offline all-model importer/);
  assert.deepEqual((await readdir(directory)).sort(), entries);
  for (const [i, name] of entries.entries()) assert.ok((await readFile(join(directory, name))).equals(before[i]!), `${name} bytes changed`);
  const reopened = openStore(dbPath);
  try { assert.equal(reopened.projects()[0]?.name, 'Committed in WAL'); }
  finally { reopened.close(); }
});

test('a v2 marker committed only in WAL governs startup with an active writer and after abrupt exit', async t => {
  const { directory, dbPath, crash } = await leaveCommittedWal(t, true);
  async function checkFileModeRefusal() {
    const entries = (await readdir(directory)).sort();
    const before = await Promise.all(entries.map(name => readFile(join(directory, name))));
    assert.throws(() => openStore(dbPath), /BACKLOG_NAMED_MODEL_STORAGE=sqlite/);
    assert.deepEqual((await readdir(directory)).sort(), entries);
    for (const [i, name] of entries.entries()) assert.ok((await readFile(join(directory, name))).equals(before[i]!), `${name} bytes changed`);
  }
  function checkSqliteModeStartup() {
    const reopened = openStore(dbPath, true);
    try { assert.equal(reopened.projects()[0]?.name, 'Committed in WAL'); }
    finally { reopened.close(); }
  }
  await checkFileModeRefusal();
  checkSqliteModeStartup();
  await crash();
  // Force SQLite to reconstruct the WAL index from the committed frames.
  await rm(dbPath + '-shm');
  await checkFileModeRefusal();
  checkSqliteModeStartup();
  assert.deepEqual(await readdir(directory), [basename(dbPath)]);
});

test('a marked database with physical corruption is refused at startup', async t => {
  const { dbPath } = await fixture(t);
  openStore(dbPath, true).close();
  let page: number;
  let pageSize: number;
  {
    using db = new DatabaseSync(dbPath);
    page = Number(db.prepare("SELECT rootpage FROM sqlite_schema WHERE name = 'tasks_projectId'").get()?.rootpage);
    pageSize = Number(db.prepare('PRAGMA page_size').get()?.page_size);
  }
  const bytes = await readFile(dbPath);
  assert.equal(bytes[(page - 1) * pageSize], 10); // Empty SQLite index b-tree leaf page.
  bytes[(page - 1) * pageSize] = 0;
  await writeFile(dbPath, bytes);
  assert.throws(() => openStore(dbPath, true), /restore a valid v2 backup/);
  assert.deepEqual(await readFile(dbPath), bytes);
});

test('bootstrap cleans up on initialization error and ignores private residue after abrupt exit', async t => {
  const { directory, dbPath } = await fixture(t);
  assert.throws(() => bootstrapSqlite(dbPath, () => { throw new Error('fixture initialization failed'); }), /fixture initialization failed/);
  assert.deepEqual(await readdir(directory), []);

  const module = new URL('../src/sqlite-bootstrap.ts', import.meta.url).href;
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { bootstrapSqlite } from ${JSON.stringify(module)};
    bootstrapSqlite(process.argv[1], db => {
      db.exec('BEGIN IMMEDIATE; CREATE TABLE incomplete (id);');
      process.exit(37);
    });`, dbPath], { cwd: directory, stdio: 'ignore' });
  assert.deepEqual(await once(child, 'exit'), [37, null]);
  const residue = await readdir(directory);
  assert.ok(residue.length > 0 && residue.every(name => /^\.backlog-bootstrap-.*\.tmp(?:-journal)?$/.test(name)));
  if (process.platform !== 'win32') {
    for (const name of residue) assert.equal((await stat(join(directory, name))).mode & 0o077, 0);
  }
  openStore(dbPath, true).close();
  assert.deepEqual((await readdir(directory)).sort(), [...residue, basename(dbPath)].sort());
});

test('a database that appears during bootstrap is left alone even if empty', async t => {
  const { directory, dbPath } = await fixture(t);
  bootstrapSqlite(dbPath, db => {
    db.exec('CREATE TABLE staged (id)');
    // An independent creator wins while this process is still staging.
    using _winner = new DatabaseSync(dbPath);
  });
  assert.deepEqual(await readdir(directory), [basename(dbPath)]);
  assert.equal((await readFile(dbPath)).length, 0);
});

test('competing first starts never replace the published v2 DB and use private WAL files', async t => {
  const { directory, dbPath } = await fixture(t);
  const store = new URL('../src/store.ts', import.meta.url).href;
  const children = Array.from({ length: 6 }, (_, i) => spawn(process.execPath, ['--input-type=module', '-e', `
    import { openStore } from ${JSON.stringify(store)};
    if (process.platform !== 'win32') process.umask(0);
    process.send('ready');
    process.once('message', () => {
      const db = openStore(process.argv[1], true);
      db.createProject(process.argv[2]);
      db.close();
      process.disconnect();
    });`, dbPath, `Starter ${i}`], { cwd: directory, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] }));
  const results = children.map(async child => {
    let stderr = '';
    child.stderr!.on('data', chunk => { stderr += chunk; });
    return { exit: await once(child, 'close'), stderr };
  });
  try {
    await Promise.all(children.map(child => Promise.race([
      once(child, 'message'), once(child, 'exit').then(([status]) => assert.fail(`Starter exited before barrier: ${status}`)),
    ])));
    for (const child of children) child.send('start');
    for (const { exit, stderr } of await Promise.all(results)) assert.deepEqual(exit, [0, null], stderr);
  } finally {
    for (const child of children) if (child.exitCode === null) child.kill();
    await Promise.allSettled(results);
  }
  assert.deepEqual(await readdir(directory), [basename(dbPath)]);
  // Only the main file is needed to see both the fully committed schema and data.
  const uri = pathToFileURL(dbPath);
  uri.search = '?immutable=1';
  {
    using db = new DatabaseSync(uri, { readOnly: true });
    assert.equal(db.prepare('PRAGMA user_version').get()?.user_version, 2);
    assert.equal(db.prepare('SELECT version FROM named_graph_cutover').get()?.version, 2);
    assert.deepEqual(db.prepare('SELECT name FROM projects ORDER BY name').all().map(row => row.name),
      children.map((_, i) => `Starter ${i}`));
  }
  const reopened = openStore(dbPath, true);
  try {
    reopened.createProject('WAL write');
    if (process.platform !== 'win32') {
      for (const suffix of ['', '-wal', '-shm']) assert.equal((await stat(dbPath + suffix)).mode & 0o777, 0o600);
    }
  } finally { reopened.close(); }
});
