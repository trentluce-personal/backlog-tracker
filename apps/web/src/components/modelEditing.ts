import type { DefinitionTarget, ModelConstraint, ModelIndex, ModelInput, ModelProperty, ModelRelationship, ModelRelationshipType, ReferenceCatalogModel } from '../types';
// @ts-expect-error Explicit extension supports the repository's native Node TS tests.
import { nextSchemaId, sameTarget } from './schemaObjects.ts';

export type PropertyRow = { id: string; value: ModelProperty; committed: ModelProperty | null; editing: boolean; errors: Partial<Record<keyof ModelProperty, string>> };
export type NameDraft = { value: string; error: string };
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export const makePropertyRows = (properties: ModelProperty[]): PropertyRow[] => properties.map(value => ({ id: crypto.randomUUID(), value, committed: value, editing: false, errors: {} }));
export function reconcileRows(rows: PropertyRow[], before: ModelProperty[], after: ModelProperty[]): PropertyRow[] {
  if (equal(before, after)) return rows;
  const used = new Set<number>();
  const next = rows.flatMap(row => {
    if (!row.committed) return [row];
    const oldIndex = before.findIndex(property => property.name === row.committed!.name);
    let index = after.findIndex(property => property.name === row.committed!.name);
    // A rename keeps its position; only use this fallback when both sides have
    // the same shape, so deletion cannot attach a draft to a different property.
    if (index < 0 && before.length === after.length && oldIndex >= 0 && !before.some(property => property.name === after[oldIndex].name)) index = oldIndex;
    if (index < 0 || used.has(index)) return row.editing && !equal(row.value, row.committed) ? [{ ...row, committed: null }] : [];
    used.add(index);
    const committed = after[index];
    return [{ ...row, committed, value: row.editing && !equal(row.value, row.committed) ? row.value : committed }];
  });
  return [...next, ...makePropertyRows(after.filter((_, index) => !used.has(index)))];
}
export function reconcileDefinitionDrafts(before: ModelInput, after: ModelInput, properties: Record<string, PropertyRow[]>, names: Record<string, NameDraft>) {
  const old = [...before.nodes, ...before.relationshipTypes];
  const definitions = [...after.nodes, ...after.relationshipTypes];
  const nextProperties: typeof properties = {}, nextNames: typeof names = {};
  for (const definition of definitions) {
    const previous = old.find(item => item.id === definition.id && item.kind === definition.kind);
    if (!previous) continue;
    if (properties[definition.id] && definition.kind === 'definition' && previous.kind === 'definition') nextProperties[definition.id] = reconcileRows(properties[definition.id], previous.properties, definition.properties);
    const draft = names[definition.id];
    if (draft) nextNames[definition.id] = draft.value === previous.name ? { value: definition.name, error: '' } : draft;
  }
  return { properties: nextProperties, names: nextNames };
}
export function keyConversion(target: DefinitionTarget, property: string, constraints: ModelConstraint[], indexes: ModelIndex[]) {
  const singleton = (properties: string[]) => properties.length === 1 && properties[0] === property;
  const unique = constraints.find(item => item.kind === 'UNIQUE' && sameTarget(item.target, target) && singleton(item.properties));
  const replacedIndexes = indexes.filter(item => item.kind === 'RANGE' && item.targets.length === 1 && sameTarget(item.targets[0], target) && singleton(item.properties));
  const key: ModelConstraint = unique ? { ...unique, kind: 'KEY' } : { id: nextSchemaId('constraint', constraints), name: `${target.definitionId}_${property}_KEY`, draft: false, kind: 'KEY', target, properties: [property] };
  return { constraints: [...constraints.filter(item => !(item.kind === 'UNIQUE' && sameTarget(item.target, target) && singleton(item.properties))), key], indexes: indexes.filter(item => !replacedIndexes.includes(item)), replacedIndexes };
}
export function renamePropertySchema(model: ModelInput, target: DefinitionTarget, oldName: string, newName: string): ModelInput {
  const rename = (names: string[]) => names.map(name => name === oldName ? newName : name);
  return { ...model, constraints: model.constraints.map(item => sameTarget(item.target, target) ? { ...item, properties: rename(item.properties) } : item), indexes: model.indexes.map(item => item.targets.length === 1 && sameTarget(item.targets[0], target) ? { ...item, properties: rename(item.properties), filterProperties: rename(item.filterProperties) } : item) };
}
export const duplicateRelationship = (edges: ModelRelationship[], candidate: ModelRelationship) => edges.some(edge => edge.id !== candidate.id && edge.source === candidate.source && edge.target === candidate.target && edge.relationshipTypeId === candidate.relationshipTypeId);
export function referenceAlias(name: string, localNames: string[]): string {
  const base = [...name.trim()].slice(0, 100).join('').trim() || 'Reference';
  const occupied = new Set(localNames.map(name => name.trim()));
  if (!occupied.has(base)) return base;
  for (let number = 2; ; number++) {
    const suffix = ` ${number}`;
    const candidate = [...base].slice(0, 100 - suffix.length).join('').trimEnd() + suffix;
    if (!occupied.has(candidate)) return candidate;
  }
}
export function catalogTypeReference(types: ModelRelationshipType[], modelId: string, targetModelId: string, definition: { id: string; name: string }) {
  const existing = types.find(type => type.kind === 'reference' && type.target.modelId === targetModelId && type.target.relationshipTypeId === definition.id);
  if (existing) return existing;
  return { kind: 'reference' as const, id: nextSchemaId('relationship-type', types), name: referenceAlias(definition.name, types.map(type => type.name)), classification: targetModelId === modelId ? 'Internal Reference' as const : 'External Reference' as const, target: { modelId: targetModelId, relationshipTypeId: definition.id } };
}
export function resolveTypeOwner(type: ModelRelationshipType, model: ModelInput, modelId: string | null, catalog: ReferenceCatalogModel[]) {
  const empty: ModelInput = { schemaVersion: 3, nodes: [], relationships: [], relationshipTypes: [], constraints: [], indexes: [] };
  const foreign = type.kind === 'reference' && type.target.modelId !== modelId ? catalog.find(item => item.id === type.target.modelId) : undefined;
  const owner = type.kind === 'definition' || type.target.modelId === modelId ? model : foreign?.available ? { ...empty, relationshipTypes: foreign.relationshipTypes, constraints: foreign.constraints, indexes: foreign.indexes } : empty;
  const id = type.kind === 'definition' ? type.id : type.target.relationshipTypeId;
  const definition = owner.relationshipTypes.find(item => item.kind === 'definition' && item.id === id);
  return { owner: definition ? owner : empty, definition: definition?.kind === 'definition' ? definition : undefined, target: { kind: 'relationship' as const, definitionId: id } };
}
