import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import { api, ApiError } from '../api';
import type { ModelInput, ModelNode, ModelRelationship, PropertyIndex } from '../types';

const emptyModel: ModelInput = { schemaVersion: 2, nodes: [], relationships: [] };
const serialize = (model: ModelInput) => JSON.stringify({ schemaVersion: 2, nodes: model.nodes, relationships: model.relationships });
const apply = <T,>(action: SetStateAction<T>, current: T): T => typeof action === 'function' ? (action as (value: T) => T)(current) : action;
const normalizePropertyIndex = (value: unknown): PropertyIndex => value === true ? 'Range'
  : value === 'Range' || value === 'Text' || value === 'Point' ? value : 'None';

export function useModelPersistence() {
  const [graph, setGraph] = useState(emptyModel);
  const [phase, setPhase] = useState<'empty' | 'loading' | 'ready' | 'unavailable'>('empty');
  const [id, setId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [revision, setRevision] = useState(0);
  const [baseline, setBaseline] = useState(serialize(emptyModel));
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [creationError, setCreationError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [failedLoadId, setFailedLoadId] = useState<string | null>(null);
  const [hydration, setHydration] = useState(0);
  const busy = useRef(false);
  const hydrated = useRef(false);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const load = useCallback(async (targetId: string) => {
    if (busy.current) return false;
    busy.current = true;
    setPhase('loading'); setError('');
    try {
      const result = await api.namedModel(targetId);
      if (!mounted.current) return false;
      const { model } = result;
      const next: ModelInput = { schemaVersion: 2, nodes: model.nodes.map(node => node.kind === 'reference'
        ? { kind: 'reference', id: node.id, name: node.name, x: node.x, y: node.y, classification: node.classification, target: node.target }
        : { ...node, kind: 'definition', classification: node.classification ?? 'Transactional', draft: node.draft ?? false, properties: (node.properties ?? []).map(property => ({ ...property, index: normalizePropertyIndex(property.index) })) }), relationships: model.relationships.map(relationship => ({
          ...relationship,
          sourceCardinality: relationship.sourceCardinality === undefined ? '0..*' : relationship.sourceCardinality,
          targetCardinality: relationship.targetCardinality === undefined ? '0..*' : relationship.targetCardinality,
        })) };
      setGraph(next); setId(result.id); setName(result.name); setRevision(model.revision); setBaseline(serialize(next));
      hydrated.current = true;
      setFailedLoadId(null); setSaved(false); setConflict(false); setHydration(value => value + 1); setPhase('ready');
      return true;
    } catch (error) {
      if (mounted.current) {
        setFailedLoadId(targetId);
        setError(`${error instanceof Error ? error.message : 'Could not load the model.'} ${hydrated.current ? 'Your previous model and all drafts are kept.' : 'Editing is blocked until a model loads.'} Retry loading or choose another model.`);
        setPhase(hydrated.current ? 'ready' : 'unavailable');
      }
      return false;
    } finally { busy.current = false; }
  }, []);

  async function create(name: string) {
    if (busy.current) return false;
    busy.current = true; setCreating(true); setCreationError('');
    try {
      const result = await api.createModel(name, emptyModel);
      if (!mounted.current) return false;
      setGraph(emptyModel); setId(result.id); setName(result.name); setRevision(result.model.revision); setBaseline(serialize(emptyModel));
      hydrated.current = true;
      setPhase('ready'); setSaved(false); setConflict(false); setError(''); setFailedLoadId(null); setHydration(value => value + 1);
      return true;
    } catch (error) {
      if (mounted.current) setCreationError(error instanceof Error ? error.message : 'Could not create the model.');
      return false;
    } finally { busy.current = false; if (mounted.current) setCreating(false); }
  }

  const dirty = serialize(graph) !== baseline;
  async function deleteModel(targetId: string, listedRevision: number) {
    if (busy.current) return false;
    busy.current = true; setDeleting(true);
    try {
      await api.deleteModel(targetId, targetId === id ? revision : listedRevision);
      if (!mounted.current) return false;
      if (targetId === id) {
        setGraph(emptyModel); setId(null); setName(''); setRevision(0); setBaseline(serialize(emptyModel));
        hydrated.current = true;
        setPhase('empty'); setSaved(false); setConflict(false); setError(''); setFailedLoadId(null); setHydration(value => value + 1);
      }
      return true;
    } finally { busy.current = false; if (mounted.current) setDeleting(false); }
  }
  async function save(asName?: string, rename = false) {
    if (busy.current || phase !== 'ready' || (rename && conflict) || (asName === undefined && (conflict || id === null || !dirty))) return false;
    busy.current = true;
    const snapshot = serialize(graph);
    const targetId = id;
    setSaving(true); setError('');
    try {
      const input = JSON.parse(snapshot) as ModelInput;
      const result = asName !== undefined ? rename && targetId !== null && targetId !== 'legacy'
        ? await api.updateModel(targetId, revision, asName, input) : await api.createModel(asName, input)
        : targetId === 'legacy' ? { id: 'legacy', name, ...await api.saveModel(revision, input) }
          : await api.updateModel(targetId!, revision, name, input);
      if (!mounted.current) return false;
      // Navigation is locked during requests. Advance only the saved snapshot's
      // baseline; newer graph edits and unapplied form/rename drafts survive.
      // Creating a copy allocates a new model ID. Rebase only internal targets,
      // including any edits made while the saved snapshot was in flight.
      const rebase = (nodes: ModelNode[]) => nodes.map(node => node.kind === 'reference' && node.classification === 'Internal Reference'
        ? { ...node, target: { ...node.target, modelId: result.id } } : node);
      if (result.id !== targetId) setGraph(current => ({ ...current, nodes: rebase(current.nodes) }));
      setId(result.id); setName(result.name); setRevision(result.model.revision); setBaseline(serialize({ ...input, nodes: rebase(input.nodes) })); setSaved(true); setConflict(false); setFailedLoadId(null);
      return true;
    } catch (error) {
      if (!mounted.current) return false;
      const stale = error instanceof ApiError && error.status === 409;
      setConflict(stale);
      setError(stale
        ? 'The stored model changed in another tab or process. Your graph and drafts are kept. Reload stored model to review that version; reloading discards local changes after confirmation.'
        : `${error instanceof Error ? error.message : 'Could not save the model.'} Your graph and drafts are kept. Retry saving.`);
      return false;
    } finally {
      busy.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  const setNodes = (action: SetStateAction<ModelNode[]>) => setGraph(current => ({ ...current, nodes: apply(action, current.nodes) }));
  const setRelationships = (action: SetStateAction<ModelRelationship[]>) => setGraph(current => ({ ...current, relationships: apply(action, current.relationships) }));
  return { ...graph, id, name, setNodes, setRelationships, phase, revision, dirty, saving, creating, creationError, clearCreationError: () => setCreationError(''), deleting, saved, error, conflict, failedLoadId, hydration, load, save, create, deleteModel, busy };
}
