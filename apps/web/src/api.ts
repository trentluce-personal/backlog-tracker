import type { ModelInput, StoredModel, NamedModel, ModelSummary, ReferenceCatalogModel, Project, Task, TaskInput } from './types';

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error('Could not reach the local server. Check that it is running, then try again.');
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new ApiError(data?.error || `The server could not complete this request (${response.status}). Please try again.`, response.status);
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}

export const api = {
  modelNodeDefinitions: () => request<{ models: ReferenceCatalogModel[] }>('/model-node-definitions'),
  models: () => request<{ models: ModelSummary[] }>('/models'),
  deleteModel: (id: string, expectedRevision: number) => request<void>(`/models/${encodeURIComponent(id)}`, 'DELETE', { expectedRevision }),
  namedModel: (id: string) => request<NamedModel>(`/models/${encodeURIComponent(id)}`),
  createModel: (name: string, model: ModelInput) => request<NamedModel>('/models', 'POST', { name, model }),
  updateModel: (id: string, expectedRevision: number, name: string, model: ModelInput) => request<NamedModel>(`/models/${encodeURIComponent(id)}`, 'PUT', { expectedRevision, name, model }),
  model: () => request<{ model: StoredModel }>('/model'),
  saveModel: (expectedRevision: number, model: ModelInput) => request<{ model: StoredModel }>('/model', 'PUT', { expectedRevision, model }),
  projects: () => request<{ projects: Project[] }>('/projects'),
  tasks: () => request<{ tasks: Task[] }>('/tasks'),
  saveProject: (name: string, id?: string) => request<{ project: Project }>(id ? `/projects/${id}` : '/projects', id ? 'PATCH' : 'POST', { name }),
  deleteProject: (id: string) => request<void>(`/projects/${id}`, 'DELETE'),
  saveTask: (task: TaskInput, id?: string) => request<{ task: Task }>(id ? `/tasks/${id}` : '/tasks', id ? 'PATCH' : 'POST', task),
  moveTask: (id: string, status: Task['status']) => request<{ task: Task }>(`/tasks/${id}`, 'PATCH', { status }),
  deleteTask: (id: string) => request<void>(`/tasks/${id}`, 'DELETE'),
};
