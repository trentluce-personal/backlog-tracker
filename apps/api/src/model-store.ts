import { randomUUID } from 'node:crypto';
import { constants, type Dirent } from 'node:fs';
import { link, lstat, mkdir, open, readdir, rename, unlink } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { HttpError, object } from './validation.ts';

export type NodeClassification = 'Transactional' | 'Master Data' | 'Reference Data' | 'Metadata';
export interface ModelProperty {
  name: string; dataType: string; description: string;
  nodeKey: boolean; uniqueness: boolean; mustExist: boolean; index: 'None' | 'Range' | 'Text' | 'Point';
}
export interface DefinitionNode { kind: 'definition'; id: string; name: string; x: number; y: number; classification: NodeClassification; draft: boolean; properties: ModelProperty[] }
export interface ReferenceNode {
  kind: 'reference'; id: string; name: string; x: number; y: number;
  classification: 'Internal Reference' | 'External Reference'; target: { modelId: string; nodeId: string };
}
export type ModelNode = DefinitionNode | ReferenceNode;
export type RelationshipCardinality = '0..*' | '1..*' | '1..1';
export interface ModelRelationship {
  id: string; name: string; source: string; target: string;
  sourceCardinality: RelationshipCardinality; targetCardinality: RelationshipCardinality;
}
export interface ModelInput { schemaVersion: 2; nodes: ModelNode[]; relationships: ModelRelationship[] }
export interface Model extends ModelInput { revision: number }
export interface NamedModel { id: string; name: string; model: Model }
export type ModelSummary = { id: string; name: string; deletable: boolean } & (
  { available: true; revision: number } | { available: false; error: string }
);

// Shared by all app instances in this process. Cross-process writers need an external lock.
const saves = new Map<string, Promise<unknown>>();

function revision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new HttpError(400, 'Revision must be a nonnegative safe integer.');
  }
  return value;
}

function modelId(value: unknown, prefix: string): string {
  if (typeof value !== 'string' || value.trim() !== value || !new RegExp(`^${prefix}-[0-9]+$`).test(value) ||
      !Number.isSafeInteger(Number(value.slice(prefix.length + 1)))) {
    throw new HttpError(400, `Invalid ${prefix} ID.`);
  }
  return value;
}

function name(value: unknown, relationship = false): string {
  if (typeof value !== 'string' || value.trim() !== value || value.length > 24 ||
      !(relationship ? /^[A-Z]+(?:_[A-Z]+)*$/ : /^[A-Z][A-Za-z]*$/).test(value)) {
    throw new HttpError(400, relationship
      ? 'Relationship names must be uppercase words separated by underscores, at most 24 characters.'
      : 'Node names must contain ASCII letters, start uppercase, and be at most 24 characters.');
  }
  return value;
}

function coordinate(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 60 || value > 100000 || value % 20 !== 0) {
    throw new HttpError(400, 'Node coordinates must be grid multiples of 20 from 60 to 100000.');
  }
  return value;
}

function classification(value: unknown): NodeClassification {
  if (value !== 'Transactional' && value !== 'Master Data' && value !== 'Reference Data' && value !== 'Metadata') {
    throw new HttpError(400, 'Node classification must be Transactional, Master Data, Reference Data or Metadata.');
  }
  return value;
}

function draft(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new HttpError(400, 'Node draft must be a boolean.');
  return value;
}

function cardinality(value: unknown): RelationshipCardinality {
  if (value === '0..*' || value === '1..*' || value === '1..1') return value;
  throw new HttpError(400, 'Relationship cardinality must be 0..*, 1..* or 1..1.');
}

function propertyText(value: unknown, field: string): string {
  if (typeof value !== 'string' || /\p{Cc}/u.test(value)) {
    throw new HttpError(400, `Property ${field} must be nonblank text, at most 100 Unicode code points, without control characters.`);
  }
  const result = value.trim();
  if (!result || [...result].length > 100) {
    throw new HttpError(400, `Property ${field} must be nonblank text, at most 100 Unicode code points, without control characters.`);
  }
  return result;
}

function propertyIndex(value: unknown, schemaVersion: 1 | 2): ModelProperty['index'] {
  if (schemaVersion === 1 && value === true) return 'Range';
  if (schemaVersion === 1 && value === false) return 'None';
  if (value === 'None' || value === 'Range' || value === 'Text' || value === 'Point') return value;
  throw new HttpError(400, 'Property index must be None, Range, Text or Point.');
}

function properties(value: unknown, schemaVersion: 1 | 2): ModelProperty[] {
  if (!Array.isArray(value) || value.length > 100) throw new HttpError(400, 'Node properties must be an array of at most 100 properties.');
  const names = new Set<string>();
  return value.map(value => {
    const input = object(value, ['name', 'dataType', 'description', 'nodeKey', 'uniqueness', 'mustExist', 'index']);
    const name = propertyText(input.name, 'name');
    const dataType = propertyText(input.dataType, 'dataType');
    if (typeof input.description !== 'string' || input.description.includes('\0') || [...input.description].length > 2000) {
      throw new HttpError(400, 'Property description must be text of at most 2000 Unicode code points without NUL.');
    }
    for (const field of ['nodeKey', 'uniqueness', 'mustExist'] as const) {
      if (typeof input[field] !== 'boolean') throw new HttpError(400, `Property ${field} must be a boolean.`);
    }
    if (names.has(name)) throw new HttpError(400, 'Property names must be unique within each node.');
    names.add(name);
    return { name, dataType, description: input.description,
      nodeKey: input.nodeKey as boolean, uniqueness: input.uniqueness as boolean,
      mustExist: input.mustExist as boolean, index: propertyIndex(input.index, schemaVersion) };
  });
}

function modelInput(value: unknown, persisted = false, named = false): ModelInput {
  const input = object(value, ['schemaVersion', 'nodes', 'relationships', ...(persisted ? ['revision'] : []), ...(named ? ['name'] : [])]);
  if (input.schemaVersion !== 1 && input.schemaVersion !== 2) throw new HttpError(400, 'Model schemaVersion must be 1 or 2.');
  const schemaVersion = input.schemaVersion;
  if (!Array.isArray(input.nodes) || input.nodes.length > 200) throw new HttpError(400, 'Model must contain at most 200 nodes.');
  if (!Array.isArray(input.relationships) || input.relationships.length > 1000) throw new HttpError(400, 'Model must contain at most 1000 relationships.');
  const ids = new Set<string>();
  const names = new Set<string>();
  const nodes = input.nodes.map((value) => {
    const variant = object(value, ['kind', 'id', 'name', 'x', 'y', 'classification', 'draft', 'properties', 'target']);
    const kind = input.schemaVersion === 1 && !Object.hasOwn(variant, 'kind') ? 'definition' : variant.kind;
    if (kind !== 'definition' && !(input.schemaVersion === 2 && kind === 'reference')) {
      throw new HttpError(400, 'Invalid node kind for model schemaVersion.');
    }
    const node = object(value, ['kind', 'id', 'name', 'x', 'y', 'classification',
      ...(kind === 'definition' ? ['draft', 'properties'] : ['target'])]);
    const common = { id: modelId(node.id, 'node'), name: name(node.name), x: coordinate(node.x), y: coordinate(node.y) };
    let result: ModelNode;
    if (kind === 'reference') {
      if (node.classification !== 'Internal Reference' && node.classification !== 'External Reference') {
        throw new HttpError(400, 'Reference classification must be Internal Reference or External Reference.');
      }
      const target = object(node.target, ['modelId', 'nodeId']);
      result = { ...common, kind, classification: node.classification,
        target: { modelId: targetModelId(target.modelId), nodeId: modelId(target.nodeId, 'node') } };
    } else {
      const legacy = input.schemaVersion === 1;
      result = { ...common, kind,
        classification: legacy && !Object.hasOwn(node, 'classification') ? 'Transactional' : classification(node.classification),
        draft: legacy && !Object.hasOwn(node, 'draft') ? false : draft(node.draft),
        properties: legacy && !Object.hasOwn(node, 'properties') ? [] : properties(node.properties, schemaVersion) };
    }
    if (ids.has(result.id) || names.has(result.name)) throw new HttpError(400, 'Node IDs and names must be unique.');
    ids.add(result.id);
    names.add(result.name);
    return result;
  });
  for (let i = 0; i < nodes.length; i++) {
    for (let j = 0; j < i; j++) {
      if (Math.hypot(nodes[i]!.x - nodes[j]!.x, nodes[i]!.y - nodes[j]!.y) < 180) {
        throw new HttpError(400, 'Nodes must be at least 180 units apart.');
      }
    }
  }
  const relationshipIds = new Set<string>();
  const connections = new Set<string>();
  const relationships = input.relationships.map((value) => {
    const relationship = object(value, ['id', 'name', 'source', 'target', 'sourceCardinality', 'targetCardinality']);
    const result = {
      id: modelId(relationship.id, 'relationship'), name: name(relationship.name, true),
      source: modelId(relationship.source, 'node'), target: modelId(relationship.target, 'node'),
      sourceCardinality: Object.hasOwn(relationship, 'sourceCardinality') ? cardinality(relationship.sourceCardinality) : '0..*' as const,
      targetCardinality: Object.hasOwn(relationship, 'targetCardinality') ? cardinality(relationship.targetCardinality) : '0..*' as const,
    };
    if (!ids.has(result.source) || !ids.has(result.target)) throw new HttpError(400, 'Relationship endpoints must reference existing nodes.');
    const connection = JSON.stringify([result.source, result.target, result.name]);
    if (relationshipIds.has(result.id) || connections.has(connection)) throw new HttpError(400, 'Relationship IDs and directed named connections must be unique.');
    relationshipIds.add(result.id);
    connections.add(connection);
    return result;
  });
  return { schemaVersion: 2, nodes, relationships };
}

function referenceContext(model: ModelInput, id: string) {
  for (const node of model.nodes) {
    if (node.kind === 'reference' && (node.classification === 'Internal Reference') !== (node.target.modelId === id)) {
      throw new HttpError(400, 'Reference classification must match the containing model context.');
    }
  }
}

async function validateReferences(model: ModelInput, id: string, current: ModelInput | undefined,
  readTarget: (id: string) => Promise<NamedModel>) {
  referenceContext(model, id);
  const targets = new Map<string, Promise<NamedModel>>();
  for (const node of model.nodes) {
    if (node.kind !== 'reference') continue;
    const previous = current?.nodes.find(candidate => candidate.id === node.id);
    if (previous?.kind === 'reference' && previous.classification === node.classification &&
        previous.target.modelId === node.target.modelId && previous.target.nodeId === node.target.nodeId) continue;
    let target: ModelInput;
    if (node.classification === 'Internal Reference') target = model;
    else {
      let pending = targets.get(node.target.modelId);
      if (!pending) { pending = readTarget(node.target.modelId); targets.set(node.target.modelId, pending); }
      try { target = (await pending).model; }
      catch { throw new HttpError(400, 'Reference target must be an available saved definition.'); }
    }
    if (!target.nodes.some(candidate => candidate.id === node.target.nodeId && candidate.kind === 'definition')) {
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
      if (error instanceof HttpError && error.status === 404) return { schemaVersion: 2, revision: 0, nodes: [], relationships: [] };
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

function targetModelId(value: unknown): string {
  if (value === 'legacy') return value;
  if (typeof value !== 'string') throw new HttpError(400, 'Invalid target model ID.');
  return namedId(value);
}

function displayName(value: unknown): string {
  if (typeof value !== 'string' || /\p{Cc}/u.test(value)) {
    throw new HttpError(400, 'Model name must be nonblank text, at most 100 characters, without control characters.');
  }
  const result = value.trim();
  if (!result || [...result].length > 100) {
    throw new HttpError(400, 'Model name must be nonblank text, at most 100 characters, without control characters.');
  }
  return result;
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
      return { entry: { id, name, model: { ...model, revision: revision(value.revision) } }, identity };
    } catch {
      throw new HttpError(500, 'The model file is invalid or unsupported. Restore a valid backup before saving.');
    }
  }

  async function read(id: string): Promise<NamedModel> {
    try { return (await readPhysical(id)).entry; }
    catch (error) {
      if (id === 'legacy' && error instanceof HttpError && error.status === 404) {
        return { id, name: legacyName, model: { schemaVersion: 2, revision: 0, nodes: [], relationships: [] } };
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
    const results: ({ available: true; entry: NamedModel } | { available: false; id: string; name: string; error: string })[] = [];
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(8, ids.length) }, async () => {
      while (next < ids.length) {
        const id = ids[next++]!;
        try {
          const { entry } = await readPhysical(id);
          results.push({ available: true, entry });
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
    async definitions() {
      const models = (await catalogEntries()).map(result => {
        if (!result.available) return result;
        const { id, name, model } = result.entry;
        return { id, name, available: true as const, revision: model.revision,
          definitions: model.nodes.filter((node): node is DefinitionNode => node.kind === 'definition')
            .map(({ id, name, classification, draft, properties }) => ({ id, name, classification, draft, properties })) };
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
            ? { ...node, target: { ...node.target, modelId: id } } : node) };
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
