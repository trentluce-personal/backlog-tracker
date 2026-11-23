import type { ModelInput, StoredModel, NamedModel, ModelSummary, ReferenceCatalogModel, Project, Tag, TagColor, Task, TaskInput, ValidationResult, ExportFormat, ModelExport } from './types';

export interface BackendSchemaResponse {
  sqlite: {
    userVersion: number;
    tables: {
      name: string;
      ddl: string | null;
      columns: { position: number; name: string; declaredType: string; notNull: boolean; defaultSql: string | null; primaryKeyPosition: number }[];
      foreignKeys: { id: number; sequence: number; table: string; from: string; to: string | null; onUpdate: string; onDelete: string; match: string }[];
      indexes: { name: string; unique: boolean; origin: string; partial: boolean; ddl: string | null; columns: { sequence: number; position: number; name: string | null }[] }[];
    }[];
  };
  jsonStorage: { name: string; schemaVersion: number; fields: string[]; collections: { name: string; fields: string[] }[] }[];
}

export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly validation?: ValidationResult) { super(message); }
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
    throw new ApiError(data?.error || `The server could not complete this request (${response.status}). Please try again.`, response.status, data?.validation);
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}

export const api = {
  backendSchema: () => request<BackendSchemaResponse>('/backend-schema'),
  modelNodeDefinitions: () => request<{ models: ReferenceCatalogModel[] }>('/model-catalog'),
  validateModel: (modelId: string, model: ModelInput, excludeDrafts: boolean) => request<ValidationResult>('/model-validation', 'POST', { modelId, model, excludeDrafts }),
  exportModel: (modelId: string, model: ModelInput, excludeDrafts: boolean, format: ExportFormat, acknowledgeGraphTypeReplacement: boolean) => request<ModelExport>('/model-export', 'POST', { modelId, model, excludeDrafts, format, ...(acknowledgeGraphTypeReplacement ? { acknowledgeGraphTypeReplacement: true } : {}) }),
  models: () => request<{ models: ModelSummary[] }>('/models'),
  deleteModel: (id: string, expectedRevision: number) => request<void>(`/models/${encodeURIComponent(id)}`, 'DELETE', { expectedRevision }),
  namedModel: (id: string) => request<NamedModel>(`/models/${encodeURIComponent(id)}`),
  createModel: (name: string, model: ModelInput) => request<NamedModel>('/models', 'POST', { name, model }),
  updateModel: (id: string, expectedRevision: number, name: string, model: ModelInput) => request<NamedModel>(`/models/${encodeURIComponent(id)}`, 'PUT', { expectedRevision, name, model }),
  model: () => request<{ model: StoredModel }>('/model'),
  saveModel: (expectedRevision: number, model: ModelInput) => request<{ model: StoredModel }>('/model', 'PUT', { expectedRevision, model }),
  projects: () => request<{ projects: Project[] }>('/projects'),
  tags: () => request<{ tags: Tag[] }>('/tags'),
  saveTag: (name: string, color: TagColor, id?: string) => request<{ tag: Tag }>(id ? `/tags/${id}` : '/tags', id ? 'PATCH' : 'POST', { name, color }),
  deleteTag: (id: string) => request<void>(`/tags/${id}`, 'DELETE'),
  tasks: () => request<{ tasks: Task[] }>('/tasks'),
  saveProject: (name: string, id?: string) => request<{ project: Project }>(id ? `/projects/${id}` : '/projects', id ? 'PATCH' : 'POST', { name }),
  deleteProject: (id: string) => request<void>(`/projects/${id}`, 'DELETE'),
  saveTask: (task: TaskInput, id?: string) => request<{ task: Task }>(id ? `/tasks/${id}` : '/tasks', id ? 'PATCH' : 'POST', task),
  moveTask: (id: string, status: Task['status']) => request<{ task: Task }>(`/tasks/${id}`, 'PATCH', { status }),
  deleteTask: (id: string) => request<void>(`/tasks/${id}`, 'DELETE'),
};
