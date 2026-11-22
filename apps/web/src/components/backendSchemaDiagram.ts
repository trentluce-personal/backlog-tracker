import type { BackendSchemaResponse } from '../api';
// @ts-expect-error Explicit extension supports the repository's native Node TS tests.
import { clamp, HEADER_HEIGHT, ROW_HEIGHT, TABLE_WIDTH } from './erd/geometry.ts';

export type SqliteSchema = BackendSchemaResponse['sqlite'];
export type SqliteTable = SqliteSchema['tables'][number];
export type SqliteForeignKey = SqliteTable['foreignKeys'][number];

export interface DiagramNode {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  table: SqliteTable;
}

export interface EdgePair {
  from: string;
  to: string | null;
  toDisplay: string;
  anchor: string | null;
}

export interface DiagramEdge {
  id: string;
  sourceName: string;
  targetName: string;
  pairs: EdgePair[];
  onUpdate: string;
  onDelete: string;
  match: string;
  path: string;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  hoverLabel: string;
}

export interface Diagram {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  width: number;
  height: number;
}

const ORIGIN = { x: 40, y: 40 };
const COLUMN_PITCH = 380;
const ROW_GAP = 60;
const COLUMNS = 3;

export const displayType = (declaredType: string) => declaredType || '—';
export const displayDefault = (defaultSql: string | null) => defaultSql ?? '—';

// Application semantics from the backlog store and input validation, for cards only.
const logicalTypes = new Map([
  ['projects.id', 'UUID'],
  ['projects.createdAt', 'Timestamp'],
  ['tasks.id', 'UUID'],
  ['tasks.projectId', 'UUID'],
  ['tasks.createdAt', 'Timestamp'],
  ['tasks.updatedAt', 'Timestamp'],
  ['tasks.dueDate', 'Date'],
  ['tasks.dueTime', 'Time'],
  ['tasks.priority', 'Enum'],
  ['tasks.status', 'Enum'],
]);

export function displayCardType(tableName: string, column: SqliteTable['columns'][number]): string {
  const { name, declaredType } = column;
  const logicalType = declaredType === 'TEXT' ? logicalTypes.get(`${tableName}.${name}`) : undefined;
  return logicalType ?? displayType(declaredType);
}

export function nodeHeight(table: SqliteTable): number {
  return HEADER_HEIGHT + Math.max(1, table.columns.length) * ROW_HEIGHT;
}

export function layoutNodes(tables: SqliteTable[]): DiagramNode[] {
  const heights = tables.map(nodeHeight);
  const rowHeights: number[] = [];
  tables.forEach((_, index) => {
    const row = Math.floor(index / COLUMNS);
    rowHeights[row] = Math.max(rowHeights[row] ?? 0, heights[index]);
  });
  const rowY: number[] = [];
  let y = ORIGIN.y;
  for (let row = 0; row < rowHeights.length; row++) {
    rowY[row] = y;
    y += rowHeights[row] + ROW_GAP;
  }
  return tables.map((table, index) => ({
    name: table.name,
    x: clamp(ORIGIN.x + (index % COLUMNS) * COLUMN_PITCH),
    y: clamp(rowY[Math.floor(index / COLUMNS)]),
    width: TABLE_WIDTH,
    height: heights[index],
    table,
  }));
}

export function primaryKeyColumns(table: SqliteTable | undefined): string[] {
  if (!table) return [];
  return table.columns
    .filter(column => column.primaryKeyPosition > 0)
    .sort((a, b) => a.primaryKeyPosition - b.primaryKeyPosition)
    .map(column => column.name);
}

export function resolvePair(pair: SqliteForeignKey, target: SqliteTable | undefined): { toDisplay: string; anchor: string | null } {
  if (pair.to !== null) return { toDisplay: pair.to, anchor: pair.to };
  const primary = primaryKeyColumns(target);
  const name = primary[pair.sequence] ?? primary[0];
  return name ? { toDisplay: name, anchor: name } : { toDisplay: '(primary key)', anchor: null };
}

function edgeGeometry(source: DiagramNode, target: DiagramNode, sourceRow: number, targetRow: number, loopIndex: number) {
  const sy = source.y + HEADER_HEIGHT + Math.max(0, sourceRow) * ROW_HEIGHT + ROW_HEIGHT / 2;
  const ty = target.y + HEADER_HEIGHT + Math.max(0, targetRow) * ROW_HEIGHT + ROW_HEIGHT / 2;
  const self = source.name === target.name;
  // Vertically stacked cards share the right edge, so the line stays outside
  // the card interiors and reciprocal keys use the same anchors in reverse.
  const sx = source.x + (source.x <= target.x ? source.width : 0);
  const tx = target.x + (target.x <= source.x ? target.width : 0);
  if (self) {
    const elbow = sx + 44 + loopIndex * 26;
    if (sy === ty) {
      // Leave and return to the same row without retracing a single stroke.
      return { path: `M ${sx} ${sy} L ${sx + 20} ${sy - ROW_HEIGHT / 2} H ${elbow} V ${ty} H ${tx}`, sx, sy, tx, ty };
    }
    return { path: `M ${sx} ${sy} H ${elbow} V ${ty} H ${tx}`, sx, sy, tx, ty };
  }
  return { path: `M ${sx} ${sy} L ${tx} ${ty}`, sx, sy, tx, ty };
}

export function buildEdges(nodes: DiagramNode[]): DiagramEdge[] {
  const byName = new Map(nodes.map(node => [node.name, node]));
  const groups = new Map<string, { source: DiagramNode; fks: SqliteForeignKey[] }>();
  for (const node of nodes) {
    for (const fk of node.table.foreignKeys) {
      const key = `${node.name}:${fk.id}`;
      const group = groups.get(key) ?? { source: node, fks: [] };
      group.fks.push(fk);
      groups.set(key, group);
    }
  }
  const descriptors = [...groups.entries()].map(([id, { source, fks }]) => {
    const ordered = [...fks].sort((a, b) => a.sequence - b.sequence);
    const anchor = ordered[0];
    const target = byName.get(anchor.table);
    const pairs = ordered.map(fk => ({ from: fk.from, to: fk.to, ...resolvePair(fk, target?.table) }));
    return { id, source, target, targetName: anchor.table, pairs, anchor };
  }).filter((descriptor): descriptor is typeof descriptor & { target: DiagramNode } => Boolean(descriptor.target));

  const loopCounts = new Map<string, number>();
  return descriptors.map(({ id, source, target, targetName, pairs, anchor }) => {
    const loopIndex = loopCounts.get(source.name) ?? 0;
    if (source === target) loopCounts.set(source.name, loopIndex + 1);
    const sourceRow = source.table.columns.findIndex(column => column.name === anchor.from);
    const targetRow = target.table.columns.findIndex(column => column.name === pairs[0].anchor);
    const geometry = edgeGeometry(source, target, sourceRow, targetRow, loopIndex);
    const endpoints = pairs.map(pair => `${source.name}.${pair.from} → ${targetName}.${pair.toDisplay}`).join(', ');
    return {
      id, sourceName: source.name, targetName, pairs,
      onUpdate: anchor.onUpdate, onDelete: anchor.onDelete, match: anchor.match,
      ...geometry,
      hoverLabel: `${endpoints} · ON DELETE ${anchor.onDelete} · ON UPDATE ${anchor.onUpdate} · MATCH ${anchor.match}`,
    };
  });
}

function worldBounds(nodes: DiagramNode[]): { width: number; height: number } {
  return {
    width: nodes.reduce((max, node) => Math.max(max, node.x + node.width), 600) + 200,
    height: nodes.reduce((max, node) => Math.max(max, node.y + node.height), 400) + 200,
  };
}

export function buildDiagram(sqlite: SqliteSchema): Diagram {
  const nodes = layoutNodes(sqlite.tables);
  return { nodes, edges: buildEdges(nodes), ...worldBounds(nodes) };
}

export function moveDiagram(diagram: Diagram, positions: Record<string, { x: number; y: number }>): Diagram {
  const nodes = diagram.nodes.map(node => {
    const position = positions[node.name];
    if (!position) return node;
    const x = clamp(position.x), y = clamp(position.y);
    return x === node.x && y === node.y ? node : { ...node, x, y };
  });
  if (nodes.every((node, index) => node === diagram.nodes[index])) return diagram;
  return { nodes, edges: buildEdges(nodes), ...worldBounds(nodes) };
}
