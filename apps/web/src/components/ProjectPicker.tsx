import { useId, useRef, useState, type FocusEvent } from 'react';
import { Check, ChevronDown, Plus } from 'lucide-react';
import type { Project } from '../types';
import { Icon } from './Icon';

export function ProjectPicker({ projects, selectedProject, disabled, onSelect, onNew }: {
  projects: Project[];
  selectedProject?: Project;
  disabled: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const name = selectedProject?.name ?? 'All';

  function closeOnFocusLeave({ relatedTarget }: FocusEvent<HTMLElement>) {
    const panel = popover.current;
    if (relatedTarget && relatedTarget !== trigger.current && !panel?.contains(relatedTarget) && panel?.matches(':popover-open')) {
      panel.hidePopover();
    }
  }

  function complete(action: () => void) {
    popover.current?.hidePopover();
    // The shared dialog captures this focus when New project opens.
    trigger.current?.focus({ preventScroll: true });
    action();
  }

  function choice(id: string, label: string) {
    const selected = id === (selectedProject?.id ?? 'all');
    return <button key={id} type="button" className="project-picker-choice" aria-pressed={selected} onClick={() => complete(() => onSelect(id))}>
      <span className="project-picker-check" aria-hidden="true">{selected && <Icon icon={Check} />}</span><span>{label}</span>
    </button>;
  }

  return <>
    <button ref={trigger} type="button" className="backlog-project" popoverTarget={id} aria-expanded={isOpen} aria-label={`Project: ${name}`} title={selectedProject?.name} disabled={disabled} onBlur={closeOnFocusLeave}>
      <span className="backlog-project-value">{name}</span><Icon icon={ChevronDown} />
    </button>
    <div ref={popover} id={id} popover="auto" className="project-picker" role="group" aria-label="Project picker"
      onToggle={event => {
        const open = event.currentTarget.matches(':popover-open');
        setIsOpen(open);
        if (open) event.currentTarget.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
      }}
      onBlur={closeOnFocusLeave}>
      <div role="group" aria-label="Project scope">
        {choice('all', 'All')}
        {projects.length > 0 && <div className="project-picker-projects" role="group" aria-label="Projects">
          <div className="project-picker-label" aria-hidden="true">Projects</div>
          {projects.map(project => choice(project.id, project.name))}
        </div>}
      </div>
      <div className="project-picker-actions"><button type="button" className="text-button" onClick={() => complete(onNew)}><Icon icon={Plus} /> New project</button></div>
    </div>
  </>;
}
