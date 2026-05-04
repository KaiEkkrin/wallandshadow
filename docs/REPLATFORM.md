# Architecture: Wall & Shadow Self-Hosted Stack

Wall & Shadow runs on a self-hosted stack on Hetzner Cloud. This document describes the
current architecture and the key decisions behind it.

**Stack**: Hono + Node.js (TypeScript) · PostgreSQL 17 · Hetzner Object Storage (S3) ·
Zitadel OIDC · Caddy · systemd-supervised Docker containers

The original Firebase codebase lives on the `legacy-firebase` branch and is not described
here. See `docs/LEGACY_FIREBASE_DEPLOY.md` for its deployment guide.

---

## Architecture Decisions

| Concern                 | Decision                                                                                | Rationale                                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Database                | PostgreSQL (self-managed on VPS)                                                        | Ubiquitous, excellent JSON support for change documents, CASCADE constraints handle recursive deletes              |
| HTTP API server         | Node.js + Hono (TypeScript)                                                             | Runtime-agnostic (portable to Bun/Deno/CF Workers); thin route handlers over a shared service layer               |
| Real-time transport     | WebSockets via `ws` library                                                             | Used for map change broadcast. Potential future use for ephemeral features — see @docs/EPHEMERAL_WS.md             |
| Object storage          | MinIO (local dev) + Hetzner Object Storage (production)                                 | S3-compatible; same client code in both environments                                                               |
| Auth                    | Zitadel OIDC; server is an OIDC Relying Party only                                      | Avoids building token issuance, refresh, OAuth2 flows; provider handles Google federation and future passkeys      |
| Email/password accounts | Retained for migrated accounts and local dev; no new production signups                 | Existing users keep access; no email infrastructure needed (password reset via admin endpoint only)                |
| Static serving          | Caddy                                                                                   | Auto-HTTPS via Let's Encrypt; reverse-proxies `/api/*` and `/ws/*` to the Hono server                             |
| CI                      | GitHub Actions → GitHub Container Registry                                              | Free container registry; images are multi-arch                                                                     |
| Deployment              | systemd unit per environment running `docker run`; CI SSHes in to flip image tag and restart | Simple, portable; tens of seconds of downtime on restart is acceptable at current scale                      |
| Hosting                 | Hetzner Cloud VPS + Hetzner Object Storage                                              | Best EU value; S3-compatible storage; German company, GDPR-native                                                 |
| Analytics               | GoAccess static HTML report from Caddy access logs, served at `/stats` behind basic auth | No third-party processor, no cookies, no client instrumentation; small enough to run on the same VPS               |
| Language (server)       | TypeScript; Rust is a separate future phase                                             |                                                                                                                    |

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────┐
│  Caddy (native on VPS)                           │
│  • HTTPS (Let's Encrypt, automatic)              │
│  • Static files: React SPA + landing page        │
│  • Reverse proxy /api/* → Hono server            │
│  • Reverse proxy /ws/*  → Hono server            │
└─────────────────┬───────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────┐
│  Node.js + Hono container                        │
│  • REST API  (/api/*)                            │
│  • WebSocket (/ws/maps/:id)                      │
│  • OIDC JWT validation middleware                │
│  • Business logic in server/src/services/        │
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

---

## REST API Routes

All persistent operations are server-mediated. The client never writes directly to the
database.

| Route                                           | Purpose                                      |
| ----------------------------------------------- | -------------------------------------------- |
| `POST /api/adventures`                          | Create adventure                             |
| `GET /api/adventures`                           | List user's adventures                       |
| `GET /api/adventures/:id`                       | Get adventure                                |
| `PATCH /api/adventures/:id`                     | Update adventure (name, description, image)  |
| `DELETE /api/adventures/:id`                    | Delete adventure (cascades to all children)  |
| `POST /api/adventures/:id/maps`                 | Create map                                   |
| `GET /api/adventures/:id/maps`                  | List maps                                    |
| `GET /api/adventures/:id/maps/:id`              | Get map                                      |
| `PATCH /api/adventures/:id/maps/:id`            | Update map                                   |
| `POST /api/adventures/:id/maps/:id/clone`       | Clone map                                    |
| `POST /api/adventures/:id/maps/:id/consolidate` | Consolidate map changes                      |
| `DELETE /api/adventures/:id/maps/:id`           | Delete map                                   |
| `POST /api/adventures/:id/maps/:id/changes`     | Write incremental map change                 |
| `GET /api/adventures/:id/players`               | List players                                 |
| `PATCH /api/adventures/:id/players/:uid`        | Update player (allowed, characters)          |
| `DELETE /api/adventures/:id/players/me`         | Leave adventure                              |
| `POST /api/adventures/:id/invites`              | Create invite                                |
| `POST /api/invites/:id/join`                    | Join adventure via invite                    |
| `POST /api/images`                              | Upload image (MIME validation, S3 + DB)      |
| `DELETE /api/images/:path`                      | Delete image                                 |
| `POST /api/adventures/:id/spritesheets`         | Upload spritesheet                           |

---

## WebSocket Room Model

Each map session is a WebSocket room (`/ws/maps/:mapId`). The room is a one-way broadcast
channel: the server pushes persisted map changes; clients do not send messages back over
the socket. All writes go through the REST API.

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

PostgreSQL LISTEN/NOTIFY means that if the server is ever scaled to multiple instances,
each instance's rooms stay in sync via the database notification channel.

Bidirectional ephemeral messages (`ping`, `measurement`) are not currently implemented.
See @docs/EPHEMERAL_WS.md.

---

## Auth: Zitadel OIDC

Wall & Shadow acts as an OIDC Relying Party. Zitadel issues JWTs; the server validates
them on every request via JWKS (`was-web/server/src/auth/oidc.ts`). The server creates or
looks up a `users` row on first login.

**Account types**:

| Type              | New signups (prod)? | Notes                                                          |
| ----------------- | ------------------- | -------------------------------------------------------------- |
| Email/password    | No                  | Legacy accounts only; password reset via admin endpoint        |
| Google (federated)| Yes, via Zitadel    | Google federation configured in Zitadel, not in the app        |
| Passkey           | Yes — future default| Users can link when ready; no forced migration                 |

In local dev (`import.meta.env.DEV`), the login page shows both the email/password form and
the OIDC button so E2E tests and local experimentation work without a Zitadel round-trip.

---

## Database Schema

Source of truth: `was-web/server/src/db/schema.ts`. Top-level tables:

```
users               — OIDC provider_sub + cached email/name/level
adventures          — owned by a user
adventure_players   — (adventure_id, user_id) — ON DELETE CASCADE from adventures
maps                — ON DELETE CASCADE from adventures
map_changes         — JSONB chs[] array — ON DELETE CASCADE from maps
                      incremental=false row is the consolidated base state
images              — ON DELETE CASCADE from users
spritesheets        — ON DELETE CASCADE from adventures
invites             — ON DELETE CASCADE from adventures
app_config          — key/value store (e.g. version info)
```

`ON DELETE CASCADE` handles recursive cleanup: deleting an adventure removes all maps,
players, changes, spritesheets, and invites automatically.

---

## Deployment

### Production (systemd + Docker)

The VPS is provisioned by Ansible (`ansible/playbook.yml`): installs Docker, renders a
systemd unit per environment from `ansible/templates/wallandshadow.service.j2`.

Each unit runs `docker run --network host --env-file /etc/wallandshadow/<env>.env`
and reads its image tag from `/etc/wallandshadow/<env>.image` via `EnvironmentFile`.

Deploy is a three-line shell operation over SSH:

```bash
printf 'IMAGE=%s\n' "$NEW_IMAGE" > /etc/wallandshadow/<env>.image
systemctl restart wallandshadow-<env>.service
systemctl is-active --quiet wallandshadow-<env>.service
```

Caddy and PostgreSQL run natively on the VPS (managed by Ansible), not as containers.

### CI Pipeline

```
on: push to main / pull_request

jobs:
  ci:           lint · test:unit · test:server (against real PostgreSQL + MinIO)
  ci-server:    server lint · tsc · test
  build:        multi-arch image (amd64 + arm64) → ghcr.io/OWNER/wallandshadow:SHA
  deploy:       SSH → flip image tag → systemctl restart  (push to main only)
```

### Hosting (Hetzner Cloud)

| Resource               | Spec            | Cost (approx.)    |
| ---------------------- | --------------- | ----------------- |
| VPS (CPX21)            | 3 vCPU, 4GB RAM | ~€7-8/month       |
| Hetzner Object Storage | 1TB included    | ~€5-7/month       |
| **Total**              |                 | **~€12-15/month** |

Data centres: Nuremberg / Falkenstein (Germany), Helsinki (Finland). All EU, GDPR-native.

If PostgreSQL self-management becomes a burden: **Scaleway Managed PostgreSQL** (~€7/month)
is the easiest upgrade — French, EU-only, data centres in Paris/Amsterdam/Warsaw.

---

## Open Questions

- **Managed PostgreSQL**: Self-manage on VPS vs Scaleway managed — current leaning: self-manage.
- **Ephemeral WebSocket messages**: should we build `ping` / `measurement`? See @docs/EPHEMERAL_WS.md.
- **Analytics**: which tool, and is it worth it at current traffic? See @docs/ANALYTICS.md.
- **Phase 6 (future)**: rewrite the Hono server in Rust (Axum/Actix). API contract and PostgreSQL schema stay identical; swap the binary.
