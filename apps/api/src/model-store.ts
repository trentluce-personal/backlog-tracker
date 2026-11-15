import { randomUUID } from 'node:crypto';
import { constants, type Dirent } from 'node:fs';
import { link, lstat, mkdir, open, readdir, rename, unlink } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { HttpError, object } from './validation.ts';
import { modelInput, emptyModel, displayName, type ModelInput, type Model, type DefinitionNode } from './model-schema.ts';
export * from './model-schema.ts';

export interface NamedModel { id: string; name: string; model: Model }
export type ModelSummary = { id: string; name: string; deletable: boolean } & ({ available: true; revision: number } | { available: false; error: string });
// Shared across app instances in one process; cross-process writers need an external lock.
const saves = new Map<string, Promise<unknown>>();
function revision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new HttpError(400, 'Revision must be a nonnegative safe integer.');
  return value;
}
function referenceContext(model: ModelInput, id: string) {
  for (const node of [...model.nodes, ...model.relationshipTypes]) {
    if (node.kind === 'reference' && (node.classification === 'Internal Reference') !== (node.target.modelId === id)) {
      throw new HttpError(400, 'Reference classification must match the containing model context.');
    }
  }
}

async function validateReferences(model: ModelInput, id: string, current: ModelInput | undefined,
  readTarget: (id: string) => Promise<NamedModel>) {
  referenceContext(model, id);
  const targets = new Map<string, Promise<NamedModel>>();
  for (const node of [...model.nodes, ...model.relationshipTypes]) {
    if (node.kind !== 'reference') continue;
    const isNode = 'nodeId' in node.target;
    const targetId = 'nodeId' in node.target ? node.target.nodeId : node.target.relationshipTypeId;
    const previous = [...(current?.nodes ?? []), ...(current?.relationshipTypes ?? [])].find(candidate => candidate.id === node.id);
    if (previous?.kind === 'reference' && previous.classification === node.classification &&
        JSON.stringify(previous.target) === JSON.stringify(node.target)) continue;
    let target: ModelInput;
    if (node.classification === 'Internal Reference') target = model;
    else {
      let pending = targets.get(node.target.modelId);
      if (!pending) { pending = readTarget(node.target.modelId); targets.set(node.target.modelId, pending); }
      try { target = (await pending).model; }
      catch { throw new HttpError(400, 'Reference target must be an available saved definition.'); }
    }
    if (!(isNode ? target.nodes : target.relationshipTypes).some(candidate => candidate.id === targetId && candidate.kind === 'definition')) {
      throw new HttpError(400, 'Reference target must be an available definition.');
    }
  }
}

async function serialize<T>(path: string, operation: () => Promise<T>): Promise<T> {
  const pending = (saves.get(path) ?? Promise.resolve()).catch(() => {}).then(operation);
  saves.set(path, pending);
  try { return await pending; }
  finally { if (saves.get(path) === pending) saves.delete(path); }
}

async function writeModel(path: string, model: Model & { name?: string }, createOnly = false, createDirectory = true) {
  // Check the final publication candidate, including rebased references, before
  // creating a directory or temporary file. No successful save may be unreadable.
  modelInput(model, true, Object.hasOwn(model, 'name'));
  revision(model.revision);
  if (Object.hasOwn(model, 'name')) displayName(model.name);
  const temporary = resolve(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  let handle;
  try {
    let mode = 0o600;
    if (!createOnly) {
      try {
        const existing = await lstat(path);
        if (!existing.isFile()) throw new Error('Model destination must be a regular file.');
        mode = existing.mode & 0o777;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    if (createDirectory) await mkdir(dirname(path), { recursive: true });
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(JSON.stringify(model, null, 2) + '\n', 'utf8');
    // Apply after writing, independent of umask. Ownership/ACLs are not copied;
    // shared writers need a setgid parent directory and deliberate group modes.
    await handle.chmod(mode);
    await handle.close();
    handle = undefined;
    if (createOnly) await link(temporary, path); // Atomic publication; never replaces an existing entry.
    else {
      if (!createDirectory && !(await lstat(path)).isFile()) throw new Error('Model destination must be a regular file.');
      await rename(temporary, path);
    }
  } catch (error) {
    if (createOnly && (error as NodeJS.ErrnoException).code === 'EEXIST') throw error;
    throw new HttpError(500, 'Unable to save the model file. Check directory permissions and available disk space.');
  } finally {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
  }
}

async function readPhysicalFile(path: string) {
  let handle;
  try {
    // Require the exact directory entry even on case-insensitive filesystems.
    if (!(await readdir(dirname(path))).includes(basename(path))) throw new HttpError(404, 'Model not found.');
    // lstat distinguishes a dangling symlink from a genuinely missing path.
    if (!(await lstat(path)).isFile()) throw new Error('Not a regular file.');
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const identity = await handle.stat();
    if (!identity.isFile()) throw new Error('Not a regular file.');
    return { content: await handle.readFile('utf8'), identity };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new HttpError(404, 'Model not found.');
    throw new HttpError(500, 'Unable to read the model file. Check its location and permissions.');
  } finally { await handle?.close(); }
}

export function openModelStore(modelPath: string) {
  const path = resolve(modelPath);
  async function read(): Promise<Model> {
    let content: string;
    try { ({ content } = await readPhysicalFile(path)); }
    catch (error) {
      if (error instanceof HttpError && error.status === 404) return { ...emptyModel(), revision: 0 };
      throw error;
    }
    try {
      const value = JSON.parse(content);
      const model = modelInput(value, true);
      referenceContext(model, 'legacy');
      return { ...model, revision: revision(value.revision) };
    } catch {
      throw new HttpError(500, 'The model file is invalid or unsupported. Restore a valid backup before saving.');
    }
  }

  return {
    read,
    async save(value: unknown): Promise<Model> {
      const input = object(value, ['expectedRevision', 'model']);
      const expectedRevision = revision(input.expectedRevision);
      const model = modelInput(input.model);
      return serialize(path, async () => {
        const current = await read();
        if (current.revision !== expectedRevision) throw new HttpError(409, 'The model has changed. Reload it before saving again.');
        if (current.revision === Number.MAX_SAFE_INTEGER) throw new HttpError(500, 'The model revision limit has been reached.');
        await validateReferences(model, 'legacy', current, async id => (await openNamedModelStore(path).readPhysical(id)).entry);
        const persisted = { ...model, revision: current.revision + 1 };
        await writeModel(path, persisted);
        return persisted;
      });
    },
  };
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const legacyName = 'Legacy model';

function namedId(value: string): string {
  if (value.length !== 36 || !uuid.test(value)) throw new HttpError(400, 'Invalid model ID.');
  return value;
}

// ID injection is internal test support, never exposed by the HTTP API.
export function openNamedModelStore(modelPath: string, options: { generateId?: () => string } = {}) {
  const legacyPath = resolve(modelPath);
  const directory = dirname(legacyPath);
  const generateId = options.generateId ?? randomUUID;

  function pathFor(id: string) {
    const path = resolve(directory, `${namedId(id)}.json`);
    if (path === legacyPath) throw new HttpError(404, 'Model not found.');
    return path;
  }

  async function readPhysical(id: string) {
    const path = id === 'legacy' ? legacyPath : pathFor(id);
    const { content, identity } = await readPhysicalFile(path);
    try {
      const value = JSON.parse(content);
      const model = modelInput(value, true, id !== 'legacy');
      referenceContext(model, id);
      const name = id === 'legacy' ? legacyName : displayName(value.name);
      if (id !== 'legacy' && name !== value.name) throw new Error('Stored name must be trimmed.');
      return { entry: { id, name, model: { ...model, revision: revision(value.revision) } }, identity, sourceSchemaVersion: value.schemaVersion as 1 | 2 | 3 };
    } catch {
      throw new HttpError(500, 'The model file is invalid or unsupported. Restore a valid backup before saving.');
    }
  }

  async function read(id: string): Promise<NamedModel> {
    try { return (await readPhysical(id)).entry; }
    catch (error) {
      if (id === 'legacy' && error instanceof HttpError && error.status === 404) {
        return { id, name: legacyName, model: { ...emptyModel(), revision: 0 } };
      }
      throw error;
    }
  }

  async function physicalIds() {
    let entries: Dirent[];
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new HttpError(500, 'Unable to list model files. Check directory permissions.');
      }
      entries = [];
    }
    return [...(entries.some(entry => entry.name === basename(legacyPath)) ? ['legacy'] : []),
      ...entries.filter(entry => entry.isFile() && entry.name.endsWith('.json') &&
      entry.name.length === 41 && uuid.test(entry.name.slice(0, -5)) && resolve(directory, entry.name) !== legacyPath)
      .map(entry => entry.name.slice(0, -5))];
  }

  async function catalogEntries() {
    const ids = await physicalIds();
    const results: ({ available: true; entry: NamedModel; sourceSchemaVersion: 1 | 2 | 3 } | { available: false; id: string; name: string; error: string })[] = [];
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(8, ids.length) }, async () => {
      while (next < ids.length) {
        const id = ids[next++]!;
        try {
          const { entry, sourceSchemaVersion } = await readPhysical(id);
          results.push({ available: true, entry, sourceSchemaVersion });
        } catch (error) {
          results.push({ id, name: id === 'legacy' ? legacyName : id, available: false,
            error: error instanceof HttpError ? error.message : 'Unable to read the model file.' });
        }
      }
    }));
    return results;
  }

  return {
    read,
    readPhysical,
    async definitions(rich = false) {
      const models = (await catalogEntries()).map(result => {
        if (!result.available) return result;
        const { id, name, model } = result.entry;
        return { id, name, available: true as const, revision: model.revision,
          ...(rich ? { sourceSchemaVersion: result.sourceSchemaVersion, relationshipTypes: model.relationshipTypes.filter(t => t.kind === 'definition'), constraints: model.constraints, indexes: model.indexes } : {}),
          definitions: model.nodes.filter((node): node is DefinitionNode => node.kind === 'definition')
            .map(({ x, y, ...definition }) => definition) };
      });
      return models.sort(compareModels);
    },
    async list(): Promise<ModelSummary[]> {
      const models: ModelSummary[] = (await catalogEntries()).map(result => result.available
        ? { id: result.entry.id, name: result.entry.name, revision: result.entry.model.revision, available: true, deletable: true }
        : { ...result, deletable: false });
      return models.sort(compareModels);
    },
    async delete(id: string, value: unknown): Promise<void> {
      const path = id === 'legacy' ? legacyPath : pathFor(id);
      const input = object(value, ['expectedRevision']);
      const expectedRevision = revision(input.expectedRevision);
      return serialize(path, async () => {
        const { entry, identity } = await readPhysical(id);
        if (entry.model.revision !== expectedRevision) throw new HttpError(409, 'The model has changed. Reload it before deleting.');
        try {
          // Reject a replaced/nonregular entry before unlinking. External writers
          // still require an external lock; this queue covers this process only.
          const current = await lstat(path);
          if (!current.isFile() || current.dev !== identity.dev || current.ino !== identity.ino ||
              !(await readdir(directory)).includes(basename(path))) throw new Error('Model destination changed.');
          await unlink(path);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new HttpError(404, 'Model not found.');
          throw new HttpError(500, 'Unable to delete the model file. Check directory permissions.');
        }
      });
    },
    async create(value: unknown): Promise<NamedModel> {
      const input = object(value, ['name', 'model']);
      const name = displayName(input.name);
      const submitted = modelInput(input.model);
      for (let attempt = 0; attempt < 10; attempt++) {
        const id = namedId(generateId());
        const path = pathFor(id);
        const model: Model = { ...submitted, revision: 1, nodes: submitted.nodes.map(node =>
          node.kind === 'reference' && node.classification === 'Internal Reference'
             ? { ...node, target: { ...node.target, modelId: id } } : node),
          relationshipTypes: submitted.relationshipTypes.map(type => type.kind === 'reference' && type.classification === 'Internal Reference'
            ? { ...type, target: { ...type.target, modelId: id } } : type) };
        await validateReferences(model, id, undefined, async targetId => (await readPhysical(targetId)).entry);
        try {
          await writeModel(path, { ...model, name }, true);
          return { id, name, model };
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        }
      }
      throw new HttpError(500, 'Unable to allocate a unique model ID. Try saving again.');
    },
    async save(id: string, value: unknown): Promise<NamedModel> {
      const path = pathFor(id);
      const input = object(value, ['expectedRevision', 'name', 'model']);
      const expectedRevision = revision(input.expectedRevision);
      const name = displayName(input.name);
      const model = modelInput(input.model);
      return serialize(path, async () => {
        const current = await read(id);
        if (current.model.revision !== expectedRevision) throw new HttpError(409, 'The model has changed. Reload it before saving again.');
        if (expectedRevision === Number.MAX_SAFE_INTEGER) throw new HttpError(500, 'The model revision limit has been reached.');
        await validateReferences(model, id, current.model, async targetId => (await readPhysical(targetId)).entry);
        const persisted = { ...model, revision: expectedRevision + 1 };
        await writeModel(path, { ...persisted, name }, false, false);
        return { id, name, model: persisted };
      });
    },
  };
}

function compareModels(a: { id: string; name: string }, b: { id: string; name: string }) {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
