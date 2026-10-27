export type Status = 'backlog' | 'in_progress' | 'done';
export type Priority = 'low' | 'medium' | 'high';
export interface Project { id: string; name: string; createdAt: string }
export interface Task {
  id: string;
  projectId: string;
  title: string;
  description: string;
  priority: Priority;
  dueDate: string | null;
  status: Status;
  createdAt: string;
  updatedAt: string;
}
export type TaskInput = Pick<Task, 'projectId' | 'title' | 'description' | 'priority' | 'dueDate' | 'status'>;
export const statuses: { value: Status; label: string; description: string }[] = [
  { value: 'backlog', label: 'Backlog', description: 'Ideas and next steps' },
  { value: 'in_progress', label: 'In progress', description: 'What’s moving forward' },
  { value: 'done', label: 'Done', description: 'A little progress, collected' },
];
export const priorities: Priority[] = ['low', 'medium', 'high'];
