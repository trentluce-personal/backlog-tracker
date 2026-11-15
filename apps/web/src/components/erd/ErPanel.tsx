import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export function ErPanel({ title, children, busy = false, dirty = false, onClose }: { title: string; children: ReactNode; busy?: boolean; dirty?: boolean; onClose: () => void }) {
  const id = useId();
  const panel = useRef<HTMLElement>(null);
  const [discard, setDiscard] = useState(false);
  const trigger = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  useLayoutEffect(() => { panel.current?.focus(); return () => { const target = trigger.current; if (target?.isConnected && target.getClientRects().length) target.focus(); }; }, []);
  function close() { if (dirty) setDiscard(true); else onClose(); }
  return <aside ref={panel} tabIndex={-1} className="erd-panel" aria-labelledby={id} onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.stopPropagation(); if (discard) setDiscard(false); else close(); } }}>
    <header><h2 id={id}>{title}</h2><button type="button" className="button secondary" disabled={busy} onClick={close}>Close</button></header>
    {discard && <section className="erd-discard" aria-label="Discard draft"><p>Discard unsaved draft?</p><div className="erd-form-actions"><button className="button secondary" onClick={() => setDiscard(false)}>Keep editing</button><button className="button danger" onClick={onClose}>Discard draft</button></div></section>}
    {children}
  </aside>;
}
