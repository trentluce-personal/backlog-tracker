import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test, type TestContext } from 'node:test';
import { openStore } from '../src/store.ts';

async function databasePath(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'task-due-migration-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return join(directory, 'test.sqlite');
}

test('v1 migration preserves rows, indexes and cascade; SQLite enforces canonical time and date pairing', async t => {
  const path = await databasePath(t);
  using legacy = new DatabaseSync(path);
  legacy.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, createdAt TEXT NOT NULL);
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', priority TEXT NOT NULL DEFAULT 'medium',
      dueDate TEXT, status TEXT NOT NULL DEFAULT 'backlog', createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    );
    CREATE INDEX tasks_projectId ON tasks(projectId);
    INSERT INTO projects VALUES ('p1', 'Project', 'created');
    INSERT INTO tasks VALUES ('t1', 'p1', 'Task', 'Details', 'high', '2028-02-29', 'in_progress', 'created', 'updated');
    INSERT INTO tasks VALUES ('t2', 'p1', 'Undated', '', 'medium', NULL, 'backlog', 'created', 'updated');
    PRAGMA user_version = 1;
  `);
  const originalTasks = legacy.prepare('SELECT * FROM tasks ORDER BY id').all();
  const originalProjects = legacy.prepare('SELECT * FROM projects').all();
  const migrated = openStore(path);
  try {
    const schema = migrated.backendSchema();
    assert.equal(schema.userVersion, 2);
    assert.ok(schema.tables.find(table => table.name === 'tasks')?.indexes.some(index => index.name === 'tasks_projectId'));
    assert.deepEqual(legacy.prepare('SELECT * FROM projects').all(), originalProjects);
    assert.deepEqual(legacy.prepare('SELECT * FROM tasks ORDER BY id').all().map(row => ({ ...row })), originalTasks.map(row => ({ ...row, dueTime: null })));

    const setTime = legacy.prepare('UPDATE tasks SET dueTime = ? WHERE id = ?');
    for (const value of ['24:00', '29:59', '12:60', '1:00', '12:00:00', '12:00\0extra', '12:00\n', 1230, Buffer.from('12:00')]) {
      assert.throws(() => setTime.run(value, 't1'), /CHECK constraint failed/);
    }
    assert.throws(() => setTime.run('00:00', 't2'), /CHECK constraint failed/);
    assert.equal(setTime.run('00:00', 't1').changes, 1);
    assert.equal(setTime.run('23:59', 't1').changes, 1);
    assert.throws(() => legacy.exec("UPDATE tasks SET dueDate = NULL WHERE id = 't1'"), /CHECK constraint failed/);
    migrated.deleteProject('p1');
    assert.deepEqual(migrated.tasks(), []);
  } finally { migrated.close(); }
});

test('failed migration releases the transaction and unsupported versions remain untouched', async t => {
  const path = await databasePath(t);
  using db = new DatabaseSync(path);
  db.exec('CREATE TABLE projects (id TEXT); PRAGMA user_version = 1');
  assert.throws(() => openStore(path), /no such table: tasks/);
  assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, 1);
  db.exec('BEGIN IMMEDIATE; PRAGMA user_version = 99; COMMIT');
  assert.throws(() => openStore(path), /Unsupported database schema version/);
  assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, 99);
  db.exec('BEGIN IMMEDIATE; ROLLBACK');
});
