# Ephemeral Overlay Backplane — Data Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared data layer for scribble (#331) and ruler (#115) — payload schemas plus an in-memory, map-keyed, per-author ephemeral WebSocket backplane — implemented and unit-tested, with no UI/rendering/input capture.

**Architecture:** A new `liveOverlay` WebSocket scope routes through the existing `mapRooms`. Clients send fire-and-forget `overlayUpdate` frames; the server stores the latest per-author item in an in-memory registry (modelled on `server/src/ws/presence.ts`), broadcasts it to other sockets subscribed to that map (exclude-sender), and owns expiry via per-kind timers. The backplane is payload-agnostic: it stores, forwards, and expires opaque items validated at the boundary. No PostgreSQL, no `LISTEN/NOTIFY`.

**Tech Stack:** TypeScript, Node.js, `ws`, Hono; Vitest 4 (server integration harness + new shared unit tests); Yarn workspaces (`@wallandshadow/shared`, `@wallandshadow/server`, `was-web` client).

**Spec:** `docs/superpowers/specs/2026-06-07-ephemeral-overlay-data-layer-design.md`

---

## File Structure

**New files:**
- `was-web/packages/shared/src/data/overlay.ts` — payload types, removal marker, caps, boundary validator.
- `was-web/packages/shared/src/data/overlay.test.ts` — validator unit tests.
- `was-web/packages/shared/vitest.config.ts` — Vitest config for the shared package (node env, no DB).
- `was-web/server/src/ws/liveOverlay.ts` — in-memory registry, broadcast, expiry timers, rate limiter.
- `was-web/server/src/__tests__/ws-liveOverlay.test.ts` — backplane integration tests via the real WS harness.

**Modified files:**
- `was-web/packages/shared/src/index.ts` — export the new `overlay` module.
- `was-web/packages/shared/package.json` — add a `test` script.
- `was-web/packages/shared/src/services/wsProtocol.ts` — add `'liveOverlay'` to `UpdateScope`.
- `was-web/packages/shared/src/services/liveData.ts` — add `sendOverlayUpdate` + `watchLiveOverlays` to `ILiveData`.
- `was-web/server/src/ws/handler.ts` — scope routing, subscribe resolution, snapshot hook, `overlayUpdate` frame + dispatch.
- `was-web/src/services/honoWebSocket.ts` — `overlayUpdate` outgoing frame type + `sendOverlayUpdate`.
- `was-web/src/services/honoLiveData.ts` — implement `sendOverlayUpdate` + `watchLiveOverlays` (reconciliation).
- `was-web/package.json` — add a `test:shared` script.
- `.github/workflows/ci.yml` — run the shared unit tests in CI.

**Responsibilities:** `overlay.ts` owns the wire schema + validation (single source of truth shared by client and server). `liveOverlay.ts` owns the in-memory lifecycle (storage, broadcast, expiry, rate limiting). `handler.ts` only wires frames to those two modules. The client files only send frames and reconcile incoming ones into an array.

---

## Conventions for every task

- All paths are absolute from the repo root `/workspaces/wallandshadow`.
- Server commands run from `was-web/server`. Client/shared commands run from `was-web`.
- Commit messages end with the trailer:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```
- We are already on branch `ephemeral-foundation-20260607`. Do not create a PR; commit sequentially on this branch.

---

## Task 1: Shared overlay payload types + caps

**Files:**
- Create: `was-web/packages/shared/src/data/overlay.ts`
- Modify: `was-web/packages/shared/src/index.ts`

- [ ] **Step 1: Create the types file**

Create `was-web/packages/shared/src/data/overlay.ts`:

```ts
import type { GridCoord } from './coord';

// Continuous, un-snapped coordinate for free-hand scribbles, in map/world space.
// Scribbles are NOT snapped to the grid (unlike rulers, which use GridCoord).
export interface PixelCoord {
  x: number;
  y: number;
}

export type OverlayKind = 'scribble' | 'ruler';
export type OverlayPhase = 'active' | 'released';

export interface ScribblePayload {
  kind: 'scribble';
  points: PixelCoord[];
}

export interface RulerPayload {
  kind: 'ruler';
  nodes: GridCoord[]; // committed turning points
  live?: GridCoord;   // cursor position during an active drag (absent once released)
}

// Discriminated by `kind`. The backplane never inspects this; only the boundary
// validator and the UI sessions interpret it.
export type OverlayPayload = ScribblePayload | RulerPayload;

// Sent by the client. The server stamps authorId + timestamps; they are never
// trusted from the wire (the validator strips any extra fields).
export interface OutgoingOverlayItem {
  itemId: string;        // client-generated (uuid); unique per item within an author
  payload: OverlayPayload;
  phase: OverlayPhase;
}

// Held in the server registry and broadcast to peers on the `liveOverlay` scope.
export interface OverlayItem extends OutgoingOverlayItem {
  authorId: string;      // filled from the authenticated socket
  updatedAt: number;     // server ms timestamp
  releasedAt?: number;   // set when phase flips to 'released'; clients fade from here
}

// Broadcast when an item expires, so peers converge deterministically.
export interface OverlayRemoval {
  removed: { authorId: string; itemId: string };
}

// Caps enforced at the server boundary; shared so the validator (and any future
// client-side guard) agree on the same limits.
export const MAX_SCRIBBLE_POINTS = 2000;
export const MAX_RULER_NODES = 64;
export const MAX_ITEM_ID_LENGTH = 64;
```

- [ ] **Step 2: Export the module**

In `was-web/packages/shared/src/index.ts`, add the export alongside the other `data/*` exports (after the `./data/map` line):

```ts
export * from './data/overlay';
```

- [ ] **Step 3: Type-check the shared package compiles via the client typecheck**

Run (from `was-web`):
```bash
yarn typecheck
```
Expected: PASS (no errors). This compiles the client, which imports `@wallandshadow/shared` from source, so a broken shared type would fail here.

- [ ] **Step 4: Commit**

```bash
git add was-web/packages/shared/src/data/overlay.ts was-web/packages/shared/src/index.ts
git commit -m "Add ephemeral overlay payload types and caps

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Shared overlay validator + Vitest setup + unit tests + CI

**Files:**
- Modify: `was-web/packages/shared/src/data/overlay.ts`
- Create: `was-web/packages/shared/src/data/overlay.test.ts`
- Create: `was-web/packages/shared/vitest.config.ts`
- Modify: `was-web/packages/shared/package.json`
- Modify: `was-web/package.json`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add the Vitest config for the shared package**

Create `was-web/packages/shared/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 2: Add a `test` script to the shared package**

In `was-web/packages/shared/package.json`, add a `scripts` block (the file currently has none). The full file becomes:

```json
{
  "name": "@wallandshadow/shared",
  "version": "1.0.6",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "test": "vitest run"
  }
}
```

(Vitest 4 is hoisted from the `was-web` workspace root, so no new dependency is required and `yarn.lock` is unchanged.)

- [ ] **Step 3: Add the `test:shared` script to the workspace root**

In `was-web/package.json`, add this line inside `scripts` immediately after the `"test:server": ...` line:

```json
    "test:shared": "yarn workspace @wallandshadow/shared test",
```

- [ ] **Step 4: Write the failing validator test**

Create `was-web/packages/shared/src/data/overlay.test.ts`:

```ts
import { describe, test, expect } from 'vitest';
import {
  validateOutgoingOverlayItem,
  MAX_SCRIBBLE_POINTS,
  MAX_RULER_NODES,
} from './overlay';

describe('validateOutgoingOverlayItem', () => {
  test('accepts a valid scribble and strips unknown fields', () => {
    const result = validateOutgoingOverlayItem({
      itemId: 'item-1',
      phase: 'active',
      authorId: 'spoofed',          // unknown field — must be stripped
      payload: { kind: 'scribble', points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] },
    });
    expect(result).toEqual({
      itemId: 'item-1',
      phase: 'active',
      payload: { kind: 'scribble', points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] },
    });
  });

  test('accepts a valid ruler with a live endpoint', () => {
    const result = validateOutgoingOverlayItem({
      itemId: 'r1',
      phase: 'active',
      payload: { kind: 'ruler', nodes: [{ x: 0, y: 0 }], live: { x: 5, y: 5 } },
    });
    expect(result).toEqual({
      itemId: 'r1',
      phase: 'active',
      payload: { kind: 'ruler', nodes: [{ x: 0, y: 0 }], live: { x: 5, y: 5 } },
    });
  });

  test('accepts a released ruler without a live endpoint', () => {
    const result = validateOutgoingOverlayItem({
      itemId: 'r2',
      phase: 'released',
      payload: { kind: 'ruler', nodes: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
    });
    expect(result?.payload).toEqual({ kind: 'ruler', nodes: [{ x: 0, y: 0 }, { x: 1, y: 1 }] });
  });

  test.each([
    ['non-object', 42],
    ['missing itemId', { phase: 'active', payload: { kind: 'scribble', points: [{ x: 0, y: 0 }] } }],
    ['empty itemId', { itemId: '', phase: 'active', payload: { kind: 'scribble', points: [{ x: 0, y: 0 }] } }],
    ['bad phase', { itemId: 'a', phase: 'paused', payload: { kind: 'scribble', points: [{ x: 0, y: 0 }] } }],
    ['unknown kind', { itemId: 'a', phase: 'active', payload: { kind: 'arrow', points: [] } }],
    ['empty scribble', { itemId: 'a', phase: 'active', payload: { kind: 'scribble', points: [] } }],
    ['non-finite coord', { itemId: 'a', phase: 'active', payload: { kind: 'scribble', points: [{ x: Infinity, y: 0 }] } }],
    ['NaN coord', { itemId: 'a', phase: 'active', payload: { kind: 'scribble', points: [{ x: NaN, y: 0 }] } }],
    ['ruler missing nodes', { itemId: 'a', phase: 'active', payload: { kind: 'ruler' } }],
    ['ruler bad live', { itemId: 'a', phase: 'active', payload: { kind: 'ruler', nodes: [{ x: 0, y: 0 }], live: { x: 'z', y: 0 } } }],
  ])('rejects %s', (_label, input) => {
    expect(validateOutgoingOverlayItem(input)).toBeNull();
  });

  test('rejects an over-length scribble', () => {
    const points = Array.from({ length: MAX_SCRIBBLE_POINTS + 1 }, (_, i) => ({ x: i, y: i }));
    expect(validateOutgoingOverlayItem({
      itemId: 'a', phase: 'active', payload: { kind: 'scribble', points },
    })).toBeNull();
  });

  test('rejects an over-length ruler', () => {
    const nodes = Array.from({ length: MAX_RULER_NODES + 1 }, (_, i) => ({ x: i, y: i }));
    expect(validateOutgoingOverlayItem({
      itemId: 'a', phase: 'active', payload: { kind: 'ruler', nodes },
    })).toBeNull();
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run (from `was-web`):
```bash
yarn test:shared
```
Expected: FAIL — `validateOutgoingOverlayItem` is not exported / not a function.

- [ ] **Step 6: Implement the validator**

Append to `was-web/packages/shared/src/data/overlay.ts`:

```ts
// ── Boundary validation ─────────────────────────────────────────────────────
// Re-constructs a clean object from untrusted input: strips unknown fields,
// rejects malformed shapes, and enforces the caps above. Returns null on any
// problem (callers drop the frame). Never throws.

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function asCoord(v: unknown): { x: number; y: number } | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (!isFiniteNumber(o.x) || !isFiniteNumber(o.y)) return null;
  return { x: o.x, y: o.y };
}

function asCoordArray(v: unknown, max: number): { x: number; y: number }[] | null {
  if (!Array.isArray(v)) return null;
  if (v.length === 0 || v.length > max) return null;
  const out: { x: number; y: number }[] = [];
  for (const item of v) {
    const c = asCoord(item);
    if (!c) return null;
    out.push(c);
  }
  return out;
}

function validatePayload(v: unknown): OverlayPayload | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (o.kind === 'scribble') {
    const points = asCoordArray(o.points, MAX_SCRIBBLE_POINTS);
    if (!points) return null;
    return { kind: 'scribble', points };
  }
  if (o.kind === 'ruler') {
    const nodes = asCoordArray(o.nodes, MAX_RULER_NODES);
    if (!nodes) return null;
    if (o.live === undefined) return { kind: 'ruler', nodes };
    const live = asCoord(o.live);
    if (!live) return null;
    return { kind: 'ruler', nodes, live };
  }
  return null;
}

export function validateOutgoingOverlayItem(v: unknown): OutgoingOverlayItem | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.itemId !== 'string' || o.itemId.length === 0 || o.itemId.length > MAX_ITEM_ID_LENGTH) {
    return null;
  }
  if (o.phase !== 'active' && o.phase !== 'released') return null;
  const payload = validatePayload(o.payload);
  if (!payload) return null;
  return { itemId: o.itemId, phase: o.phase, payload };
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run (from `was-web`):
```bash
yarn test:shared
```
Expected: PASS (all cases green).

- [ ] **Step 8: Lint**

Run (from `was-web`):
```bash
yarn lint
```
Expected: PASS (lint covers `packages/shared/src`).

- [ ] **Step 9: Wire the shared tests into CI**

In `.github/workflows/ci.yml`, add a step immediately after the existing `Unit tests` step (keep identical indentation):

```yaml
      - name: Shared unit tests
        working-directory: was-web
        run: yarn test:shared
```

- [ ] **Step 10: Commit**

```bash
git add was-web/packages/shared/src/data/overlay.ts was-web/packages/shared/src/data/overlay.test.ts was-web/packages/shared/vitest.config.ts was-web/packages/shared/package.json was-web/package.json .github/workflows/ci.yml
git commit -m "Add overlay payload validator with shared Vitest setup and CI step

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Add the `liveOverlay` scope + `ILiveData` signatures

**Files:**
- Modify: `was-web/packages/shared/src/services/wsProtocol.ts`
- Modify: `was-web/packages/shared/src/services/liveData.ts`

- [ ] **Step 1: Add the scope to the wire protocol**

In `was-web/packages/shared/src/services/wsProtocol.ts`, add `'liveOverlay'` to the `UpdateScope` union (after `'presence'`):

```ts
export type UpdateScope =
  | 'adventures'
  | 'players'
  | 'spritesheets'
  | 'mapChanges'
  | 'profile'
  | 'adventure'
  | 'map'
  | 'presence'
  | 'liveOverlay';
```

- [ ] **Step 2: Add the methods to `ILiveData`**

In `was-web/packages/shared/src/services/liveData.ts`:

First add the import (after the `presence` import line near the top):

```ts
import { OutgoingOverlayItem, OverlayItem } from '../data/overlay';
```

Then add these two methods to the `ILiveData` interface, immediately after the `sendMapChange` declaration:

```ts
  // Send a fire-and-forget ephemeral overlay item (scribble/ruler) over the WS.
  // Not acked; dropped if the socket is down. The server stamps authorId.
  sendOverlayUpdate(mapId: string, item: OutgoingOverlayItem): void;

  // Subscribe to ephemeral overlay items for a map. `onNext` receives the full
  // current set, reconciled client-side from snapshot + update + removal frames.
  watchLiveOverlays(
    mapId: string,
    onNext: (items: OverlayItem[]) => void,
    onError?: (error: Error) => void,
  ): () => void;
```

- [ ] **Step 3: Verify the shared package still type-checks**

Run (from `was-web`):
```bash
yarn typecheck
```
Expected: FAIL — `HonoLiveData` does not yet implement the two new `ILiveData` members. This is expected; Task 7 implements them. Note the error mentions `sendOverlayUpdate` / `watchLiveOverlays` missing on `HonoLiveData`.

> If you are running tasks with a strict "must compile" gate between every task, implement Task 7 (client) immediately after this step and commit them together. Otherwise proceed — the server tasks (4–6) don't depend on the client and the tree returns to green at Task 7.

- [ ] **Step 4: Commit**

```bash
git add was-web/packages/shared/src/services/wsProtocol.ts was-web/packages/shared/src/services/liveData.ts
git commit -m "Add liveOverlay scope and ILiveData overlay methods

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Server backplane core + handler wiring (vertical slice)

This task delivers a working subscribe → update → broadcast path, testable end-to-end via the WS harness. Timers/expiry come in Task 5; validation hardening in Task 6.

**Files:**
- Create: `was-web/server/src/ws/liveOverlay.ts`
- Modify: `was-web/server/src/ws/handler.ts`
- Create: `was-web/server/src/__tests__/ws-liveOverlay.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `was-web/server/src/__tests__/ws-liveOverlay.test.ts`:

```ts
import { describe, test, expect, afterAll, beforeAll, beforeEach } from 'vitest';
import { createServer, type Server } from 'http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { OverlayItem } from '@wallandshadow/shared';
import { createApp } from '../app.js';
import { RoomManager, type Rooms } from '../ws/rooms.js';
import { createUpgradeHandler } from '../ws/handler.js';
import { resetLiveOverlayForTesting, hasMapOverlayState } from '../ws/liveOverlay.js';
import { registerUser } from './helpers.js';
import {
  connectWs,
  send,
  waitForFrame,
  noFrameWithin,
  createAdventure,
  createMap,
  joinAdventure,
} from './wsTestHelpers.js';

const app = createApp();

let server: Server;
let wss: WebSocketServer;
let rooms: Rooms;
let port: number;

beforeAll(async () => {
  rooms = {
    mapRooms: new RoomManager(),
    adventureRooms: new RoomManager(),
    userRooms: new RoomManager(),
  };
  wss = new WebSocketServer({ noServer: true });

  server = createServer(async (req, res) => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === 'string') headers[k] = v;
    }
    const bodyChunks: Uint8Array[] = [];
    await new Promise<void>((resolve) => {
      req.on('data', (c: Uint8Array) => bodyChunks.push(c));
      req.on('end', () => resolve());
    });
    const bodyBuffer = Buffer.concat(bodyChunks);
    const request = new Request(`http://localhost${req.url}`, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method ?? '') ? undefined : new Uint8Array(bodyBuffer),
    });
    const response = await app.fetch(request);
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    const resBody = await response.arrayBuffer();
    res.end(Buffer.from(resBody));
  });

  server.on('upgrade', createUpgradeHandler(wss, rooms));

  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      const addr = server.address();
      port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve();
    });
  });
});

afterAll(async () => {
  wss.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  resetLiveOverlayForTesting();
});

// ── Helpers ─────────────────────────────────────────────────────────────────

async function subscribeOverlay(ws: WebSocket, mapId: string, subId = 1): Promise<OverlayItem[]> {
  send(ws, { type: 'subscribe', subId, scope: 'liveOverlay', id: mapId });
  const snap = await waitForFrame(
    ws,
    f => f.type === 'snapshot' && f.subId === subId && f.scope === 'liveOverlay',
  );
  return snap.data as OverlayItem[];
}

function scribble(itemId: string, phase: 'active' | 'released' = 'active') {
  return { itemId, phase, payload: { kind: 'scribble', points: [{ x: 1, y: 2 }] } };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('liveOverlay core', () => {
  test('subscribe returns an empty snapshot for a fresh map', async () => {
    const owner = await registerUser(app, 'OverlaySelf');
    const aId = await createAdventure(app, owner.token);
    const mId = await createMap(app, owner.token, aId);

    const ws = await connectWs(port, owner.token);
    const snap = await subscribeOverlay(ws, mId);
    expect(snap).toEqual([]);
    ws.close();
  });

  test('non-member cannot subscribe', async () => {
    const owner = await registerUser(app, 'OverlayOwner');
    const outsider = await registerUser(app, 'OverlayOutsider');
    const aId = await createAdventure(app, owner.token);
    const mId = await createMap(app, owner.token, aId);

    const ws = await connectWs(port, outsider.token);
    send(ws, { type: 'subscribe', subId: 1, scope: 'liveOverlay', id: mId });
    const err = await waitForFrame(ws, f => f.type === 'subscribeError' && f.subId === 1);
    expect(err.message).toMatch(/Map not found|not a member|Adventure/i);
    ws.close();
  });

  test('an update broadcasts to a peer but not back to the sender', async () => {
    const owner = await registerUser(app, 'OverlayA');
    const peer = await registerUser(app, 'OverlayB');
    const aId = await createAdventure(app, owner.token);
    const mId = await createMap(app, owner.token, aId);
    await joinAdventure(app, owner.token, peer.token, aId);

    const ownerWs = await connectWs(port, owner.token);
    const peerWs = await connectWs(port, peer.token);
    await subscribeOverlay(ownerWs, mId);
    await subscribeOverlay(peerWs, mId);

    // Peer should receive the item; sender should not get an echo.
    const peerGot = waitForFrame(
      peerWs,
      f => f.type === 'roomUpdate' && f.scope === 'liveOverlay',
    );
    const senderQuiet = noFrameWithin(
      ownerWs,
      f => f.type === 'roomUpdate' && f.scope === 'liveOverlay',
      300,
    );
    send(ownerWs, { type: 'overlayUpdate', mapId: mId, item: scribble('s1') });

    const got = await peerGot;
    expect(got.key).toBe(mId);
    const item = got.data as OverlayItem;
    expect(item.itemId).toBe('s1');
    expect(item.authorId).toBe(owner.uid);
    expect(await senderQuiet).toBe(true);

    ownerWs.close();
    peerWs.close();
  });

  test('authorId is taken from the socket, not the client payload', async () => {
    const owner = await registerUser(app, 'OverlaySpoofA');
    const peer = await registerUser(app, 'OverlaySpoofB');
    const aId = await createAdventure(app, owner.token);
    const mId = await createMap(app, owner.token, aId);
    await joinAdventure(app, owner.token, peer.token, aId);

    const ownerWs = await connectWs(port, owner.token);
    const peerWs = await connectWs(port, peer.token);
    await subscribeOverlay(ownerWs, mId);
    await subscribeOverlay(peerWs, mId);

    const peerGot = waitForFrame(peerWs, f => f.type === 'roomUpdate' && f.scope === 'liveOverlay');
    // Sender tries to spoof a different authorId — must be ignored/stripped.
    send(ownerWs, { type: 'overlayUpdate', mapId: mId, item: { ...scribble('s2'), authorId: peer.uid } });
    const item = (await peerGot).data as OverlayItem;
    expect(item.authorId).toBe(owner.uid);

    ownerWs.close();
    peerWs.close();
  });

  test('items are isolated per map', async () => {
    const owner = await registerUser(app, 'OverlayMapIso');
    const aId = await createAdventure(app, owner.token);
    const mA = await createMap(app, owner.token, aId, 'Map A');
    const mB = await createMap(app, owner.token, aId, 'Map B');

    const senderWs = await connectWs(port, owner.token);
    const watcherWs = await connectWs(port, owner.token);
    await subscribeOverlay(senderWs, mA, 1);
    await subscribeOverlay(watcherWs, mB, 1);

    // Watcher is on map B; an update on map A must not reach it.
    const watcherQuiet = noFrameWithin(
      watcherWs,
      f => f.type === 'roomUpdate' && f.scope === 'liveOverlay',
      300,
    );
    send(senderWs, { type: 'overlayUpdate', mapId: mA, item: scribble('s3') });
    expect(await watcherQuiet).toBe(true);

    senderWs.close();
    watcherWs.close();
  });

  test('a late joiner gets a snapshot of an in-flight item', async () => {
    const owner = await registerUser(app, 'OverlayLateA');
    const late = await registerUser(app, 'OverlayLateB');
    const aId = await createAdventure(app, owner.token);
    const mId = await createMap(app, owner.token, aId);
    await joinAdventure(app, owner.token, late.token, aId);

    const ownerWs = await connectWs(port, owner.token);
    await subscribeOverlay(ownerWs, mId);
    send(ownerWs, { type: 'overlayUpdate', mapId: mId, item: scribble('s4') });
    // Give the server a moment to store it.
    await new Promise(r => setTimeout(r, 50));

    const lateWs = await connectWs(port, late.token);
    const snap = await subscribeOverlay(lateWs, mId);
    expect(snap.map(i => i.itemId)).toContain('s4');
    expect(hasMapOverlayState(mId)).toBe(true);

    ownerWs.close();
    lateWs.close();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `was-web/server`):
```bash
yarn test ws-liveOverlay
```
Expected: FAIL — `../ws/liveOverlay.js` cannot be resolved (module does not exist yet).

- [ ] **Step 3: Create the backplane module (core, no timers yet)**

Create `was-web/server/src/ws/liveOverlay.ts`:

```ts
import type { WebSocket } from 'ws';
import type { OutgoingOverlayItem, OverlayItem } from '@wallandshadow/shared';
import type { RoomManager } from './rooms.js';
import { getSocketSubs } from './socketState.js';

// Hard ceiling on concurrent items per author per map. "One active ruler per
// client" is a UI convention; this is the abuse backstop. Several scribbles can
// coexist (one fading while another is drawn), so this is > 1.
const MAX_ITEMS_PER_AUTHOR = 5;

interface MapOverlayState {
  items: Map<string, OverlayItem>;        // itemKey → item
  timers: Map<string, NodeJS.Timeout>;    // itemKey → pending expiry timer
}

const mapsState = new Map<string, MapOverlayState>();

function itemKey(authorId: string, itemId: string): string {
  return `${authorId}:${itemId}`;
}

function getOrCreate(mapId: string): MapOverlayState {
  let state = mapsState.get(mapId);
  if (!state) {
    state = { items: new Map(), timers: new Map() };
    mapsState.set(mapId, state);
  }
  return state;
}

/** Test probe: true iff the registry holds any state for the map. */
export function hasMapOverlayState(mapId: string): boolean {
  return mapsState.has(mapId);
}

/** Drop all in-memory overlay state and clear timers. Test-only. */
export function resetLiveOverlayForTesting(): void {
  for (const state of mapsState.values()) {
    for (const timer of state.timers.values()) clearTimeout(timer);
  }
  mapsState.clear();
}

// Broadcast a frame to every socket in the map room that holds a liveOverlay
// subscription for this map, excluding `exclude` (the author). mapRooms is keyed
// by mapId and is shared with mapChanges subscribers, so we must filter by scope.
function broadcastToMap(
  mapRooms: RoomManager,
  mapId: string,
  data: unknown,
  exclude: WebSocket | null,
): void {
  const frame = JSON.stringify({ type: 'roomUpdate', scope: 'liveOverlay', key: mapId, data });
  mapRooms.forEachInRoom(mapId, ws => {
    if (ws === exclude) return;
    const subs = getSocketSubs(ws);
    if (!subs) return;
    for (const sub of subs.values()) {
      if (sub.scope === 'liveOverlay' && sub.entityKey === mapId) {
        ws.send(frame);
        return;
      }
    }
  });
}

/** Snapshot of current items for a map, sent on subscribe (late-joiner catch-up). */
export function onLiveOverlaySubscribe(mapId: string): OverlayItem[] {
  const state = mapsState.get(mapId);
  return state ? [...state.items.values()] : [];
}

/**
 * Store/replace a per-author item and broadcast it to peers. authorId is the
 * authenticated socket's uid (never trusted from the wire). Drops silently if a
 * NEW item would exceed the per-author ceiling.
 */
export function applyOverlayUpdate(
  mapRooms: RoomManager,
  ws: WebSocket,
  authorId: string,
  mapId: string,
  outgoing: OutgoingOverlayItem,
): void {
  const state = getOrCreate(mapId);
  const key = itemKey(authorId, outgoing.itemId);
  const existing = state.items.get(key);

  if (!existing) {
    let authorCount = 0;
    for (const it of state.items.values()) {
      if (it.authorId === authorId) authorCount++;
    }
    if (authorCount >= MAX_ITEMS_PER_AUTHOR) return; // drop silently
  }

  const now = Date.now();
  const item: OverlayItem = {
    itemId: outgoing.itemId,
    payload: outgoing.payload,
    phase: outgoing.phase,
    authorId,
    updatedAt: now,
    releasedAt: outgoing.phase === 'released' ? now : undefined,
  };
  state.items.set(key, item);

  broadcastToMap(mapRooms, mapId, item, ws);
}
```

- [ ] **Step 4: Wire the scope routing in the handler**

In `was-web/server/src/ws/handler.ts`, add `liveOverlay` to `SCOPE_ROOMS` (after the `presence` entry):

```ts
  presence: 'adventureRooms',
  // Live overlays (scribbles, rulers) are map-scoped and ephemeral; they share
  // mapRooms with mapChanges and filter by scope on broadcast.
  liveOverlay: 'mapRooms',
```

- [ ] **Step 5: Add the imports**

In `was-web/server/src/ws/handler.ts`, update the presence import line and the shared import line:

Replace:
```ts
import { onPresenceSubscribe, onPresenceUnsubscribe, onPresenceUpdate } from './presence.js';
```
with:
```ts
import { onPresenceSubscribe, onPresenceUnsubscribe, onPresenceUpdate } from './presence.js';
import { onLiveOverlaySubscribe, applyOverlayUpdate } from './liveOverlay.js';
```

Replace:
```ts
import type { Change, UpdateScope } from '@wallandshadow/shared';
```
with:
```ts
import { validateOutgoingOverlayItem } from '@wallandshadow/shared';
import type { Change, UpdateScope } from '@wallandshadow/shared';
```

- [ ] **Step 6: Add the `overlayUpdate` frame type and dispatch**

In `was-web/server/src/ws/handler.ts`, add this interface after `PresenceUpdateFrame`:

```ts
interface OverlayUpdateFrame {
  type: 'overlayUpdate';
  mapId: string;
  item: unknown;  // validated via validateOutgoingOverlayItem before use
}
```

Update the `ClientFrame` union to include it:

```ts
type ClientFrame =
  | SubscribeFrame
  | UnsubscribeFrame
  | MapChangeFrame
  | PingFrame
  | PresenceUpdateFrame
  | OverlayUpdateFrame;
```

Add a dispatch case in the `switch (frame.type)` block (after the `presenceUpdate` case):

```ts
    case 'overlayUpdate':
      handleOverlayUpdate(ws, state, rooms, frame);
      return;
```

- [ ] **Step 7: Add the `handleOverlayUpdate` function**

In `was-web/server/src/ws/handler.ts`, add this function after `handlePresenceUpdate`:

```ts
function handleOverlayUpdate(
  ws: WebSocket,
  state: SocketState,
  rooms: Rooms,
  frame: OverlayUpdateFrame,
): void {
  if (typeof frame.mapId !== 'string') return;
  // The socket must already hold a liveOverlay subscription for this map —
  // that's where membership was authorized and the room joined.
  let subscribed = false;
  for (const sub of state.subs.values()) {
    if (sub.scope === 'liveOverlay' && sub.entityKey === frame.mapId) {
      subscribed = true;
      break;
    }
  }
  if (!subscribed) return;

  const item = validateOutgoingOverlayItem(frame.item);
  if (!item) {
    logger.logWarning('Dropping invalid overlayUpdate frame');
    return;
  }
  applyOverlayUpdate(rooms.mapRooms, ws, state.uid, frame.mapId, item);
}
```

- [ ] **Step 8: Resolve the subscribe + snapshot hook**

In `was-web/server/src/ws/handler.ts`, add a `liveOverlay` case to `resolveSubscribe` (after the `mapChanges` case, before `presence`):

```ts
    case 'liveOverlay': {
      // Map-scoped ephemeral overlays. Authorize membership here; the snapshot
      // is computed by handleSubscribe from the in-memory registry.
      const mapId = requireId(frame);
      const [mapRow] = await db.select({ adventureId: maps.adventureId })
        .from(maps).where(and(eq(maps.id, mapId), isNull(maps.deletedAt))).limit(1);
      if (!mapRow) throw new Error('Map not found');
      await assertAdventureMember(db, uid, mapRow.adventureId);
      return { key: mapId, entityKey: mapId, data: null };
    }
```

In `handleSubscribe`, extend the presence snapshot branch to also handle `liveOverlay`. Replace:

```ts
    let snapshotData: unknown = data;
    if (frame.scope === 'presence') {
      snapshotData = onPresenceSubscribe(
        rooms.adventureRooms, ws, state.uid, entityKey, frame.currentMapId,
      );
    }
```

with:

```ts
    let snapshotData: unknown = data;
    if (frame.scope === 'presence') {
      snapshotData = onPresenceSubscribe(
        rooms.adventureRooms, ws, state.uid, entityKey, frame.currentMapId,
      );
    } else if (frame.scope === 'liveOverlay') {
      snapshotData = onLiveOverlaySubscribe(entityKey);
    }
```

- [ ] **Step 9: Run the test to verify it passes**

Run (from `was-web/server`):
```bash
yarn test ws-liveOverlay
```
Expected: PASS (all 6 core tests green).

- [ ] **Step 10: Type-check and lint the server**

Run (from `was-web/server`):
```bash
yarn tsc --noEmit && yarn lint
```
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add was-web/server/src/ws/liveOverlay.ts was-web/server/src/ws/handler.ts was-web/server/src/__tests__/ws-liveOverlay.test.ts
git commit -m "Add liveOverlay backplane core: subscribe, snapshot, broadcast

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Lifecycle timers — staleness, fade, removal, continuation

**Files:**
- Modify: `was-web/server/src/ws/liveOverlay.ts`
- Modify: `was-web/server/src/__tests__/ws-liveOverlay.test.ts`

- [ ] **Step 1: Write the failing lifecycle tests**

In `was-web/server/src/__tests__/ws-liveOverlay.test.ts`, add to the imports from `../ws/liveOverlay.js`:

```ts
import {
  resetLiveOverlayForTesting,
  hasMapOverlayState,
  setOverlayTimingForTesting,
} from '../ws/liveOverlay.js';
```

(Replace the existing single-line import of those symbols with this block.)

Add a `ruler` helper next to the `scribble` helper:

```ts
function ruler(itemId: string, phase: 'active' | 'released' = 'active') {
  return { itemId, phase, payload: { kind: 'ruler', nodes: [{ x: 0, y: 0 }, { x: 1, y: 1 }] } };
}
```

Append this new describe block at the end of the file:

```ts
describe('liveOverlay lifecycle', () => {
  // Short, well-separated timings so tests are fast but unambiguous.
  beforeEach(() => {
    setOverlayTimingForTesting({ scribbleFadeMs: 400, rulerFadeMs: 150, activeStaleMs: 2000 });
  });

  test('a released item is removed after its fade timer and peers are told', async () => {
    const owner = await registerUser(app, 'OverlayFadeA');
    const peer = await registerUser(app, 'OverlayFadeB');
    const aId = await createAdventure(app, owner.token);
    const mId = await createMap(app, owner.token, aId);
    await joinAdventure(app, owner.token, peer.token, aId);

    const ownerWs = await connectWs(port, owner.token);
    const peerWs = await connectWs(port, peer.token);
    await subscribeOverlay(ownerWs, mId);
    await subscribeOverlay(peerWs, mId);

    // Release a ruler; expect a removal frame at the peer ~150ms later.
    const removal = waitForFrame(
      peerWs,
      f => f.type === 'roomUpdate' && f.scope === 'liveOverlay'
        && !!(f.data as { removed?: unknown }).removed,
    );
    send(ownerWs, { type: 'overlayUpdate', mapId: mId, item: ruler('r1', 'released') });
    const frame = await removal;
    const removed = (frame.data as { removed: { authorId: string; itemId: string } }).removed;
    expect(removed.itemId).toBe('r1');
    expect(removed.authorId).toBe(owner.uid);

    // The registry GC's the map once its last item expires.
    await new Promise(r => setTimeout(r, 50));
    expect(hasMapOverlayState(mId)).toBe(false);

    ownerWs.close();
    peerWs.close();
  });

  test('a re-grab within the fade window cancels removal (continuation)', async () => {
    const owner = await registerUser(app, 'OverlayContA');
    const peer = await registerUser(app, 'OverlayContB');
    const aId = await createAdventure(app, owner.token);
    const mId = await createMap(app, owner.token, aId);
    await joinAdventure(app, owner.token, peer.token, aId);

    const ownerWs = await connectWs(port, owner.token);
    const peerWs = await connectWs(port, peer.token);
    await subscribeOverlay(ownerWs, mId);
    await subscribeOverlay(peerWs, mId);

    // Release (arms 150ms ruler fade), then re-grab as 'active' before it fires.
    send(ownerWs, { type: 'overlayUpdate', mapId: mId, item: ruler('r2', 'released') });
    await new Promise(r => setTimeout(r, 60));
    send(ownerWs, { type: 'overlayUpdate', mapId: mId, item: ruler('r2', 'active') });

    // No removal should arrive within a window comfortably past the fade time
    // (active staleness is 2000ms, so the item stays alive).
    const noRemoval = noFrameWithin(
      peerWs,
      f => f.type === 'roomUpdate' && f.scope === 'liveOverlay'
        && !!(f.data as { removed?: unknown }).removed,
      400,
    );
    expect(await noRemoval).toBe(true);

    ownerWs.close();
    peerWs.close();
  });

  test('an active item expires after the staleness timeout', async () => {
    setOverlayTimingForTesting({ scribbleFadeMs: 400, rulerFadeMs: 150, activeStaleMs: 200 });

    const owner = await registerUser(app, 'OverlayStaleA');
    const peer = await registerUser(app, 'OverlayStaleB');
    const aId = await createAdventure(app, owner.token);
    const mId = await createMap(app, owner.token, aId);
    await joinAdventure(app, owner.token, peer.token, aId);

    const ownerWs = await connectWs(port, owner.token);
    const peerWs = await connectWs(port, peer.token);
    await subscribeOverlay(ownerWs, mId);
    await subscribeOverlay(peerWs, mId);

    const removal = waitForFrame(
      peerWs,
      f => f.type === 'roomUpdate' && f.scope === 'liveOverlay'
        && !!(f.data as { removed?: unknown }).removed,
      1000,
    );
    // Active scribble with no further updates — should expire ~200ms later.
    send(ownerWs, { type: 'overlayUpdate', mapId: mId, item: scribble('s5', 'active') });
    const removed = (await removal).data as { removed: { itemId: string } };
    expect(removed.removed.itemId).toBe('s5');

    ownerWs.close();
    peerWs.close();
  });
});
```

Also reset the timing back to production defaults so other describe blocks aren't affected. Add this `afterAll` inside the `liveOverlay lifecycle` describe block (after the tests):

```ts
  afterAll(() => {
    setOverlayTimingForTesting({ scribbleFadeMs: 10_000, rulerFadeMs: 1_000, activeStaleMs: 5_000 });
  });
```

- [ ] **Step 2: Run the lifecycle tests to verify they fail**

Run (from `was-web/server`):
```bash
yarn test ws-liveOverlay
```
Expected: FAIL — `setOverlayTimingForTesting` is not exported; released items are never removed.

- [ ] **Step 3: Implement timers in the backplane module**

In `was-web/server/src/ws/liveOverlay.ts`, add the timing constants and setter near the top (after `MAX_ITEMS_PER_AUTHOR`):

```ts
// Per-kind expiry policy. Mutable so tests can shorten them; read via the
// locals below so a test setter takes effect immediately.
let SCRIBBLE_FADE_MS = 10_000; // scribble lingers ~10s after release, then fades
let RULER_FADE_MS = 1_000;     // ruler fades ~1s after release
let ACTIVE_STALE_MS = 5_000;   // active item with no updates (author went away)

export function setOverlayTimingForTesting(opts: {
  scribbleFadeMs: number;
  rulerFadeMs: number;
  activeStaleMs: number;
}): void {
  SCRIBBLE_FADE_MS = opts.scribbleFadeMs;
  RULER_FADE_MS = opts.rulerFadeMs;
  ACTIVE_STALE_MS = opts.activeStaleMs;
}
```

Add the timer + expiry helpers (after `getOrCreate`):

```ts
function expiryMsFor(item: OverlayItem): number {
  if (item.phase === 'released') {
    return item.payload.kind === 'ruler' ? RULER_FADE_MS : SCRIBBLE_FADE_MS;
  }
  return ACTIVE_STALE_MS;
}

// (Re)arm the expiry timer for an item. Any previous timer for the same key is
// cleared first, so a continuation (a fresh 'active' update after 'released')
// cancels a pending fade.
function armTimer(mapRooms: RoomManager, mapId: string, key: string, item: OverlayItem): void {
  const state = mapsState.get(mapId);
  if (!state) return;
  const prev = state.timers.get(key);
  if (prev) clearTimeout(prev);
  const timer = setTimeout(() => expire(mapRooms, mapId, key), expiryMsFor(item));
  if (typeof timer.unref === 'function') timer.unref();
  state.timers.set(key, timer);
}

function expire(mapRooms: RoomManager, mapId: string, key: string): void {
  const state = mapsState.get(mapId);
  if (!state) return;
  const item = state.items.get(key);
  state.timers.delete(key);
  state.items.delete(key);
  if (state.items.size === 0 && state.timers.size === 0) {
    mapsState.delete(mapId);
  }
  if (item) {
    broadcastToMap(mapRooms, mapId, { removed: { authorId: item.authorId, itemId: item.itemId } }, null);
  }
}
```

In `applyOverlayUpdate`, arm the timer after storing the item. Add this line immediately after `state.items.set(key, item);` and before the `broadcastToMap(...)` call:

```ts
  armTimer(mapRooms, mapId, key, item);
```

- [ ] **Step 4: Run the lifecycle tests to verify they pass**

Run (from `was-web/server`):
```bash
yarn test ws-liveOverlay
```
Expected: PASS (core + lifecycle blocks green).

- [ ] **Step 5: Type-check and lint**

Run (from `was-web/server`):
```bash
yarn tsc --noEmit && yarn lint
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add was-web/server/src/ws/liveOverlay.ts was-web/server/src/__tests__/ws-liveOverlay.test.ts
git commit -m "Add liveOverlay lifecycle: per-kind fade, staleness, removal, continuation

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Boundary hardening — invalid frames, per-author cap, rate limit

**Files:**
- Modify: `was-web/server/src/ws/liveOverlay.ts`
- Modify: `was-web/server/src/ws/handler.ts`
- Modify: `was-web/server/src/__tests__/ws-liveOverlay.test.ts`

- [ ] **Step 1: Write the failing hardening tests**

In `was-web/server/src/__tests__/ws-liveOverlay.test.ts`, append this describe block at the end of the file:

```ts
describe('liveOverlay hardening', () => {
  test('a malformed item is dropped and the socket stays open', async () => {
    const owner = await registerUser(app, 'OverlayBadA');
    const peer = await registerUser(app, 'OverlayBadB');
    const aId = await createAdventure(app, owner.token);
    const mId = await createMap(app, owner.token, aId);
    await joinAdventure(app, owner.token, peer.token, aId);

    const ownerWs = await connectWs(port, owner.token);
    const peerWs = await connectWs(port, peer.token);
    await subscribeOverlay(ownerWs, mId);
    await subscribeOverlay(peerWs, mId);

    // Bad payload: unknown kind. Peer must see nothing for it.
    const peerQuiet = noFrameWithin(
      peerWs,
      f => f.type === 'roomUpdate' && f.scope === 'liveOverlay',
      250,
    );
    send(ownerWs, {
      type: 'overlayUpdate',
      mapId: mId,
      item: { itemId: 'bad', phase: 'active', payload: { kind: 'arrow', points: [] } },
    });
    expect(await peerQuiet).toBe(true);

    // Socket still works: a valid item afterwards is delivered.
    const peerGot = waitForFrame(peerWs, f => f.type === 'roomUpdate' && f.scope === 'liveOverlay');
    send(ownerWs, { type: 'overlayUpdate', mapId: mId, item: scribble('ok') });
    expect((await peerGot.then(f => f.data as OverlayItem)).itemId).toBe('ok');

    ownerWs.close();
    peerWs.close();
  });

  test('an overlayUpdate without a subscription is ignored', async () => {
    const owner = await registerUser(app, 'OverlayNoSubA');
    const peer = await registerUser(app, 'OverlayNoSubB');
    const aId = await createAdventure(app, owner.token);
    const mId = await createMap(app, owner.token, aId);
    await joinAdventure(app, owner.token, peer.token, aId);

    const ownerWs = await connectWs(port, owner.token);
    const peerWs = await connectWs(port, peer.token);
    await subscribeOverlay(peerWs, mId);
    // ownerWs deliberately does NOT subscribe.

    const peerQuiet = noFrameWithin(
      peerWs,
      f => f.type === 'roomUpdate' && f.scope === 'liveOverlay',
      250,
    );
    send(ownerWs, { type: 'overlayUpdate', mapId: mId, item: scribble('nope') });
    expect(await peerQuiet).toBe(true);

    ownerWs.close();
    peerWs.close();
  });

  test('per-author item cap drops excess new items', async () => {
    const owner = await registerUser(app, 'OverlayCapA');
    const peer = await registerUser(app, 'OverlayCapB');
    const aId = await createAdventure(app, owner.token);
    const mId = await createMap(app, owner.token, aId);
    await joinAdventure(app, owner.token, peer.token, aId);
    // Keep active items alive long enough to accumulate.
    setOverlayTimingForTesting({ scribbleFadeMs: 10_000, rulerFadeMs: 1_000, activeStaleMs: 10_000 });

    const ownerWs = await connectWs(port, owner.token);
    const peerWs = await connectWs(port, peer.token);
    await subscribeOverlay(ownerWs, mId);
    await subscribeOverlay(peerWs, mId);

    const seen = new Set<string>();
    const collect = (data: unknown) => {
      const d = data as OverlayItem;
      if (d.itemId) seen.add(d.itemId);
    };
    peerWs.on('message', (raw) => {
      const f = JSON.parse(raw.toString());
      if (f.type === 'roomUpdate' && f.scope === 'liveOverlay' && f.data?.itemId) collect(f.data);
    });

    // Send 6 distinct items; the cap is 5, so the 6th must be dropped.
    for (let i = 0; i < 6; i++) {
      send(ownerWs, { type: 'overlayUpdate', mapId: mId, item: scribble(`cap-${i}`) });
    }
    await new Promise(r => setTimeout(r, 300));
    expect(seen.size).toBe(5);
    expect(seen.has('cap-5')).toBe(false);

    setOverlayTimingForTesting({ scribbleFadeMs: 10_000, rulerFadeMs: 1_000, activeStaleMs: 5_000 });
    ownerWs.close();
    peerWs.close();
  });
});
```

- [ ] **Step 2: Run the hardening tests to verify status**

Run (from `was-web/server`):
```bash
yarn test ws-liveOverlay
```
Expected: The malformed-frame and no-subscription tests already PASS (Task 4 added validation + the subscription gate). The per-author cap test PASSES too (Task 4 added the cap). If all pass, this confirms the behaviour is covered; proceed to add the rate limiter, which has no integration test (it's unit-tested as a pure helper in Step 3–5). If any fail, fix the corresponding logic in `liveOverlay.ts` / `handler.ts` before continuing.

> Rationale: the cap and validation landed in Task 4 because they're part of `applyOverlayUpdate` / `handleOverlayUpdate`. These tests lock that behaviour in. The remaining hardening piece — rate limiting — is added now.

- [ ] **Step 3: Write the failing rate-limiter unit test**

Create `was-web/server/src/__tests__/overlayRateLimit.test.ts`:

```ts
import { describe, test, expect } from 'vitest';
import { consumeToken, type TokenBucket } from '../ws/liveOverlay.js';

describe('consumeToken (overlay rate limiter)', () => {
  test('allows up to capacity in a burst, then blocks', () => {
    const bucket: TokenBucket = { tokens: 3, last: 1000 };
    // No time passes between calls (same `now`).
    expect(consumeToken(bucket, 1000, 3, 3)).toBe(true);
    expect(consumeToken(bucket, 1000, 3, 3)).toBe(true);
    expect(consumeToken(bucket, 1000, 3, 3)).toBe(true);
    expect(consumeToken(bucket, 1000, 3, 3)).toBe(false); // bucket empty
  });

  test('refills over time up to capacity', () => {
    const bucket: TokenBucket = { tokens: 0, last: 1000 };
    // 1 second later at 3 tokens/sec refills to capacity (3), allowing one.
    expect(consumeToken(bucket, 2000, 3, 3)).toBe(true);
    expect(bucket.tokens).toBeCloseTo(2, 5);
  });

  test('does not exceed capacity on long idle', () => {
    const bucket: TokenBucket = { tokens: 0, last: 1000 };
    expect(consumeToken(bucket, 100000, 5, 3)).toBe(true);
    expect(bucket.tokens).toBeCloseTo(4, 5); // capped at 5, then minus 1
  });
});
```

- [ ] **Step 4: Run the rate-limiter test to verify it fails**

Run (from `was-web/server`):
```bash
yarn test overlayRateLimit
```
Expected: FAIL — `consumeToken` / `TokenBucket` are not exported.

- [ ] **Step 5: Implement the rate limiter and wire it in**

In `was-web/server/src/ws/liveOverlay.ts`, add the pure helper + per-socket bucket (after the timing setter):

```ts
// ── Rate limiting ───────────────────────────────────────────────────────────
// Token-bucket per socket. Pure `consumeToken` is unit-tested with injected
// timestamps; `allowOverlayFrame` applies it with the real clock.

export interface TokenBucket {
  tokens: number;
  last: number; // ms timestamp of the last refill
}

const RATE_CAPACITY = 60;       // burst allowance
const RATE_REFILL_PER_SEC = 60; // sustained frames/sec

export function consumeToken(
  bucket: TokenBucket,
  nowMs: number,
  capacity: number,
  refillPerSec: number,
): boolean {
  const elapsedSec = Math.max(0, (nowMs - bucket.last) / 1000);
  bucket.last = nowMs;
  bucket.tokens = Math.min(capacity, bucket.tokens + elapsedSec * refillPerSec);
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

const buckets = new WeakMap<WebSocket, TokenBucket>();

/** True iff this socket may send another overlay frame now. */
export function allowOverlayFrame(ws: WebSocket): boolean {
  let bucket = buckets.get(ws);
  if (!bucket) {
    bucket = { tokens: RATE_CAPACITY, last: Date.now() };
    buckets.set(ws, bucket);
  }
  return consumeToken(bucket, Date.now(), RATE_CAPACITY, RATE_REFILL_PER_SEC);
}
```

In `was-web/server/src/ws/handler.ts`, update the liveOverlay import to include `allowOverlayFrame`:

```ts
import { onLiveOverlaySubscribe, applyOverlayUpdate, allowOverlayFrame } from './liveOverlay.js';
```

In `handleOverlayUpdate`, add the rate-limit gate immediately after the subscription check (`if (!subscribed) return;`) and before validating the item:

```ts
  if (!allowOverlayFrame(ws)) return;
```

- [ ] **Step 6: Run all overlay tests to verify they pass**

Run (from `was-web/server`):
```bash
yarn test ws-liveOverlay && yarn test overlayRateLimit
```
Expected: PASS for both.

- [ ] **Step 7: Type-check and lint**

Run (from `was-web/server`):
```bash
yarn tsc --noEmit && yarn lint
```
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add was-web/server/src/ws/liveOverlay.ts was-web/server/src/ws/handler.ts was-web/server/src/__tests__/ws-liveOverlay.test.ts was-web/server/src/__tests__/overlayRateLimit.test.ts
git commit -m "Harden liveOverlay: lock in validation/cap behaviour, add rate limiting

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Client plumbing — send + subscribe (reconciliation)

**Files:**
- Modify: `was-web/src/services/honoWebSocket.ts`
- Modify: `was-web/src/services/honoLiveData.ts`

- [ ] **Step 1: Add the outgoing frame type + import in honoWebSocket**

In `was-web/src/services/honoWebSocket.ts`, update the top import to bring in the overlay type. Replace:

```ts
import { Change, UpdateScope, createChangesConverter } from '@wallandshadow/shared';
```
with:

```ts
import { Change, OutgoingOverlayItem, UpdateScope, createChangesConverter } from '@wallandshadow/shared';
```

Update the `OutgoingFrame` type to include the new frame type:

```ts
interface OutgoingFrame {
  type: 'subscribe' | 'unsubscribe' | 'mapChange' | 'ping' | 'presenceUpdate' | 'overlayUpdate';
  [key: string]: unknown;
}
```

- [ ] **Step 2: Add the `sendOverlayUpdate` method on HonoWebSocket**

In `was-web/src/services/honoWebSocket.ts`, add this method inside the `HonoWebSocket` class, immediately after `sendMapChange`:

```ts
  // Fire-and-forget ephemeral overlay update. Uses writeFrame (NOT sendFrame)
  // so it is dropped when the socket is down rather than queued — stale
  // scribbles/rulers should not be replayed on reconnect.
  sendOverlayUpdate(mapId: string, item: OutgoingOverlayItem): void {
    this.writeFrame({ type: 'overlayUpdate', mapId, item });
  }
```

- [ ] **Step 3: Add the overlay imports in honoLiveData**

In `was-web/src/services/honoLiveData.ts`, add `OutgoingOverlayItem`, `OverlayItem`, and `OverlayRemoval` to the existing type import from `@wallandshadow/shared` (insert alphabetically within the brace list):

```ts
import type {
  Change,
  Changes,
  IAdventure,
  IIdentified,
  ILiveData,
  IMap,
  IPlayer,
  IProfile,
  ISpritesheet,
  OutgoingOverlayItem,
  OverlayItem,
  OverlayRemoval,
  PresenceSubscription,
  PresenceUserState,
  UpdateScope,
} from '@wallandshadow/shared';
```

- [ ] **Step 4: Implement `sendOverlayUpdate` + `watchLiveOverlays` in honoLiveData**

In `was-web/src/services/honoLiveData.ts`, add these two methods immediately after the `sendMapChange` method:

```ts
  sendOverlayUpdate(mapId: string, item: OutgoingOverlayItem): void {
    try {
      this.getSocket().sendOverlayUpdate(mapId, item);
    } catch (e) {
      logError('sendOverlayUpdate failed', e);
    }
  }

  watchLiveOverlays(
    mapId: string,
    onNext: (items: OverlayItem[]) => void,
    onError?: (error: Error) => void,
  ): () => void {
    try {
      // Reconcile snapshot + update + removal frames into the current item set.
      // Keyed by authorId:itemId so multiple authors / items coexist.
      const items = new Map<string, OverlayItem>();
      const keyOf = (authorId: string, itemId: string) => `${authorId}:${itemId}`;
      const emit = () => onNext([...items.values()]);
      const handlers: SubscriptionHandlers = {
        onSnapshot: (data: unknown) => {
          items.clear();
          for (const it of data as OverlayItem[]) items.set(keyOf(it.authorId, it.itemId), it);
          emit();
        },
        onUpdate: (data: unknown) => {
          const d = data as OverlayItem | OverlayRemoval;
          if ('removed' in d) {
            items.delete(keyOf(d.removed.authorId, d.removed.itemId));
          } else {
            items.set(keyOf(d.authorId, d.itemId), d);
          }
          emit();
        },
        onError,
      };
      const sub = this.getSocket().subscribe('liveOverlay', mapId, handlers);
      return () => sub.unsubscribe();
    } catch (e) {
      logError('liveOverlay subscribe failed', e);
      onError?.(e instanceof Error ? e : new Error(String(e)));
      return () => {};
    }
  }
```

- [ ] **Step 5: Type-check and lint the client**

Run (from `was-web`):
```bash
yarn typecheck && yarn lint
```
Expected: PASS — `HonoLiveData` now satisfies `ILiveData` (the Task 3 gap is closed), and `honoWebSocket` compiles with the new frame type.

- [ ] **Step 6: Build the client to confirm the production bundle compiles**

Run (from `was-web`):
```bash
yarn build
```
Expected: PASS (tsc + vite build succeed).

- [ ] **Step 7: Commit**

```bash
git add was-web/src/services/honoWebSocket.ts was-web/src/services/honoLiveData.ts
git commit -m "Wire client liveOverlay send + subscribe reconciliation

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Shared unit tests**

Run (from `was-web`):
```bash
yarn test:shared
```
Expected: PASS.

- [ ] **Step 2: Server tests (full suite, real PostgreSQL + MinIO)**

Ensure PostgreSQL and MinIO are running (they auto-start in the devcontainer). Run (from `was-web/server`):
```bash
yarn test
```
Expected: PASS — including `ws-liveOverlay` and `overlayRateLimit`, and no regression in `ws-presence` / `ws`.

- [ ] **Step 3: Client build + lint + typecheck**

Run (from `was-web`):
```bash
yarn typecheck && yarn lint && yarn build
```
Expected: PASS.

- [ ] **Step 4: Server lint + typecheck**

Run (from `was-web/server`):
```bash
yarn tsc --noEmit && yarn lint
```
Expected: PASS.

- [ ] **Step 5: Confirm the branch is clean and review the log**

```bash
git status
git log --oneline -8
```
Expected: clean working tree; eight commits (Tasks 1–7) on `ephemeral-foundation-20260607`.

---

## Notes for the next sessions (out of scope here)

- **Session 2 (scribble UI):** a `Scribble` edit mode, pointer capture into `PixelCoord[]`, a Three.js transient overlay renderer with opacity fade from `releasedAt`, per-author colour derived from `authorId`, and the off-edge arrow indicator (#331).
- **Session 3 (ruler UI):** multi-segment construction (drag → release commits a node → re-grab continues), distance computation from `GridCoord` nodes, the ruler + label renderer (#115).
- Both consume `sendOverlayUpdate` / `watchLiveOverlays` from this layer; no backplane changes should be needed. Append-delta optimisation for long scribbles remains deferred unless profiling demands it.

---

## Self-Review (completed by plan author)

**Spec coverage:**
- New `liveOverlay` scope → Task 3. ✅
- Map-keyed registry module mirroring presence → Task 4. ✅
- Discriminated payload schemas (scribble pixel / ruler grid) → Task 1. ✅
- Replace-not-append semantics → Task 4 (`applyOverlayUpdate` replaces the stored item). ✅
- Lifecycle: active staleness, released per-kind fade, removal broadcast, continuation cancels timer → Task 5. ✅
- Snapshot-on-subscribe / late joiner → Task 4 (`onLiveOverlaySubscribe` + test). ✅
- Exclude-sender broadcast → Task 4 (`broadcastToMap`, test). ✅
- authorId stamped from socket, not trusted → Task 4 (test). ✅
- Boundary validation, per-author cap, malformed dropped + socket stays open, rate limit → Tasks 4 + 6. ✅
- Fire-and-forget unacked `sendOverlayUpdate` + `watchLiveOverlays` reconciliation → Task 7. ✅
- Shared Vitest setup + validator unit tests + CI wiring → Task 2. ✅

**Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step shows full code. ✅

**Type consistency:** `OverlayItem` / `OutgoingOverlayItem` / `OverlayRemoval` / `validateOutgoingOverlayItem` / `applyOverlayUpdate` / `onLiveOverlaySubscribe` / `setOverlayTimingForTesting` / `consumeToken` / `TokenBucket` / `allowOverlayFrame` / `resetLiveOverlayForTesting` / `hasMapOverlayState` are defined once and referenced with matching signatures across server and client tasks. Scope literal `'liveOverlay'` matches everywhere. ✅
