import { ExternalLink, Link } from 'lucide-react';
import type { ModelConstraint, ModelInput, ModelReference } from '../types';
import { PropertyIndexes } from './PropertyIndexes';
import { Icon } from './Icon';
import type { ReferenceResolution } from './useReferenceCatalog';
import { propertySchema } from './schemaObjects';
import './NodeProperties.css';

export function ReadOnlyReferenceDetails({ reference, resolution, model, constraints = [], loading, error, onRefresh }: {
  reference: ModelReference; resolution: ReferenceResolution; model: ModelInput; constraints?: ModelConstraint[]; loading: boolean; error: string; onRefresh: () => void;
}) {
  const { definition, modelName, status } = resolution;
  return <section className="reference-details" aria-label="Reference target">
    <p className="reference-type"><Icon icon={reference.classification === 'Internal Reference' ? Link : ExternalLink} />{reference.classification}</p>
    <dl className="modeling-detail-endpoints"><dt>Target model</dt><dd>{modelName}<code>{reference.target.modelId}</code></dd><dt>Target node</dt><dd>{definition?.name ?? reference.target.nodeId}{definition && <code>{reference.target.nodeId}</code>}</dd></dl>
    <p className={definition || status === 'Resolving reference…' ? 'reference-status' : 'modeling-error'} role="status">{status}</p>
    {error && reference.classification === 'External Reference' && <p className="modeling-error" role="alert">{error}</p>}
    {reference.classification === 'External Reference' && <button className="text-button" type="button" disabled={loading} onClick={onRefresh}>{error || !definition ? 'Retry' : 'Refresh target'}</button>}
    {definition && <><dl className="modeling-detail-endpoints"><dt>Data classification</dt><dd><span className="reference-classification modeling-name-row" data-classification={definition.classification}>{definition.classification}</span></dd><dt>Draft</dt><dd>{definition.draft ? 'Yes' : 'No'}</dd></dl>
      {definition.displayName && <dl className="modeling-detail-endpoints"><dt>Display name</dt><dd>{definition.displayName}</dd></dl>}
      {definition.impliedLabels.length > 0 && <section><h3>Implied labels</h3><ul className="schema-chips">{definition.impliedLabels.map(label => <li key={label}>{label}</li>)}</ul></section>}
      <section className="node-properties" aria-label="Target properties">
        <h3>Properties <span>Read only</span></h3>
        <div className="node-properties-scroll" tabIndex={0} role="region" aria-label="Target property table">
          <table><caption className="sr-only">Read-only target properties</caption>
            <thead><tr>{['Name', 'Data type', 'Key', 'Unique', 'Required', 'Indexes'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
            <tbody>{definition.properties.map(property => <tr key={property.name}>
              <td><span className="node-property-text">{property.name}</span>
                <details className="node-property-description"><summary>Description</summary>
                  <div className="node-property-description-body"><div className="node-property-text">{property.description}</div></div>
                </details>
              </td>
              <td>{property.dataType}</td>
              {(() => { const state = propertySchema(property.name, { kind: 'node', definitionId: reference.target.nodeId }, constraints, []); return (['key', 'unique', 'required'] as const).map(flag => <td key={flag}>{state[flag] ? 'Yes' : '—'}</td>); })()}
              <td><PropertyIndexes readOnly name={property.name} target={{ kind: 'node', definitionId: reference.target.nodeId }} model={model} /></td>
            </tr>)}</tbody>
          </table>
        </div>
        {!definition.properties.length && <p className="modeling-hint">No properties</p>}
      </section>
    </>}
  </section>;
}
