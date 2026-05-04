import type { WebSocket } from 'ws';
import type { PresenceUserState } from '@wallandshadow/shared';
import type { RoomManager } from './rooms.js';
import { getSocketSubs, getSocketUid } from './socketState.js';

// How long a user's presence entry lingers after their last socket has closed.
// During this window other connected users see them as "seen recently"; once
// it expires the entry is removed and other users see them as gone (the UI
// falls back to the database player list with no presence indicator).
//
// Mutable to allow tests to shorten the window. Exported as a constant getter
// so callers always read the current value rather than capturing the default.
let PRESENCE_IDLE_TTL_MS_VALUE = 5 * 60 * 1000;

export function getPresenceIdleTtlMs(): number {
  return PRESENCE_IDLE_TTL_MS_VALUE;
}

export function setPresenceIdleTtlMsForTesting(ms: number): void {
  PRESENCE_IDLE_TTL_MS_VALUE = ms;
}

interface AdventureEphemeralState {
  users: Map<string, PresenceUserState>;        // userId → state
  removalTimers: Map<string, NodeJS.Timeout>;   // userId → pending TTL timer
  // Future: scribbles?: Map<scribbleId, ScribbleState>; etc.
}

const adventures = new Map<string, AdventureEphemeralState>();

function getOrCreate(adventureId: string): AdventureEphemeralState {
  let state = adventures.get(adventureId);
  if (!state) {
    state = { users: new Map(), removalTimers: new Map() };
    adventures.set(adventureId, state);
  }
  return state;
}

function snapshotUsers(state: AdventureEphemeralState): PresenceUserState[] {
  return [...state.users.values()];
}

/** Test probe: true iff the registry has any state for the adventure.
 *  Used to assert the room is GC'd once everyone has TTL'd out. */
export function hasAdventureState(adventureId: string): boolean {
  return adventures.has(adventureId);
}

/** Drop all in-memory presence state. Test-only. */
export function resetPresenceForTesting(): void {
  for (const state of adventures.values()) {
    for (const timer of state.removalTimers.values()) clearTimeout(timer);
  }
  adventures.clear();
}

// Walk the room and count this user's open presence subscriptions, optionally
// excluding one socket. Cheap at our scale (small rooms, small subs lists);
// avoids a parallel counter we'd have to keep in sync with the WeakMap.
function countUserPresenceSockets(
  adventureRooms: RoomManager,
  uid: string,
  adventureId: string,
  exclude: WebSocket | null,
): number {
  let count = 0;
  adventureRooms.forEachInRoom(adventureId, ws => {
    if (ws === exclude) return;
    if (getSocketUid(ws) !== uid) return;
    const subs = getSocketSubs(ws);
    if (!subs) return;
    for (const sub of subs.values()) {
      if (sub.scope === 'presence' && sub.entityKey === adventureId) {
        count++;
        return;  // count once per socket
      }
    }
  });
  return count;
}

function broadcastPresence(
  adventureRooms: RoomManager,
  adventureId: string,
  users: PresenceUserState[],
  exclude: WebSocket | null,
): void {
  const frame = JSON.stringify({
    type: 'roomUpdate',
    scope: 'presence',
    key: adventureId,
    data: users,
  });
  adventureRooms.forEachInRoom(adventureId, ws => {
    if (ws === exclude) return;
    const subs = getSocketSubs(ws);
    if (!subs) return;
    for (const sub of subs.values()) {
      if (sub.scope === 'presence' && sub.entityKey === adventureId) {
        ws.send(frame);
        return;
      }
    }
  });
}

/**
 * Called by the WS handler when a socket subscribes to `presence` for an
 * adventure. The handler must have already attached the subscription to the
 * socket's state and called `room.join` before invoking this — that way the
 * count walk includes this new socket.
 *
 * Returns the snapshot to ship back as the `subscribe` response. Also
 * broadcasts a `roomUpdate` to peers iff this represents a state change —
 * either the user is newly connected, or their `currentMapId` changed.
 */
export function onPresenceSubscribe(
  adventureRooms: RoomManager,
  ws: WebSocket,
  uid: string,
  adventureId: string,
  currentMapId: string | undefined,
): PresenceUserState[] {
  const state = getOrCreate(adventureId);

  // Reconnect within the TTL window — cancel pending removal.
  const pending = state.removalTimers.get(uid);
  if (pending) {
    clearTimeout(pending);
    state.removalTimers.delete(uid);
  }

  const previous = state.users.get(uid);
  const wasConnected = previous?.connected === true;
  const currentMapChanged = previous?.currentMapId !== currentMapId;
  state.users.set(uid, {
    userId: uid,
    lastSeen: Date.now(),
    connected: true,
    currentMapId,
  });

  const snapshot = snapshotUsers(state);
  // Broadcast on either transition: newly connected, or page change while
  // already connected (e.g. a second tab opens on a different map).
  if (!wasConnected || currentMapChanged) {
    broadcastPresence(adventureRooms, adventureId, snapshot, ws);
  }
  return snapshot;
}

/**
 * Called when a connected user changes which page they are viewing within an
 * adventure they are already subscribed to. Drops silently if the user has
 * no entry in the registry (defensive against races where the update arrives
 * after disconnect).
 */
export function onPresenceUpdate(
  adventureRooms: RoomManager,
  ws: WebSocket,
  uid: string,
  adventureId: string,
  currentMapId: string | undefined,
): void {
  const state = adventures.get(adventureId);
  if (!state) return;
  const existing = state.users.get(uid);
  if (!existing) return;
  if (existing.currentMapId === currentMapId) return;

  state.users.set(uid, { ...existing, currentMapId });
  broadcastPresence(adventureRooms, adventureId, snapshotUsers(state), ws);
}

/**
 * Called when a socket leaves a presence subscription, either via explicit
 * `unsubscribe` or socket close. Pass the leaving socket in so the count
 * walk can exclude it (callers may invoke this before or after the room
 * membership / subs map updates — exclusion makes the order irrelevant).
 *
 * If this was the user's last socket, flips the entry to disconnected,
 * schedules a TTL-based removal, and broadcasts.
 */
export function onPresenceUnsubscribe(
  adventureRooms: RoomManager,
  ws: WebSocket,
  uid: string,
  adventureId: string,
): void {
  const state = adventures.get(adventureId);
  if (!state) return;

  const remaining = countUserPresenceSockets(adventureRooms, uid, adventureId, ws);
  if (remaining > 0) return;  // user still has another tab open

  if (!state.users.has(uid)) return;

  state.users.set(uid, { userId: uid, lastSeen: Date.now(), connected: false });

  const ttl = PRESENCE_IDLE_TTL_MS_VALUE;
  const timer = setTimeout(() => {
    const current = adventures.get(adventureId);
    if (!current) return;
    current.removalTimers.delete(uid);
    current.users.delete(uid);
    if (current.users.size === 0 && current.removalTimers.size === 0) {
      adventures.delete(adventureId);
      return;
    }
    broadcastPresence(adventureRooms, adventureId, snapshotUsers(current), null);
  }, ttl);
  if (typeof timer.unref === 'function') timer.unref();
  state.removalTimers.set(uid, timer);

  broadcastPresence(adventureRooms, adventureId, snapshotUsers(state), ws);
}
