import assert from 'node:assert/strict';
import test from 'node:test';
import { applyDraft, emptyModel, insertColumn, insertTable, snapshot, validateModel } from './model.ts';
import { autoPlacement, relationshipGeometry, tableHeight } from './geometry.ts';

test('direct table insertion supplies a unique valid name without assuming a primary key', () => {
  const original = emptyModel();
  const first = insertTable(original, 't1', { x: 40, y: 40 });
  const second = insertTable(first, 't2', autoPlacement(first.tables));
  assert.deepEqual(validateModel(second), []);
  assert.deepEqual(second.tables.map(table => table.name), ['table_1', 'table_2']);
  assert.deepEqual(second.tables.map(table => table.columns), [[], []]);
  assert.equal(original.tables.length, 0);
  assert.equal(first.tables.length, 1);
});

test('direct columns use unique local names and text/nullable defaults, with global identities', () => {
  let model = insertTable(emptyModel(), 't1', { x: 40, y: 40 });
  model = insertTable(model, 't2', { x: 420, y: 40 });
  model = insertColumn(insertColumn(insertColumn(model, 't1', 'c1'), 't1', 'c2'), 't2', 'c3');
  assert.deepEqual(validateModel(model), []);
  assert.deepEqual(model.tables[0].columns.map(column => column.name), ['column_1', 'column_2']);
  assert.equal(model.tables[1].columns[0].name, 'column_1');
  for (const column of model.tables.flatMap(table => table.columns)) {
    assert.equal(column.dataType, 'text');
    assert.equal(column.nullable, true);
    assert.equal(column.primaryKey, false);
    assert.equal(column.unique, false);
  }
});

test('invalid drafts survive rejection while the last valid model stays untouched, then corrected drafts apply', () => {
  const model = insertColumn(insertTable(emptyModel(), 't1', { x: 40, y: 40 }), 't1', 'c1');
  const before = snapshot('Saved', model);
  const draft = { kind: 'column', column: { ...model.tables[0].columns[0], name: 'ctid', unique: true } };
  const invalid = applyDraft(model, 't1', draft);
  assert.match(invalid.errors.join(' '), /reserved PostgreSQL/);
  assert.equal(invalid.model, model);
  assert.equal(draft.column.name, 'ctid');
  assert.equal(draft.column.unique, true);
  assert.equal(snapshot('Saved', model), before);
  const corrected = applyDraft(model, 't1', { ...draft, column: { ...draft.column, name: 'CTID' } });
  assert.deepEqual(corrected.errors, []);
  assert.equal(corrected.model.tables[0].columns[0].name, 'CTID');
  assert.equal(corrected.model.tables[0].columns[0].unique, true);
  assert.equal(snapshot('Saved', model), before, 'canceling a draft requires no rollback of the model');
  const unnamed = applyDraft(model, 't1', { kind: 'table', name: '' });
  assert.match(unnamed.errors.join(' '), /name is required/);
  assert.equal(unnamed.model, model);
});

test('draft validation respects duplicate names and FK key/type dependencies', () => {
  let model = insertTable(insertTable(emptyModel(), 't1', { x: 40, y: 40 }), 't2', { x: 420, y: 40 });
  model = insertColumn(insertColumn(model, 't1', 'c1'), 't2', 'c2');
  model = applyDraft(model, 't1', { kind: 'column', column: { ...model.tables[0].columns[0], unique: true } }).model;
  model.foreignKeys = [{ id: 'fk', name: 'fk_1', sourceTableId: 't2', sourceColumnId: 'c2', targetTableId: 't1', targetColumnId: 'c1' }];
  for (const edit of [{ unique: false }, { dataType: 'integer' }]) {
    const result = applyDraft(model, 't1', { kind: 'column', column: { ...model.tables[0].columns[0], ...edit } });
    assert.ok(result.errors.length);
    assert.equal(result.model, model);
  }
  assert.match(applyDraft(model, 't1', { kind: 'table', name: 'table_2' }).errors.join(' '), /already exists/);
});

test('expanded card placement reserves editor space without moving FK row anchors', () => {
  let model = insertTable(insertTable(emptyModel(), 't1', { x: 40, y: 40 }), 't2', { x: 420, y: 40 });
  model = insertColumn(insertColumn(model, 't1', 'c1'), 't2', 'c2');
  const fk = { id: 'fk', name: 'fk_1', sourceTableId: 't2', sourceColumnId: 'c2', targetTableId: 't1', targetColumnId: 'c1' };
  const before = relationshipGeometry(model, fk);
  const extras = { t1: 360, t2: 360 };
  const position = autoPlacement(model.tables, { x: 40, y: 200 }, extras);
  for (const table of model.tables) assert.ok(position.x >= table.x + 340 || position.x + 340 <= table.x || position.y >= table.y + tableHeight(table) + extras[table.id] + 60 || position.y + 300 <= table.y);
  assert.deepEqual(relationshipGeometry(model, fk), before);
  assert.equal(before.sy, 40 + 48 + 18);
  assert.equal(before.ty, 40 + 48 + 18);
});

test('stale drafts cannot silently apply to removed targets or recreate them', () => {
  const model = insertTable(emptyModel(), 't1', { x: 40, y: 40 });
  const table = applyDraft(model, 'removed', { kind: 'table', name: 'Recovered' });
  assert.deepEqual(table.errors, ['Table no longer exists.']);
  assert.equal(table.model, model);
  const column = applyDraft(model, 't1', { kind: 'column', column: { id: 'removed', name: 'Recovered', dataType: 'text', nullable: true, unique: false, primaryKey: false } });
  assert.deepEqual(column.errors, ['Column no longer exists.']);
  assert.equal(column.model, model);
});
