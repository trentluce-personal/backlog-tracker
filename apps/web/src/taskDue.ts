import type { Task } from './types';

// Format the stored calendar fields without normalizing a skipped DST hour.
const dateOptions = { month: 'short', day: 'numeric', timeZone: 'UTC' } as const;
const compactDate = new Intl.DateTimeFormat(undefined, dateOptions);
const fullDate = new Intl.DateTimeFormat(undefined, { ...dateOptions, year: 'numeric' });
const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });

export function dueLabel(date: string, dueTime: string | null, compact = false) {
  const label = (compact ? compactDate : fullDate).format(new Date(`${date}T00:00Z`));
  return dueTime ? `${label} · ${time.format(new Date(`${date}T${dueTime}Z`))}` : label;
}

const twoDigits = (value: number) => String(value).padStart(2, '0');

export function localDueClock(now: Date) {
  return {
    date: `${String(now.getFullYear()).padStart(4, '0')}-${twoDigits(now.getMonth() + 1)}-${twoDigits(now.getDate())}`,
    time: `${twoDigits(now.getHours())}:${twoDigits(now.getMinutes())}`,
  };
}

export function isOverdue({ dueDate, dueTime, status }: Pick<Task, 'dueDate' | 'dueTime' | 'status'>, now: ReturnType<typeof localDueClock>) {
  return status !== 'done' && dueDate !== null && (
    dueDate < now.date || (dueDate === now.date && Boolean(dueTime && dueTime <= now.time))
  );
}
