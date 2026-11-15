import type { DefinitionTarget, ModelConstraint, ModelIndex } from '../types';

export const malformedUnicode = (value: string) => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
export const identifierError = (value: string) => !value.trim() || value.length > 16383 || /\p{Cc}/u.test(value) || malformedUnicode(value)
  ? 'Enter a Neo4j identifier of 1–16,383 UTF-16 units without control characters.' : '';
export const sameTarget = (a: DefinitionTarget, b: DefinitionTarget) => a.kind === b.kind && a.definitionId === b.definitionId;
export const nextSchemaId = (prefix: string, objects: { id: string }[]) => `${prefix}-${Math.max(-1, ...objects.map(item => Number(item.id.slice(prefix.length + 1))).filter(Number.isSafeInteger)) + 1}`;
export function propertySchema(name: string, target: DefinitionTarget, constraints: ModelConstraint[], indexes: ModelIndex[]) {
  const relevant = constraints.filter(item => sameTarget(item.target, target) && item.properties.includes(name));
  // A composite key does not make each component independently unique.
  const key = relevant.some(item => item.kind === 'KEY' && item.properties.length === 1);
  const required = relevant.some(item => item.kind === 'KEY' || item.kind === 'EXISTS');
  const unique = key || relevant.some(item => item.kind === 'UNIQUE' && item.properties.length === 1);
  return { key, required, unique, owned: relevant.filter(item => item.kind === 'KEY' || item.kind === 'UNIQUE'), indexes: indexes.filter(item => item.targets.some(other => sameTarget(other, target)) && item.properties.includes(name)) };
}
