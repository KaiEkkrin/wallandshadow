import { describe, test, expect, afterAll, beforeAll } from 'vitest';
import { createServer, type Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { MapType, ChangeCategory } from '@wallandshadow/shared';
import type { Changes } from '@wallandshadow/shared';
import { createApp } from '../app.js';
import { RoomManager, type Rooms } from '../ws/rooms.js';
import { createUpgradeHandler } from '../ws/handler.js';
import {
  registerUser,
  apiPost,
  apiPatch,
  postMapChanges,
  createAddToken1,
  createAddWall1,
} from './helpers.js';
import { startNotifyListener } from '../ws/notify.js';

const app = createApp();

// ── Test HTTP server with WebSocket support ─────────────────────────────────

let server: Server;
let wss: WebSocketServer;
let rooms: Rooms;
let port: number;
let stopNotify: (() => Promise<void>) | undefined;

beforeAll(async () => {
  rooms = {
    mapRooms: new RoomManager(),
    adventureRooms: new RoomManager(),
    userRooms: new RoomManager(),
  };
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

function connectWs(token: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws?token=${token}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
    setTimeout(() => reject(new Error('WebSocket connect timeout')), 5000);
  });
}

interface ServerFrame {
  type: string;
  subId?: number;
  scope?: string;
  key?: string;
  data?: unknown;
  message?: string;
  ackId?: number;
  id?: string;
  error?: string;
}

function nextFrame(ws: WebSocket, timeoutMs = 5000): Promise<ServerFrame> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WS message timeout')), timeoutMs);
    ws.once('message', (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()));
    });
  });
}

// Collect frames until a predicate matches (or timeout). Returns the matching frame.
function waitForFrame(
  ws: WebSocket,
  predicate: (f: ServerFrame) => boolean,
  timeoutMs = 5000,
): Promise<ServerFrame> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', handler);
      reject(new Error('WS frame predicate timeout'));
    }, timeoutMs);
    const handler = (data: WebSocket.Data) => {
      try {
        const f = JSON.parse(data.toString()) as ServerFrame;
        if (predicate(f)) {
          clearTimeout(timer);
          ws.off('message', handler);
          resolve(f);
        }
      } catch { /* ignore non-JSON */ }
    };
    ws.on('message', handler);
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

function send(ws: WebSocket, frame: Record<string, unknown>): void {
  ws.send(JSON.stringify(frame));
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('WebSocket /ws connection', () => {
  test('connect with valid token succeeds', async () => {
    const { token } = await registerUser(app, 'WsUser1');
    const ws = await connectWs(token);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  test('connect with invalid token is rejected', async () => {
    const ws = new WebSocket(`ws://localhost:${port}/ws?token=invalid-token`);
    const result = await Promise.race([
      new Promise<string>(resolve => ws.on('close', () => resolve('closed'))),
      new Promise<string>(resolve => ws.on('error', () => resolve('error'))),
      new Promise<string>(resolve => setTimeout(() => resolve('timeout'), 3000)),
    ]);
    expect(['closed', 'error']).toContain(result);
  });

  test('connect without token is rejected', async () => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    const result = await Promise.race([
      new Promise<string>(resolve => ws.on('close', () => resolve('closed'))),
      new Promise<string>(resolve => ws.on('error', () => resolve('error'))),
      new Promise<string>(resolve => setTimeout(() => resolve('timeout'), 3000)),
    ]);
    expect(['closed', 'error']).toContain(result);
  });
});

describe('mapChanges subscription', () => {
  test('subscribe delivers existing base + incrementals in snapshot', async () => {
    const { token, uid } = await registerUser(app, 'WsMapUser1');
    const aId = await createAdventure(token);
    const mId = await createMap(token, aId);

    await postMapChanges(app, token, aId, mId, [createAddToken1(uid), createAddWall1()]);
    await apiPost(app, `/api/adventures/${aId}/maps/${mId}/consolidate`, {}, token);

    const ws = await connectWs(token);
    send(ws, { type: 'subscribe', subId: 1, scope: 'mapChanges', id: mId });
    const snap = await waitForFrame(ws, f => f.type === 'snapshot' && f.subId === 1);
    const payload = snap.data as { changes: Changes[] };
    expect(payload.changes.length).toBeGreaterThan(0);
    // The consolidated base comes first
    expect(payload.changes[0].incremental).toBe(false);
    ws.close();
  });

  test('non-member cannot subscribe to mapChanges', async () => {
    const owner = await registerUser(app, 'WsMapOwner');
    const outsider = await registerUser(app, 'WsMapOutsider');
    const aId = await createAdventure(owner.token);
    const mId = await createMap(owner.token, aId);

    const ws = await connectWs(outsider.token);
    send(ws, { type: 'subscribe', subId: 1, scope: 'mapChanges', id: mId });
    const err = await waitForFrame(ws, f => f.type === 'subscribeError' && f.subId === 1);
    expect(err.message).toMatch(/Adventure not found/);
    ws.close();
  });

  test('mapChange write via WS broadcasts update to peer subscribers', async () => {
    const { token, uid } = await registerUser(app, 'WsMapUser2');
    const aId = await createAdventure(token);
    const mId = await createMap(token, aId);

    const writer = await connectWs(token);
    send(writer, { type: 'subscribe', subId: 1, scope: 'mapChanges', id: mId });
    await waitForFrame(writer, f => f.type === 'snapshot' && f.subId === 1);

    const peer = await connectWs(token);
    send(peer, { type: 'subscribe', subId: 1, scope: 'mapChanges', id: mId });
    await waitForFrame(peer, f => f.type === 'snapshot' && f.subId === 1);

    // Writer posts a change via WS
    send(writer, {
      type: 'mapChange',
      ackId: 42,
      adventureId: aId,
      mapId: mId,
      chs: [createAddToken1(uid)],
    });

    const [ack, update] = await Promise.all([
      waitForFrame(writer, f => f.type === 'mapChangeAck' && f.ackId === 42),
      waitForFrame(peer, f => f.type === 'roomUpdate' && f.scope === 'mapChanges' && f.key === mId),
    ]);
    expect(ack.id).toBeTruthy();
    expect(ack.error).toBeUndefined();
    const data = update.data as Changes;
    expect(data.incremental).toBe(true);
    expect(data.chs[0].cat).toBe(ChangeCategory.Token);

    writer.close();
    peer.close();
  });

  test('mapChange write by non-member fails with ack error', async () => {
    const owner = await registerUser(app, 'WsWriteOwner');
    const outsider = await registerUser(app, 'WsWriteOutsider');
    const aId = await createAdventure(owner.token);
    const mId = await createMap(owner.token, aId);

    const ws = await connectWs(outsider.token);
    send(ws, {
      type: 'mapChange',
      ackId: 1,
      adventureId: aId,
      mapId: mId,
      chs: [createAddToken1(outsider.uid)],
    });
    const ack = await waitForFrame(ws, f => f.type === 'mapChangeAck' && f.ackId === 1);
    expect(ack.error).toBeTruthy();
    expect(ack.id).toBeUndefined();
    ws.close();
  });

  test('unsubscribe stops further updates', async () => {
    const { token, uid } = await registerUser(app, 'WsUnsub');
    const aId = await createAdventure(token);
    const mId = await createMap(token, aId);

    const ws = await connectWs(token);
    send(ws, { type: 'subscribe', subId: 1, scope: 'mapChanges', id: mId });
    await waitForFrame(ws, f => f.type === 'snapshot' && f.subId === 1);
    expect(rooms.mapRooms.roomSize(mId)).toBe(1);

    send(ws, { type: 'unsubscribe', subId: 1 });
    // Give the server a tick to process the unsubscribe
    await new Promise(r => setTimeout(r, 100));
    expect(rooms.mapRooms.roomSize(mId)).toBe(0);

    // Post a change; we must NOT receive an update after unsubscribing.
    await postMapChanges(app, token, aId, mId, [createAddToken1(uid)]);
    const gotFrame = await Promise.race([
      nextFrame(ws, 500).then(() => true).catch(() => false),
      new Promise<boolean>(r => setTimeout(() => r(false), 600)),
    ]);
    expect(gotFrame).toBe(false);
    ws.close();
  });

  test('close prunes all subscribed rooms', async () => {
    const { token } = await registerUser(app, 'WsClosePrune');
    const aId = await createAdventure(token);
    const mId = await createMap(token, aId);

    const ws = await connectWs(token);
    send(ws, { type: 'subscribe', subId: 1, scope: 'mapChanges', id: mId });
    await waitForFrame(ws, f => f.type === 'snapshot');
    expect(rooms.mapRooms.roomSize(mId)).toBe(1);

    ws.close();
    await waitForClose(ws);
    await new Promise(r => setTimeout(r, 100));
    expect(rooms.mapRooms.roomSize(mId)).toBe(0);
  });
});

describe('adventures subscription', () => {
  test('snapshot lists caller adventures; NOTIFY on create updates', async () => {
    const { token } = await registerUser(app, 'WsAdv1');
    const aId = await createAdventure(token, 'Initial');

    const ws = await connectWs(token);
    send(ws, { type: 'subscribe', subId: 1, scope: 'adventures' });
    const snap = await waitForFrame(ws, f => f.type === 'snapshot' && f.subId === 1);
    const rows = snap.data as { id: string; name: string }[];
    expect(rows.some(r => r.id === aId && r.name === 'Initial')).toBe(true);

    // Create another adventure — should trigger a roomUpdate
    const updatePromise = waitForFrame(ws,
      f => f.type === 'roomUpdate' && f.scope === 'adventures');
    await createAdventure(token, 'Second');
    const upd = await updatePromise;
    const updRows = upd.data as { id: string; name: string }[];
    expect(updRows.some(r => r.name === 'Second')).toBe(true);

    ws.close();
  });
});

describe('players subscription', () => {
  test('snapshot lists players; NOTIFY on updatePlayer updates', async () => {
    const owner = await registerUser(app, 'WsPlayersOwner');
    const aId = await createAdventure(owner.token);

    const ws = await connectWs(owner.token);
    send(ws, { type: 'subscribe', subId: 1, scope: 'players', id: aId });
    const snap = await waitForFrame(ws, f => f.type === 'snapshot' && f.subId === 1);
    const data = snap.data as { adventure: { id: string } | null; players: { playerId: string }[] };
    expect(data.adventure?.id).toBe(aId);
    expect(data.players).toHaveLength(1);
    expect(data.players[0].playerId).toBe(owner.uid);

    // Owner updates their own characters — should trigger a roomUpdate
    const updatePromise = waitForFrame(ws,
      f => f.type === 'roomUpdate' && f.scope === 'players' && f.key === aId);
    const res = await apiPatch(app, `/api/adventures/${aId}/players/${owner.uid}`, {
      characters: [{ id: 'c1', name: 'Hero' }],
    }, owner.token);
    expect(res.status).toBe(204);
    const upd = await updatePromise;
    const updData = upd.data as { players: { characters: { id: string }[] }[] };
    expect(updData.players[0].characters).toHaveLength(1);

    ws.close();
  });

  test('non-member gets subscribeError on players scope', async () => {
    const owner = await registerUser(app, 'WsPlayersOwner2');
    const outsider = await registerUser(app, 'WsPlayersOutsider');
    const aId = await createAdventure(owner.token);

    const ws = await connectWs(outsider.token);
    send(ws, { type: 'subscribe', subId: 1, scope: 'players', id: aId });
    const err = await waitForFrame(ws, f => f.type === 'subscribeError' && f.subId === 1);
    expect(err.message).toMatch(/Adventure not found/);
    ws.close();
  });
});

describe('spritesheets subscription', () => {
  test('snapshot returns empty array for a fresh adventure', async () => {
    const { token } = await registerUser(app, 'WsSprites1');
    const aId = await createAdventure(token);

    const ws = await connectWs(token);
    send(ws, { type: 'subscribe', subId: 1, scope: 'spritesheets', id: aId });
    const snap = await waitForFrame(ws, f => f.type === 'snapshot' && f.subId === 1);
    const rows = snap.data as unknown[];
    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(0);
    ws.close();
  });
});

describe('profile subscription', () => {
  test('snapshot combines me + adventures', async () => {
    const { token, uid } = await registerUser(app, 'WsProfile1');
    await createAdventure(token, 'First');

    const ws = await connectWs(token);
    send(ws, { type: 'subscribe', subId: 1, scope: 'profile' });
    const snap = await waitForFrame(ws, f => f.type === 'snapshot' && f.subId === 1);
    const data = snap.data as { me: { uid: string; name: string }; adventures: { name: string }[] };
    expect(data.me.uid).toBe(uid);
    expect(data.me.name).toBe('WsProfile1');
    expect(data.adventures.some(a => a.name === 'First')).toBe(true);
    ws.close();
  });

  test('updating name NOTIFYs profile', async () => {
    const { token } = await registerUser(app, 'WsProfile2');

    const ws = await connectWs(token);
    send(ws, { type: 'subscribe', subId: 1, scope: 'profile' });
    await waitForFrame(ws, f => f.type === 'snapshot' && f.subId === 1);

    const updatePromise = waitForFrame(ws,
      f => f.type === 'roomUpdate' && f.scope === 'profile');
    const res = await apiPatch(app, '/api/auth/me', { name: 'Renamed' }, token);
    expect(res.status).toBe(200);
    const upd = await updatePromise;
    const data = upd.data as { me: { name: string } };
    expect(data.me.name).toBe('Renamed');
    ws.close();
  });

  test('creating an adventure NOTIFYs profile', async () => {
    const { token } = await registerUser(app, 'WsProfile3');

    const ws = await connectWs(token);
    send(ws, { type: 'subscribe', subId: 1, scope: 'profile' });
    await waitForFrame(ws, f => f.type === 'snapshot' && f.subId === 1);

    const updatePromise = waitForFrame(ws,
      f => f.type === 'roomUpdate' && f.scope === 'profile');
    await createAdventure(token, 'Joined');
    const upd = await updatePromise;
    const data = upd.data as { adventures: { name: string }[] };
    expect(data.adventures.some(a => a.name === 'Joined')).toBe(true);
    ws.close();
  });
});

describe('adventure subscription', () => {
  test('snapshot returns adventure detail with maps', async () => {
    const { token } = await registerUser(app, 'WsAdvDetail1');
    const aId = await createAdventure(token, 'Detail Test');
    const mId = await createMap(token, aId, 'First Map');

    const ws = await connectWs(token);
    send(ws, { type: 'subscribe', subId: 1, scope: 'adventure', id: aId });
    const snap = await waitForFrame(ws, f => f.type === 'snapshot' && f.subId === 1);
    const data = snap.data as { id: string; name: string; maps: { id: string; name: string }[] };
    expect(data.id).toBe(aId);
    expect(data.name).toBe('Detail Test');
    expect(data.maps.some(m => m.id === mId && m.name === 'First Map')).toBe(true);
    ws.close();
  });

  test('createMap NOTIFYs adventure detail', async () => {
    const { token } = await registerUser(app, 'WsAdvDetail2');
    const aId = await createAdventure(token);

    const ws = await connectWs(token);
    send(ws, { type: 'subscribe', subId: 1, scope: 'adventure', id: aId });
    await waitForFrame(ws, f => f.type === 'snapshot' && f.subId === 1);

    const updatePromise = waitForFrame(ws,
      f => f.type === 'roomUpdate' && f.scope === 'adventure' && f.key === aId);
    await createMap(token, aId, 'Fresh');
    const upd = await updatePromise;
    const data = upd.data as { maps: { name: string }[] };
    expect(data.maps.some(m => m.name === 'Fresh')).toBe(true);
    ws.close();
  });

  test('non-member gets subscribeError on adventure scope', async () => {
    const owner = await registerUser(app, 'WsAdvOwner');
    const outsider = await registerUser(app, 'WsAdvOutsider');
    const aId = await createAdventure(owner.token);

    const ws = await connectWs(outsider.token);
    send(ws, { type: 'subscribe', subId: 1, scope: 'adventure', id: aId });
    const err = await waitForFrame(ws, f => f.type === 'subscribeError' && f.subId === 1);
    expect(err.message).toMatch(/Adventure not found/);
    ws.close();
  });
});

describe('map subscription', () => {
  test('snapshot returns { adventure, map }', async () => {
    const { token } = await registerUser(app, 'WsMapDetail1');
    const aId = await createAdventure(token, 'Adv');
    const mId = await createMap(token, aId, 'Map');

    const ws = await connectWs(token);
    send(ws, { type: 'subscribe', subId: 1, scope: 'map', id: mId });
    const snap = await waitForFrame(ws, f => f.type === 'snapshot' && f.subId === 1);
    const data = snap.data as { adventure: { id: string; name: string }; map: { id: string; name: string } };
    expect(data.adventure.id).toBe(aId);
    expect(data.adventure.name).toBe('Adv');
    expect(data.map.id).toBe(mId);
    expect(data.map.name).toBe('Map');
    ws.close();
  });

  test('updateMap NOTIFYs map subscribers', async () => {
    const { token } = await registerUser(app, 'WsMapDetail2');
    const aId = await createAdventure(token);
    const mId = await createMap(token, aId, 'Before');

    const ws = await connectWs(token);
    send(ws, { type: 'subscribe', subId: 1, scope: 'map', id: mId });
    await waitForFrame(ws, f => f.type === 'snapshot' && f.subId === 1);

    const updatePromise = waitForFrame(ws,
      f => f.type === 'roomUpdate' && f.scope === 'map' && f.key === mId);
    const res = await apiPatch(app, `/api/adventures/${aId}/maps/${mId}`, { name: 'After' }, token);
    expect(res.status).toBe(204);
    const upd = await updatePromise;
    const data = upd.data as { map: { name: string } };
    expect(data.map.name).toBe('After');
    ws.close();
  });

  test('non-member cannot subscribe to map', async () => {
    const owner = await registerUser(app, 'WsMapDetailOwner');
    const outsider = await registerUser(app, 'WsMapDetailOutsider');
    const aId = await createAdventure(owner.token);
    const mId = await createMap(owner.token, aId);

    const ws = await connectWs(outsider.token);
    send(ws, { type: 'subscribe', subId: 1, scope: 'map', id: mId });
    const err = await waitForFrame(ws, f => f.type === 'subscribeError' && f.subId === 1);
    expect(err.message).toMatch(/Adventure not found/);
    ws.close();
  });
});
