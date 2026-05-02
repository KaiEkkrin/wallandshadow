# Code Review: `gh-328-replace-rest-with-websockets`

## Overview

15 commits, +3,159/−531 lines. Replaces polling-based REST data fetching with a single multiplexed WebSocket connection per session. Adds 7 subscription scopes (`profile`, `adventure`, `adventures`, `map`, `players`, `spritesheets`, `mapChanges`), and moves map-change writes from `POST /api/.../changes` to a `mapChange` WS frame with ack/error semantics. Migration 0005 reshapes `map_changes` (`incremental` boolean → `seq` BIGINT IDENTITY + `is_base` + `idempotency_key`) to support delta-on-reconnect catch-up.

The architecture is well thought through: PostgreSQL LISTEN/NOTIFY drives broadcasts, room managers fan out by user/adventure/map, the `map` scope cleverly shares the adventure room so a single adventure-level NOTIFY reaches every map view in one DB hit. Client reconnect logic re-sends subscriptions and prunes stale frames. Test coverage of the new subscription paths is good (member/non-member, delta vs full reload, ack flow).

## Issues

### ~~High — `idempotencyKey` is wired server-side but never set by the client~~ ✅ Fixed

The schema (`map_changes.idempotency_key`), partial unique index, `addMapChanges()` dedup branch, and WS handler `MapChangeFrame.idempotencyKey` are all in place — but `HonoWebSocket.sendMapChange()` (`honoWebSocket.ts:126-132`) never generates one, and `mapStateMachine.addChanges` doesn't pass one through.

This breaks the resilience the schema is designed for:
1. Client sends `mapChange`, server processes it.
2. Connection drops before the ack arrives. `failPendingAcks()` rejects the promise (`honoWebSocket.ts:237-241`).
3. The encoded frame is still in `sendQueue` (only `subscribe`/`unsubscribe` get pruned — `pruneQueueForReconnect` at line 223 deliberately leaves `mapChange` frames in order).
4. On reconnect, the queued frame is re-sent → server writes the change a **second time** (no dedup key → no `onConflictDoNothing` hit).

Either generate a UUID in `sendMapChange` and pass it through to the server, or strip the support. There are no tests exercising the dedup branch in `extensions.ts:728-734` either.

**Resolution:** `sendMapChange()` now generates a UUIDv7 per call and embeds it in the frame; the key is in the encoded JSON so a queued-and-replayed frame carries the same key on reconnect, triggering the server's dedup branch. New test `ws.test.ts > mapChange with duplicate idempotencyKey is deduped server-side` covers `extensions.ts:728-734`.

### ~~Medium — `pruneQueueForReconnect` relies on JSON key order~~ ✅ Fixed

`honoWebSocket.ts:228-234` checks `frame.startsWith('{"type":"subscribe"')`. Modern engines do preserve insertion order for string keys, and `OutgoingFrame` puts `type` first, but a future refactor that constructs frames with a different key order (or adds a Babel/swc transform) would silently break dedup, creating mysterious duplicate-subscribe storms on reconnect. Cheap fix: parse, check `f.type`, re-stringify; or use a small typed wrapper around the queue.

**Resolution:** `sendQueue` is now `OutgoingFrame[]` instead of `string[]`; frames are stringified at send time and `pruneQueueForReconnect` checks `frame.type` directly. No JSON-shape dependency.

### ~~Low — Inconsistent NOTIFY failure logging~~ ✅ Fixed

`extensions.ts:498-500` (in `tryConsolidateMapChanges`) uses `console.error('NOTIFY failed:', e)` directly, whereas everywhere else in the file uses `notifySafe(...)` which routes through `logger.logError`. Switch to `notifySafe(notifyMapChange(mapId, notifyInfo.id, notifyInfo.seq))` for consistency, or wrap the NOTIFY there in a `notifySafe`.

**Resolution:** Now `await notifySafe(notifyMapChange(mapId, notifyInfo.id, notifyInfo.seq))`, matching the rest of the file.

### ~~Low — Adventure detail NOTIFY fan-out is O(maps × subscribers)~~ ✅ Fixed

`notify.ts:165-179` (`handleAdventureDetail`) sends `1 + N` frames per adventure-level change to every socket subscribed to the adventure room (the comment correctly notes this saves DB round-trips, but doesn't address WS sends). For an adventure with 50 maps and 6 connected players, a single rename triggers ~306 frames. Probably fine at current scale, but worth a comment acknowledging the network cost trade-off, or filter at the server by which mapIds each socket actually subscribed to.

**Resolution:** `ActiveSub` now tracks an `entityKey` (mapId for `map` subs, adventureId/uid otherwise), `RoomManager` exposes `forEachInRoom`, and `handleAdventureDetail` walks the room per-socket — sending the `adventure` frame only to sockets that subscribed to it and each `map` frame only to sockets watching that mapId. Fan-out is now proportional to interest (e.g. 50 maps × 6 sockets each watching one map drops from ~306 sends to ~12). New tests in `ws.test.ts > adventure-detail NOTIFY fan-out filtering` cover the regression-guard and both anti-spam cases. As a side benefit, `players`/`spritesheets`-only subscribers (which share the adventure room) no longer receive spurious adventure-detail frames.

### Low — Subscribe error messages are surfaced verbatim

`handler.ts:175-186` returns `e.message` straight to the client in `subscribeError`. Same posture as REST today (matches `throwApiError`), but worth confirming that no `assertAdventure*` helper paths produce internal-implementation messages that would leak through.

## Things done well

- **Auth failure handling**: Code 4001 close + `onAuthFailure` callback properly distinguishes "expired token" from "network blip" so the client redirects to login instead of looping retries with a dead token. `subscribeToTokenRenewal` keeps the in-memory token current for silent OIDC renewals.
- **Migration safety**: `0005_map_changes_schema.sql` is exemplary — add nullable, backfill in a deterministic order (`created_at, id`), set NOT NULL, attach identity, `setval` past max, then add the CHECK constraint *after* the `is_base` backfill so existing `(incremental=false, resync=true)` rows satisfy it.
- **Dispose plumbing**: `HonoContextProvider` now tears down the previous session's `HonoDataService` before installing a new one (`HonoContextProvider.tsx:25-58`), and on unmount — addresses a real leak from the prior structure.
- **Test bucket guard**: `setup.ts:21-28` refuses to run if `S3_BUCKET` doesn't end in `-test`. Good defense for `beforeEach` wipes.
- **`fetchAdventureMapPairs`**: nice O(1) DB round-trip pattern for adventure-level NOTIFY.
- **Service worker `unregister`** now uses `getRegistrations()` instead of `ready` — fixes the case where there is no active SW (`serviceWorker.ts:138-148`).
- **Vite `warmup` for `index.tsx`**: clean fix for the HMR full-reload race that left the loading banner stuck.

## Test coverage

`ws.test.ts` covers all 7 subscribe scopes with auth-positive and auth-negative cases, mapChanges delta-vs-full reload, mapChange ack flows, peer broadcast, and room cleanup on close/unsubscribe. Notable gaps:
- No test exercising the `idempotencyKey` dedup path on the server (`extensions.ts:728`).
- No test for the `pruneQueueForReconnect` branch in the client.
- No test that two tabs from the same user can subscribe to the same scope independently (worth confirming since `subId` is per-socket but `WeakMap<WebSocket, ...>` state would need to track each socket separately — looks correct from reading, but worth a regression test).

## Risk summary

The branch is a substantial refactor and the architecture holds together. ~~The main blocker before merge is the missing client-side `idempotencyKey` generation — the resilience guarantees the migration creates space for aren't actually delivered today, and a reconnect during a flush *will* duplicate writes.~~ Client-side `idempotencyKey` now fixed. Everything else is polish.
