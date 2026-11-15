import { createContext, useContext, useRef, type Dispatch, type SetStateAction } from 'react';
import type { DefinitionTarget, ModelConstraint, ModelIndex, ModelInput } from '../types';
import { IndexEditor } from './IndexEditor';
import { associatedIndexes, indexDefinitions, indexDraftKey, makeIndexDraft, validateIndex, type IndexDrafts } from './indexEditing';
import { nextSchemaId, sameTarget } from './schemaObjects';
import './PropertyIndexes.css';

export const IndexDraftContext = createContext<{
  model: ModelInput; setModel: Dispatch<SetStateAction<ModelInput>>;
  drafts: IndexDrafts; setDrafts: Dispatch<SetStateAction<IndexDrafts>>;
} | null>(null);

export function PropertyIndexes({ name, rowId, onOpen, target, model, disabled = false, readOnly = false }: {
  name: string; rowId?: string; onOpen?: () => void; target: DefinitionTarget; model: ModelInput; disabled?: boolean; readOnly?: boolean;
}) {
  const context = useContext(IndexDraftContext);
  const root = useRef<HTMLDetailsElement>(null);
  const key = indexDraftKey(target, rowId ?? name);
  const draft = !readOnly ? context?.drafts[key] : undefined;
  const indexes = associatedIndexes(name, target, model.indexes);
  const owned = model.constraints.filter(item => sameTarget(item.target, target) && item.properties.includes(name) && (item.kind === 'KEY' || item.kind === 'UNIQUE'));
  const definitions = indexDefinitions(model);
  function finish() {
    context?.setDrafts(current => { const next = { ...current }; delete next[key]; return next; });
    requestAnimationFrame(() => { const control = root.current?.querySelector<HTMLButtonElement>('[data-index-add]:not(:disabled)'); (control ?? root.current?.querySelector<HTMLElement>('summary'))?.focus(); });
  }
  function configuration(index: ModelIndex, owner?: ModelConstraint) {
    return <><strong>{index.name}</strong><div>{index.kind} · {owner ? 'Derived · Read only' : index.draft ? 'Draft' : 'Active'}{readOnly && !owner ? ' · Read only' : ''}</div><dl>
      <dt>Targets</dt><dd><ol>{index.targets.map(target => <li key={`${target.kind}-${target.definitionId}`}>{definitions.find(definition => sameTarget(target, definition.target))?.name ?? target.definitionId} · {target.kind}<code>{target.definitionId}</code></li>)}</ol></dd>
      <dt>Properties · ordered</dt><dd><ol>{index.properties.map(property => <li key={property}>{property}</li>)}</ol></dd>
      {owner && <><dt>Owner</dt><dd>{owner.kind} · {owner.name}</dd></>}
      <dt>Filter properties · ordered</dt><dd>{index.filterProperties.length ? <ol>{index.filterProperties.map(property => <li key={property}>{property}</li>)}</ol> : '—'}</dd>
      <dt>Configuration JSON</dt><dd><pre>{JSON.stringify(index.config, null, 2)}</pre></dd>
    </dl></>;
  }
  return <details ref={root} className="property-index-menu"><summary>Indexes</summary><div className="property-index-body">
    <ul className="property-index-list">{owned.map(owner => <li key={`owned-${owner.id}`}>{configuration({ ...owner, kind: 'RANGE', targets: [owner.target], filterProperties: [], config: {} }, owner)}</li>)}{indexes.map(index => <li key={index.id}>{configuration(index)}{!readOnly && context && <div className="property-index-actions"><button type="button" disabled={disabled || Boolean(draft)} aria-label={`Edit index ${index.name}`} onClick={() => { onOpen?.(); context.setDrafts(current => ({ ...current, [key]: makeIndexDraft(index, true) })); }}>Edit</button><button type="button" disabled={disabled || Boolean(draft)} aria-label={`Delete index ${index.name}`} onClick={() => {
      if (!window.confirm(`Delete “${index.name}”?`)) return;
      context.setModel(current => ({ ...current, indexes: current.indexes.filter(item => item.id !== index.id) }));
      context.setDrafts(current => Object.fromEntries(Object.entries(current).filter(([, draft]) => !draft.existing || draft.value.id !== index.id)));
      requestAnimationFrame(() => root.current?.querySelector<HTMLButtonElement>('[data-index-add]')?.focus());
    }}>Delete</button></div>}</li>)}</ul>
    {!readOnly && context && <button type="button" data-index-add disabled={disabled || Boolean(draft)} onClick={() => {
      onOpen?.();
      const id = nextSchemaId('index', [...context.model.indexes, ...Object.values(context.drafts).map(draft => draft.value)]);
      context.setDrafts(current => ({ ...current, [key]: makeIndexDraft({ id, name: '', kind: 'RANGE', draft: false, targets: [target], properties: [name], filterProperties: [], config: {} }, false) }));
    }}>Add index</button>}
    {draft && context && <IndexEditor model={context.model} draft={draft} disabled={disabled} allowLookup={false} onDraft={draft => context.setDrafts(current => ({ ...current, [key]: draft }))} onCancel={finish} onApply={() => {
      const result = validateIndex(draft, context.model);
      if (!result.value) { context.setDrafts(current => ({ ...current, [key]: { ...draft, error: result.error } })); return; }
      const value = result.value;
      context.setModel(current => ({ ...current, indexes: draft.existing ? current.indexes.map(index => index.id === value.id ? value : index) : [...current.indexes, value] }));
      finish();
    }} />}
  </div></details>;
}
