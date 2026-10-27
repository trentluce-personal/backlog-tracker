import { useEffect, useId, useRef, type ReactNode } from 'react';

interface Props {
  title: string;
  subtitle?: string;
  children: ReactNode;
  busy?: boolean;
  dirty?: boolean;
  onClose: () => void;
}

export function Dialog({ title, subtitle, children, busy = false, dirty = false, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const subtitleId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current!;
    dialog.showModal();
    dialog.querySelector<HTMLElement>('[data-dialog-initial-focus]')?.focus();
    return () => {
      dialog.close();
      if (previous?.isConnected) previous.focus();
      else document.getElementById('workspace-title')?.focus();
    };
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  function dismiss() {
    if (!busy && (!dirty || window.confirm('Discard your unsaved changes?'))) onClose();
  }
  return (
    <dialog ref={ref} className="dialog" aria-labelledby={titleId} aria-describedby={subtitle ? subtitleId : undefined}
      onKeyDown={event => {
        if (event.key !== 'Tab') return;
        const controls = [...ref.current!.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]')]
          .filter(element => !element.matches(':disabled') && element.tabIndex >= 0 && element.getClientRects().length > 0);
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}
      onCancel={event => { event.preventDefault(); dismiss(); }}>
      <div className="dialog-heading">
        <div><h2 id={titleId}>{title}</h2>{subtitle && <p id={subtitleId}>{subtitle}</p>}</div>
        <button className="icon-button close-button" type="button" onClick={dismiss} disabled={busy} aria-label="Close dialog">×</button>
      </div>
      {children}
    </dialog>
  );
}
