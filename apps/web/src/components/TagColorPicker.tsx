import { useId } from 'react';
import { tagColors, type TagColor } from '../types';

export function TagColorPicker({ value, onChange, label }: { value: TagColor; onChange: (color: TagColor) => void; label: string }) {
  const name = useId();
  return <div className="tag-color-picker" role="radiogroup" aria-label={label}>
    {tagColors.map(color => <label key={color} className={`tag-color-option tag-${color}`}>
      <input type="radio" name={name} value={color} checked={value === color} onChange={() => onChange(color)} aria-label={color} />
      <span className="tag-color-dot" aria-hidden="true" />
    </label>)}
  </div>;
}
