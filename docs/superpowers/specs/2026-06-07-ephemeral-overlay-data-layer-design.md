# Ephemeral Overlay Backplane — Data Layer Design

**Date:** 2026-06-07
**Status:** Approved design, ready for implementation planning
**Issues:** [#331 Scribble mode](https://github.com/KaiEkkrin/wallandshadow/issues/331), [#115 Ruler](https://github.com/KaiEkkrin/wallandshadow/issues/115)
**Scope:** Session 1 of 3 — the shared **data layer** for both features. No UI.

## Sessions

This feature is split across three sessions because scribbles and rulers share a
backplane but have separate UIs:

1. **This session** — payload schemas for both features + the ephemeral overlay
   backplane (server in-memory registry, WebSocket frames, client `ILiveData`
   plumbing), implemented and unit-tested. **No rendering, no input capture.**
2. Scribble UI — edit mode, pointer capture, Three.js overlay rendering, fade,
   off-edge arrow indicator.
3. Ruler UI — edit mode, multi-segment construction, distance overlay, rendering.

## Background

Both features are **ephemeral, in-memory, per-author** signals broadcast between
players viewing the same map, never persisted to the database (issue #331:
"wholly in-memory"). They differ only in:

- **Coordinate type** — scribble uses continuous pixel coordinates; ruler uses
  grid/tile coordinates (`GridCoord`).
- **Rendering** — coloured free-hand line vs. multi-segment ruler + distance label
  (both deferred to the UI sessions).
- **Lifecycle timing** — scribble lingers ~10s then fades; ruler fades ~1s after
  release. Same mechanism, different per-kind constant.

The codebase already has the right precedent: `server/src/ws/presence.ts` is an
in-memory, in-process ephemeral registry (no DB, no `LISTEN/NOTIFY`) with
subscribe → update → broadcast-except-sender, TTL expiry, and
snapshot-on-subscribe. It even carries a placeholder comment anticipating
scribbles. This design generalises that pattern into a second tenant.

### Rejected alternatives

- **Single versioned JSON blob synced via JSON-PATCH + monotonic version
  check.** Serialises *all* writers through one global version counter. Under the
  target use case — multiple players scribbling/measuring simultaneously — every
  concurrent write loses its version race and triggers a full-blob refetch, which
  thrashes. Also implies conflict semantics that per-author items don't have
  (each item has exactly one author; nobody edits another's). Rejected in favour
  of independent **per-author streams**.
- **Persisting scribbles/rulers as map changes in the database.** Contradicts the
  issue ("wholly in-memory"); causes write amplification on the durable store,
  spurious `NOTIFY` fan-out, consolidation logic that must learn to ignore them,
  and couples ephemeral UX latency to a DB round-trip. Rejected.

## Architecture

Per-author ephemeral items live in an in-memory, map-keyed registry on the server.
Clients send fire-and-forget update frames over the existing multiplexed
WebSocket; the server stores the latest item state, broadcasts it to other sockets
subscribed to that map, and owns expiry. The backplane is **payload-agnostic**: it
stores, forwards, and expires opaque items; it never inspects scribble points or
ruler nodes.

```
Client A (drawing)
  │  ws.send({ type:'overlayUpdate', mapId, item })   ← fire-and-forget, no ack
  ▼
liveOverlay handler
  ├─ validate at boundary (kind whitelist, coord shape, length caps, rate limit)
  ├─ stamp authorId from the authenticated socket (never trust client)
  ├─ store/replace item in Map<mapId, …>, (re)arm expiry timer
  └─ mapRooms.forEachInRoom(mapId, …) → broadcast to every OTHER subscribed socket
        │
        ▼
   Clients B, C (viewing same map) receive 'roomUpdate' (scope 'liveOverlay')

  expiry timer fires → drop item + broadcast removal frame
```

No PostgreSQL, no `LISTEN/NOTIFY` — purely in-process, exactly like presence.
(`LISTEN/NOTIFY` would only matter under multi-instance scaling; out of scope, same
as presence today.)

## Component design

### 1. New subscription scope: `liveOverlay`

- Add the literal `'liveOverlay'` to the `UpdateScope` union in
  `packages/shared/src/services/wsProtocol.ts`.
- Add one entry to `SCOPE_ROOMS` in `server/src/ws/handler.ts` routing
  `liveOverlay` to **`mapRooms`** (keyed by `mapId`).

This is the one structural departure from presence, which is *adventure*-scoped
(`adventureRooms`). Scribbles and rulers are *map*-scoped — a player only sees them
on the map they are currently viewing — so they route through `mapRooms`, the same
room manager `mapChanges` already uses.

### 2. Payload schemas (`packages/shared`)

The backplane carries a discriminated union. The server stores it opaquely; only
the boundary validator and the UI sessions interpret it.

```ts
// Scribble: continuous, NOT snapped to the grid.
type PixelCoord = { x: number; y: number };

// Ruler: snapped to tile coordinates. GridCoord already exists in shared.
//   nodes = committed turning points; live = cursor position during an active drag.

type OverlayPayload =
  | { kind: 'scribble'; points: PixelCoord[] }
  | { kind: 'ruler'; nodes: GridCoord[]; live?: GridCoord };

type OverlayPhase = 'active' | 'released';

// Wire shape broadcast to peers and held in the registry.
type OverlayItem = {
  kind: 'scribble' | 'ruler';
  authorId: string;     // filled by the server from the socket identity; never trusted from the client
  itemId: string;       // client-generated (uuid); unique per item within an author
  payload: OverlayPayload;
  phase: OverlayPhase;
  updatedAt: number;    // server timestamp (ms)
  releasedAt?: number;  // set when phase → released; clients animate the fade from here
};

// Client → server. authorId is omitted (server stamps it); updatedAt/releasedAt are server-assigned.
type OutgoingOverlayItem = {
  kind: 'scribble' | 'ruler';
  itemId: string;
  payload: OverlayPayload;
  phase: OverlayPhase;
};
```

**Colour is deliberately NOT in the payload.** Issue #331 wants a distinct colour
per player; that is derived from `authorId` client-side in the UI sessions. Keeping
it out of the data layer keeps presentation out of the backplane.

The shared package will also export **type-guard / validator** functions for
`OutgoingOverlayItem` and its payloads, used by the server boundary and unit-tested
directly (see Testing).

### 3. Update semantics: **replace, not append**

Each update frame carries the item's *current full geometry* and replaces the
stored item wholesale. The deciding reason is generality, not just simplicity:
**replace keeps the backplane payload-agnostic.** Append would force the server to
understand scribble-point internals in order to merge them, which is exactly the
coupling that makes rulers a free addition. A long free-hand scribble re-sends a
growing point array on each throttled tick — acceptable at this scale. If profiling
ever shows it matters, append becomes a **scribble-only** optimisation; it is
explicitly out of scope here.

### 4. New module: `server/src/ws/liveOverlay.ts`

A sibling to `presence.ts`, mirroring its structure but keyed by map:

```ts
interface MapOverlayState {
  items: Map<string, OverlayItem>;          // itemKey → item
  expiryTimers: Map<string, NodeJS.Timeout>; // itemKey → pending timer
}
const maps = new Map<string, MapOverlayState>(); // mapId → state
```

- **Item identity:** `itemKey = `${authorId}:${itemId}``. Several items coexist
  naturally — an author's fading scribble alongside their next one, and every
  author's items side by side. "One active ruler per client" is a UI convention,
  not a server constraint (the server enforces only a hard per-author ceiling; see
  validation).
- **Broadcast:** reuse `mapRooms.forEachInRoom(mapId, …)` with the
  exclude-sender filter, identical to `broadcastPresence`.
- **Snapshot-on-subscribe:** on subscribe, send the current non-expired items for
  that map so a late joiner sees in-progress rulers and still-lingering scribbles.
- **Timer hygiene:** store timers in `expiryTimers`, call `timer.unref()` when
  available, and provide a `resetLiveOverlayForTesting()` that clears all timers
  and the registry — mirroring `resetPresenceForTesting`.

### 5. Lifecycle (single push-out-expiry timer)

The "still building" window and the "fade after release" window are the **same
timer**, read two ways:

- `phase: 'active'` updates (re)arm a **staleness timeout** — covers an author's
  client dying mid-drag.
- The client sends `phase: 'released'` on letting go. The server stamps
  `releasedAt` and arms the **per-kind fade timer**.
- **Ruler continuation:** a re-grab within the window arrives as a fresh `active`
  update on the *same* `itemId`, which cancels the fade timer and re-arms the
  staleness timeout. The multi-segment ruler (drag → release → re-drag adds a
  node) needs no special case — it is just repeated updates to one item.
- **Expiry:** when a fade/staleness timer fires, drop the item from the registry
  and broadcast a **removal** frame so peers converge deterministically. Clients
  additionally animate the *visual* fade locally from `releasedAt`: the server
  owns *existence*, clients own *pixels*.

Per-kind durations are module constants with `…ForTesting` setters, mirroring
`setPresenceIdleTtlMsForTesting`:

- `scribble`: lingers ~10s after release before expiry.
- `ruler`: fades ~1s after release.
- Active-phase staleness timeout: a few seconds without an update.

(Exact constants finalised during implementation; the design only fixes the
mechanism and that they are independently configurable.)

### 6. WebSocket frames

Client → server (inbound):

```ts
{ type: 'overlayUpdate', mapId: string, item: OutgoingOverlayItem }
```

Fire-and-forget — **no ack** (unlike `mapChange`). Dropped frames are acceptable
for transient signals.

Server → clients (outbound) reuse the existing envelope shapes:

- Snapshot on subscribe: `snapshot` frame, scope `liveOverlay`, `data: OverlayItem[]`.
- Live update: `roomUpdate` frame, scope `liveOverlay`, `data: OverlayItem`.
- Removal on expiry: `roomUpdate` frame, scope `liveOverlay`, carrying a removal
  marker, e.g. `data: { removed: { authorId, itemId } }`.

(The update/removal payload distinction is small; the exact discriminator is an
implementation detail. The receiving client merges/removes by `authorId:itemId`.)

Dispatch: add an `overlayUpdate` case to the frame switch in
`server/src/ws/handler.ts` calling into `liveOverlay.ts`. Subscribe/unsubscribe for
the `liveOverlay` scope flow through the existing generic subscribe path, with a
scope-specific snapshot hook (as presence does).

### 7. Boundary validation & limits

Per CLAUDE.md ("validate all inputs at the route boundary") and the
`EPHEMERAL_WS.md` guidance ("drop malformed silently; do not close the socket for
bad ephemerals"):

- Whitelist `kind`; reject unknown kinds.
- Shape-check coordinates (finite numbers); cap `points` length (scribble) and
  `nodes` length (ruler) to sane maxima.
- Enforce a hard **items-per-author-per-map ceiling** (e.g. 5) against abuse.
  ("One active ruler" is a client convention; this is the server backstop.)
- Per-socket **rate limit** (token bucket) on inbound `overlayUpdate` frames.
- Malformed or over-limit frames are **dropped and warn-logged; the socket stays
  open.**

### 8. Client data-layer API (`ILiveData`)

Plumbing only — no rendering, no input capture, no typed per-kind helpers (those
belong to the UI sessions). Mirror `watchPresence` / `sendMapChange` in
`packages/shared/src/services/liveData.ts` and implement in
`was-web/src/services/honoLiveData.ts` + `honoWebSocket.ts`:

```ts
// Fire-and-forget; no Promise/ack.
sendOverlayUpdate(mapId: string, item: OutgoingOverlayItem): void;

// Returns an unsubscribe function. onNext receives the current full item set,
// reconciled client-side from snapshot + roomUpdate + removal frames.
watchLiveOverlays(
  mapId: string,
  onNext: (items: OverlayItem[]) => void,
  onError?: (error: Error) => void,
): () => void;
```

The client maintains the reconciled item map for a subscription (apply snapshot,
upsert on update, delete on removal) and emits the array to `onNext`. Frames sent
while the socket is down are simply dropped (fire-and-forget); no resend queue is
required for ephemerals.

## Testing

### Server backplane — `server/src/__tests__/ws-liveOverlay.test.ts`

Use the existing real WebSocket harness (`wsTestHelpers.ts`,
`connectWs`/`send`/`waitForFrame`/`noFrameWithin`), in the style of
`ws-presence.test.ts`. No fake timers (the codebase doesn't use them); shorten
durations via the `…ForTesting` setters and use real short waits.

Cases:

- Update from one socket broadcasts to *other* subscribed sockets on the same map,
  and **not** back to the sender (exclude-sender).
- A late joiner gets a **snapshot** of current non-expired items on subscribe
  (in-progress ruler + lingering scribble).
- Items are isolated **per map** — a subscriber to map A receives nothing for map B.
- Lifecycle: `active` → `released` → fade timer fires → **removal** frame
  broadcast; item gone from later snapshots.
- **Continuation cancels the timer:** `released` then a fresh `active` on the same
  `itemId` keeps the item alive (no removal).
- Staleness: an `active` item with no further updates expires after the staleness
  timeout.
- `authorId` is taken from the socket, not the client (spoofed `authorId` ignored).
- Validation: unknown `kind`, malformed coords, over-length payloads, and
  per-author ceiling overflow are dropped, **the socket stays open**, and no
  broadcast occurs.
- Registry garbage-collects the map entry when its last item expires.

### Shared schemas — new test setup in `packages/shared`

`packages/shared` currently has no test runner. **Add a minimal vitest config and
`test` script** there, and unit-test the payload type-guards / validators directly:
valid scribble/ruler items accepted; each malformed variant (bad kind, non-finite
coord, missing fields, over-length) rejected. This satisfies the "schemas... unit
tested" requirement directly rather than only via the server.

### Client plumbing

Reconciliation logic (snapshot + update + removal → emitted array) covered through
the server WS harness end-to-end; a focused unit test of the reconciler is added if
it can be exercised in isolation without excessive harness setup.

## Out of scope (later sessions / future)

- All rendering and pointer/input capture (sessions 2 and 3).
- Per-author colour derivation (UI).
- Off-edge arrow indicator for scribbles drawn outside the viewport (issue #331,
  scribble UI session).
- Distance computation and label for rulers (ruler UI session).
- Append-delta optimisation for long scribbles (only if profiling demands it).
- Multi-instance fan-out (`NOTIFY`/pub-sub) for ephemerals — single-instance only,
  same as presence today.

## Integration touch points (grounded references)

| Artifact | Change |
| --- | --- |
| `packages/shared/src/services/wsProtocol.ts` | Add `'liveOverlay'` to `UpdateScope` |
| `packages/shared/src/data/` (new file) | `OverlayItem`/`OverlayPayload` types + validators |
| `packages/shared/src/services/liveData.ts` | Add `sendOverlayUpdate` + `watchLiveOverlays` to `ILiveData` |
| `server/src/ws/handler.ts` | `SCOPE_ROOMS['liveOverlay'] = 'mapRooms'`; `overlayUpdate` dispatch case; subscribe snapshot hook |
| `server/src/ws/liveOverlay.ts` (new) | The registry, broadcast, expiry, reset-for-testing |
| `server/src/ws/socketState.ts` | No change — `ActiveSub` is already generic |
| `server/src/ws/rooms.ts` | No change — generic room mechanics suffice |
| `was-web/src/services/honoLiveData.ts` + `honoWebSocket.ts` | Implement the two `ILiveData` methods + outbound frame + inbound reconciliation |
| `packages/shared/` build config | Add vitest config + `test` script |
| `server/src/__tests__/ws-liveOverlay.test.ts` (new) | Backplane tests via the WS harness |
| `packages/shared/.../__tests__` (new) | Schema/validator unit tests |
