import { describe, test, expect, afterAll, beforeAll } from 'vitest';
import { createServer, type Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { MapType, ChangeCategory } from '@wallandshadow/shared';
import type { Changes } from '@wallandshadow/shared';
import { createApp } from '../app.js';
import { MapRoomManager } from '../ws/rooms.js';
import { createUpgradeHandler } from '../ws/handler.js';
import {
  registerUser,
  apiPost,
  postMapChanges,
  createAddToken1,
  createAddWall1,
} from './helpers.js';
import { startNotifyListener } from '../ws/notify.js';

const app = createApp();

// ── Test HTTP server with WebSocket support ─────────────────────────────────

let server: Server;
let wss: WebSocketServer;
let rooms: MapRoomManager;
let port: number;
let stopNotify: (() => Promise<void>) | undefined;

beforeAll(async () => {
  rooms = new MapRoomManager();
  wss = new WebSocketServer({ noServer: true });

  // Create a real HTTP server using Hono's fetch handler
  server = createServer(async (req, res) => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === 'string') headers[k] = v;
    }

    const bodyChunks: Uint8Array[] = [];
    await new Promise<void>((resolve) => {
      req.on('data', (c: Uint8Array) => bodyChunks.push(c));
      req.on('end', () => resolve());
    });
    const bodyBuffer = Buffer.concat(bodyChunks);

    const request = new Request(`http://localhost${req.url}`, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method ?? '') ? undefined : new Uint8Array(bodyBuffer),
    });

    const response = await app.fetch(request);
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    const resBody = await response.arrayBuffer();
    res.end(Buffer.from(resBody));
  });

  server.on('upgrade', createUpgradeHandler(wss, rooms));

  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      const addr = server.address();
      port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve();
    });
  });

  // Start LISTEN/NOTIFY bridge so broadcast tests work
  const dbUrl = process.env.DATABASE_URL ?? 'postgresql://was:wasdev@localhost:5432/wallandshadow';
  const listener = await startNotifyListener(dbUrl, rooms);
  stopNotify = listener.stop;
});

afterAll(async () => {
  if (stopNotify) await stopNotify();
  wss.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function connectWs(mapId: string, token: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws/maps/${mapId}?token=${token}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
    // Timeout after 5s
    setTimeout(() => reject(new Error('WebSocket connect timeout')), 5000);
  });
}

function waitForMessage(ws: WebSocket, timeoutMs = 5000): Promise<Changes> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WS message timeout')), timeoutMs);
    ws.once('message', (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()));
    });
  });
}

function waitForClose(ws: WebSocket, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WS close timeout')), timeoutMs);
    ws.on('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function createAdventure(token: string, name = 'Test Adventure'): Promise<string> {
  const res = await apiPost(app, '/api/adventures', { name, description: '' }, token);
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function createMap(token: string, adventureId: string, name = 'Test Map'): Promise<string> {
  const res = await apiPost(app, `/api/adventures/${adventureId}/maps`, {
    name, description: '', ty: MapType.Square, ffa: false,
  }, token);
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('WebSocket map rooms', () => {

  test('connect with valid token and receive empty initial state', async () => {
    const { token } = await registerUser(app, 'WsUser1');
    const aId = await createAdventure(token);
    const mId = await createMap(token, aId);

    // Connect — for an empty map, we should get no messages initially
    const ws = await connectWs(mId, token);
    expect(ws.readyState).toBe(WebSocket.OPEN);

    // Give a moment to confirm no messages arrive
    const gotMessage = await Promise.race([
      waitForMessage(ws, 500).then(() => true).catch(() => false),
      new Promise<boolean>(resolve => setTimeout(() => resolve(false), 600)),
    ]);
    expect(gotMessage).toBe(false);

    ws.close();
  });

  test('connect with invalid token is rejected', async () => {
    const { token } = await registerUser(app, 'WsUser2');
    const aId = await createAdventure(token);
    const mId = await createMap(token, aId);

    // Try connecting with a bad token
    const ws = new WebSocket(`ws://localhost:${port}/ws/maps/${mId}?token=invalid-token`);

    const closed = await Promise.race([
      new Promise<string>(resolve => ws.on('close', () => resolve('closed'))),
      new Promise<string>(resolve => ws.on('error', () => resolve('error'))),
      new Promise<string>(resolve => setTimeout(() => resolve('timeout'), 3000)),
    ]);

    expect(['closed', 'error']).toContain(closed);
  });

  test('connect without token is rejected', async () => {
    const { token } = await registerUser(app, 'WsUser3');
    const aId = await createAdventure(token);
    const mId = await createMap(token, aId);

    const ws = new WebSocket(`ws://localhost:${port}/ws/maps/${mId}`);

    const closed = await Promise.race([
      new Promise<string>(resolve => ws.on('close', () => resolve('closed'))),
      new Promise<string>(resolve => ws.on('error', () => resolve('error'))),
      new Promise<string>(resolve => setTimeout(() => resolve('timeout'), 3000)),
    ]);

    expect(['closed', 'error']).toContain(closed);
  });

  test('non-member cannot connect', async () => {
    const owner = await registerUser(app, 'WsOwner');
    const outsider = await registerUser(app, 'WsOutsider');
    const aId = await createAdventure(owner.token);
    const mId = await createMap(owner.token, aId);

    const ws = new WebSocket(`ws://localhost:${port}/ws/maps/${mId}?token=${outsider.token}`);

    const closed = await Promise.race([
      new Promise<string>(resolve => ws.on('close', () => resolve('closed'))),
      new Promise<string>(resolve => ws.on('error', () => resolve('error'))),
      new Promise<string>(resolve => setTimeout(() => resolve('timeout'), 3000)),
    ]);

    expect(['closed', 'error']).toContain(closed);
  });

  test('receives initial state when connecting to map with existing changes', async () => {
    const { token, uid } = await registerUser(app, 'WsUser4');
    const aId = await createAdventure(token);
    const mId = await createMap(token, aId);

    // Post and consolidate changes so there's a base change
    await postMapChanges(app, token, aId, mId, [createAddToken1(uid), createAddWall1()]);
    await apiPost(app, `/api/adventures/${aId}/maps/${mId}/consolidate`, {}, token);

    // Connect — should receive the base change as initial state
    const ws = await connectWs(mId, token);
    const msg = await waitForMessage(ws);

    expect(msg.incremental).toBe(false);
    expect(msg.chs.length).toBeGreaterThan(0);

    ws.close();
  });

  test('room broadcast sends messages to connected clients', async () => {
    const { token, uid } = await registerUser(app, 'WsUser5');
    const aId = await createAdventure(token);
    const mId = await createMap(token, aId);

    // Connect a client
    const ws = await connectWs(mId, token);
    await new Promise(resolve => setTimeout(resolve, 100));

    // Set up listener before broadcast
    const msgPromise = waitForMessage(ws, 5000);

    // Simulate what NOTIFY handler does: broadcast a change directly
    const fakeChanges: Changes = {
      chs: [createAddToken1(uid)],
      timestamp: Date.now(),
      incremental: true,
      user: uid,
      resync: false,
    };
    rooms.broadcast(mId, JSON.stringify(fakeChanges));

    const msg = await msgPromise;
    expect(msg.incremental).toBe(true);
    expect(msg.chs).toHaveLength(1);
    expect(msg.chs[0].cat).toBe(ChangeCategory.Token);

    ws.close();
  });

  test('room is cleaned up after disconnect', async () => {
    const { token } = await registerUser(app, 'WsUser6');
    const aId = await createAdventure(token);
    const mId = await createMap(token, aId);

    const ws = await connectWs(mId, token);
    expect(rooms.roomSize(mId)).toBe(1);

    ws.close();
    await waitForClose(ws);

    // Give a tick for the close handler
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(rooms.roomSize(mId)).toBe(0);
  });
});
