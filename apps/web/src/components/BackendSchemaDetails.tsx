import type { BackendSchemaResponse } from '../api';
import { ErPanel } from './erd/ErPanel';
import { displayDefault, displayType, resolvePair, type Diagram, type SqliteForeignKey, type SqliteTable } from './backendSchemaDiagram';

export type DockSelection = { kind: 'node'; name: string } | { kind: 'edge'; id: string } | { kind: 'json' } | null;

const origins: Record<string, string> = { c: 'Created index', u: 'UNIQUE constraint', pk: 'Primary key' };

function Ddl({ sql, label }: { sql: string | null; label: string }) {
  return sql === null ? null : <details className="backend-schema-ddl">
    <summary aria-label={`Exact DDL: ${label}`}>Exact DDL</summary>
    <pre><code>{sql}</code></pre>
  </details>;
}

function groupForeignKeys(table: SqliteTable): SqliteForeignKey[][] {
  const groups = new Map<number, SqliteForeignKey[]>();
  for (const key of table.foreignKeys) {
    const group = groups.get(key.id) ?? [];
    group.push(key);
    groups.set(key.id, group);
  }
  return [...groups.values()].map(group => [...group].sort((a, b) => a.sequence - b.sequence));
}

function ForeignKeys({ table, tables }: { table: SqliteTable; tables: SqliteTable[] }) {
  const groups = groupForeignKeys(table);
  return <div className="backend-schema-card-section"><h3>Foreign keys</h3>
    {groups.length ? <ul>{groups.map(group => {
      const target = tables.find(item => item.name === group[0].table);
      return <li key={group[0].id}>
        {group.map(key => <code key={key.sequence}>{table.name}.{key.from} → {key.table}.{resolvePair(key, target).toDisplay}</code>)}
        <span>ON DELETE {group[0].onDelete} · ON UPDATE {group[0].onUpdate} · MATCH {group[0].match}</span>
      </li>;
    })}</ul> : <span className="backend-schema-muted">None</span>}
  </div>;
}

function Indexes({ table }: { table: SqliteTable }) {
  return <div className="backend-schema-card-section"><h3>Indexes</h3>
    {table.indexes.length ? <ul>{table.indexes.map(index => <li key={index.name}>
      <code>{index.name} ({index.columns.map(column => column.name ?? '(expression)').join(', ')})</code>
      <span>{origins[index.origin] ?? index.origin} · Unique: {index.unique ? 'Yes' : 'No'} · Partial: {index.partial ? 'Yes' : 'No'}</span>
      <Ddl sql={index.ddl} label={index.name} />
    </li>)}</ul> : <span className="backend-schema-muted">None</span>}
  </div>;
}

function Fields({ table }: { table: SqliteTable }) {
  return <div className="backend-schema-table-scroll" tabIndex={0} role="region" aria-label={`${table.name} fields`}>
    <table><thead><tr><th scope="col">Field</th><th scope="col">Declared type</th><th scope="col">NOT NULL</th><th scope="col">Primary key</th><th scope="col">Default SQL</th></tr></thead>
      <tbody>{table.columns.map(column => <tr key={column.position}>
        <th scope="row"><code>{column.name}</code></th><td><code>{displayType(column.declaredType)}</code></td>
        <td>{column.notNull ? 'Yes' : 'No'}</td><td>{column.primaryKeyPosition ? `Yes (${column.primaryKeyPosition})` : 'No'}</td>
        <td><code>{displayDefault(column.defaultSql)}</code></td>
      </tr>)}</tbody></table>
  </div>;
}

function NodeDetails({ table, tables, onClose }: { table: SqliteTable; tables: SqliteTable[]; onClose: () => void }) {
  return <ErPanel title={table.name} onClose={onClose}>
    <Fields table={table} />
    <ForeignKeys table={table} tables={tables} />
    <Indexes table={table} />
    <Ddl sql={table.ddl} label={table.name} />
  </ErPanel>;
}

function EdgeDetails({ edge, onClose }: { edge: Diagram['edges'][number]; onClose: () => void }) {
  return <ErPanel title={`${edge.sourceName} → ${edge.targetName}`} onClose={onClose}>
    <div className="backend-schema-card-section"><h3>Foreign key</h3>
      <ul>{edge.pairs.map(pair => <li key={`${pair.from}-${pair.toDisplay}`}>
        <code>{edge.sourceName}.{pair.from} → {edge.targetName}.{pair.toDisplay}</code>
      </li>)}</ul>
      <span>ON DELETE {edge.onDelete} · ON UPDATE {edge.onUpdate} · MATCH {edge.match}</span>
    </div>
  </ErPanel>;
}

function JsonDetails({ storage, onClose }: { storage: BackendSchemaResponse['jsonStorage']; onClose: () => void }) {
  return <ErPanel title="JSON storage" onClose={onClose}>
    {storage.map(item => <div className="backend-schema-card-section" key={item.name}>
      <h3>{item.name}<span className="backend-schema-muted">Schema v{item.schemaVersion}</span></h3>
      <code>{item.fields.join(', ')}</code>
      <dl>{item.collections.map(collection => <div key={collection.name}><dt>{collection.name}</dt><dd>{collection.fields.join(', ')}</dd></div>)}</dl>
    </div>)}
  </ErPanel>;
}

export function BackendSchemaDetails({ data, diagram, dock, onClose }: { data: BackendSchemaResponse; diagram: Diagram; dock: DockSelection; onClose: () => void }) {
  if (!dock) return null;
  if (dock.kind === 'json') return <JsonDetails storage={data.jsonStorage} onClose={onClose} />;
  if (dock.kind === 'edge') {
    const edge = diagram.edges.find(item => item.id === dock.id);
    return edge ? <EdgeDetails edge={edge} onClose={onClose} /> : null;
  }
  const table = data.sqlite.tables.find(item => item.name === dock.name);
  return table ? <NodeDetails table={table} tables={data.sqlite.tables} onClose={onClose} /> : null;
}
