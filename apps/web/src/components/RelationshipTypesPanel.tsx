import { useContext, useState } from 'react';
import { IndexDraftContext } from './PropertyIndexes';
import { pruneIndexDrafts } from './indexEditing';
import type { ModelInput, ModelRelationshipType, ReferenceCatalogModel } from '../types';
import { Dialog } from './Dialog';
import { identifierError, nextSchemaId } from './schemaObjects';
import { RelationshipTypeDetails } from './RelationshipTypeDetails';
import { hasPropertyDrafts, type PropertyRows } from './NodeProperties';
import type { NodeNameDraft } from './NodeNameChip';
import { referenceAlias } from './modelEditing';

export type TypeDraftControls = { propertiesDrafts: PropertyRows; nameDrafts: Record<string, NodeNameDraft>; onPropertyRows: (id: string, rows: PropertyRows[string]) => void; onNameDraft: (id: string, draft: NodeNameDraft) => void };
export function RelationshipTypesPanel({ model, modelId, models, onChange, propertiesDrafts, nameDrafts, onPropertyRows, onNameDraft }: { model: ModelInput; modelId: string; models: ReferenceCatalogModel[]; onChange: (model: ModelInput) => void } & TypeDraftControls) {
  const indexContext = useContext(IndexDraftContext);
  const [editing, setEditing] = useState<ModelRelationshipType | null>(null);
  const [target, setTarget] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const detailsType = model.relationshipTypes.find(type => type.id === detailsId);
  return <section className="schema-panel"><div className="schema-section-heading"><h3>Relationship types</h3><button type="button" onClick={() => { setEditing(null); setName(''); setTarget(''); setError(''); setOpen(true); }}>Add type</button></div>
    <ul className="schema-object-list">{model.relationshipTypes.map(type => <li key={type.id}><div><strong>{type.name}</strong><span>{type.kind === 'reference' ? 'Reference · Read only' : 'Definition'}</span></div><button type="button" onClick={() => setDetailsId(type.id)}>Edit</button>{type.kind === 'reference' && <button type="button" onClick={() => { setEditing(type); setName(type.name); setTarget(`${type.target.modelId}/${type.target.relationshipTypeId}`); setError(''); setOpen(true); }}>Retarget</button>}<button type="button" onClick={() => {
      const target = { kind: 'relationship' as const, definitionId: type.id };
      const drafts = indexContext?.drafts ?? {};
      const discardsIndexes = Object.keys(pruneIndexDrafts(drafts, target)).length < Object.keys(drafts).length;
      if (!window.confirm(`Delete type “${type.name}” and its relationships?${discardsIndexes ? ' Discard its unfinished index forms?' : ''}`)) return;
      indexContext?.setDrafts(current => pruneIndexDrafts(current, target));
      onChange({ ...model, relationshipTypes: model.relationshipTypes.filter(item => item.id !== type.id), relationships: model.relationships.filter(edge => edge.relationshipTypeId !== type.id), constraints: model.constraints.filter(item => item.target.kind !== 'relationship' || item.target.definitionId !== type.id), indexes: model.indexes.filter(item => !item.targets.some(target => target.kind === 'relationship' && target.definitionId === type.id)) });
    }}>Delete</button></li>)}</ul>
    {open && <Dialog title={editing ? 'Edit type identity' : 'Add type'} dirty onClose={() => setOpen(false)}><form className="modeling-form" onSubmit={event => {
      event.preventDefault();
      const invalid = identifierError(name);
      if (invalid || (!target && model.relationshipTypes.some(type => type.id !== editing?.id && type.kind === 'definition' && type.name === name))) { setError(invalid || 'A type with this exact name already exists.'); return; }
      const id = editing?.id ?? nextSchemaId('relationship-type', model.relationshipTypes);
      const [targetModel, relationshipTypeId] = target.split('/');
      const type: ModelRelationshipType = target ? { kind: 'reference', id, name: referenceAlias(name, model.relationshipTypes.filter(type => type.id !== editing?.id).map(type => type.name)), classification: targetModel === modelId ? 'Internal Reference' : 'External Reference', target: { modelId: targetModel, relationshipTypeId } } : { ...(editing?.kind === 'definition' ? editing : { draft: false, properties: [], sourceLabel: null, targetLabel: null }), kind: 'definition', id, name };
      onChange({ ...model, relationshipTypes: editing ? model.relationshipTypes.map(item => item.id === id ? type : item) : [...model.relationshipTypes, type] }); setOpen(false); setDetailsId(id);
    }}><label htmlFor="catalog-type-name">{target ? 'Alias' : 'Canonical type name'}</label><input id="catalog-type-name" data-dialog-initial-focus value={name} onChange={event => setName(event.target.value)} />
      {editing?.kind !== 'definition' && <><label htmlFor="catalog-type-target">Definition</label><select id="catalog-type-target" value={target} onChange={event => setTarget(event.target.value)}><option value="">New definition</option><optgroup label="Current model">{model.relationshipTypes.filter(type => type.kind === 'definition').map(type => <option key={type.id} value={`${modelId}/${type.id}`}>{type.name}</option>)}</optgroup>{models.filter(source => source.id !== modelId).map(source => source.available && <optgroup key={source.id} label={source.name}>{source.relationshipTypes.map(type => <option key={type.id} value={`${source.id}/${type.id}`}>{type.name}</option>)}</optgroup>)}</select></>}
      {error && <p className="modeling-error" role="alert">{error}</p>}<div className="dialog-actions"><button type="button" className="button secondary" onClick={() => { if (window.confirm('Discard your unsaved changes?')) setOpen(false); }}>Cancel</button><button className="button primary">Apply</button></div>
    </form></Dialog>}
    {detailsType && <Dialog title="Edit relationship type" onClose={() => setDetailsId(null)}>
      <RelationshipTypeDetails key={detailsType.id} type={detailsType} model={model} modelId={modelId} catalog={models} onChange={onChange} rows={propertiesDrafts[detailsType.id]} onRows={rows => onPropertyRows(detailsType.id, rows)} draft={nameDrafts[detailsType.id]} onDraft={draft => onNameDraft(detailsType.id, draft)} onAnnounce={() => {}} />
      <div className="dialog-actions"><button type="button" className="button secondary" onClick={() => setDetailsId(null)}>Done</button></div>
      {(hasPropertyDrafts(propertiesDrafts[detailsType.id] ?? []) || (nameDrafts[detailsType.id] && nameDrafts[detailsType.id].value !== detailsType.name)) && <span className="sr-only" role="status">Unfinished drafts retained</span>}
    </Dialog>}
  </section>;
}
