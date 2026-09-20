# =============================================================================
# Wall & Shadow — Production Dockerfile
# =============================================================================
# Multi-stage build producing a self-contained image with:
#   - Compiled Hono API server (TypeScript → JS via tsup)
#   - Built React SPA (Vite)
#   - Database migration runner (drizzle-orm)
#
# Build context: was-web/
#
# Required build args:
#   VITE_DEPLOY_ENV       — "production" or "test" (controls SPA title prefix, robots.txt, noindex)
#   VITE_OIDC_ISSUER      — Zitadel OIDC issuer URL (baked into SPA bundle)
#   VITE_OIDC_CLIENT_ID   — Zitadel OIDC client ID (baked into SPA bundle)
#   GIT_COMMIT            — git commit hash (injected into SPA version string)
#
# Required runtime env vars:
#   DATABASE_URL     — PostgreSQL connection string
#   JWT_SECRET       — JWT signing key
#   AUTH_MODE        — "oidc" (enforced in production by validateEnv.ts)
#   OIDC_ISSUER      — Zitadel OIDC issuer URL
#   S3_ENDPOINT      — Hetzner Object Storage endpoint
#   S3_ACCESS_KEY    — S3 access key
#   S3_SECRET_KEY    — S3 secret key
#   S3_BUCKET        — S3 bucket name
#   PORT             — Server port (3001 for prod, 3002 for test)
#
# Health check: GET /api/health → { ok: true }
# =============================================================================

# ── Stage 1: Install all dependencies ─────────────────────────────────────────
FROM node:24-slim AS deps

WORKDIR /app

# Copy package manifests for all workspaces
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY server/package.json server/

RUN npm ci

# ── Stage 2: Build the React SPA ─────────────────────────────────────────────
FROM deps AS build-spa

ARG VITE_DEPLOY_ENV=production
ARG VITE_OIDC_ISSUER
ARG VITE_OIDC_CLIENT_ID
ARG GIT_COMMIT=unknown

ENV VITE_DEPLOY_ENV=${VITE_DEPLOY_ENV}
ENV VITE_OIDC_ISSUER=${VITE_OIDC_ISSUER}
ENV VITE_OIDC_CLIENT_ID=${VITE_OIDC_CLIENT_ID}
ENV GIT_COMMIT=${GIT_COMMIT}

# Copy SPA source
COPY app.html landing-index.html tsconfig.json vite.config.ts ./
COPY src/ src/
COPY public/ public/
COPY vite-plugins/ vite-plugins/
COPY packages/shared/src/ packages/shared/src/

RUN npm run build

# ── Stage 3: Build the server (TypeScript → JS via tsup) ─────────────────────
FROM deps AS build-server

COPY server/src/ server/src/
COPY server/tsconfig.json server/tsup.config.ts server/
COPY packages/shared/src/ packages/shared/src/

WORKDIR /app/server

RUN npm run build

# ── Stage 4: Production image ─────────────────────────────────────────────────
FROM node:24-slim AS production

WORKDIR /app

# The server's production dependencies only; the SPA's are bundled into build/.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY server/package.json server/
RUN npm ci --omit=dev --workspace=@wallandshadow/server && npm cache clean --force

# Copy compiled server
COPY --from=build-server /app/server/dist/ server/dist/

# Copy database migration files (SQL + journal, read by drizzle-orm migrator)
COPY server/drizzle/ server/drizzle/

# Copy entrypoint
COPY server/docker-entrypoint.sh server/

# Copy built SPA
COPY --from=build-spa /app/build/ build/

# Everything under /app stays root-owned and world-readable. The container runs
# as the unprivileged node user (UID 1000) below and only ever reads /app —
# runtime writes go to os.tmpdir() (spriteExtensions.ts), never to the app dir.
# A recursive `chown -R node:node /app` here would rewrite every file into an
# extra image layer, duplicating the whole of node_modules and doubling the
# image's inode footprint on the deploy host.
# Numeric form (not `node`) so hosts that can't read the image's /etc/passwd
# can still resolve the user (hadolint DL3066).
USER 1000:1000

ENV NODE_ENV=production
ENV STATIC_DIR=/app/build

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s \
  CMD ["node", "-e", "fetch('http://localhost:' + (process.env.PORT || 3000) + '/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

WORKDIR /app/server
ENTRYPOINT ["./docker-entrypoint.sh"]
