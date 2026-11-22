import { randomUUID } from 'node:crypto';
import { closeSync, fchmodSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { openExistingDatabase, sqliteModelNotReady, sqliteSidecarSuffixes } from './model-sqlite.ts';

export function bootstrapSqlite(path: string, initialize: (db: DatabaseSync) => void) {
  const entry = (file: string) => lstatSync(file, { throwIfNoEntry: false });
  function needsBootstrap() {
    if (entry(path)) return false; // Includes symlinks and zero-byte files.
    if (sqliteSidecarSuffixes.some(suffix => entry(path + suffix))) {
      if (entry(path)) return false; // Another starter may have just published.
      throw sqliteModelNotReady(); // Never attach orphaned state to a new database.
    }
    return true;
  }
  if (!needsBootstrap()) return;

  const directory = dirname(path);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = join(directory, `.backlog-bootstrap-${randomUUID()}.tmp`);
  const fd = openSync(temporary, 'wx', 0o600);
  try {
    try {
      // Apply the exact mode even under a more restrictive umask.
      if (process.platform !== 'win32') fchmodSync(fd, 0o600);
    } finally { closeSync(fd); }
    {
      using db = openExistingDatabase(temporary, 'read-write');
      db.exec('PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON;');
      initialize(db);
      // All schema writes are in the main file. Set WAL mode only after they
      // commit so concurrent starters never need to switch its journal mode.
      db.exec('PRAGMA journal_mode = WAL;');
    }
    if (sqliteSidecarSuffixes.some(suffix => entry(temporary + suffix))) {
      throw new Error('SQLite bootstrap did not produce a standalone database.');
    }
    const staged = openSync(temporary, 'r+');
    try { fsyncSync(staged); }
    finally { closeSync(staged); }
    if (!needsBootstrap()) return;
    try { linkSync(temporary, path); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      // The caller validates and opens the winner; never replace it.
    }
  } finally {
    for (const suffix of ['', ...sqliteSidecarSuffixes]) rmSync(temporary + suffix, { force: true });
  }
}
