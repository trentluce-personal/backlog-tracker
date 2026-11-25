import type { Project, Tag, Task } from './store.ts';
import type { TagInput, TaskInput } from './validation.ts';

export interface BacklogStore {
  projects(): Project[] | Promise<Project[]>;
  tags(): Tag[] | Promise<Tag[]>;
  tasks(): Task[] | Promise<Task[]>;
  createProject(name: string): Project | Promise<Project>;
  updateProject(id: string, name: string): Project | Promise<Project>;
  deleteProject(id: string): void | Promise<void>;
  createTag(input: TagInput): Tag | Promise<Tag>;
  updateTag(id: string, input: Partial<TagInput>): Tag | Promise<Tag>;
  deleteTag(id: string): void | Promise<void>;
  createTask(input: Partial<TaskInput>): Task | Promise<Task>;
  updateTask(id: string, input: Partial<TaskInput>): Task | Promise<Task>;
  deleteTask(id: string): void | Promise<void>;
  registerWorkspace?(input: { name: string; volume: string; containerPath: string }): void | Promise<void>;
  close(): void | Promise<void>;
}
