import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { ErModel } from '../../erd-types';
import { applyDraft, type TableDraft } from './model';

type NameDraft = Extract<TableDraft, { kind: 'table' }>;
export function ErHeaderName({ model, tableId, initial, busy, onChange, onCommit, onClose }: { model: ErModel; tableId: string; initial: NameDraft; busy: boolean; onChange: (draft: NameDraft) => void; onCommit: (model: ErModel) => string[]; onClose: () => void }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<string[]>([]);
  useLayoutEffect(() => { input.current?.focus({ preventScroll: true }); input.current?.select(); }, []);
  return <form className="erd-header-name" onPointerDown={event => event.stopPropagation()} onKeyDown={event => {
    event.stopPropagation();
    if (event.key === 'Escape' && !busy) { event.preventDefault(); onClose(); }
  }} onSubmit={event => {
    event.preventDefault();
    if (busy) return;
    const result = applyDraft(model, tableId, initial);
    const nextErrors = result.errors.length ? result.errors : onCommit(result.model);
    setErrors(nextErrors);
    if (!nextErrors.length) onClose();
    else input.current?.focus({ preventScroll: true });
  }}>
    <label className="sr-only" htmlFor={id}>Table name</label>
    <input ref={input} id={id} disabled={busy} value={initial.name} aria-invalid={Boolean(errors.length)} aria-describedby={errors.length ? `${id}-errors` : undefined} onChange={event => { onChange({ ...initial, name: event.target.value }); setErrors([]); }} />
    <button type="submit" disabled={busy} aria-label="Apply table name">✓</button>
    <button type="button" disabled={busy} onClick={onClose} aria-label="Cancel table name edit">×</button>
    {errors.length > 0 && <div id={`${id}-errors`} className="erd-header-name-error" role="alert">{errors.map(error => <p key={error}>{error}</p>)}</div>}
  </form>;
}
