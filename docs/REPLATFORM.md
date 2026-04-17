# Replatforming: Firebase → Self-Hosted Stack

This document captures the architecture decisions and migration plan for moving Wall & Shadow
off Firebase and onto a portable, containerised server stack.

**Decision date**: March 2026
**Status (2026-04-17)**: Phases 1–4 shipped. Test server deployed on Hetzner and exercised.
The Firebase codebase has been forked to the `legacy-firebase` branch and continues to deploy
from there; `main` is being prepared for Firebase removal (Phase 5). Descoped during delivery:
automated Firestore → PostgreSQL data migration (see Phase 5 note below) and ephemeral
WebSocket messages (`ping`, `measurement`) — the latter moved to a separate plan, see
@docs/EPHEMERAL_WS.md. Analytics replacement outlined in @docs/ANALYTICS.md.

---

## Decisions

| Concern                 | Decision                                                                                | Rationale                                                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Database                | PostgreSQL (self-managed on VPS)                                                        | Ubiquitous, excellent JSON support for change documents, CASCADE constraints replace `recursiveDelete()`                |
| HTTP API server         | Node.js + Hono (TypeScript)                                                             | Reuses existing Functions logic; Hono is runtime-agnostic (portable to Bun/Deno/CF Workers)                             |
| Real-time transport     | WebSockets via `ws` library                                                             | Used for map change broadcast today. Potential future use for ephemeral features (pings, measurements) — see @docs/EPHEMERAL_WS.md |
| Object storage          | MinIO (local dev) + Hetzner Object Storage (production)                                 | S3-compatible; same client code in both environments                                                                    |
| Auth                    | External European OIDC provider (Zitadel or Hanko — TBD); server is an OIDC client only | Avoids building token issuance, refresh, OAuth2 flows ourselves; provider handles Google federation and future passkeys |
| Email/password accounts | Retained for migrated accounts and local dev; no new production signups                 | Existing users keep access; no email infrastructure needed (password reset via admin endpoint only)                     |
| Google accounts         | Retained as legacy; federated through the chosen OIDC provider                          | Users continue to sign in with Google but the app only talks to the provider                                            |
| Static serving          | Caddy                                                                                   | Auto-HTTPS via Let's Encrypt; reverse-proxies `/api/*` to Node.js server                                                |
| Local dev orchestration | Podman Compose                                                                          | Replaces `firebase emulators:start`; no Java dependency                                                                 |
| CI                      | GitHub Actions → GitHub Container Registry                                              | Free container registry; images are multi-arch                                                                          |
| Deployment              | systemd unit per environment running `docker run`; CI SSHes in to flip image tag and restart the unit | Simple, portable, fits a VPS where Caddy + PostgreSQL are managed by Ansible; tens of seconds of downtime on restart is acceptable |
| Hosting                 | Hetzner Cloud VPS + Hetzner Object Storage                                              | Best EU value; S3-compatible storage; German company, GDPR-native                                                       |
| Analytics               | Google Analytics dropped; replacement outlined in @docs/ANALYTICS.md                    | Traffic is low, most users known personally; server request logs sufficient at current scale. Plausible/Umami candidates for later |
| Language (server)       | TypeScript now; Rust later (separate phase)                                             | Too much risk to combine Firebase migration with language change                                                        |

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

Each map session is a WebSocket room (`/ws/maps/:mapId`). The room is currently a
one-way broadcast channel: the server pushes persisted map changes; clients do not send
messages back over the socket. All writes go through the REST API.

```
Client POST /api/adventures/:id/maps/:id/changes
    │
    ▼
service.addChanges()  →  PostgreSQL (INSERT)  →  NOTIFY map_changes
                                                      │
                                                      ▼
                                  LISTEN handler  →  room.broadcast(mapId)
                                                      │
                                                      ▼
                                         every WebSocket in the room
```

PostgreSQL LISTEN/NOTIFY is used internally so that if the server is ever scaled to multiple
instances, each instance's rooms stay in sync via the database notification channel.

The original plan also anticipated bidirectional ephemeral messages (`ping`, `measurement`)
for live collaboration cues. That work is unimplemented and broken out into its own plan:
see @docs/EPHEMERAL_WS.md.

---

## Auth Provider

Wall & Shadow acts as an OIDC Relying Party (client). The provider issues JWTs; the server
validates them on every request. This means no token issuance code, no refresh token
management, no OAuth2 dance implementation — all of that lives in the provider.

The provider also federates Google sign-in, so "sign in with Google" flows through the
provider rather than directly to Google. The app only needs one trusted issuer.

### Candidates

| Provider      | Country        | Self-hostable                 | Notable                                                                                |
| ------------- | -------------- | ----------------------------- | -------------------------------------------------------------------------------------- |
| **Zitadel**   | Switzerland 🇨🇭 | Yes (single binary/container) | Strong OIDC support, Google federation, passkeys, generous cloud free tier, Apache 2.0 |
| **Hanko**     | Germany 🇩🇪     | Yes (Docker)                  | Passkey-first design, 10k MAU free tier on cloud, modern DX                            |
| **Ory**       | Germany 🇩🇪     | Yes (multiple services)       | Most flexible, but operationally complex (Hydra + Kratos + Oathkeeper)                 |
| **Authentik** | Open source    | Yes only (no SaaS)            | Mature enterprise IdP, heavier, best for complex org requirements                      |

**Current leaning: Zitadel or Hanko.** Both run as a single container locally (added to
Compose) and in production. Zitadel is more complete for federation; Hanko has a better
passkey-first story for the future. Decision deferred until Phase 2 evaluation.

### Account Strategy

| Account type              | New signups (prod)?             | Migration path                                                              |
| ------------------------- | ------------------------------- | --------------------------------------------------------------------------- |
| Email/password            | **No** — existing accounts only | Migrated into provider; password reset via admin endpoint (no email server) |
| Google                    | Yes, via provider federation    | Already works through provider; label as legacy once better option exists   |
| Passkey / provider-native | **Yes** — the future default    | Users adopt when they choose; no forced migration                           |

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

| Firebase Service    | Usage                                                  | Replacement                                                                       |
| ------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------- |
| **Firestore**       | Primary database + real-time map sync via `onSnapshot` | PostgreSQL + WebSocket broadcast                                                  |
| **Cloud Functions** | Callable API (`interact` verb dispatch + `addSprites`) | Hono HTTP routes                                                                  |
| **Auth**            | Email/password + Google OAuth                          | European OIDC provider (server is OIDC client); provider federates Google sign-in |
| **Cloud Storage**   | User images + spritesheets                             | Hetzner Object Storage (S3)                                                       |
| **Hosting**         | React SPA + static landing page                        | Caddy                                                                             |
| **Analytics**       | Optional opt-in event tracking                         | TBD (Plausible candidate)                                                         |

### Firebase Functions → Full REST API

Firebase used a "client drives the database" model: clients wrote directly to Firestore
(security rules enforced auth), and Functions only handled operations too complex for
direct writes. The new server replaces both the Functions _and_ the Firestore client
writes with a conventional REST API. All persistent operations are mediated by the server;
no client writes directly to the database.

The Firebase Functions verbs map directly to the new routes:

| Current verb            | New route                                       | Notes |
| ----------------------- | ----------------------------------------------- | ----- |
| `createAdventure`       | `POST /api/adventures`                          |       |
| `createMap`             | `POST /api/adventures/:id/maps`                 |       |
| `cloneMap`              | `POST /api/adventures/:id/maps/:id/clone`       |       |
| `consolidateMapChanges` | `POST /api/adventures/:id/maps/:id/consolidate` |       |
| `inviteToAdventure`     | `POST /api/adventures/:id/invites`              |       |
| `joinAdventure`         | `POST /api/invites/:id/join`                    |       |
| `deleteImage`           | `DELETE /api/images/:path`                      |       |
| `deleteMap`             | `DELETE /api/adventures/:id/maps/:id`           |       |
| `deleteAdventure`       | `DELETE /api/adventures/:id`                    |       |
| `addSprites`            | `POST /api/adventures/:id/spritesheets`         |       |

The direct Firestore writes (no Functions equivalent) become these new routes:

| Current Firestore write                 | New route                                   | Notes                               |
| --------------------------------------- | ------------------------------------------- | ----------------------------------- |
| `adventures/{id}` update                | `PATCH /api/adventures/:id`                 | name, description, imagePath        |
| `adventures/{id}/maps/{id}` update      | `PATCH /api/adventures/:id/maps/:id`        | name, description, imagePath, ffa   |
| `adventures/{id}/players/{uid}` upsert  | `PATCH /api/adventures/:id/players/:uid`    | allowed (block/unblock), characters |
| `adventures/{id}/players/{uid}` delete  | `DELETE /api/adventures/:id/players/me`     | leave adventure                     |
| `adventures/{id}/maps/{id}/changes` add | `POST /api/adventures/:id/maps/:id/changes` | write incremental change            |

Read endpoints (Firestore listeners → REST queries):

| Current Firestore listener/get        | New route                          |
| ------------------------------------- | ---------------------------------- |
| `adventures/` query (profile summary) | `GET /api/adventures`              |
| `adventures/{id}` get                 | `GET /api/adventures/:id`          |
| `adventures/{id}/maps/` query         | `GET /api/adventures/:id/maps`     |
| `adventures/{id}/maps/{id}` get       | `GET /api/adventures/:id/maps/:id` |
| `adventures/{id}/players/` query      | `GET /api/adventures/:id/players`  |

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

| Current (Firestore)            | New (WebSocket)                       |
| ------------------------------ | ------------------------------------- |
| `onSnapshot(changesRef, ...)`  | `new WebSocket('/ws/maps/:id')`       |
| Document added to `changes/`   | `message` event with `type: 'change'` |
| `changes/base` update (resync) | `message` event with `type: 'resync'` |
| Unsubscribe function           | `ws.close()`                          |

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
    ports: ["9000:9000", "9001:9001"] # API + web UI

  auth:
    # Zitadel or Hanko — TBD. Both publish official Docker images.
    # Pre-seeded with test users and Google federation mock for local dev.
    image: ghcr.io/zitadel/zitadel:latest # example
    ports: ["8082:8080"]
    depends_on: [db]

  api:
    build: ./server
    command: tsx watch src/index.ts # hot reload
    environment:
      - DATABASE_URL
      - S3_ENDPOINT
      - S3_BUCKET
      - OIDC_ISSUER=http://localhost:8082 # validates JWTs from local auth container
    depends_on: [db, storage, auth]
    ports: ["8080:8080"] # HTTP + WebSocket on same port

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
    - SSH to VPS, write IMAGE=... to /etc/wallandshadow/<env>.image,
      systemctl restart wallandshadow-<env>.service
```

### Production Deployment (systemd + docker)

The VPS is provisioned by Ansible (`ansible/playbook.yml`), which installs Docker
and renders a systemd unit per environment from `ansible/templates/wallandshadow.service.j2`.
Each unit runs `docker run --network host --env-file /etc/wallandshadow/<env>.env`
and reads its image tag from `/etc/wallandshadow/<env>.image` via `EnvironmentFile`.

Deployment is a three-line shell operation over SSH:

```bash
printf 'IMAGE=%s\n' "$NEW_IMAGE" > /etc/wallandshadow/<env>.image
systemctl restart wallandshadow-<env>.service
systemctl is-active --quiet wallandshadow-<env>.service
```

Per-environment env-files (`/etc/wallandshadow/{test,prod}.env`) hold the runtime
config: `DATABASE_URL`, `JWT_SECRET`, S3 creds, OIDC settings. They're rendered by
Ansible and updated by `ansible/rotate_secrets.sh` when secrets rotate. Caddy and
PostgreSQL run natively on the VPS (also managed by Ansible), not as containers.

Trade-off: restarting the unit drops the container for tens of seconds — no
blue/green, no zero-downtime swap. Acceptable at current scale; can be revisited
later if needed.

---

## Hosting (Hetzner Cloud)

**Primary recommendation: Hetzner Cloud VPS + Hetzner Object Storage**

### Compute

| Resource               | Spec            | Cost (approx.)    |
| ---------------------- | --------------- | ----------------- |
| VPS (CPX21)            | 3 vCPU, 4GB RAM | ~€7-8/month       |
| Hetzner Object Storage | 1TB included    | ~€5-7/month       |
| IPv4 address           | Included        | —                 |
| **Total**              |                 | **~€12-15/month** |

Note: Hetzner announced ~30% price increases effective April 2026. Costs above reflect
post-increase estimates.

Data centres: Nuremberg, Falkenstein (Germany); Helsinki (Finland). All EU, all GDPR-compliant.

PostgreSQL runs on the same VPS initially. If operational overhead becomes an issue,
**Scaleway Managed PostgreSQL** (~€7/month) is the easiest upgrade path — Scaleway is
French, EU-only, with data centres in Paris, Amsterdam, and Warsaw.

### Alternative Providers Considered

| Provider     | Notes                                                                                 |
| ------------ | ------------------------------------------------------------------------------------- |
| **Scaleway** | French, managed PostgreSQL available, slightly higher cost, good alternative          |
| **OVHcloud** | UK + EU DCs, no-egress-fee storage, more complex pricing, decent fallback             |
| **Fly.io**   | Good DX, EU regions (London/Amsterdam/Frankfurt), no object storage offering, pricier |
| **Render**   | Managed platform, Frankfurt region, compute tier pricing too high for this workload   |

---

## Migration Phases

Firebase was kept live throughout Phases 1–4 and has now been forked to the
`legacy-firebase` branch. Each phase shipped independently.

### Phase 1 — New server foundation (alongside Firebase) ✅

Goal: a complete, fully-tested REST API covering the entire data model — not just the
operations Firebase Functions handled, but also the direct Firestore writes the client
made without going through Functions. Firebase's "client drives the database" model is
not carried forward; all persistent operations are server-mediated.

- ✅ PostgreSQL schema with Drizzle ORM and migrations (`was-web/server/src/db/`)
- ✅ Hono API server with JWT auth middleware (`was-web/server/src/auth/`)
- ✅ Full REST route coverage (`was-web/server/src/routes/`) — all verbs in "Firebase
  Functions → Full REST API" above, plus the Firestore-write equivalents
- ✅ Integration test suite against real PostgreSQL and MinIO (`was-web/server/src/__tests__/`)
- ✅ GitHub Actions CI pipeline (`.github/workflows/ci-server.yml`)
- ⏭ No standalone `compose.yaml` was written: the devcontainer already auto-starts
  PostgreSQL + MinIO, which turned out to be the practical entry point for local dev.
  If a Compose file is ever needed outside the devcontainer, this is where to slot it.

### Phase 2 — Auth migration ✅

- ✅ OIDC provider selected: **Zitadel** (Hanko trialled and deprioritised)
- ✅ Server is an OIDC Relying Party: validates provider JWTs via JWKS
  (`was-web/server/src/auth/oidc.ts`); creates/looks up `users` row on first login
- ✅ Legacy email/password auth retained for migrated accounts
  (`was-web/server/src/auth/password.ts`); no new email signups in production
- ✅ Client OIDC flow (`was-web/src/OidcCallback.tsx`, `HonoContextProvider`)
- ⏭ Test helpers still register users via a local JWT path rather than a full OIDC
  test flow (see `// TODO Phase 2:` in `was-web/server/src/__tests__/helpers.ts`);
  left as-is because it works and OIDC round-trips in tests would add slow infrastructure
- ⏭ No bulk Firebase Auth → Zitadel user import was run; users re-authenticate through
  the new provider when they come back

### Phase 3 — Storage migration ✅

- ✅ S3 client wired to MinIO (dev) and Hetzner Object Storage (prod)
- ✅ `POST /api/images` with MIME validation, quota enforcement, DB + S3 atomicity
- ✅ `POST /api/adventures/:id/spritesheets` for sprite uploads
- ⏭ No bulk image migration run; images in Firebase Storage stay on `legacy-firebase`

### Phase 4 — Real-time sync ✅

The WebSocket layer is a thin transport + pub/sub adapter on top of the same service
functions the REST API uses.

- ✅ WebSocket server (`/ws/maps/:id`) with room management and auth
  (`was-web/server/src/ws/`)
- ✅ Broadcast of persisted changes via PostgreSQL LISTEN/NOTIFY — supports multi-instance
- ✅ Client replaces Firestore `onSnapshot` with WebSocket (`honoWebSocket.ts`) and
  `httpsCallable` with `fetch` against the REST API
- ⏭ Ephemeral `ping` / `measurement` messages **not implemented** — moved to
  @docs/EPHEMERAL_WS.md for separate consideration. The server currently registers no
  `'message'` handler on the WebSocket; clients do not send messages over the socket
- ⏭ No automated Firestore → PostgreSQL data migration. Deliberately descoped: long-lived
  maps are not a thing in Wall & Shadow, so users rotate onto the new stack as their
  map usage turns over. `legacy-firebase` remains deployable for anyone who needs their
  old data

### Phase 5 — Remove Firebase from `main` 🚧

Firebase has been forked to the `legacy-firebase` branch. `main` is being stripped of
Firebase code to shrink dependencies, unblock security updates, and simplify the client.
The detailed deletion list lives in @docs/FIREBASE_REMOVAL.md.

- Delete `was-web/functions/` and Firebase-specific client services/providers
- Drop `firebase`, `firebase-admin`, `@firebase/rules-unit-testing` from package manifests
- Collapse `VITE_BACKEND` (Hono becomes the only option) and `VITE_AUTH_MODE`
  (OIDC-only)
- Remove Google Analytics consent banner and `AnalyticsContextProvider`; replacement
  plan lives in @docs/ANALYTICS.md
- Keep the Firebase **deployment workflow YAMLs** (`.github/workflows/deploy-firebase.yml`,
  `deploy-test.yml`, `deploy-production.yml`) on `main` so `workflow_dispatch` triggers
  remain visible in the GitHub Actions UI for the `legacy-firebase` branch
- Remove Firebase config files (`firebase.json`, `.firebaserc`, `cors.json`,
  `firestore.rules`, `storage.rules`, `firestore.indexes.json`) from `main`;
  `legacy-firebase` branch retains its own copies

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

- **Managed PostgreSQL**: Self-manage on VPS (simpler, cheaper) vs Scaleway managed (less ops)?
  Current leaning: self-manage initially, migrate to managed if it becomes a burden.
- **E2E tests**: Playwright setup still needs a full pass against the Hono stack (no
  Firebase emulators) — covered by Phase 5 cleanup.
- **Ephemeral WebSocket messages**: should we build them? See @docs/EPHEMERAL_WS.md.
- **Analytics replacement**: which tool, and is it worth it at current traffic? See
  @docs/ANALYTICS.md.
