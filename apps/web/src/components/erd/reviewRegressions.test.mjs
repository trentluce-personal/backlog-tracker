import assert from 'node:assert/strict';
import test from 'node:test';
import * as editing from './editing.ts';
import * as geometry from './geometry.ts';
import { deleteColumn, deleteTable, emptyModel, validateModel } from './model.ts';

const column = (id) => ({ id, name: id, dataType: 'text', primaryKey: false, unique: true, nullable: true });
const table = (id, x, y) => ({ id, name: id, x, y, columns: [] });

test('outstanding edits block persistence independently of name-form dirtiness', () => {
  assert.deepEqual(editing.persistenceState(false, 1, false, false), { blocked: true, dirty: true });
  assert.deepEqual(editing.persistenceState(false, 0, true, true), { blocked: true, dirty: true });
  assert.deepEqual(editing.persistenceState(false, 0, false, true), { blocked: false, dirty: true });
  assert.deepEqual(editing.persistenceState(false, 0, false, false), { blocked: false, dirty: false });
  assert.deepEqual(editing.persistenceState(true, 0, false, false), { blocked: false, dirty: true });
});

test('table/column collisions and punctuation keep distinct draft identities and exact deletion', () => {
  const id = 'a" ] # : 😀';
  const model = { ...emptyModel(), tables: [{ ...table(id, 12, 12), columns: [column(id)] }] };
  assert.deepEqual(validateModel(model), []);
  const tableKey = editing.draftKey(id), columnKey = editing.draftKey(id, id);
  assert.notEqual(tableKey, columnKey);
  assert.notEqual(editing.draftKey('a,b', 'c'), editing.draftKey('a', 'b,c'));
  const drafts = { [tableKey]: { tableId: id, draft: { kind: 'table', name: 'retained' } }, [columnKey]: { tableId: id, draft: { kind: 'column', column: column(id) } } };
  const retained = editing.removeColumnDraft(drafts, id, id);
  assert.deepEqual(Object.keys(retained), [tableKey]);
  assert.equal(retained[tableKey].draft.name, 'retained');
  const elements = [{ dataset: { tableId: 'other' } }, { dataset: { tableId: id } }];
  assert.equal(editing.findByData(elements, 'tableId', id), elements[1]);
});

test('deleted relationship drafts report failure after direct or dependent deletion and preserve unrelated edits', () => {
  const a = { ...table('a', 12, 12), columns: [column('ac')] }, b = { ...table('b', 400, 12), columns: [column('bc')] };
  const fk = { id: 'fk', name: 'fk', sourceTableId: 'a', sourceColumnId: 'ac', targetTableId: 'b', targetColumnId: 'bc' };
  const other = { ...fk, id: 'other', name: 'other', sourceTableId: 'b', sourceColumnId: 'bc', targetTableId: 'a', targetColumnId: 'ac' };
  const model = { ...emptyModel(), tables: [a, b], foreignKeys: [fk, other] };
  const draft = { ...fk, name: 'unsaved name' };
  for (const removed of [{ ...model, foreignKeys: [other] }, deleteColumn(model, 'a', 'ac'), deleteTable(model, 'b')]) {
    const result = editing.applyRelationshipDraft(removed, draft, true);
    assert.match(result.errors.join(' '), /no longer exists.*Close.*new relationship/);
    assert.equal(result.model, removed);
    assert.equal(draft.name, 'unsaved name');
  }
  const unrelated = { ...model, foreignKeys: [fk] };
  assert.deepEqual(editing.applyRelationshipDraft(unrelated, draft, true).errors, []);
});

test('expansion at (12,12) cannot obscure neighbor at (12,212), including chained cards', () => {
  const tables = [table('top', 12, 12), table('below', 12, 212), table('last', 12, 412), table('beside', 392, 12)];
  const before = structuredClone(tables);
  for (const height of [136, 360]) {
    const displayed = geometry.expandedLayout(tables, { top: height });
    assert.ok(displayed[1].y >= displayed[0].y + geometry.tableHeight(displayed[0]) + height + 12);
    assert.ok(displayed[2].y >= displayed[1].y + geometry.tableHeight(displayed[1]) + 12);
    assert.deepEqual(displayed[3], tables[3]);
  }
  assert.deepEqual(tables, before, 'opening editors must not mutate persisted positions');
  assert.deepEqual(geometry.expandedLayout(tables, {}), tables, 'closing editors restores the stored layout');
});

test('temporary card shifts keep FK anchors on the displayed rows and never change export coordinates', () => {
  const a = { ...table('a', 12, 12), columns: [column('ac')] }, b = { ...table('b', 12, 212), columns: [column('bc')] };
  const fk = { id: 'fk', name: 'fk', sourceTableId: 'a', sourceColumnId: 'ac', targetTableId: 'b', targetColumnId: 'bc' };
  const model = { ...emptyModel(), tables: [b, a], foreignKeys: [fk] };
  const original = JSON.stringify(model);
  const tables = geometry.expandedLayout(model.tables, { a: 360, b: 360 });
  const line = geometry.relationshipGeometry({ ...model, tables }, fk);
  assert.equal(line.sy, tables[1].y + geometry.HEADER_HEIGHT + geometry.ROW_HEIGHT / 2);
  assert.equal(line.ty, tables[0].y + geometry.HEADER_HEIGHT + geometry.ROW_HEIGHT / 2);
  assert.ok(tables[0].y > b.y);
  assert.equal(JSON.stringify(model), original);
  assert.deepEqual(geometry.expandedLayout(model.tables, {}), model.tables);
});
