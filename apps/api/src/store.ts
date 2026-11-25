import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync, realpathSync } from 'node:fs';
import { dirname } from 'node:path';
import { HttpError, resolveDueTime, type TagInput, type TaskInput } from './validation.ts';
import { checkModelDatabaseFiles, checkSqliteModelStartup, importModelDocuments, openExistingDatabase, openModelDocuments, refuseFileModeAfterCutover, sqliteModelNotReady, type ModelDocuments } from './model-sqlite.ts';
import { bootstrapSqlite } from './sqlite-bootstrap.ts';
import { checkSqliteStartup } from './sqlite-startup-check.ts';

export interface Project { id: string; name: string; createdAt: string }
export interface Tag extends TagInput { id: string; createdAt: string }
export interface Task extends TaskInput { id: string; createdAt: string; updatedAt: string }

export interface SqliteSchema {
  userVersion: number;
  tables: {
    name: string;
    ddl: string | null;
    columns: { position: number; name: string; declaredType: string; notNull: boolean; defaultSql: string | null; primaryKeyPosition: number }[];
    foreignKeys: { id: number; sequence: number; table: string; from: string; to: string | null; onUpdate: string; onDelete: string; match: string }[];
    indexes: { name: string; unique: boolean; origin: string; partial: boolean; ddl: string | null; columns: { sequence: number; position: number; name: string | null }[] }[];
  }[];
}

export interface BackendSchemaResponse {
  sqlite: SqliteSchema;
  jsonStorage: { name: string; schemaVersion: number; fields: string[]; collections: { name: string; fields: string[] }[] }[];
}

function migrateBacklog(db: DatabaseSync) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const version = db.prepare('PRAGMA user_version').get()?.user_version;
    if (version !== 0 && version !== 1 && version !== 2 && version !== 3) throw new Error('Unsupported database schema version.');
    if (version === 0) db.exec(`
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
    `);
    if (version < 2) db.exec(`
      ALTER TABLE tasks ADD COLUMN dueTime TEXT CHECK (
        dueTime IS NULL OR (
          dueDate IS NOT NULL AND typeof(dueTime) = 'text' AND instr(dueTime, char(0)) = 0
          AND dueTime GLOB '[0-2][0-9]:[0-5][0-9]' AND dueTime <= '23:59'
        )
      );
    `);
    if (version < 3) db.exec(`
      CREATE TABLE tags (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 50),
        color TEXT NOT NULL DEFAULT 'slate' CHECK (color IN ('slate', 'blue', 'teal', 'gold', 'purple', 'red')),
        createdAt TEXT NOT NULL
      );
      CREATE UNIQUE INDEX tags_name_unique ON tags(name COLLATE NOCASE);
      CREATE TABLE task_tags (
        taskId TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        tagId TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (taskId, tagId)
      );
      CREATE INDEX task_tags_tagId ON task_tags(tagId);
      PRAGMA user_version = 3;
    `);
    db.exec('COMMIT');
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}

export function openStore(path: string, sqliteModels = false) {
  const db = sqliteModels ? openEnabledDatabase(path) : openFileModeDatabase(path);
  let modelDocuments: ModelDocuments | undefined;
  try {
    db.exec('PRAGMA busy_timeout = 5000;');
    if (sqliteModels) modelDocuments = openModelDocuments(db);
    else refuseFileModeAfterCutover(db);
    db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
    // The backlog schema is independent of the model marker and is upgraded
    // whenever it is behind the current version.
    if (db.prepare('PRAGMA user_version').get()?.user_version !== 3) migrateBacklog(db);
  } catch (error) {
    db.close();
    throw error;
  }

  function project(id: string): Project {
    const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!row) throw new HttpError(404, 'Project not found.');
    return row as unknown as Project;
  }
  function tagRow(id: string): Tag {
    const row = db.prepare('SELECT * FROM tags WHERE id = ?').get(id);
    if (!row) throw new HttpError(404, 'Tag not found.');
    return row as unknown as Tag;
  }
  function taskTags(id: string): string[] {
    return db.prepare('SELECT tagId FROM task_tags WHERE taskId = ? ORDER BY tagId').all(id).map(row => String(row.tagId));
  }
  function task(id: string): Task {
    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    if (!row) throw new HttpError(404, 'Task not found.');
    return { ...(row as unknown as Task), tagIds: taskTags(id) };
  }
  function requireProject(id: string) {
    if (!db.prepare('SELECT id FROM projects WHERE id = ?').get(id)) throw new HttpError(400, 'Project does not exist.');
  }
  function requireTags(ids: string[]) {
    const exists = db.prepare('SELECT id FROM tags WHERE id = ?');
    for (const tagId of ids) if (!exists.get(tagId)) throw new HttpError(400, 'Tag does not exist.');
    return ids;
  }
  function requireUniqueTagName(name: string, excludeId = '') {
    if (db.prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE AND id != ?').get(name, excludeId)) {
      throw new HttpError(400, 'A tag with that name already exists.');
    }
  }
  function replaceTaskTags(taskId: string, ids: string[]) {
    db.prepare('DELETE FROM task_tags WHERE taskId = ?').run(taskId);
    const insert = db.prepare('INSERT INTO task_tags (taskId, tagId) VALUES (?, ?)');
    for (const tagId of ids) insert.run(taskId, tagId);
  }
  function transaction<T>(work: () => T): T {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw error;
    }
  }

  return {
    modelDocuments,
    close: () => db.close(),
    backendSchema(): SqliteSchema {
      // Identifiers come only from SQLite metadata, never request parameters.
      const identifier = (name: string) => `"${name.replaceAll('"', '""')}"`;
      const schema = db.prepare("SELECT type, name, sql FROM sqlite_schema WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name").all();
      return {
        userVersion: Number(db.prepare('PRAGMA user_version').get()!.user_version),
        tables: schema.filter(row => row.type === 'table').map(table => {
          const name = String(table.name);
          return {
            name, ddl: table.sql === null ? null : String(table.sql),
            columns: db.prepare(`PRAGMA table_info(${identifier(name)})`).all().map(column => ({
              position: Number(column.cid), name: String(column.name), declaredType: String(column.type),
              notNull: Boolean(column.notnull), defaultSql: column.dflt_value === null ? null : String(column.dflt_value),
              primaryKeyPosition: Number(column.pk),
            })),
            foreignKeys: db.prepare(`PRAGMA foreign_key_list(${identifier(name)})`).all().map(key => ({
              id: Number(key.id), sequence: Number(key.seq), table: String(key.table), from: String(key.from),
              to: key.to === null ? null : String(key.to), onUpdate: String(key.on_update), onDelete: String(key.on_delete), match: String(key.match),
            })),
            indexes: db.prepare(`PRAGMA index_list(${identifier(name)})`).all().map(index => ({
              name: String(index.name), unique: Boolean(index.unique), origin: String(index.origin), partial: Boolean(index.partial),
              ddl: (schema.find(row => row.type === 'index' && row.name === index.name)?.sql as string | undefined) ?? null,
              columns: db.prepare(`PRAGMA index_info(${identifier(String(index.name))})`).all().map(column => ({
                sequence: Number(column.seqno), position: Number(column.cid), name: column.name === null ? null : String(column.name),
              })),
            })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
          };
        }),
      };
    },
    projects: () => db.prepare('SELECT * FROM projects ORDER BY createdAt, id').all() as unknown as Project[],
    tags: () => db.prepare('SELECT * FROM tags ORDER BY name COLLATE NOCASE, id').all() as unknown as Tag[],
    tasks() {
      const rows = db.prepare('SELECT * FROM tasks ORDER BY createdAt, id').all();
      const links = db.prepare('SELECT taskId, tagId FROM task_tags ORDER BY tagId').all();
      const byTask = new Map<string, string[]>();
      for (const link of links) {
        const taskId = String(link.taskId);
        byTask.set(taskId, [...(byTask.get(taskId) ?? []), String(link.tagId)]);
      }
      return rows.map(row => ({ ...(row as unknown as Task), tagIds: byTask.get(String(row.id)) ?? [] })) as Task[];
    },
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
      transaction(() => {
        const result = db.prepare('DELETE FROM projects WHERE id = ?').run(id);
        if (!result.changes) throw new HttpError(404, 'Project not found.');
      });
    },
    createTag(input: TagInput) {
      requireUniqueTagName(input.name);
      const id = randomUUID();
      db.prepare('INSERT INTO tags (id, name, color, createdAt) VALUES (?, ?, ?, ?)').run(id, input.name, input.color, new Date().toISOString());
      return tagRow(id);
    },
    updateTag(id: string, input: Partial<TagInput>) {
      const previous = tagRow(id);
      const name = input.name ?? previous.name;
      const color = input.color ?? previous.color;
      requireUniqueTagName(name, id);
      db.prepare('UPDATE tags SET name = ?, color = ? WHERE id = ?').run(name, color, id);
      return tagRow(id);
    },
    deleteTag(id: string) {
      if (!db.prepare('DELETE FROM tags WHERE id = ?').run(id).changes) throw new HttpError(404, 'Tag not found.');
    },
    createTask(input: Partial<TaskInput>) {
      const data = { description: '', priority: 'medium', dueDate: null, status: 'backlog', tagIds: [], ...input } as TaskInput;
      requireProject(data.projectId);
      const tagIds = requireTags(data.tagIds ?? []);
      const dueTime = resolveDueTime(data.dueDate, input.dueTime);
      const id = randomUUID();
      const now = new Date().toISOString();
      transaction(() => {
        db.prepare(`INSERT INTO tasks (id, projectId, title, description, priority, dueDate, dueTime, status, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, data.projectId, data.title, data.description, data.priority, data.dueDate, dueTime, data.status, now, now);
        replaceTaskTags(id, tagIds);
      });
      return task(id);
    },
    updateTask(id: string, input: Partial<TaskInput>) {
      const previous = task(id);
      const data = { ...previous, ...input };
      requireProject(data.projectId);
      const tagIds = input.tagIds === undefined ? previous.tagIds : requireTags(input.tagIds);
      const dueTime = resolveDueTime(data.dueDate, input.dueTime, previous.dueTime);
      transaction(() => {
        db.prepare(`UPDATE tasks SET projectId = ?, title = ?, description = ?, priority = ?, dueDate = ?, dueTime = ?, status = ?, updatedAt = ? WHERE id = ?`)
          .run(data.projectId, data.title, data.description, data.priority, data.dueDate, dueTime, data.status, new Date().toISOString(), id);
        if (input.tagIds !== undefined) replaceTaskTags(id, tagIds);
      });
      return task(id);
    },
    deleteTask(id: string) {
      if (!db.prepare('DELETE FROM tasks WHERE id = ?').run(id).changes) throw new HttpError(404, 'Task not found.');
    },
  };
}

function openEnabledDatabase(path: string) {
  if (path === ':memory:' || !path) throw new Error('SQLite model storage requires a regular SQLite file.');
  bootstrapSqlite(path, db => {
    migrateBacklog(db);
    importModelDocuments(db, 'files', { named: [], erds: [] });
  });
  const problem = checkModelDatabaseFiles(path);
  if (problem) throw new Error(problem);
  try {
    if (!checkSqliteStartup(path, checkSqliteModelStartup)) throw sqliteModelNotReady();
    return openExistingDatabase(path, 'read-write');
  }
  catch { throw sqliteModelNotReady(); }
}

function openFileModeDatabase(path: string) {
  if (path === ':memory:' || !path) return new DatabaseSync(path);
  let target = path;
  try { target = realpathSync(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (checkSqliteStartup(target, refuseFileModeAfterCutover)) return openExistingDatabase(target, 'read-write');
  mkdirSync(dirname(path), { recursive: true });
  return new DatabaseSync(path);
}
