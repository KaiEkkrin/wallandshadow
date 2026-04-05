# Client Migration: Wiring React SPA to Hono Server

Task breakdown for connecting the existing React client to the new Hono REST API,
replacing Firebase SDK usage. Auth uses the Phase 1 placeholder (email/password JWT);
OIDC comes later in Phase 2.

---

## Session 1: Foundation + Core CRUD

Goal: All non-map pages working against the Hono server. Map page shows metadata
(create, rename, delete) but no live editing. No WebSockets yet.

### 1. New service implementations (architectural layer)

- `IAuth` implementation backed by `POST /api/auth/register` and `POST /api/auth/login`,
  storing the JWT in memory/localStorage
- `IDataService` implementation backed by REST, with a one-shot `IDataView<T>` that
  fetches once on subscribe and exposes a refetch mechanism
- Wire into context providers, switchable from Firebase via environment flag or build config
- Reactivity strategy: one-shot fetch + refetch-after-mutation (no polling, no push).
  Acceptable because non-map pages don't need cross-user live updates.

### 2. Auth pages working

- Sign up, log in, log out
- Profile page (view/edit)
- Validates the token flow end-to-end before touching anything else

### 3. Adventure CRUD pages

- Home page showing adventure list
- Create adventure
- Adventure settings/edit (name, description, image path)
- Delete adventure

### 4. Player management + invites

- Invite creation (owner generates link)
- Join flow (invited user follows link)
- Player list within adventure
- Leave adventure

### 5. Map CRUD (metadata only)

- Map list within adventure
- Create map (hex/square)
- Rename, update description, toggle FFA
- Delete map
- Opening a map shows empty/loading state -- no live editing yet

### 6. Tests

- Adapt existing unit tests for the new service implementations
- Adapt E2E tests for auth, adventure CRUD, invite/join, map CRUD flows
- All running against the Hono server (dev container)

---

## Session 2: Map Interaction + WebSockets

Goal: Full map editing working with real-time collaboration. Images and spritesheets
functional.

### 1. WebSocket server

- `/ws/maps/:id` endpoint with room management
- Auth via token (query param or first message)
- Wire `change` messages to the existing `addChanges` service function
- Broadcast persisted changes to all room members
- PostgreSQL LISTEN/NOTIFY for multi-instance support

### 2. WebSocket client

- Replace Firestore `onSnapshot` change listener with WebSocket connection
- Receive base state + incremental changes over WS
- Handle reconnection and resync

### 3. Map change posting

- Wire `mapChangeTracker` to send changes over WebSocket
- Fall back to REST `POST .../changes` if needed
- Optimistic updates with rollback on conflict (preserve existing behaviour)

### 4. Ephemeral messages

- Pings ("look here" markers) -- forward only, no DB write
- Measurements (drag-to-measure lines) -- forward only, no DB write

### 5. Map page fully working

- Open map, see rendered state
- Place tokens, draw walls, edit features
- See other users' changes in real-time
- All map interaction modes functional

### 6. Image and spritesheet upload

- Image upload via `POST /api/images` (multipart to S3)
- Spritesheet creation via `POST /api/adventures/:id/spritesheets`
- Image display from S3 (presigned URLs or proxy)
- Token sprite rendering with uploaded images

### 7. Tests

- WebSocket integration tests (connect, send changes, receive broadcast)
- Map editing E2E tests against the new stack
- Image upload tests against MinIO
