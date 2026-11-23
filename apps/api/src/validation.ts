export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type Priority = 'low' | 'medium' | 'high';
export type Status = 'backlog' | 'in_progress' | 'done';
export const tagColors = ['slate', 'blue', 'teal', 'gold', 'purple', 'red'] as const;
export type TagColor = (typeof tagColors)[number];
export interface TagInput {
  name: string;
  color: TagColor;
}
export interface TaskInput {
  projectId: string;
  title: string;
  description: string;
  priority: Priority;
  dueDate: string | null;
  dueTime: string | null;
  status: Status;
  tagIds: string[];
}

export function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new HttpError(400, 'Invalid ID.');
  }
  return value.toLowerCase();
}

function text(value: unknown, field: string, max: number, allowBlank = false): string {
  if (typeof value !== 'string' || value.length > max || (!allowBlank && !value.trim())) {
    throw new HttpError(400, `${field} must be ${allowBlank ? 'a string' : 'nonblank text'} of at most ${max} characters.`);
  }
  return allowBlank ? value : value.trim();
}

export function object(value: unknown, fields: string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'Request body must be a JSON object.');
  }
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !fields.includes(key))) throw new HttpError(400, 'Unknown field.');
  return body;
}

export function projectInput(value: unknown): string {
  return text(object(value, ['name']).name, 'Name', 100);
}

export function tagInput(value: unknown, partial = false): Partial<TagInput> {
  const body = object(value, ['name', 'color']);
  if (partial && Object.keys(body).length === 0) throw new HttpError(400, 'Provide at least one tag field.');
  const result: Partial<TagInput> = {};
  if (!partial || 'name' in body) result.name = text(body.name, 'Name', 50);
  if (!partial || 'color' in body) result.color = choice(body.color, tagColors, 'color');
  return result;
}

function dueDate(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) {
    throw new HttpError(400, 'Due date must be a valid YYYY-MM-DD date or null.');
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new HttpError(400, 'Due date must be a valid calendar date.');
  }
  return value;
}

function choice<const T extends string>(value: unknown, values: readonly T[], field: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) throw new HttpError(400, `Invalid ${field}.`);
  return value as T;
}

function dueTime(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length !== 5 || !/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(value)) {
    throw new HttpError(400, 'Due time must be a valid HH:mm time or null.');
  }
  return value;
}

function tagIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 50) throw new HttpError(400, 'Tags must be a list of at most 50 tag IDs.');
  return [...new Set(value.map(id))];
}

export function taskInput(value: unknown, partial = false): Partial<TaskInput> {
  const body = object(value, ['projectId', 'title', 'description', 'priority', 'dueDate', 'dueTime', 'status', 'tagIds']);
  if (partial && Object.keys(body).length === 0) throw new HttpError(400, 'Provide at least one task field.');
  const result: Partial<TaskInput> = {};
  if (!partial || 'projectId' in body) result.projectId = id(body.projectId);
  if (!partial || 'title' in body) result.title = text(body.title, 'Title', 200);
  if ('description' in body) result.description = text(body.description, 'Description', 5000, true);
  if ('priority' in body) result.priority = choice(body.priority, ['low', 'medium', 'high'], 'priority');
  if ('status' in body) result.status = choice(body.status, ['backlog', 'in_progress', 'done'], 'status');
  if ('dueDate' in body) result.dueDate = dueDate(body.dueDate);
  if ('dueTime' in body) result.dueTime = dueTime(body.dueTime);
  if ('tagIds' in body) result.tagIds = tagIds(body.tagIds);
  return result;
}
