import { ErPanel } from './ErPanel';
import type { ErSummary } from '../../erd-types';

export function ErModelBrowser({ models, currentId, busy, error, onRefresh, onNew, onOpen, onDelete, onClose }: { models: ErSummary[]; currentId?: string; busy: boolean; error: string; onRefresh: () => void; onNew: () => void; onOpen: (id: string) => void; onDelete: (entry: ErSummary) => void; onClose: () => void }) {
  return <ErPanel title="ERD models" busy={busy} onClose={onClose}>
    <div className="erd-browser-actions"><button className="button primary" disabled={busy} onClick={onNew}>New model</button><button className="button secondary" disabled={busy} onClick={onRefresh}>{busy ? 'Loading…' : 'Refresh'}</button></div>
    {error && <div className="form-error" role="alert">{error}</div>}
    <ul className="erd-model-list">{models.map(entry => <li key={entry.id}><div><strong>{entry.name}</strong>{entry.id === currentId && <span className="erd-current">Current</span>}{!entry.available && <small>{entry.error}</small>}</div><button className="button secondary" disabled={busy || !entry.available} onClick={() => onOpen(entry.id)} aria-label={`Open ERD model ${entry.name}`}>Open</button><button className="button danger-text" disabled={busy || !entry.available} onClick={() => onDelete(entry)} aria-label={`Delete ERD model ${entry.name}`}>Delete</button></li>)}</ul>
    {!busy && !error && !models.length && <p className="erd-empty-list">No saved models</p>}
  </ErPanel>;
}
