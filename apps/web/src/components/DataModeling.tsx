import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type MouseEvent, type PointerEvent, type RefObject } from 'react';
import { Dialog } from './Dialog';
import { dialogControls } from './dialogFocus';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronDown, ChevronLeft, ChevronRight, CircleDashed, ExternalLink, Grid2X2, Link, Pencil, Plus, RotateCcw, X, ZoomIn, ZoomOut } from 'lucide-react';
import { Icon } from './Icon';
import { NodeNameChip, nodeNameFormat, type NodeNameDraft } from './NodeNameChip';
import { NodeProperties, hasPropertyDrafts, propertyRows, type PropertyRows } from './NodeProperties';
import { useModelPersistence } from './useModelPersistence';
import { useDetailsResize } from './useDetailsResize';
import { useReferenceCatalog, resolveReference } from './useReferenceCatalog';
import { ReferenceTargetFields } from './ReferenceTargetFields';
import { ReadOnlyReferenceDetails } from './ReadOnlyReferenceDetails';
import { edgeGeometry, nearestPlacement, routingBudget, segmentClear } from './modelingGeometry';
import type { DataClassification, ModelDefinition, ModelNode as NodeLabel, ModelRelationship as Relationship, ModelSummary, ReferenceClassification, RelationCardinality } from '../types';
import './DataModeling.css';

type Selection = { kind: 'node'; id: string } | { kind: 'relationship'; id: string } | { kind: 'bundle'; ids: string[] };

const WIDTH = 1000;
const HEIGHT = 600;
const RADIUS = 48;
const MIN_DISTANCE = 180;
const GRID_STEP = 20;
const classifications: DataClassification[] = ['Transactional', 'Master Data', 'Reference Data', 'Metadata'];
const cardinalities: RelationCardinality[] = ['0..*', '1..*', '1..1'];
const NODE_NAME_PATTERN = /^[A-Z][A-Za-z]*(?![\s\S])/;
const RELATIONSHIP_NAME_PATTERN = /^[A-Z]+(?:_[A-Z]+)*$/;
const nodeNameHint = 'Use up to 24 ASCII letters (e.g. CustomerAccount). The first letter is capitalized automatically. No numbers, spaces, or underscores.';
const relationshipNameHint = 'Use up to 24 ASCII letters, with single underscores between words (e.g. WORKS_AT). Each space becomes an underscore; remove consecutive, leading, or trailing underscores. No numbers.';
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const snap = (value: number, limit: number) => clamp(Math.round(value / GRID_STEP) * GRID_STEP, Math.ceil((RADIUS + 5) / GRID_STEP) * GRID_STEP, Math.min(100000, Math.floor((limit - RADIUS - 5) / GRID_STEP) * GRID_STEP));

type Point = { x: number; y: number };
type CanvasExtent = { width: number; height: number };
type EdgeGroup = { source: string; target: string; items: Relationship[] };
type Segment = { a: Point; b: Point };

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

function parallelGeometry(source: NodeLabel, target: NodeLabel, nodes: NodeLabel[], offset: number, extent: CanvasExtent) {
  const { width: WIDTH, height: HEIGHT } = extent;
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
function loopGeometry(node: NodeLabel, index: number, count: number, nodes: NodeLabel[], canvas: CanvasExtent) {
  const { width: WIDTH, height: HEIGHT } = canvas;
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

export type ModelNavigation = { canNavigate: () => boolean; openFromBrowser: (id: string) => Promise<boolean>; newFromBrowser: () => boolean; deleteFromBrowser: (model: ModelSummary) => Promise<boolean> };

export function DataModeling({ active, browserOpen, browseButton, onBrowse, dialog, setDialog, persistence, navigation, onSaved }: { active: boolean; browserOpen: boolean; browseButton: RefObject<HTMLButtonElement | null>; onBrowse: () => void; dialog: 'node' | 'relationship' | null; setDialog: (dialog: 'node' | 'relationship' | null) => void; persistence: ReturnType<typeof useModelPersistence>; navigation: RefObject<ModelNavigation | null>; onSaved: () => void }) {
  const { nodes, relationships, setNodes, setRelationships } = persistence;
  const editable = persistence.phase === 'ready' || persistence.phase === 'empty';
  const [dragging, setDragging] = useState(false);
  const [panning, setPanning] = useState(false);
  const pan = useRef<{ pointerId: number; element: HTMLDivElement; start: Point; scroll: Point; moved: boolean } | null>(null);
  // Follow the browser's click count, not a timer: a fresh detail=1 click
  // starts a valid sequence, while a pan's release cannot become half a dblclick.
  const panClick = useRef<{ release: boolean } | null>(null);
  const [naming, setNaming] = useState<'title' | 'create' | null>(null);
  const browserCreation = useRef(false);
  const creationConfirmed = useRef(false);
  const pendingAddition = useRef<{ kind: 'node' | 'relationship'; point?: Point } | null>(null);
  const [resumeAddition, setResumeAddition] = useState(false);
  const [modelName, setModelName] = useState('');
  const [modelNameError, setModelNameError] = useState('');
  const modelNameInput = useRef<HTMLInputElement>(null);
  const namingOrigin = useRef<HTMLElement | null>(null);
  const namingDirty = modelName !== (naming === 'title' && persistence.id !== null && persistence.id !== 'legacy' ? persistence.name : '');

  function cancelNaming() {
    if (!persistence.busy.current && (!namingDirty || window.confirm('Discard your unsaved changes?'))) closeNaming();
  }
  function closeNaming() {
    pendingAddition.current = null;
    setNaming(null);
  }
  const [nodeName, setNodeName] = useState('');
  const [nodeClassification, setNodeClassification] = useState<DataClassification | ReferenceClassification>('Transactional');
  const [referenceModel, setReferenceModel] = useState('');
  const [referenceNode, setReferenceNode] = useState('');
  const [nodeErrorField, setNodeErrorField] = useState<'name' | 'model' | 'node'>('name');
  const referenceModelInput = useRef<HTMLSelectElement>(null);
  const referenceNodeInput = useRef<HTMLSelectElement>(null);
  const referenceMode = nodeClassification === 'Internal Reference' || nodeClassification === 'External Reference';
  const catalog = useReferenceCatalog(nodes.some(node => node.kind === 'reference' && node.classification === 'External Reference'), persistence.hydration, dialog === 'node' && referenceMode);
  const resolutionFor = (node: Extract<NodeLabel, { kind: 'reference' }>) => resolveReference(node, persistence.id, persistence.name, nodes, catalog.models, catalog.stale, catalog.loaded, catalog.loading, catalog.error);
  const displayDraft = (node: NodeLabel) => node.kind === 'definition' ? node.draft : resolutionFor(node).definition?.draft;
  const [relationshipName, setRelationshipName] = useState('');
  const [source, setSource] = useState('');
  const [target, setTarget] = useState('');
  const [nodeError, setNodeError] = useState('');
  const [nameDrafts, setNameDrafts] = useState<Record<string, NodeNameDraft>>({});
  const [propertiesDrafts, setPropertiesDrafts] = useState<PropertyRows>({});
  const renameInput = useRef<HTMLInputElement>(null);
  const [relationshipError, setRelationshipError] = useState<{ field: 'name' | 'source' | 'target'; message: string } | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [selection, setSelection] = useState<Selection | null>(null);
  const selectionOrigin = useRef<SVGElement | HTMLElement | null>(null);
  const detailsRef = useRef<HTMLDialogElement>(null);
  const backdropGesture = useRef<{ pointerId: number; start: Point; moved: boolean; ended: boolean } | null>(null);
  const detailsHeading = useRef<HTMLHeadingElement>(null);
  const focusDetails = useRef(false);
  const restoringCanvasFocus = useRef(false);
  const [narrowDetails, setNarrowDetails] = useState(() => window.matchMedia('(max-width: 800px)').matches);
  const suppressGestureClick = useRef(false);
  const nextId = useRef(0);
  const svgRef = useRef<SVGSVGElement>(null);
  const regionRef = useRef<HTMLDivElement>(null);
  const [canvas, setCanvas] = useState({ width: WIDTH, height: HEIGHT, scale: 1, availableHeight: HEIGHT, originX: WIDTH, originY: HEIGHT });
  const { width: canvasWidth, height: canvasHeight } = canvas;
  const scrollRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [showGrid, setShowGrid] = useState(true);
  const view = useRef<{ scale: number; originX: number; originY: number; width: number; height: number; hydration: number } | null>(null);
  const displayScale = canvas.scale * zoom;
  const nodeInput = useRef<HTMLInputElement>(null);
  const nodePlacement = useRef<Point | null>(null);
  const [pendingConnection, setPendingConnection] = useState<string | null>(null);
  const relationshipInput = useRef<HTMLInputElement>(null);
  const sourceInput = useRef<HTMLSelectElement>(null);
  const targetInput = useRef<HTMLSelectElement>(null);
  const drag = useRef<{ kind: 'node' | 'relationship'; id: string; pointerId: number; element: SVGGElement; dx: number; dy: number; origin: Point; client: Point; startClient: Point; moved: boolean; leftSource: boolean; viewport: Point } | null>(null);
  const scrollFrame = useRef<number | null>(null);
  const keyboardMove = useRef<{ id: string; origin: Point; element: SVGGElement } | null>(null);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const [preview, setPreview] = useState<{ source: string; point: Point; target: string | null } | null>(null);
  const hasRenameDrafts = nodes.some(node => nameDrafts[node.id] && nameDrafts[node.id].value !== node.name);
  const hasDrafts = Boolean(nodeName || nodeClassification !== 'Transactional' || referenceModel || referenceNode || relationshipName || source || target || hasRenameDrafts || Object.values(propertiesDrafts).some(hasPropertyDrafts));
  const contentRow = useRef<HTMLDivElement>(null);
  const detailsResize = useDetailsResize(contentRow, active && Boolean(selection), Boolean(dialog || naming || browserOpen || dragging || panning || persistence.saving));

  useLayoutEffect(() => {
    if (!persistence.hydration) return;
    nextId.current = Math.max(-1, ...nodes.map(node => Number(node.id.slice(5))), ...relationships.map(item => Number(item.id.slice(13)))) + 1;
  }, [persistence.hydration]);

  function canNavigate(fromBrowser = false) {
    return (!browserOpen || fromBrowser) && !detailsResize.gesture.current && !drag.current && !pan.current && !persistence.busy.current && !dialog && !naming && !detailsRef.current?.matches(':modal');
  }

  function confirmSwitch() {
    return !(persistence.dirty || hasDrafts) || window.confirm('Open another model? This discards your unsaved graph changes and all unfinished property rows, node names, label name edits, and relationship names and endpoints, including closed drafts.');
  }

  function clearDrafts() {
    cancelPan(); cancelDrag(); detailsRef.current?.close(); setSelection(null);
    selectionOrigin.current = null; nodePlacement.current = null; setPendingConnection(null);
    setNodeName(''); setRelationshipName(''); setSource(''); setTarget('');
    setNodeClassification('Transactional'); setReferenceModel(''); setReferenceNode(''); setNodeErrorField('name');
    setNameDrafts({});
    setPropertiesDrafts({});
    setNodeError(''); setRelationshipError(null); setDialog(null);
  }

  async function openModel(id: string, fromBrowser = false) {
    if (!canNavigate(fromBrowser) || !confirmSwitch()) return false;
    const loaded = await persistence.load(id);
    if (!loaded) return false;
    clearDrafts(); setAnnouncement('Stored model loaded.');
    return true;
  }

  useLayoutEffect(() => {
    navigation.current = { canNavigate: () => canNavigate(), openFromBrowser: id => browserOpen ? openModel(id, true) : Promise.resolve(false), deleteFromBrowser: async model => {
      if (!browserOpen || !canNavigate(true) || !model.available || !model.deletable) return false;
      const current = model.id === persistence.id;
      if (!window.confirm(`Permanently delete “${model.name}” (${model.id})? Cannot be undone. References in other models will become unresolved.${current ? ' The current graph and ALL unfinished drafts will be lost.' : ''}`)) return false;
      if (!await persistence.deleteModel(model.id, model.revision)) return false;
      if (current) clearDrafts();
      if (nodes.some(node => node.kind === 'reference' && node.classification === 'External Reference')) void catalog.refresh();
      setAnnouncement(`Model ${model.name} permanently deleted.`);
      return true;
    }, newFromBrowser: () => {
      if (!browserOpen || !canNavigate(true)) return false;
      browserCreation.current = true;
      return true;
    } };
    return () => { navigation.current = null; };
  });

  useEffect(() => {
    if (browserOpen || !browserCreation.current) return;
    browserCreation.current = false;
    namingOrigin.current = browseButton.current;
    creationConfirmed.current = false;
    setModelName(''); setModelNameError(''); persistence.clearCreationError(); setNaming('create');
  }, [browserOpen]);

  useEffect(() => {
    if (!resumeAddition || naming || persistence.id === null) return;
    const intent = pendingAddition.current;
    pendingAddition.current = null;
    setResumeAddition(false);
    if (!intent) return;
    nodePlacement.current = intent.point ?? null;
    scrollRef.current?.focus({ preventScroll: true });
    setDialog(intent.kind);
  }, [resumeAddition, naming, persistence.id]);

  async function reloadStoredModel() {
    const id = persistence.conflict ? persistence.id : persistence.failedLoadId ?? persistence.id;
    if (id) await openModel(id);
  }

  function openNameDialog(mode: 'title' | 'create' = 'title') {
    if (!canNavigate() || !editable) return;
    namingOrigin.current = document.activeElement instanceof HTMLElement ? document.activeElement : browseButton.current;
    persistence.clearCreationError();
    creationConfirmed.current = false;
    setModelName(mode === 'title' && persistence.id !== null && persistence.id !== 'legacy' ? persistence.name : ''); setModelNameError(''); setNaming(mode);
  }

  function requestAddition(kind: 'node' | 'relationship', point?: Point) {
    if (!canNavigate() || !editable) return;
    if (persistence.id === null) {
      pendingAddition.current = { kind, point };
      openNameDialog('create');
    } else {
      nodePlacement.current = point ?? null; setPendingConnection(null); setDialog(kind);
    }
  }

  async function saveNamedModel(event: FormEvent) {
    event.preventDefault();
    if (persistence.busy.current) return;
    const name = modelName.trim();
    if (!name || [...name].length > 100 || /\p{Cc}/u.test(modelName)) {
      setModelNameError('Enter a model name of 1–100 characters without control characters.'); modelNameInput.current?.focus(); return;
    }
    if (naming === 'create') {
      if (!creationConfirmed.current && !confirmSwitch()) return;
      creationConfirmed.current = true;
      if (await persistence.create(name)) {
        clearDrafts(); setNaming(null); setModelName(''); onSaved(); setResumeAddition(true); setAnnouncement(`Model ${name} created.`);
      }
      return;
    }
    const renaming = persistence.id !== null && persistence.id !== 'legacy';
    if (await persistence.save(name, naming === 'title')) { setNaming(null); setModelName(''); onSaved(); setAnnouncement(renaming ? `Model title saved: ${name}.` : `Created ${name} in a new model file.`); }
  }

  async function saveCurrentModel() {
    if (!canNavigate()) return;
    if (persistence.id === null) return;
    if (await persistence.save()) { onSaved(); setAnnouncement('Model saved.'); }
  }

  function inspect(next: Selection, origin?: SVGElement | HTMLElement) {
    if (!active || dialog || naming || browserOpen || persistence.phase === 'loading' || detailsResize.gesture.current || drag.current || pan.current) return;
    renameInput.current?.blur();
    const internal = Boolean(origin && detailsRef.current?.contains(origin));
    if (origin && !internal) selectionOrigin.current = origin;
    focusDetails.current = internal;
    if (next.kind === 'node') {
      const node = nodesRef.current.find(node => node.id === next.id);
      if (node?.kind === 'definition') setPropertiesDrafts(current => current[next.id] ? current : { ...current, [next.id]: propertyRows(node.properties) });
    }
    setSelection(next);
    const name = next.kind === 'node' ? nodes.find(node => node.id === next.id)?.name
      : next.kind === 'relationship' ? relationships.find(item => item.id === next.id)?.name : `${next.ids.length} relationships`;
    setAnnouncement(`Details: ${name}.${internal || narrowDetails ? '' : ' Use Tab to reach the details panel.'}`);
  }

  function closeDetails() {
    if (detailsResize.gesture.current) return;
    renameInput.current?.blur();
    // Release native modal isolation before restoring focus outside the drawer.
    restoringCanvasFocus.current = true;
    detailsRef.current?.close();
    setSelection(null);
    setAnnouncement('Details closed.');
    if (selectionOrigin.current?.isConnected) selectionOrigin.current.focus({ preventScroll: true });
    else scrollRef.current?.focus({ preventScroll: true });
    restoringCanvasFocus.current = false;
  }

  function clearSelection() {
    if (!active || dialog || detailsResize.gesture.current || drag.current || !selection) return;
    renameInput.current?.blur();
    restoringCanvasFocus.current = true;
    detailsRef.current?.close();
    selectionOrigin.current = null;
    focusDetails.current = false;
    setSelection(null);
    setAnnouncement('Selection cleared.');
    // Native modal close can restore the selected node's focus. Keep pointer
    // deselection on the canvas instead of returning to that old selection.
    scrollRef.current?.focus({ preventScroll: true });
    restoringCanvasFocus.current = false;
  }

  function outsideDetails(event: MouseEvent<HTMLDialogElement> | PointerEvent<HTMLDialogElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return event.target === event.currentTarget && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom);
  }

  useEffect(() => {
    const query = window.matchMedia('(max-width: 800px)');
    const changed = () => setNarrowDetails(query.matches);
    query.addEventListener('change', changed);
    return () => query.removeEventListener('change', changed);
  }, []);

  useLayoutEffect(() => {
    const details = detailsRef.current;
    if (!details) return;
    if (!active) { details.close(); return; }
    // A creation dialog owns the top layer and Escape until it closes. Defer
    // breakpoint changes so the inspector never jumps above that native modal.
    if (dialog || naming || browserOpen) return;
    const modal = details.matches(':modal');
    if (!details.open || modal !== narrowDetails) {
      const previous = document.activeElement as HTMLElement | SVGElement | null;
      restoringCanvasFocus.current = true;
      details.close();
      if (narrowDetails) {
        cancelDrag();
        details.showModal();
        detailsHeading.current?.focus({ preventScroll: true });
      } else {
        details.show();
        // show() can autofocus; desktop opening must retain the user's focus.
        previous?.focus({ preventScroll: true });
      }
      restoringCanvasFocus.current = false;
    }
    if (focusDetails.current) {
      focusDetails.current = false;
      detailsHeading.current?.focus({ preventScroll: true });
    }
  }, [active, dialog, naming, browserOpen, narrowDetails, selection]);

  useEffect(() => {
    if (!active || !selection) return;
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || dialog || naming || browserOpen || drag.current || pan.current || event.defaultPrevented) return;
      if (event.target === renameInput.current) return;
      if (event.target instanceof Element && event.target.closest('[data-property-editor]')) return;
      event.preventDefault();
      closeDetails();
    };
    // Capture sees an active drag before its window handler cancels it.
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  }, [active, dialog, naming, browserOpen, selection]);

  function cancelDrag(restore = true, update = true) {
    keyboardMove.current = null;
    const current = drag.current;
    drag.current = null;
    if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = null;
    if (update) {
      setDragging(false);
      setPreview(null);
      if (restore && current?.kind === 'node') setNodes(nodes => nodes.map(node => node.id === current.id ? { ...node, ...current.origin } : node));
    }
    if (current?.element.hasPointerCapture(current.pointerId)) current.element.releasePointerCapture(current.pointerId);
  }

  function cancelPan(restore = true, update = true) {
    const current = pan.current;
    pan.current = null;
    if (update) setPanning(false);
    if (!current) return;
    if (current.moved) panClick.current = { release: true };
    if (restore) {
      current.element.scrollLeft = current.scroll.x;
      current.element.scrollTop = current.scroll.y;
    }
    if (current.element.hasPointerCapture(current.pointerId)) current.element.releasePointerCapture(current.pointerId);
  }

  function startPan(event: PointerEvent<HTMLDivElement>) {
    if (pan.current && pan.current.pointerId !== event.pointerId) { cancelPan(); return; }
    if (!active || !canNavigate() || event.button !== 0 || !event.isPrimary) return;
    // Only the HTML gutter and bare SVG are navigation surfaces.
    if (event.target !== event.currentTarget && event.target !== svgRef.current
      && !(event.target instanceof Element && event.target.classList.contains('modeling-canvas'))) return;
    const element = event.currentTarget;
    pan.current = { pointerId: event.pointerId, element, start: { x: event.clientX, y: event.clientY }, scroll: { x: element.scrollLeft, y: element.scrollTop }, moved: false };
  }

  function movePan(event: PointerEvent<HTMLDivElement>) {
    const current = pan.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const dx = event.clientX - current.start.x, dy = event.clientY - current.start.y;
    if (!current.moved && Math.hypot(dx, dy) < 5) return;
    if (!current.moved) { current.moved = true; current.element.setPointerCapture(event.pointerId); setPanning(true); }
    event.preventDefault();
    current.element.scrollLeft = current.scroll.x - dx;
    current.element.scrollTop = current.scroll.y - dy;
  }

  function finishPan(event: PointerEvent<HTMLDivElement>) {
    if (pan.current?.pointerId !== event.pointerId) return;
    movePan(event);
    cancelPan(false);
  }

  useLayoutEffect(() => {
    if (!active || dialog || naming || browserOpen) { cancelPan(); cancelDrag(); }
    if (!active || dialog !== 'node') nodePlacement.current = null;
    if (!active || dialog !== 'node') setPendingConnection(null);
  }, [active, dialog, naming, browserOpen]);

  function revealNode(element: SVGElement) {
    const scroll = scrollRef.current;
    const focusShape = element.querySelector('.modeling-node-ring-visible') ?? element;
    const ring = focusShape.getBoundingClientRect();
    if (!scroll) return;
    const bounds = scroll.getBoundingClientRect();
    const inspector = detailsRef.current;
    const right = inspector?.open && !inspector.matches(':modal')
      ? Math.min(bounds.right, inspector.getBoundingClientRect().left) : bounds.right;
    const visibleWidth = Math.max(0, right - bounds.left);
    const delta = (start: number, end: number, viewportStart: number, size: number) =>
      end - start + 6 > size ? (start + end) / 2 - viewportStart - size / 2
        : start - 3 < viewportStart ? start - 3 - viewportStart
        : end + 3 > viewportStart + size ? end + 3 - viewportStart - size : 0;
    const dx = delta(ring.left, ring.right, bounds.left, visibleWidth);
    const dy = delta(ring.top, ring.bottom, bounds.top, scroll.clientHeight);
    scroll.scrollLeft += dx;
    scroll.scrollTop += dy;
    for (const overlay of [controlsRef.current, regionRef.current?.querySelector('.modeling-bundles')]) {
      const visible = focusShape.getBoundingClientRect();
      const toolbar = overlay?.getBoundingClientRect();
      if (!toolbar || visible.right + 3 <= toolbar.left || visible.left - 3 >= toolbar.right
        || visible.bottom + 3 <= toolbar.top || visible.top - 3 >= toolbar.bottom) continue;
      // Reveal above an overlay, or beside it on very short viewports. Only
      // scroll the viewport; world coordinates and canvas geometry stay intact.
      const above = Math.max(0, toolbar.top - 3 - bounds.top);
      const beside = Math.max(0, right - toolbar.right - 3);
      if (Math.min(beside, visible.width) * Math.min(scroll.clientHeight, visible.height)
        > Math.min(above, visible.height) * Math.min(visibleWidth, visible.width)) {
        scroll.scrollLeft -= toolbar.right + 3 - visible.left;
        if (visible.height + 6 > scroll.clientHeight) {
          scroll.scrollTop += (visible.top + visible.bottom) / 2 - (bounds.top + scroll.clientHeight / 2);
        }
      } else {
        scroll.scrollTop += visible.bottom + 3 - toolbar.top;
      }
    }
  }

  useLayoutEffect(() => {
    const focused = document.activeElement;
    if (active && !dialog && !naming && !browserOpen && !narrowDetails && !restoringCanvasFocus.current && !drag.current && !pan.current && !detailsResize.gesture.current
      && focused instanceof SVGElement && svgRef.current?.contains(focused) && focused.matches('[role="button"]:focus-visible')) revealNode(focused);
  }, [active, dialog, naming, browserOpen, narrowDetails, selection, detailsResize.width]);

  useLayoutEffect(() => {
    const request = keyboardMove.current;
    keyboardMove.current = null;
    const scroll = scrollRef.current;
    const node = request && nodes.find(node => node.id === request.id);
    if (!request || !scroll || !node || !active || dialog || document.activeElement !== request.element
      || (node.x === request.origin.x && node.y === request.origin.y)) return;
    revealNode(request.element);
  }, [nodes, active, dialog]);

  useLayoutEffect(() => {
    const region = regionRef.current;
    if (!active || !region) return;
    let extent = { width: WIDTH, height: HEIGHT };
    const measure = () => {
      const { width, height } = region.getBoundingClientRect();
      if (!width || !height) return;
      cancelPan(); cancelDrag();
      // Extend the world instead of stretching it. Preserve existing coordinates
      // on shrink; constrained screens scroll at a readable minimum scale.
      const requiredWidth = Math.max(WIDTH, ...nodesRef.current.map(node => node.x + RADIUS + 24));
      const requiredHeight = Math.max(HEIGHT, ...nodesRef.current.map(node => node.y + RADIUS + 24));
      const scale = Math.max(.68, Math.min(width / requiredWidth, height / requiredHeight));
      extent = { width: Math.max(extent.width, requiredWidth, width / scale), height: Math.max(extent.height, requiredHeight, height / scale) };
      setCanvas({ ...extent, scale, availableHeight: height, originX: width, originY: height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(region);
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); cancelPan(); cancelDrag(); };
  }, [active, persistence.hydration]);

  function changeZoom(next: number) {
    const scroll = scrollRef.current;
    if (!active || !scroll || !canNavigate()) return;
    const value = clamp(next, .5, 2);
    if (value === zoom) return;
    setZoom(value);
  }

  useLayoutEffect(() => {
    const scroll = scrollRef.current, previous = view.current;
    if (!active || !scroll) return;
    if (!previous || previous.hydration !== persistence.hydration) {
      scroll.scrollLeft = canvas.originX;
      scroll.scrollTop = canvas.originY;
      panClick.current = null;
    } else {
      scroll.scrollLeft = canvas.originX + (scroll.scrollLeft + previous.width / 2 - previous.originX) / previous.scale * displayScale - scroll.clientWidth / 2;
      scroll.scrollTop = canvas.originY + (scroll.scrollTop + previous.height / 2 - previous.originY) / previous.scale * displayScale - scroll.clientHeight / 2;
    }
    view.current = { scale: displayScale, originX: canvas.originX, originY: canvas.originY, width: scroll.clientWidth, height: scroll.clientHeight, hydration: persistence.hydration };
  }, [active, canvas, zoom, persistence.hydration]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && pan.current) { event.preventDefault(); cancelPan(); return; }
      if (event.key === 'Escape' && drag.current) {
        event.preventDefault();
        cancelDrag();
      }
    };
    const endPendingPan = (event: globalThis.PointerEvent) => {
      if (pan.current?.pointerId === event.pointerId) cancelPan(event.type === 'pointercancel');
    };
    const extraPointer = (event: globalThis.PointerEvent) => {
      if (pan.current && pan.current.pointerId !== event.pointerId) cancelPan();
      if (drag.current && drag.current.pointerId !== event.pointerId) cancelDrag();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerup', endPendingPan);
    window.addEventListener('pointercancel', endPendingPan);
    window.addEventListener('pointerdown', extraPointer, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerup', endPendingPan);
      window.removeEventListener('pointercancel', endPendingPan);
      window.removeEventListener('pointerdown', extraPointer, true);
      cancelPan(false, false); cancelDrag(false, false);
    };
  }, []);

  useEffect(() => {
    const surface = scrollRef.current;
    if (!surface) return;
    // SVG shapes do not consistently honor touch-action in Chromium. Cancel
    // native panning only for a touch that started a node or ring gesture.
    const preventDragScroll = (event: TouchEvent) => { if ((drag.current || pan.current) && event.cancelable) event.preventDefault(); };
    surface.addEventListener('touchmove', preventDragScroll, { passive: false });
    return () => surface.removeEventListener('touchmove', preventDragScroll);
  }, []);

  useEffect(() => {
    if (!persistence.dirty && !hasDrafts) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [persistence.hydration, persistence.dirty, persistence.id, hasDrafts]);

  function addNode(event: FormEvent) {
    event.preventDefault();
    if (!active || !editable || persistence.id === null || dialog !== 'node') return;
    if (nodes.length >= 200 || !Number.isSafeInteger(nextId.current)) { setNodeError('The model has reached its node or ID limit.'); return; }
    const name = nodeName;
    setNodeErrorField('name');
    if (!NODE_NAME_PATTERN.test(name) || name.length > 24) { setNodeError(name ? nodeNameHint : 'Enter a node label name.'); nodeInput.current?.focus(); return; }
    if (nodes.some(node => node.name === name)) { setNodeError('A node label with this name already exists.'); nodeInput.current?.focus(); return; }
    if (referenceMode) {
      if (nodeClassification === 'External Reference' && (!referenceModel || referenceModel === persistence.id || !catalog.models.some(model => model.id === referenceModel && model.available))) {
        setNodeErrorField('model'); setNodeError('Select an available target model.'); referenceModelInput.current?.focus(); return;
      }
      const available = nodeClassification === 'Internal Reference'
        ? nodes.some(node => node.kind === 'definition' && node.id === referenceNode)
        : !catalog.error && catalog.models.some(model => model.id === referenceModel && model.available && model.definitions.some(node => node.id === referenceNode));
      if (!available) { setNodeErrorField('node'); setNodeError(catalog.error && nodeClassification === 'External Reference' ? 'Refresh targets before adding this reference.' : 'Select an available target definition.'); referenceNodeInput.current?.focus(); return; }
    }
    // Keep circles distinct, including when a starting slot is already occupied.
    const slots = Array.from({ length: 15 }, (_, i) => ({ x: snap(110 + (i % 5) * 190, canvasWidth), y: snap(110 + Math.floor(i / 5) * 190, canvasHeight) }));
    const requested = nodePlacement.current;
    // Toolbar/keyboard Add keeps its existing default starting slots.
    const placement = requested ? nearestPlacement(requested, nodes, { width: canvasWidth, height: canvasHeight }) : null;
    const position = placement ? placement.position : slots.find(slot => nodes.every(node => Math.hypot(node.x - slot.x, node.y - slot.y) >= MIN_DISTANCE));
    if (!position) { setNodeError(placement?.limited ? 'The nearby placement search reached its limit. Choose a clearer canvas position or move labels apart, then try again. Your name is kept.' : 'No free starting position. Move labels apart to make room, then try again. Your name is kept.'); nodeInput.current?.focus(); return; }
    const id = `node-${nextId.current++}`;
    const node: NodeLabel = referenceMode
      ? { kind: 'reference', id, name, ...position, classification: nodeClassification as ReferenceClassification, target: { modelId: nodeClassification === 'Internal Reference' ? persistence.id : referenceModel, nodeId: referenceNode } }
      : { kind: 'definition', id, name, ...position, classification: nodeClassification as DataClassification, draft: false, properties: [] };
    setNodes(current => [...current, node]);
    setNodeClassification('Transactional'); setReferenceModel(''); setReferenceNode('');
    setNodeName(''); setNodeError(''); setAnnouncement(`Node label ${name} added.`);
    nodePlacement.current = null;
    if (pendingConnection) {
      setRelationshipName(''); setSource(pendingConnection); setTarget(id); setRelationshipError(null);
      setPendingConnection(null);
      setAnnouncement(`Node label ${name} added. Name its relationship next; closing keeps the node and relationship draft.`);
      setDialog('relationship');
    } else setDialog(null);
  }

  function addRelationship(event: FormEvent) {
    event.preventDefault();
    if (!active || !editable || persistence.id === null || dialog !== 'relationship') return;
    if (relationships.length >= 1000 || !Number.isSafeInteger(nextId.current)) { setRelationshipError({ field: 'name', message: 'The model has reached its relationship or ID limit.' }); return; }
    const name = relationshipName;
    if (!RELATIONSHIP_NAME_PATTERN.test(name) || name.length > 24) { setRelationshipError({ field: 'name', message: name ? relationshipNameHint : 'Enter a relationship name.' }); relationshipInput.current?.focus(); return; }
    if (!nodes.some(node => node.id === source)) { setRelationshipError({ field: 'source', message: 'Select a source node label.' }); sourceInput.current?.focus(); return; }
    if (!nodes.some(node => node.id === target)) { setRelationshipError({ field: 'target', message: 'Select a target node label.' }); targetInput.current?.focus(); return; }
    if (relationships.some(item => item.source === source && item.target === target && item.name === name)) {
      setRelationshipError({ field: 'name', message: 'This directed relationship already exists.' }); relationshipInput.current?.focus(); return;
    }
    const id = `relationship-${nextId.current++}`;
    setRelationships(current => [...current, { id, name, source, target, sourceCardinality: '0..*', targetCardinality: '0..*' }]);
    setRelationshipName(''); setSource(''); setTarget(''); setRelationshipError(null); setAnnouncement(`Relationship ${name} added.`); setDialog(null);
  }

  function normalizedNodeName(input: HTMLInputElement) {
    const start = input.selectionStart, end = input.selectionEnd, direction = input.selectionDirection;
    const next = input.value.replace(/^[a-z]/, character => character.toUpperCase());
    if (input.value !== next) {
      input.value = next;
      if (start !== null && end !== null) input.setSelectionRange(start, end, direction ?? undefined);
    }
    return next;
  }

  function changeNodeName(input: HTMLInputElement) {
    setNodeName(normalizedNodeName(input));
    setNodeError('');
  }

  function commitNodeName(id: string, value: string) {
    if (!active || !editable) return 'Label names cannot be edited right now.';
    const node = nodesRef.current.find(node => node.id === id);
    if (!node) return 'This node label is no longer available.';
    const name = value.replace(/^[a-z]/, character => character.toUpperCase());
    const error = !NODE_NAME_PATTERN.test(name) || name.length > 24
      ? name ? 'Use 1–24 ASCII letters, without spaces, numbers, or underscores.' : 'Enter a node label name.'
      : nodesRef.current.some(other => other.id !== id && other.name === name) ? 'A node label with this name already exists.' : '';
    if (error) return error;
    if (name !== node.name) setNodes(current => current.some(other => other.id !== id && other.name === name) ? current : current.map(other => other.id === id ? { ...other, name } : other));
    setNameDrafts(current => ({ ...current, [id]: { value: name, error: '' } }));
    return '';
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

  function updateNodeMetadata(changes: Partial<Pick<ModelDefinition, 'classification' | 'draft'>>) {
    if (!active || !editable || selectedNode?.kind !== 'definition') return;
    setNodes(current => current.map(node => node.id === selectedNode.id && node.kind === 'definition' ? { ...node, ...changes } : node));
  }

  function updateRelationshipCardinality(id: string, end: 'sourceCardinality' | 'targetCardinality', value: RelationCardinality) {
    if (!active || !editable || persistence.phase !== 'ready') return;
    setRelationships(current => current.map(relationship => relationship.id === id ? { ...relationship, [end]: value } : relationship));
  }

  function nodePosition(current: NodeLabel[], id: string, x: number, y: number) {
    const position = { x: snap(x, canvasWidth), y: snap(y, canvasHeight) };
    return current.some(node => node.id !== id && Math.hypot(node.x - position.x, node.y - position.y) < MIN_DISTANCE) ? null : position;
  }

  function moveNode(id: string, x: number, y: number) {
    if (!editable) return;
    setNodes(current => {
      const position = nodePosition(current, id, x, y);
      if (!position || current.some(node => node.id === id && node.x === position.x && node.y === position.y)) return current;
      return current.map(node => node.id === id ? { ...node, ...position } : node);
    });
  }

  function moveSelectedNode(dx: number, dy: number, largeStep: boolean) {
    if (!active || !editable || !selectedNode || dialog || naming || browserOpen || persistence.busy.current || drag.current || pan.current || detailsResize.gesture.current) return;
    const node = nodesRef.current.find(node => node.id === selectedNode.id);
    if (!node) return;
    const step = GRID_STEP * (largeStep ? 4 : 1);
    const position = nodePosition(nodesRef.current, node.id, node.x + dx * step, node.y + dy * step);
    if (!position) { setAnnouncement('Move blocked: another node is too close.'); return; }
    if (position.x === node.x && position.y === node.y) { setAnnouncement('Move blocked: canvas boundary.'); return; }
    moveNode(node.id, position.x, position.y);
    setAnnouncement(`${node.name} position: ${position.x}, ${position.y}.`);
  }

  function point(client: Point) {
    const svg = svgRef.current;
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return null;
    const p = svg.createSVGPoint(); p.x = client.x; p.y = client.y;
    return p.matrixTransform(matrix.inverse());
  }

  function addNodeAtCanvas(event: MouseEvent<SVGSVGElement>) {
    if (!active || !editable || !canNavigate() || panClick.current || event.button !== 0 || event.target !== event.currentTarget) return;
    const p = point({ x: event.clientX, y: event.clientY });
    if (!p || p.x < 0 || p.x > canvasWidth || p.y < 0 || p.y > canvasHeight) return;
    // Give the existing dialog a stable, keyboard-accessible return target.
    scrollRef.current?.focus({ preventScroll: true });
    requestAddition('node', { x: snap(p.x, canvasWidth), y: snap(p.y, canvasHeight) });
  }

  function startDrag(event: PointerEvent<SVGGElement>, node: NodeLabel, kind: 'node' | 'relationship') {
    if (!active || !editable || !canNavigate() || event.button !== 0 || !event.isPrimary) return;
    keyboardMove.current = null;
    const client = { x: event.clientX, y: event.clientY };
    const p = point(client);
    if (!p) return;
    restoringCanvasFocus.current = true;
    event.currentTarget.focus({ preventScroll: true });
    restoringCanvasFocus.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
    suppressGestureClick.current = true;
    drag.current = { kind, id: node.id, pointerId: event.pointerId, element: event.currentTarget, dx: node.x - p.x, dy: node.y - p.y, origin: { x: node.x, y: node.y }, client, startClient: client, moved: false, leftSource: false, viewport: { x: window.innerWidth, y: window.innerHeight } };
    setDragging(true);
    if (kind === 'relationship') setPreview({ source: node.id, point: p, target: null });
  }

  function targetAt(p: Point, current: NonNullable<typeof drag.current>) {
    const bounds = scrollRef.current?.getBoundingClientRect();
    if (!bounds || current.client.x < bounds.left || current.client.x > bounds.right || current.client.y < bounds.top || current.client.y > bounds.bottom) return null;
    if (p.x < 0 || p.x > canvasWidth || p.y < 0 || p.y > canvasHeight) return null;
    const origin = nodesRef.current.find(node => node.id === current.id);
    if (origin && Math.hypot(p.x - origin.x, p.y - origin.y) > RADIUS + 22) current.leftSource = true;
    return nodesRef.current.find(node => (node.id !== current.id || current.leftSource) && Math.hypot(p.x - node.x, p.y - node.y) <= RADIUS + 12) ?? null;
  }

  function updatePreview(current: NonNullable<typeof drag.current>) {
    const p = point(current.client);
    if (p) setPreview({ source: current.id, point: { x: clamp(p.x, 0, canvasWidth), y: clamp(p.y, 0, canvasHeight) }, target: targetAt(p, current)?.id ?? null });
  }

  function startEdgeScroll() {
    if (scrollFrame.current !== null) return;
    let lastTime: number | null = null;
    let remainderX = 0, remainderY = 0;
    const tick = (time: number) => {
      scrollFrame.current = null;
      const current = drag.current, scroll = scrollRef.current;
      if (!current || !scroll) return;
      const bounds = scroll.getBoundingClientRect();
      if (current.client.x < bounds.left || current.client.x > bounds.right || current.client.y < bounds.top || current.client.y > bounds.bottom) return;
      const speedAt = (position: number, start: number, size: number, offset: number, maximum: number) => {
        const edge = Math.min(48, size / 4);
        const speed = position < start + edge ? -clamp((start + edge - position) / edge, 0, 1)
          : position > start + size - edge ? clamp((position - start - size + edge) / edge, 0, 1) : 0;
        return (speed < 0 && offset <= 0) || (speed > 0 && offset >= maximum) ? 0 : speed;
      };
      const speedX = speedAt(current.client.x, bounds.left, bounds.width, scroll.scrollLeft, scroll.scrollWidth - scroll.clientWidth);
      const speedY = speedAt(current.client.y, bounds.top, bounds.height, scroll.scrollTop, scroll.scrollHeight - scroll.clientHeight);
      if (!speedX && !speedY) return;
      const elapsed = lastTime === null ? 0 : Math.min(time - lastTime, 40);
      lastTime = time;
      remainderX += speedX * 300 * elapsed / 1000;
      remainderY += speedY * 300 * elapsed / 1000;
      scroll.scrollLeft += Math.trunc(remainderX);
      scroll.scrollTop += Math.trunc(remainderY);
      remainderX -= Math.trunc(remainderX);
      remainderY -= Math.trunc(remainderY);
      if (current.kind === 'relationship') updatePreview(current);
      else {
        const p = point(current.client);
        if (p) moveNode(current.id, p.x + current.dx, p.y + current.dy);
      }
      scrollFrame.current = requestAnimationFrame(tick);
    };
    scrollFrame.current = requestAnimationFrame(tick);
  }

  function dragNode(event: PointerEvent<SVGGElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    current.client = { x: event.clientX, y: event.clientY };
    if (Math.hypot(current.client.x - current.startClient.x, current.client.y - current.startClient.y) >= 5) current.moved = true;
    if (!current.moved) return;
    const p = point(current.client);
    if (!p) return;
    if (current.kind === 'node') moveNode(current.id, p.x + current.dx, p.y + current.dy);
    else updatePreview(current);
    startEdgeScroll();
  }

  function finishDrag(event: PointerEvent<SVGGElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    // Pointer-up can arrive before ResizeObserver/the resize event is delivered.
    if (current.viewport.x !== window.innerWidth || current.viewport.y !== window.innerHeight) { cancelDrag(); return; }
    current.client = { x: event.clientX, y: event.clientY };
    if (Math.hypot(current.client.x - current.startClient.x, current.client.y - current.startClient.y) >= 5) current.moved = true;
    if (!current.moved) {
      // Clear capture before selection. No synthetic click handler can reopen
      // details after a completed, rejected, escaped, or canceled drag.
      cancelDrag(false);
      if (current.kind === 'node') inspect({ kind: 'node', id: current.id }, current.element);
      return;
    }
    const p = point(current.client);
    // Pointer capture retargets event.target to the source. Inspect the visible
    // element underneath instead, so overlays and graph hit areas aren't blank.
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    const destination = current.kind === 'relationship' && p && hit?.closest('.modeling-node') && svgRef.current?.contains(hit) ? targetAt(p, current) : null;
    const emptyCanvas = current.kind === 'relationship' && p && hit === svgRef.current
      && p.x >= 0 && p.x <= canvasWidth && p.y >= 0 && p.y <= canvasHeight;
    cancelDrag(false);
    if (!active || dialog || (!destination && !(emptyCanvas && current.leftSource))) return;
    if ((relationshipName || source || target) && !window.confirm('Replace the unfinished relationship draft with these endpoints? The draft name and selections will be cleared.')) return;
    if (destination) {
      setRelationshipName(''); setSource(current.id); setTarget(destination.id); setRelationshipError(null);
      setDialog('relationship');
    } else if (p) {
      // Keep both unfinished names until a valid node submit. Closing this dialog
      // cancels only the pending connection and placement, not either draft.
      nodePlacement.current = { x: snap(p.x, canvasWidth), y: snap(p.y, canvasHeight) };
      setPendingConnection(current.id);
      setDialog('node');
    }
  }

  function closeNodeDialog() {
    nodePlacement.current = null;
    setPendingConnection(null);
    setDialog(null);
  }

  function moveByKeyboard(event: KeyboardEvent<SVGGElement>, node: NodeLabel) {
    if (!editable || detailsResize.gesture.current || drag.current || pan.current || (narrowDetails && selection)) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      inspect({ kind: 'node', id: node.id }, event.currentTarget);
      return;
    }
    const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    const step = GRID_STEP * (event.shiftKey ? 4 : 1);
    keyboardMove.current = { id: node.id, origin: { x: node.x, y: node.y }, element: event.currentTarget };
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
    const budget = routingBudget();
    return grouped.map((group, index) => {
      const from = nodes.find(node => node.id === group.source)!;
      const to = nodes.find(node => node.id === group.target)!;
      const geometry = from.id === to.id ? loopGeometry(from, 0, 1, nodes, canvas) : edgeGeometry(from, to, nodes, canvas, routes, budget);
      const separate = group.items.length > 1 && group.items.length <= 3
        ? group.items.map((item, itemIndex) => {
          if (from.id === to.id) return loopGeometry(from, itemIndex, group.items.length, nodes, canvas);
          const offset = (itemIndex - (group.items.length - 1) / 2) * 100;
          return parallelGeometry(from, to, nodes, offset, canvas);
        }) : [];
      if (geometry && 'segments' in geometry) routes.push(...geometry.segments);
      return { ...group, number: index + 1, from, to, geometry, separate: separate.length && separate.every(Boolean) ? separate : [] };
    });
  }, [nodes, relationships, canvas]);
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
      return { x: clamp(origin.x, width / 2 + 2, canvasWidth - width / 2 - 2), y: clamp(origin.y + shift, 13, canvasHeight - 13), width };
    });
    const badge = candidates.find(candidate => badges.every(other => Math.abs(candidate.x - other.x) >= (candidate.width + other.width) / 2 + 6 || Math.abs(candidate.y - other.y) >= 28) && nodes.every(node => Math.hypot(Math.max(0, Math.abs(candidate.x - node.x) - candidate.width / 2), Math.max(0, Math.abs(candidate.y - node.y) - 12)) >= RADIUS + 8)) ?? candidates[0];
    badges.push(badge);
    return { ...edge, text, badge, origin };
  });

  const selectedNode = selection?.kind === 'node' ? nodes.find(node => node.id === selection.id) : null;
  const selectedRelationship = selection?.kind === 'relationship' ? relationships.find(item => item.id === selection.id) : null;
  const nodeNameFor = (id: string) => nodes.find(node => node.id === id)?.name ?? 'Unknown node';
  const edgeSelected = (items: Relationship[]) => selection?.kind === 'relationship' ? items.some(item => item.id === selection.id)
    : selection?.kind === 'bundle' ? items.some(item => selection.ids.includes(item.id)) : false;
  const edgeSelection = (items: Relationship[]): Selection => items.length === 1 ? { kind: 'relationship', id: items[0].id } : { kind: 'bundle', ids: items.map(item => item.id) };
  const edgeDescription = (items: Relationship[]) => items.map(item => `${nodeNameFor(item.source)} → ${item.name} → ${nodeNameFor(item.target)}`).join('; ');
  function relationshipList(items: Relationship[]) {
    return <ul className="modeling-detail-list">{items.map(item => <li key={item.id}><button type="button" aria-pressed={selection?.kind === 'relationship' && selection.id === item.id} onClick={event => inspect({ kind: 'relationship', id: item.id }, event.currentTarget)}><strong>{item.name}</strong><span>{nodeNameFor(item.source)} → {nodeNameFor(item.target)}{item.source === item.target ? ' (self-loop)' : ''}</span></button></li>)}</ul>;
  }

  const persistenceStatus = persistence.phase === 'loading' ? 'Loading model…'
    : persistence.phase === 'unavailable' ? 'Model unavailable · editing blocked'
      : persistence.creating ? 'Creating model…' : persistence.saving ? 'Saving model…' : persistence.id === null ? ''
        : persistence.dirty ? 'Unsaved model changes' : '';
  const draftStatus = editable && hasDrafts ? 'Unfinished form drafts are not saved.' : '';

  const navigating = dragging || panning || detailsResize.resizing;
  return <section className={`modeling${detailsResize.resizing ? ' modeling-resizing' : ''}`} aria-labelledby="modeling-title" onPointerDownCapture={event => {
    suppressGestureClick.current = false;
    if (panClick.current) panClick.current.release = false;
    if (!event.isPrimary) { cancelPan(); cancelDrag(); }
  }} onDoubleClickCapture={event => {
    if (panClick.current) { panClick.current = null; event.preventDefault(); event.stopPropagation(); }
  }} onMouseDownCapture={event => {
    // Compatibility mouse events after touch must not move focus underneath
    // the finger when opening a modal drawer changed the hit target.
    if (suppressGestureClick.current) event.preventDefault();
  }} onClickCapture={event => {
    if (panClick.current && event.detail > 0) {
      if (panClick.current.release || event.detail > 1) {
        panClick.current.release = false;
        event.preventDefault(); event.stopPropagation(); return;
      }
      panClick.current = null;
    }
    // Touch can synthesize its click over the newly opened drawer rather than
    // the captured SVG node. Consume it before it activates a relationship row.
    if (suppressGestureClick.current && event.detail > 0) {
      suppressGestureClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    }
  }}>
    <header className="workspace-header"><div className="modeling-title-group" data-no-model={persistence.id === null}><div className="modeling-title-chip"><h1 id="modeling-title" title={persistence.name || undefined}>{persistence.id === null ? 'Data Modeling' : persistence.name}</h1></div>{persistence.id !== null && <button className="modeling-title-edit" type="button" aria-label="Edit model title" disabled={!editable || persistence.saving || navigating} onClick={() => openNameDialog('title')}><Icon icon={Pencil} /></button>}</div><div className="modeling-actions">
      <button ref={browseButton} className="button primary" aria-haspopup="dialog" disabled={Boolean(dialog || naming || browserOpen || persistence.saving || navigating || persistence.phase === 'loading')} onClick={() => { if (canNavigate()) onBrowse(); }}>All Models</button>
      <button className="button secondary" disabled={!editable || navigating} onClick={() => requestAddition('node')}><Icon icon={Plus} /> Add node label</button>
      <button className="button secondary" disabled={!editable || navigating} onClick={() => requestAddition('relationship')}><Icon icon={Plus} /> Add relationship</button>
      <button className="button secondary" disabled={!editable || persistence.id === null || !persistence.dirty || persistence.saving || persistence.conflict || navigating} onClick={() => void saveCurrentModel()}>Save model</button>
    </div></header>
    {(persistence.error || persistence.phase === 'unavailable' || persistence.failedLoadId || persistence.conflict) && <div className="modeling-persistence">
      {persistence.error && <p className="modeling-error" role="alert">{persistence.error}</p>}
      {(persistence.phase === 'unavailable' || persistence.failedLoadId || persistence.conflict) && <button className="text-button" disabled={persistence.saving || navigating} onClick={() => void reloadStoredModel()}>{persistence.conflict ? 'Reload stored model' : 'Retry loading model'}</button>}
    </div>}
    <div className="modeling-layout">
      <div className="modeling-stage" style={{ '--modeling-canvas-height': `${canvas.availableHeight}px` } as CSSProperties}>
        <div className="modeling-stage-heading"><div className="modeling-stage-title"><h2>Graph canvas</h2><p className="modeling-status" role="status" aria-live="polite" title={[persistenceStatus, draftStatus].filter(Boolean).join(' · ')}>{[persistenceStatus, draftStatus].filter(Boolean).join(' · ')}</p></div><span>{nodes.length} nodes · {relationships.length} relationships</span><details className="modeling-help"><summary>Canvas help</summary><p tabIndex={0}>Movement snaps to the grid. Drag the thin ring to a target, then name the relationship. Drop a ring on empty canvas to name a new node, then its relationship. If that grid point is occupied, the nearest free point is used. Hold near any canvas edge to scroll while moving or connecting. Escape cancels a drag. For keyboard or manual entry, use Add relationship. Focus a node and use arrow keys to move; hold Shift for larger steps. Open Relationship bundles at the bottom of the canvas to list bundled types.</p></details></div>
        {groups.some(group => !group.geometry && !group.separate.length) && <p className="modeling-route-warning" role="status">Some arrows have no clear route within the bounded routing search. Move nodes closer or apart to help show them; affected relationships are listed below.</p>}
        <div ref={contentRow} className="modeling-content-row" data-details-open={Boolean(selection)} style={{ '--modeling-details-width': `${detailsResize.width}px` } as CSSProperties}>
        <div ref={regionRef} className="modeling-canvas-region">
          {!nodes.length && <div className="modeling-empty"><Icon icon={CircleDashed} /><strong>{editable ? 'No node labels' : 'Model unavailable'}</strong></div>}
        <div ref={scrollRef} className={`modeling-canvas-scroll${panning ? ' modeling-panning' : ''}`} tabIndex={0} aria-label="Graph canvas, drag empty canvas or scroll to pan" onPointerDown={startPan} onPointerMove={movePan} onPointerUp={finishPan} onPointerCancel={event => { if (pan.current?.pointerId === event.pointerId) cancelPan(); }} onLostPointerCapture={event => { if (event.target === event.currentTarget && pan.current?.pointerId === event.pointerId) cancelPan(); }} onClick={event => {
          if (event.button === 0 && (event.target === event.currentTarget || (event.target as Element).classList.contains('modeling-canvas'))) clearSelection();
        }}>
          <div className={`modeling-canvas${showGrid ? ' modeling-canvas-grid' : ''}`} style={{ width: canvasWidth * displayScale + canvas.originX * 2, height: canvasHeight * displayScale + canvas.originY * 2, '--modeling-grid-size': `${GRID_STEP * displayScale}px`, backgroundPosition: `${canvas.originX}px ${canvas.originY}px` } as CSSProperties}>
            <svg ref={svgRef} style={{ left: canvas.originX, top: canvas.originY, width: canvasWidth * displayScale, height: canvasHeight * displayScale }} viewBox={`0 0 ${canvasWidth} ${canvasHeight}`} aria-label="Graph canvas" className="modeling-svg" onFocus={event => {
              if (event.target instanceof SVGElement && event.target.matches('[role="button"]:focus-visible') && !restoringCanvasFocus.current && !drag.current && !pan.current && !detailsResize.gesture.current) {
                const bundles = regionRef.current?.querySelector<HTMLDetailsElement>('.modeling-bundles');
                if (bundles) bundles.open = false;
                revealNode(event.target);
              }
            }} onClick={event => {
              if (event.button === 0 && event.target === event.currentTarget) clearSelection();
            }} onDoubleClick={addNodeAtCanvas}>
              <defs><pattern id="model-grid" x={-GRID_STEP / 2} y={-GRID_STEP / 2} width={GRID_STEP} height={GRID_STEP} patternUnits="userSpaceOnUse"><circle cx={GRID_STEP / 2} cy={GRID_STEP / 2} r=".8" className="modeling-grid-dot" /></pattern><marker id="model-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" /></marker></defs>
              {drawn.map(({ group, geometry, item, suffix }) => {
                  const reverse = group.from.id !== group.to.id && (item ? item.source === group.to.id : group.items.some(edge => edge.source === group.to.id));
                  const forward = !item || item.source === group.from.id;
                  const items = item ? [item] : group.items;
                  return <g key={`${group.source}-${group.target}-${suffix}`} className={edgeSelected(items) ? 'modeling-edge-selected' : undefined}><path aria-hidden="true" className={`modeling-edge${group.from.id === group.to.id ? ' modeling-loop' : ''}`} d={geometry.path} markerStart={reverse ? 'url(#model-arrow)' : undefined} markerEnd={forward ? 'url(#model-arrow)' : undefined} /><path className="modeling-edge-hit" d={geometry.path} role="button" tabIndex={0} aria-label={`${edgeDescription(items)}. Enter for details.`} aria-pressed={edgeSelected(items)} onClick={event => inspect(edgeSelection(items), event.currentTarget)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); inspect(edgeSelection(items), event.currentTarget); } }} /></g>;
              })}
              {placed.map(({ group, item, suffix, text, badge, origin }) => {
                  const description = (item ? [item] : group.items).map(edge => `${nodes.find(node => node.id === edge.source)?.name} → ${edge.name} → ${nodes.find(node => node.id === edge.target)?.name}`).join('; ');
                  const items = item ? [item] : group.items;
                  return <g key={`${group.source}-${group.target}-${suffix}`} className={edgeSelected(items) ? 'modeling-edge-selected' : undefined}><title>{description}</title><line aria-hidden="true" className="modeling-badge-leader" x1={origin.x} y1={origin.y} x2={badge.x} y2={badge.y} /><g className="modeling-edge-badge" role="button" tabIndex={0} aria-label={`${description}. Enter for details.`} aria-pressed={edgeSelected(items)} onClick={event => inspect(edgeSelection(items), event.currentTarget)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); inspect(edgeSelection(items), event.currentTarget); } }} transform={`translate(${badge.x} ${badge.y})`}><rect x={-badge.width / 2} y={-12} width={badge.width} height={24} rx={5} /><text textAnchor="middle" dominantBaseline="central">{text}</text></g></g>;
              })}
              {preview && (() => {
                const from = nodes.find(node => node.id === preview.source);
                const to = nodes.find(node => node.id === preview.target);
                if (!from) return null;
                const end = to ?? preview.point;
                const dx = end.x - from.x, dy = end.y - from.y, length = Math.hypot(dx, dy) || 1;
                const start = { x: from.x + dx / length * RADIUS, y: from.y + dy / length * RADIUS };
                const tip = to && to.id !== from.id ? { x: to.x - dx / length * (RADIUS + 3), y: to.y - dy / length * (RADIUS + 3) } : end;
                return <g aria-hidden="true" className="modeling-preview"><line x1={start.x} y1={start.y} x2={tip.x} y2={tip.y} markerEnd="url(#model-arrow)" />{to && <circle data-draft={displayDraft(to)} cx={to.x} cy={to.y} r={RADIUS + 4} />}</g>;
              })()}
              {nodes.map(node => {
                const lines = labelLines(node.name);
                const resolution = node.kind === 'reference' ? resolutionFor(node) : null;
                const status = resolution ? `${resolution.status} · ${resolution.modelName} · ${resolution.definition?.name ?? (node.kind === 'reference' ? node.target.nodeId : '')}` : displayDraft(node) ? 'Draft' : 'not draft';
                const ReferenceIcon = node.classification === 'External Reference' ? ExternalLink : Link;
                return <g key={node.id} className={`modeling-node${selectedNode?.id === node.id ? ' modeling-node-selected' : ''}`} data-classification={node.classification} data-draft={displayDraft(node)} data-unresolved={resolution?.status === 'Unresolved reference'} data-pending={resolution?.status === 'Resolving reference…'} role="button" aria-pressed={selectedNode?.id === node.id} tabIndex={0} aria-label={`${node.name}, ${node.classification}, ${status}, node label. Use arrow keys to move. Enter or Space for details.`} onClick={event => {
                  // AT activation has no pointer sequence. Pointer releases and
                  // their compatibility clicks remain owned by the drag handlers.
                  if (event.detail === 0 && editable && !persistence.busy.current && !drag.current && !pan.current && !detailsResize.gesture.current) inspect({ kind: 'node', id: node.id }, event.currentTarget);
                }} onKeyDown={event => moveByKeyboard(event, node)} onPointerDown={event => startDrag(event, node, (event.target as Element).classList.contains('modeling-node-ring') ? 'relationship' : 'node')} onPointerMove={dragNode} onPointerUp={finishDrag} onPointerCancel={event => { if (drag.current?.pointerId === event.pointerId) cancelDrag(); }} onLostPointerCapture={event => { if (drag.current?.pointerId === event.pointerId) cancelDrag(); }}>
                  <title>{`${node.name} · ${node.classification} · ${status}`}</title><circle className="modeling-node-ring" cx={node.x} cy={node.y} r={RADIUS + 12} /><circle aria-hidden="true" className="modeling-node-ring-visible" cx={node.x} cy={node.y} r={RADIUS + 12} /><circle className="modeling-node-body" cx={node.x} cy={node.y} r={RADIUS} /><text textAnchor="middle" dominantBaseline="central">{lines.map((line, index) => <tspan key={index} x={node.x} y={node.y + (index - (lines.length - 1) / 2) * 14}>{line}</tspan>)}</text>
                  {node.kind === 'reference' && <g aria-hidden="true" className="modeling-reference-indicator"><ReferenceIcon x={node.x - 7} y={node.y - 36} width={14} height={14} />{resolution?.status === 'Unresolved reference' && <text x={node.x} y={node.y + 35} textAnchor="middle">!</text>}</g>}
                </g>;
              })}
            </svg>
          </div>
        </div>
        <div ref={controlsRef} className="modeling-canvas-controls" role="toolbar" aria-label="Canvas controls">
          <button type="button" aria-label="Zoom out" title="Zoom out" disabled={navigating || zoom <= .5} onClick={() => changeZoom(zoom - .25)}><Icon icon={ZoomOut} /></button>
          <output aria-label="Canvas zoom" aria-live="polite">{Math.round(zoom * 100)}%</output>
          <button type="button" aria-label="Zoom in" title="Zoom in" disabled={navigating || zoom >= 2} onClick={() => changeZoom(zoom + .25)}><Icon icon={ZoomIn} /></button>
          <button type="button" aria-label="Reset zoom" title="Reset zoom to 100%" disabled={navigating || zoom === 1} onClick={() => changeZoom(1)}><Icon icon={RotateCcw} /></button>
          <button type="button" className="modeling-grid-toggle" aria-pressed={showGrid} disabled={navigating} onClick={() => { if (canNavigate()) setShowGrid(current => !current); }}><Icon icon={Grid2X2} />{showGrid ? 'Hide grid' : 'Show grid'}</button>
        </div>
        {groups.some(group => !group.separate.length && (group.items.length > 1 || !group.geometry)) && <details className="modeling-bundles"><summary>Relationship bundles</summary><div className="modeling-bundle-list">{groups.filter(group => !group.separate.length && (group.items.length > 1 || !group.geometry)).map(group => <details key={group.number} className="modeling-summary" open><summary>{group.geometry ? `Bundle ${group.number} · ${group.items.length} types` : 'Unrouted relationships'}: {group.from.name} {group.from.id === group.to.id ? '↻' : '↔'} {group.to.name}</summary>{!group.geometry && <p className="modeling-unrouted">Arrow not shown: no clear route</p>}{relationshipList(group.items)}</details>)}</div></details>}
      </div>
      {selection && <dialog ref={detailsRef} className="modeling-details" role={narrowDetails ? 'dialog' : 'region'} aria-modal={narrowDetails ? true : undefined} aria-labelledby="modeling-details-title" onPointerDown={event => {
        backdropGesture.current = narrowDetails && !dialog && event.button === 0 && event.isPrimary && outsideDetails(event)
          ? { pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, moved: false, ended: false } : null;
      }} onPointerMove={event => {
        const gesture = backdropGesture.current;
        if (gesture?.pointerId === event.pointerId && Math.hypot(event.clientX - gesture.start.x, event.clientY - gesture.start.y) >= 5) gesture.moved = true;
      }} onPointerUp={event => {
        const gesture = backdropGesture.current;
        if (gesture?.pointerId !== event.pointerId) return;
        gesture.ended = !gesture.moved && outsideDetails(event) && Math.hypot(event.clientX - gesture.start.x, event.clientY - gesture.start.y) < 5;
      }} onPointerCancel={() => { backdropGesture.current = null; }} onClick={event => {
        const gesture = backdropGesture.current;
        backdropGesture.current = null;
        if (narrowDetails && event.button === 0 && gesture?.ended && outsideDetails(event)) clearSelection();
      }} onCancel={event => { event.preventDefault(); closeDetails(); }} onKeyDown={event => {
        if (!narrowDetails || dialog || event.key !== 'Tab') return;
        const controls = dialogControls(event.currentTarget);
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === detailsHeading.current)) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first?.focus();
        }
      }}>
        <div className="modeling-details-resize" {...detailsResize.separator} onPointerDown={event => {
          if (!drag.current && !pan.current) detailsResize.separator.onPointerDown(event);
        }} onKeyDown={event => {
          if (!drag.current && !pan.current) detailsResize.separator.onKeyDown(event);
        }} />
        <header className="modeling-details-header"><div><p>{selectedNode ? 'Node label' : selectedRelationship ? 'Relationship' : 'Relationship bundle'}</p><h2 ref={detailsHeading} tabIndex={-1} id="modeling-details-title">{selectedNode?.name ?? selectedRelationship?.name ?? `${selection.kind === 'bundle' ? selection.ids.length : 0} relationships`}</h2></div><div className="modeling-details-actions">
          <button type="button" className="modeling-details-close" aria-label="Narrower details" title="Narrower details" aria-disabled={!detailsResize.canNarrow} onClick={() => { if (detailsResize.canNarrow) detailsResize.stepWidth(-1); }}><Icon icon={ChevronRight} /></button>
          <button type="button" className="modeling-details-close" aria-label="Wider details" title="Wider details" aria-disabled={!detailsResize.canWiden} onClick={() => { if (detailsResize.canWiden) detailsResize.stepWidth(1); }}><Icon icon={ChevronLeft} /></button>
          <button type="button" className="modeling-details-close" aria-label="Close details" onClick={closeDetails}><Icon icon={X} /></button>
        </div></header>
        <div className="modeling-details-content" tabIndex={0} role="group" aria-label="Details content">
          {selectedNode && <div className="modeling-node-position" role="group" aria-label="Node position">
            {([{ name: 'left', dx: -1, dy: 0, icon: ArrowLeft }, { name: 'up', dx: 0, dy: -1, icon: ArrowUp }, { name: 'down', dx: 0, dy: 1, icon: ArrowDown }, { name: 'right', dx: 1, dy: 0, icon: ArrowRight }] as const).map(direction => <button key={direction.name} type="button" className="modeling-details-close" aria-label={`Move node ${direction.name}`} title={`Move node ${direction.name}`} disabled={!editable || persistence.saving || navigating || Boolean(dialog || naming || browserOpen)} onClick={event => moveSelectedNode(direction.dx, direction.dy, event.shiftKey)}><Icon icon={direction.icon} /></button>)}
          </div>}
          {selectedNode && <><NodeNameChip key={selectedNode.id} node={{ ...selectedNode, draft: displayDraft(selectedNode) }} draft={nameDrafts[selectedNode.id]} disabled={!editable} inputRef={renameInput}
            onDraft={draft => setNameDrafts(current => ({ ...current, [selectedNode.id]: draft }))}
            onCommit={value => commitNodeName(selectedNode.id, value)} onDraftToggle={selectedNode.kind === 'definition' ? draft => updateNodeMetadata({ draft }) : undefined} />{selectedNode.kind === 'reference' ? <ReadOnlyReferenceDetails reference={selectedNode} resolution={resolutionFor(selectedNode)} loading={catalog.loading} error={catalog.error} onRefresh={() => void catalog.refresh()} /> : <><div className="modeling-node-metadata">
            <label htmlFor="model-node-classification">Data classification</label>
            <select id="model-node-classification" disabled={!editable} value={selectedNode.classification} onChange={event => updateNodeMetadata({ classification: event.target.value as DataClassification })}>{classifications.map(value => <option key={value} value={value}>{value}</option>)}</select>
          </div><NodeProperties key={`properties-${selectedNode.id}`} rows={propertiesDrafts[selectedNode.id] ?? []} disabled={!editable}
            onRows={rows => setPropertiesDrafts(current => ({ ...current, [selectedNode.id]: rows }))}
            onCommit={properties => { if (editable) setNodes(current => current.map(node => node.id === selectedNode.id && node.kind === 'definition' ? { ...node, properties } : node)); }}
            onAnnounce={setAnnouncement} /></>}</>}
          {selectedRelationship && <div className="modeling-relationship-details">
            {(['source', 'target'] as const).map(end => {
              const label = end === 'source' ? 'From' : 'To';
              const field = end === 'source' ? 'sourceCardinality' : 'targetCardinality';
              return <div key={end} className="modeling-relationship-end">
                <dl className="modeling-detail-endpoints"><dt>{label}</dt><dd>{nodeNameFor(selectedRelationship[end])}</dd></dl>
                <label htmlFor={`model-relationship-${end}-cardinality`}>{label} cardinality</label>
                <div className="modeling-cardinality-select">
                  <select id={`model-relationship-${end}-cardinality`} disabled={!editable || persistence.phase !== 'ready'} value={selectedRelationship[field]} onChange={event => updateRelationshipCardinality(selectedRelationship.id, field, event.target.value as RelationCardinality)}>
                    {cardinalities.map(value => <option key={value} value={value}>{value}</option>)}
                  </select>
                  <ChevronDown aria-hidden="true" />
                </div>
              </div>;
            })}
          </div>}
          {selection.kind === 'bundle' && relationshipList(relationships.filter(item => selection.ids.includes(item.id)))}
        </div>
      </dialog>}
        </div>
      </div>
    </div>
    <div className="sr-only" role="status" aria-live="polite">{announcement}</div>
    {naming && <Dialog title={naming === 'create' ? 'New model' : 'Edit model title'} returnFocusRef={namingOrigin} subtitle={naming === 'title' && persistence.id === 'legacy' ? 'Naming creates a separate copy and retains Legacy model.' : undefined} busy={persistence.saving || persistence.creating} dirty={namingDirty} onClose={closeNaming}>
      <form className="modeling-form" onSubmit={saveNamedModel} noValidate>
        <label htmlFor="model-save-name">Data model name</label>
        <input ref={modelNameInput} id="model-save-name" name="modelName" data-dialog-initial-focus autoComplete="off" value={modelName} disabled={persistence.saving || persistence.creating} onChange={event => { setModelName(event.target.value); setModelNameError(''); }} aria-invalid={Boolean(modelNameError)} aria-describedby={modelNameError ? 'model-save-name-error' : undefined} />
        {modelNameError && <p id="model-save-name-error" className="modeling-error" role="alert">{modelNameError}</p>}
        {(naming === 'create' ? persistence.creationError : persistence.error) && <p className="modeling-error" role="alert">{naming === 'create' ? persistence.creationError : persistence.error}</p>}
        <div className="dialog-actions"><div className="action-spacer" /><button className="button secondary" type="button" disabled={persistence.saving || persistence.creating} onClick={cancelNaming}>Cancel</button><button className="button primary" type="submit" disabled={persistence.saving || persistence.creating || (naming === 'title' && persistence.conflict)}>{persistence.creating ? 'Creating model…' : persistence.saving ? 'Saving model…' : naming === 'create' ? 'Create model' : persistence.id === 'legacy' ? 'Save named copy' : 'Save title'}</button></div>
      </form>
    </Dialog>}
    {dialog === 'node' && <Dialog key="node" title="Add node label" onClose={closeNodeDialog}>
      <form className="modeling-form" onSubmit={addNode} noValidate>
        <label htmlFor="model-node-name">Label name</label>
        <input ref={nodeInput} id="model-node-name" data-dialog-initial-focus value={nodeName} onChange={event => changeNodeName(event.target)} placeholder="e.g. CustomerAccount" aria-describedby={`model-node-name-format${nodeError && nodeErrorField === 'name' ? ' model-node-error' : ''}`} aria-invalid={Boolean(nodeError && nodeErrorField === 'name')} />
        <p className="modeling-hint" id="model-node-name-format">{nodeNameFormat}</p>
        <label htmlFor="model-add-classification">Classification</label>
        <select id="model-add-classification" value={nodeClassification} onChange={event => { setNodeClassification(event.target.value as typeof nodeClassification); setReferenceModel(''); setReferenceNode(''); setNodeError(''); }}>
          {[...classifications, 'Internal Reference', 'External Reference'].map(value => <option key={value} value={value}>{value}</option>)}
        </select>
        {referenceMode && <ReferenceTargetFields classification={nodeClassification as ReferenceClassification} modelId={persistence.id} definitions={nodes.filter((node): node is ModelDefinition => node.kind === 'definition')} models={catalog.models} targetModel={referenceModel} targetNode={referenceNode}
          onModel={id => { setReferenceModel(id); setReferenceNode(''); setNodeError(''); }} onNode={id => { setReferenceNode(id); setNodeError(''); }} modelRef={referenceModelInput} nodeRef={referenceNodeInput} errorField={nodeError ? nodeErrorField : 'name'} loading={catalog.loading} error={catalog.error} onRetry={() => void catalog.refresh()} />}
        {nodeError && <p className="modeling-error" id="model-node-error" role="alert">{nodeError}</p>}
        <div className="dialog-actions"><div className="action-spacer" /><button className="button secondary" type="button" onClick={closeNodeDialog}>Close</button><button className="button primary" type="submit">Add node label</button></div>
      </form>
    </Dialog>}
    {dialog === 'relationship' && <Dialog key="relationship" title="Add relationship" subtitle="Connect node labels in a direction, including a label to itself. Closing keeps your unfinished entry and any newly added node in this session." onClose={() => setDialog(null)}>
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
