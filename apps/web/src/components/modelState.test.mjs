import assert from 'node:assert/strict';
import test from 'node:test';
import { serializeModel, rebaseNodes, rebaseTypes } from './modelState.ts';

test('all schema arrays and shared type property edits participate in saved baseline', () => {
  const graph = { schemaVersion: 3, nodes: [], relationshipTypes: [{ id: 'relationship-type-0', kind: 'definition', name: 'works', draft: false, properties: [{ name: 'since', dataType: 'DATE', description: '' }], sourceLabel: null, targetLabel: null }], relationships: [], constraints: [], indexes: [] };
  const baseline = serializeModel(graph);
  for (const field of ['nodes', 'relationshipTypes', 'relationships', 'constraints', 'indexes']) {
    assert.notEqual(serializeModel({ ...graph, [field]: [...graph[field], { id: 'new' }] }), baseline);
  }
  const newer = structuredClone(graph); newer.relationshipTypes[0].properties[0].description = 'Newer in-flight edit';
  assert.notEqual(serializeModel(newer), baseline);
  assert.equal(JSON.parse(baseline).relationshipTypes[0].properties[0].description, '');
});
test('copy rebases only internal node and type target model IDs, retaining newer fields', () => {
  const node = { kind: 'reference', classification: 'Internal Reference', target: { modelId: 'old', nodeId: 'node-0' }, name: 'new alias' };
  const type = { kind: 'reference', classification: 'Internal Reference', target: { modelId: 'old', relationshipTypeId: 'relationship-type-0' } };
  assert.deepEqual(rebaseNodes([node], 'new')[0], { ...node, target: { ...node.target, modelId: 'new' } });
  assert.deepEqual(rebaseTypes([type], 'new')[0].target, { modelId: 'new', relationshipTypeId: 'relationship-type-0' });
  const external = { ...type, classification: 'External Reference' };
  assert.equal(rebaseTypes([external], 'new')[0], external);
});
