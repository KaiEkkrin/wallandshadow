# Self-Hosted Deployment Checklist

Checklist for deploying Wall & Shadow on the self-hosted stack (no Firebase dependency).
Assumes GitHub Actions for all deployment — no manual deploys.

---

## Code Gaps (before first deploy)

### Must-have

- [ ] **Server Dockerfile** — Multi-stage build: install deps + compile TS in builder stage,
  copy into slim Node 22 runtime. Must include ImageMagick (spritesheet generation).
- [ ] **Compiled server entrypoint** — `yarn start` currently runs `tsx src/index.ts` (JIT TS).
  Production should run compiled JS via `tsc` or bundler (`tsup`). Verify
  `@wallandshadow/shared` workspace dependency resolves correctly in the build output.
- [ ] **Caddyfile** — Reverse proxy configuration:
  - Serve built React SPA (`build/`) as static files
  - Route `/api/*` and `/ws/*` to Hono server (with WebSocket upgrade support)
  - SPA fallback routing: all non-file paths to `app.html`, root to `index.html`
  - Auto-HTTPS via Let's Encrypt
- [ ] **Database migration strategy** — Currently using `drizzle-kit push` (diff-and-apply).
  Production should use `drizzle-kit migrate` (applies generated SQL in `drizzle/`).
  Decide when migrations run: container init step, separate job, or deploy pipeline stage.
- [ ] **Kamal config** (`config/deploy.yml`) — Or equivalent deploy mechanism to orchestrate
  container swap on VPS.
- [ ] **`JWT_SECRET` enforcement** — Server falls back to hardcoded dev secret. Add a startup
  guard that refuses to start with the dev secret when `NODE_ENV=production`.
- [ ] **Auth decision for test** — Local JWT is fine for initial test deployment. OIDC (Zitadel/Hanko)
  can follow separately.

### Already done (no action needed)

- Health check endpoint (`GET /api/health`) — works as Kamal health probe
- Graceful SIGTERM handling — supports zero-downtime deploys
- Dual auth support (local JWT + OIDC) — client and server both ready
- WebSocket server with LISTEN/NOTIFY — real-time sync implemented
- Client backend switching via `VITE_BACKEND=hono` environment variable
- CI pipeline for server (`ci-server.yml`) — tests against real PostgreSQL + MinIO

---

## Hetzner VPS Setup (one-time)

- [ ] Provision Hetzner Cloud VPS (CPX21 or similar: 3 vCPU, 4GB RAM, ~EUR 7-8/month)
- [ ] Install Docker on the VPS (required by Kamal / compose)
- [ ] Set up SSH key access from GitHub Actions to VPS
- [ ] Install and configure PostgreSQL 17 (on VPS or as container)
- [ ] Create `wallandshadow` database and `was` user
- [ ] Run initial schema migration (`drizzle-kit migrate`)
- [ ] Set up Hetzner Object Storage bucket (or MinIO container on VPS)
- [ ] Configure DNS: domain -> VPS IP
- [ ] Decide auth strategy for test: local JWT only, or stand up Zitadel

---

## GitHub Secrets

| Secret | Purpose | Required for test? |
|---|---|---|
| `SSH_PRIVATE_KEY` | Kamal / SSH deploy to VPS | Yes |
| `VPS_HOST` | IP or hostname of Hetzner VPS | Yes |
| `DATABASE_URL` | Production PostgreSQL connection string | Yes |
| `JWT_SECRET` | Random secret for local JWT signing | Yes |
| `S3_ENDPOINT` | Object storage endpoint URL | Yes |
| `S3_ACCESS_KEY` | Object storage access key | Yes |
| `S3_SECRET_KEY` | Object storage secret key | Yes |
| `S3_BUCKET` | Object storage bucket name | Yes |
| `GHCR_TOKEN` | Push container images (or use `GITHUB_TOKEN`) | Yes |
| `OIDC_ISSUER` | OIDC provider URL | No (skip for test) |
| `VITE_DEPLOY_ENV` | `test` or `production` | Yes |

---

## Files to Create

- [ ] `was-web/server/Dockerfile` — multi-stage Node 22 + ImageMagick
- [ ] `Caddyfile` — reverse proxy + static serving + auto-HTTPS
- [ ] `config/deploy.yml` — Kamal configuration (or `compose.production.yml`)
- [ ] `.github/workflows/deploy-server.yml` — build, push, migrate, deploy

---

## GitHub Actions Workflow

```
Trigger: push to main (paths: was-web/server/**, was-web/packages/shared/**, was-web/src/**)

Steps:
  1. Run existing CI (ci-server.yml tests pass)
  2. Build React SPA (yarn build with VITE_BACKEND=hono, VITE_DEPLOY_ENV=test)
  3. Build server container image (includes SPA static files for Caddy to serve)
  4. Push image to ghcr.io
  5. Run database migrations against production DB
  6. Deploy via Kamal (or: SSH + docker compose pull + up -d)
```

---

## Architecture Decision: Kamal vs Compose-over-SSH

### Option A: Kamal (recommended long-term)

- Zero-downtime blue/green container swap
- Health check before routing traffic
- Instant rollback (`kamal rollback`)
- Learning curve for Kamal conventions

### Option B: Compose-over-SSH (fastest to start)

- GitHub Actions workflow SSHs into VPS
- Runs `docker compose pull && docker compose up -d`
- Uses `compose.production.yml` on VPS: Caddy + Hono server + PostgreSQL + MinIO
- Simple, no new tooling to learn
- Can migrate to Kamal later for zero-downtime deploys

---

## Container Architecture on VPS

```
┌─────────────────────────────────────────┐
│  Caddy container                         │
│  • HTTPS (Let's Encrypt)                 │
│  • Static: React SPA + landing page      │
│  • Reverse proxy /api/* → hono:3000      │
│  • Reverse proxy /ws/*  → hono:3000      │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│  Hono server container                   │
│  • REST API + WebSocket on port 3000     │
│  • Node 22 + ImageMagick                 │
└──────┬──────────────────┬───────────────┘
       │                  │
┌──────▼──────┐   ┌──────▼───────────────┐
│ PostgreSQL  │   │ Object Storage        │
│ (container  │   │ (Hetzner OS or MinIO) │
│  or host)   │   │                       │
└─────────────┘   └──────────────────────┘
```

---

## Post-Deploy Verification

- [ ] Landing page loads at root URL
- [ ] SPA loads at `/app`
- [ ] Register / login works (local JWT)
- [ ] Create adventure, create map
- [ ] Upload image
- [ ] Open map — tokens, walls, features render
- [ ] Real-time sync: open map in two browsers, verify changes propagate
- [ ] WebSocket reconnection after network interruption
- [ ] HTTPS certificate issued correctly
- [ ] Health check endpoint responds: `GET /api/health`
