import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Icon } from './Icon';
import { api, ApiError } from '../api';
import type { ModelSummary } from '../types';
import './Models.css';

export function Models({ active, refresh, currentId, busy, deleting, openError, onOpen, onNew, onDelete }: {
  active: boolean; refresh: number; currentId: string | null; busy: boolean; openError: string;
  deleting: boolean; onOpen: (id: string) => void; onNew: () => void; onDelete: (model: ModelSummary) => Promise<boolean>;
}) {
  const [models, setModels] = useState<ModelSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [deleteError, setDeleteError] = useState('');
  const deletingRef = useRef(false);
  const newButton = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  useLayoutEffect(() => {
    if (restoreFocus.current && !busy) { restoreFocus.current = false; newButton.current?.focus(); }
  }, [busy, loading, models]);
  async function remove(model: ModelSummary) {
    if (busy || deletingRef.current) return;
    deletingRef.current = true; setDeleteError('');
    try {
      if (await onDelete(model)) {
        setModels(current => current.filter(item => item.id !== model.id));
        restoreFocus.current = true;
        setRetry(value => value + 1);
      }
    } catch (error) {
      setDeleteError(error instanceof ApiError && error.status === 409
        ? 'The stored model changed. Your current graph and all drafts are kept. Refresh models and review the stored version before deleting; the current model must be reloaded to review its new revision.'
        : `${error instanceof Error ? error.message : 'Could not delete the model.'} Your current graph and all drafts are kept. Retry deleting when the stored file is available.`);
    } finally { deletingRef.current = false; }
  }
  useEffect(() => {
    if (!active) return;
    let stale = false;
    setLoading(true); setError('');
    void api.models().then(result => { if (!stale) setModels(result.models); })
      .catch(error => { if (!stale) setError(error instanceof Error ? error.message : 'Could not load models.'); })
      .finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [active, refresh, retry]);
  return <section className="models" aria-label="Stored models">
    <div className="models-actions">
      <button className="button secondary" disabled={loading || busy} onClick={() => setRetry(value => value + 1)}>Refresh models</button>
      <button ref={newButton} className="button primary" disabled={busy} onClick={onNew}><Icon icon={Plus} /> New model</button>
    </div>
    {busy && <p role="status">{deleting ? 'Deleting model…' : 'Opening model…'}</p>}
    {deleteError && <p className="model-card-error" role="alert">{deleteError}</p>}
    {openError && <p className="model-card-error" role="alert">{openError} Use Open to retry.</p>}
    {loading ? <div className="state-panel" role="status"><h2>Loading models…</h2></div>
      : error ? <div className="state-panel" role="alert"><h2>Could not load models</h2><p>{error}</p><button className="button secondary" onClick={() => setRetry(value => value + 1)}>Retry loading models</button></div>
        : !models.length ? <div className="state-panel"><h2>No models yet</h2></div>
           : <ul className="models-list">{models.map(model => <li key={model.id} className="model-row" aria-current={model.id === currentId ? 'true' : undefined}>
            <div><h2>{model.name}</h2><p>{model.id === currentId ? 'Current model · ' : ''}{model.available ? `Revision ${model.revision}` : 'Unavailable'}</p>
              {!model.available && <p className="model-card-error">{model.error} Check the stored file, then refresh models to retry.</p>}</div>
             <div className="model-row-actions">
               {model.available && model.deletable && <button className="icon-button model-delete" title={`Delete ${model.name} (${model.id})`} aria-label={`Delete model ${model.name} (${model.id})${model.id === currentId ? ', current model' : ''}`} disabled={busy} onClick={() => void remove(model)}><Icon icon={Trash2} /></button>}
               <button className="button secondary" aria-label={`Open ${model.name}`} disabled={busy || !model.available} onClick={() => onOpen(model.id)}>Open</button>
             </div>
          </li>)}</ul>}
  </section>;
}
