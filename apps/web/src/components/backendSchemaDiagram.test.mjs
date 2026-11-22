import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDiagram, buildEdges, displayCardType, displayDefault, displayType, layoutNodes, moveDiagram, nodeHeight, primaryKeyColumns, resolvePair } from './backendSchemaDiagram.ts';
import { HEADER_HEIGHT, ROW_HEIGHT, TABLE_WIDTH } from './erd/geometry.ts';

const column = (position, name, overrides = {}) => ({ position, name, declaredType: 'TEXT', notNull: false, defaultSql: null, primaryKeyPosition: 0, ...overrides });
const fk = (id, sequence, table, from, to, overrides = {}) => ({ id, sequence, table, from, to, onUpdate: 'NO ACTION', onDelete: 'CASCADE', match: 'NONE', ...overrides });
const table = (name, columns, foreignKeys = [], indexes = []) => ({ name, ddl: `CREATE TABLE ${name} (...)`, columns, foreignKeys, indexes });

const projects = table('projects', [column(0, 'id', { primaryKeyPosition: 1 }), column(1, 'name', { notNull: true }), column(2, 'createdAt', { notNull: true })]);
const tasks = table('tasks', [column(0, 'id', { primaryKeyPosition: 1 }), column(1, 'projectId', { notNull: true }), column(2, 'title', { notNull: true })], [fk(0, 0, 'projects', 'projectId', 'id')]);
const sqlite = { userVersion: 1, tables: [projects, tasks] };

test('edges expose no persistent label; hover label is cardinality-free with endpoints plus actions', () => {
  const { edges } = buildDiagram(sqlite);
  assert.equal(edges.length, 1);
  const edge = edges[0];
  assert.equal('label' in edge, false);
  assert.equal('labelX' in edge, false);
  assert.equal('labelY' in edge, false);
  assert.deepEqual(edge.pairs.map(pair => [pair.from, pair.toDisplay]), [['projectId', 'id']]);
  assert.equal(edge.hoverLabel, 'tasks.projectId → projects.id · ON DELETE CASCADE · ON UPDATE NO ACTION · MATCH NONE');
  assert.doesNotMatch(edge.hoverLabel, /N\s*:\s*1|1\s*:\s*N|one-to-many|many-to-one|cardinality/i);
});

test('composite foreign keys group by pragma id into one edge anchored at sequence 0', () => {
  const parent = table('parent', [column(0, 'a', { primaryKeyPosition: 1 }), column(1, 'b', { primaryKeyPosition: 2 })]);
  const child = table('child', [column(0, 'x'), column(1, 'y'), column(2, 'z')], [
    fk(7, 1, 'parent', 'y', 'b'), fk(7, 0, 'parent', 'x', 'a'), fk(9, 0, 'parent', 'z', 'a'),
  ]);
  const { edges } = buildDiagram({ userVersion: 1, tables: [parent, child] });
  assert.equal(edges.length, 2);
  const composite = edges.find(edge => edge.id === 'child:7');
  assert.deepEqual(composite.pairs.map(pair => pair.from), ['x', 'y']);
  assert.deepEqual(composite.pairs.map(pair => pair.toDisplay), ['a', 'b']);
  assert.ok(composite.hoverLabel.startsWith('child.x → parent.a, child.y → parent.b'));
  const source = layoutNodes([parent, child]).find(node => node.name === 'child');
  assert.equal(composite.sy, source.y + HEADER_HEIGHT + 0 * ROW_HEIGHT + ROW_HEIGHT / 2);
  const parallel = edges.find(edge => edge.id === 'child:9');
  assert.equal(parallel.sy, composite.sy + 2 * ROW_HEIGHT);
  assert.equal(parallel.ty, composite.ty);
  for (const { path, sx, sy, tx, ty } of edges) assert.equal(path, `M ${sx} ${sy} L ${tx} ${ty}`);
});

test('coincident and reciprocal foreign keys keep their real endpoints, identities and actions', () => {
  const left = table('left', [column(0, 'id')], [fk(3, 0, 'right', 'id', 'id')]);
  const right = table('right', [column(0, 'id')], [
    fk(1, 0, 'left', 'id', 'id'), fk(2, 0, 'left', 'id', 'id', { onDelete: 'RESTRICT' }),
  ]);
  const base = buildDiagram({ userVersion: 1, tables: [left, right] });
  const stacked = moveDiagram(base, { right: { x: base.nodes[0].x, y: 240 } });
  for (const { edges: [reverse, first, second] } of [base, stacked]) {
    assert.deepEqual([reverse.tx, reverse.ty, reverse.sx, reverse.sy], [first.sx, first.sy, first.tx, first.ty]);
    assert.equal(second.path, first.path);
    assert.deepEqual([first.id, second.id], ['right:1', 'right:2']);
    assert.notEqual(first.hoverLabel, second.hoverLabel);
  }
});

test('to:null resolves to target primary key columns ordered by primaryKeyPosition', () => {
  const parent = table('parent', [column(0, 'second', { primaryKeyPosition: 2 }), column(1, 'first', { primaryKeyPosition: 1 })]);
  assert.deepEqual(primaryKeyColumns(parent), ['first', 'second']);
  assert.deepEqual(resolvePair(fk(0, 0, 'parent', 'x', null), parent), { toDisplay: 'first', anchor: 'first' });
  assert.deepEqual(resolvePair(fk(0, 1, 'parent', 'y', null), parent), { toDisplay: 'second', anchor: 'second' });
  const child = table('child', [column(0, 'x')], [fk(0, 0, 'parent', 'x', null)]);
  const { edges } = buildDiagram({ userVersion: 1, tables: [parent, child] });
  assert.equal(edges[0].pairs[0].toDisplay, 'first');
  assert.ok(edges[0].hoverLabel.startsWith('child.x → parent.first'));
});

test('to:null falls back to (primary key) when the target has no primary key', () => {
  const parent = table('parent', [column(0, 'a')]);
  assert.deepEqual(resolvePair(fk(0, 0, 'parent', 'x', null), parent), { toDisplay: '(primary key)', anchor: null });
  assert.deepEqual(resolvePair(fk(0, 0, 'missing', 'x', null), undefined), { toDisplay: '(primary key)', anchor: null });
});

test('layout is deterministic, non-overlapping, and clamped for many tables', () => {
  const tables = Array.from({ length: 14 }, (_, index) => table(`t${index}`, Array.from({ length: (index % 5) + 1 }, (_, c) => column(c, `c${c}`))));
  const first = layoutNodes(tables);
  const second = layoutNodes(tables);
  assert.deepEqual(first, second);
  assert.equal(first[0].x, 40);
  assert.equal(first[0].y, 40);
  assert.equal(first[1].x, 40 + 380);
  for (const node of first) {
    assert.ok(node.x >= 0 && node.x <= 20000 && node.y >= 0 && node.y <= 20000);
    assert.equal(node.width, TABLE_WIDTH);
    assert.equal(node.height, nodeHeight(node.table));
  }
  for (let i = 0; i < first.length; i++) for (let j = i + 1; j < first.length; j++) {
    const a = first[i], b = first[j];
    const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    assert.equal(overlap, false, `${a.name} overlaps ${b.name}`);
  }
});

test('edge paths contain only finite numbers', () => {
  const { edges } = buildDiagram(sqlite);
  for (const edge of edges) {
    const numbers = edge.path.match(/-?\d+(\.\d+)?/g).map(Number);
    assert.ok(numbers.length > 0);
    for (const value of numbers) assert.ok(Number.isFinite(value));
    for (const value of [edge.sx, edge.sy, edge.tx, edge.ty]) assert.ok(Number.isFinite(value));
  }
});

test('self-referencing foreign key uses a straight-sided elbow outside the table', () => {
  const node = table('node', [column(0, 'id', { primaryKeyPosition: 1 }), column(1, 'parentId')], [fk(0, 0, 'node', 'parentId', 'id')]);
  const { nodes, edges } = buildDiagram({ userVersion: 1, tables: [node] });
  assert.equal(edges.length, 1);
  const { sx, sy, tx, ty, path } = edges[0];
  assert.equal(sx, nodes[0].x + TABLE_WIDTH);
  assert.equal(tx, sx);
  assert.equal(sy - ty, ROW_HEIGHT);
  const elbow = path.match(/^M (\d+) (\d+) H (\d+) V (\d+) H (\d+)$/);
  assert.ok(elbow);
  assert.ok(Number(elbow[3]) > sx);
  assert.deepEqual([elbow[1], elbow[2], elbow[4], elbow[5]].map(Number), [sx, sy, ty, tx]);
});

test('same-row self references leave room to hit the loop outside the table', () => {
  const node = table('node', [column(0, 'id')], [fk(0, 0, 'node', 'id', 'id'), fk(1, 0, 'node', 'id', 'id')]);
  const { edges } = buildDiagram({ userVersion: 1, tables: [node] });
  const elbowXs = edges.map(({ path, sx, sy }) => {
    const loop = path.match(/^M (\d+) (\d+) L (\d+) (\d+) H (\d+) V (\d+) H (\d+)$/);
    assert.ok(loop);
    const [, x, y, outX, outY, elbowX, returnY, returnX] = loop.map(Number);
    assert.deepEqual([x, y, returnX, returnY], [sx, sy, sx, sy]);
    assert.ok(elbowX > outX && outX > sx && sy - outY >= 16);
    return elbowX;
  });
  assert.ok(elbowXs[1] - elbowXs[0] >= 16);
});

test('quoted and spaced identifiers survive layout, hover labels, and finite paths', () => {
  const parent = table('weird "parent"', [column(0, 'a b', { primaryKeyPosition: 1 })]);
  const child = table('odd "child"', [column(0, 'x y')], [fk(0, 0, 'weird "parent"', 'x y', 'a b')]);
  const { nodes, edges } = buildDiagram({ userVersion: 1, tables: [parent, child] });
  assert.deepEqual(nodes.map(node => node.name), ['weird "parent"', 'odd "child"']);
  assert.equal('label' in edges[0], false);
  assert.ok(edges[0].hoverLabel.includes('odd "child".x y → weird "parent".a b'));
  for (const value of edges[0].path.match(/-?\d+(\.\d+)?/g).map(Number)) assert.ok(Number.isFinite(value));
});

test('empty declared type and null default display as em dash', () => {
  assert.equal(displayType(''), '—');
  assert.equal(displayType('TEXT'), 'TEXT');
  assert.equal(displayDefault(null), '—');
  assert.equal(displayDefault("''"), "''");
  const empty = table('empty', [column(0, 'x', { declaredType: '' })]);
  assert.equal(layoutNodes([empty])[0].height, HEADER_HEIGHT + ROW_HEIGHT);
});

test('backlog TEXT columns show their application types without changing the declared type', () => {
  for (const [tableName, name, expected] of [
    ['projects', 'id', 'UUID'], ['projects', 'createdAt', 'Timestamp'],
    ['tasks', 'id', 'UUID'], ['tasks', 'projectId', 'UUID'],
    ['tasks', 'createdAt', 'Timestamp'], ['tasks', 'updatedAt', 'Timestamp'],
    ['tasks', 'dueDate', 'Date'], ['tasks', 'dueTime', 'Time'], ['tasks', 'priority', 'Enum'], ['tasks', 'status', 'Enum'],
  ]) {
    const field = column(0, name);
    assert.equal(displayCardType(tableName, field), expected, `${tableName}.${name}`);
    assert.equal(displayType(field.declaredType), 'TEXT');
  }
});

test('card types fall back to the live SQLite declaration for unmapped fields or alternate types', () => {
  assert.equal(displayCardType('archive', column(0, 'id')), 'TEXT');
  assert.equal(displayCardType('projects', column(0, 'status')), 'TEXT');
  assert.equal(displayCardType('tasks', column(0, 'title')), 'TEXT');
  assert.equal(displayCardType('tasks', column(0, 'id', { declaredType: 'INTEGER' })), 'INTEGER');
  assert.equal(displayCardType('tasks', column(0, 'dueDate', { declaredType: '' })), '—');
});

test('empty schema yields no nodes or edges and a valid world size', () => {
  const { nodes, edges, width, height } = buildDiagram({ userVersion: 0, tables: [] });
  assert.deepEqual(nodes, []);
  assert.deepEqual(edges, []);
  assert.ok(Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0);
});

test('buildEdges skips foreign keys whose target table is absent', () => {
  const orphan = table('orphan', [column(0, 'x')], [fk(0, 0, 'missing', 'x', 'id')]);
  assert.deepEqual(buildEdges(layoutNodes([orphan])), []);
});

test('moveDiagram rebuilds edge anchors and bounds while keeping untouched node identity', () => {
  const base = buildDiagram(sqlite);
  const projects = base.nodes.find(node => node.name === 'projects');
  const tasks = base.nodes.find(node => node.name === 'tasks');
  const moved = moveDiagram(base, { tasks: { x: tasks.x + 1000, y: tasks.y + 500 } });
  assert.notEqual(moved, base);
  assert.equal(moved.nodes.find(node => node.name === 'projects'), projects);
  assert.equal(moved.nodes.find(node => node.name === 'tasks').x, tasks.x + 1000);
  assert.equal(moved.nodes.find(node => node.name === 'tasks').y, tasks.y + 500);
  const before = base.edges[0], after = moved.edges[0];
  assert.equal(after.id, before.id);
  assert.equal(after.sx, before.sx + 1000);
  assert.equal(after.sy, before.sy + 500);
  assert.equal(after.tx, before.tx);
  assert.equal(after.ty, before.ty);
  assert.equal(moved.width, base.width + 1000);
  assert.equal(moved.height, tasks.y + 500 + tasks.height + 200);
  assert.ok(moved.height > base.height);
});

test('moving either table keeps a single straight segment between the correct row anchors', () => {
  const base = buildDiagram(sqlite);
  const [project, task] = base.nodes;
  const projectRow = project.y + HEADER_HEIGHT + ROW_HEIGHT / 2;
  const taskRow = task.y + HEADER_HEIGHT + ROW_HEIGHT * 1.5;
  const assertStraight = ({ edges: [edge] }, sx, sy, tx, ty) => {
    assert.deepEqual([edge.sx, edge.sy, edge.tx, edge.ty], [sx, sy, tx, ty]);
    assert.equal(edge.path, `M ${sx} ${sy} L ${tx} ${ty}`);
  };
  assertStraight(base, task.x, taskRow, project.x + TABLE_WIDTH, projectRow);

  const sourceMoved = moveDiagram(base, { tasks: { x: task.x + 20, y: task.y - ROW_HEIGHT } });
  assertStraight(sourceMoved, task.x + 20, projectRow, project.x + TABLE_WIDTH, projectRow);

  const targetMoved = moveDiagram(sourceMoved, { projects: { x: task.x + TABLE_WIDTH + 60, y: project.y + 120 } });
  assertStraight(targetMoved, task.x + 20 + TABLE_WIDTH, projectRow, task.x + TABLE_WIDTH + 60, projectRow + 120);
});

test('moveDiagram clamps overrides and keeps geometry finite at extremes', () => {
  const base = buildDiagram(sqlite);
  const moved = moveDiagram(base, { projects: { x: -100, y: 30000 }, tasks: { x: 25000, y: -5 } });
  const projects = moved.nodes.find(node => node.name === 'projects');
  const tasks = moved.nodes.find(node => node.name === 'tasks');
  assert.deepEqual({ x: projects.x, y: projects.y }, { x: 0, y: 20000 });
  assert.deepEqual({ x: tasks.x, y: tasks.y }, { x: 20000, y: 0 });
  for (const edge of moved.edges) {
    for (const value of [edge.sx, edge.sy, edge.tx, edge.ty]) assert.ok(Number.isFinite(value));
    for (const value of edge.path.match(/-?\d+(\.\d+)?/g).map(Number)) assert.ok(Number.isFinite(value));
  }
});

test('moveDiagram with empty or identical overrides returns the original diagram', () => {
  const base = buildDiagram(sqlite);
  assert.equal(moveDiagram(base, {}), base);
  const projects = base.nodes.find(node => node.name === 'projects');
  assert.equal(moveDiagram(base, { projects: { x: projects.x, y: projects.y } }), base);
  assert.equal(moveDiagram(base, { missing: { x: 0, y: 0 } }), base);
});
