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

// Per-socket state: which uid, which subscriptions are currently active.
// `WeakMap` avoids attaching custom fields to the ws instance.
const socketState = new WeakMap<WebSocket, SocketState>();

export function setSocketState(ws: WebSocket, uid: string): SocketState {
  const s: SocketState = { uid, subs: new Map() };
  socketState.set(ws, s);
  return s;
}

export function getSocketState(ws: WebSocket): SocketState | undefined {
  return socketState.get(ws);
}

export function deleteSocketState(ws: WebSocket): void {
  socketState.delete(ws);
}

export function getSocketSubs(ws: WebSocket): ReadonlyMap<number, ActiveSub> | undefined {
  return socketState.get(ws)?.subs;
}

export function getSocketUid(ws: WebSocket): string | undefined {
  return socketState.get(ws)?.uid;
}
