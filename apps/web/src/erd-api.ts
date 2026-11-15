import type { ErDocument, ErExport, ErModel, ErSummary } from './erd-types';

export class ErApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}
async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch { throw new Error('Could not reach the local server. Please try again.'); }
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new ErApiError(data?.error || `Request failed (${response.status}).`, response.status);
  }
  return response.status === 204 ? undefined as T : response.json();
}
export const erApi = {
  list: () => request<{ models: ErSummary[] }>('/erd-models'),
  open: (id: string) => request<ErDocument>(`/erd-models/${encodeURIComponent(id)}`),
  create: (name: string, model: ErModel) => request<ErDocument>('/erd-models', 'POST', { name, model }),
  save: (id: string, name: string, expectedRevision: number, model: ErModel) => request<ErDocument>(`/erd-models/${encodeURIComponent(id)}`, 'PUT', { name, expectedRevision, model }),
  delete: (id: string, expectedRevision: number) => request<void>(`/erd-models/${encodeURIComponent(id)}`, 'DELETE', { expectedRevision }),
  sql: (model: ErModel) => request<ErExport>('/erd-export', 'POST', { model }),
};
