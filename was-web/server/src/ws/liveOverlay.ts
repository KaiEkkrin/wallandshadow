import type { WebSocket } from 'ws';
import type { OutgoingOverlayItem, OverlayItem } from '@wallandshadow/shared';
import type { RoomManager } from './rooms.js';
import { getSocketSubs } from './socketState.js';

// Hard ceiling on concurrent items per author per map. "One active ruler per
// client" is a UI convention; this is the abuse backstop. Several scribbles can
// coexist (one fading while another is drawn), so this is > 1.
const MAX_ITEMS_PER_AUTHOR = 5;

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
  const now = Date.now();
  let bucket = buckets.get(ws);
  if (!bucket) {
    bucket = { tokens: RATE_CAPACITY, last: now };
    buckets.set(ws, bucket);
  }
  return consumeToken(bucket, now, RATE_CAPACITY, RATE_REFILL_PER_SEC);
}

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
  armTimer(mapRooms, mapId, key, item);

  broadcastToMap(mapRooms, mapId, item, ws);
}
