import { randomUUID } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { link, lstat, mkdir, open, readdir, rename, unlink } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { erModelInput, erName, erRevision, type SavedErModel } from './erd-schema.ts';
import { HttpError, object } from './validation.ts';

export interface SavedErEntry { id: string; name: string; model: SavedErModel }
export type ErSummary = { id: string; name: string } & ({ available: true; revision: number } | { available: false; error: string });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const queues = new Map<string, Promise<unknown>>();
async function serialize<T>(path: string, operation: () => Promise<T>): Promise<T> {
  const pending = (queues.get(path) ?? Promise.resolve()).catch(() => {}).then(operation);
  queues.set(path, pending);
  try { return await pending; }
  finally { if (queues.get(path) === pending) queues.delete(path); }
}
const storageError = () => new HttpError(500, 'Unable to access the SQL model file. Check directory permissions and available disk space.');

// ID injection is internal test support, never exposed through HTTP.
export function openErStore(modelPath: string, options: { generateId?: () => string } = {}) {
  const legacyPath = resolve(modelPath), directory = dirname(legacyPath);
  function pathFor(id: string) {
    if (id.length !== 36 || !uuid.test(id)) throw new HttpError(400, 'Invalid SQL model ID.');
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
    try {
      const value = object(JSON.parse(content), ['kind', 'schemaVersion', 'dialect', 'tables', 'foreignKeys', 'name', 'revision']);
      const { name: rawName, revision: rawRevision, ...rawModel } = value;
      const name = erName(rawName), revision = erRevision(rawRevision), model = erModelInput(rawModel);
      if (rawName !== name) throw new Error('Unnormalized name.');
      return { entry: { id, name, model: { ...model, revision } }, identity };
    } catch {
      throw new HttpError(500, 'The SQL model file is invalid or unsupported. Restore a valid backup before saving.');
    }
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
  return {
    async read(id: string): Promise<SavedErEntry> { return (await physical(id)).entry; },
    async list(): Promise<ErSummary[]> {
      let filenames: string[];
      try {
        filenames = (await readdir(directory, { withFileTypes: true })).filter(file => file.isFile() &&
          file.name.startsWith('erd-') && file.name.endsWith('.json') && uuid.test(file.name.slice(4, -5)) &&
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
            summaries.push({ id, name: entry.name, available: true, revision: entry.model.revision });
          } catch (error) {
            summaries.push({ id, name: id, available: false, error: error instanceof HttpError ? error.message : 'Unable to read the SQL model file.' });
          }
        }
      }));
      return summaries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    },
    async create(value: unknown): Promise<SavedErEntry> {
      const input = object(value, ['name', 'model']), name = erName(input.name), model = erModelInput(input.model);
      for (let attempt = 0; attempt < 10; attempt++) {
        const id = (options.generateId ?? randomUUID)();
        const path = pathFor(id);
        const entry = { id, name, model: { ...model, revision: 1 } };
        try { await serialize(path, () => publish(entry)); return entry; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      }
      throw new HttpError(500, 'Unable to allocate a unique SQL model ID. Try saving again.');
    },
    async save(id: string, value: unknown): Promise<SavedErEntry> {
      const path = pathFor(id), input = object(value, ['name', 'expectedRevision', 'model']);
      const name = erName(input.name), expectedRevision = erRevision(input.expectedRevision), model = erModelInput(input.model);
      return serialize(path, async () => {
        const { entry: current, identity } = await physical(id);
        if (current.model.revision !== expectedRevision) throw new HttpError(409, 'The SQL model has changed. Reload it before saving again.');
        if (expectedRevision === Number.MAX_SAFE_INTEGER) throw new HttpError(500, 'The SQL model revision limit has been reached.');
        const entry = { id, name, model: { ...model, revision: expectedRevision + 1 } };
        await publish(entry, identity);
        return entry;
      });
    },
    async delete(id: string, value: unknown): Promise<void> {
      const path = pathFor(id), expectedRevision = erRevision(object(value, ['expectedRevision']).expectedRevision);
      return serialize(path, async () => {
        const { entry, identity } = await physical(id);
        if (entry.model.revision !== expectedRevision) throw new HttpError(409, 'The SQL model has changed. Reload it before deleting.');
        try { await unchanged(path, identity); await unlink(path); }
        catch { throw storageError(); }
      });
    },
  };
}
