import { serve } from '@hono/node-server';
import { WebSocketServer } from 'ws';
import { pool } from './db/connection.js';
import { createApp } from './app.js';
import { RoomManager, type Rooms } from './ws/rooms.js';
import { createUpgradeHandler } from './ws/handler.js';
import { startNotifyListener } from './ws/notify.js';
import { validateAuthEnv } from './auth/validateEnv.js';

// Fail fast if production auth config is invalid
validateAuthEnv();

const app = createApp();
const port = parseInt(process.env.PORT ?? '3000', 10);

const server = serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, () => {
  console.log(`Server running on http://0.0.0.0:${port}`);
});

// ── WebSocket setup ───────────────────────────────────────────────────────────

const wss = new WebSocketServer({ noServer: true });
const rooms: Rooms = {
  mapRooms: new RoomManager(),
  adventureRooms: new RoomManager(),
  userRooms: new RoomManager(),
};

server.on('upgrade', createUpgradeHandler(wss, rooms));

// Start LISTEN/NOTIFY bridge for broadcasting room updates to WebSocket rooms.
const dbUrl = process.env.DATABASE_URL ?? 'postgresql://was:wasdev@localhost:5432/wallandshadow';
let stopNotify: (() => Promise<void>) | undefined;
startNotifyListener(dbUrl, rooms)
  .then(listener => { stopNotify = listener.stop; })
  .catch(e => console.error('Failed to start NOTIFY listener:', e));

// ── Graceful shutdown ─────────────────────────────────────────────────────────

process.on('SIGTERM', async () => {
  if (stopNotify) await stopNotify();
  wss.close();
  await pool.end();
  process.exit(0);
});
