import { Plus } from 'lucide-react';
import type { DefinitionTarget, ModelConstraint, ModelIndex } from '../types';
import { Icon } from './Icon';
import { sameTarget } from './schemaObjects';
import './NodeProperties.css';
import './IndexesTable.css';

export function IndexesTable({ indexes, constraints, definitions, readOnly, onAdd, onEdit, onDelete }: {
  indexes: ModelIndex[]; constraints: ModelConstraint[];
  definitions: { target: DefinitionTarget; name: string }[];
  readOnly: boolean; onAdd: () => void; onEdit: (index: ModelIndex) => void; onDelete: (index: ModelIndex) => void;
}) {
  function configuration(index: ModelIndex, owner?: ModelConstraint) {
    return <details><summary>Configuration</summary><dl>
      <dt>Targets</dt><dd><ul>{index.targets.map(target => <li key={`${target.kind}-${target.definitionId}`}>
        {target.kind} · {definitions.find(definition => sameTarget(definition.target, target))?.name ?? target.definitionId}<code>{target.definitionId}</code>
      </li>)}</ul>{!index.targets.length && '—'}</dd>
      {owner && <><dt>Owner</dt><dd>{owner.kind} · {owner.name}<code>{owner.id}</code></dd></>}
      <dt>Filter properties</dt><dd>{index.filterProperties.length ? <ol>{index.filterProperties.map(name => <li key={name}>{name}</li>)}</ol> : '—'}</dd>
      <dt>Configuration JSON</dt><dd><pre>{JSON.stringify(index.config, null, 2)}</pre></dd>
    </dl></details>;
  }
  return <section className="node-properties indexes-table" aria-label="Indexes">
    <div className="node-properties-heading"><h3>Indexes</h3></div>
    <div className="node-properties-scroll" tabIndex={0} role="region" aria-label="Index table">
      <table><caption className="sr-only">Indexes</caption>
        <thead><tr>{['Name', 'Type', 'Properties', 'Configuration', 'Status', 'Actions'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>
          {indexes.map(index => <tr key={index.id}>
            <td>{index.name}</td><td>{index.kind}</td><td><ol>{index.properties.map(name => <li key={name}>{name}</li>)}</ol></td>
            <td>{configuration(index)}</td><td>{[index.draft ? 'Draft' : 'Active', readOnly && 'Read only'].filter(Boolean).join(' · ')}</td>
            <td className="node-property-actions">{!readOnly && <><button type="button" aria-label={`Edit index ${index.name}`} onClick={() => onEdit(index)}>Edit</button><button type="button" aria-label={`Delete index ${index.name}`} onClick={() => onDelete(index)}>Delete</button></>}</td>
          </tr>)}
          {constraints.filter(owner => owner.kind === 'KEY' || owner.kind === 'UNIQUE').map(owner => <tr key={`owned-${owner.id}`}>
            <td>{owner.name}</td><td>RANGE</td><td><ol>{owner.properties.map(name => <li key={name}>{name}</li>)}</ol></td>
            <td>{configuration({ ...owner, kind: 'RANGE', targets: [owner.target], filterProperties: [], config: {} }, owner)}</td>
            <td>Derived · Read only{owner.draft ? ' · Draft' : ''}</td><td />
          </tr>)}
          {!readOnly && <tr className="node-properties-add-row"><td colSpan={5} /><td className="node-property-add-action"><button type="button" onClick={onAdd}><Icon icon={Plus} />Add index</button></td></tr>}
        </tbody>
      </table>
    </div>
  </section>;
}
