import { useEffect, useId, useState, type ReactNode, type RefObject } from 'react';
import { ErPanel } from './ErPanel';
import { type ErForeignKey, type ErModel } from '../../erd-types';
import { displayNameError, nextName } from './model';
import { applyRelationshipDraft, persistenceDraftMessage } from './editing';

type Commit = (model: ErModel) => string[];
function Actions({ children, busy = false }: { children?: ReactNode; busy?: boolean }) {
  return <div className="erd-form-actions"><button className="button primary" disabled={busy}>{children ?? 'Apply'}</button></div>;
}
function Errors({ errors, id }: { errors: string[]; id: string }) {
  return errors.length ? <div id={id} className="form-error" role="alert" tabIndex={-1}>{errors.map((error, index) => <p key={index}>{error}</p>)}</div> : null;
}
function showErrors(set: (errors: string[]) => void, errors: string[], id: string) {
  set(errors);
  if (errors.length) requestAnimationFrame(() => document.getElementById(id)?.focus());
}
export function RelationshipForm({ model, relationship, busy, onDirty, onCommit, onClose }: { model: ErModel; relationship?: ErForeignKey; busy: boolean; onDirty: (dirty: boolean) => void; onCommit: Commit; onClose: () => void }) {
  const [initial] = useState<ErForeignKey>(() => relationship ?? { id: crypto.randomUUID(), name: nextName('fk', model.foreignKeys.map(item => item.name)), sourceTableId: model.tables[0]?.id ?? '', sourceColumnId: model.tables[0]?.columns[0]?.id ?? '', targetTableId: model.tables[1]?.id ?? model.tables[0]?.id ?? '', targetColumnId: '' });
  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState<string[]>([]);
  const id = useId();
  const dirty = JSON.stringify(initial) !== JSON.stringify(draft);
  useEffect(() => { onDirty(dirty); return () => onDirty(false); }, [dirty, onDirty]);
  return <ErPanel title={relationship ? 'Edit relationship' : 'Add relationship'} dirty={dirty} busy={busy} onClose={onClose}>
    <form onSubmit={event => {
      event.preventDefault();
      const result = applyRelationshipDraft(model, draft, Boolean(relationship));
      const errors = result.errors.length ? result.errors : onCommit(result.model);
      showErrors(setErrors, errors, `${id}-errors`); if (!errors.length) onClose();
    }}>
      <fieldset disabled={busy} className="erd-fields">
        <div><label htmlFor={`${id}-name`}>Relationship name</label><input id={`${id}-name`} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} aria-invalid={Boolean(errors.length)} aria-describedby={errors.length ? `${id}-errors` : undefined} /></div>
        {(['source', 'target'] as const).map(end => {
          const table = model.tables.find(table => table.id === draft[`${end}TableId`]);
          return <fieldset key={end} className="erd-endpoint"><legend>{end === 'source' ? 'Foreign key' : 'Referenced key'}</legend>
            <div><label htmlFor={`${id}-${end}-table`}>Table</label><select id={`${id}-${end}-table`} value={draft[`${end}TableId`]} onChange={event => setDraft({ ...draft, [`${end}TableId`]: event.target.value, [`${end}ColumnId`]: '' })}><option value="">Select table</option>{model.tables.map(table => <option key={table.id} value={table.id}>{table.name}</option>)}</select></div>
            <div><label htmlFor={`${id}-${end}-column`}>Column</label><select id={`${id}-${end}-column`} value={draft[`${end}ColumnId`]} onChange={event => setDraft({ ...draft, [`${end}ColumnId`]: event.target.value })}><option value="">Select column</option>{table?.columns.map(column => <option key={column.id} value={column.id}>{column.name} · {column.dataType}{column.primaryKey ? ' · PK' : column.unique ? ' · UQ' : ''}</option>)}</select></div>
          </fieldset>;
        })}
      </fieldset>
      <Errors errors={errors} id={`${id}-errors`} /><Actions busy={busy} />
    </form>
  </ErPanel>;
}
export function NameForm({ name, busy, editsBlocked, error, onDirty, onSave, onClose }: { name: string; busy: boolean; editsBlocked: boolean; error: string; onDirty: (dirty: boolean) => void; onSave: (name: string) => Promise<boolean>; onClose: () => void }) {
  const [draft, setDraft] = useState(name);
  const [errors, setErrors] = useState<string[]>([]);
  const id = useId();
  useEffect(() => { onDirty(draft !== name); return () => onDirty(false); }, [draft, name, onDirty]);
  return <ErPanel title="Save ERD model" busy={busy} dirty={draft !== name} onClose={onClose}><form onSubmit={event => {
    event.preventDefault(); if (busy || editsBlocked) return; const error = displayNameError(draft.trim()); showErrors(setErrors, error ? [error] : [], `${id}-errors`);
    if (!error) void onSave(draft).then(saved => { if (saved) onClose(); });
  }}><label htmlFor={id}>Model name</label><input id={id} disabled={busy} value={draft} onChange={event => setDraft(event.target.value)} aria-invalid={Boolean(errors.length || error)} aria-describedby={errors.length || error ? `${id}-errors` : undefined} /><Errors id={`${id}-errors`} errors={[...errors, ...(error ? [error] : [])]} />{editsBlocked && <p role="status">{persistenceDraftMessage}</p>}<Actions busy={busy || editsBlocked}>{busy ? 'Saving…' : 'Save'}</Actions></form></ErPanel>;
}
export function Confirm({ title, children, busy = false, error = '', returnFocusRef, onConfirm, onClose }: { title: string; children: ReactNode; busy?: boolean; error?: string; returnFocusRef?: RefObject<HTMLElement | null>; onConfirm: () => void; onClose: () => void }) {
  useEffect(() => () => { requestAnimationFrame(() => { if (returnFocusRef?.current?.isConnected) returnFocusRef.current.focus(); }); }, [returnFocusRef]);
  return <ErPanel title={title} busy={busy} onClose={onClose}><p>{children}</p>{error && <div className="form-error" role="alert">{error}</div>}<div className="erd-form-actions"><button className="button secondary" disabled={busy} onClick={onClose}>Cancel</button><button className="button danger" disabled={busy} onClick={onConfirm}>{busy ? 'Deleting…' : 'Delete'}</button></div></ErPanel>;
}
