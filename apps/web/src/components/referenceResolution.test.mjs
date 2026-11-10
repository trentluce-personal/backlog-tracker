import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveReference } from './referenceResolution.ts';

const reference = { kind: 'reference', classification: 'External Reference', target: { modelId: 'target', nodeId: 'node-0' } };
const definition = { kind: 'definition', id: 'node-0', name: 'Catalog', properties: [] };
const catalog = [{ id: 'target', name: 'Target', available: true, definitions: [definition] }];
const resolve = (models, loaded, loading, error = '', stale = false) => resolveReference(reference, 'source', 'Source', [], models, stale, loaded, loading, error);

test('external reference absence is unresolved only after successful discovery', () => {
  assert.equal(resolve([], false, false).status, 'Resolving reference…');
  assert.equal(resolve([], false, true).status, 'Resolving reference…');
  assert.equal(resolve([], false, false, 'Offline').status, 'Reference unavailable');
  assert.equal(resolve([], true, false).status, 'Unresolved reference');
  assert.equal(resolve([{ id: 'target', available: false }], true, false).status, 'Reference unavailable');
});

test('refresh preserves cached definitions and internal resolution stays local', () => {
  assert.equal(resolve(catalog, true, true).definition, definition);
  assert.equal(resolve(catalog, true, true).status, 'Resolved reference');
  assert.equal(resolve(catalog, true, false, 'Offline', true).status, 'Stale reference data');
  const internal = { ...reference, classification: 'Internal Reference', target: { modelId: 'source', nodeId: 'node-0' } };
  assert.equal(resolveReference(internal, 'source', 'Source', [definition], [], false, false, true).status, 'Resolved reference');
  assert.equal(resolveReference(internal, 'source', 'Source', [], [], false, false, true).status, 'Unresolved reference');
});
