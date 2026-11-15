import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { FolderOpen, Plus, Save } from 'lucide-react';
import { Icon } from '../Icon';
import type { ErColumn, ErForeignKey, ErSummary, ErTable } from '../../erd-types';
import { ErCanvas } from './ErCanvas';
import { ErModelBrowser } from './ErModelBrowser';
import { Confirm, NameForm, RelationshipForm } from './ErForms';
import { ErPanel } from './ErPanel';
import { autoPlacement, initialView, revealBounds, TABLE_WIDTH } from './geometry';
import { deleteColumn, deleteTable, dependentCount, insertColumn, insertTable, type TableDraft } from './model';
import { useErDocument } from './useErDocument';
import { draftKey, findByData, persistenceDraftMessage, persistenceState, removeColumnDraft, type Drafts } from './editing';
import './erd.css';

export interface ErNavigation { canNavigate: () => boolean }
type Editor = { kind: 'relationship'; relationship?: ErForeignKey } | { kind: 'name' } | { kind: 'browser' } | null;
type Deletion = { kind: 'table'; table: ErTable } | { kind: 'column'; table: ErTable; column: ErColumn } | { kind: 'relationship'; relationship: ErForeignKey } | { kind: 'stored'; entry: ErSummary } | null;
type Replacement = { kind: 'new' } | { kind: 'open'; id: string };

export function ErDesigner({ active, navigation, onBlockedChange }: { active: boolean; navigation: RefObject<ErNavigation | null>; onBlockedChange: (blocked: boolean) => void }) {
  const [drafts, setDrafts] = useState<Drafts>({});
  const [panelDirty, setPanelDirty] = useState(false);
  const hasDrafts = Object.keys(drafts).length > 0 || panelDirty;
  const doc = useErDocument(hasDrafts);
  const [editor, setEditor] = useState<Editor>(null);
  const persistence = persistenceState(doc.dirty, Object.keys(drafts).length, editor?.kind === 'relationship', panelDirty);
  const [deletion, setDeletion] = useState<Deletion>(null);
  const [replacement, setReplacement] = useState<Replacement | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState(initialView);
  const [relationshipsOpen, setRelationshipsOpen] = useState(false);
  const gesture = useRef(false);
  const deletionFocus = useRef<HTMLElement | null>(null);
  const designer = useRef<HTMLElement>(null);
  // Panels and drafts survive workspace switches because this component stays mounted.
  const blocked = doc.busy;
  const mutationBlocked = blocked || Boolean(deletion || replacement);
  useLayoutEffect(() => {
    navigation.current = { canNavigate: () => !gesture.current && !doc.busyRef.current };
    onBlockedChange(blocked);
    return () => { navigation.current = null; };
  }, [blocked, navigation, onBlockedChange]);

  function focusTable(tableId: string, name = false) {
    requestAnimationFrame(() => { if (designer.current) findByData(designer.current.querySelectorAll<HTMLElement>(name ? '[data-table-name]' : '[data-table-id]'), name ? 'tableName' : 'tableId', tableId)?.focus({ preventScroll: true }); });
  }
  function closeDraft(key: string) {
    const tableId = drafts[key]?.tableId;
    setDrafts(current => Object.fromEntries(Object.entries(current).filter(([id]) => id !== key)));
    if (tableId) focusTable(tableId, drafts[key]?.draft.kind === 'table');
  }
  function editDraft(table: ErTable, column?: ErColumn) {
    if (gesture.current || mutationBlocked) return;
    const key = draftKey(table.id, column?.id);
    if (drafts[key]) {
      requestAnimationFrame(() => { if (designer.current) findByData(designer.current.querySelectorAll<HTMLElement>('[data-draft-key]'), 'draftKey', key)?.querySelector('input')?.focus(); });
      return;
    }
    setSelected(table.id);
    setDrafts(current => ({ ...current, [key]: { tableId: table.id, draft: column ? { kind: 'column', column: { ...column } } : { kind: 'table', name: table.name } } }));
  }
  function addTable() {
    if (gesture.current || mutationBlocked) return;
    // Include expanded editors in collision checks without changing persisted row geometry.
    const extraHeights = Object.fromEntries(doc.model.tables.map(table => [table.id, Math.min(360, Object.values(drafts).filter(entry => entry.tableId === table.id && entry.draft.kind === 'column').length * 360)]));
    const position = autoPlacement(doc.model.tables, { x: Math.max(12, (12 - view.x) / view.zoom), y: Math.max(12, (12 - view.y) / view.zoom) }, extraHeights);
    const next = insertTable(doc.model, crypto.randomUUID(), position);
    if (doc.commit(next).length) return;
    const table = next.tables.at(-1)!;
    editDraft(table);
    const canvas = designer.current?.querySelector('.erd-canvas');
    setView(revealBounds(view, { ...position, width: TABLE_WIDTH, height: 260 }, { width: canvas?.clientWidth ?? 800, height: canvas?.clientHeight ?? 600 }));
  }
  function addColumn(table: ErTable) {
    if (gesture.current || mutationBlocked) return;
    const id = crypto.randomUUID(), next = insertColumn(doc.model, table.id, id);
    if (!doc.commit(next).length) editDraft(next.tables.find(item => item.id === table.id)!, next.tables.find(item => item.id === table.id)!.columns.at(-1));
  }
  function closeEditor() { setEditor(null); setPanelDirty(false); }
  function edit(value: Editor) {
    if (gesture.current || mutationBlocked) return;
    // Keep an active form mounted until its own Close/Apply resolves its draft.
    if (editor && editor.kind !== 'browser') return;
    doc.setError(''); setPanelDirty(false); setEditor(value);
  }
  async function replace(action: Replacement) {
    const replaced = action.kind === 'new' ? doc.fresh() : await doc.open(action.id);
    if (!replaced) return;
    setReplacement(null); closeEditor(); setDrafts({}); setSelected(null); setView(initialView);
    requestAnimationFrame(() => designer.current?.focus());
  }
  function requestReplacement(action: Replacement) {
    if (gesture.current || mutationBlocked) return;
    if (doc.dirty || hasDrafts) setReplacement(action); else void replace(action);
  }
  function askDelete(value: Deletion) {
    if (gesture.current || mutationBlocked) return;
    deletionFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : designer.current;
    doc.setError(''); setDeletion(value);
  }
  function confirmDelete() {
    if (!deletion) return;
    if (deletion.kind === 'stored') {
      void doc.remove(deletion.entry).then(deleted => { if (deleted) { deletionFocus.current = designer.current; setDeletion(null); } }); return;
    }
    deletionFocus.current = designer.current;
    if (deletion.kind === 'table') {
      doc.commit(deleteTable(doc.model, deletion.table.id)); setSelected(null);
      setDrafts(current => Object.fromEntries(Object.entries(current).filter(([, entry]) => entry.tableId !== deletion.table.id)));
    }
    if (deletion.kind === 'column') {
      doc.commit(deleteColumn(doc.model, deletion.table.id, deletion.column.id));
      setDrafts(current => removeColumnDraft(current, deletion.table.id, deletion.column.id));
    }
    if (deletion.kind === 'relationship') doc.commit({ ...doc.model, foreignKeys: doc.model.foreignKeys.filter(fk => fk.id !== deletion.relationship.id) });
    setDeletion(null); doc.setNotice('Deleted.');
  }
  const count = deletion?.kind === 'table' ? dependentCount(doc.model, deletion.table.id) : deletion?.kind === 'column' ? dependentCount(doc.model, deletion.table.id, deletion.column.id) : 0;
  const deletionName = deletion?.kind === 'table' ? deletion.table.name : deletion?.kind === 'column' ? `${deletion.table.name}.${deletion.column.name}` : deletion?.kind === 'relationship' ? deletion.relationship.name : deletion?.entry.name;
  const formOpen = editor?.kind === 'relationship' || editor?.kind === 'name';
  return <section ref={designer} tabIndex={-1} className="erd-designer" aria-labelledby="erd-title" aria-busy={doc.busy}>
    <header className="erd-toolbar"><div className="erd-document-title"><h1 id="erd-title">ERD</h1><span title={doc.name || 'Untitled'}>{doc.name || 'Untitled'}{persistence.dirty ? ' *' : ''}</span><small>PostgreSQL</small></div>
      <div className="erd-toolbar-actions"><button className="button secondary" disabled={mutationBlocked} onClick={() => requestReplacement({ kind: 'new' })}>New</button><button className="button secondary" disabled={mutationBlocked || formOpen} onClick={() => { edit({ kind: 'browser' }); void doc.list(); }}><Icon icon={FolderOpen} />Open</button><button className="button primary" aria-describedby={persistence.blocked ? 'erd-persistence-edits' : undefined} disabled={mutationBlocked || formOpen || persistence.blocked} onClick={() => { if (!gesture.current && !persistence.blocked) { if (doc.name) void doc.save(); else edit({ kind: 'name' }); } }}><Icon icon={Save} />Save</button><button className="button secondary" disabled={mutationBlocked || formOpen} onClick={() => edit({ kind: 'name' })}>Rename</button><button className="button secondary" aria-describedby={persistence.blocked ? 'erd-persistence-edits' : undefined} disabled={blocked || persistence.blocked} onClick={() => { if (!gesture.current && !persistence.blocked) doc.exportJson(); }}>JSON</button><button className="button secondary" aria-describedby={persistence.blocked ? 'erd-persistence-edits' : undefined} disabled={blocked || persistence.blocked} onClick={() => { if (!gesture.current && !persistence.blocked) void doc.exportSql(); }}>SQL</button></div>
    </header>
    {persistence.blocked && <div id="erd-persistence-edits" className="erd-notice" role="status">{persistenceDraftMessage}</div>}
    <div className="erd-toolstrip"><button className="button secondary" disabled={mutationBlocked || doc.model.tables.length >= 100} onClick={addTable}><Icon icon={Plus} />Table</button><button className="button secondary" disabled={mutationBlocked || formOpen || doc.model.foreignKeys.length >= 500} onClick={() => edit({ kind: 'relationship' })}><Icon icon={Plus} />Relationship</button><button className="button secondary" disabled={blocked} aria-expanded={relationshipsOpen} aria-controls="erd-relationships" onClick={() => { if (!gesture.current) setRelationshipsOpen(value => !value); }}>Relationships ({doc.model.foreignKeys.length})</button>{doc.busy && <span role="status">Working…</span>}</div>
    {doc.error && <div className="erd-error" role="alert">{doc.error}<button className="text-button" onClick={() => doc.setError('')}>Dismiss</button></div>}
    <div className="erd-notice" role="status">{doc.notice}</div>
    <div className="erd-stage">
      <ErCanvas active={active} model={doc.model} busy={mutationBlocked} selected={selected} onSelect={setSelected} onCommit={doc.commit} gesture={gesture} view={view} setView={setView} onRename={table => editDraft(table)} onDeleteTable={table => askDelete({ kind: 'table', table })} onColumn={(table, column) => column ? editDraft(table, column) : addColumn(table)} onDeleteColumn={(table, column) => askDelete({ kind: 'column', table, column })} onRelationship={relationship => edit({ kind: 'relationship', relationship })} drafts={drafts} onDraft={(key, draft) => setDrafts(current => ({ ...current, [key]: { ...current[key], draft } }))} onCloseDraft={closeDraft} />
      <div className="erd-dock">
        {relationshipsOpen && <aside id="erd-relationships" className="erd-relationships" aria-label="Relationships"><header><h2>Relationships</h2><button className="button secondary" onClick={() => setRelationshipsOpen(false)}>Close</button></header><ul>{doc.model.foreignKeys.map(fk => {
          const source = doc.model.tables.find(table => table.id === fk.sourceTableId), target = doc.model.tables.find(table => table.id === fk.targetTableId);
          return <li key={fk.id}><button className="erd-relationship-edit" disabled={mutationBlocked || formOpen} onClick={() => edit({ kind: 'relationship', relationship: fk })}><strong>{fk.name}</strong><span>{source?.name}.{source?.columns.find(column => column.id === fk.sourceColumnId)?.name} → {target?.name}.{target?.columns.find(column => column.id === fk.targetColumnId)?.name}</span></button><button className="text-button danger-text" disabled={mutationBlocked} onClick={() => askDelete({ kind: 'relationship', relationship: fk })} aria-label={`Delete relationship ${fk.name}`}>Delete</button></li>;
        })}</ul>{!doc.model.foreignKeys.length && <p>No relationships</p>}</aside>}
        {editor?.kind === 'relationship' && <RelationshipForm key={editor.relationship?.id ?? 'new'} model={doc.model} relationship={editor.relationship} busy={mutationBlocked} onDirty={setPanelDirty} onCommit={doc.commit} onClose={closeEditor} />}
        {editor?.kind === 'name' && <NameForm name={doc.name} busy={mutationBlocked} editsBlocked={persistence.blocked} error={doc.error} onDirty={setPanelDirty} onSave={doc.save} onClose={closeEditor} />}
        {editor?.kind === 'browser' && <ErModelBrowser models={doc.models} currentId={doc.identity?.id} busy={mutationBlocked} error={doc.error} onRefresh={() => void doc.list()} onNew={() => requestReplacement({ kind: 'new' })} onOpen={id => requestReplacement({ kind: 'open', id })} onDelete={entry => askDelete({ kind: 'stored', entry })} onClose={closeEditor} />}
        {deletion && <Confirm title={`Delete ${deletion.kind === 'stored' ? 'stored model' : deletion.kind}?`} busy={doc.busy} error={doc.error} returnFocusRef={deletionFocus} onClose={() => setDeletion(null)} onConfirm={confirmDelete}>Delete “{deletionName}”?{count > 0 && ` This also deletes ${count} dependent relationship${count === 1 ? '' : 's'}.`}{deletion.kind === 'table' || deletion.kind === 'column' ? ' Any drafts for it will be discarded.' : ''}</Confirm>}
        {replacement && <ErPanel title="Discard unsaved ERD changes?" busy={doc.busy} onClose={() => setReplacement(null)}><p>Discard unsaved changes and drafts {replacement.kind === 'new' ? 'and start a new model' : 'and open the selected model'}?</p><div className="erd-form-actions"><button className="button secondary" disabled={doc.busy} onClick={() => setReplacement(null)}>Cancel</button><button className="button danger" disabled={doc.busy} onClick={() => void replace(replacement)}>{replacement.kind === 'new' ? 'Discard and start new' : 'Discard and open'}</button></div></ErPanel>}
      </div>
    </div>
  </section>;
}
