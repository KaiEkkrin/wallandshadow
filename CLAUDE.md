# CLAUDE.md

Guidance for Claude Code when working with this repository.

## Project Overview

Wall & Shadow - Virtual tabletop (VTT) web app for running tabletop RPG sessions online. Real-time collaborative map editing, token management, game state sharing.

**Stack**: React + TypeScript + Firebase (Firestore, Functions, Auth, Hosting, Storage) + Three.js + Vite

**Status**: Revived with modern toolchain (Node.js 20, React 18, Vite, Firebase v11)

## Directory Structure

```
was-web/
├── src/
│   ├── components/          # React components and UI
│   ├── data/                # TypeScript domain models
│   ├── models/              # Business logic, state machines, Three.js rendering
│   ├── services/            # Firebase integration, data access
│   └── *.tsx                # Top-level pages (Home, Map, Adventure, Login)
├── functions/               # Firebase Cloud Functions
├── public/                  # Static assets
├── e2e/                     # Playwright tests
├── unit/                    # Vitest tests
├── landing-index.html       # Static landing page (root)
└── app.html                 # React SPA (all app routes)
```

Where code files need to be shared between Functions and Web projects, symbolic links from inside the functions/ directory point to the real files in the src/ directory.

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

### General

- This project uses British English spellings where possible. For example, "colour", not "color".

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
- @.devcontainer/README.md - Dev container setup
