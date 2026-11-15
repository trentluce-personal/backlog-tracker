import { HttpError, object } from './validation.ts';

export const ERD_BODY_LIMIT = 2 * 1024 * 1024;
export const ER_DATA_TYPES = ['smallint', 'integer', 'bigint', 'numeric', 'real', 'double precision', 'text', 'varchar', 'boolean', 'uuid', 'date', 'timestamp', 'timestamptz', 'jsonb', 'bytea'] as const;
export type ErDataType = typeof ER_DATA_TYPES[number];
export interface ErColumn { id: string; name: string; dataType: ErDataType; nullable: boolean; primaryKey: boolean; unique: boolean }
export interface ErTable { id: string; name: string; x: number; y: number; columns: ErColumn[] }
export interface ErForeignKey { id: string; name: string; sourceTableId: string; sourceColumnId: string; targetTableId: string; targetColumnId: string }
export interface ErModel { kind: 'sql'; schemaVersion: 1; dialect: 'postgresql'; tables: ErTable[]; foreignKeys: ErForeignKey[] }
export type SavedErModel = ErModel & { revision: number };
const systemColumnNames = new Set(['tableoid', 'ctid', 'xmin', 'xmax', 'cmin', 'cmax']);

function invalid(message: string): never { throw new HttpError(400, message); }
function unicode(value: unknown): value is string {
  return typeof value === 'string' && !/[\p{Cc}]/u.test(value) && !/[\uD800-\uDFFF]/u.test(value);
}
function identifier(value: unknown, field: string): string {
  if (!unicode(value) || !value.length || Buffer.byteLength(value, 'utf8') > 63) invalid(`${field} must be nonempty, well-formed text of at most 63 UTF-8 bytes without control characters.`);
  return value;
}
export function erName(value: unknown): string {
  if (!unicode(value) || !value.trim() || [...value].length > 100) invalid('Name must be nonblank text of at most 100 characters without control characters.');
  return value.trim();
}
export function erRevision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid('Revision must be a nonnegative safe integer.');
  return value;
}
function flag(value: unknown): boolean {
  if (typeof value !== 'boolean') invalid('Column flags must be booleans.');
  return value;
}
function coordinate(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 20000) invalid('Coordinates must be finite numbers between 0 and 20000.');
  return value;
}
function array(value: unknown, max: number, field: string): unknown[] {
  if (!Array.isArray(value) || value.length > max) invalid(`${field} must be an array of at most ${max} entries.`);
  return value;
}
function distinct(seen: Set<string>, value: string, field: string) {
  if (seen.has(value)) invalid(`Duplicate ${field}.`);
  seen.add(value);
}

export function erModelInput(value: unknown): ErModel {
  const input = object(value, ['kind', 'schemaVersion', 'dialect', 'tables', 'foreignKeys']);
  if (input.kind !== 'sql' || input.schemaVersion !== 1 || input.dialect !== 'postgresql') invalid('Expected a schema-1 PostgreSQL SQL model.');
  const tableIds = new Set<string>(), tableNames = new Set<string>(), columnIds = new Set<string>();
  const tables = array(input.tables, 100, 'Tables').map(value => {
    const table = object(value, ['id', 'name', 'x', 'y', 'columns']);
    const id = identifier(table.id, 'Table ID'), name = identifier(table.name, 'Table name');
    distinct(tableIds, id, 'table ID'); distinct(tableNames, name, 'table name');
    const names = new Set<string>();
    const columns = array(table.columns, 100, 'Columns').map(value => {
      const column = object(value, ['id', 'name', 'dataType', 'nullable', 'primaryKey', 'unique']);
      const id = identifier(column.id, 'Column ID'), name = identifier(column.name, 'Column name');
      if (systemColumnNames.has(name)) invalid(`Column name "${name}" is reserved for a PostgreSQL system column. Choose a different column name.`);
      distinct(columnIds, id, 'column ID'); distinct(names, name, 'column name');
      if (!ER_DATA_TYPES.includes(column.dataType as ErDataType)) invalid('Unsupported PostgreSQL column data type.');
      const result: ErColumn = { id, name, dataType: column.dataType as ErDataType, nullable: flag(column.nullable), primaryKey: flag(column.primaryKey), unique: flag(column.unique) };
      if (result.primaryKey && result.nullable) invalid('Primary key columns cannot be nullable.');
      return result;
    });
    if (columns.filter(column => column.primaryKey).length > 1) invalid('Only one primary key column per table is supported.');
    return { id, name, x: coordinate(table.x), y: coordinate(table.y), columns };
  });
  const fkIds = new Set<string>(), endpoints = new Set<string>(), fkNames = new Map<string, Set<string>>();
  const foreignKeys = array(input.foreignKeys, 500, 'Foreign keys').map(value => {
    const fk = object(value, ['id', 'name', 'sourceTableId', 'sourceColumnId', 'targetTableId', 'targetColumnId']);
    const result: ErForeignKey = {
      id: identifier(fk.id, 'Foreign key ID'), name: identifier(fk.name, 'Foreign key name'),
      sourceTableId: identifier(fk.sourceTableId, 'Source table ID'), sourceColumnId: identifier(fk.sourceColumnId, 'Source column ID'),
      targetTableId: identifier(fk.targetTableId, 'Target table ID'), targetColumnId: identifier(fk.targetColumnId, 'Target column ID'),
    };
    distinct(fkIds, result.id, 'foreign key ID');
    const names = fkNames.get(result.sourceTableId) ?? new Set<string>();
    distinct(names, result.name, 'foreign key constraint name within a source table'); fkNames.set(result.sourceTableId, names);
    distinct(endpoints, JSON.stringify([result.sourceTableId, result.sourceColumnId, result.targetTableId, result.targetColumnId]), 'foreign key endpoints');
    const source = tables.find(table => table.id === result.sourceTableId)?.columns.find(column => column.id === result.sourceColumnId);
    const target = tables.find(table => table.id === result.targetTableId)?.columns.find(column => column.id === result.targetColumnId);
    if (!source || !target) invalid('Foreign key endpoints must identify existing columns in their respective tables.');
    if (source.id === target.id) invalid('Self-referencing foreign keys must use distinct columns.');
    if (!target.primaryKey && !target.unique) invalid('Foreign keys must target a primary key or unique column.');
    if (source.dataType !== target.dataType) invalid('Foreign key column data types must match exactly.');
    return result;
  });
  return { kind: 'sql', schemaVersion: 1, dialect: 'postgresql', tables, foreignKeys };
}
