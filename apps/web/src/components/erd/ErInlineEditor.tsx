import { useId, useLayoutEffect, useRef, useState } from 'react';
import { erDataTypes, type ErModel } from '../../erd-types';
import { applyDraft, type TableDraft } from './model';

type ColumnDraft = Extract<TableDraft, { kind: 'column' }>;
export function ErInlineEditor({ model, tableId, initial, busy, onChange, onCommit, onClose }: { model: ErModel; tableId: string; initial: ColumnDraft; busy: boolean; onChange: (draft: ColumnDraft) => void; onCommit: (model: ErModel) => string[]; onClose: () => void }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<string[]>([]);
  useLayoutEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  // Closing drops the whole multi-field draft, so confirm only when it diverges
  // from the stored column; an untouched editor still dismisses directly.
  const stored = model.tables.find(table => table.id === tableId)?.columns.find(column => column.id === initial.column.id);
  const changed = Boolean(stored) && JSON.stringify(stored) !== JSON.stringify(initial.column);
  function requestClose() {
    if (!busy && changed && !window.confirm('Discard your unsaved column changes?')) return;
    onClose();
  }
  return <form className="erd-inline-editor" aria-label="Edit column" onPointerDown={event => event.stopPropagation()} onKeyDown={event => {
    event.stopPropagation();
    if (event.key === 'Escape' && !busy) { event.preventDefault(); requestClose(); }
  }} onSubmit={event => {
    event.preventDefault();
    const result = applyDraft(model, tableId, initial);
    const errors = result.errors.length ? result.errors : onCommit(result.model);
    setErrors(errors);
    if (!errors.length) onClose();
  }}>
    <label htmlFor={`${id}-name`}>Column name</label>
    <input ref={input} id={`${id}-name`} disabled={busy} value={initial.column.name} aria-invalid={Boolean(errors.length)} aria-describedby={errors.length ? `${id}-errors` : undefined} onChange={event => onChange({ ...initial, column: { ...initial.column, name: event.target.value } })} />
      <label htmlFor={`${id}-type`}>PostgreSQL type</label><select id={`${id}-type`} disabled={busy} value={initial.column.dataType} onChange={event => onChange({ ...initial, column: { ...initial.column, dataType: event.target.value as typeof initial.column.dataType } })}>{erDataTypes.map(type => <option key={type}>{type}</option>)}</select>
      <div className="erd-flags">{(['primaryKey', 'unique', 'nullable'] as const).map(flag => <label key={flag}><input type="checkbox" disabled={busy || (flag === 'nullable' && initial.column.primaryKey)} checked={initial.column[flag]} onChange={event => onChange({ ...initial, column: { ...initial.column, [flag]: event.target.checked, ...(flag === 'primaryKey' && event.target.checked ? { nullable: false } : {}) } })} />{flag === 'primaryKey' ? 'Primary key' : flag === 'unique' ? 'Unique' : 'Nullable'}</label>)}</div>
    {errors.length > 0 && <div id={`${id}-errors`} className="form-error" role="alert">{errors.map(error => <p key={error}>{error}</p>)}</div>}
    <div className="erd-form-actions"><button type="button" disabled={busy} onClick={requestClose}>Cancel</button><button type="submit" disabled={busy}>Apply</button></div>
  </form>;
}
