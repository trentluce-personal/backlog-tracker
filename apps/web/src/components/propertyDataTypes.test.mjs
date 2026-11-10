import assert from 'node:assert/strict';
import test from 'node:test';
import { listPropertyDataTypes, propertyDataTypes, scalarPropertyDataTypes } from './propertyDataTypes.ts';

test('Cypher 25 persistable property options: 13 scalars and 12 homogeneous lists', () => {
  const scalars = ['BOOLEAN', 'DATE', 'DURATION', 'FLOAT', 'INTEGER', 'LOCAL DATETIME', 'LOCAL TIME', 'POINT', 'STRING', 'UUID', 'VECTOR', 'ZONED DATETIME', 'ZONED TIME'];
  assert.deepEqual(scalarPropertyDataTypes, scalars);
  assert.deepEqual(listPropertyDataTypes, scalars.filter(type => type !== 'VECTOR').map(type => `LIST<${type}>`));
  assert.equal(new Set(propertyDataTypes).size, 25);
  for (const excluded of ['LIST<VECTOR>', 'NODE', 'RELATIONSHIP', 'PATH', 'MAP', 'ANY', 'NULL', 'LIST', 'BYTE ARRAY']) {
    assert.ok(!propertyDataTypes.includes(excluded), excluded);
  }
});
