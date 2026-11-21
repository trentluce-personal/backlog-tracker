import { useState } from 'react';
import { listPropertyDataTypes, propertyDataTypes, scalarPropertyDataTypes } from './propertyDataTypes';

export function PropertyTypeEditor({ id, value, disabled, onChange, focusAnchor, invalid, describedBy }: { id: string; value: string; disabled: boolean; onChange: (value: string) => void; focusAnchor?: string; invalid?: boolean; describedBy?: string }) {
  const [custom, setCustom] = useState(!propertyDataTypes.includes(value) && Boolean(value));
  const vector = /^VECTOR<(INTEGER8|INTEGER16|INTEGER32|INTEGER64|FLOAT32|FLOAT64)>\((\d+)\)$/.exec(value);
  return <div className="property-type-editor">
    <select id={id} aria-label="Data type" disabled={disabled} data-property-focus={custom ? undefined : focusAnchor} aria-invalid={invalid || undefined} aria-describedby={describedBy} value={custom || (!propertyDataTypes.includes(value) && Boolean(value)) ? 'custom' : value} onChange={event => {
      setCustom(event.target.value === 'custom');
      if (event.target.value !== 'custom') onChange(event.target.value);
    }}>
      <option value="" disabled>Select data type</option>
      <optgroup label="Scalar types">{scalarPropertyDataTypes.map(type => <option key={type}>{type}</option>)}</optgroup>
      <optgroup label="List types">{listPropertyDataTypes.map(type => <option key={type}>{type}</option>)}</optgroup>
      <option value="custom">Type expression / union</option>
    </select>
    {custom && <input aria-label="Type expression" disabled={disabled} data-property-focus={focusAnchor} aria-invalid={invalid || undefined} aria-describedby={describedBy} value={value} onChange={event => onChange(event.target.value)} />}
    {(value === 'VECTOR' || vector) && <div className="schema-inline">
      <label>Dimensions<input type="number" min="1" max="4096" value={vector?.[2] ?? ''} disabled={disabled} onChange={event => { setCustom(true); onChange(`VECTOR<${vector?.[1] ?? 'FLOAT32'}>(${event.target.value})`); }} /></label>
      <label>Coordinates<select value={vector?.[1] ?? 'FLOAT32'} disabled={disabled} onChange={event => { setCustom(true); onChange(`VECTOR<${event.target.value}>(${vector?.[2] ?? 3})`); }}>{['FLOAT32', 'FLOAT64', 'INTEGER8', 'INTEGER16', 'INTEGER32', 'INTEGER64'].map(type => <option key={type}>{type}</option>)}</select></label>
    </div>}
  </div>;
}
