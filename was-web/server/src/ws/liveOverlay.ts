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
