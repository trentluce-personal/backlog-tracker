import { useContext, useLayoutEffect, useRef } from 'react';
import { Plus } from 'lucide-react';
import type { DefinitionTarget, ModelConstraint, ModelIndex, ModelProperty } from '../types';
import { Icon } from './Icon';
import { PropertyTypeEditor } from './PropertyTypeEditor';
import type { ModelInput } from '../types';
import { IndexDraftContext, PropertyIndexes } from './PropertyIndexes';
import { indexDraftKey, pruneIndexDrafts } from './indexEditing';
import { identifierError, malformedUnicode, nextSchemaId, propertySchema, sameTarget } from './schemaObjects';
import { keyConversion, makePropertyRows, type PropertyRow } from './modelEditing';
import './NodeProperties.css';

type Field = keyof ModelProperty;
export type { PropertyRow } from './modelEditing';
export type PropertyRows = Record<string, PropertyRow[]>;
const blank = (): ModelProperty => ({ name: '', dataType: '', description: '' });
export const propertyRows = makePropertyRows;
export const hasPropertyDrafts = (rows: PropertyRow[]) => rows.some(row => row.editing && (!row.committed || JSON.stringify(row.value) !== JSON.stringify(row.committed)));

export function NodeProperties({ rows, disabled, onRows, onCommit, onAnnounce, target, constraints = [], indexes = [], onConstraints, onSchema, model }: {
  rows: PropertyRow[]; disabled: boolean; onRows: (rows: PropertyRow[]) => void;
  onCommit: (properties: ModelProperty[], rename?: { oldName: string; newName: string }) => void; onAnnounce: (message: string) => void;
  target?: DefinitionTarget; constraints?: ModelConstraint[]; indexes?: ModelIndex[];
  onConstraints?: (constraints: ModelConstraint[]) => void; model?: ModelInput;
  onSchema?: (constraints: ModelConstraint[], indexes: ModelIndex[]) => void;
}) {
  const root = useRef<HTMLElement>(null);
  const indexContext = useContext(IndexDraftContext);
  const focus = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!focus.current) return;
    const control = root.current?.querySelector<HTMLElement>(`[data-property-focus="${focus.current}"]`);
    focus.current = null;
    const disclosure = control?.closest('details');
    if (disclosure) disclosure.open = true;
    control?.focus({ preventScroll: true });
    control?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [rows]);
  function update(row: PropertyRow, changes: Partial<PropertyRow>) { onRows(rows.map(item => item.id === row.id ? { ...item, ...changes } : item)); }
  function add() {
    const id = crypto.randomUUID();
    focus.current = `${id}-name`;
    onRows([...rows, { id, value: blank(), committed: null, editing: true, errors: {} }]);
  }
  function cancel(row: PropertyRow) {
    focus.current = row.committed ? `${row.id}-edit` : 'add';
    onRows(row.committed ? rows.map(item => item.id === row.id ? { ...item, value: item.committed!, editing: false, errors: {} } : item) : rows.filter(item => item.id !== row.id));
  }
  function save(row: PropertyRow) {
    const value = row.value;
    const errors: PropertyRow['errors'] = {};
    const nameError = identifierError(value.name);
    if (nameError) errors.name = nameError;
    if (!value.dataType.trim() || /\p{Cc}/u.test(value.dataType) || malformedUnicode(value.dataType)) errors.dataType = 'Enter a type expression.';
    if (rows.some(other => other.id !== row.id && other.committed?.name === value.name)) errors.name = 'A property with this exact name already exists.';
    if ([...value.description].length > 2000 || value.description.includes('\0')) errors.description = 'Use at most 2,000 characters, without NUL.';
    if (Object.keys(errors).length) { focus.current = `${row.id}-${Object.keys(errors)[0]}`; update(row, { errors }); return; }
    const next = rows.map(item => item.id === row.id ? { ...item, value, committed: value, editing: false, errors: {} } : item);
    focus.current = `${row.id}-edit`;
    onRows(next); onCommit(next.flatMap(item => item.committed ? [item.committed] : []), row.committed && row.committed.name !== value.name ? { oldName: row.committed.name, newName: value.name } : undefined);
    onAnnounce(`Property ${value.name} saved in model draft.`);
  }
  function toggle(name: string, kind: ModelConstraint['kind'], checked: boolean) {
    if (!target || !onConstraints) return;
    if (kind === 'KEY' && checked && onSchema) {
      const conversion = keyConversion(target, name, constraints, indexes);
      if (conversion.replacedIndexes.length && !window.confirm(`Replace ${conversion.replacedIndexes.map(item => `“${item.name}”`).join(', ')} with a key constraint and its backing RANGE index?`)) return;
      onSchema(conversion.constraints, conversion.indexes); return;
    }
    const matches = (item: ModelConstraint) => sameTarget(item.target, target) && item.kind === kind && item.properties.length === 1 && item.properties[0] === name;
    onConstraints(checked ? [...constraints, { id: nextSchemaId('constraint', constraints), name: `${target.definitionId}_${name}_${kind}`, kind, draft: false, target, properties: [name] }] : constraints.filter(item => !matches(item)));
  }
  return <section ref={root} className="node-properties" aria-label="Properties">
    <div className="node-properties-heading"><h3>Properties</h3></div>
    <div className="node-properties-scroll" tabIndex={0} role="region" aria-label="Property table">
      <table><caption className="sr-only">Properties</caption><thead><tr>{['Name', 'Data type', 'Key', 'Unique', 'Required', 'Indexes', 'Actions'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{rows.map((row, index) => {
          const schema = target ? propertySchema(row.committed?.name ?? '', target, constraints, indexes) : null;
          return <tr key={row.id} data-property-editor={row.editing ? '' : undefined} onKeyDown={event => {
            if (!row.editing || event.nativeEvent.isComposing) return;
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(row); }
            if (event.key === 'Enter' && event.target instanceof HTMLInputElement && event.target.type !== 'checkbox') { event.preventDefault(); event.stopPropagation(); save(row); }
          }}><td>{row.editing ? <span className="node-property-sized-control"><span className="node-property-control-measure" aria-hidden="true">{row.value.name || '\u00a0'}</span><input type="text" aria-label={`Name, property ${index + 1}`} data-property-focus={`${row.id}-name`} disabled={disabled} value={row.value.name} aria-invalid={Boolean(row.errors.name)} aria-describedby={row.errors.name ? `property-${row.id}-name-error` : undefined} onChange={event => update(row, { value: { ...row.value, name: event.target.value }, errors: {} })} /></span> : <span className="node-property-text">{row.value.name}</span>}
            {row.errors.name && <p className="modeling-error" id={`property-${row.id}-name-error`} role="alert">{row.errors.name}</p>}
            <details className="node-property-description"><summary>Description</summary><div className="node-property-description-body">{row.editing ? <textarea aria-label={`Description, property ${index + 1}`} data-property-focus={`${row.id}-description`} value={row.value.description} disabled={disabled} aria-invalid={Boolean(row.errors.description)} aria-describedby={row.errors.description ? `property-${row.id}-description-error` : undefined} onChange={event => update(row, { value: { ...row.value, description: event.target.value } })} /> : <div className="node-property-text">{row.value.description}</div>}{row.errors.description && <p className="modeling-error" id={`property-${row.id}-description-error`} role="alert">{row.errors.description}</p>}</div></details>
          </td><td><PropertyTypeEditor id={`type-${row.id}`} value={row.value.dataType} disabled={disabled} focusAnchor={`${row.id}-dataType`} invalid={Boolean(row.errors.dataType)} describedBy={row.errors.dataType ? `property-${row.id}-type-error` : undefined} onChange={dataType => {
            if (row.editing) update(row, { value: { ...row.value, dataType } });
            else { const next = rows.map(item => item.id === row.id ? { ...item, value: { ...item.value, dataType }, committed: { ...item.value, dataType } } : item); onRows(next); onCommit(next.flatMap(item => item.committed ? [item.committed] : [])); }
          }} />{row.errors.dataType && <p className="modeling-error" id={`property-${row.id}-type-error`} role="alert">{row.errors.dataType}</p>}</td>
          {(['KEY', 'UNIQUE', 'EXISTS'] as const).map(kind => <td key={kind}><input type="checkbox" aria-label={`${kind}, ${row.value.name || `property ${index + 1}`}`} checked={kind === 'KEY' ? schema?.key ?? false : kind === 'UNIQUE' ? schema?.unique ?? false : schema?.required ?? false} disabled={disabled || row.editing || !target || !onConstraints || (kind === 'UNIQUE' && Boolean(schema?.key)) || (kind === 'EXISTS' && Boolean(schema?.owned.some(item => item.kind === 'KEY')))} onChange={event => toggle(row.value.name, kind, event.target.checked)} /></td>)}
          <td>{target && model && <PropertyIndexes rowId={row.id} onOpen={() => onRows(rows)} name={row.committed?.name ?? ''} target={target} model={model} disabled={disabled || row.editing || !row.committed} />}</td>
          <td className="node-property-actions">{row.editing ? <><button type="button" disabled={disabled} onClick={() => save(row)}>Save property</button><button type="button" disabled={disabled} onClick={() => cancel(row)}>Cancel</button></> : <><button type="button" data-property-focus={`${row.id}-edit`} disabled={disabled} aria-label={`Edit property ${row.value.name}`} onClick={() => { focus.current = `${row.id}-name`; update(row, { editing: true }); }}>Edit</button><button type="button" disabled={disabled} aria-label={`Remove property ${row.value.name}`} onClick={() => {
            const hasIndexDraft = target && indexContext?.drafts[indexDraftKey(target, row.id)];
            if (!window.confirm(`Remove property “${row.value.name}”?${hasIndexDraft ? ' Discard its unfinished index form?' : ''}`)) return;
            if (target && indexContext) indexContext.setDrafts(current => pruneIndexDrafts(current, target, row.id));
            const next = rows.filter(item => item.id !== row.id); onRows(next); onCommit(next.flatMap(item => item.committed ? [item.committed] : []));
          }}>Remove</button></>}</td></tr>;
        })}{rows.length === 0
          ? <tr className="node-properties-empty-row"><td colSpan={7}><div className="node-properties-empty"><span>No properties yet.</span><button type="button" data-property-focus="add" disabled={disabled} onClick={add}><Icon icon={Plus} />Add property</button></div></td></tr>
          : <tr className="node-properties-add-row"><td colSpan={6} /><td className="node-property-actions node-property-add-action"><button type="button" data-property-focus="add" disabled={disabled || rows.length >= 100} onClick={add}><Icon icon={Plus} />Add property</button></td></tr>}</tbody>
      </table>
    </div>
  </section>;
}
