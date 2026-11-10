// Neo4j Cypher 25, consulted 2026-11-08:
// https://neo4j.com/docs/cypher-manual/current/values-and-types/property-structural-constructed/
// Property lists are homogeneous, contain no nulls, and cannot contain VECTOR.
// Byte arrays are pass-through values, not a first-class Cypher type; omitted.
// VECTOR is a generic annotation here (no dimension/coordinate configuration).
// Vector property storage requires Enterprise block format or Aura, not Community.
export const scalarPropertyDataTypes = [
  'BOOLEAN', 'DATE', 'DURATION', 'FLOAT', 'INTEGER', 'LOCAL DATETIME',
  'LOCAL TIME', 'POINT', 'STRING', 'UUID', 'VECTOR', 'ZONED DATETIME', 'ZONED TIME',
] as const;

export const listPropertyDataTypes = scalarPropertyDataTypes
  .filter(type => type !== 'VECTOR')
  .map(type => `LIST<${type}>`);

export const propertyDataTypes: readonly string[] = [...scalarPropertyDataTypes, ...listPropertyDataTypes];
