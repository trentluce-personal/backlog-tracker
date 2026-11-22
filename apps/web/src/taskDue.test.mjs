import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dueLabel, isOverdue, localDueClock } from './taskDue.ts';

test('timed tasks become overdue at the local minute boundary, except done tasks', () => {
  const task = { dueDate: '2026-07-25', dueTime: '09:15', status: 'backlog' };
  const before = localDueClock(new Date(2026, 6, 25, 9, 14, 59, 999));
  const at = localDueClock(new Date(2026, 6, 25, 9, 15));
  assert.equal(isOverdue(task, before), false);
  assert.equal(isOverdue(task, at), true);
  assert.equal(isOverdue({ ...task, status: 'done' }, at), false);
  assert.equal(isOverdue({ ...task, dueDate: '2026-07-26', dueTime: '00:00' }, at), false);
});

test('date-only tasks remain current until local midnight, and undated tasks never expire', () => {
  const task = { dueDate: '2026-07-25', dueTime: null, status: 'in_progress' };
  const before = localDueClock(new Date(2026, 6, 25, 23, 59, 59));
  const at = localDueClock(new Date(2026, 6, 26));
  assert.equal(isOverdue(task, before), false);
  assert.equal(isOverdue(task, at), true);
  assert.equal(isOverdue({ ...task, dueDate: null }, at), false);
});

test('a repeated local hour can temporarily make a timed task current again', () => {
  const task = { dueDate: '2026-11-01', dueTime: '01:30', status: 'backlog' };
  const times = ['01:30', '01:59', '01:00', '01:29', '01:30'];
  assert.deepEqual(times.map(time => isOverdue(task, { date: task.dueDate, time })), [true, true, false, false, true]);
});

test('compact and full labels preserve wall date/time even for a skipped DST hour', () => {
  const date = '2026-03-08';
  const options = { month: 'short', day: 'numeric' };
  const day = new Date(2026, 2, 8, 12);
  const clock = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(2026, 1, 1, 2, 30));
  assert.equal(dueLabel(date, '02:30', true), `${new Intl.DateTimeFormat(undefined, options).format(day)} · ${clock}`);
  assert.equal(dueLabel(date, '02:30'), `${dueLabel(date, null)} · ${clock}`);
  assert.equal(dueLabel(date, null), new Intl.DateTimeFormat(undefined, { ...options, year: 'numeric' }).format(day));
});
