import { statuses, type Project, type Status, type Task } from '../types';

function dueLabel(date: string) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${date}T12:00:00`));
}
function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function TaskBoard({ tasks, projects, pendingIds, onEdit, onMove, filtered }: {
  tasks: Task[]; projects: Project[]; pendingIds: Set<string>;
  onEdit: (task: Task) => void; onMove: (task: Task, status: Status) => void; filtered: boolean;
}) {
  return <div className="board">
    {statuses.map(status => {
      const columnTasks = tasks.filter(task => task.status === status.value);
      return <section className={`column column-${status.value}`} key={status.value} aria-labelledby={`column-${status.value}`}>
        <header className="column-heading"><div className="column-title"><span className="status-dot" /><h2 id={`column-${status.value}`}>{status.label}</h2><span className="count">{columnTasks.length}</span></div><p>{status.description}</p></header>
        <div className="task-list">
          {columnTasks.map(task => {
            const project = projects.find(project => project.id === task.projectId);
            const overdue = task.dueDate && task.dueDate < today() && task.status !== 'done';
            return <article className="task-card" key={task.id} aria-busy={pendingIds.has(task.id)}>
              <div className="card-top"><span className={`priority priority-${task.priority}`}>{task.priority} priority</span><span className="project-tag" title={project?.name}>{project?.name ?? 'Project'}</span></div>
              <h3><button className="task-title" disabled={pendingIds.has(task.id)} onClick={() => onEdit(task)}>{task.title}</button></h3>
              {task.description && <p className="task-description">{task.description}</p>}
              {task.dueDate && <p className={`due-date ${overdue ? 'overdue' : ''}`}><span aria-hidden="true">▤</span> {overdue ? 'Overdue · ' : 'Due '}{dueLabel(task.dueDate)}</p>}
              <div className="card-footer"><label className="sr-only" htmlFor={`status-${task.id}`}>Status for {task.title}</label><select id={`status-${task.id}`} className="status-select" value={task.status} aria-disabled={pendingIds.has(task.id)} onChange={event => { if (!pendingIds.has(task.id)) onMove(task, event.target.value as Status); }}>{statuses.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select><button className="text-button edit-task" disabled={pendingIds.has(task.id)} onClick={() => onEdit(task)} aria-label={`Edit task: ${task.title}`}>Edit <span aria-hidden="true">↗</span></button></div>
            </article>;
          })}
          {columnTasks.length === 0 && <div className="column-empty"><span aria-hidden="true">{status.value === 'done' ? '✓' : '·'}</span><p>{filtered ? 'No matching tasks' : status.value === 'done' ? 'Good things take a few steps.' : status.value === 'in_progress' ? 'Ready when you are.' : 'Room for your next idea.'}</p></div>}
        </div>
      </section>;
    })}
  </div>;
}
