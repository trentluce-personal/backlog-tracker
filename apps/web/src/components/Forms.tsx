import { useRef, useState, type FormEvent } from 'react';
import { api } from '../api';
import { priorities, statuses, type Project, type Task, type TaskInput } from '../types';
import { Dialog } from './Dialog';

function message(error: unknown) { return error instanceof Error ? error.message : 'Something went wrong. Please try again.'; }

export function ProjectForm({ project, onClose, onSave, onDelete }: {
  project?: Project; onClose: () => void; onSave: (project: Project) => void; onDelete: () => void;
}) {
  const [name, setName] = useState(project?.name ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try { onSave((await api.saveProject(name.trim(), project?.id)).project); }
    catch (error) { setError(message(error)); }
    finally { pending.current = false; setBusy(false); }
  }
  return <Dialog title={project ? 'Edit project' : 'Create a project'} subtitle="Give your next chapter a little space." onClose={onClose} busy={busy} dirty={name !== (project?.name ?? '')}>
    <form onSubmit={submit}>
      <fieldset disabled={busy}>
        <label htmlFor="project-name">Project name</label>
        <input id="project-name" name="name" data-dialog-initial-focus required maxLength={100} pattern=".*\S.*" value={name} onChange={event => setName(event.target.value)} placeholder="e.g. A place of my own" />
      </fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-actions">
        {project && <button type="button" className="button danger-text" disabled={busy} onClick={onDelete}>Delete project</button>}
        <div className="action-spacer" />
        <button type="button" className="button secondary" disabled={busy} onClick={() => { if (name === (project?.name ?? '') || window.confirm('Discard your unsaved changes?')) onClose(); }}>Cancel</button>
        <button className="button primary" disabled={busy || !name.trim()}>{busy ? 'Saving…' : project ? 'Save changes' : 'Create project'}</button>
      </div>
    </form>
  </Dialog>;
}

export function TaskForm({ task, projects, initialProjectId, onClose, onSave, onDelete }: {
  task?: Task; projects: Project[]; initialProjectId: string; onClose: () => void;
  onSave: (task: Task) => void; onDelete: () => void;
}) {
  const initial = useRef<TaskInput>({
    projectId: task?.projectId ?? initialProjectId,
    title: task?.title ?? '', description: task?.description ?? '',
    priority: task?.priority ?? 'medium', dueDate: task?.dueDate ?? null, status: task?.status ?? 'backlog',
  }).current;
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  function field<K extends keyof TaskInput>(key: K, value: TaskInput[K]) { setDraft(current => ({ ...current, [key]: value })); }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try { onSave((await api.saveTask({ ...draft, title: draft.title.trim() }, task?.id)).task); }
    catch (error) { setError(message(error)); }
    finally { pending.current = false; setBusy(false); }
  }
  return <Dialog title={task ? 'Edit task' : 'A new next step'} subtitle={task ? 'Make room for the details.' : 'Small steps make good things happen.'} busy={busy} dirty={dirty} onClose={onClose}>
    <form onSubmit={submit}>
      <fieldset disabled={busy} className="form-fields">
        <div><label htmlFor="task-title">Task title</label><input id="task-title" name="title" data-dialog-initial-focus required maxLength={200} pattern=".*\S.*" value={draft.title} onChange={event => field('title', event.target.value)} placeholder="What would you like to do?" /></div>
        <div><label htmlFor="task-project">Project</label><select id="task-project" name="projectId" required value={draft.projectId} onChange={event => field('projectId', event.target.value)}>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></div>
        <div><label htmlFor="task-description">Description <span className="label-hint">optional</span></label><textarea id="task-description" name="description" maxLength={5000} rows={4} value={draft.description} onChange={event => field('description', event.target.value)} placeholder="Notes, context, or a useful starting point…" /></div>
        <div className="form-grid">
          <div><label htmlFor="task-priority">Priority</label><select id="task-priority" name="priority" value={draft.priority} onChange={event => field('priority', event.target.value as Task['priority'])}>{priorities.map(priority => <option key={priority} value={priority}>{priority[0].toUpperCase() + priority.slice(1)}</option>)}</select></div>
          <div><label htmlFor="task-status">Status</label><select id="task-status" name="status" value={draft.status} onChange={event => field('status', event.target.value as Task['status'])}>{statuses.map(status => <option key={status.value} value={status.value}>{status.label}</option>)}</select></div>
          <div><label htmlFor="task-due">Due date <span className="label-hint">optional</span></label><input id="task-due" type="date" name="dueDate" min="0001-01-01" max="9999-12-31" value={draft.dueDate ?? ''} onChange={event => field('dueDate', event.target.value || null)} /></div>
        </div>
      </fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-actions">
        {task && <button type="button" className="button danger-text" disabled={busy} onClick={onDelete}>Delete task</button>}
        <div className="action-spacer" />
        <button type="button" className="button secondary" disabled={busy} onClick={() => { if (!dirty || window.confirm('Discard your unsaved changes?')) onClose(); }}>Cancel</button>
        <button className="button primary" disabled={busy || !draft.title.trim()}>{busy ? 'Saving…' : task ? 'Save changes' : 'Create task'}</button>
      </div>
    </form>
  </Dialog>;
}

export function DeleteConfirmation({ kind, name, taskCount, onClose, onConfirm }: {
  kind: 'project' | 'task'; name: string; taskCount?: number; onClose: () => void; onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  async function remove() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try { await onConfirm(); }
    catch (error) { setError(message(error)); }
    finally { pending.current = false; setBusy(false); }
  }
  return <Dialog title={`Delete this ${kind}?`} onClose={onClose} busy={busy}>
    <p className="delete-description">“<strong>{name}</strong>” will be permanently deleted.{kind === 'project' && <> All {taskCount} tasks in this project will also be deleted.</>} This cannot be undone.</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="dialog-actions"><div className="action-spacer" /><button className="button secondary" data-dialog-initial-focus disabled={busy} onClick={onClose}>Keep {kind}</button><button className="button danger" disabled={busy} onClick={remove}>{busy ? 'Deleting…' : `Delete ${kind}`}</button></div>
  </Dialog>;
}
