import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { DeleteConfirmation, ProjectForm, TaskForm } from './components/Forms';
import { TaskBoard } from './components/TaskBoard';
import { AppearanceControls } from './components/AppearanceControls';
import { useButtonRipples } from './ripple';
import { priorities, statuses, type Priority, type Project, type Status, type Task } from './types';

type Editor = { kind: 'project'; project?: Project } | { kind: 'task'; task?: Task } | null;
type Deletion = { kind: 'project'; project: Project } | { kind: 'task'; task: Task } | null;

export function App() {
  useButtonRipples();
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [projectId, setProjectId] = useState('all');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<Status | 'all'>('all');
  const [priority, setPriority] = useState<Priority | 'all'>('all');
  const [editor, setEditor] = useState<Editor>(null);
  const [deletion, setDeletion] = useState<Deletion>(null);
  const [pendingIds, setPendingIds] = useState(new Set<string>());
  const moving = useRef(new Set<string>());
  const moveFocus = useRef<{ id: string; source: HTMLElement } | null>(null);
  useLayoutEffect(() => {
    const restore = moveFocus.current;
    moveFocus.current = null;
    if (!restore) return;
    // Only repair focus lost by this commit; never override navigation while saving.
    if (document.activeElement !== restore.source
      && (restore.source.isConnected || document.activeElement !== document.body)) return;
    (document.getElementById(restore.id) ?? document.getElementById('status-filter'))?.focus();
  }, [tasks]);
  const load = useCallback(async () => {
    setLoading(true); setLoadError('');
    try {
      const [projectData, taskData] = await Promise.all([api.projects(), api.tasks()]);
      setProjects(projectData.projects); setTasks(taskData.tasks);
    } catch (error) { setLoadError(error instanceof Error ? error.message : 'Could not load your workspace. Please try again.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(''), 5000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const selectedProject = projects.find(project => project.id === projectId);
  const filtered = Boolean(search.trim()) || status !== 'all' || priority !== 'all';
  const visibleTasks = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return tasks.filter(task => (projectId === 'all' || task.projectId === projectId)
      && (status === 'all' || task.status === status) && (priority === 'all' || task.priority === priority)
      && (!query || `${task.title}\n${task.description}\n${projects.find(project => project.id === task.projectId)?.name ?? ''}`.toLocaleLowerCase().includes(query)));
  }, [tasks, projects, projectId, status, priority, search]);
  const scopedTasks = tasks.filter(task => projectId === 'all' || task.projectId === projectId);
  const complete = scopedTasks.filter(task => task.status === 'done').length;
  function clearFilters() { setSearch(''); setStatus('all'); setPriority('all'); }
  function openEditor(value: Editor) { setNotice(''); setActionError(''); setEditor(value); }
  function savedProject(project: Project) {
    const exists = projects.some(item => item.id === project.id);
    setProjects(current => exists ? current.map(item => item.id === project.id ? project : item) : [...current, project]);
    if (!exists) setProjectId(project.id);
    setEditor(null); setNotice(exists ? 'Project updated.' : 'Project created. You’re ready to add a task.');
  }
  function savedTask(task: Task) {
    const exists = tasks.some(item => item.id === task.id);
    setTasks(current => exists ? current.map(item => item.id === task.id ? task : item) : [task, ...current]);
    setEditor(null); setNotice(exists ? 'Task updated.' : 'Task created.');
  }
  async function moveTask(task: Task, nextStatus: Status) {
    if (moving.current.has(task.id)) return;
    const source = document.getElementById(`status-${task.id}`);
    moving.current.add(task.id); setPendingIds(new Set(moving.current)); setActionError(''); setNotice('');
    try {
      const result = await api.moveTask(task.id, nextStatus);
      if (source && document.activeElement === source) moveFocus.current = { id: source.id, source };
      setTasks(current => current.map(item => item.id === task.id ? result.task : item));
      setNotice(`Task moved to ${statuses.find(item => item.value === nextStatus)?.label.toLowerCase()}.`);
    } catch (error) { setActionError(error instanceof Error ? error.message : 'Could not move this task. Please try again.'); }
    finally { moving.current.delete(task.id); setPendingIds(new Set(moving.current)); }
  }
  async function confirmDelete() {
    if (!deletion) return;
    if (deletion.kind === 'project') {
      const id = deletion.project.id;
      await api.deleteProject(id);
      setProjects(current => current.filter(project => project.id !== id));
      setTasks(current => current.filter(task => task.projectId !== id));
      if (projectId === id) setProjectId('all');
      setNotice('Project and its tasks deleted.');
    } else {
      await api.deleteTask(deletion.task.id);
      setTasks(current => current.filter(task => task.id !== deletion.task.id));
      setNotice('Task deleted.');
    }
    setDeletion(null); setEditor(null);
  }
  return <>
    <a href="#main" className="skip-link">Skip to workspace</a>
    <div className="app-shell">
      <aside className="sidebar" aria-label="Projects">
        <div className="brand"><span className="brand-mark" aria-hidden="true">b.</span><div>backlog<span>YOUR PERSONAL WORKSPACE</span></div></div>
        <AppearanceControls />
        <nav className="project-nav" aria-label="Project selection">
          <button className={`nav-item all-projects ${projectId === 'all' ? 'active' : ''}`} aria-current={projectId === 'all' ? 'page' : undefined} onClick={() => setProjectId('all')}><span className="nav-symbol" aria-hidden="true">▦</span><span>All projects</span><span className="nav-count">{tasks.length}</span></button>
          <div className="sidebar-section-heading"><h2>Projects</h2><button className="icon-button" aria-label="Create project" disabled={loading || Boolean(loadError)} onClick={() => openEditor({ kind: 'project' })}>+</button></div>
          <div className="project-items">{projects.map((project, index) => <div className="project-row" key={project.id}>
            <button className={`nav-item ${project.id === projectId ? 'active' : ''}`} aria-current={project.id === projectId ? 'page' : undefined} onClick={() => setProjectId(project.id)}><span className={`project-dot dot-${index % 4}`} aria-hidden="true" /><span className="project-name">{project.name}</span><span className="nav-count">{tasks.filter(task => task.projectId === project.id).length}</span></button>
            <button className="icon-button project-settings" aria-label={`Edit project: ${project.name}`} onClick={() => openEditor({ kind: 'project', project })}>···</button>
          </div>)}</div>
          {!loading && !loadError && projects.length === 0 && <p className="sidebar-empty">A space for every idea.<br />Create your first project to begin.</p>}
          <button className="text-button add-project" disabled={loading || Boolean(loadError)} onClick={() => openEditor({ kind: 'project' })}><span aria-hidden="true">＋</span> New project</button>
        </nav>
        <div className="local-note"><span className="local-dot" aria-hidden="true" /><div>Made for your own pace.<small>Stored locally on this device.</small></div></div>
      </aside>
      <main id="main" className="workspace">
        <header className="workspace-header"><div><p className="eyebrow">A LITTLE CLARITY, EVERY DAY</p><h1 id="workspace-title" tabIndex={-1}>{selectedProject?.name ?? 'All projects'}</h1><p className="workspace-subtitle">{selectedProject ? 'Your ideas, next steps, and small wins. All in one place.' : 'Big ideas. Small steps. A little more room to focus.'}</p></div><button className="button primary new-task" disabled={loading || Boolean(loadError)} onClick={() => openEditor(projects.length ? { kind: 'task' } : { kind: 'project' })}><span aria-hidden="true">＋</span> {projects.length ? 'New task' : 'Create project'}</button></header>
        <div className="workspace-summary"><span><strong>{scopedTasks.filter(task => task.status !== 'done').length}</strong> open tasks</span><span className="summary-divider" /><span><strong>{complete}</strong> completed</span><div className="progress-track" role="progressbar" aria-label="Tasks completed" aria-valuenow={complete} aria-valuemin={0} aria-valuemax={scopedTasks.length || 1}><span style={{ width: `${scopedTasks.length ? complete / scopedTasks.length * 100 : 0}%` }} /></div></div>
        <section className="toolbar" aria-label="Search and filter tasks">
          <div className="search-field"><span aria-hidden="true">⌕</span><label htmlFor="search" className="sr-only">Search tasks and descriptions</label><input id="search" type="search" placeholder="Search your tasks…" value={search} onChange={event => setSearch(event.target.value)} /></div>
          <div className="filter-field"><label htmlFor="project-filter">Project</label><select id="project-filter" value={projectId} onChange={event => setProjectId(event.target.value)}><option value="all">All projects</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></div>
          <div className="filter-field"><label htmlFor="status-filter">Status</label><select id="status-filter" value={status} onChange={event => setStatus(event.target.value as Status | 'all')}><option value="all">All statuses</option>{statuses.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>
          <div className="filter-field"><label htmlFor="priority-filter">Priority</label><select id="priority-filter" value={priority} onChange={event => setPriority(event.target.value as Priority | 'all')}><option value="all">All priorities</option>{priorities.map(item => <option key={item} value={item}>{item[0].toUpperCase() + item.slice(1)}</option>)}</select></div>
        </section>
        <div className="board-meta"><span>{loading ? 'Your workspace' : `${visibleTasks.length} ${visibleTasks.length === 1 ? 'task' : 'tasks'}${filtered ? ' matching filters' : ' in view'}`}</span>{filtered && <button className="text-button" onClick={clearFilters}>Clear filters</button>}<span className="view-label"><span aria-hidden="true">▥</span> Board view</span></div>
        <div className="announcement" role="status">{notice}</div>
        {actionError && <div className="error-banner" role="alert"><p>{actionError} Your task hasn’t changed. Select a status to retry.</p><button className="text-button" onClick={() => setActionError('')}>Dismiss</button></div>}
        {loading ? <div className="state-panel" role="status"><span className="state-symbol" aria-hidden="true">···</span><h2>Opening your workspace</h2><p>Gathering your projects and next steps…</p></div>
          : loadError ? <div className="state-panel error-state" role="alert"><span className="state-symbol" aria-hidden="true">!</span><h2>Let’s reconnect</h2><p>{loadError}</p><button className="button primary" onClick={() => void load()}>Try again</button></div>
          : projects.length === 0 ? <div className="state-panel welcome"><span className="welcome-art" aria-hidden="true">▤<span>＋</span></span><p className="eyebrow">A FRESH START</p><h2>Good things start with an idea.</h2><p>Give it a home. Create a project, add your first task,<br className="desktop-break" /> and take it one small step at a time.</p><button className="button primary" onClick={() => openEditor({ kind: 'project' })}><span aria-hidden="true">＋</span> Create your first project</button></div>
          : <><TaskBoard tasks={visibleTasks} projects={projects} pendingIds={pendingIds} onEdit={task => openEditor({ kind: 'task', task })} onMove={(task, status) => void moveTask(task, status)} filtered={filtered} />{!filtered && scopedTasks.length === 0 && <div className="board-nudge"><p>Your project has room to grow.</p><button className="text-button" onClick={() => openEditor({ kind: 'task' })}>Create your first task <span aria-hidden="true">→</span></button></div>}{filtered && visibleTasks.length === 0 && <div className="board-nudge"><p>No tasks match these filters.</p><button className="text-button" onClick={clearFilters}>Clear filters</button></div>}</>}
        <footer className="workspace-footer">A quieter place to get things done.<span>No rush. Just your next step.</span></footer>
      </main>
    </div>
    {editor?.kind === 'project' && <ProjectForm project={editor.project} onClose={() => setEditor(null)} onSave={savedProject} onDelete={() => editor.project && setDeletion({ kind: 'project', project: editor.project })} />}
    {editor?.kind === 'task' && <TaskForm task={editor.task} projects={projects} initialProjectId={selectedProject?.id ?? projects[0]?.id ?? ''} onClose={() => setEditor(null)} onSave={savedTask} onDelete={() => editor.task && setDeletion({ kind: 'task', task: editor.task })} />}
    {deletion && <DeleteConfirmation kind={deletion.kind} name={deletion.kind === 'project' ? deletion.project.name : deletion.task.title} taskCount={deletion.kind === 'project' ? tasks.filter(task => task.projectId === deletion.project.id).length : undefined} onClose={() => setDeletion(null)} onConfirm={confirmDelete} />}
  </>;
}
