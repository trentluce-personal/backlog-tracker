import assert from 'node:assert/strict';
import test from 'node:test';
import { identifierError, propertySchema } from './schemaObjects.ts';

const target = { kind: 'node', definitionId: 'node-0' };
const key = { id: 'constraint-0', name: 'key', draft: false, kind: 'KEY', target, properties: ['id'] };
test('key derives required, singleton uniqueness and owned range without creating extra objects', () => {
  const constraints = [key];
  const state = propertySchema('id', target, constraints, []);
  assert.equal(state.key, true); assert.equal(state.unique, true); assert.equal(state.required, true);
  assert.deepEqual(state.owned, [key]); assert.deepEqual(state.indexes, []);
  assert.equal(constraints.length, 1);
});
test('composite key requires components without independently making them unique', () => {
  const state = propertySchema('id', target, [{ ...key, properties: ['id', 'tenant'] }], []);
  assert.equal(state.key, false); assert.equal(state.unique, false); assert.equal(state.required, true);
});
test('removing a key retains explicit unique, existence and multiple indexes in correct scope', () => {
  const explicit = [{ ...key, kind: 'UNIQUE' }, { ...key, id: 'constraint-1', kind: 'EXISTS' }];
  const indexes = ['RANGE', 'TEXT', 'FULLTEXT'].map((kind, i) => ({ id: `index-${i}`, kind, targets: [target], properties: ['id'] }));
  const state = propertySchema('id', target, explicit, indexes);
  assert.equal(state.key, false); assert.equal(state.unique, true); assert.equal(state.required, true);
  assert.equal(state.indexes.length, 3);
  assert.equal(propertySchema('id', { kind: 'relationship', definitionId: 'node-0' }, explicit, indexes).required, false);
});
test('Neo4j identifiers retain exact Unicode, punctuation, casing and UTF-16 limits', () => {
  for (const name of ['customer', '客户 ` label!', 'a'.repeat(16383)]) assert.equal(identifierError(name), '');
  for (const name of ['', 'a'.repeat(16384), 'a\0', '\ud800']) assert.ok(identifierError(name));
});
