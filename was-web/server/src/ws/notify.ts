import pg from 'pg';
import type { UpdateScope } from '@wallandshadow/shared';
import { db, pool } from '../db/connection.js';
import { mapChanges } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { logger } from '../services/logger.js';
import type { RoomManager, Rooms } from './rooms.js';
import {
  snapshotAdventures,
  snapshotPlayers,
  snapshotSpritesheets,
} from './subscriptions.js';

// map_changes payload = `<mapId>:<changeId>` — the listener forwards the
// stored JSONB verbatim to preserve incremental-application semantics.
// The other three channels carry a single id; the listener re-queries the
// same snapshot the subscribe path uses.
const CH_MAP_CHANGES = 'map_changes';
const CH_ADVENTURES_USER = 'adventures_user';
const CH_ADVENTURE_PLAYERS = 'adventure_players';
const CH_ADVENTURE_SPRITESHEETS = 'adventure_spritesheets';

function encodeUpdate(scope: UpdateScope, key: string, data: unknown): string {
  return JSON.stringify({ type: 'roomUpdate', scope, key, data });
}

/**
 * Start a PostgreSQL LISTEN connection that fans NOTIFYs out to the right
 * WebSocket rooms. Listens on all four channels on a single client to avoid
 * holding multiple dedicated connections.
 */
export async function startNotifyListener(
  connectionString: string,
  rooms: Rooms,
): Promise<{ stop: () => Promise<void> }> {
  let client = new pg.Client({ connectionString });
  let stopped = false;

  async function onNotification(msg: pg.Notification) {
    if (!msg.payload) return;

    try {
      switch (msg.channel) {
        case CH_MAP_CHANGES:
          await handleMapChanges(msg.payload, rooms.mapRooms);
          return;
        case CH_ADVENTURES_USER:
          await handleAdventuresUser(msg.payload, rooms.userRooms);
          return;
        case CH_ADVENTURE_PLAYERS:
          await handleAdventurePlayers(msg.payload, rooms.adventureRooms);
          return;
        case CH_ADVENTURE_SPRITESHEETS:
          await handleAdventureSpritesheets(msg.payload, rooms.adventureRooms);
          return;
      }
    } catch (e) {
      logger.logError(`NOTIFY handler failed on channel ${msg.channel}`, e);
    }
  }

  async function connect() {
    await client.connect();
    await client.query(`LISTEN ${CH_MAP_CHANGES}`);
    await client.query(`LISTEN ${CH_ADVENTURES_USER}`);
    await client.query(`LISTEN ${CH_ADVENTURE_PLAYERS}`);
    await client.query(`LISTEN ${CH_ADVENTURE_SPRITESHEETS}`);
    client.on('notification', onNotification);
    client.on('error', onError);
  }

  function onError(e: Error) {
    logger.logWarning('LISTEN client error; will reconnect', e);
    if (!stopped) {
      setTimeout(reconnect, 3000);
    }
  }

  async function reconnect() {
    if (stopped) return;
    try { await client.end().catch(() => {}); } catch { /* client already dead; expected */ }
    client = new pg.Client({ connectionString });
    try {
      await connect();
      logger.logInfo('LISTEN client reconnected');
    } catch (e) {
      logger.logError('Reconnect to LISTEN failed', e);
      if (!stopped) {
        setTimeout(reconnect, 5000);
      }
    }
  }

  await connect();

  return {
    stop: async () => {
      stopped = true;
      await client.end().catch(e => logger.logWarning('LISTEN client end() during shutdown failed', e));
    },
  };
}

// ── Per-channel handlers ────────────────────────────────────────────────────

async function handleMapChanges(payload: string, mapRooms: RoomManager): Promise<void> {
  const sep = payload.indexOf(':');
  if (sep === -1) return;
  const mapId = payload.slice(0, sep);
  const changeId = payload.slice(sep + 1);
  if (!mapId || !changeId) return;
  if (!mapRooms.hasRoom(mapId)) return;

  const [row] = await db.select({ changes: mapChanges.changes })
    .from(mapChanges)
    .where(eq(mapChanges.id, changeId))
    .limit(1);
  if (!row) return;

  mapRooms.broadcast(mapId, encodeUpdate('mapChanges', mapId, row.changes));
}

async function handleAdventuresUser(userId: string, userRooms: RoomManager): Promise<void> {
  if (!userRooms.hasRoom(userId)) return;
  const data = await snapshotAdventures(db, userId);
  userRooms.broadcast(userId, encodeUpdate('adventures', userId, data));
}

async function handleAdventurePlayers(adventureId: string, adventureRooms: RoomManager): Promise<void> {
  if (!adventureRooms.hasRoom(adventureId)) return;
  const data = await snapshotPlayers(db, adventureId);
  adventureRooms.broadcast(adventureId, encodeUpdate('players', adventureId, data));
}

async function handleAdventureSpritesheets(adventureId: string, adventureRooms: RoomManager): Promise<void> {
  if (!adventureRooms.hasRoom(adventureId)) return;
  const data = await snapshotSpritesheets(db, adventureId);
  adventureRooms.broadcast(adventureId, encodeUpdate('spritesheets', adventureId, data));
}

// pg_notify via parameters escapes the payload; safer than manual quoting.
async function notify(channel: string, payload: string): Promise<void> {
  await pool.query('SELECT pg_notify($1, $2)', [channel, payload]);
}

export async function notifyMapChange(mapId: string, changeId: string): Promise<void> {
  await notify(CH_MAP_CHANGES, `${mapId}:${changeId}`);
}

export async function notifyAdventuresUser(userId: string): Promise<void> {
  await notify(CH_ADVENTURES_USER, userId);
}

export async function notifyAdventuresUsers(userIds: string[]): Promise<void> {
  await Promise.all(userIds.map(id => notify(CH_ADVENTURES_USER, id)));
}

export async function notifyAdventurePlayers(adventureId: string): Promise<void> {
  await notify(CH_ADVENTURE_PLAYERS, adventureId);
}

export async function notifyAdventureSpritesheets(adventureId: string): Promise<void> {
  await notify(CH_ADVENTURE_SPRITESHEETS, adventureId);
}

/** Fire NOTIFYs concurrently; log and swallow failures so callers don't have
 * to repeat the same Promise.all + catch boilerplate. NOTIFY failures must not
 * fail the mutation — if the listener is briefly gone, clients will poll the
 * REST fallback (or miss a live update). */
export function notifySafe(...promises: Promise<void>[]): Promise<void> {
  return Promise.all(promises).then(() => {}, e => logger.logError('NOTIFY failed', e));
}
