import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href);
const port = Number(process.env.BACKLOG_WEB_PORT ?? 5173);
const apiPort = Number(process.env.PORT ?? 3001);
for (const value of [port, apiPort]) {
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error('Ports must be integers from 1 to 65535.');
}
const server = await createServer({
  server: {
    host: '127.0.0.1', port, strictPort: true,
    proxy: { '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false } },
  },
});
await server.listen();
server.printUrls();
const stop = async () => { await server.close(); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
