import { erModelInput } from './erd-schema.ts';
import { HttpError, object } from './validation.ts';

const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;

export function exportErModel(value: unknown) {
  const model = erModelInput(object(value, ['model']).model);
  if (!model.tables.length) throw new HttpError(400, 'Add at least one table before exporting SQL.');
  const empty = model.tables.find(table => !table.columns.length);
  if (empty) throw new HttpError(400, `Add at least one column to table ${JSON.stringify(empty.name)} before exporting SQL.`);
  // PostgreSQL auto-generated PK/UNIQUE names can collide with explicit FK
  // names and other tables' indexes. Reserve deterministic names ourselves.
  const reserved = new Set([...model.tables.map(table => table.name), ...model.foreignKeys.map(fk => fk.name)]);
  let suffix = 0;
  function constraint(kind: string) {
    let name: string;
    do { name = `erd_${kind}_${++suffix}`; } while (reserved.has(name));
    reserved.add(name);
    return quote(name);
  }
  const statements = model.tables.map(table => {
    const columns = table.columns.map(column => {
      let sql = `  ${quote(column.name)} ${column.dataType}`;
      if (!column.nullable) sql += ' NOT NULL';
      if (column.primaryKey) sql += ` CONSTRAINT ${constraint('pk')} PRIMARY KEY`;
      else if (column.unique) sql += ` CONSTRAINT ${constraint('unique')} UNIQUE`;
      return sql;
    });
    return `CREATE TABLE ${quote(table.name)} (\n${columns.join(',\n')}\n);`;
  });
  for (const fk of model.foreignKeys) {
    const source = model.tables.find(table => table.id === fk.sourceTableId)!;
    const target = model.tables.find(table => table.id === fk.targetTableId)!;
    const sourceColumn = source.columns.find(column => column.id === fk.sourceColumnId)!;
    const targetColumn = target.columns.find(column => column.id === fk.targetColumnId)!;
    statements.push(`ALTER TABLE ${quote(source.name)} ADD CONSTRAINT ${quote(fk.name)} FOREIGN KEY (${quote(sourceColumn.name)}) REFERENCES ${quote(target.name)} (${quote(targetColumn.name)});`);
  }
  return { filename: 'schema.sql', mediaType: 'application/sql', content: statements.join('\n\n') + '\n' };
}
