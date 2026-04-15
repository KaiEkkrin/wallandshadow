# CLAUDE.md

Guidance for Claude Code when working with this repository.

## Project Overview

Wall & Shadow - Virtual tabletop (VTT) web app for running tabletop RPG sessions online. Real-time collaborative map editing, token management, game state sharing.

**Stack**: React + TypeScript + Firebase (legacy) + Three.js + Vite. Migrating to self-hosted: PostgreSQL + Hono + WebSockets + S3-compatible storage.

**Status**: Active replatforming from Firebase to self-hosted stack. See [Replatforming](#replatforming) and @docs/REPLATFORM.md.

## Directory Structure

```
was-web/
├── src/
│   ├── components/          # React components and UI
│   ├── data/                # TypeScript domain models
│   ├── models/              # Business logic, state machines, Three.js rendering
│   ├── services/            # Data access (legacy Firebase + new Hono implementations)
│   └── *.tsx                # Top-level pages (Home, Map, Adventure, Login)
├── server/                  # New Hono API server
│   ├── src/
│   │   ├── routes/          # Hono route handlers
│   │   ├── services/        # Business logic + storage
│   │   ├── db/              # Drizzle schema + migrations
│   │   ├── auth/            # Auth middleware (Phase 1: local JWT)
│   │   ├── ws/              # WebSocket handlers
│   │   └── errors.ts        # Structured API errors
│   └── drizzle/             # SQL migration files
├── packages/shared/         # @wallandshadow/shared - types + logic shared between web/server/functions
├── functions/               # Firebase Cloud Functions (legacy)
├── public/                  # Static assets
├── e2e/                     # Playwright tests
├── unit/                    # Vitest tests
├── landing-index.html       # Static landing page (root)
└── app.html                 # React SPA (all app routes)
```

Code shared between web, server, and functions lives in `packages/shared/` (Yarn workspace `@wallandshadow/shared`). Import from `@wallandshadow/shared` — do not use symlinks.

## Development Commands

All commands from `was-web/` directory.

### Start Development

You may assume the developer has already done this.

```bash
cd was-web

# Terminal 1: Firebase emulators
yarn dev:firebase

# Terminal 2: Vite dev server
yarn dev:vite
```

**Run separately** - restart app without restarting emulators.

**Ports**:

- Firebase Hosting emulator: http://localhost:3400 (recommended - includes landing page and routing)
- Vite dev server: http://localhost:5000 (hot reload)
- Firebase Emulator UI: http://localhost:4000

### Web Build & Lint

Ensures the code is ready for deployment.

```bash
yarn lint
yarn build              # Build to was-web/build/
```

### Firebase Functions Build & Lint

```bash
cd was-web/functions
yarn lint
yarn build              # Compile TypeScript to lib/
```

Changes to the Firebase Functions code will not be reflected in the running Functions Emulator until `yarn build` is run.

### Testing

```bash
yarn test:unit          # Vitest watch mode
yarn test:e2e           # Playwright (requires dev server)
```

See @DEPLOY.md for comprehensive deployment instructions.

## Code Standards

### React

- Functional components with hooks
- TypeScript strict mode
- Components in `src/components/`
- Page components as `*.tsx` in `src/`

### Data Access

- Use `IDataReference<T>` for typed document access
- Use `IDataView<T>` for reactive queries
- All access through `dataService.ts`
- Converters in `converter.ts` for Firestore serialization

### Map Changes

**CRITICAL**: All map changes through change tracking system.

- Use `mapChangeTracker.ts` methods
- **Never** write directly to Firestore for map data
- Direct writes break real-time sync

### Three.js

- Reuse geometry buffers
- Call `dispose()` on all objects when done
- Three.js leaks GPU memory if not disposed

## Code Quality

### Type Safety

- Avoid `any` and `as` casts. Prefer `unknown` + type guards when the type is uncertain.
- Use discriminated unions for exhaustive checking (`switch` with `never` default).
- Let TypeScript infer where it can; add explicit types at function boundaries and exports.

### Error Handling

- **All errors must be logged.** Error level if unrecoverable, Warning level if recoverable. Both client and server.
- **Surface failures, don't hide them.** A visible error leads to a bug report and a fix. A swallowed error hides bugs. Do not catch-and-ignore or silently retry.
- **Server**: Return structured error responses via `throwApiError()` (`server/src/errors.ts`). Log unexpected errors at Error level before returning 500.
- **Client**: Bubble API errors to the user (toast, error boundary, inline message). Log to console with context.

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

## Critical Gotchas

**Change Tracking**: All map changes must go through `mapChangeTracker.ts`. Direct Firestore writes break real-time sync.

**Three.js Memory**: Always dispose geometries, materials, textures. Three.js doesn't auto-collect.

**Firebase Admin Credentials**: Requires `was-web/firebase-admin-credentials.json` (gitignored). Get from Firebase Console → Project Settings → Service Accounts.

**Emulators**: All bind to `0.0.0.0` for Docker compatibility (see `firebase.json`).

See @docs/GOTCHAS.md for comprehensive troubleshooting.

## Architecture

### High-Level

React SPA with Firebase backend. Two hosting entry points:

- `landing-index.html` at `/` (static landing)
- `app.html` for app routes (`/app`, `/adventure/*`, `/map/*`, etc.)

Routing via Firebase Hosting rewrites in `firebase.json`.

### Firebase Collections

- `profiles/` - User profiles
- `adventures/` - Campaign containers
  - `adventures/{id}/players/` - Access control
  - `adventures/{id}/maps/` - Maps in adventure
    - `maps/{id}/changes/` - Real-time change tracking
- `images/` - User-uploaded images
- `spritesheets/` - Sprite collections
- `invites/` - Share links

### Context Hierarchy

```
FirebaseContextProvider
  └─ UserContextProvider
      └─ AnalyticsContextProvider
          └─ ProfileContextProvider
              └─ StatusContextProvider
                  └─ AdventureContextProvider
                      └─ MapContextProvider
```

### Real-Time Sync

- Base state: `maps/{id}/changes/base`
- Incremental changes: `maps/{id}/changes/{changeId}`
- `mapChangeTracker.ts` merges changes, handles conflicts
- Optimistic updates with rollback

### Grid System

- `MapType.Hex` - Hexagonal grid (pointy-top)
- `MapType.Square` - Square grid
- Abstract `IGridGeometry` interface
- Implementations: `hexGridGeometry.ts`, `squareGridGeometry.ts`

### Features vs Tokens

- **Features** (`data/feature.ts`) - Grid elements: walls, terrain, areas
- **Tokens** (`data/tokens.ts`) - Movable pieces: characters, monsters
- **Characters** (`data/character.ts`) - Player character definitions
- **Sprites** (`data/sprite.ts`) - Image-based token appearances

### Coordinates

Defined in `data/coord.ts`:

- `GridCoord` - Face (cell) coordinates
- `GridEdge` - Edge between faces (walls)
- `GridVertex` - Vertex where edges meet

See @docs/ARCHITECTURE.md for detailed architecture documentation.

## Replatforming

The project is migrating from Firebase to a self-hosted, containerised stack. Firebase remains live during migration. Full plan in @docs/REPLATFORM.md.

### New Stack

- **Database**: PostgreSQL 17 + Drizzle ORM
- **API server**: Hono (TypeScript) — `was-web/server/`
- **Real-time**: WebSockets + PostgreSQL LISTEN/NOTIFY
- **Object storage**: MinIO (dev) / Hetzner Object Storage (prod), S3-compatible
- **Auth**: External OIDC provider (Zitadel or Hanko, TBD); Phase 1 uses local JWT
- **Static serving**: Caddy (reverse proxy + auto-HTTPS)
- **Deployment**: systemd units running `docker run` on a Hetzner Cloud VPS; CI SSHes in to flip the image tag and restart the unit

### Server Development

Commands from `was-web/server/`:

```bash
yarn dev              # Start with hot reload (tsx watch), port 3000
yarn test             # Integration tests against real PostgreSQL
yarn lint             # Lint server code
yarn db:push          # Push schema to dev database
yarn db:push:test     # Push schema to test database
yarn db:generate      # Generate migration from schema changes
yarn db:migrate       # Run pending migrations
```

Temporary workarounds for incomplete phases are marked `// TODO Phase N:` in the code.

## Common Tasks

### Add Map Feature Type

1. Add interface to `data/feature.ts`
2. Implement rendering in `models/three/` (new `*FeatureObject.ts`)
3. Add UI in `components/MapControls.tsx`
4. Update `models/mapStateMachine.ts`
5. Add change tracking in `models/mapChangeTracker.ts`

### Add Firebase Function

1. Implement in `functions/src/index.ts` or separate file
2. Export from `functions/src/index.ts`
3. Add types to `data/` if needed (shared between web/functions)
4. Build: `(cd functions && yarn build)`
5. Test with `yarn dev:firebase`

### Debug Rendering

1. VS Code debugger: "Launch Chrome" (`.vscode/launch.json`)
2. Three.js helpers in `drawing.ts` (grid helpers, axes)
3. Browser console for WebGL errors
4. Firebase Emulator UI (http://localhost:4000) for Firestore data

See @docs/DEVELOPER_GUIDE.md for comprehensive development workflows.

## Security Rules

**Firestore** (`firestore.rules`):

- Adventures: Owner + invited players read/write
- Maps: Inherit adventure permissions
- Profiles: User reads/writes own only
- Images: User manages own only

**Storage** (`storage.rules`):

- User uploads to own path
- CORS config in `cors.json`

## Additional Documentation

- @DEPLOY.md - Deployment procedures and troubleshooting
- @docs/ARCHITECTURE.md - Detailed architecture, rendering pipeline, data layer
- @docs/DEVELOPER_GUIDE.md - Development workflows, testing, debugging
- @docs/GOTCHAS.md - Critical warnings and troubleshooting
- @docs/REPLATFORM.md - Replatforming plan: Firebase → self-hosted stack
- @docs/CLIENT_MIGRATION.md - Client wiring plan for Hono server
- @.devcontainer/README.md - Dev container setup
