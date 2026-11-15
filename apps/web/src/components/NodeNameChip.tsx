import { useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { Pencil } from 'lucide-react';
import { Icon } from './Icon';
import type { ModelNode } from '../types';

export type NodeNameDraft = { value: string; error: string };
export const nodeNameFormat = 'Neo4j identifier';

export function NodeNameChip({ node, draft, disabled, inputRef, onDraft, onCommit, onDraftToggle, label = 'Label name', heading = false }: {
  node: Pick<ModelNode, 'id' | 'name' | 'classification'> & { draft?: boolean };
  draft?: NodeNameDraft;
  disabled: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onDraft: (draft: NodeNameDraft) => void;
  onCommit: (value: string) => string;
  onDraftToggle?: (draft: boolean) => void;
  label?: string;
  heading?: boolean;
}) {
  const id = useId();
  const [editing, setEditing] = useState(Boolean(draft && draft.value !== node.name));
  const pencil = useRef<HTMLButtonElement>(null);
  const measure = useRef<HTMLSpanElement>(null);
  const finish = useRef(false);
  const focusInput = useRef(false);
  const [width, setWidth] = useState(44);
  const value = draft?.value ?? node.name;
  const Container = heading ? 'span' : 'div';
  const Row = heading ? 'span' : 'div';
  const Message = heading ? 'span' : 'p';

  useLayoutEffect(() => {
    if (!editing) return;
    setWidth(Math.ceil(measure.current?.getBoundingClientRect().width ?? 0) + 26);
    if (focusInput.current) {
      focusInput.current = false;
      inputRef.current?.focus({ preventScroll: true });
      inputRef.current?.select();
    }
  }, [editing, value, inputRef]);

  function begin() {
    finish.current = false;
    if (editing) { inputRef.current?.focus(); inputRef.current?.select(); return; }
    focusInput.current = true;
    setEditing(true);
  }

  function commit(restoreFocus = false) {
    if (finish.current) return;
    const error = onCommit(value);
    if (error) { onDraft({ value, error }); return; }
    finish.current = true;
    setEditing(false);
    if (restoreFocus) pencil.current?.focus({ preventScroll: true });
  }

  return <Container className={`modeling-name-editor${heading ? ' modeling-name-heading' : ''}`}>
    <label className={heading ? 'sr-only' : undefined} id={`${id}-label`} htmlFor={editing ? id : undefined}>{label}</label>
    <Row className="modeling-name-row" data-classification={node.classification} data-draft={node.draft}>
      {editing ? <>
        <span ref={measure} className="modeling-name-measure" aria-hidden="true">{value || ' '}</span>
        <input ref={inputRef} className="modeling-name-chip" style={{ width }} id={id} name="labelName" type="text" autoComplete="off" spellCheck={false} disabled={disabled} value={value}
          aria-labelledby={`${id}-label`} aria-invalid={Boolean(draft?.error)} aria-describedby={[!heading && `${id}-format`, draft?.error && `${id}-error`].filter(Boolean).join(' ') || undefined}
          onChange={event => onDraft({ value: event.target.value, error: '' })}
          onBlur={() => commit()} onKeyDown={event => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); commit(true); }
            if (event.key === 'Escape') {
              event.preventDefault(); event.stopPropagation();
              // Set the guard before moving focus: blur must not submit the canceled value.
              finish.current = true;
              onDraft({ value: node.name, error: '' });
              setEditing(false);
              pencil.current?.focus({ preventScroll: true });
            }
          }} />
      </> : <button type="button" className="modeling-name-chip" disabled={disabled} title={node.name} aria-label={`${label}: ${node.name}`} onClick={event => { if (event.detail === 0) begin(); }} onDoubleClick={begin} onKeyDown={event => {
        if (event.key === 'Enter' || event.key === 'F2' || event.key === ' ') { event.preventDefault(); begin(); }
      }}><span>{node.name}</span></button>}
      <button ref={pencil} type="button" className="modeling-name-edit" aria-label={`Edit ${label.toLowerCase()}`} disabled={disabled} onClick={begin} onKeyDown={event => {
        if (event.key === 'F2') { event.preventDefault(); begin(); }
      }}><Icon icon={Pencil} /></button>
      {onDraftToggle && <label className="modeling-draft-control" htmlFor="model-node-draft"><input id="model-node-draft" type="checkbox" disabled={disabled} checked={node.draft ?? false} onChange={event => onDraftToggle(event.target.checked)} />Draft</label>}
    </Row>
    {editing && !heading && <p className="modeling-hint" id={`${id}-format`}>{nodeNameFormat}</p>}
    {draft?.error && <Message className="modeling-error" id={`${id}-error`} role="alert">{draft.error}</Message>}
  </Container>;
}
