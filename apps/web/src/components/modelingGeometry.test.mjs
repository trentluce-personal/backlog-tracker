import assert from 'node:assert/strict';
import test from 'node:test';
import { edgeGeometry, nearestPlacement, PLACEMENT_LIMIT, ROUTE_LIMIT, routingBudget, segmentClear } from './modelingGeometry.ts';

const extent = { width: 100072, height: 100072 };
const node = (id, x, y) => ({ kind: 'definition', id: `node-${id}`, name: 'Node', x, y, classification: 'Transactional', draft: false, properties: [] });

test('maximum persisted world: requested legal placement is checked first', () => {
  const result = nearestPlacement({ x: 300, y: 200 }, [node(0, 100000, 100000)], extent);
  assert.deepEqual(result, { position: { x: 300, y: 200 }, examined: 1, limited: false });
});

test('incremental placement matches exhaustive nearest and row-first tie breaks on ordinary graphs', () => {
  const bounds = { width: 1000, height: 600 };
  for (let seed = 0; seed < 30; seed++) {
    const nodes = Array.from({ length: 10 }, (_, i) => ({ x: 60 + (seed * 7 + i * 13) % 44 * 20, y: 60 + (seed * 11 + i * 7) % 24 * 20 }));
    const requested = { x: 60 + seed % 20 * 20, y: 60 + seed % 10 * 20 };
    const candidates = [];
    for (let y = 60; y <= 540; y += 20) for (let x = 60; x <= 940; x += 20) candidates.push({ x, y });
    candidates.sort((a, b) => Math.hypot(a.x - requested.x, a.y - requested.y) - Math.hypot(b.x - requested.x, b.y - requested.y));
    const expected = candidates.find(p => nodes.every(n => Math.hypot(p.x - n.x, p.y - n.y) >= 180)) ?? null;
    assert.deepEqual(nearestPlacement(requested, nodes, bounds).position, expected, `seed ${seed}`);
  }
});

test('occupied maximum coordinate and finite full canvas searches terminate', () => {
  const result = nearestPlacement({ x: 100000, y: 100000 }, [node(0, 100000, 100000)], extent);
  assert.ok(result.position);
  assert.ok(result.examined < 1000);
  assert.equal(Math.hypot(result.position.x - 100000, result.position.y - 100000), 180);
  const full = nearestPlacement({ x: 60, y: 60 }, [node(0, 60, 60)], { width: 133, height: 133 });
  assert.equal(full.position, null);
  assert.equal(full.limited, false);
});

test('unproven nearest result returns truthful bounded-search failure', () => {
  // Deliberately adversarial fixture: coverage of a 5km square, no world allocation.
  const nodes = [];
  for (let x = 60; x < 5200; x += 180) for (let y = 60; y < 5200; y += 180) nodes.push({ x, y });
  const result = nearestPlacement({ x: 2500, y: 2500 }, nodes, extent);
  assert.equal(result.position, null);
  assert.equal(result.limited, true);
  assert.ok(result.examined <= PLACEMENT_LIMIT);
});

test('distant unobstructed relationships use constant-size direct geometry', () => {
  const a = node(0, 60, 60), b = node(1, 100000, 100000);
  const budget = routingBudget();
  const geometry = edgeGeometry(a, b, [a, b], extent, [], budget);
  assert.equal(geometry.segments.length, 1);
  assert.equal(budget.remaining, 8192);
  assert.ok(geometry.path.length < 200);
  assert.equal(edgeGeometry(a, b, [a, b], extent, geometry.segments, budget).segments.length, 1);
});

test('ordinary obstacle detour remains clear and renders', () => {
  const a = node(0, 120, 120), b = node(1, 720, 120), obstacle = node(2, 420, 120);
  const geometry = edgeGeometry(a, b, [a, b, obstacle], { width: 1000, height: 600 });
  assert.ok(geometry);
  assert.ok(geometry.segments.every(({ a, b }) => segmentClear(a, b, [obstacle])));
});

test('long obstructed route is bounded and returns safe unrouted fallback', () => {
  const a = node(0, 60, 60), b = node(1, 100000, 100000), obstacle = node(2, 50000, 50000);
  const budget = routingBudget();
  assert.equal(edgeGeometry(a, b, [a, b, obstacle], extent, [], budget), null);
  assert.equal(8192 - budget.remaining, ROUTE_LIMIT);
  budget.remaining = 3;
  assert.equal(edgeGeometry(a, b, [a, b, obstacle], extent, [], budget), null);
  assert.equal(budget.remaining, 0);
});
