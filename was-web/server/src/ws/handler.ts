import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { resolveTokenToUid } from '../auth/resolveToken.js';
import { db } from '../db/connection.js';
import { maps } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { assertAdventureMember, addMapChanges } from '../services/extensions.js';
import { logger } from '../services/logger.js';
import type { Rooms } from './rooms.js';
import {
  snapshotAdventures,
  snapshotPlayers,
  snapshotSpritesheets,
  snapshotMapChanges,
  snapshotProfile,
  snapshotAdventureDetail,
  snapshotMap,
} from './subscriptions.js';
import {
  setSocketState,
  getSocketState,
  deleteSocketState,
  type SocketState,
} from './socketState.js';
import { onPresenceSubscribe, onPresenceUnsubscribe } from './presence.js';
import type { Change, UpdateScope } from '@wallandshadow/shared';

const WS_PATH = '/ws';
// Application-specific close code: token verification failed.
// Kept in sync with the client constant in honoWebSocket.ts.
const WS_CLOSE_AUTH_REJECTED = 4001;

// Which manager each scope lives in. `players` and `spritesheets` share the
// adventure rooms — they always concern the same adventureId, and messages
// are tagged with `scope` so the client routes them correctly.
const SCOPE_ROOMS: Record<UpdateScope, 'mapRooms' | 'adventureRooms' | 'userRooms'> = {
  adventures: 'userRooms',
  profile: 'userRooms',
  players: 'adventureRooms',
  spritesheets: 'adventureRooms',
  adventure: 'adventureRooms',
  // `map` subscriptions room by adventureId so a single adventure-level
  // NOTIFY can reach every map view in that adventure; the wire `key` is the
  // mapId and the client filters on it.
  map: 'adventureRooms',
  mapChanges: 'mapRooms',
  // Presence shares the adventure room — there's no separate room manager.
  // Filtering on subscribe/unsubscribe events is by ws's active subs.
  presence: 'adventureRooms',
};

export function createUpgradeHandler(wss: WebSocketServer, rooms: Rooms) {
  return async (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    try {
      const url = new URL(request.url ?? '', `http://${request.headers.host ?? 'localhost'}`);
      if (url.pathname !== WS_PATH) {
        socket.destroy();
        return;
      }

      const token = url.searchParams.get('token');
      if (!token) {
        socket.destroy();
        return;
      }

      let uid: string;
      try {
        uid = await resolveTokenToUid(token);
      } catch (e) {
        logger.logWarning('WebSocket auth rejected', e);
        // Complete the handshake so we can send a typed close code (4001).
        // A raw socket.destroy() would look identical to a network error on the
        // client, making auth failure indistinguishable from "server is down".
        wss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
          ws.close(WS_CLOSE_AUTH_REJECTED, 'Unauthorized');
        });
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
        setSocketState(ws, uid);

        ws.on('message', (data: RawData) => {
          handleMessage(ws, rooms, data).catch(e => {
            logger.logError('WS message handler failed', e);
          });
        });

        ws.on('close', () => cleanupSocket(ws, rooms));
        ws.on('error', () => cleanupSocket(ws, rooms));
      });
    } catch (e) {
      logger.logError('WebSocket upgrade error', e);
      socket.destroy();
    }
  };
}

// ── Incoming message dispatch ───────────────────────────────────────────────

interface SubscribeFrame {
  type: 'subscribe';
  subId: number;
  scope: UpdateScope;
  id?: string;
  lastSeq?: string;  // mapChanges scope only: last seq seen by client for catch-up
}
interface UnsubscribeFrame {
  type: 'unsubscribe';
  subId: number;
}
interface MapChangeFrame {
  type: 'mapChange';
  ackId?: number;
  adventureId: string;
  mapId: string;
  chs: Change[];
  idempotencyKey?: string;  // client-generated UUID for deduplication on reconnect
}
interface PingFrame {
  type: 'ping';
  id: number;
}

type ClientFrame = SubscribeFrame | UnsubscribeFrame | MapChangeFrame | PingFrame;

async function handleMessage(ws: WebSocket, rooms: Rooms, data: RawData): Promise<void> {
  const state = getSocketState(ws);
  if (!state) return;

  let frame: ClientFrame;
  try {
    frame = JSON.parse(data.toString()) as ClientFrame;
  } catch (e) {
    logger.logWarning('Dropping malformed WS frame', e);
    return;
  }

  switch (frame.type) {
    case 'subscribe':
      await handleSubscribe(ws, state, rooms, frame);
      return;
    case 'unsubscribe':
      handleUnsubscribe(ws, state, rooms, frame);
      return;
    case 'mapChange':
      await handleMapChange(ws, state, frame);
      return;
    case 'ping':
      sendIfOpen(ws, { type: 'pong', id: frame.id });
      return;
  }
}

async function handleSubscribe(
  ws: WebSocket,
  state: SocketState,
  rooms: Rooms,
  frame: SubscribeFrame,
): Promise<void> {
  // If the client re-uses a subId, unsubscribe the old binding first.
  if (state.subs.has(frame.subId)) {
    handleUnsubscribe(ws, state, rooms, { type: 'unsubscribe', subId: frame.subId });
  }

  try {
    const { key, entityKey, data } = await resolveSubscribe(state.uid, frame);
    const manager = rooms[SCOPE_ROOMS[frame.scope]];
    manager.join(key, ws);
    state.subs.set(frame.subId, { subId: frame.subId, scope: frame.scope, key, entityKey });

    // For presence the snapshot is computed *after* the room.join + subs map
    // update so the connection-count walk inside the registry can see this
    // socket. The data returned by resolveSubscribe for `presence` is a
    // marker; we replace it with the registry-computed snapshot here.
    let snapshotData: unknown = data;
    if (frame.scope === 'presence') {
      snapshotData = onPresenceSubscribe(rooms.adventureRooms, ws, state.uid, entityKey);
    }

    sendIfOpen(ws, {
      type: 'snapshot',
      subId: frame.subId,
      scope: frame.scope,
      key,
      data: snapshotData,
    });
  } catch (e) {
    if (!(e instanceof HTTPException)) {
      logger.logError(`subscribe(${frame.scope}) failed unexpectedly`, e);
    }
    const message = e instanceof Error ? e.message : String(e);
    sendIfOpen(ws, {
      type: 'subscribeError',
      subId: frame.subId,
      scope: frame.scope,
      message,
    });
  }
}

function handleUnsubscribe(
  ws: WebSocket,
  state: SocketState,
  rooms: Rooms,
  frame: UnsubscribeFrame,
): void {
  const sub = state.subs.get(frame.subId);
  if (!sub) return;
  state.subs.delete(frame.subId);
  rooms[SCOPE_ROOMS[sub.scope]].leave(sub.key, ws);
  if (sub.scope === 'presence') {
    onPresenceUnsubscribe(rooms.adventureRooms, ws, state.uid, sub.entityKey);
  }
}

async function handleMapChange(
  ws: WebSocket,
  state: SocketState,
  frame: MapChangeFrame,
): Promise<void> {
  try {
    // addMapChanges performs its own membership + map lookup, so we don't
    // need to pre-validate. It inserts and fires NOTIFY, which feeds the
    // broadcast back to every subscribed socket in the room.
    const { id, seq } = await addMapChanges(
      db, state.uid, frame.adventureId, frame.mapId, frame.chs, frame.idempotencyKey,
    );
    if (frame.ackId !== undefined) {
      sendIfOpen(ws, { type: 'mapChangeAck', ackId: frame.ackId, id, seq });
    }
  } catch (e) {
    if (!(e instanceof HTTPException)) {
      logger.logError('mapChange write failed unexpectedly', e);
    }
    const message = e instanceof Error ? e.message : String(e);
    if (frame.ackId !== undefined) {
      sendIfOpen(ws, { type: 'mapChangeAck', ackId: frame.ackId, error: message });
    }
  }
}

// ── Subscribe resolution ────────────────────────────────────────────────────

async function resolveSubscribe(
  uid: string,
  frame: SubscribeFrame,
): Promise<{ key: string; entityKey: string; data: unknown }> {
  switch (frame.scope) {
    case 'adventures':
      return { key: uid, entityKey: uid, data: await snapshotAdventures(db, uid) };

    case 'profile': {
      const data = await snapshotProfile(db, uid);
      if (!data) throw new Error('User not found');
      return { key: uid, entityKey: uid, data };
    }

    case 'players': {
      const adventureId = requireId(frame);
      const [, data] = await Promise.all([
        assertAdventureMember(db, uid, adventureId),
        snapshotPlayers(db, adventureId),
      ]);
      return { key: adventureId, entityKey: adventureId, data };
    }

    case 'spritesheets': {
      const adventureId = requireId(frame);
      const [, data] = await Promise.all([
        assertAdventureMember(db, uid, adventureId),
        snapshotSpritesheets(db, adventureId),
      ]);
      return { key: adventureId, entityKey: adventureId, data };
    }

    case 'adventure': {
      const adventureId = requireId(frame);
      const [, data] = await Promise.all([
        assertAdventureMember(db, uid, adventureId),
        snapshotAdventureDetail(db, adventureId),
      ]);
      if (!data) throw new Error('Adventure not found');
      return { key: adventureId, entityKey: adventureId, data };
    }

    case 'map': {
      const mapId = requireId(frame);
      const [mapRow] = await db.select({ adventureId: maps.adventureId })
        .from(maps).where(eq(maps.id, mapId)).limit(1);
      if (!mapRow) throw new Error('Map not found');
      const [, pair] = await Promise.all([
        assertAdventureMember(db, uid, mapRow.adventureId),
        snapshotMap(db, mapRow.adventureId, mapId),
      ]);
      if (!pair) throw new Error('Map not found');
      // Room keyed by adventureId so adventure-level NOTIFYs reach every map
      // view in one place; entityKey is the mapId so NOTIFY handlers and
      // client-side routing can filter updates back down to a specific map.
      return { key: mapRow.adventureId, entityKey: mapId, data: pair };
    }

    case 'mapChanges': {
      const mapId = requireId(frame);
      const [mapRow] = await db.select({ adventureId: maps.adventureId })
        .from(maps).where(eq(maps.id, mapId)).limit(1);
      if (!mapRow) throw new Error('Map not found');
      await assertAdventureMember(db, uid, mapRow.adventureId);
      return { key: mapId, entityKey: mapId, data: await snapshotMapChanges(db, mapId, frame.lastSeq) };
    }

    case 'presence': {
      // Presence is in-memory and ephemeral; we only need to authorize the
      // join here. The actual snapshot is computed by handleSubscribe after
      // the room.join + subs map update so the registry sees this socket.
      const adventureId = requireId(frame);
      await assertAdventureMember(db, uid, adventureId);
      return { key: adventureId, entityKey: adventureId, data: null };
    }
  }
}

function requireId(frame: SubscribeFrame): string {
  if (!frame.id) throw new Error(`Missing id for scope ${frame.scope}`);
  return frame.id;
}

// ── Cleanup ─────────────────────────────────────────────────────────────────

function cleanupSocket(ws: WebSocket, rooms: Rooms): void {
  const state = getSocketState(ws);
  if (!state) return;
  // Snapshot presence subs *before* we tear down the room membership so the
  // registry's exclude-this-socket count walk runs against the state that
  // existed at close time.
  const presenceSubs: { uid: string; adventureId: string }[] = [];
  for (const sub of state.subs.values()) {
    if (sub.scope === 'presence') {
      presenceSubs.push({ uid: state.uid, adventureId: sub.entityKey });
    }
    rooms[SCOPE_ROOMS[sub.scope]].leave(sub.key, ws);
  }
  state.subs.clear();
  deleteSocketState(ws);
  // Now signal presence drop with the leaving socket already excluded from
  // every relevant adventure room.
  for (const { uid, adventureId } of presenceSubs) {
    onPresenceUnsubscribe(rooms.adventureRooms, ws, uid, adventureId);
  }
}

function sendIfOpen(ws: WebSocket, frame: unknown): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(frame));
  }
}
