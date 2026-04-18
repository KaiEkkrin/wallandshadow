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
import type { Change, UpdateScope } from '@wallandshadow/shared';

const WS_PATH = '/ws';

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
};

interface ActiveSub {
  subId: number;
  scope: UpdateScope;
  key: string;
}

// Per-socket state: which uid, which subscriptions are currently active.
// `WeakMap` avoids attaching custom fields to the ws instance.
const socketState = new WeakMap<WebSocket, { uid: string; subs: Map<number, ActiveSub> }>();

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
        socket.destroy();
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
        socketState.set(ws, { uid, subs: new Map() });

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
}

type ClientFrame = SubscribeFrame | UnsubscribeFrame | MapChangeFrame;

async function handleMessage(ws: WebSocket, rooms: Rooms, data: RawData): Promise<void> {
  const state = socketState.get(ws);
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
  }
}

async function handleSubscribe(
  ws: WebSocket,
  state: { uid: string; subs: Map<number, ActiveSub> },
  rooms: Rooms,
  frame: SubscribeFrame,
): Promise<void> {
  // If the client re-uses a subId, unsubscribe the old binding first.
  if (state.subs.has(frame.subId)) {
    handleUnsubscribe(ws, state, rooms, { type: 'unsubscribe', subId: frame.subId });
  }

  try {
    const { key, data } = await resolveSubscribe(state.uid, frame);
    const manager = rooms[SCOPE_ROOMS[frame.scope]];
    manager.join(key, ws);
    state.subs.set(frame.subId, { subId: frame.subId, scope: frame.scope, key });

    sendIfOpen(ws, {
      type: 'snapshot',
      subId: frame.subId,
      scope: frame.scope,
      key,
      data,
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
  state: { uid: string; subs: Map<number, ActiveSub> },
  rooms: Rooms,
  frame: UnsubscribeFrame,
): void {
  const sub = state.subs.get(frame.subId);
  if (!sub) return;
  state.subs.delete(frame.subId);
  rooms[SCOPE_ROOMS[sub.scope]].leave(sub.key, ws);
}

async function handleMapChange(
  ws: WebSocket,
  state: { uid: string; subs: Map<number, ActiveSub> },
  frame: MapChangeFrame,
): Promise<void> {
  try {
    // addMapChanges performs its own membership + map lookup, so we don't
    // need to pre-validate. It inserts and fires NOTIFY, which feeds the
    // broadcast back to every subscribed socket in the room.
    const changeId = await addMapChanges(db, state.uid, frame.adventureId, frame.mapId, frame.chs);
    if (frame.ackId !== undefined) {
      sendIfOpen(ws, { type: 'mapChangeAck', ackId: frame.ackId, id: changeId });
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
): Promise<{ key: string; data: unknown }> {
  switch (frame.scope) {
    case 'adventures':
      return { key: uid, data: await snapshotAdventures(db, uid) };

    case 'profile': {
      const data = await snapshotProfile(db, uid);
      if (!data) throw new Error('User not found');
      return { key: uid, data };
    }

    case 'players': {
      const adventureId = requireId(frame);
      const [, data] = await Promise.all([
        assertAdventureMember(db, uid, adventureId),
        snapshotPlayers(db, adventureId),
      ]);
      return { key: adventureId, data };
    }

    case 'spritesheets': {
      const adventureId = requireId(frame);
      const [, data] = await Promise.all([
        assertAdventureMember(db, uid, adventureId),
        snapshotSpritesheets(db, adventureId),
      ]);
      return { key: adventureId, data };
    }

    case 'adventure': {
      const adventureId = requireId(frame);
      const [, data] = await Promise.all([
        assertAdventureMember(db, uid, adventureId),
        snapshotAdventureDetail(db, adventureId),
      ]);
      if (!data) throw new Error('Adventure not found');
      return { key: adventureId, data };
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
      // Room keyed by adventureId; client filters incoming updates by mapId.
      return { key: mapRow.adventureId, data: pair };
    }

    case 'mapChanges': {
      const mapId = requireId(frame);
      const [mapRow] = await db.select({ adventureId: maps.adventureId })
        .from(maps).where(eq(maps.id, mapId)).limit(1);
      if (!mapRow) throw new Error('Map not found');
      await assertAdventureMember(db, uid, mapRow.adventureId);
      return { key: mapId, data: await snapshotMapChanges(db, mapId) };
    }
  }
}

function requireId(frame: SubscribeFrame): string {
  if (!frame.id) throw new Error(`Missing id for scope ${frame.scope}`);
  return frame.id;
}

// ── Cleanup ─────────────────────────────────────────────────────────────────

function cleanupSocket(ws: WebSocket, rooms: Rooms): void {
  const state = socketState.get(ws);
  if (!state) return;
  for (const sub of state.subs.values()) {
    rooms[SCOPE_ROOMS[sub.scope]].leave(sub.key, ws);
  }
  state.subs.clear();
  socketState.delete(ws);
}

function sendIfOpen(ws: WebSocket, frame: unknown): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(frame));
  }
}
