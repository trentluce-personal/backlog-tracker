import { useMemo, useRef } from 'react';
import type { ModelInput, ModelRelationshipType, ReferenceCatalogModel } from '../types';
import { NodeNameChip, type NodeNameDraft } from './NodeNameChip';
import { NodeProperties, propertyRows, type PropertyRow } from './NodeProperties';
import { PropertyIndexes } from './PropertyIndexes';
import { identifierError, propertySchema } from './schemaObjects';
import { renamePropertySchema, resolveTypeOwner } from './modelEditing';

export function RelationshipTypeName({ type, model, onChange, draft, onDraft, disabled = false, heading = false }: {
  type: Extract<ModelRelationshipType, { kind: 'definition' }>; model: ModelInput; onChange: (model: ModelInput) => void;
  draft?: NodeNameDraft; onDraft: (draft: NodeNameDraft) => void; disabled?: boolean; heading?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  return <NodeNameChip label="Relationship name" heading={heading} node={{ ...type, classification: 'Transactional' }} draft={draft} inputRef={input} disabled={disabled} onDraft={onDraft} onCommit={name => {
    if (disabled) return 'Relationship names cannot be edited right now.';
    const error = identifierError(name) || (model.relationshipTypes.some(other => other.id !== type.id && other.kind === 'definition' && other.name === name) ? 'A type with this exact name already exists.' : '');
    if (!error) {
      if (name !== type.name) onChange({ ...model, relationshipTypes: model.relationshipTypes.map(item => item.id === type.id && item.kind === 'definition' ? { ...item, name } : item) });
      onDraft({ value: name, error: '' });
    }
    return error;
  }} />;
}

export function RelationshipTypeDetails({ type, model, modelId, catalog, onChange, rows, onRows, onAnnounce, draft, onDraft, nameInHeader = false }: {
  type: ModelRelationshipType; model: ModelInput; modelId: string | null; catalog: ReferenceCatalogModel[]; onChange: (model: ModelInput) => void;
  rows?: PropertyRow[]; onRows: (rows: PropertyRow[]) => void; onAnnounce: (message: string) => void;
  draft?: NodeNameDraft; onDraft: (draft: NodeNameDraft) => void;
  nameInHeader?: boolean;
}) {
  const { owner, definition, target } = resolveTypeOwner(type, model, modelId, catalog);
  const initialRows = useMemo(() => propertyRows(type.kind === 'definition' ? type.properties : []), [type]);
  const update = (changes: object) => onChange({ ...model, relationshipTypes: model.relationshipTypes.map(item => item.id === type.id ? { ...item, ...changes } : item) });
  return <section className="schema-panel" aria-label="Relationship type">
    {type.kind === 'definition' ? <>
      {!nameInHeader && <RelationshipTypeName type={type} model={model} onChange={onChange} draft={draft} onDraft={onDraft} />}
      <label className="schema-checkbox modeling-draft-control"><input type="checkbox" checked={type.draft} onChange={event => update({ draft: event.target.checked })} />Draft</label>
      <label htmlFor="type-display-name">Display name</label><input id="type-display-name" value={type.displayName ?? ''} maxLength={200} onChange={event => { if ([...event.target.value].length <= 100 && !/\p{Cc}/u.test(event.target.value)) update({ displayName: event.target.value || undefined }); }} />
      {(['sourceLabel', 'targetLabel'] as const).map(field => <label key={field}>{field === 'sourceLabel' ? 'Source label rule' : 'Target label rule'}<input value={type[field] ?? ''} onChange={event => update({ [field]: event.target.value || null })} /></label>)}
      <NodeProperties model={model} rows={rows ?? initialRows} disabled={false} target={target} constraints={model.constraints} indexes={model.indexes} onRows={onRows} onCommit={(properties, rename) => {
        const next = rename ? renamePropertySchema(model, target, rename.oldName, rename.newName) : model;
        onChange({ ...next, relationshipTypes: next.relationshipTypes.map(item => item.id === type.id && item.kind === 'definition' ? { ...item, properties } : item) });
      }} onAnnounce={onAnnounce} onConstraints={constraints => onChange({ ...model, constraints })} onSchema={(constraints, indexes) => onChange({ ...model, constraints, indexes })} />
    </> : <>
      <strong>{definition?.name ?? type.name}</strong><p role="status">{definition ? 'Read only' : 'Unresolved reference'}</p><code>{type.target.modelId} · {type.target.relationshipTypeId}</code>
      {definition && <><dl className="modeling-detail-endpoints"><dt>Display name</dt><dd>{definition.displayName || '—'}</dd><dt>Draft</dt><dd>{definition.draft ? 'Yes' : 'No'}</dd><dt>Source label rule</dt><dd>{definition.sourceLabel || '—'}</dd><dt>Target label rule</dt><dd>{definition.targetLabel || '—'}</dd></dl>
        <section className="node-properties" aria-label="Target properties"><div className="node-properties-heading"><h3>Properties · Read only</h3></div>
          <div className="node-properties-scroll" tabIndex={0} role="region" aria-label="Target property table"><table><caption className="sr-only">Read-only target properties</caption>
            <thead><tr>{['Name', 'Data type', 'Key', 'Unique', 'Required', 'Indexes'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
            <tbody>{definition.properties.map(property => { const state = propertySchema(property.name, target, owner.constraints, []); return <tr key={property.name}>
              <td><span className="node-property-text">{property.name}</span><details className="node-property-description"><summary>Description</summary><div className="node-property-text">{property.description}</div></details></td><td>{property.dataType}</td>
              {(['key', 'unique', 'required'] as const).map(flag => <td key={flag}>{state[flag] ? 'Yes' : '—'}</td>)}
              <td><PropertyIndexes readOnly name={property.name} target={target} model={owner} /></td>
            </tr>; })}</tbody>
          </table></div>
        </section></>}
    </>}
  </section>;
}
