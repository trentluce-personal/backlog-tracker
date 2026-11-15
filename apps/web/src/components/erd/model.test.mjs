import assert from 'node:assert/strict';
import test from 'node:test';
import { candidate, deleteColumn, deleteTable, dependentCount, displayNameError, emptyModel, identifierError, replaceTable, snapshot, validateModel } from './model.ts';
import { autoPlacement, clamp, initialView, relationshipGeometry, tableHeight, zoomView } from './geometry.ts';
import * as geometry from './geometry.ts';

const column = (id, name, extra = {}) => ({ id, name, dataType: 'integer', nullable: false, primaryKey: false, unique: false, ...extra });
function fixture() {
  return { ...emptyModel(), tables: [
    { id: 'a', name: 'Accounts', x: 40, y: 40, columns: [column('a-id', 'id', { primaryKey: true }), column('a-parent', 'parent_id', { nullable: true })] },
    { id: 'b', name: 'Posts', x: 500, y: 80, columns: [column('b-id', 'id', { primaryKey: true }), column('b-owner', 'owner_id')] },
  ], foreignKeys: [{ id: 'fk-1', name: 'post_owner', sourceTableId: 'b', sourceColumnId: 'b-owner', targetTableId: 'a', targetColumnId: 'a-id' }] };
}
test('renaming tables and columns preserves stable endpoint identities and ordering', () => {
  const model = fixture();
  const next = replaceTable(model, { ...model.tables[0], name: 'People', columns: model.tables[0].columns.map((col, i) => i ? col : { ...col, name: 'person_id' }) });
  assert.deepEqual(validateModel(next), []);
  assert.deepEqual(next.foreignKeys, model.foreignKeys);
  assert.deepEqual(next.tables[0].columns.map(col => col.id), ['a-id', 'a-parent']);
  assert.equal(model.tables[0].name, 'Accounts');
});
test('table and column deletion removes only dependent FKs, including self links', () => {
  const model = fixture(); model.foreignKeys.push({ id: 'self', name: 'parent', sourceTableId: 'a', sourceColumnId: 'a-parent', targetTableId: 'a', targetColumnId: 'a-id' });
  assert.equal(dependentCount(model, 'a'), 2);
  assert.equal(dependentCount(model, 'a', 'a-parent'), 1);
  assert.equal(deleteColumn(model, 'a', 'a-parent').foreignKeys.length, 1);
  assert.equal(deleteColumn(model, 'a', 'a-id').foreignKeys.length, 0);
  assert.deepEqual(deleteTable(model, 'b').foreignKeys.map(fk => fk.id), ['self']);
  assert.equal(model.foreignKeys.length, 2);
});
test('key/type edits are rejected without mutating the valid candidate', () => {
  for (const change of [{ dataType: 'text' }, { primaryKey: false }, { nullable: true }]) {
    const model = fixture(); const original = snapshot('Original', model);
    const next = replaceTable(model, { ...model.tables[0], columns: model.tables[0].columns.map((col, i) => i ? col : { ...col, ...change }) });
    assert.ok(validateModel(next).length);
    assert.equal(snapshot('Original', model), original);
  }
});
test('only one PK, exact case uniqueness, global column IDs and matching FK types', () => {
  const model = fixture();
  model.tables[0].columns[1].primaryKey = true;
  assert.match(validateModel(model).join(' '), /only one primary/);
  model.tables[0].columns[1].primaryKey = false;
  model.tables[1].name = 'accounts'; assert.deepEqual(validateModel(model), []);
  model.tables[1].name = 'Accounts'; assert.match(validateModel(model).join(' '), /already exists/);
  model.tables[1].name = 'Posts'; model.tables[1].columns[0].id = 'a-id'; assert.match(validateModel(model).join(' '), /globally unique/);
});
test('self links, cycles, and multiple distinct column relationships are valid', () => {
  const model = fixture();
  model.foreignKeys.push({ id: 'self', name: 'self_fk', sourceTableId: 'a', sourceColumnId: 'a-parent', targetTableId: 'a', targetColumnId: 'a-id' }, { id: 'reverse', name: 'reverse_fk', sourceTableId: 'a', sourceColumnId: 'a-parent', targetTableId: 'b', targetColumnId: 'b-id' });
  assert.deepEqual(validateModel(model), []);
  model.foreignKeys[1].sourceColumnId = 'a-id';
  assert.match(validateModel(model).join(' '), /distinct columns/);
});
test('identifiers enforce UTF-8 bytes, controls, Unicode and exact text', () => {
  assert.equal(identifierError('é'.repeat(31)), '');
  assert.ok(identifierError('é'.repeat(32)));
  for (const name of ['', 'a\0b', 'a\nb', '\ud800']) assert.ok(identifierError(name));
  assert.equal(identifierError('  '), '');
  assert.equal(identifierError(' Exact Case '), '');
  assert.equal(displayNameError('😀'.repeat(100)), '');
  assert.ok(displayNameError('😀'.repeat(101)));
});
test('PostgreSQL system column names fail for columns only, with exact quoted case', () => {
  for (const name of ['tableoid', 'ctid', 'xmin', 'xmax', 'cmin', 'cmax']) {
    const model = fixture();
    const original = snapshot('Original', model);
    const renamed = replaceTable(model, { ...model.tables[0], columns: model.tables[0].columns.map((col, i) => i ? col : { ...col, name }) });
    assert.match(validateModel(renamed).join(' '), /reserved PostgreSQL system column/);
    assert.match(validateModel(renamed, true).join(' '), /reserved PostgreSQL system column/);
    assert.equal(snapshot('Original', model), original);
    renamed.tables[0].columns[0].name = name.toUpperCase();
    assert.deepEqual(validateModel(renamed), []);
    renamed.tables[0].name = name;
    renamed.foreignKeys[0].name = name;
    assert.deepEqual(validateModel(renamed), []);
  }
});
test('keyboard canvas pan is view-only with consistent screen-space shift steps', () => {
  const model = fixture(), before = snapshot('Original', model);
  for (const zoom of [.25, 1, 2]) {
    const view = { x: 32, y: 32, zoom };
    assert.deepEqual(geometry.panView(view, 'ArrowRight', false), { ...view, x: -8 });
    assert.deepEqual(geometry.panView(view, 'ArrowLeft', true), { ...view, x: 192 });
    assert.deepEqual(geometry.panView(view, 'ArrowDown', true), { ...view, y: -128 });
    assert.deepEqual(geometry.panView(view, 'ArrowUp', false), { ...view, y: 72 });
    assert.equal(geometry.panView(view, 'Enter', false), null);
    assert.deepEqual(view, { x: 32, y: 32, zoom });
  }
  assert.equal(snapshot('Original', model), before);
});
test('focus reveal pans offscreen bounds into view without changing model coordinates or zoom', () => {
  const model = fixture(), before = snapshot('Original', model);
  const bounds = { x: 1800, y: 900, width: 300, height: 48 }, size = { width: 800, height: 600 };
  for (const zoom of [.25, 1, 2]) {
    const view = { x: 32, y: 32, zoom }, next = geometry.revealBounds(view, bounds, size);
    assert.equal(next.zoom, zoom);
    assert.ok(next.x + bounds.x * zoom >= 12);
    assert.ok(next.x + (bounds.x + bounds.width) * zoom <= size.width - 12);
    assert.ok(next.y + bounds.y * zoom >= 12);
    assert.ok(next.y + (bounds.y + bounds.height) * zoom <= size.height - 12);
    assert.deepEqual(geometry.revealBounds(next, bounds, size), next);
  }
  const oversized = geometry.revealBounds(initialView, { ...bounds, width: 3000, height: 4000 }, size);
  assert.equal(oversized.x + bounds.x, 12);
  assert.equal(oversized.y + bounds.y, 12);
  assert.equal(snapshot('Original', model), before);
});
test('dense four-FK review fixture retains exact endpoints and distinguishable finite paths', () => {
  const model = fixture(); model.tables[1].x = model.tables[0].x + 400;
  model.foreignKeys.push(
    { id: 'manager', name: 'users_manager_fk', sourceTableId: 'a', sourceColumnId: 'a-parent', targetTableId: 'a', targetColumnId: 'a-id' },
    { id: 'cycle', name: 'users_posts_fk', sourceTableId: 'a', sourceColumnId: 'a-id', targetTableId: 'b', targetColumnId: 'b-id' },
    { id: 'parallel', name: 'posts_owner_fk', sourceTableId: 'b', sourceColumnId: 'b-id', targetTableId: 'a', targetColumnId: 'a-id' },
  );
  const lines = model.foreignKeys.map(fk => relationshipGeometry(model, fk));
  assert.equal(new Set(lines.map(line => line.path)).size, 4);
  for (const line of lines) assert.doesNotMatch(line.path, /NaN|Infinity/);
  assert.equal(lines[1].sy, model.tables[0].y + 48 + 36 + 18);
  assert.equal(lines[1].ty, model.tables[0].y + 48 + 18);
});
test('empty diagrams/tables save but cannot export SQL; bounds and limits validated', () => {
  assert.deepEqual(validateModel(emptyModel()), []); assert.ok(validateModel(emptyModel(), true).length);
  const model = fixture(); model.tables[0].columns = []; model.foreignKeys = [];
  assert.deepEqual(validateModel(model), []); assert.ok(validateModel(model, true).length);
  model.tables[0].x = 20001; assert.ok(validateModel(model).length);
  model.tables[0].x = NaN; assert.ok(validateModel(model).length);
  model.tables = Array.from({ length: 101 }, (_, i) => ({ id: `${i}`, name: `t${i}`, x: 0, y: 0, columns: [] }));
  assert.match(validateModel(model).join(' '), /100 tables/);
});
test('FK names are exact-case unique per source table and duplicate endpoints fail', () => {
  const model = fixture();
  model.foreignKeys.push({ ...model.foreignKeys[0], id: 'reverse', sourceTableId: 'a', sourceColumnId: 'a-parent', targetTableId: 'b', targetColumnId: 'b-id' });
  assert.deepEqual(validateModel(model), []);
  model.foreignKeys.push({ ...model.foreignKeys[0], id: 'duplicate' });
  assert.match(validateModel(model).join(' '), /already exists/);
  assert.match(validateModel(model).join(' '), /duplicates an existing/);
});
test('column and relationship limits reject candidates without truncation', () => {
  const model = fixture();
  model.tables[0].columns = Array.from({ length: 101 }, (_, i) => column(`extra-${i}`, `c${i}`));
  assert.match(validateModel(model).join(' '), /100 columns/);
  model.foreignKeys = Array.from({ length: 501 }, (_, i) => ({ ...model.foreignKeys[0], id: `fk${i}`, name: `fk${i}` }));
  assert.match(validateModel(model).join(' '), /500 relationships/);
  assert.equal(model.foreignKeys.length, 501);
});
test('snapshots include name, coordinates, ordered columns and FKs but strip revision', () => {
  const model = fixture(), baseline = snapshot('Name', model);
  assert.equal(snapshot('Name', { ...model, revision: 99 }), baseline);
  assert.notEqual(snapshot('Renamed', model), baseline);
  for (const mutate of [m => m.tables[0].x++, m => m.tables[0].columns.reverse(), m => m.foreignKeys[0].name = 'new']) {
    const next = candidate(model); mutate(next); assert.notEqual(snapshot('Name', next), baseline);
  }
  const copied = candidate(model); copied.tables[0].columns[0].name = 'copied'; assert.equal(model.tables[0].columns[0].name, 'id');
  assert.deepEqual(Object.keys(candidate({ ...model, revision: 4 })), ['kind', 'schemaVersion', 'dialect', 'tables', 'foreignKeys']);
});
test('auto-placement avoids existing tall tables and stays within coordinate bounds', () => {
  const model = fixture(); model.tables[0].columns = Array.from({ length: 100 }, (_, i) => column(`c${i}`, `c${i}`));
  const position = autoPlacement(model.tables);
  assert.ok(model.tables.every(table => position.x + 340 <= table.x || position.x >= table.x + 340 || position.y + 180 <= table.y || position.y >= table.y + tableHeight(table) + 60));
  assert.deepEqual(autoPlacement([], { x: 25000, y: 25000 }), { x: 20000, y: 20000 });
  assert.equal(clamp(-4), 0); assert.equal(clamp(25000), 20000);
});
test('zoom preserves world coordinate under viewport center and clamps zoom', () => {
  const center = { x: 400, y: 300 }, next = zoomView(initialView, 1.5, center);
  assert.equal((center.x - next.x) / next.zoom, (center.x - initialView.x) / initialView.zoom);
  assert.equal((center.y - next.y) / next.zoom, (center.y - initialView.y) / initialView.zoom);
  assert.equal(zoomView(next, 9, center).zoom, 2); assert.equal(zoomView(next, -1, center).zoom, .25);
});
test('relationship geometry attaches exact column rows and separates multiple/self lanes', () => {
  const model = fixture(), first = model.foreignKeys[0];
  const line = relationshipGeometry(model, first);
  assert.equal(line.sy, 80 + 48 + 36 + 18); assert.equal(line.ty, 40 + 48 + 18);
  model.foreignKeys.push({ ...first, id: 'parallel', name: 'other', sourceColumnId: 'b-id' });
  assert.notEqual(relationshipGeometry(model, first).path, relationshipGeometry(model, model.foreignKeys[1]).path);
  const self = { ...first, id: 'self', sourceTableId: 'a', sourceColumnId: 'a-parent' };
  model.foreignKeys.push(self, { ...self, id: 'self2' });
  assert.notEqual(relationshipGeometry(model, self).path, relationshipGeometry(model, model.foreignKeys.at(-1)).path);
  assert.equal(relationshipGeometry(model, { ...first, targetColumnId: 'missing' }), null);
});
test('aligned reverse/shared-endpoint FKs have separated hit lanes inside the 100px gap', () => {
  const model = { ...emptyModel(), tables: [
    { id: 'users', name: 'users', x: 40, y: 40, columns: [column('u-id', 'CTID', { primaryKey: true, dataType: 'text' }), column('u-manager', 'manager_id', { dataType: 'text' })] },
    { id: 'posts', name: 'posts', x: 440, y: 40, columns: [column('p-id', 'id', { primaryKey: true, dataType: 'text' }), column('p-user', 'user_id', { dataType: 'text' })] },
  ], foreignKeys: [
    { id: 'author', name: 'posts_author_fk', sourceTableId: 'posts', sourceColumnId: 'p-user', targetTableId: 'users', targetColumnId: 'u-id' },
    { id: 'manager', name: 'users_manager_fk', sourceTableId: 'users', sourceColumnId: 'u-manager', targetTableId: 'users', targetColumnId: 'u-id' },
    { id: 'owner', name: 'posts_owner_fk', sourceTableId: 'posts', sourceColumnId: 'p-id', targetTableId: 'users', targetColumnId: 'u-id' },
    { id: 'reverse', name: 'users_post_fk', sourceTableId: 'users', sourceColumnId: 'u-id', targetTableId: 'posts', targetColumnId: 'p-id' },
  ] };
  assert.deepEqual(validateModel(model), []);
  for (const y of [40, 140]) {
    model.tables[1].y = y;
    const lines = [0, 2, 3].map(index => relationshipGeometry(model, model.foreignKeys[index]));
    // The middle of every curve must have its own lane, more than the 16px
    // hit stroke apart, even when both endpoint rows share the same height.
    for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) {
      assert.ok(Math.abs(lines[i].labelY - lines[j].labelY) > 16);
    }
    const owner = lines[1];
    assert.ok(Math.abs(owner.labelY + 7 - (owner.sy + owner.ty) / 2) >= 32, 'owner must not collapse to the shared endpoint baseline');
    // Explicit, gap-bounded cubic controls avoid the old reflected S segment
    // backtracking over other lanes in a narrow gap.
    for (const line of lines) {
      const points = line.path.match(/-?\d+(?:\.\d+)?/g).map(Number);
      assert.equal(points.length, 14);
      for (let i = 0; i < points.length; i += 2) assert.ok(points[i] >= 340 && points[i] <= 440);
      assert.equal(points[0], line.sx); assert.equal(points[1], line.sy);
      assert.equal(points.at(-2), line.tx); assert.equal(points.at(-1), line.ty);
    }
  }
});
