import { HttpError, object } from './validation.ts';

export type NodeClassification = 'Transactional' | 'Master Data' | 'Reference Data' | 'Metadata';
export interface ModelProperty { name: string; dataType: string; description: string }
export interface DefinitionNode { kind: 'definition'; id: string; name: string; displayName?: string; x: number; y: number; classification: NodeClassification; draft: boolean; properties: ModelProperty[]; impliedLabels: string[] }
export interface ReferenceNode { kind: 'reference'; id: string; name: string; x: number; y: number; classification: 'Internal Reference' | 'External Reference'; target: { modelId: string; nodeId: string } }
export type ModelNode = DefinitionNode | ReferenceNode;
export interface TypeDefinition { kind: 'definition'; id: string; name: string; displayName?: string; draft: boolean; properties: ModelProperty[]; sourceLabel: string | null; targetLabel: string | null }
export interface TypeReference { kind: 'reference'; id: string; name: string; classification: 'Internal Reference' | 'External Reference'; target: { modelId: string; relationshipTypeId: string } }
export type RelationshipType = TypeDefinition | TypeReference;
export type RelationshipCardinality = '0..*' | '1..*' | '1..1' | '0..1';
export interface ModelRelationship { id: string; relationshipTypeId: string; source: string; target: string; sourceCardinality: RelationshipCardinality; targetCardinality: RelationshipCardinality }
export interface SchemaTarget { kind: 'node' | 'relationship'; definitionId: string }
export interface ModelConstraint { id: string; name: string; draft: boolean; kind: 'KEY' | 'UNIQUE' | 'EXISTS' | 'TYPE'; target: SchemaTarget; properties: string[] }
export interface ModelIndex { id: string; name: string; draft: boolean; kind: 'RANGE' | 'TEXT' | 'POINT' | 'FULLTEXT' | 'VECTOR' | 'LOOKUP'; targets: SchemaTarget[]; properties: string[]; filterProperties: string[]; config: Record<string, string | number | boolean | number[]> }
export interface ModelInput { schemaVersion: 3; nodes: ModelNode[]; relationshipTypes: RelationshipType[]; relationships: ModelRelationship[]; constraints: ModelConstraint[]; indexes: ModelIndex[] }
export interface Model extends ModelInput { revision: number }
// Legacy maximum: 200 nodes × 100 properties × (UNIQUE + EXISTS), plus
// one explicit index per property. Canonical readers must accept that expansion.
export const MAX_MODEL_CONSTRAINTS = 40000;
export const MAX_MODEL_INDEXES = 20000;
export const MODEL_BODY_LIMIT = 16 * 1024 * 1024;
export const emptyModel = (): ModelInput => ({ schemaVersion: 3, nodes: [], relationshipTypes: [], relationships: [], constraints: [], indexes: [] });
const fail = (message: string): never => { throw new HttpError(400, message); };
const wellFormed = (text: string) => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text);
export function identifier(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 16383 || /\p{Cc}/u.test(value) || !wellFormed(value)) return fail('Invalid canonical identifier.');
  return value;
}
export function displayName(value: unknown): string {
  const text = identifier(value).trim();
  if ([...text].length > 100) return fail('Display name must be at most 100 Unicode code points.');
  return text;
}
export function rowId(value: unknown, prefix: string): string {
  if (typeof value !== 'string' || value.trim() !== value || !new RegExp(`^${prefix}-[0-9]+$`).test(value) || !Number.isSafeInteger(Number(value.slice(prefix.length + 1)))) return fail(`Invalid ${prefix} ID.`);
  return value;
}
export function targetModelId(value: unknown): string {
  if (value !== 'legacy' && (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value))) return fail('Invalid target model ID.');
  return value as string;
}
function bool(value: unknown): boolean { return typeof value === 'boolean' ? value : fail('Draft must be a boolean.'); }
function array(value: unknown, max = 1000): unknown[] { return Array.isArray(value) && value.length <= max ? value : fail(`Expected an array of at most ${max} entries.`); }
function strings(value: unknown, min = 0): string[] {
  const result = array(value).map(identifier);
  if (result.length < min || new Set(result).size !== result.length) return fail('Invalid or duplicate property/label list.');
  return result;
}
function coord(value: unknown): number { return typeof value === 'number' && Number.isFinite(value) && value >= 60 && value <= 100000 && value % 20 === 0 ? value : fail('Node coordinates must be grid multiples of 20 from 60 to 100000.'); }
function card(value: unknown): RelationshipCardinality { return ['0..*', '1..*', '1..1', '0..1'].includes(value as string) ? value as RelationshipCardinality : fail('Invalid relationship cardinality.'); }
function unique<T extends { id: string }>(items: T[], names = false): T[] {
  if (new Set(items.map(item => item.id)).size !== items.length || names && new Set(items.map(item => (item as T & { name: string }).name)).size !== items.length) return fail('IDs and local placement names must be unique.');
  return items;
}
function props(value: unknown, legacy: boolean, booleanIndex = false): ModelProperty[] {
  const result = array(value, 100).map(value => {
    const p = object(value, ['name', 'dataType', 'description', ...(legacy ? ['nodeKey', 'uniqueness', 'mustExist', 'index'] : [])]);
    if (typeof p.description !== 'string' || p.description.includes('\0') || !wellFormed(p.description) || [...p.description].length > 2000) return fail('Invalid property description.');
    if (legacy && (['nodeKey', 'uniqueness', 'mustExist'].some(key => typeof p[key] !== 'boolean') || !['None', 'Range', 'Text', 'Point', ...(booleanIndex ? [true, false] : [])].includes(p.index as string))) return fail('Invalid legacy property annotations.');
    return { name: identifier(p.name), dataType: identifier(p.dataType), description: p.description };
  });
  if (new Set(result.map(p => p.name)).size !== result.length) return fail('Property names must be unique.');
  return result;
}
function target(value: unknown, nodes: ModelNode[], types: RelationshipType[]): SchemaTarget {
  const t = object(value, ['kind', 'definitionId']);
  if (t.kind !== 'node' && t.kind !== 'relationship') return fail('Invalid schema target kind.');
  const id = rowId(t.definitionId, t.kind === 'node' ? 'node' : 'relationship-type');
  if (!(t.kind === 'node' ? nodes : types).some(d => d.id === id && d.kind === 'definition')) return fail('Schema targets must be locally owned definitions.');
  return { kind: t.kind, definitionId: id };
}
function config(value: unknown, kind: ModelIndex['kind']): ModelIndex['config'] {
  const spatial = ['cartesian', 'cartesian-3d', 'wgs-84', 'wgs-84-3d'].flatMap(crs => ['min', 'max'].map(bound => `spatial.${crs}.${bound}`));
  const allowed = kind === 'POINT' ? spatial : kind === 'FULLTEXT' ? ['fulltext.analyzer', 'fulltext.eventually_consistent'] : kind === 'VECTOR' ? ['vector.dimensions', 'vector.similarity_function', 'vector.quantization.enabled', 'vector.hnsw.m', 'vector.hnsw.ef_construction'] : kind === 'LOOKUP' ? ['entity'] : [];
  const input = object(value, allowed);
  for (const [key, v] of Object.entries(input)) {
    if (key.startsWith('spatial.')) {
      const dimension = key.includes('-3d.') ? 3 : 2;
      if (!Array.isArray(v) || v.length !== dimension || v.some(n => typeof n !== 'number' || !Number.isFinite(n))) return fail('Invalid spatial bounds.');
      if (key.includes('wgs-84') && (Math.abs(v[0] as number) > 180 || Math.abs(v[1] as number) > 90)) return fail('Invalid geographic bounds.');
    } else if (['vector.dimensions', 'vector.hnsw.m', 'vector.hnsw.ef_construction'].includes(key)) {
      const max = key === 'vector.dimensions' ? 4096 : key === 'vector.hnsw.m' ? 512 : 3200;
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > max) return fail('Invalid vector configuration limit.');
    } else if (key === 'vector.similarity_function') { if (v !== 'cosine' && v !== 'euclidean') return fail('Invalid vector similarity function.'); }
    else if (key === 'entity') { if (v !== 'node' && v !== 'relationship') return fail('Invalid lookup entity.'); }
    else if (key === 'fulltext.analyzer') { if (typeof v !== 'string' || !v || v.length > 100 || /\p{Cc}/u.test(v) || !wellFormed(v)) return fail('Invalid fulltext analyzer.'); }
    else if (typeof v !== 'boolean') return fail('Index setting must be boolean.');
  }
  for (const key of spatial.filter(key => key.endsWith('.min'))) {
    const min = input[key], max = input[key.replace(/min$/, 'max')];
    if (Array.isArray(min) && Array.isArray(max) && min.some((v, i) => v >= max[i])) return fail('Spatial minimum must be below maximum.');
  }
  if (kind === 'LOOKUP' && !Object.hasOwn(input, 'entity')) return fail('Lookup index requires entity.');
  return input as ModelIndex['config'];
}
export function modelInput(value: unknown, persisted = false, named = false): ModelInput {
  const raw = object(value, ['schemaVersion', 'nodes', 'relationships', 'relationshipTypes', 'constraints', 'indexes', ...(persisted ? ['revision'] : []), ...(named ? ['name'] : [])]);
  if (![1, 2, 3].includes(raw.schemaVersion as number)) return fail('Model schemaVersion must be 1, 2 or 3.');
  const legacy = raw.schemaVersion !== 3;
  if (legacy && ['relationshipTypes', 'constraints', 'indexes'].some(key => Object.hasOwn(raw, key))) return fail('Unexpected legacy schema fields.');
  const migratedConstraints: ModelConstraint[] = [], migratedIndexes: ModelIndex[] = [];
  const nodes = unique(array(raw.nodes, 200).map((value): ModelNode => {
    const n = object(value, ['kind', 'id', 'name', 'displayName', 'x', 'y', 'classification', 'draft', 'properties', 'target', 'impliedLabels']);
    const kind = raw.schemaVersion === 1 && n.kind === undefined ? 'definition' : n.kind;
    const common = { id: rowId(n.id, 'node'), name: kind === 'reference' ? displayName(n.name) : identifier(n.name), x: coord(n.x), y: coord(n.y) };
    if (kind === 'reference' && raw.schemaVersion !== 1) {
      object(value, ['kind', 'id', 'name', 'x', 'y', 'classification', 'target']);
      if (!['Internal Reference', 'External Reference'].includes(n.classification as string)) return fail('Invalid reference classification.');
      const t = object(n.target, ['modelId', 'nodeId']);
      return { ...common, kind, classification: n.classification as ReferenceNode['classification'], target: { modelId: targetModelId(t.modelId), nodeId: rowId(t.nodeId, 'node') } };
    }
    if (kind !== 'definition') return fail('Invalid node kind.');
    object(value, ['kind', 'id', 'name', 'x', 'y', 'classification', 'draft', 'properties', ...(!legacy ? ['impliedLabels', 'displayName'] : [])]);
    const classification = raw.schemaVersion === 1 && n.classification === undefined ? 'Transactional' : n.classification;
    if (!['Transactional', 'Master Data', 'Reference Data', 'Metadata'].includes(classification as string)) return fail('Invalid node classification.');
    const properties = props(raw.schemaVersion === 1 && n.properties === undefined ? [] : n.properties, legacy, raw.schemaVersion === 1);
    if (legacy) array(n.properties ?? [], 100).forEach((value, i) => {
      const p = value as Record<string, unknown>, property = properties[i]!;
      const target: SchemaTarget = { kind: 'node', definitionId: common.id };
      const add = (kind: ModelConstraint['kind']) => migratedConstraints.push({ id: `constraint-${migratedConstraints.length + 1}`, name: `migrated_constraint_${migratedConstraints.length + 1}`, draft: false, kind, target, properties: [property.name] });
      if (p.nodeKey) add('KEY');
      else { if (p.uniqueness) add('UNIQUE'); if (p.mustExist) add('EXISTS'); }
      const index = p.index === true ? 'Range' : p.index === false ? 'None' : p.index;
      if (index !== 'None' && !(index === 'Range' && (p.nodeKey || p.uniqueness))) migratedIndexes.push({ id: `index-${migratedIndexes.length + 1}`, name: `migrated_index_${migratedIndexes.length + 1}`, draft: false, kind: String(index).toUpperCase() as ModelIndex['kind'], targets: [target], properties: [property.name], filterProperties: [], config: {} });
    });
    return { ...common, kind, classification: classification as NodeClassification, draft: bool(raw.schemaVersion === 1 && n.draft === undefined ? false : n.draft), properties, impliedLabels: legacy ? [] : strings(n.impliedLabels), ...(n.displayName !== undefined ? { displayName: displayName(n.displayName) } : {}) };
  }), true);
  for (let i = 0; i < nodes.length; i++) for (let j = 0; j < i; j++) if (Math.hypot(nodes[i]!.x - nodes[j]!.x, nodes[i]!.y - nodes[j]!.y) < 180) return fail('Nodes must be at least 180 units apart.');
  const relationshipTypes: RelationshipType[] = legacy ? [] : unique(array(raw.relationshipTypes).map((value): RelationshipType => {
    const t = object(value, ['kind', 'id', 'name', 'displayName', 'draft', 'properties', 'sourceLabel', 'targetLabel', 'classification', 'target']);
    const common = { id: rowId(t.id, 'relationship-type'), name: t.kind === 'reference' ? displayName(t.name) : identifier(t.name) };
    if (t.kind === 'reference') {
      object(value, ['kind', 'id', 'name', 'classification', 'target']);
      if (!['Internal Reference', 'External Reference'].includes(t.classification as string)) return fail('Invalid reference classification.');
      const r = object(t.target, ['modelId', 'relationshipTypeId']);
      return { ...common, kind: 'reference', classification: t.classification as TypeReference['classification'], target: { modelId: targetModelId(r.modelId), relationshipTypeId: rowId(r.relationshipTypeId, 'relationship-type') } };
    }
    object(value, ['kind', 'id', 'name', 'displayName', 'draft', 'properties', 'sourceLabel', 'targetLabel']);
    if (t.kind !== 'definition') return fail('Invalid relationship type kind.');
    return { ...common, kind: 'definition', draft: bool(t.draft), properties: props(t.properties, false), sourceLabel: t.sourceLabel === null ? null : identifier(t.sourceLabel), targetLabel: t.targetLabel === null ? null : identifier(t.targetLabel), ...(t.displayName !== undefined ? { displayName: displayName(t.displayName) } : {}) };
  }));
  const relationships = unique(array(raw.relationships).map((value): ModelRelationship => {
    const r = object(value, ['id', ...(legacy ? ['name'] : ['relationshipTypeId']), 'source', 'target', 'sourceCardinality', 'targetCardinality']);
    let typeId: string;
    if (legacy) {
      const name = identifier(r.name);
      let t = relationshipTypes.find(t => t.name === name);
      if (!t) { t = { kind: 'definition', id: `relationship-type-${relationshipTypes.length + 1}`, name, draft: false, properties: [], sourceLabel: null, targetLabel: null }; relationshipTypes.push(t); }
      typeId = t.id;
    } else typeId = rowId(r.relationshipTypeId, 'relationship-type');
    const source = rowId(r.source, 'node'), target = rowId(r.target, 'node');
    if (![source, target].every(id => nodes.some(n => n.id === id)) || !relationshipTypes.some(t => t.id === typeId)) return fail('Relationship endpoints and type must exist.');
    return { id: rowId(r.id, 'relationship'), relationshipTypeId: typeId, source, target, sourceCardinality: card(!Object.hasOwn(r, 'sourceCardinality') && legacy ? '0..*' : r.sourceCardinality), targetCardinality: card(!Object.hasOwn(r, 'targetCardinality') && legacy ? '0..*' : r.targetCardinality) };
  }));
  if (new Set(relationships.map(r => JSON.stringify([r.source, r.target, r.relationshipTypeId]))).size !== relationships.length) return fail('Directed typed connections must be unique.');
  const constraints = legacy ? migratedConstraints : unique(array(raw.constraints, MAX_MODEL_CONSTRAINTS).map((value): ModelConstraint => {
    const c = object(value, ['id', 'name', 'draft', 'kind', 'target', 'properties']);
    if (!['KEY', 'UNIQUE', 'EXISTS', 'TYPE'].includes(c.kind as string)) return fail('Invalid constraint kind.');
    const properties = strings(c.properties, 1);
    if ((c.kind === 'EXISTS' || c.kind === 'TYPE') && properties.length !== 1) return fail('EXISTS and TYPE require one property.');
    return { id: rowId(c.id, 'constraint'), name: identifier(c.name), draft: bool(c.draft), kind: c.kind as ModelConstraint['kind'], target: target(c.target, nodes, relationshipTypes), properties };
  }));
  const indexes = legacy ? migratedIndexes : unique(array(raw.indexes, MAX_MODEL_INDEXES).map((value): ModelIndex => {
    const i = object(value, ['id', 'name', 'draft', 'kind', 'targets', 'properties', 'filterProperties', 'config']);
    if (!['RANGE', 'TEXT', 'POINT', 'FULLTEXT', 'VECTOR', 'LOOKUP'].includes(i.kind as string)) return fail('Invalid index kind.');
    const kind = i.kind as ModelIndex['kind'], targets = array(i.targets).map(t => target(t, nodes, relationshipTypes)), properties = strings(i.properties), filterProperties = strings(i.filterProperties);
    if (new Set(targets.map(t => JSON.stringify(t))).size !== targets.length || targets.some(t => t.kind !== targets[0]!.kind)) return fail('Index targets must be distinct and of one entity kind.');
    if (kind === 'LOOKUP' ? targets.length || properties.length || filterProperties.length : !targets.length || !properties.length || (!['FULLTEXT', 'VECTOR'].includes(kind) && targets.length !== 1) || (['TEXT', 'POINT', 'VECTOR'].includes(kind) && properties.length !== 1) || (kind !== 'VECTOR' && filterProperties.length) || filterProperties.some(p => properties.includes(p))) return fail('Invalid index shape.');
    return { id: rowId(i.id, 'index'), name: identifier(i.name), draft: bool(i.draft), kind, targets, properties, filterProperties, config: config(i.config, kind) };
  }));
  const normalized: ModelInput = { schemaVersion: 3, nodes, relationshipTypes, relationships, constraints, indexes };
  // Validate generated schema objects with exactly the same rules used on reopen.
  return legacy ? modelInput(normalized) : normalized;
}
