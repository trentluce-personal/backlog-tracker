import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, readFile, writeFile, stat, readdir, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { createApp } from '../src/server.ts';
import { emptyModel, modelInput, MODEL_BODY_LIMIT, MAX_MODEL_CONSTRAINTS, MAX_MODEL_INDEXES, type ModelInput, type ModelIndex, type ModelConstraint } from '../src/model-schema.ts';
import { parsePropertyType } from '../src/model-types.ts';
import { quoteIdentifier } from '../src/model-export.ts';
import { openModelStore, openNamedModelStore } from '../src/model-store.ts';

const uuid = '11111111-1111-4111-8111-111111111111';
const prop = (name = 'id', dataType = 'STRING') => ({ name, dataType, description: '' });
const node = (id = 'node-1', name = 'Person', x = 60) => ({ kind: 'definition' as const, id, name, x, y: 60, classification: 'Transactional' as const, draft: false, impliedLabels: [] as string[], properties: [prop(), prop('other'), prop('embedding', 'VECTOR<FLOAT32>(3)'), prop('point', 'POINT')] });
const type = (id = 'relationship-type-1', name = 'KNOWS') => ({ kind: 'definition' as const, id, name, draft: false, properties: [prop('since', 'DATE')], sourceLabel: null, targetLabel: null });
const graph = (): ModelInput => ({ ...emptyModel(), nodes: [node()], relationshipTypes: [type()] });
const target = { kind: 'node' as const, definitionId: 'node-1' };
const constraint = (kind: ModelConstraint['kind'] = 'KEY', properties = ['id', 'other']): ModelConstraint => ({ id: 'constraint-1', name: 'person key', draft: false, kind, target, properties });
const index = (kind: ModelIndex['kind'] = 'TEXT', properties = ['id']): ModelIndex => ({ id: 'index-1', name: `${kind} index`, draft: false, kind, targets: [target], properties, filterProperties: [], config: {} });
async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'backlog-schema3-'));
  const modelPath = join(directory, 'models', 'model.json');
  let server = createApp({ dbPath: join(directory, 'db.sqlite'), modelPath, webRoot: directory });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address === 'object');
  let base = `http://127.0.0.1:${address.port}`;
  async function restart() {
    const closed = once(server, 'close'); server.close(); server.closeAllConnections(); await closed;
    server = createApp({ dbPath: join(directory, 'db.sqlite'), modelPath, webRoot: directory });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address(); assert.ok(address && typeof address === 'object');
    base = `http://127.0.0.1:${address.port}`;
  }
  t.after(async () => { const closed = once(server, 'close'); server.close(); server.closeAllConnections(); await closed; await rm(directory, { recursive: true, force: true }); });
  const request = async (path: string, value?: unknown, method = 'POST') => {
    const response = await fetch(base + '/api/' + path, value === undefined ? undefined : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    return { status: response.status, body: await response.json() };
  };
  const validate = (model: ModelInput, rest = {}) => request('model-validation', { modelId: 'legacy', model, ...rest });
  const exportGraph = (model: ModelInput, format = 'cypher', rest = {}) => request('model-export', { modelId: 'legacy', model, format, ...rest });
  return { directory, modelPath, request, validate, exportGraph, restart };
}

test('schema3 canonical identifiers preserve Unicode, case, punctuation, spaces and reject malformed Unicode', () => {
  const model = graph();
  model.nodes[0] = { ...node('node-0', ' é : `\\u0060 名 '), displayName: '  Friendly 😀  ', properties: [prop(' key . : `\\u0060 ', 'String')] };
  model.relationshipTypes[0] = type('relationship-type-0', 'mixed Relationship!');
  const normalized = modelInput(model);
  assert.equal(normalized.nodes[0]!.name, ' é : `\\u0060 名 ');
  assert.equal(normalized.nodes[0]!.kind === 'definition' && normalized.nodes[0]!.displayName, 'Friendly 😀');
  for (const name of ['', ' ', '\0', 'a\n', '\ud800', '\udc00', 'x'.repeat(16384)]) assert.throws(() => modelInput({ ...model, nodes: [{ ...model.nodes[0], name }] }));
  assert.doesNotThrow(() => modelInput({ ...model, nodes: [{ ...model.nodes[0], name: 'x'.repeat(16383) }] }));
  assert.throws(() => modelInput({ ...model, nodes: [{ ...model.nodes[0], id: 'node-1\n' }] }));
});

test('schema3 strict object shapes, local owned targets and uniform index configuration', () => {
  const model = graph();
  for (const patch of [
    { nodes: [{ ...node(), properties: [{ ...prop(), nodeKey: true }] }] },
    { constraints: [{ ...constraint(), target: { kind: 'node', definitionId: 'node-99' } }] },
    { constraints: [constraint('EXISTS', ['id', 'other'])] },
    { indexes: [{ ...index(), config: { analyzer: 'english' } }] },
    { indexes: [{ ...index('VECTOR', ['embedding']), config: { 'vector.dimensions': 4097 } }] },
    { indexes: [{ ...index('VECTOR', ['embedding']), config: { 'vector.hnsw.m': 513 } }] },
    { indexes: [{ ...index('POINT', ['point']), config: { 'spatial.wgs-84.min': [-181, 0] } }] },
    { indexes: [{ ...index('POINT', ['point']), config: { 'spatial.cartesian.min': [1, 0], 'spatial.cartesian.max': [0, 1] } }] },
    { indexes: [{ ...index(), filterProperties: ['other'] }] },
    { indexes: [{ ...index('LOOKUP', []), targets: [], config: {} }] },
    { indexes: [{ ...index(), filterProperties: undefined }] },
    { relationshipTypes: [{ ...type(), sourceLabel: undefined }] },
  ]) assert.throws(() => modelInput({ ...model, ...patch }), JSON.stringify(patch));
  for (const kind of ['RANGE', 'TEXT', 'POINT', 'FULLTEXT', 'VECTOR', 'LOOKUP'] as const) {
    const i = index(kind, kind === 'LOOKUP' ? [] : kind === 'VECTOR' ? ['embedding'] : kind === 'POINT' ? ['point'] : ['id']);
    if (kind === 'LOOKUP') { i.targets = []; i.config = { entity: 'relationship' }; }
    assert.doesNotThrow(() => modelInput({ ...model, indexes: [i] }));
  }
});

test('legacy annotations migrate deterministically: KEY owns RANGE, TEXT/POINT remain additional indexes, property text stays exact', () => {
  const legacy = { schemaVersion: 2, nodes: [{ ...node(), impliedLabels: undefined, properties: [
    { ...prop(' key '), nodeKey: true, uniqueness: true, mustExist: true, index: 'Text' },
    { ...prop('second'), nodeKey: true, uniqueness: true, mustExist: true, index: 'Range' },
    { ...prop('third'), nodeKey: false, uniqueness: true, mustExist: true, index: 'Point' },
  ] }], relationships: [
    { id: 'relationship-1', name: 'works FOR', source: 'node-1', target: 'node-1' },
    { id: 'relationship-2', name: 'OTHER', source: 'node-1', target: 'node-1' },
  ] };
  delete legacy.nodes[0]!.impliedLabels;
  const normalized = modelInput(legacy);
  assert.deepEqual(normalized, modelInput(legacy));
  assert.deepEqual(normalized.constraints.map(c => [c.kind, c.properties]), [['KEY', [' key ']], ['KEY', ['second']], ['UNIQUE', ['third']], ['EXISTS', ['third']]]);
  assert.deepEqual(normalized.indexes.map(i => i.kind), ['TEXT', 'POINT']);
  assert.deepEqual(normalized.relationshipTypes.map(t => [t.id, t.name]), [['relationship-type-1', 'works FOR'], ['relationship-type-2', 'OTHER']]);
  assert.deepEqual(normalized.nodes[0]!.kind === 'definition' && normalized.nodes[0]!.properties[0], prop(' key '));
});

test('schema1/2 GET/catalog/validation/export preserve exact stored bytes, inode and mtime; explicit save writes3', async t => {
  const f = await fixture(t); await mkdir(join(f.directory, 'models'));
  for (const schemaVersion of [1, 2]) {
    const legacy = { schemaVersion, revision: 7, nodes: [{ kind: 'definition', id: 'node-1', name: 'Person', x: 60, y: 60, classification: 'Metadata', draft: false, properties: [{ ...prop(), nodeKey: true, uniqueness: true, mustExist: true, index: 'Text' }] }], relationships: [] };
    const bytes = JSON.stringify(legacy, null, 4) + '\n'; await writeFile(f.modelPath, bytes);
    const before = await stat(f.modelPath);
    const loaded = await f.request('model'); assert.equal(loaded.body.model.schemaVersion, 3);
    for (const endpoint of ['models', 'model-node-definitions', 'model-catalog']) {
      const response = await f.request(endpoint); assert.equal(response.status, 200);
      if (endpoint === 'model-catalog') assert.equal(response.body.models[0].sourceSchemaVersion, schemaVersion);
    }
    const { revision, ...candidate } = loaded.body.model;
    assert.equal((await f.validate(candidate)).body.valid, true);
    for (const format of ['json', 'cypher', 'graph-type']) assert.equal((await f.exportGraph(candidate, format, { acknowledgeGraphTypeReplacement: true })).status, 200);
    assert.equal(await readFile(f.modelPath, 'utf8'), bytes);
    const after = await stat(f.modelPath); assert.equal(after.ino, before.ino); assert.equal(after.mtimeMs, before.mtimeMs);
    const saved = await f.request('model', { expectedRevision: 7, model: legacyModel(legacy) }, 'PUT'); assert.equal(saved.status, 200);
    assert.equal(JSON.parse(await readFile(f.modelPath, 'utf8')).schemaVersion, 3);
  }
});
function legacyModel({ revision, ...model }: Record<string, unknown>) { return model; }

test('type grammar recognizes scalars, aliases, lists, unions, UUID and bounded native vectors without rewriting declarations', () => {
  for (const text of ['Bool', 'Int', 'String', 'ZONED DATETIME', 'LOCAL TIME', 'DURATION', 'POINT', 'UUID', 'LIST<STRING NOT NULL>', 'ARRAY<INTEGER!>', 'STRING | INTEGER', 'VECTOR', 'VECTOR<FLOAT32>(4096)', 'VECTOR(3,FLOAT64)', 'PROPERTY VALUE']) assert.ok(parsePropertyType(text), text);
  assert.equal(parsePropertyType('Bool')!.cypher, 'BOOLEAN');
  assert.equal(parsePropertyType('LIST<Int>')!.cypher, 'LIST<INTEGER NOT NULL>');
  for (const text of ['MAP', 'NODE', 'LIST<LIST<STRING>>', 'LIST<VECTOR<FLOAT32>(3)>', 'LIST<STRING | INTEGER>', 'VECTOR<FLOAT16>(3)', 'VECTOR<FLOAT32>(0)', 'VECTOR<FLOAT32>(4097)', 'STRING); DROP INDEX x; //']) assert.equal(parsePropertyType(text), null, text);
});

test('composite KEY, multiple explicit indexes, relationship property constraints and safe identifier quoting export as DDL only', async t => {
  const f = await fixture(t), model = graph();
  const raw = 'é `); DROP DATABASE neo4j; // \\u0060';
  model.nodes[0] = { ...node('node-1', raw), properties: [prop(raw), prop('other'), prop('embedding', 'VECTOR<FLOAT32>(3)'), prop('point', 'POINT')] };
  model.constraints = [constraint('KEY', [raw, 'other']), { ...constraint('TYPE', ['since']), id: 'constraint-2', name: 'rel type', target: { kind: 'relationship', definitionId: 'relationship-type-1' } }];
  model.indexes = [index('TEXT', [raw]), { ...index('FULLTEXT', [raw]), id: 'index-2', name: 'fulltext', config: { 'fulltext.analyzer': "english'\\", 'fulltext.eventually_consistent': true } }, { ...index('POINT', ['point']), id: 'index-3', name: 'point', config: { 'spatial.cartesian.min': [-1, -1], 'spatial.cartesian.max': [1, 1] } }, { ...index('VECTOR', ['embedding']), id: 'index-4', name: 'vector', filterProperties: ['other'], config: { 'vector.dimensions': 3, 'vector.similarity_function': 'cosine', 'vector.quantization.enabled': true, 'vector.hnsw.m': 16, 'vector.hnsw.ef_construction': 100 } }, { ...index('LOOKUP', []), id: 'index-5', name: 'lookup', targets: [], config: { entity: 'relationship' } }];
  const result = await f.exportGraph(model); assert.equal(result.status, 200, JSON.stringify(result.body));
  const text = result.body.content;
  assert.ok(text.includes(quoteIdentifier(raw)));
  assert.equal(quoteIdentifier('raw`\\u0060'), '`raw``\\u005cu0060`');
  assert.equal((text.match(/CREATE CONSTRAINT/g) ?? []).length, 2);
  assert.equal((text.match(/CREATE .* INDEX/g) ?? []).length, 5);
  assert.ok(text.includes('IS NODE KEY')); assert.ok(!text.includes('IS UNIQUE')); assert.ok(!text.includes('IS NOT NULL')); assert.ok(!text.includes('CREATE RANGE'));
  assert.ok(text.includes('ON EACH [')); assert.ok(text.includes('WITH [e.`other`]')); assert.ok(text.includes('ON EACH type(e)')); assert.ok(text.includes('e.`since` IS :: DATE'));
  assert.ok(result.body.requirements.some((s: string) => s.includes('Enterprise')));
  assert.ok(!(await readdir(f.directory)).includes('models'));
});

test('semantic schema conflicts, owned RANGE duplicates, undeclared properties and incompatible types block with422 and no partial script', async t => {
  const f = await fixture(t);
  const cases: [Partial<ModelInput>, string][] = [
    [{ constraints: [constraint(), { ...constraint('UNIQUE'), id: 'constraint-2', name: 'other name' }] }, 'CONSTRAINT_SCHEMA_CONFLICT'],
    [{ constraints: [constraint()], indexes: [index('RANGE', ['id', 'other'])] }, 'OWNED_RANGE_DUPLICATE'],
    [{ constraints: [constraint()], indexes: [{ ...index(), name: 'person key' }] }, 'SCHEMA_NAME_CONFLICT'],
    [{ constraints: [constraint('TYPE', ['missing'])] }, 'UNDECLARED_PROPERTY'],
    [{ indexes: [index('POINT', ['id'])] }, 'INDEX_TYPE_INCOMPATIBLE'],
    [{ nodes: [{ ...node(), properties: [prop('id', 'Custom')] }] }, 'UNKNOWN_PROPERTY_TYPE'],
    [{ nodes: [{ ...node(), properties: [prop('id', 'VECTOR')] }], constraints: [constraint('TYPE', ['id'])] }, 'TYPE_VECTOR_PARAMETERS'],
    [{ indexes: [{ ...index('VECTOR', ['embedding']), config: { 'vector.dimensions': 4 } }] }, 'VECTOR_DIMENSION_MISMATCH'],
  ];
  for (const [patch, code] of cases) {
    const model = { ...graph(), ...patch }, validated = await f.validate(model);
    assert.equal(validated.status, 200); assert.equal(validated.body.valid, false);
    assert.ok(validated.body.issues.some((i: any) => i.code === code), JSON.stringify(validated.body));
    const exported = await f.exportGraph(model); assert.equal(exported.status, 422); assert.equal(exported.body.content, undefined);
    assert.equal(exported.body.error, 'Model cannot be exported.');
  }
  const distinct = graph(); distinct.constraints = [constraint(), { ...constraint('UNIQUE', ['id']), id: 'constraint-2', name: 'single' }];
  assert.equal((await f.validate(distinct)).body.valid, true);
  assert.equal((await f.request('model-validation', { modelId: 'legacy', model: graph(), unknown: true })).status, 400);
});

test('unsaved root references compose saved definition tuples, deduplicate aliases, include multi-target closure and omit unrelated objects', async t => {
  const f = await fixture(t), remote = graph();
  remote.nodes.push(node('node-2', 'Company', 260), node('node-3', 'Unrelated', 460));
  remote.constraints = [constraint()];
  remote.indexes = [{ ...index('FULLTEXT'), targets: [target, { kind: 'node', definitionId: 'node-2' }] }];
  const saved = await f.request('models', { name: 'Remote', model: remote }); assert.equal(saved.status, 201);
  const model = emptyModel();
  model.nodes = [1, 2].map(n => ({ kind: 'reference', id: `node-${n}`, name: `alias ${n}`, x: 60 + (n - 1) * 200, y: 60, classification: 'External Reference', target: { modelId: saved.body.id, nodeId: 'node-1' } }));
  model.relationshipTypes = [{ kind: 'reference', id: 'relationship-type-1', name: 'rel alias', classification: 'External Reference', target: { modelId: saved.body.id, relationshipTypeId: 'relationship-type-1' } }];
  const validated = await f.validate(model); assert.equal(validated.body.valid, true, JSON.stringify(validated.body));
  assert.deepEqual(validated.body.dependencies, [{ modelId: saved.body.id, revision: 1 }]);
  const exported = await f.exportGraph(model); assert.equal(exported.status, 200); assert.ok(exported.body.content.includes('e:`Person`')); assert.ok(!exported.body.content.includes('alias'));
  const bundle = JSON.parse((await f.exportGraph(model, 'json')).body.content);
  assert.equal(bundle.version, 1); assert.equal(bundle.rootModelId, 'legacy'); assert.equal(bundle.fragments.length, 2);
  const dependency = bundle.fragments.find((v: any) => v.modelId === saved.body.id);
  assert.deepEqual(dependency.model.nodes.map((n: any) => n.name), ['Person', 'Company']);
  assert.equal(dependency.model.relationships.length, 0);
  assert.equal(Object.hasOwn(dependency.model, 'revision'), false);
  // Distinct tuples with the same label conflict, even if declarations match.
  model.nodes.push(node('node-3', 'Person', 460));
  const conflict = await f.validate(model); assert.ok(conflict.body.issues.some((i: any) => i.code === 'DEFINITION_NAME_CONFLICT' && i.related.length));
});

test('internal node and relationship type references rebase on POST and changed targets resolve submitted owned definitions', async t => {
  const f = await fixture(t), model = graph();
  model.nodes.push({ kind: 'reference', id: 'node-2', name: 'Local alias', x: 260, y: 60, classification: 'Internal Reference', target: { modelId: 'legacy', nodeId: 'node-1' } });
  model.relationshipTypes.push({ kind: 'reference', id: 'relationship-type-2', name: 'Local type', classification: 'Internal Reference', target: { modelId: 'legacy', relationshipTypeId: 'relationship-type-1' } });
  assert.equal((await f.validate(model)).body.valid, true);
  const created = await f.request('models', { name: 'Copy', model }); assert.equal(created.status, 201);
  assert.equal(created.body.model.nodes[1].target.modelId, created.body.id);
  assert.equal(created.body.model.relationshipTypes[1].target.modelId, created.body.id);
  const { revision, ...copy } = created.body.model;
  assert.equal((await f.request('model-validation', { modelId: created.body.id, model: copy })).body.valid, true);
  copy.relationshipTypes = copy.relationshipTypes.filter((t: any) => t.id !== 'relationship-type-1');
  const retained = await f.request('models/' + created.body.id, { name: 'Copy', expectedRevision: 1, model: copy }, 'PUT'); assert.equal(retained.status, 200);
  assert.equal((await f.request('models/' + created.body.id)).status, 200);
  const missing = await f.request('model-validation', { modelId: created.body.id, model: copy }); assert.ok(missing.body.issues.some((i: any) => i.code === 'UNRESOLVED_REFERENCE'));
  copy.relationshipTypes[0].id = 'relationship-type-3';
  assert.equal((await f.request('models/' + created.body.id, { name: 'Copy', expectedRevision: 2, model: copy }, 'PUT')).status, 400);
});

test('reference chains/cycles/missing physical legacy targets produce diagnostics without writes or hanging', async t => {
  const f = await fixture(t), model = emptyModel();
  model.nodes = [1, 2].map(n => ({ kind: 'reference', id: `node-${n}`, name: `alias${n}`, x: 60 + (n - 1) * 200, y: 60, classification: 'Internal Reference', target: { modelId: 'legacy', nodeId: `node-${n === 1 ? 2 : 1}` } }));
  let result = await f.validate(model); assert.equal(result.body.valid, false); assert.ok(result.body.issues.some((i: any) => i.code === 'REFERENCE_CHAIN'));
  model.nodes = [{ kind: 'reference', id: 'node-1', name: 'missing', x: 60, y: 60, classification: 'External Reference', target: { modelId: uuid, nodeId: 'node-1' } }];
  result = await f.validate(model); assert.ok(result.body.issues.some((i: any) => i.code === 'UNRESOLVED_REFERENCE'));
  assert.equal((await f.exportGraph(model, 'json')).status, 422);
  assert.ok(!(await readdir(f.directory)).includes('models'));
});

test('draft exclusions warn, included objects requiring excluded targets block, excludeDrafts false includes them', async t => {
  const f = await fixture(t), model = graph(); model.nodes[0] = { ...node(), draft: true };
  let result = await f.validate(model); assert.equal(result.body.valid, true); assert.ok(result.body.issues.some((i: any) => i.code === 'DRAFT_EXCLUDED'));
  model.constraints = [constraint()]; result = await f.validate(model); assert.equal(result.body.valid, false); assert.ok(result.body.issues.some((i: any) => i.code === 'EXCLUDED_TARGET'));
  assert.equal((await f.validate(model, { excludeDrafts: false })).body.valid, true);
  model.constraints = []; model.relationships = [{ id: 'relationship-1', relationshipTypeId: 'relationship-type-1', source: 'node-1', target: 'node-1', sourceCardinality: '0..1', targetCardinality: '1..1' }];
  assert.equal((await f.exportGraph(model)).status, 422);
  model.relationshipTypes[0] = { ...type(), draft: true };
  assert.equal((await f.validate(model)).body.valid, true);
});

test('graph-type requires acknowledgement, exports endpoint/implied/property requirements and blocks unsupported collisions', async t => {
  const f = await fixture(t), model = graph();
  model.nodes[0] = { ...node(), impliedLabels: ['Resident'], properties: [prop()] };
  model.relationshipTypes[0] = { ...type(), sourceLabel: 'Resident', targetLabel: 'City' };
  model.constraints = [constraint('KEY', ['id'])];
  assert.equal((await f.exportGraph(model)).status, 422);
  assert.equal((await f.exportGraph(model, 'graph-type')).status, 422);
  const exported = await f.exportGraph(model, 'graph-type', { acknowledgeGraphTypeReplacement: true }); assert.equal(exported.status, 200, JSON.stringify(exported.body));
  assert.ok(exported.body.content.includes('ALTER CURRENT GRAPH TYPE SET'));
  assert.ok(exported.body.content.includes('(:`Person` => :`Resident` {`id` :: ANY NOT NULL})'));
  assert.ok(exported.body.content.includes('(:`Resident`)-[:`KNOWS` =>]->(:`City`)'));
  assert.ok(!exported.body.content.includes('`since`'));
  assert.ok(exported.body.content.includes('CONSTRAINT `person key` FOR (e:`Person`) REQUIRE (e.`id`) IS KEY'));
  model.nodes.push(node('node-2', 'Resident', 260));
  const blocked = await f.exportGraph(model, 'graph-type', { acknowledgeGraphTypeReplacement: true }); assert.equal(blocked.status, 422); assert.ok(blocked.body.validation.issues.some((i: any) => i.code === 'IDENTIFYING_IMPLIED_COLLISION'));
});

test('multi-target closure terminates through overlapping indexes and graph-type rejects ambiguous endpoint scopes', async t => {
  const f = await fixture(t), model = graph();
  model.nodes.push(node('node-2', 'Company', 260));
  model.indexes = [{ ...index('FULLTEXT'), targets: [target, { kind: 'node', definitionId: 'node-2' }] }, { ...index('VECTOR', ['embedding']), id: 'index-2', name: 'vector multi', targets: [{ kind: 'node', definitionId: 'node-2' }, target], filterProperties: ['other'], config: { 'vector.dimensions': 3 } }];
  const result = await f.exportGraph(model); assert.equal(result.status, 200);
  assert.ok(result.body.content.includes('FOR (e:`Person`|`Company`) ON EACH'));
  assert.ok(result.body.content.includes('FOR (e:`Company`|`Person`) ON (e.`embedding`) WITH [e.`other`]'));
  model.relationships = ['node-1', 'node-2'].map((source, i) => ({ id: `relationship-${i}`, relationshipTypeId: 'relationship-type-1', source, target: 'node-1', sourceCardinality: '0..*', targetCardinality: '0..1' }));
  const blocked = await f.exportGraph(model, 'graph-type', { acknowledgeGraphTypeReplacement: true });
  assert.equal(blocked.status, 422); assert.ok(blocked.body.validation.issues.some((i: any) => i.code === 'AMBIGUOUS_RELATIONSHIP_SCOPE'));
});

test('schema3 all sixteen cardinalities, multi-type properties and catalog shape roundtrip without legacy fields', async t => {
  const f = await fixture(t), model = graph(), ends = ['0..*', '1..*', '1..1', '0..1'] as const;
  model.relationshipTypes = [];
  model.relationships = ends.flatMap((sourceCardinality, i) => ends.map((targetCardinality, j) => {
    const n = i * 4 + j;
    model.relationshipTypes.push(type(`relationship-type-${n}`, `Type ${n}`));
    return { id: `relationship-${n}`, relationshipTypeId: `relationship-type-${n}`, source: 'node-1', target: 'node-1', sourceCardinality, targetCardinality };
  }));
  const saved = await f.request('models', { name: 'Canonical', model }); assert.equal(saved.status, 201);
  assert.deepEqual(saved.body.model, { ...model, revision: 1 });
  const path = join(f.directory, 'models', `${saved.body.id}.json`), bytes = await readFile(path), before = await stat(path);
  const catalog = await f.request('model-catalog');
  assert.deepEqual(catalog.body.models, [{ id: saved.body.id, name: 'Canonical', available: true, revision: 1, sourceSchemaVersion: 3, definitions: model.nodes.map(n => { const { x, y, ...definition } = n; return definition; }), relationshipTypes: model.relationshipTypes, constraints: [], indexes: [] }]);
  assert.deepEqual((await f.request('models/' + saved.body.id)).body.model, { ...model, revision: 1 });
  assert.deepEqual(await readFile(path), bytes); assert.equal((await stat(path)).mtimeMs, before.mtimeMs);
  const validation = await f.request('model-validation', { modelId: saved.body.id, model }); assert.equal(validation.body.valid, true);
  assert.equal(validation.body.issues.filter((i: any) => i.code === 'CARDINALITY_ANNOTATION').length, 16);
});

test('validation/export enforce strict candidate envelopes and lookup-only export stays read-only', async t => {
  const f = await fixture(t), model = emptyModel();
  model.indexes = [{ ...index('LOOKUP', []), targets: [], config: { entity: 'node' } }];
  const result = await f.exportGraph(model); assert.equal(result.status, 200); assert.equal(result.body.content, 'CREATE LOOKUP INDEX `LOOKUP index` IF NOT EXISTS FOR (e) ON EACH labels(e);\n');
  for (const patch of [{ modelId: '../invalid' }, { excludeDrafts: null }, { model: { ...model, revision: 0 } }, { extra: true }]) {
    for (const endpoint of ['model-validation', 'model-export']) {
      assert.equal((await f.request(endpoint, { modelId: 'legacy', model, ...(endpoint === 'model-export' ? { format: 'json' } : {}), ...patch })).status, 400);
    }
  }
  assert.equal((await f.request('model-export', { modelId: 'legacy', model, format: 'sql' })).status, 400);
  assert.ok(!(await readdir(f.directory)).includes('models'));
});

function legacyExpansion(count: number, key: boolean, schemaVersion = 2) {
  return { schemaVersion, nodes: Array.from({ length: count }, (_, n) => ({
    kind: 'definition', id: `node-${n}`, name: `Node${String.fromCharCode(65 + Math.floor(n / 26), 65 + n % 26)}`,
    x: 60 + n * 200, y: 60, classification: 'Transactional', draft: false,
    properties: Array.from({ length: 100 }, (_, p) => ({ name: `p${p}`, dataType: 'STRING', description: '', nodeKey: key, uniqueness: true, mustExist: true, index: key ? 'Range' : 'Text' })),
  })), relationships: [] };
}

test('legacy expansion beyond 1000 schema objects remains readable after singleton/named publication and restart', async t => {
  const f = await fixture(t);
  for (const schemaVersion of [1, 2]) {
    const legacy = legacyExpansion(11, true, schemaVersion);
    const normalized = modelInput(legacy);
    assert.equal(normalized.constraints.length, 1100);
    assert.deepEqual(modelInput(normalized), normalized);
    const saved = await f.request('model', { expectedRevision: (schemaVersion - 1) * 2, model: legacy }, 'PUT');
    assert.equal(saved.status, 200);
    const created = await f.request('models', { name: `Migrated ${schemaVersion}`, model: legacy });
    assert.equal(created.status, 201);
    await f.restart();
    for (const [id, path] of [['legacy', f.modelPath], [created.body.id, join(f.directory, 'models', `${created.body.id}.json`)]]) {
      const bytes = await readFile(path), before = await stat(path);
      assert.equal((await f.request(id === 'legacy' ? 'model' : `models/${id}`)).status, 200);
      assert.equal((await openNamedModelStore(f.modelPath).readPhysical(id)).entry.model.constraints.length, 1100);
      const listing = await f.request('models'); assert.ok(listing.body.models.find((m: any) => m.id === id).available);
      const catalog = await f.request('model-catalog'); assert.equal(catalog.body.models.find((m: any) => m.id === id).constraints.length, 1100);
      assert.deepEqual(await readFile(path), bytes); assert.equal((await stat(path)).mtimeMs, before.mtimeMs);
    }
    const canonical = { ...normalized };
    assert.equal((await f.request('model', { expectedRevision: saved.body.model.revision, model: canonical }, 'PUT')).status, 200);
    assert.equal((await f.request('models/' + created.body.id, { expectedRevision: 1, name: 'Canonical', model: canonical }, 'PUT')).status, 200);
    await f.restart();
    assert.deepEqual((await f.request('model')).body.model, { ...canonical, revision: schemaVersion * 2 });
    assert.deepEqual((await openNamedModelStore(f.modelPath).read(created.body.id)).model, { ...canonical, revision: 2 });
  }
});

test('canonical schema limits cover the complete 200×100 legacy annotation expansion without truncation', t => {
  const normalized = modelInput(legacyExpansion(200, false));
  assert.equal(normalized.constraints.length, MAX_MODEL_CONSTRAINTS);
  assert.equal(normalized.indexes.length, MAX_MODEL_INDEXES);
  assert.deepEqual(modelInput(normalized), normalized);
  const bytes = Buffer.byteLength(JSON.stringify({ expectedRevision: 1, model: normalized }));
  assert.ok(bytes < MODEL_BODY_LIMIT, `${bytes} bytes must fit the model request limit`);
  t.diagnostic(`Full legacy annotation expansion: ${bytes} canonical request bytes, ${normalized.constraints.length} constraints, ${normalized.indexes.length} indexes.`);
  assert.throws(() => modelInput({ ...normalized, constraints: [...normalized.constraints, { ...constraint(), id: 'constraint-40001' }] }), /at most 40000/);
  assert.throws(() => modelInput({ ...normalized, indexes: [...normalized.indexes, { ...index(), id: 'index-20001' }] }), /at most 20000/);
});

test('a valid sub-512KiB legacy graph expanding beyond 2MiB can save and resubmit its canonical schema3 graph', async t => {
  const f = await fixture(t), legacy = legacyExpansion(38, false);
  const legacyBytes = Buffer.byteLength(JSON.stringify({ expectedRevision: 0, model: legacy }));
  assert.ok(legacyBytes < 512 * 1024, `${legacyBytes} legacy bytes`);
  const normalized = modelInput(legacy);
  const canonicalBytes = Buffer.byteLength(JSON.stringify({ expectedRevision: 1, model: normalized }));
  assert.ok(canonicalBytes > 2 * 1024 * 1024, `${canonicalBytes} canonical bytes`);
  assert.equal(normalized.constraints.length, 7600); assert.equal(normalized.indexes.length, 3800);
  assert.deepEqual(modelInput(normalized), normalized);
  assert.equal((await f.request('model', { expectedRevision: 0, model: legacy }, 'PUT')).status, 200);
  assert.equal((await f.request('model', { expectedRevision: 1, model: normalized }, 'PUT')).status, 200);
  assert.deepEqual(await openModelStore(f.modelPath).read(), { ...normalized, revision: 2 });
  t.diagnostic(`Legacy request ${legacyBytes} bytes; canonical request ${canonicalBytes} bytes.`);
});

test('VECTOR filter properties allow only supported scalar union members and block unsupported exports', async t => {
  const f = await fixture(t);
  const allowed = ['INTEGER', 'FLOAT', 'STRING', 'BOOLEAN', 'DATE', 'LOCAL TIME', 'ZONED TIME', 'LOCAL DATETIME', 'ZONED DATETIME', 'DURATION', 'Bool', 'Int', 'INTEGER | STRING', 'FLOAT | DATE | DURATION', 'String NOT NULL'];
  const forbidden = ['UUID', 'PROPERTY VALUE', 'ANY PROPERTY VALUE', 'ANY', 'POINT', 'LIST<INTEGER>', 'VECTOR<FLOAT32>(3)', 'MAP', 'STRING | UUID', 'INTEGER | POINT', 'STRING | LIST<STRING>', 'STRING | PROPERTY VALUE'];
  for (const declaration of [...allowed, ...forbidden]) {
    const model = graph();
    model.nodes[0] = { ...node(), properties: [prop('embedding', 'VECTOR<FLOAT32>(3)'), prop('filter', declaration)] };
    model.indexes = [{ ...index('VECTOR', ['embedding']), filterProperties: ['filter'] }];
    const result = await f.validate(model), expected = allowed.includes(declaration);
    assert.equal(result.status, 200);
    assert.equal(result.body.valid, expected, declaration);
    const exported = await f.exportGraph(model);
    assert.equal(exported.status, expected ? 200 : 422, declaration);
    if (!expected) {
      assert.equal(exported.body.content, undefined);
      assert.ok(exported.body.validation.issues.some((i: any) => ['VECTOR_FILTER_TYPE', 'UNKNOWN_PROPERTY_TYPE'].includes(i.code)), declaration);
    }
  }
});

test('graph-type property enforcement follows explicit TYPE/EXISTS/KEY only, including relationship properties', async t => {
  const f = await fixture(t), model = graph();
  model.nodes[0] = { ...node(), impliedLabels: ['Resident'], properties: [
    prop('annotation', 'STRING'), prop('outer', 'STRING NOT NULL'), prop('generic', 'VECTOR'),
    prop('required', 'STRING'), prop('typed', 'INTEGER NOT NULL'), prop('key', 'STRING'), prop('both', 'DATE'), prop('unique', 'STRING'),
  ] };
  model.relationshipTypes[0] = { ...type(), sourceLabel: 'Resident', properties: [prop('annotation'), prop('required'), prop('typed', 'DATE')] };
  model.constraints = [constraint('EXISTS', ['required']),
    { ...constraint('TYPE', ['typed']), id: 'constraint-2', name: 'typed' },
    { ...constraint('KEY', ['key']), id: 'constraint-3', name: 'key' },
    { ...constraint('TYPE', ['both']), id: 'constraint-4', name: 'both type' },
    { ...constraint('EXISTS', ['both']), id: 'constraint-5', name: 'both required' },
    { ...constraint('EXISTS', ['required']), id: 'constraint-6', name: 'rel required', target: { kind: 'relationship', definitionId: 'relationship-type-1' } },
    { ...constraint('TYPE', ['typed']), id: 'constraint-7', name: 'rel typed', target: { kind: 'relationship', definitionId: 'relationship-type-1' } },
    { ...constraint('UNIQUE', ['unique']), id: 'constraint-8', name: 'unique only' },
  ];
  const result = await f.exportGraph(model, 'graph-type', { acknowledgeGraphTypeReplacement: true });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.ok(!result.body.content.includes('`annotation`')); assert.ok(!result.body.content.includes('`generic`')); assert.ok(!result.body.content.includes('`outer`'));
  assert.ok(!result.body.content.includes(':: STRING')); assert.ok(!result.body.content.includes('VECTOR'));
  assert.ok(result.body.content.includes('`required` :: ANY NOT NULL'));
  assert.ok(result.body.content.includes('`typed` :: INTEGER,'));
  assert.ok(!result.body.content.includes('`typed` :: INTEGER NOT NULL'));
  assert.ok(result.body.content.includes('`key` :: ANY NOT NULL'));
  assert.ok(result.body.content.includes('`both` :: DATE NOT NULL'));
  assert.ok(result.body.content.includes('IS KEY'));
  assert.ok(result.body.content.includes('REQUIRE (e.`unique`) IS UNIQUE'));
  assert.ok(!result.body.content.includes('`unique` ::'));
  assert.ok(result.body.content.includes('[:`KNOWS` => {`required` :: ANY NOT NULL, `typed` :: DATE}]'));
  assert.ok(result.body.validation.issues.some((i: any) => i.code === 'OUTER_NOT_NULL'));
});

test('graph-type unconstrained declarations stay annotations; explicit invalid TYPE stays blocking and unknown legacy types remain strict', async t => {
  const f = await fixture(t), model = graph();
  model.relationshipTypes = [];
  model.nodes[0] = { ...node(), impliedLabels: ['Resident'], properties: [prop('embedding', 'VECTOR')] };
  let result = await f.exportGraph(model, 'graph-type', { acknowledgeGraphTypeReplacement: true });
  assert.equal(result.status, 200); assert.ok(result.body.content.includes('(:`Person` => :`Resident`)')); assert.ok(!result.body.content.includes('::'));
  model.constraints = [constraint('TYPE', ['embedding'])];
  result = await f.exportGraph(model, 'graph-type', { acknowledgeGraphTypeReplacement: true });
  assert.equal(result.status, 422); assert.ok(result.body.validation.issues.some((i: any) => i.code === 'TYPE_VECTOR_PARAMETERS')); assert.equal(result.body.content, undefined);
  model.constraints = []; model.nodes[0] = { ...node(), properties: [prop('annotation')] };
  result = await f.exportGraph(model, 'graph-type', { acknowledgeGraphTypeReplacement: true });
  assert.equal(result.status, 422); assert.ok(result.body.validation.issues.some((i: any) => i.code === 'GRAPH_TYPE_EMPTY_ELEMENT'));
  model.nodes[0] = { ...node(), impliedLabels: ['Resident'], properties: [prop('custom', 'old custom type')] };
  assert.doesNotThrow(() => modelInput(model));
  result = await f.exportGraph(model, 'graph-type', { acknowledgeGraphTypeReplacement: true });
  assert.equal(result.status, 422); assert.ok(result.body.validation.issues.some((i: any) => i.code === 'UNKNOWN_PROPERTY_TYPE')); assert.equal(result.body.content, undefined);
});

test('native UUID export requirements include version, Enterprise and block format or Aura', async t => {
  const f = await fixture(t), model = graph(); model.relationshipTypes = [];
  model.nodes[0] = { ...node(), properties: [prop('id', 'UUID')] };
  model.constraints = [constraint('TYPE', ['id'])];
  for (const format of ['cypher', 'graph-type']) {
    const result = await f.exportGraph(model, format, { acknowledgeGraphTypeReplacement: true });
    assert.equal(result.status, 200);
    assert.ok(result.body.requirements.some((s: string) => s.includes('UUID') && s.includes('2026.08') && s.includes('Enterprise') && s.includes('block format') && s.includes('Aura')));
  }
});
