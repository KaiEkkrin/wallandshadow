import pg from 'pg';
import { db } from '../db/connection.js';
import { pool } from '../db/connection.js';
import { mapChanges } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import type { MapRoomManager } from './rooms.js';

const CHANNEL = 'map_changes';

/**
 * Start a PostgreSQL LISTEN connection that broadcasts new map changes
 * to WebSocket rooms. Each NOTIFY payload contains `mapId:changeId:authorUid`
 * so the broadcast can exclude the author (they already applied locally).
 */
export async function startNotifyListener(
  connectionString: string,
  rooms: MapRoomManager,
): Promise<{ stop: () => Promise<void> }> {
  let client = new pg.Client({ connectionString });
  let stopped = false;

  function onNotification(msg: pg.Notification) {
    if (msg.channel !== CHANNEL || !msg.payload) return;

    // Payload format: "mapId:changeId:authorUid" (authorUid may be empty for consolidations)
    const parts = msg.payload.split(':');
    if (parts.length < 2) return;
    const [mapId, changeId, authorUid] = parts;
    if (!mapId || !changeId) return;

    if (!rooms.hasRoom(mapId)) return;

    db.select({ changes: mapChanges.changes })
      .from(mapChanges)
      .where(eq(mapChanges.id, changeId))
      .limit(1)
      .then(([row]) => {
        if (row) {
          // Exclude the author for incremental changes (they already applied locally).
          // For consolidations (no authorUid), broadcast to everyone.
          rooms.broadcast(mapId, JSON.stringify(row.changes), authorUid || undefined);
        }
      })
      .catch(e => console.error('Failed to fetch change for broadcast:', e));
  }

  async function connect() {
    await client.connect();
    await client.query(`LISTEN ${CHANNEL}`);
    client.on('notification', onNotification);
    client.on('error', onError);
  }

  function onError(e: Error) {
    console.error('LISTEN client error:', e);
    if (!stopped) {
      setTimeout(reconnect, 3000);
    }
  }

  async function reconnect() {
    if (stopped) return;
    try { await client.end().catch(() => {}); } catch { /* ignore */ }
    client = new pg.Client({ connectionString });
    try {
      await connect();
      console.log('LISTEN client reconnected');
    } catch (e) {
      console.error('Reconnect to LISTEN failed:', e);
      if (!stopped) {
        setTimeout(reconnect, 5000);
      }
    }
  }

  await connect();

  return {
    stop: async () => {
      stopped = true;
      await client.end().catch(() => {});
    },
  };
}

/**
 * Issue a NOTIFY for a new incremental change. Includes the author UID so the
 * broadcast can exclude the author (they already applied the change locally).
 */
export async function notifyMapChange(mapId: string, changeId: string, authorUid: string): Promise<void> {
  const payload = `${mapId}:${changeId}:${authorUid}`.replaceAll("'", "''");
  await pool.query(`NOTIFY ${CHANNEL}, '${payload}'`);
}

/**
 * Issue a NOTIFY for a consolidation. No author exclusion — all clients need
 * to see the new base change.
 */
export async function notifyMapConsolidation(mapId: string, changeId: string): Promise<void> {
  const payload = `${mapId}:${changeId}`.replaceAll("'", "''");
  await pool.query(`NOTIFY ${CHANNEL}, '${payload}'`);
}
