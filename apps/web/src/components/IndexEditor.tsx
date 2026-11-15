import { useId, useRef } from 'react';
import type { ModelIndex, ModelInput } from '../types';
import { sameTarget } from './schemaObjects';
import { indexConfigKeys, indexDefinitions, indexDraftChanged, indexDraftConflict, makeIndexDraft, type IndexDraft } from './indexEditing';
import './PropertyIndexes.css';

export function IndexEditor({ model, draft, onDraft, onApply, onCancel, disabled = false, allowLookup = true }: {
  model: ModelInput; draft: IndexDraft; onDraft: (draft: IndexDraft) => void; onApply: () => void; onCancel: () => void; disabled?: boolean; allowLookup?: boolean;
}) {
  const id = useId();
  const root = useRef<HTMLFormElement>(null);
  const value = draft.value;
  const conflict = indexDraftConflict(draft, model);
  const definitions = indexDefinitions(model);
  const choices = [...new Set(definitions.filter(definition => value.targets.some(target => sameTarget(target, definition.target))).flatMap(definition => definition.properties.map(property => property.name)))];
  const keys = indexConfigKeys(value.kind);
  const configKey = keys.includes(draft.configKey) ? draft.configKey : keys[0] ?? '';
  const patch = (changes: Partial<ModelIndex>) => onDraft({ ...draft, value: { ...value, ...changes }, error: '' });
  function ordered(field: 'properties' | 'filterProperties') {
    const selected = value[field];
    return <fieldset><legend>{field === 'properties' ? 'Properties · ordered' : 'Filter properties · ordered'}</legend><div className="schema-checks">{choices.map(name => <label key={name}><input type="checkbox" checked={selected.includes(name)} onChange={event => patch({ [field]: event.target.checked ? [...selected, name] : selected.filter(item => item !== name) })} />{name}</label>)}</div><ol className="schema-order">{selected.map((name, i) => <li key={name}><span>{name}{choices.includes(name) ? '' : ' · Unavailable'}</span><button type="button" aria-label={`Move ${name} up`} disabled={!i} onClick={() => { const next = [...selected]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; patch({ [field]: next }); }}>↑</button><button type="button" aria-label={`Move ${name} down`} disabled={i === selected.length - 1} onClick={() => { const next = [...selected]; [next[i + 1], next[i]] = [next[i], next[i + 1]]; patch({ [field]: next }); }}>↓</button><button type="button" aria-label={`Remove ${field === 'properties' ? 'property' : 'filter property'} ${name}`} onClick={() => patch({ [field]: selected.filter(other => other !== name) })}>Remove</button></li>)}</ol></fieldset>;
  }
  return <form ref={root} className="modeling-form schema-form index-editor" aria-label="Index editor" onSubmit={event => { event.preventDefault(); event.stopPropagation(); onApply(); requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('[aria-invalid=true]')?.focus()); }} onKeyDown={event => {
    if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); onCancel(); }
  }}>
    <fieldset disabled={disabled} className="index-editor-fields">
      <label htmlFor={`${id}-name`}>Name</label><input id={`${id}-name`} type="text" data-dialog-initial-focus autoFocus maxLength={16383} value={value.name} aria-invalid={Boolean(draft.error)} aria-describedby={draft.error ? `${id}-error` : undefined} onChange={event => patch({ name: event.target.value })} />
      <label htmlFor={`${id}-type`}>Type</label><select id={`${id}-type`} value={value.kind} onChange={event => patch({ kind: event.target.value as ModelIndex['kind'] })}>{['RANGE', 'TEXT', 'POINT', 'FULLTEXT', 'VECTOR', ...(allowLookup || value.kind === 'LOOKUP' ? ['LOOKUP'] : [])].map(kind => <option key={kind}>{kind}</option>)}</select>
      <label className="schema-checkbox"><input type="checkbox" checked={value.draft} onChange={event => patch({ draft: event.target.checked })} />Draft</label>
      <fieldset><legend>Targets</legend>{definitions.map(definition => <label className="schema-target" key={`${definition.target.kind}-${definition.target.definitionId}`}><input type="checkbox" checked={value.targets.some(target => sameTarget(target, definition.target))} onChange={event => patch({ targets: event.target.checked ? [...value.targets, definition.target] : value.targets.filter(target => !sameTarget(target, definition.target)) })} />{definition.name} · {definition.target.kind}</label>)}<ol className="schema-order">{value.targets.map((target, i) => <li key={`${target.kind}-${target.definitionId}`}><span>{definitions.find(definition => sameTarget(target, definition.target))?.name ?? `${target.definitionId} · Unavailable`}</span><button type="button" aria-label={`Move target ${target.definitionId} up`} disabled={!i} onClick={() => { const targets = [...value.targets]; [targets[i - 1], targets[i]] = [targets[i], targets[i - 1]]; patch({ targets }); }}>↑</button><button type="button" aria-label={`Move target ${target.definitionId} down`} disabled={i === value.targets.length - 1} onClick={() => { const targets = [...value.targets]; [targets[i + 1], targets[i]] = [targets[i], targets[i + 1]]; patch({ targets }); }}>↓</button><button type="button" aria-label={`Remove target ${target.definitionId}`} onClick={() => patch({ targets: value.targets.filter(other => !sameTarget(other, target)) })}>Remove</button></li>)}</ol></fieldset>
      {ordered('properties')}{(value.kind === 'VECTOR' || value.filterProperties.length > 0) && ordered('filterProperties')}
      {keys.length > 0 && <><label htmlFor={`${id}-key`}>Configuration key</label><div className="schema-inline"><select id={`${id}-key`} value={configKey} onChange={event => onDraft({ ...draft, configKey: event.target.value })}>{keys.map(key => <option key={key}>{key}</option>)}</select><button type="button" onClick={() => {
        try { const config = JSON.parse(draft.config); if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error(); onDraft({ ...draft, config: JSON.stringify({ ...config, [configKey]: configKey.includes('dimensions') ? 1536 : configKey.includes('enabled') || configKey.includes('consistent') ? false : configKey.includes('hnsw.') ? 16 : configKey.startsWith('spatial.') ? (configKey.includes('-3d.') ? [0, 0, 0] : [0, 0]) : configKey === 'entity' ? 'node' : configKey.includes('similarity') ? 'cosine' : 'standard-no-stop-words' }, null, 2), error: '' }); } catch { onDraft({ ...draft, error: 'Correct configuration JSON first.' }); }
      }}>Add key</button></div></>}
      <label htmlFor={`${id}-config`}>Configuration JSON</label><textarea id={`${id}-config`} rows={5} value={draft.config} spellCheck={false} onChange={event => onDraft({ ...draft, config: event.target.value, error: '' })} />
      {draft.error && <p id={`${id}-error`} className="modeling-error" role="alert">{draft.error}</p>}
      <div className="dialog-actions"><button type="button" onClick={onCancel}>Cancel</button>{draft.existing && conflict && <button type="button" disabled={!model.indexes.some(index => index.id === value.id)} onClick={() => {
        const current = model.indexes.find(index => index.id === value.id);
        if (!current || (indexDraftChanged(draft) && !window.confirm('Reload index and discard your unsaved index changes?'))) return;
        onDraft(makeIndexDraft(current, true));
      }}>Reload index</button>}<button type="submit">Apply</button></div>
    </fieldset>
  </form>;
}
