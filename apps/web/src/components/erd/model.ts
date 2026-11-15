// @ts-expect-error Explicit extension supports the repository's native Node TS tests.
import { erDataTypes, type ErColumn, type ErModel, type ErTable } from '../../erd-types.ts';

export function emptyModel(): ErModel { return { kind: 'sql', schemaVersion: 1, dialect: 'postgresql', tables: [], foreignKeys: [] }; }
export function candidate(model: ErModel): ErModel {
  return { kind: 'sql', schemaVersion: 1, dialect: 'postgresql', tables: structuredClone(model.tables), foreignKeys: structuredClone(model.foreignKeys) };
}
export function snapshot(name: string, model: ErModel): string { return JSON.stringify({ name, model: candidate(model) }); }
const systemColumns = new Set(['tableoid', 'ctid', 'xmin', 'xmax', 'cmin', 'cmax']);
export function identifierError(name: string): string {
  if (!name.length) return 'A name is required.';
  if (/[\p{Cc}\p{Cs}]/u.test(name)) return 'Names cannot contain control characters or malformed Unicode.';
  if (new TextEncoder().encode(name).length > 63) return 'Identifiers must be at most 63 UTF-8 bytes.';
  return '';
}
export function displayNameError(name: string): string {
  if (!name.trim()) return 'A model name is required.';
  if (/[\p{Cc}\p{Cs}]/u.test(name)) return 'Model names cannot contain control characters or malformed Unicode.';
  return [...name].length > 100 ? 'Model names must be at most 100 characters.' : '';
}
export function validateModel(model: ErModel, exporting = false): string[] {
  const errors: string[] = [];
  if (model.kind !== 'sql' || model.schemaVersion !== 1 || model.dialect !== 'postgresql') errors.push('Unsupported ERD format.');
  if (model.tables.length > 100) errors.push('A model can have at most 100 tables.');
  if (model.foreignKeys.length > 500) errors.push('A model can have at most 500 relationships.');
  if (exporting && !model.tables.length) errors.push('Add a table before exporting SQL.');
  const tableNames = new Set<string>(), ids = new Set<string>(), columnIds = new Set<string>(), fkNames = new Set<string>(), endpoints = new Set<string>();
  for (const table of model.tables) {
    const invalid = identifierError(table.name);
    if (invalid) errors.push(`Table “${table.name}”: ${invalid}`);
    if (tableNames.has(table.name)) errors.push(`Table “${table.name}” already exists.`);
    tableNames.add(table.name);
    if (identifierError(table.id) || ids.has(table.id)) errors.push('Table IDs must be valid and unique.');
    ids.add(table.id);
    if (![table.x, table.y].every(value => Number.isFinite(value) && value >= 0 && value <= 20000)) errors.push(`Table “${table.name}” is outside the canvas bounds.`);
    if (table.columns.length > 100) errors.push(`Table “${table.name}” can have at most 100 columns.`);
    if (exporting && !table.columns.length) errors.push(`Add a column to “${table.name}” before exporting SQL.`);
    if (table.columns.filter(column => column.primaryKey).length > 1) errors.push(`Table “${table.name}” can have only one primary key.`);
    const names = new Set<string>();
    for (const column of table.columns) {
      const error = identifierError(column.name);
      if (error) errors.push(`${table.name}.${column.name}: ${error}`);
      if (systemColumns.has(column.name)) errors.push(`${table.name}.${column.name}: This is a reserved PostgreSQL system column name.`);
      if (names.has(column.name)) errors.push(`Column “${column.name}” already exists in “${table.name}”.`);
      names.add(column.name);
      if (identifierError(column.id) || columnIds.has(column.id)) errors.push('Column IDs must be valid and globally unique.');
      columnIds.add(column.id);
      if (!erDataTypes.includes(column.dataType)) errors.push(`${table.name}.${column.name}: Unsupported PostgreSQL type.`);
      if (![column.nullable, column.primaryKey, column.unique].every(value => typeof value === 'boolean')) errors.push(`${table.name}.${column.name}: Invalid column flags.`);
      if (column.primaryKey && column.nullable) errors.push(`${table.name}.${column.name}: A primary key cannot be nullable.`);
    }
  }
  const fkIds = new Set<string>();
  for (const fk of model.foreignKeys) {
    const error = identifierError(fk.name);
    if (error) errors.push(`Relationship “${fk.name}”: ${error}`);
    const scopedName = JSON.stringify([fk.sourceTableId, fk.name]);
    if (fkNames.has(scopedName)) errors.push(`Relationship “${fk.name}” already exists in this source table.`);
    fkNames.add(scopedName);
    if (identifierError(fk.id) || fkIds.has(fk.id)) errors.push('Relationship IDs must be valid and unique.');
    fkIds.add(fk.id);
    const source = model.tables.find(table => table.id === fk.sourceTableId)?.columns.find(column => column.id === fk.sourceColumnId);
    const target = model.tables.find(table => table.id === fk.targetTableId)?.columns.find(column => column.id === fk.targetColumnId);
    if (!source || !target) errors.push(`Relationship “${fk.name}” has a missing column.`);
    else {
      if (source.id === target.id) errors.push(`Relationship “${fk.name}” must connect distinct columns.`);
      if (!target.primaryKey && !target.unique) errors.push(`Relationship “${fk.name}” must target a primary or unique column.`);
      if (source.dataType !== target.dataType) errors.push(`Relationship “${fk.name}” requires matching column types.`);
    }
    const tuple = JSON.stringify([fk.sourceTableId, fk.sourceColumnId, fk.targetTableId, fk.targetColumnId]);
    if (endpoints.has(tuple)) errors.push(`Relationship “${fk.name}” duplicates an existing connection.`);
    endpoints.add(tuple);
  }
  return errors;
}
export function replaceTable(model: ErModel, table: ErTable): ErModel {
  return { ...model, tables: model.tables.map(item => item.id === table.id ? table : item) };
}
export function deleteTable(model: ErModel, id: string): ErModel {
  return { ...model, tables: model.tables.filter(table => table.id !== id), foreignKeys: model.foreignKeys.filter(fk => fk.sourceTableId !== id && fk.targetTableId !== id) };
}
export function deleteColumn(model: ErModel, tableId: string, columnId: string): ErModel {
  return { ...model, tables: model.tables.map(table => table.id === tableId ? { ...table, columns: table.columns.filter(column => column.id !== columnId) } : table), foreignKeys: model.foreignKeys.filter(fk => fk.sourceColumnId !== columnId && fk.targetColumnId !== columnId) };
}
export function dependentCount(model: ErModel, tableId: string, columnId?: string): number {
  return model.foreignKeys.filter(fk => columnId ? fk.sourceColumnId === columnId || fk.targetColumnId === columnId : fk.sourceTableId === tableId || fk.targetTableId === tableId).length;
}
export function nextName(prefix: string, names: string[]): string {
  let index = 1;
  while (names.includes(`${prefix}_${index}`)) index++;
  return `${prefix}_${index}`;
}
export function insertTable(model: ErModel, id: string, position: { x: number; y: number }): ErModel {
  return { ...model, tables: [...model.tables, { id, name: nextName('table', model.tables.map(table => table.name)), ...position, columns: [] }] };
}
export function insertColumn(model: ErModel, tableId: string, id: string): ErModel {
  const table = model.tables.find(table => table.id === tableId);
  if (!table) return model;
  const column: ErColumn = { id, name: nextName('column', table.columns.map(column => column.name)), dataType: 'text', nullable: true, primaryKey: false, unique: false };
  return replaceTable(model, { ...table, columns: [...table.columns, column] });
}
export type TableDraft = { kind: 'table'; name: string } | { kind: 'column'; column: ErColumn };
export function applyDraft(model: ErModel, tableId: string, draft: TableDraft): { model: ErModel; errors: string[] } {
  const table = model.tables.find(table => table.id === tableId);
  if (!table) return { model, errors: ['Table no longer exists.'] };
  if (draft.kind === 'column' && !table.columns.some(column => column.id === draft.column.id)) return { model, errors: ['Column no longer exists.'] };
  const next = replaceTable(model, draft.kind === 'table' ? { ...table, name: draft.name } : { ...table, columns: table.columns.map(column => column.id === draft.column.id ? draft.column : column) });
  const errors = validateModel(next);
  return { model: errors.length ? model : next, errors };
}
