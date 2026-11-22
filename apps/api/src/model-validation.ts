import { HttpError, object } from './validation.ts';
import { modelInput, targetModelId, type ModelInput, type ModelConstraint, type ModelIndex, type DefinitionNode, type TypeDefinition } from './model-schema.ts';
import type { openNamedModelStore } from './model-store.ts';
import { parsePropertyType } from './model-types.ts';

export interface Location { modelId: string; path: string }
export interface Issue extends Location { severity: 'error' | 'warning'; code: string; message: string; related?: Location[] }
export interface Validation { valid: boolean; excludeDrafts: boolean; issues: Issue[]; dependencies: { modelId: string; revision: number }[] }
export interface Candidate { modelId: string; model: ModelInput; excludeDrafts: boolean }
export interface ComposedDefinition extends Location { kind: 'node' | 'relationship'; definition: DefinitionNode | TypeDefinition }
export interface ComposedConstraint extends Location { constraint: ModelConstraint; definition: ComposedDefinition }
export interface ComposedIndex extends Location { index: ModelIndex; definitions: ComposedDefinition[] }
export interface Composition { validation: Validation; definitions: ComposedDefinition[]; constraints: ComposedConstraint[]; indexes: ComposedIndex[]; fragments: { modelId: string; model: ModelInput }[] }
export function candidate(value: unknown, exporting = false): Candidate & { format?: 'json' | 'cypher' | 'graph-type'; acknowledgeGraphTypeReplacement?: boolean } {
  const input = object(value, ['modelId', 'model', 'excludeDrafts', ...(exporting ? ['format', 'acknowledgeGraphTypeReplacement'] : [])]);
  if (input.excludeDrafts !== undefined && typeof input.excludeDrafts !== 'boolean') throw new HttpError(400, 'excludeDrafts must be a boolean.');
  if (exporting && !['json', 'cypher', 'graph-type'].includes(input.format as string)) throw new HttpError(400, 'Invalid export format.');
  if (input.acknowledgeGraphTypeReplacement !== undefined && input.acknowledgeGraphTypeReplacement !== true) throw new HttpError(400, 'Replacement acknowledgement must be true.');
  return { modelId: targetModelId(input.modelId), model: modelInput(input.model), excludeDrafts: input.excludeDrafts !== false, ...(exporting ? { format: input.format as 'json' | 'cypher' | 'graph-type', acknowledgeGraphTypeReplacement: input.acknowledgeGraphTypeReplacement as boolean | undefined } : {}) };
}
const tuple = (modelId: string, kind: string, id: string) => JSON.stringify([modelId, kind, id]);
const vectorFilterTypes = new Set(['INTEGER', 'FLOAT', 'STRING', 'BOOLEAN', 'DATE', 'LOCAL TIME', 'ZONED TIME', 'LOCAL DATETIME', 'ZONED DATETIME', 'DURATION']);
export async function compose(input: Candidate, store: Pick<ReturnType<typeof openNamedModelStore>, 'readStored'>): Promise<Composition> {
  const { modelId: rootId, excludeDrafts } = input;
  const issues: Issue[] = [], dependencies = new Map<string, number>();
  const models = new Map<string, ModelInput | null>([[rootId, input.model]]);
  const definitions = new Map<string, ComposedDefinition>(), constraints = new Map<string, ComposedConstraint>(), indexes = new Map<string, ComposedIndex>();
  const scanned = new Set<string>(), active = new Set<string>();
  let operations = 0;
  const add = (severity: Issue['severity'], code: string, loc: Location, message: string, related?: Location[]) => { issues.push({ severity, code, ...loc, message, ...(related?.length ? { related } : {}) }); };
  const budget = () => { if (++operations > 20000 || models.size > 256 || definitions.size > 5000) throw new HttpError(400, 'Model dependency budget exceeded.'); };
  async function load(id: string) {
    budget();
    if (!models.has(id)) {
      try { const { entry } = await store.readStored(id); models.set(id, entry.model); dependencies.set(id, entry.model.revision); }
      catch { models.set(id, null); }
    }
    return models.get(id);
  }
  async function include(id: string, kind: 'node' | 'relationship', definitionId: string, requiredBy?: Location): Promise<ComposedDefinition | undefined> {
    budget();
    const key = tuple(id, kind, definitionId);
    if (definitions.has(key)) return definitions.get(key);
    const model = await load(id), collection = kind === 'node' ? 'nodes' : 'relationshipTypes';
    const position = model?.[collection].findIndex(d => d.id === definitionId) ?? -1;
    const loc = { modelId: id, path: `/${collection}/${position}` };
    if (!model || position < 0) { add('error', 'UNRESOLVED_REFERENCE', requiredBy ?? loc, 'A required definition is unavailable.'); return; }
    const d = model[collection][position]!;
    if (d.kind === 'reference') {
      if (active.has(key)) { add('error', 'REFERENCE_CYCLE', requiredBy ?? loc, 'References cannot form a cycle.'); return; }
      // References are placements, never chainable schema definitions.
      const targetId = 'nodeId' in d.target ? d.target.nodeId : d.target.relationshipTypeId;
      if ((d.classification === 'Internal Reference') !== (d.target.modelId === id)) add('error', 'REFERENCE_CONTEXT', loc, 'Reference classification does not match model context.');
      active.add(key);
      const targetModel = await load(d.target.modelId);
      const target = targetModel?.[collection].find(v => v.id === targetId);
      if (target?.kind === 'reference') { add('error', 'REFERENCE_CHAIN', loc, 'A reference must target an owned definition.'); active.delete(key); return; }
      const resolved = await include(d.target.modelId, kind, targetId, loc);
      active.delete(key);
      return resolved;
    }
    if (excludeDrafts && d.draft) {
      add(requiredBy ? 'error' : 'warning', requiredBy ? 'EXCLUDED_TARGET' : 'DRAFT_EXCLUDED', requiredBy ?? loc, requiredBy ? 'An included object requires an excluded draft definition.' : 'Draft definition excluded.');
      return;
    }
    const entry: ComposedDefinition = { ...loc, kind, definition: d };
    definitions.set(key, entry);
    if (scanned.has(key)) return entry;
    scanned.add(key);
    for (let i = 0; i < model.constraints.length; i++) {
      const c = model.constraints[i]!;
      if (c.target.kind !== kind || c.target.definitionId !== definitionId) continue;
      const path = `/constraints/${i}`, loc = { modelId: id, path };
      if (excludeDrafts && c.draft) { add('warning', 'DRAFT_EXCLUDED', loc, 'Draft constraint excluded.'); continue; }
      constraints.set(tuple(id, 'constraint', c.id), { ...loc, constraint: c, definition: entry });
    }
    for (let i = 0; i < model.indexes.length; i++) {
      const index = model.indexes[i]!;
      if (!index.targets.some(t => t.kind === kind && t.definitionId === definitionId)) continue;
      await includeIndex(id, model, i);
    }
    return entry;
  }
  async function includeIndex(id: string, model: ModelInput, position: number) {
    const index = model.indexes[position]!, key = tuple(id, 'index', index.id), loc = { modelId: id, path: `/indexes/${position}` };
    if (indexes.has(key)) return;
    if (excludeDrafts && index.draft) { if (!scanned.has(key)) add('warning', 'DRAFT_EXCLUDED', loc, 'Draft index excluded.'); scanned.add(key); return; }
    const item: ComposedIndex = { ...loc, index, definitions: [] };
    indexes.set(key, item);
    for (const t of index.targets) { const d = await include(id, t.kind, t.definitionId, loc); if (d) item.definitions.push(d); }
  }
  for (const node of input.model.nodes) await include(rootId, 'node', node.id);
  for (const type of input.model.relationshipTypes) await include(rootId, 'relationship', type.id);
  // Root indexes and constraints are intentional even when their targets were omitted.
  for (let i = 0; i < input.model.indexes.length; i++) await includeIndex(rootId, input.model, i);
  for (let i = 0; i < input.model.constraints.length; i++) {
    const c = input.model.constraints[i]!;
    if (excludeDrafts && c.draft) continue;
    await include(rootId, c.target.kind, c.target.definitionId, { modelId: rootId, path: `/constraints/${i}` });
  }
  for (let i = 0; i < input.model.relationships.length; i++) {
    const r = input.model.relationships[i]!, loc = { modelId: rootId, path: `/relationships/${i}` };
    const t = input.model.relationshipTypes.find(t => t.id === r.relationshipTypeId);
    if (excludeDrafts && t?.kind === 'definition' && t.draft) { add('warning', 'DRAFT_EXCLUDED', loc, 'Relationship with draft type excluded.'); continue; }
    await include(rootId, 'relationship', r.relationshipTypeId, loc);
    await include(rootId, 'node', r.source, loc); await include(rootId, 'node', r.target, loc);
    add('warning', 'CARDINALITY_ANNOTATION', loc, 'Cardinality is descriptive and has no native Neo4j enforcement.');
  }
  const canonical = new Map<string, ComposedDefinition>();
  for (const d of definitions.values()) {
    const key = JSON.stringify([d.kind, d.definition.name]), previous = canonical.get(key);
    if (previous) add('error', 'DEFINITION_NAME_CONFLICT', d, 'Distinct owned definitions have the same canonical label or type.', [previous]);
    else canonical.set(key, d);
    for (let i = 0; i < d.definition.properties.length; i++) {
      const p = d.definition.properties[i]!, parsed = parsePropertyType(p.dataType), loc = { modelId: d.modelId, path: `${d.path}/properties/${i}/dataType` };
      if (!parsed) add('error', 'UNKNOWN_PROPERTY_TYPE', loc, 'Declaration is not a supported Neo4j property type.');
      else if (parsed.outerNotNull) add('warning', 'OUTER_NOT_NULL', loc, 'Use an explicit EXISTS constraint for property existence.');
    }
  }
  const names = new Map<string, Location>(), schemas = new Map<string, Location>(), backing = new Map<string, Location>();
  function named(name: string, loc: Location) { const prior = names.get(name); if (prior) add('error', 'SCHEMA_NAME_CONFLICT', loc, 'Constraint and index names share one database namespace.', [prior]); else names.set(name, loc); }
  const signature = (d: ComposedDefinition, properties: string[]) => JSON.stringify([d.kind, d.definition.name, properties]);
  function declared(d: ComposedDefinition, properties: string[], loc: Location) {
    for (const property of properties) if (!d.definition.properties.some(p => p.name === property)) add('error', 'UNDECLARED_PROPERTY', loc, 'Schema object uses an undeclared property.', [{ modelId: d.modelId, path: `${d.path}/properties` }]);
  }
  for (const c of constraints.values()) {
    named(c.constraint.name, c); declared(c.definition, c.constraint.properties, c);
    const schema = signature(c.definition, c.constraint.properties), family = ['KEY', 'UNIQUE'].includes(c.constraint.kind) ? 'OWNED_RANGE' : c.constraint.kind;
    const key = JSON.stringify([schema, family]), prior = schemas.get(key);
    if (prior) add('error', 'CONSTRAINT_SCHEMA_CONFLICT', c, 'Duplicate or conflicting constraints on the same ordered property tuple.', [prior]); else schemas.set(key, c);
    if (family === 'OWNED_RANGE') backing.set(schema, c);
    if (c.constraint.kind === 'TYPE') {
      const p = c.definition.definition.properties.find(p => p.name === c.constraint.properties[0]);
      const parsed = p && parsePropertyType(p.dataType);
      if (parsed?.genericVector) add('error', 'TYPE_VECTOR_PARAMETERS', c, 'A VECTOR type constraint requires explicit coordinate type and dimension.');
      if (parsed?.cypher.includes('PROPERTY VALUE') || parsed?.cypher.includes('LIST<UUID')) add('error', 'TYPE_CONSTRAINT_UNSUPPORTED', c, 'This property declaration is not supported in a Neo4j TYPE constraint.');
    }
  }
  for (const i of indexes.values()) {
    named(i.index.name, i);
    const schemaKey = JSON.stringify([i.index.kind, i.definitions.map(d => [d.kind, d.definition.name]).sort(), i.index.properties, i.index.filterProperties, i.index.kind === 'LOOKUP' ? i.index.config.entity : null]);
    const prior = schemas.get(schemaKey); if (prior) add('error', 'INDEX_SCHEMA_CONFLICT', i, 'Duplicate index schema.', [prior]); else schemas.set(schemaKey, i);
    for (const d of i.definitions) {
      declared(d, [...i.index.properties, ...i.index.filterProperties], i);
      if (i.index.kind === 'RANGE') { const owner = backing.get(signature(d, i.index.properties)); if (owner) add('error', 'OWNED_RANGE_DUPLICATE', i, 'KEY or UNIQUE already owns the RANGE index for this ordered tuple.', [owner]); }
      for (const property of i.index.properties) {
        const declaration = d.definition.properties.find(p => p.name === property), parsed = declaration && parsePropertyType(declaration.dataType);
        if (!parsed) continue;
        const type = parsed.cypher;
        if (i.index.kind === 'TEXT' && type !== 'STRING' || i.index.kind === 'FULLTEXT' && type !== 'STRING' && type !== 'LIST<STRING NOT NULL>') add('error', 'INDEX_TYPE_INCOMPATIBLE', i, 'Text indexes require compatible string properties.');
        if (i.index.kind === 'POINT' && type !== 'POINT') add('error', 'INDEX_TYPE_INCOMPATIBLE', i, 'Point indexes require POINT properties.');
        if (i.index.kind === 'RANGE' && parsed.vector) add('error', 'INDEX_TYPE_INCOMPATIBLE', i, 'Native VECTOR properties cannot be indexed by a RANGE index.');
        if (i.index.kind === 'VECTOR') {
          if (!parsed.vector && !['LIST<FLOAT NOT NULL>', 'LIST<INTEGER NOT NULL>'].includes(type)) add('error', 'INDEX_TYPE_INCOMPATIBLE', i, 'Vector indexes require VECTOR or numeric list properties.');
          if (parsed.dimension && i.index.config['vector.dimensions'] && parsed.dimension !== i.index.config['vector.dimensions']) add('error', 'VECTOR_DIMENSION_MISMATCH', i, 'Vector declaration and index dimensions disagree.');
        }
      }
      for (const property of i.index.filterProperties) {
        const declaration = d.definition.properties.find(p => p.name === property), parsed = declaration && parsePropertyType(declaration.dataType);
        if (parsed && !parsed.cypher.split(' | ').every(member => vectorFilterTypes.has(member))) add('error', 'VECTOR_FILTER_TYPE', i, 'Every vector filter type must be INTEGER, FLOAT, STRING, BOOLEAN, a temporal type or DURATION.');
      }
    }
  }
  const orderedDefinitions = [...definitions.values()];
  const fragments = [...models].filter((entry): entry is [string, ModelInput] => !!entry[1]).map(([id, model]) => {
    const included = (kind: string, definitionId: string) => definitions.has(tuple(id, kind, definitionId));
    return { modelId: id, model: { schemaVersion: 3 as const, nodes: model.nodes.filter(d => d.kind === 'definition' && included('node', d.id)), relationshipTypes: model.relationshipTypes.filter(d => d.kind === 'definition' && included('relationship', d.id)), relationships: id === rootId ? model.relationships.filter(r => !(excludeDrafts && model.relationshipTypes.some(t => t.id === r.relationshipTypeId && t.kind === 'definition' && t.draft))) : [], constraints: model.constraints.filter(c => constraints.has(tuple(id, 'constraint', c.id))), indexes: model.indexes.filter(i => indexes.has(tuple(id, 'index', i.id))) } };
  });
  // Preserve root placements in the JSON schema bundle; dependency fragments contain only owned closure.
  const root = fragments.find(f => f.modelId === rootId)!;
  root.model.nodes = input.model.nodes.filter(d => d.kind === 'reference' || !(excludeDrafts && d.draft));
  root.model.relationshipTypes = input.model.relationshipTypes.filter(d => d.kind === 'reference' || !(excludeDrafts && d.draft));
  issues.sort((a, b) => {
    const left = JSON.stringify([a.modelId, a.path, a.code]), right = JSON.stringify([b.modelId, b.path, b.code]);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  return { validation: { valid: !issues.some(i => i.severity === 'error'), excludeDrafts, issues, dependencies: [...dependencies].map(([modelId, revision]) => ({ modelId, revision })).sort((a, b) => a.modelId < b.modelId ? -1 : 1) }, definitions: orderedDefinitions, constraints: [...constraints.values()], indexes: [...indexes.values()], fragments };
}
