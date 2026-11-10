import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';
import { X } from 'lucide-react';
import { Icon } from './Icon';
import { dialogControls } from './dialogFocus';

interface Props {
  title: string;
  subtitle?: string;
  children: ReactNode;
  busy?: boolean;
  dirty?: boolean;
  returnFocusRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
}

export function Dialog({ title, subtitle, children, busy = false, dirty = false, returnFocusRef, onClose }: Props) {
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
      // The dismissing commit must re-enable its trigger first. A handoff's
      // new modal or a user-selected control owns focus instead.
      requestAnimationFrame(() => {
        const target = returnFocusRef?.current ?? (previous?.isConnected ? previous : document.getElementById('workspace-title'));
        const modal = [...document.querySelectorAll('dialog:modal')].at(-1);
        if (modal && (!target || !modal.contains(target))) return;
        if (document.activeElement !== document.body && document.activeElement !== previous) return;
        if (target?.isConnected && !target.matches(':disabled') && target.getClientRects().length) target.focus({ preventScroll: true });
      });
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
        const controls = dialogControls(ref.current!);
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}
      onCancel={event => { event.preventDefault(); dismiss(); }}>
      <div className="dialog-heading">
        <div><h2 id={titleId}>{title}</h2>{subtitle && <p id={subtitleId}>{subtitle}</p>}</div>
        <button className="icon-button close-button" type="button" onClick={dismiss} disabled={busy} aria-label="Close dialog"><Icon icon={X} /></button>
      </div>
      {children}
    </dialog>
  );
}
