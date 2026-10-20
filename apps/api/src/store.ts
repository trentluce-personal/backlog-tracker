import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { HttpError, type TaskInput } from './validation.ts';

export interface Project { id: string; name: string; createdAt: string }
export interface Task extends TaskInput { id: string; createdAt: string; updatedAt: string }

export function openStore(path: string) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;');
  const version = db.prepare('PRAGMA user_version').get()?.user_version;
  if (version !== 0 && version !== 1) {
    db.close();
    throw new Error('Unsupported database schema version.');
  }
  if (version === 0) db.exec(`
    BEGIN IMMEDIATE;
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
      createdAt TEXT NOT NULL
    );
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
      description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 5000),
      priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
      dueDate TEXT,
      status TEXT NOT NULL DEFAULT 'backlog' CHECK (status IN ('backlog', 'in_progress', 'done')),
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE INDEX tasks_projectId ON tasks(projectId);
    PRAGMA user_version = 1;
    COMMIT;
  `);

  function project(id: string): Project {
    const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!row) throw new HttpError(404, 'Project not found.');
    return row as unknown as Project;
  }
  function task(id: string): Task {
    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    if (!row) throw new HttpError(404, 'Task not found.');
    return row as unknown as Task;
  }
  function requireProject(id: string) {
    if (!db.prepare('SELECT id FROM projects WHERE id = ?').get(id)) throw new HttpError(400, 'Project does not exist.');
  }

  return {
    close: () => db.close(),
    projects: () => db.prepare('SELECT * FROM projects ORDER BY createdAt, id').all(),
    tasks: () => db.prepare('SELECT * FROM tasks ORDER BY createdAt, id').all(),
    createProject(name: string) {
      const id = randomUUID();
      db.prepare('INSERT INTO projects (id, name, createdAt) VALUES (?, ?, ?)').run(id, name, new Date().toISOString());
      return project(id);
    },
    updateProject(id: string, name: string) {
      project(id);
      db.prepare('UPDATE projects SET name = ? WHERE id = ?').run(name, id);
      return project(id);
    },
    deleteProject(id: string) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = db.prepare('DELETE FROM projects WHERE id = ?').run(id);
        if (!result.changes) throw new HttpError(404, 'Project not found.');
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    createTask(input: Partial<TaskInput>) {
      const data = { description: '', priority: 'medium', dueDate: null, status: 'backlog', ...input } as TaskInput;
      requireProject(data.projectId);
      const id = randomUUID();
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO tasks (id, projectId, title, description, priority, dueDate, status, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, data.projectId, data.title, data.description, data.priority, data.dueDate, data.status, now, now);
      return task(id);
    },
    updateTask(id: string, input: Partial<TaskInput>) {
      const data = { ...task(id), ...input };
      requireProject(data.projectId);
      db.prepare(`UPDATE tasks SET projectId = ?, title = ?, description = ?, priority = ?, dueDate = ?, status = ?, updatedAt = ? WHERE id = ?`)
        .run(data.projectId, data.title, data.description, data.priority, data.dueDate, data.status, new Date().toISOString(), id);
      return task(id);
    },
    deleteTask(id: string) {
      if (!db.prepare('DELETE FROM tasks WHERE id = ?').run(id).changes) throw new HttpError(404, 'Task not found.');
    },
  };
}
