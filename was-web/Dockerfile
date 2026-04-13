# =============================================================================
# Wall & Shadow — Production Dockerfile
# =============================================================================
# Multi-stage build producing a self-contained image with:
#   - Compiled Hono API server (TypeScript → JS via tsup)
#   - Built React SPA (Vite)
#   - Database migration runner (drizzle-orm)
#
# Build context: was-web/ (set via Kamal builder.context)
#
# Required build args:
#   VITE_DEPLOY_ENV       — "production" or "test" (controls SPA title prefix, robots.txt, noindex)
#   VITE_BACKEND          — "hono" for self-hosted deployments (falls back to Firebase if unset)
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
FROM node:22-slim AS deps

WORKDIR /app

# Copy package manifests for all workspaces
COPY package.json yarn.lock ./
COPY packages/shared/package.json packages/shared/
COPY server/package.json server/

# Stub out the functions workspace (declared in root package.json but not needed)
RUN mkdir -p functions && echo '{"name":"functions","private":true}' > functions/package.json

RUN yarn install --frozen-lockfile

# ── Stage 2: Build the React SPA ─────────────────────────────────────────────
FROM deps AS build-spa

ARG VITE_DEPLOY_ENV=production
ARG VITE_BACKEND=hono
ARG VITE_OIDC_ISSUER
ARG VITE_OIDC_CLIENT_ID
ARG GIT_COMMIT=unknown

ENV VITE_DEPLOY_ENV=${VITE_DEPLOY_ENV}
ENV VITE_BACKEND=${VITE_BACKEND}
ENV VITE_OIDC_ISSUER=${VITE_OIDC_ISSUER}
ENV VITE_OIDC_CLIENT_ID=${VITE_OIDC_CLIENT_ID}
ENV GIT_COMMIT=${GIT_COMMIT}

# Copy SPA source
COPY app.html landing-index.html tsconfig.json vite.config.ts ./
COPY src/ src/
COPY public/ public/
COPY packages/shared/src/ packages/shared/src/

RUN yarn build

# ── Stage 3: Build the server (TypeScript → JS via tsup) ─────────────────────
FROM deps AS build-server

COPY server/src/ server/src/
COPY server/tsconfig.json server/tsup.config.ts server/
COPY packages/shared/src/ packages/shared/src/

RUN cd server && yarn build

# ── Stage 4: Production image ─────────────────────────────────────────────────
FROM node:22-slim AS production

WORKDIR /app

# Copy package manifests and install production dependencies only
COPY package.json yarn.lock ./
COPY packages/shared/package.json packages/shared/
COPY server/package.json server/
RUN mkdir -p functions && echo '{"name":"functions","private":true}' > functions/package.json
RUN yarn install --frozen-lockfile --production && yarn cache clean

# Copy compiled server
COPY --from=build-server /app/server/dist/ server/dist/

# Copy database migration files (SQL + journal, read by drizzle-orm migrator)
COPY server/drizzle/ server/drizzle/

# Copy entrypoint
COPY server/docker-entrypoint.sh server/

# Copy built SPA
COPY --from=build-spa /app/build/ build/

ENV NODE_ENV=production
ENV STATIC_DIR=/app/build

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s \
  CMD node -e "fetch('http://localhost:' + (process.env.PORT || 3000) + '/api/health').then(r => { if (!r.ok) process.exit(1) })" || exit 1

WORKDIR /app/server
ENTRYPOINT ["./docker-entrypoint.sh"]
