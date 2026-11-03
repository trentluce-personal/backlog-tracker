import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent } from 'react';
import { Dialog } from './Dialog';
import './DataModeling.css';

type NodeLabel = { id: string; name: string; x: number; y: number };
type Relationship = { id: string; name: string; source: string; target: string };

const WIDTH = 1000;
const HEIGHT = 600;
const RADIUS = 48;
const MIN_DISTANCE = 180;
const GRID_STEP = 20;
const NODE_NAME_PATTERN = /^[A-Z][A-Za-z]*(?![\s\S])/;
const RELATIONSHIP_NAME_PATTERN = /^[A-Z]+(?:_[A-Z]+)*$/;
const nodeNameHint = 'Use up to 24 ASCII letters (e.g. CustomerAccount). The first letter is capitalized automatically. No numbers, spaces, or underscores.';
const relationshipNameHint = 'Use up to 24 ASCII letters, with single underscores between words (e.g. WORKS_AT). Each space becomes an underscore; remove consecutive, leading, or trailing underscores. No numbers.';
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const snap = (value: number, limit: number) => clamp(Math.round(value / GRID_STEP) * GRID_STEP, Math.ceil((RADIUS + 5) / GRID_STEP) * GRID_STEP, Math.floor((limit - RADIUS - 5) / GRID_STEP) * GRID_STEP);

type Point = { x: number; y: number };
type EdgeGroup = { source: string; target: string; items: Relationship[] };
type Segment = { a: Point; b: Point };

function distanceToSegment(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

function segmentClear(a: Point, b: Point, obstacles: NodeLabel[]) {
  return obstacles.every(node => {
    return distanceToSegment(node, a, b) >= RADIUS + 15;
  });
}

function routeClear(a: Point, b: Point, routes: Segment[], source: Point, target: Point) {
  const count = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 10);
  for (let i = 0; i <= count; i++) {
    const p = { x: a.x + (b.x - a.x) * i / (count || 1), y: a.y + (b.y - a.y) * i / (count || 1) };
    if (Math.hypot(p.x - source.x, p.y - source.y) < 80 || Math.hypot(p.x - target.x, p.y - target.y) < 80) continue;
    if (routes.some(route => distanceToSegment(p, route.a, route.b) < 18)) return false;
  }
  return true;
}

function curveClear(points: [Point, Point, Point, Point], obstacles: NodeLabel[]) {
  let last = points[0];
  for (let i = 1; i <= 40; i++) {
    const t = i / 40, u = 1 - t;
    const next = { x: u ** 3 * points[0].x + 3 * u ** 2 * t * points[1].x + 3 * u * t ** 2 * points[2].x + t ** 3 * points[3].x, y: u ** 3 * points[0].y + 3 * u ** 2 * t * points[1].y + 3 * u * t ** 2 * points[2].y + t ** 3 * points[3].y };
    if (!segmentClear(last, next, obstacles)) return false;
    last = next;
  }
  return true;
}

// Route on a small grid, then remove unnecessary bends. If no route exists,
// don't draw a misleading arrow through an unrelated node.
function edgeGeometry(source: NodeLabel, target: NodeLabel, nodes: NodeLabel[], routes: Segment[] = []): { path: string; badge: Point; segments: Segment[] } | null {
  const obstacles = nodes.filter(node => node.id !== source.id && node.id !== target.id);
  const step = 20, columns = WIDTH / step + 1;
  const point = (id: number): Point => ({ x: (id % columns) * step, y: Math.floor(id / columns) * step });
  const idAt = (p: Point) => Math.round(p.y / step) * columns + Math.round(p.x / step);
  const start = idAt(source), end = idAt(target);
  const queue = [start], distance = new Map<number, number>([[start, 0]]), previous = new Map<number, number>();
  while (queue.length) {
    queue.sort((a, b) => distance.get(a)! + Math.hypot(point(a).x - target.x, point(a).y - target.y) - distance.get(b)! - Math.hypot(point(b).x - target.x, point(b).y - target.y));
    const current = queue.shift()!;
    if (current === end) break;
    const p = point(current);
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      const x = p.x + dx * step, y = p.y + dy * step;
      if (x < 0 || x > WIDTH || y < 0 || y > HEIGHT) continue;
      const next = y / step * columns + x / step;
      if (!segmentClear(p, { x, y }, obstacles) || !routeClear(p, { x, y }, routes, source, target)) continue;
      const cost = distance.get(current)! + Math.hypot(dx, dy) * step;
      if (cost >= (distance.get(next) ?? Infinity)) continue;
      distance.set(next, cost); previous.set(next, current);
      if (!queue.includes(next)) queue.push(next);
    }
  }
  if (!distance.has(end)) return routes.length ? edgeGeometry(source, target, nodes) : null;
  const grid: Point[] = [];
  for (let cursor = end; cursor !== start; cursor = previous.get(cursor)!) grid.push(point(cursor));
  const raw: Point[] = [source];
  for (const p of [...grid.reverse(), target]) {
    const last = raw[raw.length - 1];
    if (Math.hypot(last.x - p.x, last.y - p.y) > 0.01) raw.push(p);
  }
  const points: Point[] = [source];
  for (let i = 0; i < raw.length - 1;) {
    let next = raw.length - 1;
    while (next > i + 1 && (!segmentClear(raw[i], raw[next], obstacles) || !routeClear(raw[i], raw[next], routes, source, target))) next--;
    points.push(raw[next]); i = next;
  }
  const trim = (center: Point, next: Point, radius: number) => {
    const length = Math.hypot(next.x - center.x, next.y - center.y);
    return { x: center.x + (next.x - center.x) * radius / length, y: center.y + (next.y - center.y) * radius / length };
  };
  points[0] = trim(source, points[1], RADIUS);
  points[points.length - 1] = trim(target, points[points.length - 2], RADIUS + 2);
  const lengths = points.slice(1).map((p, index) => Math.hypot(p.x - points[index].x, p.y - points[index].y));
  let remaining = lengths.reduce((sum, length) => sum + length, 0) / 2;
  let segment = 0;
  while (segment < lengths.length - 1 && remaining > lengths[segment]) remaining -= lengths[segment++];
  const ratio = remaining / lengths[segment];
  const badge = { x: clamp(points[segment].x + (points[segment + 1].x - points[segment].x) * ratio, 18, WIDTH - 18), y: clamp(points[segment].y + (points[segment + 1].y - points[segment].y) * ratio, 13, HEIGHT - 13) };
  return { path: points.map((p, index) => `${index ? 'L' : 'M'} ${p.x} ${p.y}`).join(' '), badge, segments: points.slice(1).map((b, index) => ({ a: points[index], b })) };
}

function parallelGeometry(source: NodeLabel, target: NodeLabel, nodes: NodeLabel[], offset: number) {
  const dx = target.x - source.x, dy = target.y - source.y;
  const length = Math.hypot(dx, dy);
  const control = { x: (source.x + target.x) / 2 - dy / length * offset, y: (source.y + target.y) / 2 + dx / length * offset };
  const trim = (center: Point, toward: Point, radius: number) => {
    const distance = Math.hypot(toward.x - center.x, toward.y - center.y);
    return { x: center.x + (toward.x - center.x) * radius / distance, y: center.y + (toward.y - center.y) * radius / distance };
  };
  const start = trim(source, control, RADIUS), end = trim(target, control, RADIUS + 2);
  const cubic: [Point, Point, Point, Point] = [start, { x: (start.x + 2 * control.x) / 3, y: (start.y + 2 * control.y) / 3 }, { x: (end.x + 2 * control.x) / 3, y: (end.y + 2 * control.y) / 3 }, end];
  if (cubic.some(p => p.x < 10 || p.x > WIDTH - 10 || p.y < 10 || p.y > HEIGHT - 10) || !curveClear(cubic, nodes.filter(node => node.id !== source.id && node.id !== target.id))) return null;
  return { path: `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`, badge: { x: (start.x + 2 * control.x + end.x) / 4, y: (start.y + 2 * control.y + end.y) / 4 } };
}

// Put self-loops towards the wider half of the canvas, with labels in a
// separate column. This leaves room even when the node is at an edge.
function loopGeometry(node: NodeLabel, index: number, count: number, nodes: NodeLabel[]) {
  const candidates = [
    { axis: 'x', direction: 1, room: WIDTH - node.x },
    { axis: 'x', direction: -1, room: node.x },
    { axis: 'y', direction: 1, room: HEIGHT - node.y },
    { axis: 'y', direction: -1, room: node.y },
  ] as const;
  const candidate = candidates.reduce((best, item) => {
    const score = (choice: typeof item) => {
      const required = choice.axis === 'x' ? 310 : 220;
      const collisions = nodes.filter(other => {
        if (other.id === node.id) return false;
        const along = choice.direction * (choice.axis === 'x' ? other.x - node.x : other.y - node.y);
        const across = Math.abs(choice.axis === 'x' ? other.y - node.y : other.x - node.x);
        return along > 0 && along < required + RADIUS && across < 120;
      }).length;
      return (choice.room < required ? -10000 : 0) - collisions * 1000 + choice.room;
    };
    return score(item) > score(best) ? item : best;
  });
  const direction = candidate.direction;
  const extent = 100 + index * 30;
  const angle = (70 - index * 20) * Math.PI / 180;
  const sx = node.x + direction * Math.cos(angle) * RADIUS;
  const sy = Math.sin(angle) * RADIUS;
  const top = clamp(node.y - 100, 8, HEIGHT - 8);
  const bottom = clamp(node.y + 100, 8, HEIGHT - 8);
  const tipX = sx / 4 + (node.x + direction * extent) * 3 / 4;
  const labelX = node.x + direction * (RADIUS / 4 + (100 + (count - 1) * 30) * 3 / 4 + 12);
  const labelStart = clamp(node.y - (count - 1) * 9, 15, HEIGHT - 10 - (count - 1) * 18);
  const labelY = labelStart + index * 18;
  if (candidate.axis === 'y') {
    const startX = Math.sin(angle) * RADIUS;
    const startY = node.y + direction * Math.cos(angle) * RADIUS;
    const tipY = startY / 4 + (node.y + direction * extent) * 3 / 4;
    const labelX = clamp(node.x, 85, WIDTH - 85);
    const labelY = node.y + direction * (Math.cos(30 * Math.PI / 180) * RADIUS / 4 + (100 + (count - 1) * 30) * 3 / 4 + 22 + index * 18);
    const points: [Point, Point, Point, Point] = [{ x: node.x - startX, y: startY }, { x: clamp(node.x - 100, 8, WIDTH - 8), y: node.y + direction * extent }, { x: clamp(node.x + 100, 8, WIDTH - 8), y: node.y + direction * extent }, { x: node.x + startX, y: startY }];
    if (!curveClear(points, nodes.filter(other => other.id !== node.id))) return null;
    return {
      path: `M ${node.x - startX} ${startY} C ${clamp(node.x - 100, 8, WIDTH - 8)} ${node.y + direction * extent}, ${clamp(node.x + 100, 8, WIDTH - 8)} ${node.y + direction * extent}, ${node.x + startX} ${startY}`,
      leader: `M ${(node.x * 2 + clamp(node.x - 100, 8, WIDTH - 8) + clamp(node.x + 100, 8, WIDTH - 8)) / 4} ${tipY} L ${labelX} ${labelY - direction * 8}`,
      x: labelX, y: labelY, anchor: 'middle' as const,
      badge: { x: clamp((points[0].x + 3 * points[1].x + 3 * points[2].x + points[3].x) / 8, 24, WIDTH - 24), y: clamp((points[0].y + 3 * points[1].y + 3 * points[2].y + points[3].y) / 8, 13, HEIGHT - 13) },
    };
  }
  const points: [Point, Point, Point, Point] = [{ x: sx, y: node.y - sy }, { x: node.x + direction * extent, y: top }, { x: node.x + direction * extent, y: bottom }, { x: sx, y: node.y + sy }];
  if (!curveClear(points, nodes.filter(other => other.id !== node.id))) return null;
  return {
    path: `M ${sx} ${node.y - sy} C ${node.x + direction * extent} ${top}, ${node.x + direction * extent} ${bottom}, ${sx} ${node.y + sy}`,
    leader: `M ${tipX} ${(node.y * 2 + top + bottom) / 4} L ${labelX - direction * 4} ${labelY - 4}`,
    x: labelX, y: labelY, anchor: direction === 1 ? 'start' as const : 'end' as const,
    badge: { x: clamp((points[0].x + 3 * points[1].x + 3 * points[2].x + points[3].x) / 8, 24, WIDTH - 24), y: clamp((points[0].y + 3 * points[1].y + 3 * points[2].y + points[3].y) / 8, 13, HEIGHT - 13) },
  };
}

let labelContext: CanvasRenderingContext2D | null | undefined;
const labelWidths = new Map<string, number>();
function labelWidth(text: string) {
  const cached = labelWidths.get(text);
  if (cached !== undefined) return cached;
  if (labelContext === undefined) {
    labelContext = document.createElement('canvas').getContext('2d');
    if (labelContext) labelContext.font = '600 12px "Segoe UI", sans-serif';
  }
  const width = labelContext?.measureText(text).width ?? text.length * 12;
  labelWidths.set(text, width);
  return width;
}

function labelLines(name: string) {
  // Measure natural glyph widths; wide names wrap without squeezing the font.
  const lines: string[] = [];
  let line = '';
  for (const character of name) {
    if (line && labelWidth(line + character) > 76) {
      lines.push(line); line = '';
    }
    line += character;
  }
  if (line) lines.push(line);
  return lines;
}

export function DataModeling({ active, dialog, setDialog }: { active: boolean; dialog: 'node' | 'relationship' | null; setDialog: (dialog: 'node' | 'relationship' | null) => void }) {
  const [nodes, setNodes] = useState<NodeLabel[]>([]);
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [nodeName, setNodeName] = useState('');
  const [relationshipName, setRelationshipName] = useState('');
  const [source, setSource] = useState('');
  const [target, setTarget] = useState('');
  const [nodeError, setNodeError] = useState('');
  const [relationshipError, setRelationshipError] = useState<{ field: 'name' | 'source' | 'target'; message: string } | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const nextId = useRef(0);
  const svgRef = useRef<SVGSVGElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nodeInput = useRef<HTMLInputElement>(null);
  const relationshipInput = useRef<HTMLInputElement>(null);
  const sourceInput = useRef<HTMLSelectElement>(null);
  const targetInput = useRef<HTMLSelectElement>(null);
  const drag = useRef<{ kind: 'node' | 'relationship'; id: string; pointerId: number; element: SVGGElement; dx: number; dy: number; origin: Point; client: Point; leftSource: boolean } | null>(null);
  const scrollFrame = useRef<number | null>(null);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const [preview, setPreview] = useState<{ source: string; point: Point; target: string | null } | null>(null);

  function cancelDrag(restore = true, update = true) {
    const current = drag.current;
    drag.current = null;
    if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = null;
    if (update) {
      setPreview(null);
      if (restore && current?.kind === 'node') moveNode(current.id, current.origin.x, current.origin.y);
    }
    if (current?.element.hasPointerCapture(current.pointerId)) current.element.releasePointerCapture(current.pointerId);
  }

  useLayoutEffect(() => {
    if (!active || dialog) cancelDrag();
  }, [active, dialog]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && drag.current) {
        event.preventDefault();
        cancelDrag();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => { window.removeEventListener('keydown', onKeyDown); cancelDrag(false, false); };
  }, []);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    // SVG shapes do not consistently honor touch-action in Chromium. Cancel
    // native panning only for a touch that started a node or ring gesture.
    const preventDragScroll = (event: TouchEvent) => { if (drag.current && event.cancelable) event.preventDefault(); };
    svg.addEventListener('touchmove', preventDragScroll, { passive: false });
    return () => svg.removeEventListener('touchmove', preventDragScroll);
  }, []);

  useEffect(() => {
    if (!nodes.length && !relationships.length && !nodeName && !relationshipName && !source && !target) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [nodes.length, relationships.length, nodeName, relationshipName, source, target]);

  function addNode(event: FormEvent) {
    event.preventDefault();
    const name = nodeName;
    if (!NODE_NAME_PATTERN.test(name) || name.length > 24) { setNodeError(name ? nodeNameHint : 'Enter a node label name.'); nodeInput.current?.focus(); return; }
    if (nodes.some(node => node.name === name)) { setNodeError('A node label with this name already exists.'); nodeInput.current?.focus(); return; }
    // Keep circles distinct, including when a starting slot is already occupied.
    const slots = Array.from({ length: 15 }, (_, i) => ({ x: snap(110 + (i % 5) * 190, WIDTH), y: snap(110 + Math.floor(i / 5) * 190, HEIGHT) }));
    const position = slots.find(slot => nodes.every(node => Math.hypot(node.x - slot.x, node.y - slot.y) >= MIN_DISTANCE));
    if (!position) { setNodeError('No free starting position. Move labels apart to make room.'); return; }
    setNodes(current => [...current, { id: `node-${nextId.current++}`, name, ...position }]);
    setNodeName(''); setNodeError(''); setAnnouncement(`Node label ${name} added.`);
    setDialog(null);
  }

  function addRelationship(event: FormEvent) {
    event.preventDefault();
    const name = relationshipName;
    if (!RELATIONSHIP_NAME_PATTERN.test(name) || name.length > 24) { setRelationshipError({ field: 'name', message: name ? relationshipNameHint : 'Enter a relationship name.' }); relationshipInput.current?.focus(); return; }
    if (!nodes.some(node => node.id === source)) { setRelationshipError({ field: 'source', message: 'Select a source node label.' }); sourceInput.current?.focus(); return; }
    if (!nodes.some(node => node.id === target)) { setRelationshipError({ field: 'target', message: 'Select a target node label.' }); targetInput.current?.focus(); return; }
    if (relationships.some(item => item.source === source && item.target === target && item.name === name)) {
      setRelationshipError({ field: 'name', message: 'This directed relationship already exists.' }); relationshipInput.current?.focus(); return;
    }
    const id = `relationship-${nextId.current++}`;
    setRelationships(current => [...current, { id, name, source, target }]);
    setRelationshipName(''); setSource(''); setTarget(''); setRelationshipError(null); setAnnouncement(`Relationship ${name} added.`); setDialog(null);
  }

  function changeNodeName(input: HTMLInputElement) {
    const start = input.selectionStart, end = input.selectionEnd, direction = input.selectionDirection;
    const next = input.value.replace(/^[a-z]/, character => character.toUpperCase());
    if (input.value !== next) {
      input.value = next;
      if (start !== null && end !== null) input.setSelectionRange(start, end, direction ?? undefined);
    }
    setNodeName(next);
    setNodeError('');
  }

  function changeRelationshipName(input: HTMLInputElement) {
    const start = input.selectionStart, end = input.selectionEnd, direction = input.selectionDirection;
    const next = input.value.replace(/[a-z ]/g, character => character === ' ' ? '_' : character.toUpperCase());
    if (input.value !== next) {
      input.value = next;
      if (start !== null && end !== null) input.setSelectionRange(start, end, direction ?? undefined);
    }
    setRelationshipName(next);
    if (relationshipError?.field === 'name') setRelationshipError(null);
  }

  function moveNode(id: string, x: number, y: number) {
    setNodes(current => {
      const nextX = snap(x, WIDTH);
      const nextY = snap(y, HEIGHT);
      if (current.some(node => node.id !== id && Math.hypot(node.x - nextX, node.y - nextY) < MIN_DISTANCE)) return current;
      return current.map(node => node.id === id ? { ...node, x: nextX, y: nextY } : node);
    });
  }

  function point(client: Point) {
    const svg = svgRef.current;
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return null;
    const p = svg.createSVGPoint(); p.x = client.x; p.y = client.y;
    return p.matrixTransform(matrix.inverse());
  }

  function startDrag(event: PointerEvent<SVGGElement>, node: NodeLabel, kind: 'node' | 'relationship') {
    if (!active || dialog || drag.current || event.button !== 0) return;
    const client = { x: event.clientX, y: event.clientY };
    const p = point(client);
    if (!p) return;
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { kind, id: node.id, pointerId: event.pointerId, element: event.currentTarget, dx: node.x - p.x, dy: node.y - p.y, origin: { x: node.x, y: node.y }, client, leftSource: false };
    if (kind === 'relationship') setPreview({ source: node.id, point: p, target: null });
  }

  function targetAt(p: Point, current: NonNullable<typeof drag.current>) {
    const bounds = scrollRef.current?.getBoundingClientRect();
    if (!bounds || current.client.x < bounds.left || current.client.x > bounds.right || current.client.y < bounds.top || current.client.y > bounds.bottom) return null;
    if (p.x < 0 || p.x > WIDTH || p.y < 0 || p.y > HEIGHT) return null;
    const origin = nodesRef.current.find(node => node.id === current.id);
    if (origin && Math.hypot(p.x - origin.x, p.y - origin.y) > RADIUS + 22) current.leftSource = true;
    return nodesRef.current.find(node => (node.id !== current.id || current.leftSource) && Math.hypot(p.x - node.x, p.y - node.y) <= RADIUS + 12) ?? null;
  }

  function updatePreview(current: NonNullable<typeof drag.current>) {
    const p = point(current.client);
    if (p) setPreview({ source: current.id, point: p, target: targetAt(p, current)?.id ?? null });
  }

  function startEdgeScroll() {
    if (scrollFrame.current !== null) return;
    let lastTime: number | null = null;
    let remainder = 0;
    const tick = (time: number) => {
      scrollFrame.current = null;
      const current = drag.current, scroll = scrollRef.current;
      if (!current || current.kind !== 'relationship' || !scroll) return;
      const bounds = scroll.getBoundingClientRect();
      const edge = Math.min(48, bounds.width / 4);
      if (current.client.y < bounds.top || current.client.y > bounds.bottom) return;
      const speed = current.client.x < bounds.left + edge ? -clamp((bounds.left + edge - current.client.x) / edge, 0, 1)
        : current.client.x > bounds.right - edge ? clamp((current.client.x - bounds.right + edge) / edge, 0, 1) : 0;
      if (!speed || (speed < 0 && scroll.scrollLeft <= 0) || (speed > 0 && scroll.scrollLeft >= scroll.scrollWidth - scroll.clientWidth)) return;
      const elapsed = lastTime === null ? 0 : Math.min(time - lastTime, 40);
      lastTime = time;
      remainder += speed * 300 * elapsed / 1000;
      const pixels = Math.trunc(remainder);
      remainder -= pixels;
      scroll.scrollLeft += pixels;
      updatePreview(current);
      scrollFrame.current = requestAnimationFrame(tick);
    };
    scrollFrame.current = requestAnimationFrame(tick);
  }

  function dragNode(event: PointerEvent<SVGGElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    current.client = { x: event.clientX, y: event.clientY };
    const p = point(current.client);
    if (!p) return;
    if (current.kind === 'node') moveNode(current.id, p.x + current.dx, p.y + current.dy);
    else { updatePreview(current); startEdgeScroll(); }
  }

  function finishDrag(event: PointerEvent<SVGGElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    current.client = { x: event.clientX, y: event.clientY };
    const p = point(current.client);
    const destination = current.kind === 'relationship' && p ? targetAt(p, current) : null;
    cancelDrag(false);
    if (!destination || !active || dialog) return;
    if ((relationshipName || source || target) && !window.confirm('Replace the unfinished relationship draft with these endpoints? The draft name and selections will be cleared.')) return;
    setRelationshipName(''); setSource(current.id); setTarget(destination.id); setRelationshipError(null);
    setDialog('relationship');
  }

  function moveByKeyboard(event: KeyboardEvent<SVGGElement>, node: NodeLabel) {
    if (drag.current) return;
    const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    const step = GRID_STEP * (event.shiftKey ? 4 : 1);
    moveNode(node.id, node.x + direction[0] * step, node.y + direction[1] * step);
  }

  const groups = useMemo(() => {
    const grouped: EdgeGroup[] = [];
    for (const relationship of relationships) {
      let group = grouped.find(item => (item.source === relationship.source && item.target === relationship.target) || (item.source === relationship.target && item.target === relationship.source));
      if (!group) { group = { source: relationship.source, target: relationship.target, items: [] }; grouped.push(group); }
      group.items.push(relationship);
    }
    const routes: Segment[] = [];
    return grouped.map((group, index) => {
      const from = nodes.find(node => node.id === group.source)!;
      const to = nodes.find(node => node.id === group.target)!;
      const geometry = from.id === to.id ? loopGeometry(from, 0, 1, nodes) : edgeGeometry(from, to, nodes, routes);
      const separate = group.items.length > 1 && group.items.length <= 3
        ? group.items.map((item, itemIndex) => {
          if (from.id === to.id) return loopGeometry(from, itemIndex, group.items.length, nodes);
          const offset = (itemIndex - (group.items.length - 1) / 2) * 100;
          return parallelGeometry(from, to, nodes, offset);
        }) : [];
      if (geometry && 'segments' in geometry) routes.push(...geometry.segments);
      return { ...group, number: index + 1, from, to, geometry, separate: separate.length && separate.every(Boolean) ? separate : [] };
    });
  }, [nodes, relationships]);
  const drawn = groups.flatMap(group => {
    const variants = group.separate.length ? group.separate.map((geometry, index) => ({ geometry: geometry!, item: group.items[index], suffix: String.fromCharCode(97 + index) })) : [{ geometry: group.geometry, item: null, suffix: '' }];
    return variants.filter(variant => variant.geometry).map(({ geometry, item, suffix }) => ({ group, geometry: geometry!, item, suffix }));
  });
  const badges: { x: number; y: number; width: number }[] = [];
  const placed = drawn.map(edge => {
    const text = edge.item?.name ?? (edge.group.items.length === 1 ? edge.group.items[0].name : `Bundle ${edge.group.number} · ${edge.group.items.length} types`);
    const width = Math.max(48, Math.ceil(labelWidth(text)) + 20);
    const origin = edge.geometry.badge;
    const candidates = Array.from({ length: 41 }, (_, index) => {
      const shift = index === 0 ? 0 : Math.ceil(index / 2) * 25 * (index % 2 ? -1 : 1);
      return { x: clamp(origin.x, width / 2 + 2, WIDTH - width / 2 - 2), y: clamp(origin.y + shift, 13, HEIGHT - 13), width };
    });
    const badge = candidates.find(candidate => badges.every(other => Math.abs(candidate.x - other.x) >= (candidate.width + other.width) / 2 + 6 || Math.abs(candidate.y - other.y) >= 28) && nodes.every(node => Math.hypot(Math.max(0, Math.abs(candidate.x - node.x) - candidate.width / 2), Math.max(0, Math.abs(candidate.y - node.y) - 12)) >= RADIUS + 8)) ?? candidates[0];
    badges.push(badge);
    return { ...edge, text, badge, origin };
  });

  return <section className="modeling" aria-labelledby="modeling-title">
    <header className="workspace-header"><div><h1 id="modeling-title">Data Modeling</h1></div><div className="modeling-actions">
      <button className="button primary" onClick={() => setDialog('node')}>＋ Add node label</button>
      <button className="button secondary" onClick={() => setDialog('relationship')}>＋ Add relationship</button>
    </div></header>
    <p className="modeling-notice"><strong>Session-only draft.</strong> Kept across tabs; lost on reload or close. Not saved or connected to Neo4j.</p>
    <div className="modeling-layout">
      <div className="modeling-stage">
        <div className="modeling-stage-heading"><div><h2>Graph canvas</h2><p>Drag nodes to move · Drag a ring to connect</p></div><span>{nodes.length} nodes · {relationships.length} relationships</span><details className="modeling-help"><summary>Canvas help</summary><p>Movement snaps to the grid. Drag the thin ring to a target, then name the relationship. Hold near a canvas edge to scroll while connecting. Escape cancels a drag. For keyboard or manual entry, use Add relationship. Focus a node and use arrow keys to move; hold Shift for larger steps. Bundles list their types below the canvas.</p></details></div>
        {groups.some(group => !group.geometry && !group.separate.length) && <p className="modeling-route-warning" role="status">Some arrows have no clear route. Move nodes apart to show them; affected relationships are marked below.</p>}
        <div className="modeling-canvas-region">
          {!nodes.length && <div className="modeling-empty"><span aria-hidden="true">◌</span><strong>Start with a node label</strong><p>Add a label to begin sketching your graph.</p></div>}
        <div ref={scrollRef} className="modeling-canvas-scroll" tabIndex={0} aria-label="Graph canvas, scroll horizontally if needed">
          <div className="modeling-canvas">
            <svg ref={svgRef} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-label="Graph canvas" className="modeling-svg">
              <defs><pattern id="model-grid" x={-GRID_STEP / 2} y={-GRID_STEP / 2} width={GRID_STEP} height={GRID_STEP} patternUnits="userSpaceOnUse"><circle cx={GRID_STEP / 2} cy={GRID_STEP / 2} r=".8" className="modeling-grid-dot" /></pattern><marker id="model-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" /></marker></defs>
              <rect width={WIDTH} height={HEIGHT} fill="url(#model-grid)" pointerEvents="none" />
              {drawn.map(({ group, geometry, item, suffix }) => {
                  const reverse = group.from.id !== group.to.id && (item ? item.source === group.to.id : group.items.some(edge => edge.source === group.to.id));
                  const forward = !item || item.source === group.from.id;
                  return <path key={`${group.source}-${group.target}-${suffix}`} aria-hidden="true" className={`modeling-edge${group.from.id === group.to.id ? ' modeling-loop' : ''}`} d={geometry.path} markerStart={reverse ? 'url(#model-arrow)' : undefined} markerEnd={forward ? 'url(#model-arrow)' : undefined} />;
              })}
              {placed.map(({ group, item, suffix, text, badge, origin }) => {
                  const description = (item ? [item] : group.items).map(edge => `${nodes.find(node => node.id === edge.source)?.name} → ${edge.name} → ${nodes.find(node => node.id === edge.target)?.name}`).join('; ');
                  return <g key={`${group.source}-${group.target}-${suffix}`} role="img" aria-label={description}><title>{description}</title><line aria-hidden="true" className="modeling-badge-leader" x1={origin.x} y1={origin.y} x2={badge.x} y2={badge.y} /><g className="modeling-edge-badge" transform={`translate(${badge.x} ${badge.y})`}><rect x={-badge.width / 2} y={-12} width={badge.width} height={24} rx={5} /><text textAnchor="middle" dominantBaseline="central">{text}</text></g></g>;
              })}
              {preview && (() => {
                const from = nodes.find(node => node.id === preview.source);
                const to = nodes.find(node => node.id === preview.target);
                if (!from) return null;
                const end = to ?? preview.point;
                const dx = end.x - from.x, dy = end.y - from.y, length = Math.hypot(dx, dy) || 1;
                const start = { x: from.x + dx / length * RADIUS, y: from.y + dy / length * RADIUS };
                const tip = to && to.id !== from.id ? { x: to.x - dx / length * (RADIUS + 3), y: to.y - dy / length * (RADIUS + 3) } : end;
                return <g aria-hidden="true" className="modeling-preview"><line x1={start.x} y1={start.y} x2={tip.x} y2={tip.y} markerEnd="url(#model-arrow)" />{to && <circle cx={to.x} cy={to.y} r={RADIUS + 4} />}</g>;
              })()}
              {nodes.map(node => {
                const lines = labelLines(node.name);
                return <g key={node.id} className="modeling-node" role="group" tabIndex={0} aria-label={`${node.name}, node label. Use arrow keys to move.`} onKeyDown={event => moveByKeyboard(event, node)} onPointerDown={event => startDrag(event, node, (event.target as Element).classList.contains('modeling-node-ring') ? 'relationship' : 'node')} onPointerMove={dragNode} onPointerUp={finishDrag} onPointerCancel={event => { if (drag.current?.pointerId === event.pointerId) cancelDrag(); }} onLostPointerCapture={event => { if (drag.current?.pointerId === event.pointerId) cancelDrag(); }}>
                  <title>{node.name}</title><circle className="modeling-node-ring" cx={node.x} cy={node.y} r={RADIUS + 12} /><circle aria-hidden="true" className="modeling-node-ring-visible" cx={node.x} cy={node.y} r={RADIUS + 4} /><circle className="modeling-node-body" cx={node.x} cy={node.y} r={RADIUS} /><text textAnchor="middle" dominantBaseline="central">{lines.map((line, index) => <tspan key={index} x={node.x} y={node.y + (index - (lines.length - 1) / 2) * 14}>{line}</tspan>)}</text>
                </g>;
              })}
            </svg>
          </div>
        </div>
        </div>
        {groups.filter(group => !group.separate.length && (group.items.length > 1 || !group.geometry)).map(group => <details key={group.number} className="modeling-summary" open><summary>{group.geometry ? `Bundle ${group.number} · ${group.items.length} types` : 'Unrouted relationships'}: {group.from.name} {group.from.id === group.to.id ? '↻' : '↔'} {group.to.name}</summary><ul>{group.items.map(relationship => <li key={relationship.id}><strong>{nodes.find(node => node.id === relationship.source)?.name}</strong> → <strong>{relationship.name}</strong> → <strong>{nodes.find(node => node.id === relationship.target)?.name}</strong>{!group.geometry && <span className="modeling-unrouted"> — arrow not shown: no clear route</span>}</li>)}</ul></details>)}
      </div>
    </div>
    <div className="sr-only" role="status" aria-live="polite">{announcement}</div>
    {dialog === 'node' && <Dialog title="Add node label" subtitle="Name a label for your graph. Closing keeps your unfinished entry in this session." onClose={() => setDialog(null)}>
      <form className="modeling-form" onSubmit={addNode} noValidate>
        <label htmlFor="model-node-name">Label name</label>
        <input ref={nodeInput} id="model-node-name" data-dialog-initial-focus value={nodeName} onChange={event => changeNodeName(event.target)} placeholder="e.g. CustomerAccount" aria-describedby={`model-node-hint${nodeError ? ' model-node-error' : ''}`} aria-invalid={Boolean(nodeError)} />
        <p className="modeling-hint" id="model-node-hint">{nodeNameHint}</p>
        {nodeError && <p className="modeling-error" id="model-node-error" role="alert">{nodeError}</p>}
        <div className="dialog-actions"><div className="action-spacer" /><button className="button secondary" type="button" onClick={() => setDialog(null)}>Close</button><button className="button primary" type="submit">Add node label</button></div>
      </form>
    </Dialog>}
    {dialog === 'relationship' && <Dialog title="Add relationship" subtitle="Connect node labels in a direction, including a label to itself. Closing keeps your unfinished entry in this session." onClose={() => setDialog(null)}>
      <form className="modeling-form" onSubmit={addRelationship} noValidate>
        <label htmlFor="model-relationship-name">Relationship name</label>
        <input ref={relationshipInput} id="model-relationship-name" data-dialog-initial-focus value={relationshipName} onChange={event => changeRelationshipName(event.target)} placeholder="e.g. WORKS_AT" aria-describedby={`model-relationship-hint${relationshipError?.field === 'name' ? ' model-relationship-error' : ''}`} aria-invalid={relationshipError?.field === 'name'} />
        <p className="modeling-hint" id="model-relationship-hint">{relationshipNameHint}</p>
        <label htmlFor="model-source">From</label>
        <select ref={sourceInput} id="model-source" value={source} aria-invalid={relationshipError?.field === 'source'} aria-describedby={relationshipError?.field === 'source' ? 'model-relationship-error' : undefined} onChange={event => { setSource(event.target.value); if (relationshipError?.field === 'source') setRelationshipError(null); }}><option value="">Select source</option>{nodes.map(node => <option value={node.id} key={node.id}>{node.name}</option>)}</select>
        <label htmlFor="model-target">To</label>
        <select ref={targetInput} id="model-target" value={target} aria-invalid={relationshipError?.field === 'target'} aria-describedby={relationshipError?.field === 'target' ? 'model-relationship-error' : undefined} onChange={event => { setTarget(event.target.value); if (relationshipError?.field === 'target') setRelationshipError(null); }}><option value="">Select target</option>{nodes.map(node => <option value={node.id} key={node.id}>{node.name}</option>)}</select>
        {!nodes.length && <p className="modeling-hint">Add node labels before connecting them.</p>}
        {relationshipError && <p className="modeling-error" id="model-relationship-error" role="alert">{relationshipError.message}</p>}
        <div className="dialog-actions"><div className="action-spacer" /><button className="button secondary" type="button" onClick={() => setDialog(null)}>Close</button><button className="button primary" type="submit">Add relationship</button></div>
      </form>
    </Dialog>}
  </section>;
}
