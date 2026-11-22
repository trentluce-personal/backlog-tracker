import { randomUUID } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { link, lstat, mkdir, open, readdir, rename, unlink } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { erModelInput, erName, erRevision, type SavedErModel } from './erd-schema.ts';
import type { SqliteDocuments } from './model-sqlite.ts';
import { HttpError, object } from './validation.ts';

export interface SavedErEntry { id: string; name: string; model: SavedErModel }
export type ErSummary = { id: string; name: string } & ({ available: true; revision: number } | { available: false; error: string });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const validId = (id: string) => id.length === 36 && uuid.test(id);
export const erdFile = (name: string) => name.startsWith('erd-') && name.endsWith('.json') && validId(name.slice(4, -5));
function erdId(id: string) {
  if (!validId(id)) throw new HttpError(400, 'Invalid SQL model ID.');
}

export function decodeErDocument(id: string, content: string, storage: 'file' | 'document' = 'file'): SavedErEntry {
  try {
    const value = object(JSON.parse(content), ['kind', 'schemaVersion', 'dialect', 'tables', 'foreignKeys', 'name', 'revision']);
    const { name: rawName, revision: rawRevision, ...rawModel } = value;
    const name = erName(rawName), revision = erRevision(rawRevision), model = erModelInput(rawModel);
    if (rawName !== name) throw new Error('Unnormalized name.');
    return { id, name, model: { ...model, revision } };
  } catch {
    throw new HttpError(500, `The SQL model ${storage} is invalid or unsupported. Restore a valid backup before saving.`);
  }
}

const encodeErDocument = (entry: SavedErEntry) => JSON.stringify({ ...entry.model, name: entry.name });
const notFound = () => new HttpError(404, 'SQL model not found.');
const queues = new Map<string, Promise<unknown>>();
async function serialize<T>(path: string, operation: () => Promise<T>): Promise<T> {
  const pending = (queues.get(path) ?? Promise.resolve()).catch(() => {}).then(operation);
  queues.set(path, pending);
  try { return await pending; }
  finally { if (queues.get(path) === pending) queues.delete(path); }
}
const storageError = () => new HttpError(500, 'Unable to access the SQL model file. Check directory permissions and available disk space.');

// ID injection is internal test support, never exposed through HTTP.
export function openErStore(modelPath: string, options: { generateId?: () => string; documents?: SqliteDocuments } = {}) {
  const legacyPath = resolve(modelPath), directory = dirname(legacyPath);
  const sql = options.documents;
  function pathFor(id: string) {
    erdId(id);
    const path = resolve(directory, `erd-${id}.json`);
    if (path === legacyPath) throw new HttpError(404, 'SQL model not found.');
    return path;
  }
  async function physical(id: string): Promise<{ entry: SavedErEntry; identity: Stats }> {
    const path = pathFor(id);
    let handle, content: string, identity: Stats;
    try {
      if (!(await readdir(directory)).includes(basename(path))) throw new HttpError(404, 'SQL model not found.');
      if (!(await lstat(path)).isFile()) throw storageError();
      handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      identity = await handle.stat();
      if (!identity.isFile()) throw storageError();
      content = await handle.readFile('utf8');
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new HttpError(404, 'SQL model not found.');
      throw storageError();
    } finally { await handle?.close(); }
    return { entry: decodeErDocument(id, content), identity };
  }
  function readSql(id: string) {
    erdId(id);
    let content;
    try { content = sql!.read(id); }
    catch { throw new HttpError(500, 'Unable to read SQLite ERD storage.'); }
    if (content === undefined) throw notFound();
    return decodeErDocument(id, content, 'document');
  }
  async function unchanged(path: string, identity: Stats) {
    const current = await lstat(path);
    if (!current.isFile() || current.dev !== identity.dev || current.ino !== identity.ino ||
        !(await readdir(directory)).includes(basename(path))) throw storageError();
  }
  async function publish(entry: SavedErEntry, identity?: Stats) {
    const path = pathFor(entry.id), temporary = resolve(directory, `.${basename(path)}.${randomUUID()}.tmp`);
    let handle;
    try {
      if (!identity) await mkdir(directory, { recursive: true });
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(JSON.stringify({ ...entry.model, name: entry.name }, null, 2) + '\n', 'utf8');
      await handle.chmod(identity ? identity.mode & 0o777 : 0o600);
      await handle.close(); handle = undefined;
      if (identity) { await unchanged(path, identity); await rename(temporary, path); }
      else await link(temporary, path);
    } catch (error) {
      if (!identity && (error as NodeJS.ErrnoException).code === 'EEXIST') throw error;
      throw storageError();
    } finally {
      await handle?.close().catch(() => {});
      await unlink(temporary).catch(() => {});
    }
  }
  function sorted(summaries: ErSummary[]) {
    return summaries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  }
  function summary(entry: SavedErEntry): ErSummary {
    return { id: entry.id, name: entry.name, available: true, revision: entry.model.revision };
  }
  return {
    async read(id: string): Promise<SavedErEntry> { return sql ? readSql(id) : (await physical(id)).entry; },
    async list(): Promise<ErSummary[]> {
      if (sql) {
        let rows;
        try { rows = sql.list(); }
        catch { throw new HttpError(500, 'Unable to list SQLite ERD storage.'); }
        return sorted(rows.map(({ id, document }): ErSummary => {
          try { return summary(decodeErDocument(id, document, 'document')); }
          catch { return { id, name: id, available: false, error: 'The SQL model document is invalid or unsupported.' }; }
        }));
      }
      let filenames: string[];
      try {
        filenames = (await readdir(directory, { withFileTypes: true })).filter(file => file.isFile() &&
          erdFile(file.name) &&
          resolve(directory, file.name) !== legacyPath).map(file => file.name);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw storageError();
      }
      const summaries: ErSummary[] = [];
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(8, filenames.length) }, async () => {
        while (next < filenames.length) {
          const id = filenames[next++]!.slice(4, -5);
          try {
            const { entry } = await physical(id);
            summaries.push(summary(entry));
          } catch (error) {
            summaries.push({ id, name: id, available: false, error: error instanceof HttpError ? error.message : 'Unable to read the SQL model file.' });
          }
        }
      }));
      return sorted(summaries);
    },
    async create(value: unknown): Promise<SavedErEntry> {
      const input = object(value, ['name', 'model']), name = erName(input.name), model = erModelInput(input.model);
      for (let attempt = 0; attempt < 10; attempt++) {
        const id = (options.generateId ?? randomUUID)();
        const entry = { id, name, model: { ...model, revision: 1 } };
        if (sql) {
          erdId(id);
          if (sql.write(() => sql.insert(id, encodeErDocument(entry)))) return entry;
          continue;
        }
        const path = pathFor(id);
        try { await serialize(path, () => publish(entry)); return entry; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      }
      throw new HttpError(500, 'Unable to allocate a unique SQL model ID. Try saving again.');
    },
    async save(id: string, value: unknown): Promise<SavedErEntry> {
      const path = sql ? undefined : pathFor(id);
      if (sql) erdId(id);
      const input = object(value, ['name', 'expectedRevision', 'model']);
      const name = erName(input.name), expectedRevision = erRevision(input.expectedRevision), model = erModelInput(input.model);
      function updated(current: SavedErEntry) {
        if (current.model.revision !== expectedRevision) throw new HttpError(409, 'The SQL model has changed. Reload it before saving again.');
        if (expectedRevision === Number.MAX_SAFE_INTEGER) throw new HttpError(500, 'The SQL model revision limit has been reached.');
        return { id, name, model: { ...model, revision: expectedRevision + 1 } };
      }
      if (sql) return sql.write(() => {
        const entry = updated(readSql(id));
        sql.update(id, encodeErDocument(entry));
        return entry;
      });
      return serialize(path!, async () => {
        const { entry: current, identity } = await physical(id);
        const entry = updated(current);
        await publish(entry, identity);
        return entry;
      });
    },
    async delete(id: string, value: unknown): Promise<void> {
      const path = sql ? undefined : pathFor(id);
      if (sql) erdId(id);
      const expectedRevision = erRevision(object(value, ['expectedRevision']).expectedRevision);
      if (sql) return sql.write(() => {
        if (readSql(id).model.revision !== expectedRevision) throw new HttpError(409, 'The SQL model has changed. Reload it before deleting.');
        sql.remove(id);
      });
      return serialize(path!, async () => {
        const { entry, identity } = await physical(id);
        if (entry.model.revision !== expectedRevision) throw new HttpError(409, 'The SQL model has changed. Reload it before deleting.');
        try { await unchanged(path!, identity); await unlink(path!); }
        catch { throw storageError(); }
      });
    },
  };
}
