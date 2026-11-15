import { useContext, useId, useState } from 'react';
import type { ModelConstraint, ModelInput } from '../types';
import { Dialog } from './Dialog';
import { IndexesTable } from './IndexesTable';
import { IndexEditor } from './IndexEditor';
import { IndexDraftContext } from './PropertyIndexes';
import { indexDefinitions, makeIndexDraft, validateIndex, type IndexDraft } from './indexEditing';
import { identifierError, nextSchemaId, sameTarget } from './schemaObjects';

export function SchemaObjectsPanel({ model, onChange }: { model: ModelInput; onChange?: (model: ModelInput) => void }) {
  const [constraint, setConstraint] = useState<ModelConstraint | null>(null);
  const [index, setIndex] = useState<IndexDraft | null>(null);
  const [error, setError] = useState('');
  const id = useId();
  const context = useContext(IndexDraftContext);
  const definitions = indexDefinitions(model);
  const initialTarget = definitions[0]?.target;
  const choices = [...new Set(definitions.filter(definition => constraint && sameTarget(constraint.target, definition.target)).flatMap(definition => definition.properties.map(property => property.name)))];
  const patch = (changes: Partial<ModelConstraint>) => { if (constraint) setConstraint({ ...constraint, ...changes }); setError(''); };
  function applyConstraint() {
    if (!constraint || !onChange) return;
    const invalid = identifierError(constraint.name);
    if (invalid) { setError(invalid); return; }
    if (model.indexes.some(item => item.name === constraint.name) || model.constraints.some(item => item.id !== constraint.id && item.name === constraint.name)) { setError('A constraint or index with this exact name already exists.'); return; }
    if (constraint.properties.some(name => !choices.includes(name))) { setError('Remove unavailable properties or select matching targets.'); return; }
    if (!constraint.properties.length || (['TYPE', 'EXISTS'].includes(constraint.kind) && constraint.properties.length !== 1)) { setError('Select properties; TYPE and EXISTS require one property.'); return; }
    onChange({ ...model, constraints: [...model.constraints.filter(item => item.id !== constraint.id), constraint] }); setConstraint(null);
  }
  return <section className="schema-panel" aria-label="Schema objects">
    <section><div className="schema-section-heading"><h3>Constraints</h3><button type="button" disabled={!initialTarget} onClick={() => { if (initialTarget) { setConstraint({ id: nextSchemaId('constraint', model.constraints), name: '', draft: false, kind: 'KEY', target: initialTarget, properties: [] }); setError(''); } }}>Add constraint</button></div>
      <ul className="schema-object-list">{model.constraints.map(item => <li key={item.id}><div><strong>{item.name}</strong><span>{item.kind} · {item.properties.join(', ')}{item.draft ? ' · Draft' : ''}</span></div><button type="button" onClick={() => { setConstraint(item); setError(''); }}>Edit</button><button type="button" onClick={() => { if (window.confirm(`Delete “${item.name}”?`)) onChange?.({ ...model, constraints: model.constraints.filter(other => other.id !== item.id) }); }}>Delete</button></li>)}</ul>
    </section>
    <IndexesTable indexes={model.indexes} constraints={model.constraints} definitions={definitions} readOnly={false} onAdd={() => setIndex(makeIndexDraft({ id: nextSchemaId('index', [...model.indexes, ...Object.values(context?.drafts ?? {}).map(draft => draft.value)]), name: '', draft: false, kind: initialTarget ? 'RANGE' : 'LOOKUP', targets: initialTarget ? [initialTarget] : [], properties: [], filterProperties: [], config: initialTarget ? {} : { entity: 'node' } }, false))} onEdit={value => setIndex(makeIndexDraft(value, true))} onDelete={index => {
      if (window.confirm(`Delete “${index.name}”?`)) onChange?.({ ...model, indexes: model.indexes.filter(other => other.id !== index.id) });
    }} />
    {index && <Dialog title="Index" dirty onClose={() => setIndex(null)}><IndexEditor model={model} draft={index} onDraft={setIndex} onCancel={() => { if (window.confirm('Discard your unsaved changes?')) setIndex(null); }} onApply={() => {
      const result = validateIndex(index, model);
      if (!result.value) { setIndex({ ...index, error: result.error }); return; }
      const value = result.value;
      const update = (current: ModelInput) => ({ ...current, indexes: index.existing ? current.indexes.map(item => item.id === value.id ? value : item) : [...current.indexes, value] });
      if (context) context.setModel(update); else onChange?.(update(model));
      setIndex(null);
    }} /></Dialog>}
    {constraint && <Dialog title="Constraint" dirty onClose={() => setConstraint(null)}><form className="modeling-form schema-form" onSubmit={event => { event.preventDefault(); applyConstraint(); }}>
      <label htmlFor={`${id}-name`}>Name</label><input id={`${id}-name`} data-dialog-initial-focus value={constraint.name} onChange={event => patch({ name: event.target.value })} />
      <label htmlFor={`${id}-kind`}>Kind</label><select id={`${id}-kind`} value={constraint.kind} onChange={event => patch({ kind: event.target.value as ModelConstraint['kind'] })}>{['KEY', 'UNIQUE', 'EXISTS', 'TYPE'].map(kind => <option key={kind}>{kind}</option>)}</select>
      <label className="schema-checkbox"><input type="checkbox" checked={constraint.draft} onChange={event => patch({ draft: event.target.checked })} />Draft</label>
      <fieldset><legend>Target</legend>{definitions.map(definition => <label className="schema-target" key={`${definition.target.kind}-${definition.target.definitionId}`}><input type="radio" name={`${id}-target`} checked={sameTarget(constraint.target, definition.target)} onChange={() => patch({ target: definition.target, properties: [] })} />{definition.name} · {definition.target.kind}</label>)}</fieldset>
      <fieldset><legend>Properties · ordered</legend><div className="schema-checks">{choices.map(name => <label key={name}><input type="checkbox" checked={constraint.properties.includes(name)} onChange={event => patch({ properties: event.target.checked ? [...constraint.properties, name] : constraint.properties.filter(item => item !== name) })} />{name}</label>)}</div><ol className="schema-order">{constraint.properties.map((name, i) => <li key={name}><span>{name}{choices.includes(name) ? '' : ' · Unavailable'}</span><button type="button" aria-label={`Move ${name} up`} disabled={!i} onClick={() => { const next = [...constraint.properties]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; patch({ properties: next }); }}>↑</button><button type="button" aria-label={`Move ${name} down`} disabled={i === constraint.properties.length - 1} onClick={() => { const next = [...constraint.properties]; [next[i + 1], next[i]] = [next[i], next[i + 1]]; patch({ properties: next }); }}>↓</button><button type="button" aria-label={`Remove property ${name}`} onClick={() => patch({ properties: constraint.properties.filter(other => other !== name) })}>Remove</button></li>)}</ol></fieldset>
      {error && <p className="modeling-error" role="alert">{error}</p>}<div className="dialog-actions"><button type="button" onClick={() => { if (window.confirm('Discard your unsaved changes?')) setConstraint(null); }}>Cancel</button><button className="button primary">Apply</button></div>
    </form></Dialog>}
  </section>;
}
