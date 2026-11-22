import { copyFileSync, lstatSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openExistingDatabase } from './model-sqlite.ts';

function inspect(path: string) {
  const entry = lstatSync(path, { bigint: true, throwIfNoEntry: false });
  if (entry && !entry.isFile()) throw new Error('unable to open database file: expected a regular file');
  return entry;
}

// The WAL index (-shm) is disposable, and even a read-only SQLite connection
// can write it. Inspect the original main file only when there is no WAL to
// replay; otherwise let SQLite rebuild the index alongside a private copy.
export function checkSqliteStartup(path: string, validate: (db: DatabaseSync) => void): boolean {
  const wal = path + '-wal', journal = path + '-journal';
  const state = () => [inspect(path), inspect(wal), inspect(journal)] as const;
  const fingerprint = (files: ReturnType<typeof state>) => files.map(file =>
    file && [file.dev, file.ino, file.size, file.mtimeNs, file.ctimeNs].join(':')).join('|');

  for (let attempt = 0; attempt < 5; attempt++) {
    const before = state();
    const [main, log, rollback] = before;
    if (!main) {
      if (log || rollback || inspect(path + '-shm')) throw new Error('SQLite database is missing but has sidecars.');
      return false;
    }
    if (rollback?.size) throw new Error('SQLite startup cannot inspect a pending rollback journal. Recover the database before retrying.');
    const stable = () => fingerprint(before) === fingerprint(state());

    if (log?.size) {
      const directory = mkdtempSync(join(tmpdir(), 'backlog-sqlite-check-'));
      try {
        const copy = join(directory, 'snapshot.sqlite');
        try {
          copyFileSync(path, copy);
          copyFileSync(wal, copy + '-wal');
        } catch (error) {
          if (!stable()) continue;
          throw error;
        }
        // A checkpoint or WAL reset can race the copies. Use only an
        // unchanged pair; SQLite interprets committed frames on the copy.
        if (!stable()) continue;
        using db = new DatabaseSync(copy, { readOnly: true });
        validate(db);
        return true;
      } finally { rmSync(directory, { recursive: true, force: true }); }
    }

    try {
      using db = openExistingDatabase(path, 'read-only');
      validate(db);
    } catch (error) {
      if (!stable()) continue;
      throw error;
    }
    if (stable()) return true;
  }
  throw new Error('SQLite database changed during startup validation. Retry when writes have settled.');
}
