import { useEffect, useState } from 'react';
import { CircleAlert, Code2, LoaderCircle, RefreshCw } from 'lucide-react';
import { Icon } from './Icon';
import './IdeWorkspace.css';

type IdeState = { status: 'loading' } | { status: 'ready'; url: string } | { status: 'unavailable'; error: string };

export function IdeWorkspace() {
  const [state, setState] = useState<IdeState>({ status: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setState({ status: 'loading' });
      try {
        const configResponse = await fetch('/api/ide');
        const config = await configResponse.json().catch(() => null) as { url?: string; name?: string; volume?: string; containerPath?: string; error?: string } | null;
        if (!configResponse.ok || !config || !config.url || !config.name || !config.volume || !config.containerPath) {
          throw new Error(config?.error ?? 'Could not load the IDE configuration.');
        }
        const statusResponse = await fetch('/api/ide/status');
        const status = await statusResponse.json().catch(() => null) as { available?: boolean; error?: string } | null;
        if (!statusResponse.ok || !status || !status.available) throw new Error(status?.error ?? 'The IDE container is not running.');
        if (!cancelled) {
          setState({ status: 'ready', url: config.url });
          void fetch('/api/ide/workspace', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: config.name, volume: config.volume, containerPath: config.containerPath }),
          }).then(response => {
            if (!response.ok) console.warn('Could not register the IDE workspace in Neo4j.');
          }).catch(() => console.warn('Could not register the IDE workspace in Neo4j.'));
        }
      } catch (error) {
        if (!cancelled) setState({ status: 'unavailable', error: error instanceof Error ? error.message : 'The IDE is unavailable.' });
      }
    })();
    return () => { cancelled = true; };
  }, [reloadKey]);

  return (
    <div className="ide-workspace">
      <header className="ide-toolbar">
        <span className="ide-title"><Icon icon={Code2} /> VS Code</span>
        <span className="ide-toolbar-spacer" />
        <button type="button" className="icon-button" aria-label="Reload VS Code" title="Reload" onClick={() => setReloadKey(value => value + 1)}><Icon icon={RefreshCw} /></button>
      </header>
      {state.status === 'loading' && <div className="ide-state" role="status"><Icon icon={LoaderCircle} /><p>Opening VS Code…</p></div>}
      {state.status === 'unavailable' && (
        <div className="ide-state error" role="alert">
          <Icon icon={CircleAlert} />
          <h1>VS Code is unavailable</h1>
          <p>{state.error}</p>
          <p className="ide-state-hint">Start the IDE container with <code>docker compose -f compose.ide.yaml up -d --build</code>, then retry.</p>
          <button type="button" className="button primary" onClick={() => setReloadKey(value => value + 1)}>Retry</button>
        </div>
      )}
      {state.status === 'ready' && (
        <iframe
          key={reloadKey}
          className="ide-frame"
          src={`${state.url.replace(/\/+$/, '')}/?folder=/workspace`}
          title="VS Code"
          allow="clipboard-read; clipboard-write; fullscreen"
          allowFullScreen
        />
      )}
    </div>
  );
}
