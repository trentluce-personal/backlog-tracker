import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type BackendSchemaResponse } from '../api';
import { buildDiagram } from './backendSchemaDiagram';
import { BackendSchemaCanvas } from './BackendSchemaCanvas';
import { BackendSchemaDetails, type DockSelection } from './BackendSchemaDetails';
import './BackendSchema.css';
import './erd/erd.css';

export function BackendSchema() {
  const content = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<BackendSchemaResponse | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [dock, setDock] = useState<DockSelection>(null);
  const dockTrigger = useRef<Element | null>(null);
  function selectDock(selection: DockSelection) {
    dockTrigger.current = document.activeElement;
    setDock(selection);
  }
  function closeDock() {
    const target = dockTrigger.current;
    if ((target instanceof HTMLElement || target instanceof SVGElement) && target.isConnected) target.focus();
    setDock(null);
  }
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void api.backendSchema().then(result => { if (active) setData(result); }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : 'Could not load backend schema.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attempt]);
  const diagram = useMemo(() => data ? buildDiagram(data.sqlite) : null, [data]);

  return <section className="backend-schema" aria-labelledby="backend-schema-title">
    <header className="erd-toolbar backend-schema-header">
      <div className="erd-document-title"><h1 id="backend-schema-title">Backend schema</h1><span>Read-only</span></div>
      <div className="erd-toolbar-actions">
        <button className="button secondary" aria-expanded={dock?.kind === 'json'} aria-controls={!loading && !error && data ? 'backend-schema-dock' : undefined} disabled={loading || Boolean(error) || !data} onClick={() => { if (dock?.kind === 'json') closeDock(); else selectDock({ kind: 'json' }); }}>JSON storage</button>
      </div>
    </header>
    <div className="sr-only" role="status">{loading ? 'Loading schema…' : data && !error ? 'Schema loaded.' : ''}</div>
    <div ref={content} className="backend-schema-content" tabIndex={0} role="region" aria-label="Schema metadata" aria-busy={loading}>
      {loading ? <div className="state-panel" role="status"><h2>Loading schema…</h2></div>
        : error ? <div className="state-panel error-state"><h2>Schema unavailable</h2><p role="alert">{error}</p><button className="button primary" onClick={() => { content.current?.focus(); setAttempt(value => value + 1); }}>Retry</button></div>
          : data && diagram && <>
            <div className="erd-toolstrip"><span>SQLite · user_version {data.sqlite.userVersion}</span><span>{data.sqlite.tables.length} {data.sqlite.tables.length === 1 ? 'table' : 'tables'}</span></div>
            <div className="erd-stage">
              <BackendSchemaCanvas diagram={diagram} selected={dock} onSelect={selectDock} />
              <div className="erd-dock" id="backend-schema-dock">
                <BackendSchemaDetails key={dock ? dock.kind === 'node' ? `node:${dock.name}` : dock.kind === 'edge' ? `edge:${dock.id}` : 'json' : 'closed'} data={data} diagram={diagram} dock={dock} onClose={closeDock} />
              </div>
            </div>
          </>}
    </div>
  </section>;
}
