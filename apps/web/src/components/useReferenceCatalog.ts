import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { ReferenceCatalogModel } from '../types';
export { resolveReference, type ReferenceResolution } from './referenceResolution';

export function useReferenceCatalog(needed: boolean, hydration: number, dialogOpen: boolean) {
  const [models, setModels] = useState<ReferenceCatalogModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const mounted = useRef(false);
  const inFlight = useRef<Promise<void> | null>(null);
  const refresh = useCallback(() => {
    if (inFlight.current) return inFlight.current;
    setLoading(true);
    const request = (async () => {
      try {
        const result = await api.modelNodeDefinitions();
        if (mounted.current) { setModels(result.models); setLoaded(true); setError(''); }
      } catch (error) {
        if (mounted.current) setError(error instanceof Error ? error.message : 'Could not load reference targets.');
      } finally {
        inFlight.current = null;
        if (mounted.current) setLoading(false);
      }
    })();
    inFlight.current = request;
    return request;
  }, []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (needed || dialogOpen) void refresh(); }, [needed, hydration, dialogOpen, refresh]);
  useEffect(() => {
    if (!needed && !dialogOpen) return;
    const focus = () => { void refresh(); };
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, [needed, dialogOpen, refresh]);
  return { models, loading, error, loaded, stale: loaded && Boolean(error), refresh };
}
