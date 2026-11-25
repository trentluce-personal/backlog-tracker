import { createServer, type IncomingMessage } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openStore, type BackendSchemaResponse } from './store.ts';
import { openConfiguredBacklogStore } from './neo4j-store.ts';
import type { BacklogStore } from './backlog-store.ts';
import { body, json } from './http.ts';
import { openModelStore, openNamedModelStore } from './model-store.ts';
import { MODEL_BODY_LIMIT } from './model-schema.ts';
import { candidate, compose } from './model-validation.ts';
import { exportModel } from './model-export.ts';
import { ERD_BODY_LIMIT } from './erd-schema.ts';
import { openErStore } from './erd-store.ts';
import { exportErModel } from './erd-export.ts';
import { HttpError, id, projectInput, tagInput, type TagInput, taskInput } from './validation.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json',
};

function protect(request: IncomingMessage) {
  const host = request.headers.host;
  if (!host || !/^(127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/i.test(host)) {
    throw new HttpError(403, 'Only localhost requests are allowed.');
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method || '')) {
    if (request.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'Cross-origin mutations are not allowed.');
    if (request.headers.origin && request.headers.origin !== `http://${host}`) {
      throw new HttpError(403, 'Cross-origin mutations are not allowed.');
    }
  }
}

export function createApp(options: { dbPath: string; modelPath?: string; webRoot?: string; namedModelStorage?: 'file' | 'sqlite'; backlogStore?: BacklogStore }) {
  const sqliteModels = options.namedModelStorage === 'sqlite';
  const store = openStore(options.dbPath, sqliteModels);
  const backlog: BacklogStore = options.backlogStore ?? store;
  const modelPath = options.modelPath ?? resolve(root, 'data/models/model.json');
  const namedModelStore = openNamedModelStore(modelPath, { documents: store.modelDocuments?.graphs });
  const modelStore = openModelStore(modelPath, namedModelStore);
  const erStore = openErStore(modelPath, { documents: store.modelDocuments?.erds });
  const ideUrl = process.env.IDE_URL ?? 'http://127.0.0.1:8080';
  const ideInternalUrl = process.env.IDE_INTERNAL_URL ?? ideUrl;
  const webRoot = resolve(options.webRoot ?? resolve(root, 'apps/web/dist'));
  const server = createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    try {
      protect(request);
      const url = new URL(request.url || '/', 'http://localhost');
      const method = request.method;
      if (url.pathname === '/api/ide' && method === 'GET') {
        json(response, 200, {
          url: ideUrl,
          name: process.env.IDE_WORKSPACE_NAME ?? 'Forge IDE',
          volume: process.env.IDE_VOLUME ?? 'forge-ide_workspace-data',
          containerPath: '/workspace',
        });
        return;
      }
      if (url.pathname === '/api/ide/workspace' && method === 'POST') {
        const input = await body(request) as { name?: unknown; volume?: unknown; containerPath?: unknown };
        if (typeof input.name !== 'string' || !input.name.trim() || typeof input.volume !== 'string' || !input.volume.trim()
          || typeof input.containerPath !== 'string' || !input.containerPath.startsWith('/')) {
          throw new HttpError(400, 'Invalid IDE workspace.');
        }
        if (!backlog.registerWorkspace) throw new HttpError(503, 'The Neo4j backlog store is required to register the IDE workspace.');
        await backlog.registerWorkspace({ name: input.name.trim(), volume: input.volume.trim(), containerPath: input.containerPath });
        json(response, 204);
        return;
      }
      if (url.pathname === '/api/ide/status' && method === 'GET') {
        try {
          const result = await fetch(`${ideInternalUrl.replace(/\/+$/, '')}/healthz`, { signal: AbortSignal.timeout(3000) });
          if (!result.ok) throw new Error(`IDE health check failed (${result.status}).`);
          json(response, 200, { available: true, url: ideUrl });
        } catch (error) {
          json(response, 503, { available: false, url: ideUrl, error: (error as Error).message });
        }
        return;
      }
      if (url.pathname === '/api/backend-schema' && method === 'GET') {
        const metadata: BackendSchemaResponse = {
          sqlite: store.backendSchema(),
          jsonStorage: [
            {
              name: sqliteModels ? 'Graph model (named and singleton documents in SQLite)' : 'Graph model', schemaVersion: 3,
              fields: ['schemaVersion', 'revision', 'name (named models only)', 'nodes', 'relationshipTypes', 'relationships', 'constraints', 'indexes'],
              collections: [
                { name: 'nodes', fields: ['definitions / references', 'placement', 'properties / target'] },
                { name: 'relationshipTypes', fields: ['definitions / references', 'properties / target'] },
                { name: 'relationships', fields: ['type', 'endpoints', 'cardinalities'] },
                { name: 'constraints', fields: ['kind', 'target', 'properties'] },
                { name: 'indexes', fields: ['kind', 'targets', 'properties', 'filterProperties', 'config'] },
              ],
            },
            {
              name: sqliteModels ? 'PostgreSQL ERD (SQLite documents)' : 'PostgreSQL ERD', schemaVersion: 1,
              fields: ['kind: sql', 'schemaVersion', 'dialect: postgresql', 'revision', 'name', 'tables', 'foreignKeys'],
              collections: [
                { name: 'tables', fields: ['id', 'name', 'x', 'y', 'columns'] },
                { name: 'columns', fields: ['id', 'name', 'dataType', 'nullable', 'primaryKey', 'unique'] },
                { name: 'foreignKeys', fields: ['id', 'name', 'sourceTableId', 'sourceColumnId', 'targetTableId', 'targetColumnId'] },
              ],
            },
          ],
        };
        return json(response, 200, metadata);
      }
      if (url.pathname === '/api/erd-export' && method === 'POST') {
        return json(response, 200, exportErModel(await body(request, ERD_BODY_LIMIT)));
      }
      if (url.pathname === '/api/erd-models') {
        if (method === 'GET') return json(response, 200, { models: await erStore.list() });
        if (method === 'POST') return json(response, 201, await erStore.create(await body(request, ERD_BODY_LIMIT)));
      }
      const erMatch = /^\/api\/erd-models\/([^/]+)$/.exec(url.pathname);
      if (erMatch) {
        const erId = erMatch[1]!;
        if (method === 'GET') return json(response, 200, await erStore.read(erId));
        if (method === 'PUT') return json(response, 200, await erStore.save(erId, await body(request, ERD_BODY_LIMIT)));
        if (method === 'DELETE') {
          await erStore.delete(erId, await body(request));
          return json(response, 204);
        }
      }
      if (url.pathname === '/api/model-catalog' && method === 'GET') {
        return json(response, 200, { models: await namedModelStore.definitions(true) });
      }
      if ((url.pathname === '/api/model-validation' || url.pathname === '/api/model-export') && method === 'POST') {
        const exporting = url.pathname === '/api/model-export';
        const input = candidate(await body(request, MODEL_BODY_LIMIT), exporting);
        const composition = await compose(input, namedModelStore);
        if (!exporting) return json(response, 200, composition.validation);
        const result = exportModel(composition, input.modelId, input.format!, input.acknowledgeGraphTypeReplacement);
        return json(response, result.status, result.body);
      }
      if (url.pathname === '/api/model-node-definitions' && method === 'GET') {
        return json(response, 200, { models: await namedModelStore.definitions() });
      }
      if (url.pathname === '/api/model') {
        if (method === 'GET') return json(response, 200, { model: await modelStore.read() });
        if (method === 'PUT') return json(response, 200, { model: await modelStore.save(await body(request, MODEL_BODY_LIMIT)) });
      }
      if (url.pathname === '/api/models') {
        if (method === 'GET') return json(response, 200, { models: await namedModelStore.list() });
        if (method === 'POST') return json(response, 201, await namedModelStore.create(await body(request, MODEL_BODY_LIMIT)));
      }
      const modelMatch = /^\/api\/models\/([^/]+)$/.exec(url.pathname);
      if (modelMatch) {
        const modelId = modelMatch[1]!;
        if (method === 'GET') return json(response, 200, await namedModelStore.read(modelId));
        if (method === 'DELETE') {
          await namedModelStore.delete(modelId, await body(request));
          return json(response, 204);
        }
        if (method === 'PUT' && modelId !== 'legacy') {
          return json(response, 200, await namedModelStore.save(modelId, await body(request, MODEL_BODY_LIMIT)));
        }
      }
      if (url.pathname === '/api/tags') {
        if (method === 'GET') return json(response, 200, { tags: await backlog.tags() });
        if (method === 'POST') return json(response, 201, { tag: await backlog.createTag(tagInput(await body(request)) as TagInput) });
      }
      const tagMatch = /^\/api\/tags\/([^/]+)$/.exec(url.pathname);
      if (tagMatch) {
        const tagId = id(tagMatch[1]);
        if (method === 'PATCH') return json(response, 200, { tag: await backlog.updateTag(tagId, tagInput(await body(request), true)) });
        if (method === 'DELETE') {
          await backlog.deleteTag(tagId);
          return json(response, 204);
        }
      }
      if (url.pathname === '/api/projects') {
        if (method === 'GET') return json(response, 200, { projects: await backlog.projects() });
        if (method === 'POST') return json(response, 201, { project: await backlog.createProject(projectInput(await body(request))) });
      }
      if (url.pathname === '/api/tasks') {
        if (method === 'GET') return json(response, 200, { tasks: await backlog.tasks() });
        if (method === 'POST') return json(response, 201, { task: await backlog.createTask(taskInput(await body(request))) });
      }
      const match = /^\/api\/(projects|tasks)\/([^/]+)$/.exec(url.pathname);
      if (match) {
        const resourceId = id(match[2]);
        if (method === 'PATCH') {
          if (match[1] === 'projects') return json(response, 200, { project: await backlog.updateProject(resourceId, projectInput(await body(request))) });
          return json(response, 200, { task: await backlog.updateTask(resourceId, taskInput(await body(request), true)) });
        }
        if (method === 'DELETE') {
          if (match[1] === 'projects') await backlog.deleteProject(resourceId);
          else await backlog.deleteTask(resourceId);
          return json(response, 204);
        }
      }
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) throw new HttpError(404, 'API route not found.');
      if (method !== 'GET' && method !== 'HEAD') throw new HttpError(404, 'Route not found.');
      let pathname: string;
      try { pathname = decodeURIComponent(url.pathname); }
      catch { throw new HttpError(400, 'Invalid URL.'); }
      const file = resolve(webRoot, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!file.startsWith(webRoot + sep)) throw new HttpError(404, 'File not found.');
      try {
        const content = await readFile(file);
        response.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
        response.end(method === 'HEAD' ? undefined : content);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT' || code === 'EISDIR') throw new HttpError(404, 'Frontend file not found. Run npm run build, or use npm run dev.');
        throw error;
      }
    } catch (error) {
      if (error instanceof HttpError) return json(response, error.status, { error: error.message });
      console.error('Request failed:', error);
      json(response, 500, { error: 'An unexpected server error occurred.' });
    }
  });
  server.on('close', () => {
    store.close();
    if (backlog !== store) void backlog.close();
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { process.loadEnvFile(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const port = Number(process.env.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
  const host = process.env.BACKLOG_HOST ?? '127.0.0.1';
  if (!['127.0.0.1', '0.0.0.0'].includes(host)) throw new Error('BACKLOG_HOST must be 127.0.0.1 or 0.0.0.0.');
  const namedModelStorage = process.env.BACKLOG_NAMED_MODEL_STORAGE ?? 'file';
  if (namedModelStorage !== 'file' && namedModelStorage !== 'sqlite') throw new Error('BACKLOG_NAMED_MODEL_STORAGE must be file or sqlite.');
  const backlogStore = await openConfiguredBacklogStore();
  let server: ReturnType<typeof createApp>;
  try {
    server = createApp({
      dbPath: process.env.BACKLOG_DB_PATH ? resolve(process.env.BACKLOG_DB_PATH) : resolve(root, 'data/backlog.sqlite'),
      modelPath: process.env.BACKLOG_MODEL_PATH ? resolve(process.env.BACKLOG_MODEL_PATH) : resolve(root, 'data/models/model.json'),
      namedModelStorage,
      backlogStore,
    });
  } catch (error) {
    if (backlogStore) await backlogStore.close();
    throw error;
  }
  server.on('error', (error) => { console.error(error.message); server.close(); process.exitCode = 1; });
  server.listen(port, host, () => {
    console.log(`The Forge listening at http://${host}:${port}`);
    if (process.send) process.send({ type: 'backlog:listening' });
  });
  const stop = () => { server.close(); server.closeAllConnections(); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
