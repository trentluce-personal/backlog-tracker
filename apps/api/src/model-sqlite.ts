import { lstatSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { decodeGraph, graphId } from './model-store.ts';
import { HttpError } from './validation.ts';

export interface ModelDocument { id: string; document: string }
export interface ModelBatch { named: ModelDocument[]; legacy?: ModelDocument; erds: ModelDocument[] }
type ImportSource = 'files' | 'named-v1';
export class ImportDestinationError extends Error {}
const namedTable = 'named_graph_documents';
const legacyTable = 'legacy_graph_document';
const erdTable = 'erd_documents';
// Keep the original marker name: older file runtimes refuse its presence,
// and the named-only runtime requires a row with version = 1.
const marker = 'named_graph_cutover';
const documentTable = (name: string) => `CREATE TABLE ${name} (
  id TEXT NOT NULL PRIMARY KEY${name === legacyTable ? " CHECK (id = 'legacy')" : ''},
  document TEXT NOT NULL CHECK (json_valid(document))
) STRICT`;
const markerTable = (version: 1 | 2) => `CREATE TABLE ${marker} (
  version INTEGER PRIMARY KEY CHECK (version = ${version})
) STRICT`;
export const sqliteSidecarSuffixes = ['-wal', '-shm', '-journal'] as const;

export function checkModelDatabaseFiles(path: string, offline = false): string | undefined {
  // Inspect the entries themselves, never the targets of file symlinks.
  const database = lstatSync(path, { throwIfNoEntry: false });
  if (!database?.isFile()) return 'SQLite model storage requires an existing regular SQLite file.';
  const broadMode = (mode: number) => process.platform !== 'win32' && (mode & 0o077) !== 0;
  const permissionsError = 'The SQLite database and its sidecars must have owner-only POSIX permissions (for example, mode 0600).';
  if (broadMode(database.mode)) return permissionsError;
  for (const suffix of sqliteSidecarSuffixes) {
    const sidecar = lstatSync(path + suffix, { throwIfNoEntry: false });
    if (!sidecar) continue;
    if (!sidecar.isFile()) return 'SQLite sidecars must be regular files.';
    if (broadMode(sidecar.mode)) return permissionsError;
    if (offline && suffix !== '-shm' && sidecar.size !== 0) {
      return 'Import requires a database with no pending WAL or journal. Stop all writers and check the database before retrying.';
    }
  }
}

export function openExistingDatabase(path: string, mode: 'read-only' | 'read-write') {
  const url = pathToFileURL(path);
  // Immutable mode cannot create or change sidecars, but also ignores WAL.
  url.search = mode === 'read-only' ? '?mode=ro&immutable=1' : '?mode=rw';
  return new DatabaseSync(url, { readOnly: mode === 'read-only' });
}

export function refuseFileModeAfterCutover(db: DatabaseSync) {
  if (modelSchema(db).length) {
    throw new Error('This database has SQLite model storage. Complete the offline all-model cutover if needed, then set BACKLOG_NAMED_MODEL_STORAGE=sqlite to start it.');
  }
}

function transaction<T>(db: DatabaseSync, work: () => T): T {
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

function modelSchema(db: DatabaseSync) {
  return db.prepare(`SELECT type, name, sql FROM sqlite_schema
    WHERE name COLLATE NOCASE IN (?, ?, ?, ?)
      OR (type IN ('trigger', 'index') AND sql IS NOT NULL AND tbl_name COLLATE NOCASE IN (?, ?, ?, ?))`)
    .all(namedTable, legacyTable, erdTable, marker, namedTable, legacyTable, erdTable, marker);
}

function hasCutover(db: DatabaseSync, schema: ReturnType<typeof modelSchema>, version: 1 | 2) {
  // Accept schema installed by the importer, not a partial or hand-built
  // substitute that happens to expose the same columns and marker value.
  const tables = version === 1 ? [namedTable] : [namedTable, legacyTable, erdTable];
  const expected = [...tables.map(documentTable), markerTable(version)];
  const normalize = (sql: string) => sql.trim().replace(/\s+/g, ' ');
  if (schema.length !== expected.length || !expected.every(sql => schema.some(row =>
    row.type === 'table' && typeof row.sql === 'string' && normalize(row.sql) === normalize(sql)))) return false;
  const versions = db.prepare(`SELECT version FROM ${marker}`).all();
  return versions.length === 1 && versions[0]?.version === version;
}

function isBacklogDatabase(db: DatabaseSync) {
  const version = db.prepare('PRAGMA user_version').get()?.user_version;
  if (version !== 1 && version !== 2) return false;
  try {
    const tables = db.prepare('PRAGMA main.table_list').all();
    if (!['projects', 'tasks'].every(name => tables.some(table => table.name === name && table.type === 'table'))) return false;
    const projects = db.prepare('PRAGMA main.table_xinfo(projects)').all();
    const tasks = db.prepare('PRAGMA main.table_xinfo(tasks)').all();
    const hasColumns = (columns: typeof tasks, names: string[]) =>
      names.every(name => columns.some(column => column.name === name && column.hidden === 0));
    if (!hasColumns(projects, ['id', 'name', 'createdAt']) ||
        !hasColumns(tasks, ['id', 'projectId', 'title', 'description', 'priority', 'dueDate', 'status', 'createdAt', 'updatedAt'])) return false;
    // Even a generated or differently cased column would collide with the v1 ALTER TABLE.
    return version === 1
      ? !tasks.some(column => String(column.name).toLowerCase() === 'duetime')
      : hasColumns(tasks, ['dueTime']);
  } catch {
    return false;
  }
}

function passesIntegrityCheck(db: DatabaseSync) {
  try { return db.prepare('PRAGMA integrity_check(1)').get()?.integrity_check === 'ok'; }
  catch { return false; }
}

export function checkImportDestination(db: DatabaseSync): ImportSource {
  if (!isBacklogDatabase(db)) throw new ImportDestinationError('Import requires an existing backlog database with a supported version and matching schema.');
  if (db.prepare('PRAGMA encoding').get()?.encoding !== 'UTF-8') {
    throw new ImportDestinationError('Import requires a UTF-8 SQLite database to preserve the original JSON bytes.');
  }
  if (!passesIntegrityCheck(db)) {
    throw new ImportDestinationError('SQLite integrity check failed. Restore a valid backup before importing.');
  }
  const schema = modelSchema(db);
  if (!schema.length) return 'files';
  if (hasCutover(db, schema, 1)) {
    for (const { id, bytes } of db.prepare(`SELECT id, CAST(document AS BLOB) AS bytes FROM ${namedTable}`).iterate()) {
      try {
        if (typeof id !== 'string' || !graphId(id) || !(bytes instanceof Uint8Array)) throw new Error();
        decodeGraph(id, new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes), 'SQLite');
      } catch { throw new ImportDestinationError('A named-only v1 document is invalid. Restore a valid coordinated backup before importing.'); }
    }
    return 'named-v1';
  }
  throw new ImportDestinationError('SQLite model storage is already cut over or has conflicting schema; import cannot be repeated or merged.');
}

export function importModelDocuments(db: DatabaseSync, source: ImportSource, batch: ModelBatch) {
  db.exec('PRAGMA busy_timeout = 5000; PRAGMA synchronous = FULL;');
  transaction(db, () => {
    if (checkImportDestination(db) !== source) throw new Error('The import destination changed after preflight.');
    function insert(table: string, rows: ModelDocument[]) {
      const statement = db.prepare(`INSERT INTO ${table} (id, document) VALUES (?, ?)`);
      for (const { id, document } of rows) statement.run(id, document);
    }
    if (source === 'files') {
      db.exec(documentTable(namedTable));
      insert(namedTable, batch.named);
    } else if (batch.named.length) throw new Error('Named files cannot be imported into a v1 database.');
    db.exec(`${documentTable(legacyTable)}; ${documentTable(erdTable)};`);
    if (batch.legacy) insert(legacyTable, [batch.legacy]);
    insert(erdTable, batch.erds);
    if (source === 'named-v1') db.exec(`DROP TABLE ${marker}`);
    db.exec(`${markerTable(2)}; INSERT INTO ${marker} (version) VALUES (2);`);
  });
}

export function sqliteModelNotReady() {
  return new Error('SQLite model storage is not ready. Run the offline all-model importer (model-import.js --dry-run, then --apply) or restore a valid v2 backup if the schema is damaged.');
}

export function checkSqliteModelStartup(db: DatabaseSync, checkIntegrity = true) {
  try {
    if (!isBacklogDatabase(db) || !hasCutover(db, modelSchema(db), 2) ||
        (checkIntegrity && !passesIntegrityCheck(db))) throw new Error();
  } catch {
    throw sqliteModelNotReady();
  }
}

export function openModelDocuments(db: DatabaseSync) {
  checkSqliteModelStartup(db, false); // Recheck the mode against the live connection.
  return { graphs: { named: openDocuments(db, namedTable), legacy: openDocuments(db, legacyTable) }, erds: openDocuments(db, erdTable) };
}

function openDocuments(db: DatabaseSync, table: string) {
  const read = db.prepare(`SELECT document FROM ${table} WHERE id = ?`);
  const list = db.prepare(`SELECT id, document FROM ${table}`);
  const insert = db.prepare(`INSERT INTO ${table} (id, document) VALUES (?, ?) ON CONFLICT(id) DO NOTHING`);
  const update = db.prepare(`UPDATE ${table} SET document = ? WHERE id = ?`);
  const remove = db.prepare(`DELETE FROM ${table} WHERE id = ?`);
  return {
    read: (id: string) => read.get(id)?.document as string | undefined,
    list: () => list.all() as unknown as ModelDocument[],
    insert: (id: string, document: string) => insert.run(id, document).changes === 1,
    update: (id: string, document: string) => update.run(document, id),
    remove: (id: string) => remove.run(id),
    write<T>(work: () => T): T {
      try { return transaction(db, work); }
      catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(500, 'Unable to write SQLite model storage. Check database availability and permissions.');
      }
    },
  };
}

export type SqliteDocuments = ReturnType<typeof openDocuments>;
export type ModelDocuments = ReturnType<typeof openModelDocuments>;
