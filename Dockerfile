# syntax=docker/dockerfile:1
FROM node:24.21.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci --no-audit --no-fund
COPY apps/api/src ./apps/api/src
COPY apps/api/tsconfig.json ./apps/api/tsconfig.json
COPY apps/web ./apps/web
RUN npm run build

FROM node:24.21.0-bookworm-slim AS runtime
ENV NODE_ENV=production \
    BACKLOG_HOST=0.0.0.0 \
    PORT=3001 \
    BACKLOG_DB_PATH=/app/data/backlog.sqlite
WORKDIR /app
# An empty named volume inherits this directory's non-root ownership.
RUN mkdir -p /app/data && chown node:node /app/data
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist
USER node
EXPOSE 3001
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["node", "--input-type=module", "-e", "const r = await fetch('http://127.0.0.1:3001/api/projects', {signal: AbortSignal.timeout(4000)}); if (!r.ok) process.exit(1); const body = await r.json(); if (!Array.isArray(body.projects)) process.exit(1);"]
CMD ["node", "apps/api/dist/server.js"]
