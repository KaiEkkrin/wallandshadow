import { describe, test, expect, afterAll, beforeAll, beforeEach } from 'vitest';
import { createServer, type Server } from 'http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { OverlayItem } from '@wallandshadow/shared';
import { createApp } from '../app.js';
import { RoomManager, type Rooms } from '../ws/rooms.js';
import { createUpgradeHandler } from '../ws/handler.js';
import {
  resetLiveOverlayForTesting,
  hasMapOverlayState,
  setOverlayTimingForTesting,
} from '../ws/liveOverlay.js';
import { registerUser } from './helpers.js';
import {
  connectWs,
  send,
  waitForFrame,
  noFrameWithin,
  createAdventure,
  createMap,
  joinAdventure,
} from './wsTestHelpers.js';

const app = createApp();

let server: Server;
let wss: WebSocketServer;
let rooms: Rooms;
let port: number;

beforeAll(async () => {
  rooms = {
    mapRooms: new RoomManager(),
    adventureRooms: new RoomManager(),
    userRooms: new RoomManager(),
  };
  wss = new WebSocketServer({ noServer: true });

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
});

afterAll(async () => {
  wss.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  resetLiveOverlayForTesting();
});

// ── Helpers ─────────────────────────────────────────────────────────────────

async function subscribeOverlay(ws: WebSocket, mapId: string, subId = 1): Promise<OverlayItem[]> {
  send(ws, { type: 'subscribe', subId, scope: 'liveOverlay', id: mapId });
  const snap = await waitForFrame(
    ws,
    f => f.type === 'snapshot' && f.subId === subId && f.scope === 'liveOverlay',
  );
  return snap.data as OverlayItem[];
}

function scribble(itemId: string, phase: 'active' | 'released' = 'active') {
  return { itemId, phase, payload: { kind: 'scribble', points: [{ x: 1, y: 2 }] } };
}

function ruler(itemId: string, phase: 'active' | 'released' = 'active') {
  return { itemId, phase, payload: { kind: 'ruler', nodes: [{ x: 0, y: 0 }, { x: 1, y: 1 }] } };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('liveOverlay core', () => {
  test('subscribe returns an empty snapshot for a fresh map', async () => {
    const owner = await registerUser(app, 'OverlaySelf');
    const aId = await createAdventure(app, owner.token);
    const mId = await createMap(app, owner.token, aId);

    const ws = await connectWs(port, owner.token);
    const snap = await subscribeOverlay(ws, mId);
    expect(snap).toEqual([]);
    ws.close();
  });

  test('non-member cannot subscribe', async () => {
    const owner = await registerUser(app, 'OverlayOwner');
    const outsider = await registerUser(app, 'OverlayOutsider');
    const aId = await createAdventure(app, owner.token);
    const mId = await createMap(app, owner.token, aId);

    const ws = await connectWs(port, outsider.token);
    send(ws, { type: 'subscribe', subId: 1, scope: 'liveOverlay', id: mId });
    const err = await waitForFrame(ws, f => f.type === 'subscribeError' && f.subId === 1);
    expect(err.message).toMatch(/Map not found|not a member|Adventure/i);
    ws.close();
  });

  test('an update broadcasts to a peer but not back to the sender', async () => {
    const owner = await registerUser(app, 'OverlayA');
    const peer = await registerUser(app, 'OverlayB');
    const aId = await createAdventure(app, owner.token);
    const mId = await createMap(app, owner.token, aId);
    await joinAdventure(app, owner.token, peer.token, aId);

    const ownerWs = await connectWs(port, owner.token);
    const peerWs = await connectWs(port, peer.token);
    await subscribeOverlay(ownerWs, mId);
    await subscribeOverlay(peerWs, mId);

    const peerGot = waitForFrame(
      peerWs,
      f => f.type === 'roomUpdate' && f.scope === 'liveOverlay',
    );
    const senderQuiet = noFrameWithin(
      ownerWs,
      f => f.type === 'roomUpdate' && f.scope === 'liveOverlay',
      300,
    );
    send(ownerWs, { type: 'overlayUpdate', mapId: mId, item: scribble('s1') });

    const got = await peerGot;
    expect(got.key).toBe(mId);
    const item = got.data as OverlayItem;
    expect(item.itemId).toBe('s1');
    expect(item.authorId).toBe(owner.uid);
    expect(await senderQuiet).toBe(true);

    ownerWs.close();
    peerWs.close();
  });

  test('authorId is taken from the socket, not the client payload', async () => {
    const owner = await registerUser(app, 'OverlaySpoofA');
    const peer = await registerUser(app, 'OverlaySpoofB');
    const aId = await createAdventure(app, owner.token);
    const mId = await createMap(app, owner.token, aId);
    await joinAdventure(app, owner.token, peer.token, aId);

    const ownerWs = await connectWs(port, owner.token);
    const peerWs = await connectWs(port, peer.token);
    await subscribeOverlay(ownerWs, mId);
    await subscribeOverlay(peerWs, mId);

    const peerGot = waitForFrame(peerWs, f => f.type === 'roomUpdate' && f.scope === 'liveOverlay');
    send(ownerWs, { type: 'overlayUpdate', mapId: mId, item: { ...scribble('s2'), authorId: peer.uid } });
    const item = (await peerGot).data as OverlayItem;
    expect(item.authorId).toBe(owner.uid);

    ownerWs.close();
    peerWs.close();
  });

  test('items are isolated per map', async () => {
    const owner = await registerUser(app, 'OverlayMapIso');
    const aId = await createAdventure(app, owner.token);
    const mA = await createMap(app, owner.token, aId, 'Map A');
    const mB = await createMap(app, owner.token, aId, 'Map B');

    const senderWs = await connectWs(port, owner.token);
    const watcherWs = await connectWs(port, owner.token);
    await subscribeOverlay(senderWs, mA, 1);
    await subscribeOverlay(watcherWs, mB, 1);

    const watcherQuiet = noFrameWithin(
      watcherWs,
      f => f.type === 'roomUpdate' && f.scope === 'liveOverlay',
      300,
    );
    send(senderWs, { type: 'overlayUpdate', mapId: mA, item: scribble('s3') });
    expect(await watcherQuiet).toBe(true);

    senderWs.close();
    watcherWs.close();
  });

  test('a late joiner gets a snapshot of an in-flight item', async () => {
    const owner = await registerUser(app, 'OverlayLateA');
    const late = await registerUser(app, 'OverlayLateB');
    const aId = await createAdventure(app, owner.token);
    const mId = await createMap(app, owner.token, aId);
    await joinAdventure(app, owner.token, late.token, aId);

    const ownerWs = await connectWs(port, owner.token);
    await subscribeOverlay(ownerWs, mId);
    send(ownerWs, { type: 'overlayUpdate', mapId: mId, item: scribble('s4') });
    await new Promise(r => setTimeout(r, 50));

    const lateWs = await connectWs(port, late.token);
    const snap = await subscribeOverlay(lateWs, mId);
    expect(snap.map(i => i.itemId)).toContain('s4');
    expect(hasMapOverlayState(mId)).toBe(true);

    ownerWs.close();
    lateWs.close();
  });
});

describe('liveOverlay lifecycle', () => {
  // Short, well-separated timings so tests are fast but unambiguous.
  beforeEach(() => {
    setOverlayTimingForTesting({ scribbleFadeMs: 400, rulerFadeMs: 300, activeStaleMs: 2000 });
  });

  afterAll(() => {
    setOverlayTimingForTesting({ scribbleFadeMs: 10_000, rulerFadeMs: 1_000, activeStaleMs: 5_000 });
  });

  test('a released item is removed after its fade timer and peers are told', async () => {
    const owner = await registerUser(app, 'OverlayFadeA');
    const peer = await registerUser(app, 'OverlayFadeB');
    const aId = await createAdventure(app, owner.token);
    const mId = await createMap(app, owner.token, aId);
    await joinAdventure(app, owner.token, peer.token, aId);

    const ownerWs = await connectWs(port, owner.token);
    const peerWs = await connectWs(port, peer.token);
    await subscribeOverlay(ownerWs, mId);
    await subscribeOverlay(peerWs, mId);

    const removal = waitForFrame(
      peerWs,
      f => f.type === 'roomUpdate' && f.scope === 'liveOverlay'
        && !!(f.data as { removed?: unknown }).removed,
    );
    send(ownerWs, { type: 'overlayUpdate', mapId: mId, item: ruler('r1', 'released') });
    const frame = await removal;
    const removed = (frame.data as { removed: { authorId: string; itemId: string } }).removed;
    expect(removed.itemId).toBe('r1');
    expect(removed.authorId).toBe(owner.uid);

    await new Promise(r => setTimeout(r, 50));
    expect(hasMapOverlayState(mId)).toBe(false);

    ownerWs.close();
    peerWs.close();
  });

  test('a re-grab within the fade window cancels removal (continuation)', async () => {
    const owner = await registerUser(app, 'OverlayContA');
    const peer = await registerUser(app, 'OverlayContB');
    const aId = await createAdventure(app, owner.token);
    const mId = await createMap(app, owner.token, aId);
    await joinAdventure(app, owner.token, peer.token, aId);

    const ownerWs = await connectWs(port, owner.token);
    const peerWs = await connectWs(port, peer.token);
    await subscribeOverlay(ownerWs, mId);
    await subscribeOverlay(peerWs, mId);

    send(ownerWs, { type: 'overlayUpdate', mapId: mId, item: ruler('r2', 'released') });
    await new Promise(r => setTimeout(r, 100));
    send(ownerWs, { type: 'overlayUpdate', mapId: mId, item: ruler('r2', 'active') });

    const noRemoval = noFrameWithin(
      peerWs,
      f => f.type === 'roomUpdate' && f.scope === 'liveOverlay'
        && !!(f.data as { removed?: unknown }).removed,
      400,
    );
    expect(await noRemoval).toBe(true);
    // The item must still be alive (continuation re-armed the timer), not
    // removed-and-recreated.
    expect(hasMapOverlayState(mId)).toBe(true);

    ownerWs.close();
    peerWs.close();
  });

  test('an active item expires after the staleness timeout', async () => {
    setOverlayTimingForTesting({ scribbleFadeMs: 400, rulerFadeMs: 150, activeStaleMs: 200 });

    const owner = await registerUser(app, 'OverlayStaleA');
    const peer = await registerUser(app, 'OverlayStaleB');
    const aId = await createAdventure(app, owner.token);
    const mId = await createMap(app, owner.token, aId);
    await joinAdventure(app, owner.token, peer.token, aId);

    const ownerWs = await connectWs(port, owner.token);
    const peerWs = await connectWs(port, peer.token);
    await subscribeOverlay(ownerWs, mId);
    await subscribeOverlay(peerWs, mId);

    const removal = waitForFrame(
      peerWs,
      f => f.type === 'roomUpdate' && f.scope === 'liveOverlay'
        && !!(f.data as { removed?: unknown }).removed,
      1000,
    );
    send(ownerWs, { type: 'overlayUpdate', mapId: mId, item: scribble('s5', 'active') });
    const removed = (await removal).data as { removed: { itemId: string } };
    expect(removed.removed.itemId).toBe('s5');

    ownerWs.close();
    peerWs.close();
  });
});
