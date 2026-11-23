import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CircleAlert, Columns3, Database, FolderOpen, GitFork, LayoutDashboard, LoaderCircle, Network, PanelLeftClose, PanelLeftOpen, Plus, Search, Table2, Tag as TagIcon } from 'lucide-react';
import { Icon } from './components/Icon';
import { api } from './api';
import { DeleteConfirmation, ProjectForm, TaskForm } from './components/Forms';
import { TaskBoard } from './components/TaskBoard';
import { TagManager } from './components/TagCollection';
import { ProjectPicker } from './components/ProjectPicker';
import { AppearanceControls } from './components/AppearanceControls';
import { DataModeling, type ModelNavigation } from './components/DataModeling';
import { Models } from './components/Models';
import { ErDesigner, type ErNavigation } from './components/erd/ErDesigner';
import { BackendSchema } from './components/BackendSchema';
import { useModelPersistence } from './components/useModelPersistence';
import { useButtonRipples } from './ripple';
import { priorities, statuses, type Priority, type Project, type Status, type Tag, type Task } from './types';

type Editor = { kind: 'project'; project?: Project } | { kind: 'task'; task: Task; initialStatus?: never } | { kind: 'task'; task?: never; initialStatus: Status } | null;
type Deletion = { kind: 'project'; project: Project } | { kind: 'task'; task: Task } | { kind: 'tag'; tag: Tag; usage: number } | null;

export function App() {
  useButtonRipples();
  const [projects, setProjects] = useState<Project[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [countAnnouncement, setCountAnnouncement] = useState('');
  const [workspace, setWorkspace] = useState<'backlog' | 'data-modeling' | 'erd' | 'backend-schema'>('backlog');
  const [navigationCollapsed, setNavigationCollapsed] = useState(false);
  const modelPersistence = useModelPersistence();
  const modelNavigation = useRef<ModelNavigation | null>(null);
  const erNavigation = useRef<ErNavigation | null>(null);
  const [erBlocked, setErBlocked] = useState(false);
  const [modelsRefresh, setModelsRefresh] = useState(0);
  const [modelsOpen, setModelsOpen] = useState(true);
  const modelsTrigger = useRef<HTMLButtonElement>(null);
  const [modelDialog, setModelDialog] = useState<'node' | 'relationship' | null>(null);
  const [projectId, setProjectId] = useState('all');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<Status | 'all'>('all');
  const [priority, setPriority] = useState<Priority | 'all'>('all');
  const [tagFilter, setTagFilter] = useState<string | 'all'>('all');
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
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
      const [projectData, tagData, taskData] = await Promise.all([api.projects(), api.tags(), api.tasks()]);
      setProjects(projectData.projects); setTags(tagData.tags); setTasks(taskData.tasks);
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
  const filtered = Boolean(search.trim()) || status !== 'all' || priority !== 'all' || tagFilter !== 'all';
  const visibleTasks = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return tasks.filter(task => (projectId === 'all' || task.projectId === projectId)
      && (status === 'all' || task.status === status) && (priority === 'all' || task.priority === priority)
      && (tagFilter === 'all' || task.tagIds.includes(tagFilter))
      && (!query || `${task.title}\n${task.description}\n${projects.find(project => project.id === task.projectId)?.name ?? ''}\n${tags.filter(tag => task.tagIds.includes(tag.id)).map(tag => tag.name).join('\n')}`.toLocaleLowerCase().includes(query)));
  }, [tasks, projects, tags, projectId, status, priority, tagFilter, search]);
  const scopedTasks = tasks.filter(task => projectId === 'all' || task.projectId === projectId);
  const complete = scopedTasks.filter(task => task.status === 'done').length;
  useEffect(() => {
    if (loading || loadError || workspace !== 'backlog') { setCountAnnouncement(''); return; }
    const timeout = window.setTimeout(() => {
      setCountAnnouncement(filtered && visibleTasks.length === 0
        ? 'No tasks match these filters.'
        : `${visibleTasks.length} ${visibleTasks.length === 1 ? 'task' : 'tasks'} ${filtered ? 'matching filters' : 'in view'}`);
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [visibleTasks.length, filtered, loading, loadError, workspace]);
  function clearFilters() { setSearch(''); setStatus('all'); setPriority('all'); setTagFilter('all'); }
  const navBusy = Boolean(editor || deletion || modelDialog || tagManagerOpen) || erBlocked || modelPersistence.saving || modelPersistence.creating || modelPersistence.deleting || modelPersistence.phase === 'loading';
  function navigateWorkspace(next: typeof workspace) {
    if (!editor && !deletion && !modelDialog && !tagManagerOpen && modelNavigation.current?.canNavigate() && erNavigation.current?.canNavigate()) setWorkspace(next);
  }
  async function openModel(id: string) {
    if (!erNavigation.current?.canNavigate()) return;
    if (await modelNavigation.current?.openFromBrowser(id)) setWorkspace('data-modeling');
  }
  function newModel() {
    if (!erNavigation.current?.canNavigate()) return;
    if (modelNavigation.current?.newFromBrowser()) setWorkspace('data-modeling');
  }
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
  function savedTag(tag: Tag) {
    const exists = tags.some(item => item.id === tag.id);
    setTags(current => (exists ? current.map(item => item.id === tag.id ? tag : item) : [...current, tag])
      .sort((a, b) => a.name.localeCompare(b.name)));
    setNotice(exists ? 'Tag updated.' : 'Tag created.');
  }
  async function moveTask(task: Task, nextStatus: Status) {
    if (moving.current.has(task.id)) return;
    moving.current.add(task.id); setPendingIds(new Set(moving.current)); setActionError(''); setNotice('');
    try {
      const result = await api.moveTask(task.id, nextStatus);
      const source = document.activeElement;
      if (source instanceof HTMLElement && (source.id === `status-${task.id}` || source.id === `task-disclosure-${task.id}`)) {
        moveFocus.current = { id: source.id, source };
      }
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
    } else if (deletion.kind === 'tag') {
      const id = deletion.tag.id;
      await api.deleteTag(id);
      setTags(current => current.filter(tag => tag.id !== id));
      setTasks(current => current.map(task => task.tagIds.includes(id) ? { ...task, tagIds: task.tagIds.filter(tagId => tagId !== id) } : task));
      if (tagFilter === id) setTagFilter('all');
      setNotice('Tag deleted.');
    } else {
      await api.deleteTask(deletion.task.id);
      setTasks(current => current.filter(task => task.id !== deletion.task.id));
      setNotice('Task deleted.');
    }
    setDeletion(null); setEditor(null);
  }
  return <>
    <a href="#main" className="skip-link">Skip to workspace</a>
    <div className={`app-shell${workspace !== 'backlog' ? ' app-shell-modeling' : ''}${navigationCollapsed ? ' navigation-collapsed' : ''}`}>
      <aside id="workspace-navigation" className="sidebar" aria-label="Workspace navigation">
        <div className="brand"><img className="brand-mark" src="/forge-logo.svg" alt="" /><div className="brand-wordmark"><span>The</span> Forge</div></div>
        <AppearanceControls />
        <nav className="project-nav" aria-label="General navigation">
          <div className="sidebar-section-heading"><span>General</span></div>
          <ul className="workspace-nav-list">
            <li><button className={`nav-item ${workspace === 'backlog' ? 'active' : ''}`} aria-label="Backlog" title="Backlog" aria-current={workspace === 'backlog' ? 'true' : undefined} disabled={navBusy} onClick={() => navigateWorkspace('backlog')}><Icon icon={LayoutDashboard} /><span>Backlog</span><span className="nav-count">{tasks.length}</span></button></li>
            <li>
              <button className="nav-item" aria-label="Data Modeling" title="Data Modeling" disabled={navBusy} onClick={() => navigateWorkspace('data-modeling')}><Icon icon={Network} /><span>Data Modeling</span></button>
              <ul className="workspace-nav-list workspace-nav-children">
                <li><button className={`nav-item ${workspace === 'data-modeling' ? 'active' : ''}`} aria-label="Graph" title="Graph" aria-current={workspace === 'data-modeling' ? 'true' : undefined} disabled={navBusy} onClick={() => navigateWorkspace('data-modeling')}><Icon icon={GitFork} /><span>Graph</span></button></li>
                <li><button className={`nav-item ${workspace === 'erd' ? 'active' : ''}`} aria-label="ERD" title="ERD" aria-current={workspace === 'erd' ? 'true' : undefined} disabled={navBusy} onClick={() => navigateWorkspace('erd')}><Icon icon={Table2} /><span>ERD</span></button></li>
              </ul>
            </li>
            <li><button className={`nav-item ${workspace === 'backend-schema' ? 'active' : ''}`} aria-label="Backend schema" title="Backend schema" aria-current={workspace === 'backend-schema' ? 'true' : undefined} disabled={navBusy} onClick={() => navigateWorkspace('backend-schema')}><Icon icon={Database} /><span>Backend schema</span></button></li>
          </ul>
        </nav>
        <button className="icon-button navigation-toggle" aria-label={navigationCollapsed ? 'Expand navigation' : 'Collapse navigation'} title={navigationCollapsed ? 'Expand navigation' : 'Collapse navigation'} aria-expanded={!navigationCollapsed} aria-controls="workspace-navigation" disabled={navBusy} onClick={() => { if (modelNavigation.current?.canNavigate() && erNavigation.current?.canNavigate()) setNavigationCollapsed(value => !value); }}><Icon icon={navigationCollapsed ? PanelLeftOpen : PanelLeftClose} /></button>
      </aside>
      <main id="main" tabIndex={-1} className={`workspace${workspace !== 'backlog' ? ' workspace-modeling' : ''}`}>
        <div hidden={workspace !== 'backlog'}>
        <header className="workspace-header">
          <div className="backlog-heading">
            <p className="eyebrow">A LITTLE CLARITY, EVERY DAY</p>
            <div className="backlog-title">
              <h1 id="workspace-title" tabIndex={-1}>Backlog:</h1>
              <ProjectPicker projects={projects} selectedProject={selectedProject} disabled={loading || Boolean(loadError)} onSelect={setProjectId} onNew={() => openEditor({ kind: 'project' })} />
            </div>
          </div>
        </header>
        <div className="workspace-summary"><span><strong>{scopedTasks.filter(task => task.status !== 'done').length}</strong> open tasks</span><span className="summary-divider" /><span><strong>{complete}</strong> completed</span><div className="progress-track" role="progressbar" aria-label="Tasks completed" aria-valuenow={complete} aria-valuemin={0} aria-valuemax={scopedTasks.length || 1}><span style={{ width: `${scopedTasks.length ? complete / scopedTasks.length * 100 : 0}%` }} /></div></div>
        <section className="toolbar" aria-label="Search and filter tasks">
          <div className="search-field"><Icon icon={Search} /><label htmlFor="search" className="sr-only">Search tasks, descriptions, and tags</label><input id="search" type="search" placeholder="Search your tasks…" value={search} onChange={event => setSearch(event.target.value)} /></div>
          <div className="filter-field"><label htmlFor="status-filter">Status</label><select id="status-filter" value={status} onChange={event => setStatus(event.target.value as Status | 'all')}><option value="all">All statuses</option>{statuses.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>
          <div className="filter-field"><label htmlFor="priority-filter">Priority</label><select id="priority-filter" value={priority} onChange={event => setPriority(event.target.value as Priority | 'all')}><option value="all">All priorities</option>{priorities.map(item => <option key={item} value={item}>{item[0].toUpperCase() + item.slice(1)}</option>)}</select></div>
          <div className="filter-field"><label htmlFor="tag-filter">Tag</label><select id="tag-filter" value={tagFilter} onChange={event => setTagFilter(event.target.value)}><option value="all">All tags</option>{tags.map(tag => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select></div>
        </section>
        {selectedProject && <div className="project-actions" role="group" aria-label="Project management">
          <button className="text-button" aria-label={`Edit project: ${selectedProject.name}`} disabled={loading || Boolean(loadError)} onClick={() => openEditor({ kind: 'project', project: selectedProject })}>Edit selected project</button>
        </div>}
        <div className="board-meta"><span>{loading ? 'Your workspace' : `${visibleTasks.length} ${visibleTasks.length === 1 ? 'task' : 'tasks'}${filtered ? ' matching filters' : ' in view'}`}</span>{filtered && <button className="text-button" onClick={clearFilters}>Clear filters</button>}<button className="text-button tag-manage" disabled={loading || Boolean(loadError)} onClick={() => setTagManagerOpen(true)}><Icon icon={TagIcon} /> Manage tags</button><span className="view-label"><Icon icon={Columns3} /> Board view</span></div>
        <div className="sr-only" role="status">{countAnnouncement}</div>
        <div className="announcement" role="status">{notice}</div>
        {actionError && <div className="error-banner" role="alert"><p>{actionError} Your task hasn’t changed. Select a status to retry.</p><button className="text-button" onClick={() => setActionError('')}>Dismiss</button></div>}
        {loading ? <div className="state-panel" role="status"><span className="state-symbol" aria-hidden="true"><Icon icon={LoaderCircle} /></span><h2>Opening your workspace</h2><p>Gathering your projects and next steps…</p></div>
          : loadError ? <div className="state-panel error-state" role="alert"><span className="state-symbol" aria-hidden="true"><Icon icon={CircleAlert} /></span><h2>Let’s reconnect</h2><p>{loadError}</p><button className="button primary" onClick={() => void load()}>Try again</button></div>
          : projects.length === 0 ? <div className="state-panel welcome"><span className="welcome-art" aria-hidden="true"><Icon icon={FolderOpen} /><span><Icon icon={Plus} /></span></span><p className="eyebrow">A FRESH START</p><h2>Good things start with an idea.</h2><p>Give it a home. Create a project, add your first task,<br className="desktop-break" /> and take it one small step at a time.</p><button className="button primary" onClick={() => openEditor({ kind: 'project' })}><Icon icon={Plus} /> Create your first project</button></div>
          : <><TaskBoard tasks={visibleTasks} projects={projects} tags={tags} pendingIds={pendingIds} onAdd={initialStatus => openEditor({ kind: 'task', initialStatus })} onEdit={task => openEditor({ kind: 'task', task })} onMove={(task, status) => void moveTask(task, status)} filtered={filtered} />{filtered && visibleTasks.length === 0 && <div className="board-nudge"><p>No tasks match these filters.</p><button className="text-button" onClick={clearFilters}>Clear filters</button></div>}</>}
        <footer className="workspace-footer">A quieter place to get things done.<span>No rush. Just your next step.</span></footer>
        </div>
        <div className="erd-workspace" hidden={workspace !== 'erd'}><ErDesigner active={workspace === 'erd'} navigation={erNavigation} onBlockedChange={setErBlocked} /></div>
        {workspace === 'backend-schema' && <BackendSchema />}
        <div className="modeling-workspace" hidden={workspace !== 'data-modeling'}><DataModeling active={workspace === 'data-modeling'} browserOpen={modelsOpen} browseButton={modelsTrigger} onBrowse={() => setModelsOpen(value => !value)} dialog={modelDialog} setDialog={setModelDialog} persistence={modelPersistence} navigation={modelNavigation} onSaved={() => setModelsRefresh(value => value + 1)} >
          <Models active={modelsOpen && workspace === 'data-modeling'} refresh={modelsRefresh} currentId={modelPersistence.id} busy={modelPersistence.saving || modelPersistence.creating || modelPersistence.deleting || modelPersistence.phase === 'loading'} deleting={modelPersistence.deleting} openError={modelPersistence.failedLoadId ? modelPersistence.error : ''} onOpen={id => void openModel(id)} onNew={newModel} onDelete={model => modelNavigation.current?.deleteFromBrowser(model) ?? Promise.resolve(false)} />
        </DataModeling></div>
      </main>
    </div>
    {editor?.kind === 'project' && <ProjectForm project={editor.project} onClose={() => setEditor(null)} onSave={savedProject} onDelete={() => editor.project && setDeletion({ kind: 'project', project: editor.project })} />}
    {editor?.kind === 'task' && <TaskForm task={editor.task} projects={projects} tags={tags} initialProjectId={selectedProject?.id ?? projects[0]?.id ?? ''} initialStatus={editor.initialStatus} onClose={() => setEditor(null)} onSave={savedTask} onTagSaved={savedTag} onDelete={() => editor.task && setDeletion({ kind: 'task', task: editor.task })} />}
    {tagManagerOpen && <TagManager tags={tags} onClose={() => setTagManagerOpen(false)} onSaved={savedTag} onDelete={tag => setDeletion({ kind: 'tag', tag, usage: tasks.filter(task => task.tagIds.includes(tag.id)).length })} />}
    {deletion && <DeleteConfirmation kind={deletion.kind} name={deletion.kind === 'project' ? deletion.project.name : deletion.kind === 'tag' ? deletion.tag.name : deletion.task.title} taskCount={deletion.kind === 'project' ? tasks.filter(task => task.projectId === deletion.project.id).length : deletion.kind === 'tag' ? deletion.usage : undefined} onClose={() => setDeletion(null)} onConfirm={confirmDelete} />}
  </>;
}
