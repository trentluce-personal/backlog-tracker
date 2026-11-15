import type { DefinitionTarget, ModelIndex, ModelInput } from '../types';
// @ts-expect-error Explicit extension supports the repository's native Node TS tests.
import { identifierError, malformedUnicode, sameTarget } from './schemaObjects.ts';

export type IndexDraft = { value: ModelIndex; config: string; configKey: string; error: string; existing: boolean; baseline: string };
export type IndexDrafts = Record<string, IndexDraft>;
export const indexDefinitions = (model: ModelInput) => [
  ...model.nodes.filter(node => node.kind === 'definition').map(node => ({ target: { kind: 'node' as const, definitionId: node.id }, name: node.name, properties: node.properties })),
  ...model.relationshipTypes.filter(type => type.kind === 'definition').map(type => ({ target: { kind: 'relationship' as const, definitionId: type.id }, name: type.name, properties: type.properties })),
];
export const indexConfigKeys = (kind: ModelIndex['kind']) => kind === 'POINT'
  ? ['cartesian', 'cartesian-3d', 'wgs-84', 'wgs-84-3d'].flatMap(crs => ['min', 'max'].map(bound => `spatial.${crs}.${bound}`))
  : kind === 'FULLTEXT' ? ['fulltext.analyzer', 'fulltext.eventually_consistent']
    : kind === 'VECTOR' ? ['vector.dimensions', 'vector.similarity_function', 'vector.quantization.enabled', 'vector.hnsw.m', 'vector.hnsw.ef_construction']
      : kind === 'LOOKUP' ? ['entity'] : [];
export const makeIndexDraft = (value: ModelIndex, existing: boolean): IndexDraft => ({ value: structuredClone(value), existing, baseline: JSON.stringify(value), config: JSON.stringify(value.config, null, 2), configKey: '', error: '' });
export const indexDraftKey = (target: DefinitionTarget, rowId: string) => `${target.kind}/${target.definitionId}/${rowId}`;
export function pruneIndexDrafts(drafts: IndexDrafts, target: DefinitionTarget, rowId?: string): IndexDrafts {
  const prefix = `${target.kind}/${target.definitionId}/`;
  return Object.fromEntries(Object.entries(drafts).filter(([key]) => rowId === undefined ? !key.startsWith(prefix) : key !== indexDraftKey(target, rowId)));
}
export function indexDraftChanged(draft: IndexDraft) {
  try { return JSON.stringify({ ...draft.value, config: JSON.parse(draft.config) }) !== draft.baseline; }
  catch { return true; }
}
export function indexDraftConflict(draft: IndexDraft, model: ModelInput) {
  const current = model.indexes.find(index => index.id === draft.value.id);
  return draft.existing ? !current ? 'This index no longer exists.' : JSON.stringify(current) !== draft.baseline ? 'This index changed in another editor. Reload index before applying.' : ''
    : current ? 'This index ID is already in use. Cancel and add the index again.' : '';
}
export function associatedIndexes(name: string, target: DefinitionTarget, indexes: ModelIndex[]) {
  return indexes.filter(index => index.targets.some(other => sameTarget(other, target)) && (index.properties.includes(name) || index.filterProperties?.includes(name)));
}
export function validateIndex(draft: IndexDraft, model: ModelInput): { value?: ModelIndex; error: string } {
  const index = draft.value;
  const conflict = indexDraftConflict(draft, model);
  if (conflict) return { error: conflict };
  const invalid = identifierError(index.name);
  if (invalid) return { error: invalid };
  if (model.constraints.some(item => item.name === index.name) || model.indexes.some(item => item.id !== index.id && item.name === index.name)) return { error: 'A constraint or index with this exact name already exists.' };
  if (draft.existing && !model.indexes.some(item => item.id === index.id)) return { error: 'This index no longer exists.' };
  const definitions = indexDefinitions(model);
  const choices = new Set(definitions.filter(definition => index.targets.some(target => sameTarget(target, definition.target))).flatMap(definition => definition.properties.map(property => property.name)));
  const { kind, targets, properties, filterProperties } = index;
  if (targets.some(target => !definitions.some(definition => sameTarget(target, definition.target))) || properties.some(name => !choices.has(name)) || filterProperties.some(name => !choices.has(name))) return { error: 'Remove unavailable properties or select matching targets.' };
  if (kind === 'LOOKUP' ? targets.length || properties.length || filterProperties.length : !targets.length || !properties.length || targets.some(target => target.kind !== targets[0].kind) || (['RANGE', 'TEXT', 'POINT'].includes(kind) && targets.length !== 1) || (['TEXT', 'POINT', 'VECTOR'].includes(kind) && properties.length !== 1) || (kind !== 'VECTOR' && filterProperties.length > 0) || filterProperties.some(name => properties.includes(name))) return { error: 'Check targets and properties for this index type.' };
  let config: ModelIndex['config'];
  try {
    config = JSON.parse(draft.config);
    if (!config || Array.isArray(config) || typeof config !== 'object') throw new Error();
  } catch { return { error: 'Enter a configuration JSON object.' }; }
  const allowed = indexConfigKeys(kind);
  for (const [key, value] of Object.entries(config)) {
    if (!allowed.includes(key)) return { error: 'Configuration keys must match the index type.' };
    if (key.startsWith('spatial.')) {
      if (!Array.isArray(value) || value.length !== (key.includes('-3d.') ? 3 : 2) || value.some(n => typeof n !== 'number' || !Number.isFinite(n))) return { error: 'Enter finite spatial bounds with matching dimensions.' };
      if (key.includes('wgs-84') && (Math.abs(value[0]) > 180 || Math.abs(value[1]) > 90)) return { error: 'Enter valid longitude and latitude bounds.' };
      const max = config[key.replace(/min$/, 'max')];
      if (key.endsWith('.min') && Array.isArray(max) && value.some((n, i) => n >= max[i])) return { error: 'Spatial minimum must be below maximum.' };
    } else if (['vector.dimensions', 'vector.hnsw.m', 'vector.hnsw.ef_construction'].includes(key)) {
      const max = key === 'vector.dimensions' ? 4096 : key === 'vector.hnsw.m' ? 512 : 3200;
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max) return { error: `Enter ${key} between 1 and ${max}.` };
    } else if (key === 'vector.similarity_function') { if (value !== 'cosine' && value !== 'euclidean') return { error: 'Select cosine or euclidean similarity.' }; }
    else if (key === 'entity') { if (value !== 'node' && value !== 'relationship') return { error: 'Select node or relationship entity.' }; }
    else if (key === 'fulltext.analyzer') { if (typeof value !== 'string' || !value || value.length > 100 || /\p{Cc}/u.test(value) || malformedUnicode(value)) return { error: 'Enter a valid fulltext analyzer.' }; }
    else if (typeof value !== 'boolean') return { error: 'Enter a boolean configuration value.' };
  }
  if (kind === 'LOOKUP' && !Object.hasOwn(config, 'entity')) return { error: 'LOOKUP requires an entity.' };
  return { value: { ...index, config }, error: '' };
}
