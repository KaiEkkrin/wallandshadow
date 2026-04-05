import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import { WebSocketServer, WebSocket } from 'ws';
import { verifyJwt } from '../auth/jwt.js';
import { db } from '../db/connection.js';
import { maps } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { assertAdventureMember, fetchMapChanges } from '../services/extensions.js';
import type { MapRoomManager } from './rooms.js';

const WS_PATH_RE = /^\/ws\/maps\/([0-9a-f-]+)/;

/**
 * Handle an HTTP upgrade request for a WebSocket connection.
 * Validates JWT, checks adventure membership, joins the map room,
 * and sends initial state (base + incremental changes).
 */
export function createUpgradeHandler(wss: WebSocketServer, rooms: MapRoomManager) {
  return async (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    try {
      const url = new URL(request.url ?? '', `http://${request.headers.host ?? 'localhost'}`);

      const match = WS_PATH_RE.exec(url.pathname);
      if (!match) {
        socket.destroy();
        return;
      }
      const mapId = match[1];

      const token = url.searchParams.get('token');
      if (!token) {
        socket.destroy();
        return;
      }

      let uid: string;
      try {
        ({ uid } = await verifyJwt(token));
      } catch {
        socket.destroy();
        return;
      }

      const [mapRow] = await db.select({ adventureId: maps.adventureId })
        .from(maps)
        .where(eq(maps.id, mapId))
        .limit(1);
      if (!mapRow) {
        socket.destroy();
        return;
      }

      try {
        await assertAdventureMember(db, uid, mapRow.adventureId);
      } catch {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
        rooms.join(mapId, ws, uid);

        ws.on('close', () => {
          rooms.leave(mapId, ws);
        });

        ws.on('error', () => {
          rooms.leave(mapId, ws);
        });

        // Send initial state: base change + incrementals
        sendInitialState(ws, mapId).catch(e => {
          console.error('Failed to send initial WebSocket state:', e);
          ws.close(1011, 'Failed to load map state');
        });
      });
    } catch (e) {
      console.error('WebSocket upgrade error:', e);
      socket.destroy();
    }
  };
}

/** Send the current base change and all incremental changes to a newly connected client. */
async function sendInitialState(ws: WebSocket, mapId: string): Promise<void> {
  const { baseRow, incrementalRows } = await fetchMapChanges(db, mapId);

  if (baseRow && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(baseRow.changes));
  }

  for (const row of incrementalRows) {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(row.changes));
    }
  }
}
