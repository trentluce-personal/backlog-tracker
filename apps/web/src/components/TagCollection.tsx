import { useState, type FormEvent } from 'react';
import { api } from '../api';
import type { Tag, TagColor } from '../types';
import { Dialog } from './Dialog';
import { TagColorPicker } from './TagColorPicker';

function message(error: unknown) { return error instanceof Error ? error.message : 'Something went wrong. Please try again.'; }

export function TagManager({ tags, onClose, onSaved, onDelete }: {
  tags: Tag[]; onClose: () => void; onSaved: (tag: Tag) => void; onDelete: (tag: Tag) => void;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState<TagColor>('slate');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function create(event: FormEvent) {
    event.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true); setError('');
    try {
      onSaved((await api.saveTag(name.trim(), color)).tag);
      setName('');
    } catch (error) { setError(message(error)); }
    finally { setBusy(false); }
  }
  return <Dialog title="Tags" busy={busy} onClose={onClose}>
    <form className="tag-create tag-create-manager" onSubmit={create}>
      <label className="sr-only" htmlFor="tag-name">Tag name</label>
      <input id="tag-name" maxLength={50} placeholder="New tag" value={name} onChange={event => { setName(event.target.value); setError(''); }} />
      <TagColorPicker value={color} onChange={setColor} label="New tag color" />
      <button className="button primary" aria-disabled={busy} disabled={!name.trim() || busy}>{busy ? 'Adding…' : 'Add tag'}</button>
    </form>
    {error && <p className="form-error" role="alert">{error}</p>}
    {tags.length === 0 ? <p className="tag-empty">No tags yet.</p> : <ul className="tag-list">
      {tags.map(tag => <TagRow key={tag.id} tag={tag} onSaved={onSaved} onDelete={onDelete} />)}
    </ul>}
  </Dialog>;
}

function TagRow({ tag, onSaved, onDelete }: { tag: Tag; onSaved: (tag: Tag) => void; onDelete: (tag: Tag) => void }) {
  const [name, setName] = useState(tag.name);
  const [color, setColor] = useState<TagColor>(tag.color);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dirty = name.trim() !== tag.name || color !== tag.color;
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true); setError('');
    try { onSaved((await api.saveTag(name.trim(), color, tag.id)).tag); }
    catch (error) { setError(message(error)); }
    finally { setBusy(false); }
  }
  return <li className="tag-row">
    <form className="tag-row-form" onSubmit={save}>
      <span className={`tag-chip tag-${color}`} aria-hidden="true">{name.trim() || tag.name}</span>
      <label className="sr-only" htmlFor={`tag-name-${tag.id}`}>Tag name</label>
      <input id={`tag-name-${tag.id}`} maxLength={50} value={name} onChange={event => { setName(event.target.value); setError(''); }} />
      <TagColorPicker value={color} onChange={setColor} label={`Color for ${tag.name}`} />
      <button className="button secondary tag-row-save" aria-disabled={busy} disabled={!dirty || !name.trim() || busy}>{busy ? 'Saving…' : 'Save'}</button>
      <button type="button" className="text-button danger-text" disabled={busy} onClick={() => onDelete(tag)}>Delete</button>
    </form>
    {error && <p className="form-error" role="alert">{error}</p>}
  </li>;
}
