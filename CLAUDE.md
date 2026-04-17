# CLAUDE.md

Guidance for Claude Code when working with this repository.

## Project Overview

Wall & Shadow — virtual tabletop (VTT) web app for running tabletop RPG sessions online. Real-time collaborative map editing, token management, game state sharing.

**Stack**: React + TypeScript + Three.js + Vite on the client; Hono + PostgreSQL + Drizzle ORM on the server; MinIO (dev) / Hetzner Object Storage (prod) for images; Zitadel OIDC for auth. See @docs/REPLATFORM.md for the history of the Firebase → self-hosted migration.

The Firebase codebase lives on the `legacy-firebase` branch. `main` is Firebase-free.

## Directory Structure

```
was-web/
├── src/
│   ├── components/          # React components and UI
│   ├── data/                # TypeScript domain models
│   ├── models/              # Business logic, state machines, Three.js rendering
│   ├── services/            # Hono client services (honoApi, honoAuth, honoDataService, honoFunctions, honoStorage, honoWebSocket)
│   └── *.tsx                # Top-level pages (Home, Map, Adventure, Login, Invite, OidcCallback)
├── server/                  # Hono API server
│   ├── src/
│   │   ├── routes/          # Hono route handlers
│   │   ├── services/        # Business logic + storage
│   │   ├── db/              # Drizzle schema + migrations
│   │   ├── auth/            # JWT + OIDC + password verification middleware
│   │   ├── ws/              # WebSocket handlers + PostgreSQL LISTEN/NOTIFY
│   │   └── errors.ts        # Structured API errors
│   └── drizzle/             # SQL migration files
├── packages/shared/         # @wallandshadow/shared - types + logic shared between web and server
├── public/                  # Static assets
├── e2e/                     # Playwright tests
├── unit/                    # Vitest tests (client)
├── landing-index.html       # Static landing page (served by Caddy at /)
└── app.html                 # React SPA (all app routes)
```

Code shared between the web client and the Hono server lives in `packages/shared/` (Yarn workspace `@wallandshadow/shared`). Import from `@wallandshadow/shared` — do not use symlinks.

## Development Commands

All commands from `was-web/` directory unless otherwise noted. The devcontainer auto-starts PostgreSQL and MinIO.

### Start Development

```bash
cd was-web

# Terminal 1: Hono API server
cd server && yarn dev

# Terminal 2: Vite dev server
yarn dev:vite
```

Running them separately is recommended — you can restart either without restarting the other.

Open **http://localhost:5000** — the Vite dev server proxies `/api/*` to the Hono server at `localhost:3000` and the WebSocket connects directly to `localhost:3000`.

### Build & Lint

```bash
# Web client
yarn lint
yarn build              # output: was-web/build/

# Server
cd server
yarn lint
yarn build              # output: was-web/server/dist/
```

### Database schema

Drizzle schema is `was-web/server/src/db/schema.ts`. After changing it:

```bash
cd was-web/server
yarn db:push            # dev database
yarn db:push:test       # test database
```

`yarn db:generate` produces a migration SQL file from schema drift; `yarn db:migrate` runs pending migrations in production.

### Testing

```bash
yarn test:unit          # Vitest watch mode (client)
yarn test:server        # Server integration tests against real PostgreSQL + MinIO
yarn test:e2e           # Playwright (requires Hono + Vite dev server running)
```

See @README.md for comprehensive developer setup and Zitadel OIDC configuration.

## Code Standards

### React

- Functional components with hooks
- TypeScript strict mode
- Components in `src/components/`
- Page components as `*.tsx` in `src/`

### Data Access

- Use `IDataReference<T>` / `IDataView<T>` types from `@wallandshadow/shared`
- Web-side data access goes through `UserContext.dataService` (HonoDataService)
- Server-side data access goes through Drizzle in `server/src/`

### Map Changes

**CRITICAL**: All map changes must go through `mapChangeTracker.ts` on the client, which posts to `POST /api/adventures/:id/maps/:id/changes`. The server broadcasts persisted changes back to every WebSocket in the room via PostgreSQL LISTEN/NOTIFY. Direct writes (bypassing the change tracker) break real-time sync and conflict resolution.

### Three.js

- Reuse geometry buffers
- Call `dispose()` on all objects when done — Three.js leaks GPU memory if not disposed

## Code Quality

### Type Safety

- Avoid `any` and `as` casts. Prefer `unknown` + type guards when the type is uncertain.
- Use discriminated unions for exhaustive checking (`switch` with `never` default).
- Let TypeScript infer where it can; add explicit types at function boundaries and exports.

### Error Handling

- **All errors must be logged.** Error level if unrecoverable, Warning level if recoverable. Both client and server.
- **Surface failures, don't hide them.** A visible error leads to a bug report and a fix. A swallowed error hides bugs. Do not catch-and-ignore or silently retry.
- **Server**: Return structured error responses via `throwApiError()` (`server/src/errors.ts`). Log unexpected errors at Error level before returning 500.
- **Client**: Bubble API errors to the user (toast, error boundary, inline message). Log to console with context; `logError` from `src/services/consoleLogger.ts` is the standard helper.

### Hono / Server

- Validate all inputs at the route boundary. Do not trust client data past the handler.
- Keep route handlers thin: validate → call service → return response. Business logic in `server/src/services/`.
- Use typed middleware for auth context.

### React

- `useMemo` / `useCallback` only when there is a measured performance problem. Do not pre-optimise.
- Clean up effects: return cleanup functions from `useEffect`. Abort in-flight fetches on unmount.

### Testing

- Test behaviour, not implementation details. Assert on outputs and side effects.
- Server integration tests run against real PostgreSQL and MinIO — no mocks for data stores.
- Cover error paths: bad input returns the right status code, auth failures are rejected.
- **E2E tests**: Include terse step-by-step narrative comments (e.g. `// Open the edit modal and change the name`). Unlike application code, Playwright tests benefit from WHAT comments because selectors alone don't convey the user-facing intent of each step.

### General

- Keep functions small and focused. Extract when a function does two unrelated things.
- Prefer explicit over clever. Code is read far more than it is written.
- No dead code. Delete unused functions, commented-out blocks, and obsolete imports.

## Architecture

### High-Level

React SPA served by Caddy at `/app`, `/adventure/*`, `/map/*`, etc.; the static landing page at `/` is plain HTML. All persistent operations are mediated by the Hono server — clients do not write to PostgreSQL directly.

Caddy routes on the VPS:

- `/api/*` → Hono server (HTTP)
- `/ws/*`  → Hono server (WebSocket upgrade)
- everything else → static SPA build

### PostgreSQL Schema (high level)

Source of truth: `was-web/server/src/db/schema.ts`. Top-level tables: `users`, `adventures`, `adventure_players`, `maps`, `map_changes`, `images`, `spritesheets`, `invites`, `app_config`. `ON DELETE CASCADE` handles recursive cleanup for child rows when an adventure or map is deleted.

### Context Hierarchy

```
HonoContextProvider   (auth, dataService, functionsService, storageService, resolveImageUrl, signInMethods)
  └─ ProfileContextProvider
      └─ StatusContextProvider
          └─ Routing
              └─ AdventureContextProvider
                  └─ MapContextProvider
```

### Real-Time Sync

- The client POSTs change payloads to `POST /api/adventures/:id/maps/:id/changes`
- The server persists each change to `map_changes` and emits a PostgreSQL `NOTIFY`
- A `LISTEN` handler fans the notification out to every WebSocket in that map's room
- Clients reconcile incoming changes via `mapChangeTracker.ts`, which also handles optimistic updates and rollback

Ephemeral WebSocket messages (`ping`, `measurement`) are not currently implemented — see @docs/EPHEMERAL_WS.md.

### Grid System

- `MapType.Hex` — hexagonal grid (pointy-top)
- `MapType.Square` — square grid
- Abstract `IGridGeometry` interface
- Implementations: `hexGridGeometry.ts`, `squareGridGeometry.ts`

### Features vs Tokens

- **Features** (`data/feature.ts`) — grid elements: walls, terrain, areas
- **Tokens** (`data/tokens.ts`) — movable pieces: characters, monsters
- **Characters** (`data/character.ts`) — player character definitions
- **Sprites** (`data/sprite.ts`) — image-based token appearances

### Coordinates

Defined in `data/coord.ts`:

- `GridCoord` — face (cell) coordinates
- `GridEdge` — edge between faces (walls)
- `GridVertex` — vertex where edges meet

## Additional Documentation

- @README.md — developer setup, Zitadel OIDC config, deployment overview
- @docs/REPLATFORM.md — replatforming plan and status (Firebase → Hono/PostgreSQL/Hetzner)
- @docs/EPHEMERAL_WS.md — unimplemented ephemeral WebSocket message design
- @docs/ANALYTICS.md — future analytics options (Plausible / Umami / GoAccess)
- @docs/FIREBASE_REMOVAL.md — historical record of the Firebase removal effort
- @docs/LEGACY_FIREBASE_DEPLOY.md — applies only to the `legacy-firebase` branch
- @docs/INFRASTRUCTURE_BOOTSTRAP.md — first-time Hetzner VPS provisioning
- @docs/Medium_Term_Updates.md — pending dependency updates
- @.devcontainer/README.md — dev container setup
