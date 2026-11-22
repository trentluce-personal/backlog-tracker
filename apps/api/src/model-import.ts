import { lstat, readdir } from 'node:fs/promises';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { decodeErDocument, erdFile } from './erd-store.ts';
import { decodeGraph, graphFile, readPhysicalFile } from './model-store.ts';
import { checkImportDestination, checkModelDatabaseFiles, ImportDestinationError, importModelDocuments, openExistingDatabase, type ModelBatch } from './model-sqlite.ts';

const usage = 'Usage: node apps/api/dist/model-import.js --dry-run|--apply --db <absolute SQLite path> --model <absolute singleton JSON path>';
class ImportError extends Error {}

async function scanModelFiles(modelPath: string, includeNamed: boolean) {
  const directory = dirname(modelPath), singleton = basename(modelPath);
  if (!(await lstat(directory)).isDirectory()) throw new Error();
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const batch: ModelBatch = { named: [], erds: [] };
  const failedIds: Record<'named' | 'legacy' | 'erds', string[]> = { named: [], legacy: [], erds: [] };
  const exactSingleton = entries.some(entry => entry.name === singleton);
  // On a case-insensitive filesystem, reject a mis-cased singleton path
  // rather than silently importing it under a different identity.
  const configured = exactSingleton ? undefined : await lstat(modelPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (configured) throw new ImportError('Use the exact filename of the configured singleton in --model.');
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    const legacy = entry.name === singleton;
    const kind = legacy ? 'legacy' : !entry.isFile() ? undefined : erdFile(entry.name) ? 'erds' :
      includeNamed && graphFile(entry.name) ? 'named' : undefined;
    if (!kind) continue;
    const id = kind === 'legacy' ? 'legacy' : entry.name.slice(kind === 'erds' ? 4 : 0, -5);
    try {
      const { content: document } = await readPhysicalFile(path, true);
      if (kind === 'erds') decodeErDocument(id, document);
      else decodeGraph(id, document);
      const row = { id, document };
      if (kind === 'legacy') batch.legacy = row;
      else batch[kind].push(row);
    } catch { failedIds[kind].push(id); }
  }
  return { batch, failedIds };
}

function checkFiles(path: string) {
  let problem;
  try { problem = checkModelDatabaseFiles(path, true); }
  catch { problem = 'Unable to inspect SQLite file permissions.'; }
  if (problem) throw new ImportError(problem);
}

async function main() {
  let options;
  try {
    options = parseArgs({ options: { 'dry-run': { type: 'boolean' }, apply: { type: 'boolean' }, db: { type: 'string' }, model: { type: 'string' } } }).values;
  } catch { throw new ImportError(usage); }
  const { apply } = options;
  if (Boolean(apply) === Boolean(options['dry-run']) || !options.db || !options.model || !isAbsolute(options.db) || !isAbsolute(options.model)) {
    throw new ImportError(usage);
  }
  const db = resolve(options.db), model = resolve(options.model);
  checkFiles(db);

  let source;
  const preview = openExistingDatabase(db, 'read-only');
  try { source = checkImportDestination(preview); }
  catch (error) {
    if (error instanceof ImportDestinationError) throw new ImportError(error.message);
    throw error;
  } finally { preview.close(); }

  let scan;
  try { scan = await scanModelFiles(model, source === 'files'); }
  catch (error) {
    if (error instanceof ImportError) throw error;
    throw new ImportError('Unable to inspect the source model directory. Use an existing directory, even for an empty import.');
  }
  const { batch, failedIds } = scan;
  const report = { mode: apply ? 'apply' : 'dry-run', source, imported: false,
    eligibleIds: { named: batch.named.map(row => row.id), legacy: batch.legacy ? ['legacy'] : [], erds: batch.erds.map(row => row.id) }, failedIds };
  try {
    if (Object.values(failedIds).some(ids => ids.length)) {
      throw new ImportError('Import refused: one or more eligible files are unreadable, invalid or unsupported.');
    }
    if (apply) {
      checkFiles(db);
      const connection = openExistingDatabase(db, 'read-write');
      try { importModelDocuments(connection, source, batch); }
      catch (error) {
        if (error instanceof ImportDestinationError) throw new ImportError(error.message);
        throw new ImportError('Import transaction failed. Check database availability, permissions and whether the destination changed.');
      }
      finally { connection.close(); }
      report.imported = true;
    }
  } finally {
    console.log(JSON.stringify(report));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(error instanceof ImportError ? error.message : 'Unable to inspect the backlog database or complete the import.');
    process.exitCode = 1;
  });
}
