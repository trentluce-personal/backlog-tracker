import { useEffect, useState } from 'react';
import { statuses, type Project, type Status, type Tag, type Task } from '../types';
import { dueLabel, isOverdue, localDueClock } from '../taskDue';
import { Check, ChevronDown, Minus, Pencil, Plus } from 'lucide-react';
import { Icon } from './Icon';

function useDueClock() {
  const [now, setNow] = useState(() => localDueClock(new Date()));
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    function tick() {
      clearTimeout(timer);
      const current = new Date();
      setNow(localDueClock(current));
      timer = setTimeout(tick, 60_000 - (current.getSeconds() * 1000 + current.getMilliseconds()));
    }
    function resume() { if (!document.hidden) tick(); }
    tick();
    document.addEventListener('visibilitychange', resume);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', resume);
    };
  }, []);
  return now;
}

export function TaskBoard({ tasks, projects, tags, pendingIds, onAdd, onEdit, onMove, filtered }: {
  tasks: Task[]; projects: Project[]; tags: Tag[]; pendingIds: Set<string>;
  onAdd: (status: Status) => void; onEdit: (task: Task) => void; onMove: (task: Task, status: Status) => void; filtered: boolean;
}) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const now = useDueClock();

  function toggleTask(id: string) {
    setExpandedIds(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return <div className="board">
    {statuses.map(status => {
      const columnTasks = tasks.filter(task => task.status === status.value);
      return <section className={`column column-${status.value}`} key={status.value} aria-labelledby={`column-${status.value}`}>
        <header className="column-heading">
          <div className="column-title">
            <span className="status-dot" /><h2 id={`column-${status.value}`}>{status.label}</h2><span className="count">{columnTasks.length}</span>
            <button type="button" className="text-button lane-add-task" aria-label={`Add task to ${status.label}`} onClick={() => onAdd(status.value)}><Icon icon={Plus} /> Add task</button>
          </div>
          <p>{status.description}</p>
        </header>
        <div className="task-list">
          {columnTasks.map(task => {
            const project = projects.find(project => project.id === task.projectId);
            const tagList = task.tagIds.map(id => tags.find(tag => tag.id === id)).filter((tag): tag is Tag => Boolean(tag));
            const overdue = isOverdue(task, now);
            const expanded = expandedIds.has(task.id);
            const pending = pendingIds.has(task.id);
            const detailsId = `task-details-${task.id}`;
            const dueId = `task-due-${task.id}`;
            const dueTime = task.dueTime ?? null;
            const deadline = task.dueDate ? (dueTime ? `${task.dueDate}T${dueTime}` : task.dueDate) : undefined;
            const duePrefix = overdue ? 'Overdue · ' : 'Due ';
            const fullDue = task.dueDate ? dueLabel(task.dueDate, dueTime) : '';
            return <article className="task-card" key={task.id} aria-busy={pending}>
              <h3><button type="button" id={`task-disclosure-${task.id}`} className="task-disclosure" aria-expanded={expanded} aria-controls={detailsId} aria-describedby={task.dueDate ? dueId : undefined} onClick={() => toggleTask(task.id)}>
                <Icon icon={ChevronDown} />
                <span className="task-disclosure-content">
                  <span className="task-row-top">
                    <span className="task-disclosure-summary">
                      <span className="task-title">{task.title}</span>
                      <span className={`priority priority-${task.priority} task-row-priority`}>{task.priority}</span>
                    </span>
                    {task.dueDate && <time className={`task-compact-due${overdue ? ' overdue' : ''}`} dateTime={deadline} aria-hidden="true">{overdue && 'Overdue · '}{dueLabel(task.dueDate, dueTime, true)}</time>}
                  </span>
                  {tagList.length > 0 && <span className="task-tags">{tagList.map(tag => <span key={tag.id} className={`tag-chip tag-${tag.color}`}>{tag.name}</span>)}</span>}
                </span>
              </button></h3>
              {task.dueDate && <span id={dueId} hidden>{duePrefix}{fullDue}</span>}
              <div className="task-details" id={detailsId} hidden={!expanded}>
                <div className="card-top"><span className="project-tag">{project?.name ?? 'Project'}</span></div>
                {task.description && <p className="task-description">{task.description}</p>}
                <div className="card-footer"><label className="sr-only" htmlFor={`status-${task.id}`}>Status for {task.title}</label><select id={`status-${task.id}`} className="status-select" value={task.status} aria-disabled={pending} onChange={event => { if (!pending) onMove(task, event.target.value as Status); }}>{statuses.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select><button className="text-button edit-task" disabled={pending} onClick={() => onEdit(task)} aria-label={`Edit task: ${task.title}`}>Edit <Icon icon={Pencil} /></button></div>
              </div>
            </article>;
          })}
          {columnTasks.length === 0 && <div className="column-empty"><span aria-hidden="true"><Icon icon={status.value === 'done' ? Check : Minus} /></span><p>{filtered ? 'No matching tasks' : status.value === 'done' ? 'Good things take a few steps.' : status.value === 'in_progress' ? 'Ready when you are.' : 'Room for your next idea.'}</p></div>}
        </div>
      </section>;
    })}
  </div>;
}
