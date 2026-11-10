import { useLayoutEffect, useRef } from 'react';
import { ChevronDown, Plus } from 'lucide-react';
import type { ModelProperty, PropertyIndex } from '../types';
import { Icon } from './Icon';
import { listPropertyDataTypes, propertyDataTypes, scalarPropertyDataTypes } from './propertyDataTypes';
import './NodeProperties.css';

type Field = keyof ModelProperty;
export type PropertyRow = { id: string; value: ModelProperty; committed: ModelProperty | null; editing: boolean; errors: Partial<Record<Field, string>> };
export type PropertyRows = Record<string, PropertyRow[]>;
const fields: { key: Exclude<Field, 'description'>; label: string }[] = [
  { key: 'name', label: 'Name' }, { key: 'dataType', label: 'Data type' },
  { key: 'nodeKey', label: 'Node key' }, { key: 'uniqueness', label: 'Uniqueness' }, { key: 'mustExist', label: 'Must exist' }, { key: 'index', label: 'Index' },
];
const indexes: PropertyIndex[] = ['None', 'Range', 'Text', 'Point'];
const blank = (): ModelProperty => ({ name: '', dataType: '', description: '', nodeKey: false, uniqueness: false, mustExist: false, index: 'None' });
export const propertyRows = (properties: ModelProperty[]): PropertyRow[] => properties.map(value => ({ id: crypto.randomUUID(), value, committed: value, editing: false, errors: {} }));
export const hasPropertyDrafts = (rows: PropertyRow[]) => rows.some(row => row.editing && (!row.committed || JSON.stringify(row.value) !== JSON.stringify(row.committed)));

export function NodeProperties({ rows, disabled, onRows, onCommit, onAnnounce }: {
  rows: PropertyRow[]; disabled: boolean; onRows: (rows: PropertyRow[]) => void;
  onCommit: (properties: ModelProperty[]) => void; onAnnounce: (message: string) => void;
}) {
  const root = useRef<HTMLElement>(null);
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

  function update(row: PropertyRow, changes: Partial<PropertyRow>) {
    onRows(rows.map(item => item.id === row.id ? { ...item, ...changes } : item));
  }
  function updateMetadata(row: PropertyRow, changes: Partial<Pick<ModelProperty, 'dataType' | 'nodeKey' | 'uniqueness' | 'mustExist' | 'index'>>) {
    const value = { ...row.value, ...changes };
    if (row.editing || !row.committed) { update(row, { value, errors: { ...row.errors, ...('dataType' in changes ? { dataType: undefined } : {}) } }); return; }
    const committed = { ...row.committed, ...changes };
    const next = rows.map(item => item.id === row.id ? { ...item, value, committed } : item);
    onRows(next); onCommit(next.flatMap(item => item.committed ? [item.committed] : []));
    onAnnounce(`Property ${value.name} updated. Save model to write it to the file.`);
  }
  function cancel(row: PropertyRow) {
    focus.current = row.committed ? `${row.id}-edit` : 'add';
    onRows(row.committed ? rows.map(item => item.id === row.id ? { ...item, value: item.committed!, editing: false, errors: {} } : item) : rows.filter(item => item.id !== row.id));
    onAnnounce('Property edit canceled.');
  }
  function save(row: PropertyRow) {
    const value = { ...row.value, name: row.value.name.trim() };
    const errors: PropertyRow['errors'] = {};
    for (const field of ['name', 'dataType'] as const) {
      if (!value[field].trim() || [...value[field]].length > 100 || /\p{Cc}/u.test(row.value[field])) errors[field] = `Enter ${field === 'name' ? 'a name' : 'a data type'} of 1–100 characters without control characters.`;
    }
    if (rows.some(other => other.id !== row.id && other.committed?.name === value.name)) errors.name = 'A property with this exact name already exists on this node.';
    if ([...value.description].length > 2000 || value.description.includes('\0')) errors.description = 'Use at most 2,000 characters, without NUL. Line breaks are allowed.';
    if (Object.keys(errors).length) {
      focus.current = `${row.id}-${Object.keys(errors)[0]}`;
      update(row, { errors }); return;
    }
    const next = rows.map(item => item.id === row.id ? { ...item, value, committed: value, editing: false, errors: {} } : item);
    focus.current = `${row.id}-edit`;
    onRows(next); onCommit(next.flatMap(item => item.committed ? [item.committed] : []));
    onAnnounce(`Property ${value.name} ${row.committed ? 'updated' : 'added'}. Save model to write it to the file.`);
  }
  function remove(row: PropertyRow) {
    if (!window.confirm(`Remove property “${row.committed!.name}”? Save model to persist this removal.`)) return;
    const next = rows.filter(item => item.id !== row.id);
    focus.current = 'add'; onRows(next); onCommit(next.flatMap(item => item.committed ? [item.committed] : []));
    onAnnounce(`Property ${row.committed!.name} removed.`);
  }
  return <section ref={root} className="node-properties" aria-labelledby="node-properties-title">
    <div className="node-properties-heading"><h3 id="node-properties-title">Properties</h3></div>
    <div className="node-properties-scroll" tabIndex={0} role="region" aria-label="Property table" onFocusCapture={event => {
      if (event.target !== event.currentTarget) (event.target as HTMLElement).scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }}>
      <table><caption className="sr-only">Node properties</caption><thead><tr>{fields.map(field => <th key={field.key} scope="col">{field.label}</th>)}<th scope="col">Actions</th></tr></thead>
        <tbody>
          {rows.map((row, index) => <tr key={row.id} data-property-editor={row.editing ? '' : undefined} onKeyDown={event => {
            if (!row.editing || event.nativeEvent.isComposing) return;
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(row); }
            if (event.key === 'Enter' && event.target instanceof HTMLInputElement && event.target.type !== 'checkbox') { event.preventDefault(); event.stopPropagation(); save(row); }
          }}>{fields.map(({ key, label }) => {
            const id = `property-${row.id}-${key}`;
            const controlLabel = `${key === 'mustExist' || key === 'uniqueness' ? `${label} constraint` : label}, property ${index + 1}${row.committed ? `, ${row.committed.name}` : ''}`;
            return <td key={key}>{key === 'dataType' ? <>
              <label className="sr-only" htmlFor={id}>{controlLabel}</label>
              <span className="node-property-sized-control node-property-sized-select">
              <span className="node-property-control-measure" aria-hidden="true">{!row.value.dataType ? 'Select data type' : propertyDataTypes.includes(row.value.dataType) ? row.value.dataType : `Existing: ${row.value.dataType}`}</span>
              <select id={id} data-property-focus={`${row.id}-${key}`} disabled={disabled} required value={row.value.dataType} aria-invalid={Boolean(row.errors.dataType)} aria-describedby={row.errors.dataType ? `${id}-error` : undefined} onChange={event => updateMetadata(row, { dataType: event.target.value })}>
                <option value="" disabled>Select data type</option>
                {row.value.dataType && !propertyDataTypes.includes(row.value.dataType) && <option value={row.value.dataType}>Existing: {row.value.dataType}</option>}
                <optgroup label="Scalar types">{scalarPropertyDataTypes.map(option => <option key={option} value={option}>{option}</option>)}</optgroup>
                <optgroup label="List types">{listPropertyDataTypes.map(option => <option key={option} value={option}>{option}</option>)}</optgroup>
              </select>
              <Icon icon={ChevronDown} />
              </span>
              {row.errors.dataType && <p id={`${id}-error`} className="modeling-error" role="alert">{row.errors.dataType}</p>}
            </> : key === 'index' ? <>
              <label className="sr-only" htmlFor={id}>{controlLabel}</label>
              <span className="node-property-sized-control node-property-sized-select">
              <span className="node-property-control-measure" aria-hidden="true">{row.value.index}</span>
              <select id={id} data-property-focus={`${row.id}-${key}`} disabled={disabled} value={row.value.index} onChange={event => {
                const selected = indexes.find(option => option === event.target.value);
                if (selected) updateMetadata(row, { index: selected });
              }}>{indexes.map(option => <option key={option} value={option}>{option}</option>)}</select>
              <Icon icon={ChevronDown} />
              </span>
            </> : key === 'nodeKey' || key === 'uniqueness' || key === 'mustExist' ? <label className="node-property-check" htmlFor={id}>
              <span className="sr-only">{controlLabel}</span>
              <input id={id} data-property-focus={`${row.id}-${key}`} type="checkbox" disabled={disabled} checked={row.value[key]} onChange={event => {
                const checked = event.target.checked;
                updateMetadata(row, key === 'nodeKey' && checked && !row.value.nodeKey
                  ? { nodeKey: true, uniqueness: true, mustExist: true, index: row.value.index === 'None' ? 'Text' : row.value.index }
                  : { [key]: checked });
              }} />
            </label> : row.editing ? <>
              <label className="sr-only" htmlFor={id}>{label}, property {index + 1}</label>
              <span className="node-property-sized-control">
                <span className="node-property-control-measure" aria-hidden="true">{row.value[key] || '\u00a0'}</span>
                <input id={id} data-property-focus={`${row.id}-${key}`} type="text" autoComplete="off" disabled={disabled} value={row.value[key]} aria-invalid={Boolean(row.errors[key])} aria-describedby={row.errors[key] ? `${id}-error` : undefined} onChange={event => update(row, { value: { ...row.value, [key]: event.target.value }, errors: { ...row.errors, [key]: undefined } })} />
              </span>
              {row.errors[key] && <p id={`${id}-error`} className="modeling-error" role="alert">{row.errors[key]}</p>}
            </> : <span className="node-property-text">{row.value[key] || '—'}</span>}{key === 'name' && <details className="node-property-description" onClick={event => event.stopPropagation()}>
              <summary>Description</summary>
              <div className="node-property-description-body">
              {row.editing ? <>
                <label className="sr-only" htmlFor={`${id}-description`}>Description, property {index + 1}</label>
                <textarea id={`${id}-description`} data-property-focus={`${row.id}-description`} rows={3} disabled={disabled} value={row.value.description} aria-invalid={Boolean(row.errors.description)} aria-describedby={row.errors.description ? `${id}-description-error` : undefined} onChange={event => update(row, { value: { ...row.value, description: event.target.value }, errors: { ...row.errors, description: undefined } })} />
                {row.errors.description && <p id={`${id}-description-error`} className="modeling-error" role="alert">{row.errors.description}</p>}
              </> : <div className="node-property-text">{row.value.description}</div>}
              </div>
            </details>}</td>;
          })}<td className="node-property-actions">{row.editing ? <><button type="button" disabled={disabled} onClick={() => save(row)}>Save property</button><button type="button" disabled={disabled} onClick={() => cancel(row)}>Cancel</button></> : <><button type="button" data-property-focus={`${row.id}-edit`} disabled={disabled} aria-label={`Edit property ${row.value.name}`} onClick={() => { focus.current = `${row.id}-name`; update(row, { editing: true }); }}>Edit</button><button type="button" disabled={disabled} aria-label={`Remove property ${row.value.name}`} onClick={() => remove(row)}>Remove</button></>}</td></tr>)}
          <tr className="node-properties-add-row"><td colSpan={6} /><td className="node-property-actions node-property-add-action">
            <button type="button" data-property-focus="add" disabled={disabled || rows.length >= 100} onClick={() => {
              if (disabled || rows.length >= 100) return;
              const id = crypto.randomUUID(); focus.current = `${id}-name`;
              onRows([...rows, { id, value: blank(), committed: null, editing: true, errors: {} }]);
            }}><Icon icon={Plus} />Add property</button>
          </td></tr>
        </tbody></table>
    </div>
  </section>;
}
