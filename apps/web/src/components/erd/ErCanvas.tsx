import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import { Grid2X2, Minus, Plus, RotateCcw } from 'lucide-react';
import { Icon } from '../Icon';
import type { ErColumn, ErForeignKey, ErModel, ErTable } from '../../erd-types';
import { clamp, expandedLayout, HEADER_HEIGHT, initialView, panView, relationshipGeometry, revealBounds, ROW_HEIGHT, TABLE_WIDTH, zoomView, type View } from './geometry';
import { replaceTable } from './model';
import type { TableDraft } from './model';
import { ErInlineEditor } from './ErInlineEditor';
import { ErHeaderName } from './ErHeaderName';

interface Props {
  model: ErModel; busy: boolean; active: boolean; selected: string | null; onSelect: (id: string) => void;
  onCommit: (model: ErModel) => string[]; gesture: RefObject<boolean>; view: View; setView: (view: View) => void;
  onRename: (table: ErTable) => void; onDeleteTable: (table: ErTable) => void; onColumn: (table: ErTable, column?: ErColumn) => void;
  onDeleteColumn: (table: ErTable, column: ErColumn) => void; onRelationship: (fk: ErForeignKey) => void;
  drafts: Record<string, { tableId: string; draft: TableDraft }>;
  onDraft: (key: string, draft: TableDraft) => void; onCloseDraft: (key: string) => void;
}
interface Drag { pointerId: number; element: HTMLElement; startX: number; startY: number; view: View; table?: ErTable }
export function ErCanvas({ model, busy, active, selected, onSelect, onCommit, gesture, view, setView, onRename, onDeleteTable, onColumn, onDeleteColumn, onRelationship, drafts, onDraft, onCloseDraft }: Props) {
  const viewport = useRef<HTMLDivElement>(null);
  const pointerFocus = useRef<EventTarget | null>(null);
  const pointerFocusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function clearPointerFocus() {
    pointerFocus.current = null;
    if (pointerFocusTimer.current !== null) clearTimeout(pointerFocusTimer.current);
    pointerFocusTimer.current = null;
  }
  function markPointerFocus(event: PointerEvent<HTMLElement>) {
    clearPointerFocus();
    pointerFocus.current = event.target;
    // Default focus runs after capture handlers. Expire this event-local marker
    // after that default action, even if the pointer never focuses a control.
    pointerFocusTimer.current = setTimeout(clearPointerFocus, 0);
  }
  useEffect(() => clearPointerFocus, []);
  const drag = useRef<Drag | null>(null);
  const [preview, setPreview] = useState<ErTable | null>(null);
  const previewRef = useRef<ErTable | null>(null);
  const [grid, setGrid] = useState(true);
  const [hoveredRelationship, setHoveredRelationship] = useState<string | null>(null);
  const positioned = preview ? replaceTable(model, preview) : model;
  const extraHeights = Object.fromEntries(Object.values(drafts).filter(entry => entry.draft.kind === 'column').map(entry => [entry.tableId, 360]));
  const shown = { ...positioned, tables: expandedLayout(positioned.tables, extraHeights) };
  const hovered = shown.foreignKeys.find(fk => fk.id === hoveredRelationship);
  function revealFocus(element: HTMLElement) {
    const pointerTarget = pointerFocus.current;
    clearPointerFocus();
    // Moving the clicked target between pointerdown and pointerup loses clicks.
    // Match only this event's target; new inline autofocus must still reveal.
    if (pointerTarget instanceof Node && (element.contains(pointerTarget) || (pointerTarget instanceof HTMLLabelElement && pointerTarget.control === element))) return;
    if (gesture.current || !viewport.current) return;
    const canvas = viewport.current;
    // Reveal the actual focused control (including lower rows of tall tables).
    const focusBounds = element.closest('.erd-header-name') ? element.closest('.erd-table-header')! : element;
    const rect = focusBounds.getBoundingClientRect(), parent = canvas.getBoundingClientRect();
    const next = revealBounds(view, { x: (rect.left - parent.left - view.x + canvas.scrollLeft) / view.zoom, y: (rect.top - parent.top - view.y + canvas.scrollTop) / view.zoom, width: rect.width / view.zoom, height: rect.height / view.zoom }, { width: canvas.clientWidth, height: canvas.clientHeight - 76 });
    // Native focus scrolling must not become a second canvas pan mechanism.
    canvas.scrollLeft = 0; canvas.scrollTop = 0;
    if (next.x !== view.x || next.y !== view.y) setView(next);
  }
  function finish(cancel: boolean) {
    const current = drag.current;
    if (!current) return;
    drag.current = null; gesture.current = false;
    if (current.element.hasPointerCapture(current.pointerId)) current.element.releasePointerCapture(current.pointerId);
    if (cancel && !current.table) setView(current.view);
    if (!cancel && previewRef.current) onCommit(replaceTable(model, previewRef.current));
    previewRef.current = null; setPreview(null);
  }
  useEffect(() => {
    if (!active) finish(true);
  }, [active]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && drag.current) { event.preventDefault(); finish(true); } };
    const blur = () => finish(true);
    window.addEventListener('keydown', escape); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', escape); window.removeEventListener('blur', blur); };
  });
  function start(event: PointerEvent<HTMLElement>, table?: ErTable) {
    if (busy || drag.current || event.button !== 0 || (event.target as Element).closest('button, input, select, textarea, label, form')) return;
    event.preventDefault(); event.stopPropagation();
    gesture.current = true;
    if (table) onSelect(table.id);
    event.currentTarget.focus({ preventScroll: true });
    drag.current = { pointerId: event.pointerId, element: event.currentTarget, startX: event.clientX, startY: event.clientY, view, table };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent<HTMLElement>) {
    const current = drag.current;
    if (!current || event.pointerId !== current.pointerId) return;
    const dx = event.clientX - current.startX, dy = event.clientY - current.startY;
    if (current.table) {
      const table = { ...current.table, x: clamp(Math.round((current.table.x + dx / current.view.zoom) / 20) * 20), y: clamp(Math.round((current.table.y + dy / current.view.zoom) / 20) * 20) };
      previewRef.current = table; setPreview(table);
    } else setView({ ...current.view, x: current.view.x + dx, y: current.view.y + dy });
  }
  function zoom(amount: number) {
    if (gesture.current) return;
    const rect = viewport.current?.getBoundingClientRect();
    setView(zoomView(view, view.zoom + amount, { x: (rect?.width ?? 800) / 2, y: (rect?.height ?? 600) / 2 }));
  }
  return <div className={`erd-canvas${grid ? ' erd-grid' : ''}`} ref={viewport} tabIndex={0} role="region" aria-label="ERD canvas" aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown" style={{ backgroundSize: `${20 * view.zoom}px ${20 * view.zoom}px`, backgroundPosition: `${view.x}px ${view.y}px` }}
    onKeyDown={event => {
      if (event.target !== event.currentTarget || busy || gesture.current || event.altKey || event.ctrlKey || event.metaKey) return;
      const next = panView(view, event.key, event.shiftKey);
      if (next) { event.preventDefault(); setView(next); }
    }}
    onPointerDown={event => { if (event.target === event.currentTarget) start(event); }} onPointerMove={move}
    onPointerUp={event => { if (drag.current?.pointerId === event.pointerId) finish(false); }}
    onPointerCancel={event => { if (drag.current?.pointerId === event.pointerId) finish(true); }}
    onLostPointerCapture={event => { if (drag.current?.pointerId === event.pointerId) finish(true); }}>
    <div className="erd-pan-surface" aria-hidden="true" onPointerDown={event => start(event)} />
    <div className="erd-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
      <svg className="erd-lines" width="20500" height="24000" aria-hidden="true"><defs><marker id="erd-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" /></marker></defs>
        {shown.foreignKeys.map(fk => {
          const line = relationshipGeometry(shown, fk);
          return line && <g key={fk.id} className={`erd-link${hovered?.id === fk.id ? ' erd-link-hovered' : ''}`}><path d={line.path} className="erd-link-path" markerEnd="url(#erd-arrow)" /><circle cx={line.sx} cy={line.sy} r="4" /><path d={line.path} className="erd-link-hit" onPointerEnter={() => setHoveredRelationship(fk.id)} onPointerLeave={() => setHoveredRelationship(null)} onPointerDown={event => event.stopPropagation()} onClick={() => !busy && onRelationship(fk)} /></g>;
        })}
      </svg>
      {shown.tables.map(table => <article key={table.id} className={`erd-table${selected === table.id ? ' erd-table-selected' : ''}`} style={{ left: table.x, top: table.y, width: TABLE_WIDTH }} aria-label={`Table ${table.name}`} onPointerDownCapture={markPointerFocus} onPointerUpCapture={markPointerFocus} onPointerCancelCapture={clearPointerFocus} onKeyDownCapture={clearPointerFocus} onFocus={event => { onSelect(table.id); revealFocus(event.target as HTMLElement); }}>
        <div className="erd-table-header" data-table-id={table.id} style={{ height: HEADER_HEIGHT }} tabIndex={0} role="group" aria-label={`${selected === table.id ? 'Selected table' : 'Select and move table'} ${table.name}`}
          onFocus={() => onSelect(table.id)} onPointerDown={event => start(event, model.tables.find(item => item.id === table.id))}
          onKeyDown={event => {
            if (busy || gesture.current || event.target !== event.currentTarget || event.ctrlKey || event.metaKey || event.altKey) return;
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(table.id); }
            const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
            const delta = directions[event.key];
            if (delta) { event.preventDefault(); const step = event.shiftKey ? 100 : 20, stored = model.tables.find(item => item.id === table.id)!; onCommit(replaceTable(model, { ...stored, x: clamp(stored.x + delta[0] * step), y: clamp(stored.y + delta[1] * step) })); }
          }}>{Object.entries(drafts).filter(([, entry]) => entry.tableId === table.id && entry.draft.kind === 'table').map(([key, entry]) => entry.draft.kind === 'table' && <div className="erd-header-draft" key={key} data-draft-key={key}><ErHeaderName model={model} tableId={table.id} initial={entry.draft} busy={busy} onChange={draft => onDraft(key, draft)} onCommit={onCommit} onClose={() => onCloseDraft(key)} /></div>)}
          {!Object.values(drafts).some(entry => entry.tableId === table.id && entry.draft.kind === 'table') && <><h2 title={table.name}><button className="erd-table-name" data-table-name={table.id} disabled={busy} onClick={() => onRename(table)} aria-label={`Edit table name ${table.name}`}>{table.name}</button></h2><button disabled={busy} onClick={() => onRename(table)} aria-label={`Rename table ${table.name}`}>Edit</button></>}
          <span className="erd-table-actions"><button disabled={busy} onClick={() => onDeleteTable(table)} aria-label={`Delete table ${table.name}`}>×</button></span></div>
        <ol className="erd-columns">
          {table.columns.map(column => {
            const fks = shown.foreignKeys.filter(fk => fk.sourceColumnId === column.id);
            const flags = [column.primaryKey ? 'PK' : '', fks.length ? 'FK' : '', column.unique ? 'UQ' : '', column.nullable ? 'NULL' : 'NOT NULL'].filter(Boolean).join(' · ');
            return <li key={column.id} style={{ height: ROW_HEIGHT }}><button className="erd-column" disabled={busy} onClick={() => onColumn(table, column)} aria-label={`Edit ${table.name}.${column.name}, ${column.dataType}, ${flags}`}><span className="erd-column-name" title={column.name}>{column.name}</span><span className="erd-column-type">{column.dataType}</span><span className="erd-column-flags" title={flags}>{column.primaryKey ? 'PK ' : ''}{fks.length ? 'FK ' : ''}{column.unique ? 'UQ ' : ''}{column.nullable ? '?' : '!'}</span></button><button className="erd-column-delete" disabled={busy} onClick={() => onDeleteColumn(table, column)} aria-label={`Delete column ${table.name}.${column.name}`}>×</button></li>;
          })}
          {!table.columns.length && <li className="erd-no-columns" style={{ height: ROW_HEIGHT }}>No columns</li>}
        </ol>
        <button className="erd-add-column" disabled={busy || table.columns.length >= 100} onClick={() => onColumn(table)}>+ Add column</button>
        <div className="erd-editors">{Object.entries(drafts).filter(([, entry]) => entry.tableId === table.id).map(([key, entry]) => entry.draft.kind === 'column' && <div key={key} data-draft-key={key}><ErInlineEditor model={model} tableId={table.id} initial={entry.draft} busy={busy} onChange={draft => onDraft(key, draft)} onCommit={onCommit} onClose={() => onCloseDraft(key)} /></div>)}</div>
      </article>)}
    </div>
    {hovered && <div className="erd-hover-label"><strong>{hovered.name}</strong><span>{shown.tables.find(table => table.id === hovered.sourceTableId)?.name}.{shown.tables.find(table => table.id === hovered.sourceTableId)?.columns.find(column => column.id === hovered.sourceColumnId)?.name} → {shown.tables.find(table => table.id === hovered.targetTableId)?.name}.{shown.tables.find(table => table.id === hovered.targetTableId)?.columns.find(column => column.id === hovered.targetColumnId)?.name}</span></div>}
    {!model.tables.length && <span className="erd-empty">No tables</span>}
    <div className="erd-viewport-controls" role="toolbar" aria-label="Canvas view" onPointerDown={event => event.stopPropagation()}>
      <button className="icon-button" aria-label="Zoom out" disabled={busy || view.zoom <= .25} onClick={() => zoom(-.1)}><Icon icon={Minus} /></button><output aria-label="Zoom">{Math.round(view.zoom * 100)}%</output><button className="icon-button" aria-label="Zoom in" disabled={busy || view.zoom >= 2} onClick={() => zoom(.1)}><Icon icon={Plus} /></button><button className="icon-button" aria-label="Reset view" disabled={busy} onClick={() => { if (!gesture.current) setView(initialView); }}><Icon icon={RotateCcw} /></button><button className="icon-button" aria-label={grid ? 'Hide grid' : 'Show grid'} title={grid ? 'Hide grid' : 'Show grid'} aria-pressed={grid} disabled={busy} onClick={() => setGrid(value => !value)}><Icon icon={Grid2X2} /></button>
    </div>
  </div>;
}
