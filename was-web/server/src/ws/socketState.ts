import type { WebSocket } from 'ws';
import type { UpdateScope } from '@wallandshadow/shared';

export interface ActiveSub {
  subId: number;
  scope: UpdateScope;
  // Room key — what `RoomManager` indexes by. For `map` this is adventureId
  // because map subs share the adventure room; for everything else it equals
  // `entityKey`.
  key: string;
  // The id the wire `key` field will carry on `roomUpdate` frames for this
  // subscription (mapId for `map`, adventureId for adventure/players/
  // spritesheets/mapChanges/presence, uid for adventures/profile).
  entityKey: string;
}

export interface SocketState {
  uid: string;
  subs: Map<number, ActiveSub>;
}

// Application-specific close code (kept in sync with handler.ts and the
// client-side honoWebSocket.ts).
const WS_CLOSE_ACCOUNT_SUSPENDED = 4003;

// Per-socket state: which uid, which subscriptions are currently active.
// `WeakMap` avoids attaching custom fields to the ws instance.
const socketState = new WeakMap<WebSocket, SocketState>();

// Per-uid open-socket index. Lets the ban service forcibly disconnect every
// open socket for a freshly-banned user. Maintained alongside socketState.
const userSockets = new Map<string, Set<WebSocket>>();

export function setSocketState(ws: WebSocket, uid: string): SocketState {
  const s: SocketState = { uid, subs: new Map() };
  socketState.set(ws, s);
  let set = userSockets.get(uid);
  if (!set) {
    set = new Set();
    userSockets.set(uid, set);
  }
  set.add(ws);
  return s;
}

export function getSocketState(ws: WebSocket): SocketState | undefined {
  return socketState.get(ws);
}

export function deleteSocketState(ws: WebSocket): void {
  const state = socketState.get(ws);
  if (state) {
    const set = userSockets.get(state.uid);
    if (set) {
      set.delete(ws);
      if (set.size === 0) userSockets.delete(state.uid);
    }
  }
  socketState.delete(ws);
}

export function getSocketSubs(ws: WebSocket): ReadonlyMap<number, ActiveSub> | undefined {
  return socketState.get(ws)?.subs;
}

export function getSocketUid(ws: WebSocket): string | undefined {
  return socketState.get(ws)?.uid;
}

// Force-close every open socket for a uid. Used by the ban service so a
// freshly-banned user is kicked off immediately instead of waiting for their
// next request to hit the 403 check in authMiddleware. The typed close code
// lets the client distinguish suspension from a network drop. We iterate a
// snapshot because ws.close() schedules the close event which calls
// cleanupSocket → deleteSocketState, mutating userSockets.
export function disconnectBannedUser(uid: string): void {
  const set = userSockets.get(uid);
  if (!set) return;
  for (const ws of Array.from(set)) {
    if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) {
      ws.close(WS_CLOSE_ACCOUNT_SUSPENDED, 'Account suspended');
    }
  }
}
