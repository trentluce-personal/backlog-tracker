import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import { api } from '../api';
import { priorities, statuses, type Project, type Status, type Task, type TaskInput } from '../types';
import { Dialog } from './Dialog';

function message(error: unknown) { return error instanceof Error ? error.message : 'Something went wrong. Please try again.'; }

function useBusyFocus(busy: boolean, anchor: RefObject<HTMLButtonElement | null>) {
  const previous = useRef(false);
  useEffect(() => {
    if ((busy || previous.current) && document.activeElement === document.body) anchor.current?.focus();
    previous.current = busy;
  }, [busy, anchor]);
}

export function ProjectForm({ project, onClose, onSave, onDelete }: {
  project?: Project; onClose: () => void; onSave: (project: Project) => void; onDelete: () => void;
}) {
  const [name, setName] = useState(project?.name ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState('');
  const pending = useRef(false);
  const submitRef = useRef<HTMLButtonElement>(null);
  useBusyFocus(busy, submitRef);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current) return;
    if (!name.trim()) {
      setFieldError('Enter a project name.');
      document.getElementById('project-name')?.focus();
      return;
    }
    pending.current = true; setBusy(true); setError('');
    try { onSave((await api.saveProject(name.trim(), project?.id)).project); }
    catch (error) { setError(message(error)); }
    finally { pending.current = false; setBusy(false); }
  }
  return <Dialog title={project ? 'Edit project' : 'Create a project'} subtitle="Give your next chapter a little space." onClose={onClose} busy={busy} dirty={name !== (project?.name ?? '')}>
    <form onSubmit={submit} noValidate>
      <fieldset disabled={busy}>
        <label htmlFor="project-name">Project name</label>
        <input id="project-name" name="name" data-dialog-initial-focus required maxLength={100} aria-invalid={fieldError ? true : undefined} aria-describedby={fieldError ? 'project-name-error' : undefined} value={name} onChange={event => { setName(event.target.value); setFieldError(''); }} placeholder="e.g. A place of my own" />
      </fieldset>
      {fieldError && <p className="form-error" role="alert" id="project-name-error">{fieldError}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-actions">
        {project && <button type="button" className="button danger-text" disabled={busy} onClick={onDelete}>Delete project</button>}
        <div className="action-spacer" />
        <button type="button" className="button secondary" disabled={busy} onClick={() => { if (name === (project?.name ?? '') || window.confirm('Discard your unsaved changes?')) onClose(); }}>Cancel</button>
        <button ref={submitRef} className="button primary" aria-disabled={busy}>{busy ? 'Saving…' : project ? 'Save changes' : 'Create project'}</button>
      </div>
    </form>
  </Dialog>;
}

export function TaskForm({ task, projects, initialProjectId, initialStatus = 'backlog', onClose, onSave, onDelete }: {
  task?: Task; projects: Project[]; initialProjectId: string; initialStatus?: Status; onClose: () => void;
  onSave: (task: Task) => void; onDelete: () => void;
}) {
  const initial = useRef<Required<TaskInput>>({
    projectId: task?.projectId ?? initialProjectId,
    title: task?.title ?? '', description: task?.description ?? '',
    priority: task?.priority ?? 'medium', dueDate: task?.dueDate ?? null, status: task?.status ?? initialStatus,
    dueTime: task?.dueTime ?? null,
  }).current;
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [incompleteDueTime, setIncompleteDueTime] = useState(false);
  const [dueTimeError, setDueTimeError] = useState(false);
  const pending = useRef(false);
  const submitRef = useRef<HTMLButtonElement>(null);
  const dueTimeRef = useRef<HTMLInputElement>(null);
  useBusyFocus(busy, submitRef);
  const dirty = incompleteDueTime || JSON.stringify(draft) !== JSON.stringify(initial);
  function field<K extends keyof TaskInput>(key: K, value: Required<TaskInput>[K]) { setDraft(current => ({ ...current, [key]: value })); }
  function changeDueDate(dueDate: string | null) {
    setDraft(current => ({ ...current, dueDate, dueTime: dueDate ? current.dueTime : null }));
    if (!dueDate) {
      setIncompleteDueTime(false);
      setDueTimeError(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current) return;
    if (!draft.title.trim()) {
      setFieldError('Enter a task title.');
      document.getElementById('task-title')?.focus();
      return;
    }
    const dueTimeInput = dueTimeRef.current;
    if (draft.dueDate && dueTimeInput?.validity.badInput) {
      setDueTimeError(true);
      dueTimeInput.focus();
      return;
    }
    pending.current = true; setBusy(true); setError('');
    try {
      const { dueTime, ...fields } = draft;
      const input = { ...fields, title: fields.title.trim(), ...(dueTime !== initial.dueTime ? { dueTime } : {}) };
      onSave((await api.saveTask(input, task?.id)).task);
    }
    catch (error) { setError(message(error)); }
    finally { pending.current = false; setBusy(false); }
  }
  return <Dialog title={task ? 'Edit task' : 'A new next step'} subtitle={task ? 'Make room for the details.' : 'Small steps make good things happen.'} busy={busy} dirty={dirty} onClose={onClose}>
    <form onSubmit={submit} noValidate>
      <fieldset disabled={busy} className="form-fields">
        <div><label htmlFor="task-title">Task title</label><input id="task-title" name="title" data-dialog-initial-focus required maxLength={200} aria-invalid={fieldError ? true : undefined} aria-describedby={fieldError ? 'task-title-error' : undefined} value={draft.title} onChange={event => { field('title', event.target.value); setFieldError(''); }} placeholder="What would you like to do?" /></div>
        <div><label htmlFor="task-project">Project</label><select id="task-project" name="projectId" required value={draft.projectId} onChange={event => field('projectId', event.target.value)}>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></div>
        <div><label htmlFor="task-description">Description <span className="label-hint">optional</span></label><textarea id="task-description" name="description" maxLength={5000} rows={4} value={draft.description} onChange={event => field('description', event.target.value)} placeholder="Notes, context, or a useful starting point…" /></div>
         <div className="form-grid task-form-grid">
          <div><label htmlFor="task-priority">Priority</label><select id="task-priority" name="priority" value={draft.priority} onChange={event => field('priority', event.target.value as Task['priority'])}>{priorities.map(priority => <option key={priority} value={priority}>{priority[0].toUpperCase() + priority.slice(1)}</option>)}</select></div>
          <div><label htmlFor="task-status">Status</label><select id="task-status" name="status" value={draft.status} onChange={event => field('status', event.target.value as Task['status'])}>{statuses.map(status => <option key={status.value} value={status.value}>{status.label}</option>)}</select></div>
           <div><label htmlFor="task-due">Due date <span className="label-hint">optional</span></label><input id="task-due" type="date" name="dueDate" min="0001-01-01" max="9999-12-31" value={draft.dueDate ?? ''} onChange={event => changeDueDate(event.target.value || null)} /></div>
           <div>
             <label htmlFor="task-due-time">Due time <span className="label-hint">optional</span></label>
             {/* Remount when removing the date to discard any native segments that aren't in the draft. */}
             <input key={draft.dueDate ? 'dated' : 'undated'} ref={dueTimeRef} id="task-due-time" type="time" name="dueTime" disabled={!draft.dueDate} value={draft.dueTime ?? ''}
               aria-invalid={dueTimeError ? true : undefined} aria-describedby={dueTimeError ? 'task-due-time-error' : undefined}
               onInput={event => {
                 const { badInput } = event.currentTarget.validity;
                 setIncompleteDueTime(badInput);
                 if (!badInput) setDueTimeError(false);
               }}
               onChange={event => field('dueTime', event.target.value || null)}
               onBlur={event => setDueTimeError(event.currentTarget.validity.badInput)} />
             {dueTimeError && <p className="form-error task-due-time-error" role="alert" id="task-due-time-error">Enter a complete time or clear the time.</p>}
           </div>
        </div>
      </fieldset>
      {fieldError && <p className="form-error" role="alert" id="task-title-error">{fieldError}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-actions">
        {task && <button type="button" className="button danger-text" disabled={busy} onClick={onDelete}>Delete task</button>}
        <div className="action-spacer" />
        <button type="button" className="button secondary" disabled={busy} onClick={() => { if (!dirty || window.confirm('Discard your unsaved changes?')) onClose(); }}>Cancel</button>
        <button ref={submitRef} className="button primary" aria-disabled={busy}>{busy ? 'Saving…' : task ? 'Save changes' : 'Create task'}</button>
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
  const deleteRef = useRef<HTMLButtonElement>(null);
  useBusyFocus(busy, deleteRef);
  async function remove() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try { await onConfirm(); }
    catch (error) { setError(message(error)); }
    finally { pending.current = false; setBusy(false); }
  }
  return <Dialog title={`Delete this ${kind}?`} onClose={onClose} busy={busy}>
    <p className="delete-description">“<strong>{name}</strong>” will be permanently deleted.{kind === 'project' && taskCount === 1 && <> Its 1 task will also be deleted.</>}{kind === 'project' && (taskCount ?? 0) > 1 && <> All {taskCount} tasks in this project will also be deleted.</>} This cannot be undone.</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="dialog-actions"><div className="action-spacer" /><button className="button secondary" data-dialog-initial-focus disabled={busy} onClick={onClose}>Keep {kind}</button><button ref={deleteRef} className="button danger" aria-disabled={busy} onClick={remove}>{busy ? 'Deleting…' : `Delete ${kind}`}</button></div>
  </Dialog>;
}
