import type { RefObject } from 'react';
import type { ModelDefinition, ReferenceCatalogModel, ReferenceClassification } from '../types';

export function ReferenceTargetFields({ classification, modelId, definitions, models, targetModel, targetNode, onModel, onNode, modelRef, nodeRef, errorField, loading, error, onRetry }: {
  classification: ReferenceClassification; modelId: string | null; definitions: ModelDefinition[]; models: ReferenceCatalogModel[];
  targetModel: string; targetNode: string; onModel: (id: string) => void; onNode: (id: string) => void;
  modelRef: RefObject<HTMLSelectElement | null>; nodeRef: RefObject<HTMLSelectElement | null>;
  errorField: 'name' | 'model' | 'node'; loading: boolean; error: string; onRetry: () => void;
}) {
  const external = classification === 'External Reference';
  const candidates = models.filter(model => model.id !== modelId);
  const selected = candidates.find(model => model.id === targetModel);
  const nodes = external ? selected?.available ? selected.definitions : [] : definitions;
  return <>
    {external && <><label htmlFor="reference-model">Target model</label>
      <select ref={modelRef} id="reference-model" value={targetModel} aria-invalid={errorField === 'model'} aria-describedby={errorField === 'model' ? 'model-node-error' : undefined} onChange={event => onModel(event.target.value)}>
        <option value="">Select model</option>
        {candidates.map(model => <option key={model.id} value={model.id} disabled={!model.available}>{model.name} · {model.id}{model.available ? '' : ' · Unavailable'}</option>)}
      </select>
      {!loading && !candidates.length && <p className="modeling-hint" role="status">No saved models</p>}
    </>}
    <label htmlFor="reference-node">Target node</label>
    <select ref={nodeRef} id="reference-node" value={targetNode} aria-invalid={errorField === 'node'} aria-describedby={errorField === 'node' ? 'model-node-error' : undefined} onChange={event => onNode(event.target.value)}>
      <option value="">Select definition</option>{nodes.map(node => <option key={node.id} value={node.id}>{node.name}</option>)}
    </select>
    {!nodes.length && (!external || targetModel) && <p className="modeling-hint" role="status">{selected && !selected.available ? 'Model unavailable' : 'No definitions'}</p>}
    {external && <div className="reference-refresh">{loading && <span role="status">Loading targets…</span>}{error && <p className="modeling-error" role="alert">{error}</p>}<button type="button" className="text-button" disabled={loading} onClick={onRetry}>{error ? 'Retry' : 'Refresh targets'}</button></div>}
  </>;
}
