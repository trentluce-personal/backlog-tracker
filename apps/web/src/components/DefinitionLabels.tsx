import { useState } from 'react';
import type { ModelDefinition } from '../types';
import { identifierError, malformedUnicode } from './schemaObjects';

export function DefinitionLabels({ definition, onChange, label, onLabel }: { definition: ModelDefinition; onChange: (changes: Partial<ModelDefinition>) => void; label: string; onLabel: (value: string) => void }) {
  const [error, setError] = useState('');
  const [errorField, setErrorField] = useState<'display' | 'label' | null>(null);
  return <section className="schema-panel" aria-label="Label metadata">
    <label htmlFor="definition-display-name">Display name</label><input id="definition-display-name" value={definition.displayName ?? ''} aria-invalid={errorField === 'display' || undefined} aria-describedby={errorField === 'display' ? 'definition-labels-error' : undefined} onChange={event => {
      const value = event.target.value;
      if ([...value].length > 100 || /\p{Cc}/u.test(value) || malformedUnicode(value)) { setError('Use at most 100 characters without control characters.'); setErrorField('display'); return; }
      onChange({ displayName: value || undefined }); setError(''); setErrorField(null);
    }} />
    <h3>Implied labels</h3><ul className="schema-chips">{definition.impliedLabels.map(name => <li key={name}><span>{name}</span><button type="button" aria-label={`Remove label ${name}`} onClick={() => onChange({ impliedLabels: definition.impliedLabels.filter(other => other !== name) })}>×</button></li>)}</ul>
    <form className="schema-inline" onSubmit={event => {
      event.preventDefault(); const invalid = identifierError(label);
      if (invalid || definition.impliedLabels.includes(label) || definition.name === label) { setError(invalid || 'This label already exists.'); setErrorField('label'); return; }
      onChange({ impliedLabels: [...definition.impliedLabels, label] }); onLabel(''); setError(''); setErrorField(null);
    }}><label htmlFor="implied-label" className="sr-only">Implied label</label><input id="implied-label" value={label} aria-invalid={errorField === 'label' || undefined} aria-describedby={errorField === 'label' ? 'definition-labels-error' : undefined} onChange={event => onLabel(event.target.value)} onKeyDown={event => { if (event.key === 'Escape' && label) { event.preventDefault(); event.stopPropagation(); onLabel(''); setError(''); setErrorField(null); } }} /><button type="submit">Add label</button></form>
    {error && <p className="modeling-error" id="definition-labels-error" role="alert">{error}</p>}
  </section>;
}
