# Replatforming: Firebase → Self-Hosted Stack

This document captures the architecture decisions and migration plan for moving Wall & Shadow
off Firebase and onto a portable, containerised server stack.

**Decision date**: March 2026
**Current Firebase deployment**: Remains in maintenance mode during migration
**Planned migration window**: Several months; phases can be worked independently

---

## Decisions

| Concern | Decision | Rationale |
|---|---|---|
| Database | PostgreSQL (self-managed on VPS) | Ubiquitous, excellent JSON support for change documents, CASCADE constraints replace `recursiveDelete()` |
| HTTP API server | Node.js + Hono (TypeScript) | Reuses existing Functions logic; Hono is runtime-agnostic (portable to Bun/Deno/CF Workers) |
| Real-time transport | WebSockets via `ws` library, surfaced through Hono's `upgradeWebSocket` | Needed for ephemeral features (pings, measurements); also used for map change broadcast |
| Object storage | MinIO (local dev) + Hetzner Object Storage (production) | S3-compatible; same client code in both environments |
| Auth | External European OIDC provider (Zitadel or Hanko — TBD); server is an OIDC client only | Avoids building token issuance, refresh, OAuth2 flows ourselves; provider handles Google federation and future passkeys |
| Email/password accounts | Retained for migrated accounts and local dev; no new production signups | Existing users keep access; no email infrastructure needed (password reset via admin endpoint only) |
| Google accounts | Retained as legacy; federated through the chosen OIDC provider | Users continue to sign in with Google but the app only talks to the provider |
| Static serving | Caddy | Auto-HTTPS via Let's Encrypt; reverse-proxies `/api/*` to Node.js server |
| Local dev orchestration | Podman Compose | Replaces `firebase emulators:start`; no Java dependency |
| CI | GitHub Actions → GitHub Container Registry | Free container registry; images are multi-arch |
| Deployment | Kamal (SSH-based, zero-downtime) | Maximum portability; move to any VPS with no tooling changes |
| Hosting | Hetzner Cloud VPS + Hetzner Object Storage | Best EU value; S3-compatible storage; German company, GDPR-native |
| Analytics | Dropped initially; server request logs sufficient at current scale | Traffic is low, most users are known personally; can add Plausible later if needed |
| Language (server) | TypeScript now; Rust later (separate phase) | Too much risk to combine Firebase migration with language change |

---

## Target Architecture

```
┌─────────────────────────────────────────────────┐
│  Caddy container                                 │
│  • HTTPS (Let's Encrypt, automatic)              │
│  • Static files: React SPA + landing page        │
│  • Reverse proxy /api/* → Node.js server         │
│  • Reverse proxy /ws   → Node.js server          │
└─────────────────┬───────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────┐
│  Node.js + Hono container                        │
│  • REST API  (/api/*)                            │
│  • WebSocket (/ws/maps/:id)                      │
│  • Auth middleware (JWT verification)            │
│  • Business logic (ported from Firebase Funcs)   │
└────────┬────────────────────┬────────────────────┘
         │                    │
┌────────▼──────┐   ┌────────▼──────────────────┐
│  PostgreSQL   │   │  Object Storage            │
│  • All app    │   │  • Dev:  MinIO container   │
│    data       │   │  • Prod: Hetzner OS        │
│  • LISTEN/    │   │  • S3-compatible API       │
│    NOTIFY     │   │  • User images             │
│    for WS     │   │  • Spritesheets            │
│    broadcast  │   └───────────────────────────┘
└───────────────┘
```

### WebSocket Room Model

Each map session is a WebSocket room (`/ws/maps/:mapId`). Message types split cleanly
into persistent and ephemeral:

| Message type | Direction | Persisted? | Description |
|---|---|---|---|
| `change` | client → server → broadcast | Yes (PostgreSQL) | Map feature/token changes |
| `ping` | client → server → broadcast | No | "Look here" point on map |
| `measurement` | client → server → broadcast | No | Drag-to-measure line, shown live to all clients |

Ephemeral messages (ping, measurement) are forwarded immediately with no database write.
Map changes are persisted first, then broadcast to the room.

```
Client A sends measurement update
    │
    ▼
WebSocket server
    ├─ (measurement) → forward to all other clients in room
    └─ (change)      → service.addChanges() → PostgreSQL → NOTIFY → broadcast to room
                                   ↑
                        same function as POST /api/.../changes
```

**The WebSocket layer is transport + pub/sub only.** All business logic (authorization,
validation, persistence) lives in service functions shared with the REST endpoints. A
WebSocket `change` message and a `POST /api/.../changes` request call identical code;
the WebSocket path additionally triggers the room broadcast.

PostgreSQL LISTEN/NOTIFY is used internally so that if the server is ever scaled to multiple
instances, each instance's rooms stay in sync via the database notification channel.

---

## Auth Provider

Wall & Shadow acts as an OIDC Relying Party (client). The provider issues JWTs; the server
validates them on every request. This means no token issuance code, no refresh token
management, no OAuth2 dance implementation — all of that lives in the provider.

The provider also federates Google sign-in, so "sign in with Google" flows through the
provider rather than directly to Google. The app only needs one trusted issuer.

### Candidates

| Provider | Country | Self-hostable | Notable |
|---|---|---|---|
| **Zitadel** | Switzerland 🇨🇭 | Yes (single binary/container) | Strong OIDC support, Google federation, passkeys, generous cloud free tier, Apache 2.0 |
| **Hanko** | Germany 🇩🇪 | Yes (Docker) | Passkey-first design, 10k MAU free tier on cloud, modern DX |
| **Ory** | Germany 🇩🇪 | Yes (multiple services) | Most flexible, but operationally complex (Hydra + Kratos + Oathkeeper) |
| **Authentik** | Open source | Yes only (no SaaS) | Mature enterprise IdP, heavier, best for complex org requirements |

**Current leaning: Zitadel or Hanko.** Both run as a single container locally (added to
Compose) and in production. Zitadel is more complete for federation; Hanko has a better
passkey-first story for the future. Decision deferred until Phase 2 evaluation.

### Account Strategy

| Account type | New signups (prod)? | Migration path |
|---|---|---|
| Email/password | **No** — existing accounts only | Migrated into provider; password reset via admin endpoint (no email server) |
| Google | Yes, via provider federation | Already works through provider; label as legacy once better option exists |
| Passkey / provider-native | **Yes** — the future default | Users adopt when they choose; no forced migration |

The long-term goal is for all accounts to be native to the chosen European provider,
with Google and email/password marked legacy. Migration is self-service: user logs in
via their current method, links a passkey, old method becomes optional.

### Local Dev

The provider runs as a container in the Compose stack. Both Zitadel and Hanko publish
official Docker images. In development, the provider is pre-seeded with test users
(including an email/password account and a Google-federated test identity using a
mock upstream).

---

## What Firebase Does Today (Migration Scope)

### Firebase Services → Replacements

| Firebase Service | Usage | Replacement |
|---|---|---|
| **Firestore** | Primary database + real-time map sync via `onSnapshot` | PostgreSQL + WebSocket broadcast |
| **Cloud Functions** | Callable API (`interact` verb dispatch + `addSprites`) | Hono HTTP routes |
| **Auth** | Email/password + Google OAuth | European OIDC provider (server is OIDC client); provider federates Google sign-in |
| **Cloud Storage** | User images + spritesheets | Hetzner Object Storage (S3) |
| **Hosting** | React SPA + static landing page | Caddy |
| **Analytics** | Optional opt-in event tracking | TBD (Plausible candidate) |

### Firebase Functions → Full REST API

Firebase used a "client drives the database" model: clients wrote directly to Firestore
(security rules enforced auth), and Functions only handled operations too complex for
direct writes. The new server replaces both the Functions *and* the Firestore client
writes with a conventional REST API. All persistent operations are mediated by the server;
no client writes directly to the database.

The Firebase Functions verbs map directly to the new routes:

| Current verb | New route | Notes |
|---|---|---|
| `createAdventure` | `POST /api/adventures` | |
| `createMap` | `POST /api/adventures/:id/maps` | |
| `cloneMap` | `POST /api/adventures/:id/maps/:id/clone` | |
| `consolidateMapChanges` | `POST /api/adventures/:id/maps/:id/consolidate` | |
| `inviteToAdventure` | `POST /api/adventures/:id/invites` | |
| `joinAdventure` | `POST /api/invites/:id/join` | |
| `deleteImage` | `DELETE /api/images/:path` | |
| `deleteMap` | `DELETE /api/adventures/:id/maps/:id` | |
| `deleteAdventure` | `DELETE /api/adventures/:id` | |
| `addSprites` | `POST /api/adventures/:id/spritesheets` | |

The direct Firestore writes (no Functions equivalent) become these new routes:

| Current Firestore write | New route | Notes |
|---|---|---|
| `adventures/{id}` update | `PATCH /api/adventures/:id` | name, description, imagePath |
| `adventures/{id}/maps/{id}` update | `PATCH /api/adventures/:id/maps/:id` | name, description, imagePath, ffa |
| `adventures/{id}/players/{uid}` upsert | `PATCH /api/adventures/:id/players/:uid` | allowed (block/unblock), characters |
| `adventures/{id}/players/{uid}` delete | `DELETE /api/adventures/:id/players/me` | leave adventure |
| `adventures/{id}/maps/{id}/changes` add | `POST /api/adventures/:id/maps/:id/changes` | write incremental change |

Read endpoints (Firestore listeners → REST queries):

| Current Firestore listener/get | New route |
|---|---|
| `adventures/` query (profile summary) | `GET /api/adventures` |
| `adventures/{id}` get | `GET /api/adventures/:id` |
| `adventures/{id}/maps/` query | `GET /api/adventures/:id/maps` |
| `adventures/{id}/maps/{id}` get | `GET /api/adventures/:id/maps/:id` |
| `adventures/{id}/players/` query | `GET /api/adventures/:id/players` |

The Storage upload trigger (`onUpload`) becomes an explicit upload endpoint:
`POST /api/images` — validates MIME type, writes to S3, records in PostgreSQL.

**WebSocket and REST share the same service layer.** The `POST .../changes` REST
endpoint and the WebSocket `change` message type both call the same service function;
the WebSocket path additionally broadcasts to the room. This means all persistent
operations can be tested via REST without a WebSocket connection, and the WebSocket
layer stays thin (transport + pub/sub only, no business logic).

### Real-Time Sync Migration

The current system uses Firestore `onSnapshot` listeners on the `changes/` subcollection.
The new system uses a WebSocket connection per map session:

| Current (Firestore) | New (WebSocket) |
|---|---|
| `onSnapshot(changesRef, ...)` | `new WebSocket('/ws/maps/:id')` |
| Document added to `changes/` | `message` event with `type: 'change'` |
| `changes/base` update (resync) | `message` event with `type: 'resync'` |
| Unsubscribe function | `ws.close()` |

The change data format (the `chs[]` array of typed change objects) stays identical.
Only the transport layer changes.

---

## Database Schema (PostgreSQL)

High-level table design. JSONB columns preserve variable-structure data that is already
document-shaped in the current Firestore model.

```sql
-- Users
-- The OIDC provider is the source of truth for identity and credentials.
-- We store only what the app needs. provider_sub is the 'sub' claim from the provider's JWT.
users (
  id           UUID PRIMARY KEY,
  provider_sub TEXT UNIQUE NOT NULL,  -- OIDC subject identifier from the provider
  email        TEXT NOT NULL,         -- cached from JWT claims, may change
  name         TEXT NOT NULL,         -- cached from JWT claims
  level        TEXT NOT NULL DEFAULT 'standard',  -- 'standard' | 'gold'
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
)
-- No refresh_tokens table: the provider manages token issuance and refresh entirely.
-- No password_hash or google_id: the provider manages credentials and social federation.

-- Adventures
adventures (
  id          UUID PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  owner_id    UUID NOT NULL REFERENCES users,
  image_path  TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
)

adventure_players (
  adventure_id UUID NOT NULL REFERENCES adventures ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users,
  player_name  TEXT NOT NULL,
  allowed      BOOLEAN NOT NULL DEFAULT true,
  characters   JSONB NOT NULL DEFAULT '[]',
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (adventure_id, user_id)
)

-- Maps
maps (
  id           UUID PRIMARY KEY,
  adventure_id UUID NOT NULL REFERENCES adventures ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  ty           TEXT NOT NULL,   -- 'hex' | 'square'
  ffa          BOOLEAN NOT NULL DEFAULT false,
  image_path   TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
)

-- Change tracking (mirrors the current changes/ subcollection structure)
map_changes (
  id          UUID PRIMARY KEY,
  map_id      UUID NOT NULL REFERENCES maps ON DELETE CASCADE,
  changes     JSONB NOT NULL,   -- the chs[] array
  incremental BOOLEAN NOT NULL,
  resync      BOOLEAN NOT NULL DEFAULT false,
  user_id     UUID REFERENCES users,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
)

-- The 'base' consolidated state is a row with incremental = false
-- Incremental changes have incremental = true
-- Index: (map_id, incremental, created_at) for watchChanges queries

-- Images
images (
  id          UUID PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users ON DELETE CASCADE,
  name        TEXT NOT NULL,
  path        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
)

-- Spritesheets
spritesheets (
  id            UUID PRIMARY KEY,
  adventure_id  UUID NOT NULL REFERENCES adventures ON DELETE CASCADE,
  sprites       JSONB NOT NULL,   -- string[] of paths
  geometry      TEXT NOT NULL,    -- e.g. '4x4'
  free_spaces   INTEGER NOT NULL,
  superseded_by UUID REFERENCES spritesheets,
  refs          INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
)

-- Invites
invites (
  id             UUID PRIMARY KEY,
  adventure_id   UUID NOT NULL REFERENCES adventures ON DELETE CASCADE,
  owner_id       UUID NOT NULL REFERENCES users,
  expires_at     TIMESTAMPTZ NOT NULL,
  delete_at      TIMESTAMPTZ NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
)

-- App config (replaces config/version)
app_config (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL
)
```

Cascade deletes on `ON DELETE CASCADE` replace Firebase admin SDK `recursiveDelete()`.
Delete an adventure → all maps, players, changes, spritesheets, invites deleted automatically.

---

## Continuous Deployment

### Local Development (Podman Compose)

Replaces `firebase emulators:start`. One command brings up the full stack:

```yaml
# compose.yaml (sketch)
services:
  db:
    image: postgres:17
    environment: { POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD }
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck: pg_isready

  storage:
    image: minio/minio
    command: server /data --console-address :9001
    ports: ["9000:9000", "9001:9001"]  # API + web UI

  auth:
    # Zitadel or Hanko — TBD. Both publish official Docker images.
    # Pre-seeded with test users and Google federation mock for local dev.
    image: ghcr.io/zitadel/zitadel:latest  # example
    ports: ["8082:8080"]
    depends_on: [db]

  api:
    build: ./server
    command: tsx watch src/index.ts  # hot reload
    environment:
      - DATABASE_URL
      - S3_ENDPOINT
      - S3_BUCKET
      - OIDC_ISSUER=http://localhost:8082  # validates JWTs from local auth container
    depends_on: [db, storage, auth]
    ports: ["8080:8080"]  # HTTP + WebSocket on same port

  web:
    # Vite dev server for hot-reload frontend development
    # OR: Caddy serving the built SPA for integration testing
```

Dev ports:
- API + WebSocket: http://localhost:8080 / ws://localhost:8080
- Auth provider UI: http://localhost:8082
- MinIO web UI: http://localhost:9001
- PostgreSQL: localhost:5432 (directly queryable with psql)

### CI Pipeline (GitHub Actions)

```
on: push to main / pull_request

jobs:
  test:
    - Start PostgreSQL + MinIO as services
    - yarn install
    - yarn lint
    - yarn test:unit
    - yarn test:integration   # against real PostgreSQL/MinIO

  build:
    needs: test
    - Build multi-arch container image (amd64 + arm64)
    - Push to ghcr.io/OWNER/wallandshadow:SHA

  deploy:
    needs: build
    if: push to main
    - Run Kamal deploy (SSH to Hetzner VPS)
```

### Production Deployment (Kamal)

Kamal deploys over SSH to the VPS. Key features:
- Zero-downtime blue/green container swap
- Health check before routing traffic to new container
- Instant rollback (`kamal rollback`)
- Works with any VPS; no Kubernetes required

```yaml
# config/deploy.yml (sketch)
service: wallandshadow
image: ghcr.io/OWNER/wallandshadow

servers:
  web:
    - HETZNER_VPS_IP

proxy:
  ssl: true
  host: wallandshadow.example.com

env:
  secret: [DATABASE_URL, JWT_SECRET, S3_ACCESS_KEY, S3_SECRET_KEY, GOOGLE_CLIENT_SECRET]
  clear:
    S3_ENDPOINT: https://fsn1.your-objectstorage.com
    S3_BUCKET: wallandshadow
```

---

## Hosting (Hetzner Cloud)

**Primary recommendation: Hetzner Cloud VPS + Hetzner Object Storage**

### Compute

| Resource | Spec | Cost (approx.) |
|---|---|---|
| VPS (CPX21) | 3 vCPU, 4GB RAM | ~€7-8/month |
| Hetzner Object Storage | 1TB included | ~€5-7/month |
| IPv4 address | Included | — |
| **Total** | | **~€12-15/month** |

Note: Hetzner announced ~30% price increases effective April 2026. Costs above reflect
post-increase estimates.

Data centres: Nuremberg, Falkenstein (Germany); Helsinki (Finland). All EU, all GDPR-compliant.

PostgreSQL runs on the same VPS initially. If operational overhead becomes an issue,
**Scaleway Managed PostgreSQL** (~€7/month) is the easiest upgrade path — Scaleway is
French, EU-only, with data centres in Paris, Amsterdam, and Warsaw.

### Alternative Providers Considered

| Provider | Notes |
|---|---|
| **Scaleway** | French, managed PostgreSQL available, slightly higher cost, good alternative |
| **OVHcloud** | UK + EU DCs, no-egress-fee storage, more complex pricing, decent fallback |
| **Fly.io** | Good DX, EU regions (London/Amsterdam/Frankfurt), no object storage offering, pricier |
| **Render** | Managed platform, Frankfurt region, compute tier pricing too high for this workload |

---

## Migration Phases

Firebase stays live throughout. Each phase can ship independently.

### Phase 1 — New server foundation (alongside Firebase)

The goal of Phase 1 is a complete, fully-tested REST API that covers the entire data
model — not just the operations Firebase Functions handled, but also the direct Firestore
writes the client made without going through Functions. Firebase's "client drives the
database" model is not carried forward; all persistent operations are server-mediated.

- Set up PostgreSQL schema with Drizzle ORM and migrations
- Build Hono API server with JWT auth middleware (Phase 1 uses local email/password JWT;
  replaced by OIDC in Phase 2)
- Implement all REST routes: CRUD for adventures, maps, players, map changes, images,
  spritesheets, invites (see "Firebase Functions → Full REST API" above for the full list)
- Integration test suite running against real PostgreSQL and MinIO — no direct DB seeding
  in tests once all write endpoints are implemented
- Compose file for local dev (PostgreSQL + MinIO already running; add API container)
- GitHub Actions CI pipeline (`test:server` against real PostgreSQL/MinIO services)
- Write data migration script (Firestore export → PostgreSQL import)
- **No client changes yet**

### Phase 2 — Auth migration

- Choose between Zitadel and Hanko (evaluation: run both locally, assess DX and federation setup)
- Configure chosen provider: Google as federated upstream; email/password for legacy accounts; no new email signups in production
- Implement admin password-reset endpoint (no email delivery; operator-triggered)
- Server becomes OIDC client: validate provider JWTs, look up/create `users` row on first login
- Migrate existing Firebase Auth users into the provider (Firebase export → provider import)
- **Client change**: replace Firebase Auth SDK sign-in flows with provider's login UI (redirect or embedded) and token storage
- Run Firebase Auth and new provider in parallel until all users confirmed migrated

### Phase 3 — Storage migration

- Wire up MinIO (dev) and Hetzner Object Storage (prod) with S3 client
- Implement image upload endpoint (validates MIME, writes to S3, records in PostgreSQL)
- Implement `addSprites` endpoint
- Migrate existing images from Firebase Storage
- **Client change**: swap Firebase Storage SDK for direct S3 presigned URLs or proxy upload

### Phase 4 — Real-time sync and data migration

By this point the full REST API exists and is tested. The WebSocket layer is a thin
transport + pub/sub adapter on top of the same service functions.

- Implement WebSocket server (`/ws/maps/:id`) with room management and auth
- Wire `change` messages to the same `addChanges` service used by `POST .../changes`;
  broadcast the persisted result to all room members
- Implement ephemeral `ping` and `measurement` messages (forward only, no DB write)
- Implement map change broadcast via PostgreSQL LISTEN/NOTIFY (supports multi-instance)
- Run the data migration script to move Firestore data to PostgreSQL
- **Client change**: replace Firestore `onSnapshot` with WebSocket; replace `httpsCallable`
  with `fetch` against the REST API
- Smoke test collaborative editing with both old and new paths available

### Phase 5 — Decommission Firebase

- Verify all features working on new stack
- Final data migration run
- Switch DNS to new server
- Disable Firebase project (or put in archive mode)
- Remove Firebase SDK dependencies from client

### Phase 6 (future) — Rust server rewrite

- Separate project: rewrite the Hono server in Axum or Actix
- API contract (HTTP routes + WebSocket message types) stays identical
- Client code unchanged
- PostgreSQL schema unchanged
- Swap server binary; validate; done

---

## TODO Phase Comments

During migration, code that uses a temporary workaround that will be replaced in a later phase is marked with a structured comment:

```
// TODO Phase N: <description of what changes in that phase>
```

This applies to both production code and tests. Examples:

- `// TODO Phase 2: replace local JWT registration with OIDC test flow`
- `// TODO Phase 4: replace direct DB insert with WebSocket client once real-time sync is implemented`

The comment makes it easy to search for all workarounds that become addressable in a given phase: `grep -r "TODO Phase 4"`.

---

## What Does Not Change

The following are unaffected by the replatforming and require no migration work:

- React frontend components
- Three.js rendering pipeline (grid geometry, instanced rendering, LOS)
- `@wallandshadow/shared` package (data types, converters, grid geometry)
- Map change tracking logic (the `chs[]` change format is preserved as-is in PostgreSQL JSONB)
- Firestore security rule logic (moves into server-side middleware/route guards)
- User permission model (standard vs gold levels, adventure ownership, player access)
- All game mechanics (FFA mode, token movement validation, area-bounded movement)

---

## Open Questions

- **Auth provider**: Zitadel vs Hanko — evaluate both in Phase 2. Key criteria: ease of Google
  federation setup, Docker image quality for local dev, user import tooling for Firebase migration.
- **Managed PostgreSQL**: Self-manage on VPS (simpler, cheaper) vs Scaleway managed (less ops)?
  Current leaning: self-manage initially, migrate to managed if it becomes a burden.
- **E2E tests**: Current Playwright tests run against Firebase emulators. Will need updating to
  run against the Compose stack (Phase 4 or 5 work).
- **Kamal config**: HTTP and WebSocket traffic on the same port — verify Kamal's proxy handles
  `Upgrade: websocket` headers correctly (it should; Kamal uses kamal-proxy which is WebSocket-aware).
