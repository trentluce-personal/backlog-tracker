import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openStore } from './store.ts';
import { HttpError, id, projectInput, taskInput } from './validation.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json',
};

function json(response: ServerResponse, status: number, body?: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(body === undefined ? undefined : JSON.stringify(body));
}

async function body(request: IncomingMessage): Promise<unknown> {
  if (request.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
    throw new HttpError(400, 'Content-Type must be application/json.');
  }
  let length = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 32768) throw new HttpError(400, 'Request body is too large.');
    chunks.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new HttpError(400, 'Request body must contain valid JSON.'); }
}

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

export function createApp(options: { dbPath: string; webRoot?: string }) {
  const store = openStore(options.dbPath);
  const webRoot = resolve(options.webRoot ?? resolve(root, 'apps/web/dist'));
  const server = createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    try {
      protect(request);
      const url = new URL(request.url || '/', 'http://localhost');
      const method = request.method;
      if (url.pathname === '/api/projects') {
        if (method === 'GET') return json(response, 200, { projects: store.projects() });
        if (method === 'POST') return json(response, 201, { project: store.createProject(projectInput(await body(request))) });
      }
      if (url.pathname === '/api/tasks') {
        if (method === 'GET') return json(response, 200, { tasks: store.tasks() });
        if (method === 'POST') return json(response, 201, { task: store.createTask(taskInput(await body(request))) });
      }
      const match = /^\/api\/(projects|tasks)\/([^/]+)$/.exec(url.pathname);
      if (match) {
        const resourceId = id(match[2]);
        if (method === 'PATCH') {
          if (match[1] === 'projects') return json(response, 200, { project: store.updateProject(resourceId, projectInput(await body(request))) });
          return json(response, 200, { task: store.updateTask(resourceId, taskInput(await body(request), true)) });
        }
        if (method === 'DELETE') {
          if (match[1] === 'projects') store.deleteProject(resourceId);
          else store.deleteTask(resourceId);
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
  server.on('close', () => store.close());
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
  const host = process.env.BACKLOG_HOST ?? '127.0.0.1';
  if (!['127.0.0.1', '0.0.0.0'].includes(host)) throw new Error('BACKLOG_HOST must be 127.0.0.1 or 0.0.0.0.');
  const server = createApp({ dbPath: process.env.BACKLOG_DB_PATH ? resolve(process.env.BACKLOG_DB_PATH) : resolve(root, 'data/backlog.sqlite') });
  server.on('error', (error) => { console.error(error.message); server.close(); process.exitCode = 1; });
  server.listen(port, host, () => {
    console.log(`Backlog Tracker listening at http://${host}:${port}`);
    if (process.send) process.send({ type: 'backlog:listening' });
  });
  const stop = () => { server.close(); server.closeIdleConnections(); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
