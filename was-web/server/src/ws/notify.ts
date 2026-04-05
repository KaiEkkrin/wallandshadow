import pg from 'pg';
import { db } from '../db/connection.js';
import { pool } from '../db/connection.js';
import { mapChanges } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import type { MapRoomManager } from './rooms.js';

const CHANNEL = 'map_changes';

/**
 * Start a PostgreSQL LISTEN connection that broadcasts new map changes
 * to WebSocket rooms. NOTIFY payload is `mapId:changeId`.
 */
export async function startNotifyListener(
  connectionString: string,
  rooms: MapRoomManager,
): Promise<{ stop: () => Promise<void> }> {
  let client = new pg.Client({ connectionString });
  let stopped = false;

  function onNotification(msg: pg.Notification) {
    if (msg.channel !== CHANNEL || !msg.payload) return;

    const sep = msg.payload.indexOf(':');
    if (sep === -1) return;
    const mapId = msg.payload.slice(0, sep);
    const changeId = msg.payload.slice(sep + 1);
    if (!mapId || !changeId) return;

    if (!rooms.hasRoom(mapId)) return;

    db.select({ changes: mapChanges.changes })
      .from(mapChanges)
      .where(eq(mapChanges.id, changeId))
      .limit(1)
      .then(([row]) => {
        if (row) {
          rooms.broadcast(mapId, JSON.stringify(row.changes));
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
 * Issue a NOTIFY so the LISTEN handler can fetch and broadcast the change.
 */
export async function notifyMapChange(mapId: string, changeId: string): Promise<void> {
  const payload = `${mapId}:${changeId}`.replaceAll("'", "''");
  await pool.query(`NOTIFY ${CHANNEL}, '${payload}'`);
}
