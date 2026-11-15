import type { ErForeignKey, ErModel } from '../../erd-types.ts';
// @ts-expect-error Explicit extension supports native Node TS tests.
import { type TableDraft, validateModel } from './model.ts';

export type Drafts = Record<string, { tableId: string; draft: TableDraft }>;
export const persistenceDraftMessage = 'Apply or cancel edits before saving or exporting.';
export function persistenceState(dirty: boolean, count: number, relationship: boolean, panel: boolean) {
  const blocked = count > 0 || relationship;
  return { blocked, dirty: dirty || blocked || panel };
}
export function draftKey(tableId: string, columnId?: string) { return JSON.stringify(columnId === undefined ? ['table', tableId] : ['column', tableId, columnId]); }
export function removeColumnDraft(drafts: Drafts, tableId: string, columnId: string): Drafts { return Object.fromEntries(Object.entries(drafts).filter(([key]) => key !== draftKey(tableId, columnId))); }
export function findByData<T extends { dataset: Record<string, string | undefined> }>(elements: Iterable<T>, field: string, value: string): T | undefined { return [...elements].find(element => element.dataset[field] === value); }
export function applyRelationshipDraft(model: ErModel, draft: ErForeignKey, existing: boolean) {
  if (existing && !model.foreignKeys.some(item => item.id === draft.id)) return { model, errors: ['This relationship no longer exists. Close this editor and add a new relationship.'] };
  const next = { ...model, foreignKeys: existing ? model.foreignKeys.map(item => item.id === draft.id ? draft : item) : [...model.foreignKeys, draft] };
  const errors = validateModel(next);
  return { model: errors.length ? model : next, errors };
}
