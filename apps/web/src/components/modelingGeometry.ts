import type { ModelNode } from '../types';

type Point = { x: number; y: number };
type Extent = { width: number; height: number };
type Segment = { a: Point; b: Point };
export const PLACEMENT_LIMIT = 65536;
export const ROUTE_LIMIT = 2048;
export const routingBudget = () => ({ remaining: 8192 });
type Budget = ReturnType<typeof routingBudget>;
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

// Visit square shells without allocating the world. A completed shell proves
// optimality once its best point is closer than every unvisited shell.
export function nearestPlacement(requested: Point, nodes: Point[], extent: Extent) {
  const maxX = Math.min(100000, Math.floor((extent.width - 53) / 20) * 20);
  const maxY = Math.min(100000, Math.floor((extent.height - 53) / 20) * 20);
  const center = { x: clamp(Math.round(requested.x / 20) * 20, 60, maxX), y: clamp(Math.round(requested.y / 20) * 20, 60, maxY) };
  let examined = 0;
  let best: Point | null = null;
  let distance = Infinity;
  const visit = (x: number, y: number) => {
    examined++;
    if (x < 60 || x > maxX || y < 60 || y > maxY) return;
    const d = Math.hypot(x - center.x, y - center.y);
    if (d > distance || !nodes.every(node => Math.hypot(node.x - x, node.y - y) >= 180)) return;
    if (d < distance || !best || y < best.y || (y === best.y && x < best.x)) { best = { x, y }; distance = d; }
  };
  const shells = Math.max(center.x - 60, maxX - center.x, center.y - 60, maxY - center.y) / 20;
  for (let k = 0; k <= shells; k++) {
    if (!k) visit(center.x, center.y);
    else {
      for (let dx = -k; dx <= k; dx++) {
        if (examined + 2 > PLACEMENT_LIMIT) return { position: null, examined, limited: true };
        visit(center.x + dx * 20, center.y - k * 20);
        visit(center.x + dx * 20, center.y + k * 20);
      }
      for (let dy = -k + 1; dy < k; dy++) {
        if (examined + 2 > PLACEMENT_LIMIT) return { position: null, examined, limited: true };
        visit(center.x - k * 20, center.y + dy * 20);
        visit(center.x + k * 20, center.y + dy * 20);
      }
    }
    if (best && distance < (k + 1) * 20) return { position: best, examined, limited: false };
  }
  return { position: best, examined, limited: false };
}

export function distanceToSegment(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
export function segmentClear(a: Point, b: Point, obstacles: ModelNode[]) {
  return obstacles.every(node => distanceToSegment(node, a, b) >= 63);
}
function routeClear(a: Point, b: Point, routes: Segment[], source: Point, target: Point) {
  if (!routes.length) return true;
  if (routes.length > 128) return false;
  const count = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 10);
  // Long routes can use the obstacle-safe fallback without route separation.
  if (count > 64) return false;
  for (let i = 0; i <= count; i++) {
    const p = { x: a.x + (b.x - a.x) * i / (count || 1), y: a.y + (b.y - a.y) * i / (count || 1) };
    if (Math.hypot(p.x - source.x, p.y - source.y) < 80 || Math.hypot(p.x - target.x, p.y - target.y) < 80) continue;
    if (routes.some(route => distanceToSegment(p, route.a, route.b) < 18)) return false;
  }
  return true;
}

export function edgeGeometry(source: ModelNode, target: ModelNode, nodes: ModelNode[], extent: Extent, routes: Segment[] = [], budget: Budget = routingBudget()): { path: string; badge: Point; segments: Segment[] } | null {
  const obstacles = nodes.filter(node => node.id !== source.id && node.id !== target.id);
  const finish = (points: Point[]) => {
    const trim = (center: Point, toward: Point, radius: number) => {
      const length = Math.hypot(toward.x - center.x, toward.y - center.y);
      return { x: center.x + (toward.x - center.x) * radius / length, y: center.y + (toward.y - center.y) * radius / length };
    };
    points[0] = trim(source, points[1], 48);
    points[points.length - 1] = trim(target, points[points.length - 2], 50);
    const segments = points.slice(1).map((b, i) => ({ a: points[i], b }));
    const lengths = segments.map(({ a, b }) => Math.hypot(b.x - a.x, b.y - a.y));
    let remaining = lengths.reduce((sum, length) => sum + length, 0) / 2;
    let i = 0;
    while (i < lengths.length - 1 && remaining > lengths[i]) remaining -= lengths[i++];
    const ratio = remaining / lengths[i];
    return { path: points.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' '), badge: { x: clamp(segments[i].a.x + (segments[i].b.x - segments[i].a.x) * ratio, 18, extent.width - 18), y: clamp(segments[i].a.y + (segments[i].b.y - segments[i].a.y) * ratio, 13, extent.height - 13) }, segments };
  };
  // Distance-independent fast path; separation-free fallback uses the same budget.
  if (segmentClear(source, target, obstacles) && (Math.hypot(target.x - source.x, target.y - source.y) > 640 || routeClear(source, target, routes, source, target))) return finish([source, target]);
  const columns = Math.floor(extent.width / 20) + 1;
  const point = (id: number) => ({ x: id % columns * 20, y: Math.floor(id / columns) * 20 });
  const idAt = (p: Point) => Math.round(p.y / 20) * columns + Math.round(p.x / 20);
  const start = idAt(source), end = idAt(target);
  const queue: { id: number; cost: number; score: number }[] = [];
  const push = (id: number, cost: number) => {
    const item = { id, cost, score: cost + Math.hypot(point(id).x - target.x, point(id).y - target.y) };
    let i = queue.length; queue.push(item);
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2);
      if (queue[parent].score <= item.score) break;
      queue[i] = queue[parent]; i = parent;
    }
    queue[i] = item;
  };
  const pop = () => {
    const first = queue[0], last = queue.pop()!;
    if (queue.length) {
      let i = 0;
      while (i * 2 + 1 < queue.length) {
        let child = i * 2 + 1;
        if (child + 1 < queue.length && queue[child + 1].score < queue[child].score) child++;
        if (queue[child].score >= last.score) break;
        queue[i] = queue[child]; i = child;
      }
      queue[i] = last;
    }
    return first;
  };
  const distance = new Map([[start, 0]]), previous = new Map<number, number>();
  push(start, 0);
  let reached = false, expanded = 0;
  while (queue.length && expanded < ROUTE_LIMIT && budget.remaining > 0) {
    expanded++; budget.remaining--;
    const item = pop(), current = item.id;
    if (item.cost !== distance.get(current)) continue;
    if (current === end) { reached = true; break; }
    const p = point(current);
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      const nextPoint = { x: p.x + dx * 20, y: p.y + dy * 20 };
      if (nextPoint.x < 0 || nextPoint.x > extent.width || nextPoint.y < 0 || nextPoint.y > extent.height) continue;
      if (!segmentClear(p, nextPoint, obstacles) || !routeClear(p, nextPoint, routes, source, target)) continue;
      const next = idAt(nextPoint), cost = distance.get(current)! + Math.hypot(dx, dy) * 20;
      if (cost >= (distance.get(next) ?? Infinity)) continue;
      distance.set(next, cost); previous.set(next, current);
      push(next, cost);
    }
  }
  if (!reached) return routes.length ? edgeGeometry(source, target, nodes, extent, [], budget) : null;
  const grid: Point[] = [];
  for (let cursor = end; cursor !== start; cursor = previous.get(cursor)!) grid.push(point(cursor));
  const raw = [source, ...grid.reverse()];
  const points: Point[] = [source];
  // Simplification shares the render budget; exhausted routes remain truthful
  // unrouted entries rather than doing quadratic work or crossing obstacles.
  for (let i = 0; i < raw.length - 1;) {
    let next = raw.length - 1;
    while (next > i + 1) {
      if (budget.remaining-- <= 0) return null;
      if (segmentClear(raw[i], raw[next], obstacles) && routeClear(raw[i], raw[next], routes, source, target)) break;
      next--;
    }
    points.push(raw[next]); i = next;
  }
  return finish(points);
}
