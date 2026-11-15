import type { ErForeignKey, ErModel, ErTable } from '../../erd-types.ts';

export const TABLE_WIDTH = 300, HEADER_HEIGHT = 48, ROW_HEIGHT = 36;
export interface View { x: number; y: number; zoom: number }
export const initialView: View = { x: 32, y: 32, zoom: 1 };
export const clamp = (value: number) => Math.min(20000, Math.max(0, value));
export function panView(view: View, key: string, shift: boolean): View | null {
  const directions: Record<string, [number, number]> = { ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
  const delta = directions[key];
  if (!delta) return null;
  const step = shift ? 160 : 40;
  return { ...view, x: view.x + delta[0] * step, y: view.y + delta[1] * step };
}
export function revealBounds(view: View, bounds: { x: number; y: number; width: number; height: number }, viewport: { width: number; height: number }): View {
  const reveal = (offset: number, start: number, length: number, available: number) => {
    const leading = offset + start * view.zoom, trailing = leading + length * view.zoom;
    if (leading < 12 || length * view.zoom > available - 24) return 12 - start * view.zoom;
    if (trailing > available - 12) return available - 12 - (start + length) * view.zoom;
    return offset;
  };
  return { ...view, x: reveal(view.x, bounds.x, bounds.width, viewport.width), y: reveal(view.y, bounds.y, bounds.height, viewport.height) };
}
export function tableHeight(table: ErTable): number { return HEADER_HEIGHT + Math.max(1, table.columns.length) * ROW_HEIGHT + 38; }
// A transient presentation layout: stored positions never change on editor open.
// Move lower cards out of expanded cards' bounds, propagating only those shifts.
export function expandedLayout(tables: ErTable[], extraHeights: Record<string, number>): ErTable[] {
  const placed: ErTable[] = [];
  for (const table of [...tables].sort((a, b) => a.y - b.y)) {
    let y = table.y;
    for (const upper of placed) {
      if (!(extraHeights[upper.id] > 0 || upper.y !== tables.find(item => item.id === upper.id)?.y)) continue;
      if (table.x + TABLE_WIDTH + 12 <= upper.x || table.x >= upper.x + TABLE_WIDTH + 12) continue;
      y = Math.max(y, upper.y + tableHeight(upper) + (extraHeights[upper.id] ?? 0) + 12);
    }
    placed.push(y === table.y ? table : { ...table, y });
  }
  return tables.map(table => placed.find(item => item.id === table.id)!);
}
export function autoPlacement(tables: ErTable[], origin = { x: 40, y: 40 }, extraHeights: Record<string, number> = {}): { x: number; y: number } {
  for (let row = 0; row < 100; row++) for (let col = 0; col < 4; col++) {
    const x = clamp(Math.max(0, origin.x) + col * 380), y = clamp(Math.max(0, origin.y) + row * 260);
    if (tables.every(table => x + TABLE_WIDTH + 40 <= table.x || x >= table.x + TABLE_WIDTH + 40 || y + 300 <= table.y || y >= table.y + tableHeight(table) + (extraHeights[table.id] ?? 0) + 60)) return { x, y };
  }
  return { x: 40, y: clamp(Math.max(0, ...tables.map(table => table.y + tableHeight(table) + (extraHeights[table.id] ?? 0))) + 60) };
}
export function zoomView(view: View, zoom: number, center: { x: number; y: number }): View {
  const next = Math.min(2, Math.max(.25, zoom));
  return { x: center.x - (center.x - view.x) * next / view.zoom, y: center.y - (center.y - view.y) * next / view.zoom, zoom: next };
}
export function relationshipGeometry(model: ErModel, fk: ErForeignKey) {
  const source = model.tables.find(table => table.id === fk.sourceTableId), target = model.tables.find(table => table.id === fk.targetTableId);
  if (!source || !target) return null;
  const sourceRow = source.columns.findIndex(column => column.id === fk.sourceColumnId), targetRow = target.columns.findIndex(column => column.id === fk.targetColumnId);
  if (sourceRow < 0 || targetRow < 0) return null;
  const siblings = model.foreignKeys.filter(item => (item.sourceTableId === source.id && item.targetTableId === target.id) || (item.sourceTableId === target.id && item.targetTableId === source.id));
  const lane = Math.max(0, siblings.findIndex(item => item.id === fk.id));
  const sy = source.y + HEADER_HEIGHT + sourceRow * ROW_HEIGHT + ROW_HEIGHT / 2;
  const ty = target.y + HEADER_HEIGHT + targetRow * ROW_HEIGHT + ROW_HEIGHT / 2;
  const right = source.id === target.id || source.x <= target.x;
  const sx = source.x + (right ? TABLE_WIDTH : 0), tx = target.x + (right && source.id !== target.id ? 0 : TABLE_WIDTH);
  if (source.id === target.id) {
    const elbow = sx + 44 + lane * 26;
    return { path: `M ${sx} ${sy} H ${elbow} V ${ty} H ${tx}`, labelX: elbow + 5, labelY: (sy + ty) / 2, sx, sy, tx, ty };
  }
  // Never give a shared-endpoint edge a zero-offset lane: a later reverse
  // edge's hit stroke can otherwise cover its entire horizontal path.
  const offset = siblings.length > 1 ? (lane + 1) * 48 : 0;
  const midX = (sx + tx) / 2, midY = (sy + ty) / 2 + offset;
  const span = tx - sx;
  // Explicit controls stay within the horizontal gap. Reflecting an S control
  // used to backtrack across nearby lanes when tables were only 100px apart.
  return { path: `M ${sx} ${sy} C ${sx + span / 4} ${sy}, ${midX - span / 8} ${midY}, ${midX} ${midY} C ${midX + span / 8} ${midY}, ${tx - span / 4} ${ty}, ${tx} ${ty}`, labelX: midX, labelY: midY - 7, sx, sy, tx, ty };
}
