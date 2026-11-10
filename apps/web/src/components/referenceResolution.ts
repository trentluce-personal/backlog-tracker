import type { CatalogDefinition, ModelNode, ModelReference, ReferenceCatalogModel } from '../types';

export type ReferenceResolution = { definition?: CatalogDefinition; modelName: string; stale: boolean; status: 'Resolved reference' | 'Stale reference data' | 'Resolving reference…' | 'Reference unavailable' | 'Unresolved reference' };

export function resolveReference(reference: ModelReference, modelId: string | null, modelName: string, nodes: ModelNode[], models: ReferenceCatalogModel[], stale = false, loaded = true, loading = false, error = ''): ReferenceResolution {
  if (reference.classification === 'Internal Reference') {
    const node = reference.target.modelId === modelId ? nodes.find(node => node.id === reference.target.nodeId && node.kind === 'definition') : undefined;
    return { definition: node?.kind === 'definition' ? node : undefined, modelName, stale: false, status: node ? 'Resolved reference' : 'Unresolved reference' };
  }
  const model = models.find(model => model.id === reference.target.modelId && model.id !== modelId);
  const definition = model?.available ? model.definitions.find(node => node.id === reference.target.nodeId) : undefined;
  const status = definition ? stale ? 'Stale reference data' : 'Resolved reference'
    : loading || (!loaded && !error) ? 'Resolving reference…'
      : error || model?.available === false ? 'Reference unavailable' : 'Unresolved reference';
  return { definition, modelName: model?.name ?? reference.target.modelId, stale, status };
}
