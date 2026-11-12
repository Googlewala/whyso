# syntax=docker/dockerfile:1

# ---- build stage: install production deps with build tooling available ----
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---- runtime stage: small, non-root, no build tooling ----
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=12000 \
    HOST=0.0.0.0 \
    WHYSO_DB=/data/whyso.db
WORKDIR /app

# tini reaps zombies and forwards signals so graceful shutdown works in Docker.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY src ./src
COPY public ./public
COPY assets ./assets
COPY scripts ./scripts

# SQLite lives on a volume; the app must own it to write WAL files.
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]

EXPOSE 12000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node scripts/healthcheck.js

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/server.js"]
