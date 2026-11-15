import assert from 'node:assert/strict';
import test from 'node:test';
import { catalogTypeReference, duplicateRelationship, keyConversion, makePropertyRows, reconcileDefinitionDrafts, reconcileRows, referenceAlias, renamePropertySchema, resolveTypeOwner } from './modelEditing.ts';

const empty = () => ({ schemaVersion: 3, nodes: [], relationships: [], relationshipTypes: [], constraints: [], indexes: [] });
const target = { kind: 'relationship', definitionId: 'relationship-type-0' };
const property = { name: 'since', dataType: 'DATE', description: '' };
const type = { kind: 'definition', id: target.definitionId, name: 'Old', properties: [property], draft: false, sourceLabel: null, targetLabel: null };
test('deleted type caches are removed before a reused ID can resurrect properties or names', () => {
  const before = { ...empty(), relationshipTypes: [type] };
  const removed = reconcileDefinitionDrafts(before, empty(), { [type.id]: makePropertyRows(type.properties) }, { [type.id]: { value: 'Old', error: '' } });
  assert.deepEqual(removed, { properties: {}, names: {} });
  const recreated = reconcileDefinitionDrafts(empty(), { ...empty(), relationshipTypes: [{ ...type, name: 'New', properties: [] }] }, removed.properties, removed.names);
  assert.deepEqual(recreated, removed);
});
test('external edits synchronize clean caches and preserve only real dirty property/name drafts', () => {
  const before = { ...empty(), relationshipTypes: [type] };
  const changed = { ...type, name: 'Schema rename', properties: [{ ...property, description: 'Schema description' }] };
  const rows = makePropertyRows(type.properties);
  const clean = reconcileDefinitionDrafts(before, { ...empty(), relationshipTypes: [changed] }, { [type.id]: rows }, { [type.id]: { value: type.name, error: '' } });
  assert.equal(clean.names[type.id].value, changed.name);
  assert.equal(clean.properties[type.id][0].value.description, 'Schema description');
  const dirty = [{ ...rows[0], editing: true, value: { ...property, description: 'Unsubmitted description' } }];
  const kept = reconcileDefinitionDrafts(before, { ...empty(), relationshipTypes: [changed] }, { [type.id]: dirty }, { [type.id]: { value: 'Unsubmitted name', error: '' } });
  assert.equal(kept.properties[type.id][0].value.description, 'Unsubmitted description');
  assert.equal(kept.properties[type.id][0].committed.description, 'Schema description');
  assert.equal(kept.names[type.id].value, 'Unsubmitted name');
});
test('clean node property rename refreshes row while deletion retains dirty text as a new draft', () => {
  const rows = makePropertyRows([property]);
  assert.equal(reconcileRows(rows, [property], [{ ...property, name: 'renamed' }])[0].value.name, 'renamed');
  const dirty = [{ ...rows[0], editing: true, value: { ...property, description: 'keep' } }];
  assert.equal(reconcileRows(dirty, [property], [])[0].committed, null);
});
test('UNIQUE to KEY preserves identity/name and independent EXISTS/composites/other indexes', () => {
  const unique = { id: 'constraint-0', name: 'custom unique', draft: false, kind: 'UNIQUE', target, properties: ['since'] };
  const exists = { ...unique, id: 'constraint-1', kind: 'EXISTS' };
  const composite = { ...unique, id: 'constraint-2', properties: ['since', 'tenant'] };
  const range = { id: 'index-0', name: 'authored range', kind: 'RANGE', draft: false, targets: [target], properties: ['since'], filterProperties: [], config: {} };
  const text = { ...range, id: 'index-1', kind: 'TEXT' };
  const result = keyConversion(target, 'since', [unique, exists, composite], [range, text]);
  assert.deepEqual(result.replacedIndexes, [range]);
  assert.deepEqual(result.indexes, [text]);
  assert.deepEqual(result.constraints, [exists, composite, { ...unique, kind: 'KEY' }]);
});
test('property rename retargets owned schema only and preserves ambiguous multi-target selections for repair', () => {
  const constraint = { id: 'constraint-0', kind: 'TYPE', target, properties: ['since'] };
  const index = { id: 'index-0', targets: [target], properties: ['since'], filterProperties: ['since', 'tenant'] };
  const shared = { ...index, id: 'index-1', targets: [target, { kind: 'relationship', definitionId: 'relationship-type-1' }] };
  const result = renamePropertySchema({ ...empty(), constraints: [constraint], indexes: [index, shared] }, target, 'since', 'date');
  assert.deepEqual(result.constraints[0].properties, ['date']);
  assert.deepEqual(result.indexes[0].filterProperties, ['date', 'tenant']);
  assert.equal(result.indexes[1], shared);
});
test('internal reference resolves fresh local schema, unavailable external owner never leaks colliding local IDs', () => {
  const constraint = { id: 'constraint-0', name: 'fresh', target };
  const graph = { ...empty(), relationshipTypes: [type], constraints: [constraint] };
  const reference = { kind: 'reference', id: 'relationship-type-1', name: 'alias', classification: 'Internal Reference', target: { modelId: 'current', relationshipTypeId: type.id } };
  const stale = [{ id: 'current', available: true, relationshipTypes: [type], constraints: [], indexes: [] }];
  assert.equal(resolveTypeOwner(reference, graph, 'current', stale).owner, graph);
  assert.deepEqual(resolveTypeOwner({ ...reference, classification: 'External Reference', target: { ...reference.target, modelId: 'missing' } }, graph, 'current', []).owner.constraints, []);
  assert.equal(resolveTypeOwner({ ...reference, target: { ...reference.target, relationshipTypeId: 'missing' } }, graph, 'current', []).definition, undefined);
});
test('effective local type ID rejects duplicates but allows reverse and other-type parallel edges', () => {
  const edge = { id: 'relationship-0', source: 'node-0', target: 'node-1', relationshipTypeId: type.id };
  assert.equal(duplicateRelationship([edge], { ...edge, id: 'new' }), true);
  assert.equal(duplicateRelationship([edge], { ...edge, id: 'new', source: 'node-1', target: 'node-0' }), false);
  assert.equal(duplicateRelationship([edge], { ...edge, id: 'new', relationshipTypeId: 'relationship-type-1' }), false);
  assert.equal(duplicateRelationship([edge], edge), false);
});
test('reference alias trims and bounds Unicode code points independently of canonical spelling', () => {
  const canonical = `  ${'😀'.repeat(101)}  `;
  assert.equal(referenceAlias(canonical, []), '😀'.repeat(100));
  assert.equal(referenceAlias('  exact name  ', []), 'exact name');
  assert.equal(referenceAlias('名'.repeat(99) + ' suffix', []), '名'.repeat(99));
  assert.equal([...referenceAlias('😀'.repeat(100), [])].length, 100);
  assert.equal(canonical, `  ${'😀'.repeat(101)}  `);
});
test('alias collisions include local definitions and references, keeping suffix inside 100 code points', () => {
  const base = '😀'.repeat(100);
  const second = referenceAlias(base, [base]);
  assert.equal(second, '😀'.repeat(98) + ' 2');
  const third = referenceAlias(base, [base, second]);
  assert.equal(third, '😀'.repeat(98) + ' 3');
  assert.equal([...third].length, 100);
  assert.equal(referenceAlias('same', [' same ', 'same 2']), 'same 3');
});
test('catalog type factory reuses target identity before allocating alias or ID', () => {
  const canonical = `  ${'😀'.repeat(101)}  `;
  const source = { id: 'relationship-type-90', name: canonical };
  const reference = catalogTypeReference([type], 'local', 'external', source);
  assert.equal(reference.name, '😀'.repeat(100));
  assert.deepEqual(reference.target, { modelId: 'external', relationshipTypeId: source.id });
  assert.equal(catalogTypeReference([type, reference], 'local', 'external', { ...source, name: 'renamed canonical' }), reference);
  const other = catalogTypeReference([type, reference], 'local', 'another', source);
  assert.equal(other.name, '😀'.repeat(98) + ' 2');
  const internal = catalogTypeReference([type], 'local', 'local', { ...source, name: canonical });
  assert.equal(internal.classification, 'Internal Reference');
  assert.equal(internal.name, '😀'.repeat(100));
  assert.equal(source.name, canonical);
});
