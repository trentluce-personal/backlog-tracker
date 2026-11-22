import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { Grid2X2, Minus, Plus, RotateCcw } from 'lucide-react';
import { Icon } from './Icon';
import { clamp, initialView, panView, revealBounds, zoomView, HEADER_HEIGHT, ROW_HEIGHT, type View } from './erd/geometry';
import { displayCardType, displayType, moveDiagram, type Diagram, type DiagramNode } from './backendSchemaDiagram';
import type { DockSelection } from './BackendSchemaDetails';
import './erd/erd.css';

interface Props {
  diagram: Diagram;
  selected: DockSelection;
  onSelect: (selection: DockSelection) => void;
}
interface Drag { pointerId: number; element: HTMLElement; startX: number; startY: number; view: View; node?: DiagramNode; origin?: { x: number; y: number }; last?: { x: number; y: number }; moved?: boolean; nameButton?: HTMLButtonElement | null }

export function BackendSchemaCanvas({ diagram, selected, onSelect }: Props) {
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const keyboardMove = useRef<HTMLElement | null>(null);
  const pointerFocus = useRef<EventTarget | null>(null);
  const pointerFocusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [view, setView] = useState<View>(initialView);
  const [grid, setGrid] = useState(true);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [draggingNode, setDraggingNode] = useState<string | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);
  const shown = useMemo(() => moveDiagram(diagram, positions), [diagram, positions]);
  const hovered = shown.edges.find(edge => edge.id === hoveredEdge);

  function clearPointerFocus() {
    pointerFocus.current = null;
    if (pointerFocusTimer.current !== null) clearTimeout(pointerFocusTimer.current);
    pointerFocusTimer.current = null;
  }
  function markPointerFocus(event: PointerEvent<Element>) {
    clearPointerFocus();
    pointerFocus.current = event.target;
    pointerFocusTimer.current = setTimeout(clearPointerFocus, 0);
  }
  useEffect(() => clearPointerFocus, []);

  function revealFocus(element: Element) {
    const pointerTarget = pointerFocus.current;
    clearPointerFocus();
    if (pointerTarget instanceof Node && element.contains(pointerTarget)) return;
    if (drag.current || !viewport.current) return;
    const canvas = viewport.current;
    const rect = element.getBoundingClientRect(), parent = canvas.getBoundingClientRect();
    const next = revealBounds(view, { x: (rect.left - parent.left - view.x + canvas.scrollLeft) / view.zoom, y: (rect.top - parent.top - view.y + canvas.scrollTop) / view.zoom, width: rect.width / view.zoom, height: rect.height / view.zoom }, { width: canvas.clientWidth, height: canvas.clientHeight - 76 });
    canvas.scrollLeft = 0; canvas.scrollTop = 0;
    if (next.x !== view.x || next.y !== view.y) setView(next);
  }
  useLayoutEffect(() => {
    const header = keyboardMove.current;
    keyboardMove.current = null;
    if (header && document.activeElement === header) revealFocus(header);
  });

  function finish(cancel: boolean) {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    setDraggingNode(null);
    if (current.element.hasPointerCapture(current.pointerId)) current.element.releasePointerCapture(current.pointerId);
    if (current.node && current.origin) {
      if (cancel) {
        const name = current.node.name, origin = current.origin;
        setPositions(previous => ({ ...previous, [name]: origin }));
      }
    } else if (cancel) setView(current.view);
  }
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && drag.current) { event.preventDefault(); finish(true); } };
    const blur = () => finish(true);
    window.addEventListener('keydown', escape); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', escape); window.removeEventListener('blur', blur); };
  });
  function start(event: PointerEvent<HTMLElement>) {
    if (drag.current || event.button !== 0) return;
    event.preventDefault();
    viewport.current?.focus({ preventScroll: true });
    drag.current = { pointerId: event.pointerId, element: event.currentTarget, startX: event.clientX, startY: event.clientY, view };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function startNode(event: PointerEvent<HTMLElement>, node: DiagramNode) {
    if (drag.current || event.button !== 0) return;
    const nameButton = (event.target as Element).closest<HTMLButtonElement>('.erd-table-name');
    event.preventDefault(); event.stopPropagation();
    drag.current = { pointerId: event.pointerId, element: event.currentTarget, startX: event.clientX, startY: event.clientY, view, node, origin: { x: node.x, y: node.y }, last: { x: node.x, y: node.y }, nameButton };
    event.currentTarget.querySelector<HTMLElement>('.erd-table-header')?.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent<HTMLElement>) {
    const current = drag.current;
    if (!current || event.pointerId !== current.pointerId) return;
    const dx = event.clientX - current.startX, dy = event.clientY - current.startY;
    if (current.node && current.last) {
      if (!current.moved) {
        if (Math.hypot(dx, dy) < 6) return;
        current.moved = true;
        setDraggingNode(current.node.name);
      }
      const x = clamp(Math.round((current.node.x + dx / current.view.zoom) / 20) * 20);
      const y = clamp(Math.round((current.node.y + dy / current.view.zoom) / 20) * 20);
      if (x === current.last.x && y === current.last.y) return;
      current.last = { x, y };
      const name = current.node.name;
      setPositions(previous => ({ ...previous, [name]: { x, y } }));
    } else setView({ ...current.view, x: current.view.x + dx, y: current.view.y + dy });
  }
  function release(event: PointerEvent<HTMLElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    move(event);
    const { node, nameButton, moved } = current;
    if (node && nameButton && !moved && nameButton.contains(document.elementFromPoint(event.clientX, event.clientY))) {
      nameButton.focus({ preventScroll: true });
      onSelect({ kind: 'node', name: node.name });
    }
    finish(false);
  }
  function zoom(amount: number) {
    if (drag.current) return;
    const rect = viewport.current?.getBoundingClientRect();
    setView(zoomView(view, view.zoom + amount, { x: (rect?.width ?? 800) / 2, y: (rect?.height ?? 600) / 2 }));
  }

  return <div className={`erd-canvas${grid ? ' erd-grid' : ''}`} ref={viewport} tabIndex={0} role="region" aria-label="Backend schema ERD canvas" aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown" style={{ backgroundSize: `${20 * view.zoom}px ${20 * view.zoom}px`, backgroundPosition: `${view.x}px ${view.y}px` }}
    onKeyDown={event => {
      if (event.target !== event.currentTarget || drag.current || event.altKey || event.ctrlKey || event.metaKey) return;
      const next = panView(view, event.key, event.shiftKey);
      if (next) { event.preventDefault(); setView(next); }
    }}
    onPointerDown={event => { if (event.target === event.currentTarget) start(event); }} onPointerMove={move}
    onPointerUp={release}
    onPointerCancel={event => { if (drag.current?.pointerId === event.pointerId) finish(true); }}
    onLostPointerCapture={event => { if (drag.current?.pointerId === event.pointerId) finish(true); }}>
    <div className="erd-pan-surface" aria-hidden="true" onPointerDown={event => start(event)} />
    <div className="erd-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
      <svg className="erd-lines" width={shown.width} height={shown.height} role="group" aria-label="Table relationships">
        <defs>
          <marker id="backend-schema-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" /></marker>
          {/* Keep vertical arrowheads outside the right border of stacked cards. */}
          <marker id="backend-schema-arrow-up" viewBox="0 0 10 10" refX="9" refY="0" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 0 L 10 0 L 0 6 z" fill="currentColor" /></marker>
          <marker id="backend-schema-arrow-down" viewBox="0 0 10 10" refX="9" refY="10" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 4 L 10 10 L 0 10 z" fill="currentColor" /></marker>
        </defs>
        {shown.edges.map(edge => {
          const isSelected = selected?.kind === 'edge' && selected.id === edge.id;
          const vertical = edge.sourceName !== edge.targetName && edge.sx === edge.tx && edge.sy !== edge.ty;
          const arrow = vertical ? `backend-schema-arrow-${edge.sy > edge.ty ? 'up' : 'down'}` : 'backend-schema-arrow';
          return <g key={edge.id} className={`erd-link${hovered?.id === edge.id ? ' erd-link-hovered' : ''}${isSelected ? ' erd-link-selected' : ''}`}>
            <path d={edge.path} className="erd-link-path" markerEnd={`url(#${arrow})`} aria-hidden="true" />
            <circle cx={edge.sx} cy={edge.sy} r="4" aria-hidden="true" />
            <path d={edge.path} className="erd-link-hit" role="button" tabIndex={0} aria-label={`Foreign key ${edge.hoverLabel}`} aria-current={isSelected ? 'true' : undefined}
              onPointerEnter={() => setHoveredEdge(edge.id)} onPointerLeave={() => setHoveredEdge(null)}
              onPointerDown={event => { event.stopPropagation(); markPointerFocus(event); }}
              onClick={() => onSelect({ kind: 'edge', id: edge.id })}
              onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect({ kind: 'edge', id: edge.id }); } }}
              onFocus={event => revealFocus(event.currentTarget)} />
          </g>;
        })}
      </svg>
      {shown.nodes.map(node => {
        const isSelected = selected?.kind === 'node' && selected.name === node.name;
        const foreignKeyColumns = new Set(node.table.foreignKeys.map(key => key.from));
        return <article key={node.name} className={`erd-table${isSelected ? ' erd-table-selected' : ''}${draggingNode === node.name ? ' backend-schema-table-dragging' : ''}`} style={{ left: node.x, top: node.y, width: node.width }} aria-label={`${isSelected ? 'Selected table' : 'Table'} ${node.name}`}
          onPointerDown={event => startNode(event, node)}>
          <div className="erd-table-header" data-table-id={node.name} style={{ height: HEADER_HEIGHT }} tabIndex={0} role="group" aria-label={`${isSelected ? 'Selected table' : 'Select and move table'} ${node.name}`}
            onFocus={event => revealFocus(event.currentTarget)}
            onKeyDown={event => {
              if (drag.current || event.target !== event.currentTarget || event.ctrlKey || event.metaKey || event.altKey) return;
              if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect({ kind: 'node', name: node.name }); return; }
              const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
              const delta = directions[event.key];
              if (delta) {
                event.preventDefault();
                keyboardMove.current = event.currentTarget;
                const step = event.shiftKey ? 100 : 20, name = node.name;
                setPositions(previous => {
                  const base = previous[name] ?? { x: node.x, y: node.y };
                  return { ...previous, [name]: { x: clamp(base.x + delta[0] * step), y: clamp(base.y + delta[1] * step) } };
                });
              }
            }}>
            <h2 title={node.name}><button className="erd-table-name" aria-label={`Select table ${node.name}`} aria-current={isSelected ? 'true' : undefined} onClick={event => { if (event.detail === 0) onSelect({ kind: 'node', name: node.name }); }} onFocus={event => { event.stopPropagation(); revealFocus(event.currentTarget); }}>{node.name}</button></h2>
          </div>
          <ol className="erd-columns">
            {node.table.columns.map(column => {
              const isPrimaryKey = column.primaryKeyPosition > 0;
              const keyFlags = [isPrimaryKey ? 'PK' : '', foreignKeyColumns.has(column.name) ? 'FK' : ''].filter(Boolean);
              const nullability = column.notNull ? 'Required' : 'Optional';
              const nullabilityTitle = column.notNull
                ? `${nullability} in SQLite (NOT NULL)`
                : `SQLite allows NULL${isPrimaryKey ? ' despite the primary key' : ''}`;
              const type = displayCardType(node.name, column);
              const declaredType = displayType(column.declaredType);
              const typeTitle = type === declaredType ? type : `${type} (SQLite: ${declaredType})`;
              return <li key={column.position} style={{ height: ROW_HEIGHT }}>
                <span className="erd-column" title={`${node.name}.${column.name}, ${typeTitle}, ${[...keyFlags, nullabilityTitle].join(' · ')}`}>
                  <span className="erd-column-name">{column.name}</span>
                  <span className="erd-column-type">{type}</span>
                  <span className="erd-column-flags">{[...keyFlags, nullability].join(' ')}</span>
                </span>
              </li>;
            })}
            {!node.table.columns.length && <li className="erd-no-columns" style={{ height: ROW_HEIGHT }}>No columns</li>}
          </ol>
        </article>;
      })}
    </div>
    {hovered && <div className="erd-hover-label"><strong>{hovered.sourceName} → {hovered.targetName}</strong><span>{hovered.hoverLabel}</span></div>}
    {!shown.nodes.length && <span className="erd-empty">No tables</span>}
    <div className="erd-viewport-controls" role="toolbar" aria-label="Canvas view" onPointerDown={event => event.stopPropagation()}>
      <button className="icon-button" aria-label="Zoom out" disabled={view.zoom <= .25} onClick={() => zoom(-.1)}><Icon icon={Minus} /></button>
      <output aria-label="Zoom">{Math.round(view.zoom * 100)}%</output>
      <button className="icon-button" aria-label="Zoom in" disabled={view.zoom >= 2} onClick={() => zoom(.1)}><Icon icon={Plus} /></button>
      <button className="icon-button" aria-label="Reset view" onClick={() => { if (!drag.current) setView(initialView); }}><Icon icon={RotateCcw} /></button>
      <button className="icon-button" aria-label={grid ? 'Hide grid' : 'Show grid'} title={grid ? 'Hide grid' : 'Show grid'} aria-pressed={grid} onClick={() => setGrid(value => !value)}><Icon icon={Grid2X2} /></button>
    </div>
  </div>;
}
