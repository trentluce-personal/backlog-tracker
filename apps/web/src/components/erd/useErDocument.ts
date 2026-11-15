import { useEffect, useRef, useState } from 'react';
import { erApi } from '../../erd-api';
import type { ErDocument, ErModel, ErSummary } from '../../erd-types';
import { candidate, displayNameError, emptyModel, snapshot, validateModel } from './model';

export function download(content: string, mediaType: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mediaType }));
  const link = document.createElement('a');
  link.href = url; link.download = filename; document.body.append(link);
  try { link.click(); } finally { link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
export function useErDocument(hasDrafts = false) {
  const [model, setModel] = useState<ErModel>(emptyModel);
  const [name, setName] = useState('');
  const [identity, setIdentity] = useState<{ id: string; revision: number } | null>(null);
  const [baseline, setBaseline] = useState(() => snapshot('', emptyModel()));
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [models, setModels] = useState<ErSummary[]>([]);
  const dirty = snapshot(name, model) !== baseline;
  useEffect(() => {
    if (!dirty && !hasDrafts) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, hasDrafts]);
  function install(document: ErDocument) {
    const next = candidate(document.model);
    setModel(next); setName(document.name); setIdentity({ id: document.id, revision: document.model.revision });
    setBaseline(snapshot(document.name, next));
  }
  async function run(action: () => Promise<void>): Promise<boolean> {
    if (busyRef.current) return false;
    busyRef.current = true; setBusy(true); setError(''); setNotice('');
    try { await action(); return true; }
    catch (error) { setError(error instanceof Error ? error.message : 'The request failed.'); return false; }
    finally { busyRef.current = false; setBusy(false); }
  }
  function commit(next: ErModel): string[] {
    const errors = validateModel(next);
    if (!errors.length) { setModel(next); setError(''); setNotice(''); }
    return errors;
  }
  return {
    model, name, identity, dirty, busy, busyRef, error, notice, models, setError, setName, commit,
    setNotice,
    fresh: () => {
      if (busyRef.current) return false;
      const next = emptyModel(); setModel(next); setName(''); setIdentity(null); setBaseline(snapshot('', next)); setError(''); setNotice(''); return true;
    },
    list: () => run(async () => { setModels((await erApi.list()).models); }),
    open: (id: string) => {
      if (busyRef.current) return Promise.resolve(false);
      return run(async () => {
        const document = await erApi.open(id);
        const errors = validateModel(document.model);
        if (errors.length) throw new Error(errors.join(' '));
        if (!Number.isSafeInteger(document.model.revision) || document.model.revision < 0) throw new Error('Invalid model revision.');
        install(document); setNotice('Model opened.');
      });
    },
    save: (nextName = name) => run(async () => {
      const errors = [displayNameError(nextName.trim()), ...validateModel(model)].filter(Boolean);
      if (errors.length) throw new Error(errors.join(' '));
      const next = candidate(model);
      const document = identity ? await erApi.save(identity.id, nextName.trim(), identity.revision, next) : await erApi.create(nextName.trim(), next);
      install(document); setNotice('Model saved.');
    }),
    remove: (entry: ErSummary) => run(async () => {
      if (!entry.available) throw new Error(entry.error);
      await erApi.delete(entry.id, entry.revision);
      setModels(items => items.filter(item => item.id !== entry.id));
      // Keep the current candidate as an unsaved document after its stored copy is deleted.
      if (identity?.id === entry.id) { setIdentity(null); setBaseline(''); }
      setNotice('Stored model deleted.');
    }),
    exportJson: () => {
      try { download(JSON.stringify(candidate(model), null, 2) + '\n', 'application/json', 'schema.json'); setNotice('JSON download started.'); setError(''); }
      catch (error) { setError(error instanceof Error ? error.message : 'JSON download failed.'); }
    },
    exportSql: () => run(async () => {
      const errors = validateModel(model, true);
      if (errors.length) throw new Error(errors.join(' '));
      const result = await erApi.sql(candidate(model));
      download(result.content, result.mediaType, result.filename); setNotice('SQL download started.');
    }),
  };
}
