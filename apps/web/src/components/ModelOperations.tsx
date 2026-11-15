import { useState } from 'react';
import { api, ApiError } from '../api';
import type { ExportFormat, ModelInput, ValidationResult, ReferenceCatalogModel } from '../types';
import { Dialog } from './Dialog';
import { SchemaObjectsPanel } from './SchemaObjectsPanel';
import { RelationshipTypesPanel, type TypeDraftControls } from './RelationshipTypesPanel';
import { useReferenceCatalog } from './useReferenceCatalog';

export function ValidationIssues({ result }: { result: ValidationResult }) {
  return <section className="validation-results" aria-label="Validation results"><p role="status">{result.valid ? 'Valid' : 'Validation failed'}</p><ul>{result.issues.map((issue, index) => <li key={index} data-severity={issue.severity}><strong>{issue.severity === 'warning' ? 'Warning' : 'Error'} · {issue.code}</strong><code>{issue.modelId} · {typeof issue.path === 'string' ? issue.path : JSON.stringify(issue.path)}</code><span>{issue.message}</span></li>)}</ul></section>;
}
export function ModelOperations({ modelId, model, disabled, onChange, catalog, ...draftControls }: { modelId: string | null; model: ModelInput; disabled: boolean; onChange: (model: ModelInput) => void; catalog: ReferenceCatalogModel[] } & TypeDraftControls) {
  const [mode, setMode] = useState<'schema' | 'validate' | 'export' | null>(null);
  const [includeDrafts, setIncludeDrafts] = useState(false);
  const [format, setFormat] = useState<ExportFormat>('cypher');
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [requirements, setRequirements] = useState<string[]>([]);
  const targets = useReferenceCatalog(mode === 'schema', 0, mode === 'schema');
  async function run() {
    if (!modelId || busy) return;
    setBusy(true); setError(''); setResult(null); setRequirements([]);
    try {
      if (mode === 'validate') setResult(await api.validateModel(modelId, model, !includeDrafts));
      else {
        const exported = await api.exportModel(modelId, model, !includeDrafts, format, acknowledged);
        setResult(exported.validation); setRequirements(exported.requirements);
        if (exported.validation.valid) {
          const url = URL.createObjectURL(new Blob([exported.content], { type: exported.mediaType }));
          const link = document.createElement('a'); link.href = url; link.download = exported.filename; link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
      }
    } catch (error) { setError(error instanceof Error ? error.message : 'Request failed.'); if (error instanceof ApiError && error.validation) setResult(error.validation); }
    finally { setBusy(false); }
  }
  return <><select className="button secondary model-operations" aria-label="Model actions" value="" disabled={disabled || !modelId} onChange={event => { setMode(event.target.value as typeof mode); setError(''); setResult(null); setRequirements([]); }}><option value="" disabled>Schema / Export</option><option value="schema">Schema</option><option value="validate">Validate</option><option value="export">Export</option></select>
    {mode && <Dialog title={mode === 'schema' ? 'Schema' : mode === 'validate' ? 'Validate model' : 'Export model'} busy={busy} onClose={() => setMode(null)}>
      {mode === 'schema' ? <>{targets.error && <p className="modeling-error" role="alert">{targets.error}<button type="button" className="text-button" onClick={() => void targets.refresh()}>Retry</button></p>}<RelationshipTypesPanel model={model} modelId={modelId!} models={targets.loaded ? targets.models : catalog} onChange={onChange} {...draftControls} /><SchemaObjectsPanel model={model} onChange={onChange} /></> : <form className="modeling-form" onSubmit={event => { event.preventDefault(); void run(); }}>
        {mode === 'export' && <><label htmlFor="model-export-format">Format</label><select id="model-export-format" value={format} disabled={busy} onChange={event => { setFormat(event.target.value as ExportFormat); setAcknowledged(false); setResult(null); }}><option value="json">JSON</option><option value="cypher">Cypher</option><option value="graph-type">Graph type</option></select></>}
        <label className="schema-checkbox"><input type="checkbox" checked={includeDrafts} disabled={busy} onChange={event => { setIncludeDrafts(event.target.checked); setResult(null); }} />Include drafts</label>
        {mode === 'export' && format === 'graph-type' && <label className="schema-danger schema-checkbox"><input type="checkbox" checked={acknowledged} disabled={busy} onChange={event => setAcknowledged(event.target.checked)} />Acknowledge graph type replacement</label>}
        {error && <p className="modeling-error" role="alert">{error}</p>}
        {result && <ValidationIssues result={result} />}
        {requirements.length > 0 && <section aria-label="Requirements"><h3>Requirements</h3><ul>{requirements.map(requirement => <li key={requirement}>{requirement}</li>)}</ul></section>}
        <div className="dialog-actions"><button type="button" className="button secondary" disabled={busy} onClick={() => setMode(null)}>Close</button><button className="button primary" disabled={busy || (mode === 'export' && format === 'graph-type' && !acknowledged)}>{busy ? 'Working…' : mode === 'validate' ? 'Validate' : 'Generate download'}</button></div>
      </form>}
    </Dialog>}
  </>;
}
