import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { v7 as uuidv7 } from 'uuid';
import { MapType } from '@wallandshadow/shared';
import type { ILogger } from '@wallandshadow/shared';
import { createApp } from '../app.js';
import { db } from '../db/connection.js';
import { adventurePlayers, images } from '../db/schema.js';
import { and, eq } from 'drizzle-orm';
import { UserLevel, getUserPolicy } from '@wallandshadow/shared';
import { RoomManager, type Rooms } from '../ws/rooms.js';
import { createUpgradeHandler } from '../ws/handler.js';
import { startNotifyListener } from '../ws/notify.js';
import { snapshotProfile } from '../ws/subscriptions.js';
import { assertImageDownloadAccess } from '../services/imageExtensions.js';
import { addSprites } from '../services/spriteExtensions.js';
import { storage } from '../services/storage.js';
import {
  registerUser,
  registerHigherUser,
  registerAdminUser,
  apiGet,
  apiPost,
  apiPatch,
  apiDelete,
  apiUploadImage,
  createAddToken1,
  markAdventureDeleted,
  markMapDeleted,
  markImageDeleted,
  markUserBanned,
  TINY_PNG,
} from './helpers.js';

const app = createApp();

// Quiet logger — the soft-deleted-image and montage paths deliberately log at
// warning level; that noise is expected and not wanted in passing test output.
const silentLogger: ILogger = {
  logError() {},
  logInfo() {},
  logWarning() {},
};

// ── Local fixtures ───────────────────────────────────────────────────────────

async function createAdventure(token: string, name = 'Adventure'): Promise<string> {
  const res = await apiPost(app, '/api/adventures', { name, description: '' }, token);
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function createMap(token: string, adventureId: string, name = 'Map'): Promise<string> {
  const res = await apiPost(app, `/api/adventures/${adventureId}/maps`, {
    name, description: '', ty: MapType.Square, ffa: false, enableGroupVision: false,
  }, token);
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function uploadImage(token: string, name: string): Promise<{ id: string; path: string }> {
  const res = await apiUploadImage(app, token, TINY_PNG, 'pic.png', 'image/png', name);
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; path: string };
}

// ── HTTP read-path filtering ─────────────────────────────────────────────────

describe('soft-delete: adventure read paths', () => {
  test('GET /api/adventures excludes a soft-deleted adventure', async () => {
    const { token } = await registerUser(app);
    const live = await createAdventure(token, 'Live');
    const deleted = await createAdventure(token, 'Deleted');
    await markAdventureDeleted(deleted);

    const res = await apiGet(app, '/api/adventures', token);
    expect(res.status).toBe(200);
    const ids = ((await res.json()) as { id: string }[]).map(a => a.id);
    expect(ids).toContain(live);
    expect(ids).not.toContain(deleted);
  });

  test('GET /api/adventures/:id returns 404 for a soft-deleted adventure', async () => {
    const { token } = await registerUser(app);
    const adventureId = await createAdventure(token);
    await markAdventureDeleted(adventureId);

    const res = await apiGet(app, `/api/adventures/${adventureId}`, token);
    expect(res.status).toBe(404);
  });

  test('GET /api/adventures/:id/players returns 404 for a soft-deleted adventure', async () => {
    const { token } = await registerUser(app);
    const adventureId = await createAdventure(token);
    await markAdventureDeleted(adventureId);

    const res = await apiGet(app, `/api/adventures/${adventureId}/players`, token);
    expect(res.status).toBe(404);
  });
});

describe('soft-delete: map read paths', () => {
  test('GET /api/adventures/:id/maps excludes soft-deleted maps', async () => {
    const { token } = await registerUser(app);
    const adventureId = await createAdventure(token);
    const liveMap = await createMap(token, adventureId, 'Live');
    const deletedMap = await createMap(token, adventureId, 'Deleted');
    await markMapDeleted(deletedMap);

    const res = await apiGet(app, `/api/adventures/${adventureId}/maps`, token);
    expect(res.status).toBe(200);
    const ids = ((await res.json()) as { id: string }[]).map(m => m.id);
    expect(ids).toContain(liveMap);
    expect(ids).not.toContain(deletedMap);
  });

  test('GET /api/adventures/:id/maps/:mapId returns 404 when the map is soft-deleted', async () => {
    const { token } = await registerUser(app);
    const adventureId = await createAdventure(token);
    const mapId = await createMap(token, adventureId);
    await markMapDeleted(mapId);

    const res = await apiGet(app, `/api/adventures/${adventureId}/maps/${mapId}`, token);
    expect(res.status).toBe(404);
  });

  test('GET /api/adventures/:id/maps/:mapId returns 404 when the adventure is soft-deleted', async () => {
    const { token } = await registerUser(app);
    const adventureId = await createAdventure(token);
    const mapId = await createMap(token, adventureId);
    await markAdventureDeleted(adventureId);

    const res = await apiGet(app, `/api/adventures/${adventureId}/maps/${mapId}`, token);
    expect(res.status).toBe(404);
  });
});

describe('soft-delete: image list', () => {
  test('GET /api/images excludes soft-deleted images', async () => {
    const { token } = await registerHigherUser(app);
    const live = await uploadImage(token, 'Live');
    const deleted = await uploadImage(token, 'Deleted');
    await markImageDeleted(deleted.id);

    const res = await apiGet(app, '/api/images', token);
    expect(res.status).toBe(200);
    const ids = ((await res.json()) as { images: { id: string }[] }).images.map(i => i.id);
    expect(ids).toContain(live.id);
    expect(ids).not.toContain(deleted.id);
  });
});

describe('soft-delete: profile aggregation', () => {
  test('snapshotProfile excludes soft-deleted adventures', async () => {
    const { token, uid } = await registerUser(app);
    const live = await createAdventure(token, 'Live');
    const deleted = await createAdventure(token, 'Deleted');
    await markAdventureDeleted(deleted);

    const profile = await snapshotProfile(db, uid);
    const ids = (profile?.adventures ?? []).map(a => a.id);
    expect(ids).toContain(live);
    expect(ids).not.toContain(deleted);
  });
});

// ── Banned-user rejection (HTTP) ─────────────────────────────────────────────

describe('banned user: API rejection', () => {
  test('a banned user gets 403 account-suspended on an API route', async () => {
    const { token, uid } = await registerUser(app);
    await markUserBanned(uid);

    const res = await apiGet(app, '/api/adventures', token);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('account-suspended');
  });

  test('a banned admin is rejected from admin routes', async () => {
    const { token, uid } = await registerAdminUser(app);
    await markUserBanned(uid);

    const res = await apiGet(app, '/api/admin/users?q=nobody@example.com', token);
    expect(res.status).toBe(403);
  });
});

// ── Image download access ────────────────────────────────────────────────────

describe('soft-delete: image download access', () => {
  test('a soft-deleted image returns 404 even for its owner', async () => {
    const { token, uid } = await registerHigherUser(app);
    const image = await uploadImage(token, 'Doomed');
    // Live: the owner can download it.
    await expect(assertImageDownloadAccess(db, silentLogger, uid, image.path)).resolves.toBeUndefined();

    await markImageDeleted(image.id);
    await expect(assertImageDownloadAccess(db, silentLogger, uid, image.path)).rejects.toThrow();
  });

  test('a leading slash on the path behaves like the canonical path (live)', async () => {
    const { token, uid } = await registerHigherUser(app);
    const image = await uploadImage(token, 'Slashed');

    // Canonical (no leading slash) — owner shortcut returns.
    await expect(
      assertImageDownloadAccess(db, silentLogger, uid, image.path),
    ).resolves.toBeUndefined();
    // Leading slash must match the same behaviour: owner can download.
    await expect(
      assertImageDownloadAccess(db, silentLogger, uid, `/${image.path}`),
    ).resolves.toBeUndefined();
  });

  test('a leading slash on the path still 404s a soft-deleted image', async () => {
    const { token, uid } = await registerHigherUser(app);
    const image = await uploadImage(token, 'Slashed-doomed');
    await markImageDeleted(image.id);

    await expect(
      assertImageDownloadAccess(db, silentLogger, uid, `/${image.path}`),
    ).rejects.toThrow();
  });
});

// ── Spritesheet montage ──────────────────────────────────────────────────────

describe('soft-delete: spritesheet montage', () => {
  test('a soft-deleted source image is skipped without aborting the montage', async () => {
    const { token, uid } = await registerHigherUser(app);
    const adventureId = await createAdventure(token);
    const good = await uploadImage(token, 'good');
    const gone = await uploadImage(token, 'gone');
    await markImageDeleted(gone.id);

    // The soft-deleted source is dropped exactly like a 404 — the montage
    // still succeeds with the good source.
    const result = await addSprites(
      db, silentLogger, storage, uid, adventureId, '2x2', [good.path, gone.path],
    );
    expect(result.some(s => s.source === good.path)).toBe(true);
    expect(result.some(s => s.source === gone.path)).toBe(false);
  }, 60000);
});

// ── Invite paths ─────────────────────────────────────────────────────────────

describe('soft-delete: invite paths', () => {
  async function createInvite(token: string, adventureId: string): Promise<string> {
    const res = await apiPost(app, `/api/adventures/${adventureId}/invites`, {}, token);
    expect(res.status).toBe(200);
    return ((await res.json()) as { inviteId: string }).inviteId;
  }

  test('GET /api/invites/:id returns 404 for a soft-deleted adventure', async () => {
    const { token } = await registerUser(app);
    const adventureId = await createAdventure(token);
    const inviteId = await createInvite(token, adventureId);
    await markAdventureDeleted(adventureId);

    const res = await apiGet(app, `/api/invites/${inviteId}`, token);
    expect(res.status).toBe(404);
  });

  test('POST /api/invites/:id/join returns 404 for a soft-deleted adventure and inserts no membership', async () => {
    const owner = await registerUser(app);
    const adventureId = await createAdventure(owner.token);
    const inviteId = await createInvite(owner.token, adventureId);
    await markAdventureDeleted(adventureId);

    const joiner = await registerUser(app);
    const res = await apiPost(app, `/api/invites/${inviteId}/join`, {}, joiner.token);
    expect(res.status).toBe(404);

    const rows = await db.select({ userId: adventurePlayers.userId })
      .from(adventurePlayers)
      .where(and(
        eq(adventurePlayers.adventureId, adventureId),
        eq(adventurePlayers.userId, joiner.uid),
      ));
    expect(rows).toHaveLength(0);
  });
});

// ── Write paths on a soft-deleted adventure all 404 ─────────────────────────

describe('soft-delete: owner mutations on a soft-deleted adventure return 404', () => {
  test('PATCH /api/adventures/:id', async () => {
    const { token } = await registerUser(app);
    const adventureId = await createAdventure(token);
    await markAdventureDeleted(adventureId);

    const res = await apiPatch(app, `/api/adventures/${adventureId}`, { name: 'New' }, token);
    expect(res.status).toBe(404);
  });

  test('POST /api/adventures/:id/maps', async () => {
    const { token } = await registerUser(app);
    const adventureId = await createAdventure(token);
    await markAdventureDeleted(adventureId);

    const res = await apiPost(app, `/api/adventures/${adventureId}/maps`, {
      name: 'M', description: '', ty: MapType.Square, ffa: false, enableGroupVision: false,
    }, token);
    expect(res.status).toBe(404);
  });

  test('POST /api/adventures/:id/maps/:mapId/clone', async () => {
    const { token } = await registerUser(app);
    const adventureId = await createAdventure(token);
    const mapId = await createMap(token, adventureId);
    await markAdventureDeleted(adventureId);

    const res = await apiPost(app, `/api/adventures/${adventureId}/maps/${mapId}/clone`,
      { name: 'Copy' }, token);
    expect(res.status).toBe(404);
  });

  test('PATCH /api/adventures/:id/maps/:mapId', async () => {
    const { token } = await registerUser(app);
    const adventureId = await createAdventure(token);
    const mapId = await createMap(token, adventureId);
    await markAdventureDeleted(adventureId);

    const res = await apiPatch(app, `/api/adventures/${adventureId}/maps/${mapId}`,
      { name: 'New' }, token);
    expect(res.status).toBe(404);
  });

  test('DELETE /api/adventures/:id/maps/:mapId', async () => {
    const { token } = await registerUser(app);
    const adventureId = await createAdventure(token);
    const mapId = await createMap(token, adventureId);
    await markAdventureDeleted(adventureId);

    const res = await apiDelete(app, `/api/adventures/${adventureId}/maps/${mapId}`, token);
    expect(res.status).toBe(404);
  });

  test('POST /api/adventures/:id/maps/:mapId/consolidate', async () => {
    const { token } = await registerUser(app);
    const adventureId = await createAdventure(token);
    const mapId = await createMap(token, adventureId);
    await markAdventureDeleted(adventureId);

    const res = await apiPost(app, `/api/adventures/${adventureId}/maps/${mapId}/consolidate`,
      {}, token);
    expect(res.status).toBe(404);
  });

  test('POST /api/adventures/:id/invites', async () => {
    const { token } = await registerUser(app);
    const adventureId = await createAdventure(token);
    await markAdventureDeleted(adventureId);

    const res = await apiPost(app, `/api/adventures/${adventureId}/invites`, {}, token);
    expect(res.status).toBe(404);
  });
});

// ── Quota counts ignore soft-deleted rows ───────────────────────────────────

describe('soft-delete: quota counts ignore soft-deleted rows', () => {
  test('adventure quota: a soft-deleted adventure does not consume a slot', async () => {
    const { token } = await registerUser(app);
    const policy = getUserPolicy(UserLevel.Basic);
    // Fill the cap exactly.
    for (let i = 0; i < policy.adventures; i++) {
      await createAdventure(token, `Adv ${i}`);
    }
    // Soft-delete one — must free a slot.
    const ids = ((await (await apiGet(app, '/api/adventures', token)).json()) as { id: string }[])
      .map(a => a.id);
    await markAdventureDeleted(ids[0]);

    const res = await apiPost(app, '/api/adventures', { name: 'Replacement', description: '' }, token);
    expect(res.status).toBe(201);
  });

  test('map quota: a soft-deleted map does not consume a slot', async () => {
    const { token } = await registerUser(app);
    const adventureId = await createAdventure(token);
    const policy = getUserPolicy(UserLevel.Basic);
    const mapIds: string[] = [];
    for (let i = 0; i < policy.maps; i++) {
      mapIds.push(await createMap(token, adventureId, `Map ${i}`));
    }
    await markMapDeleted(mapIds[0]);

    const res = await apiPost(app, `/api/adventures/${adventureId}/maps`, {
      name: 'Replacement', description: '', ty: MapType.Square, ffa: false, enableGroupVision: false,
    }, token);
    expect(res.status).toBe(201);
  });

  test('clone-map quota: a soft-deleted map does not consume a slot', async () => {
    const { token } = await registerUser(app);
    const adventureId = await createAdventure(token);
    const policy = getUserPolicy(UserLevel.Basic);
    const mapIds: string[] = [];
    for (let i = 0; i < policy.maps; i++) {
      mapIds.push(await createMap(token, adventureId, `Map ${i}`));
    }
    // Soft-delete one to free a slot; clone a live source map.
    await markMapDeleted(mapIds[0]);
    const sourceId = mapIds[1];

    const res = await apiPost(app, `/api/adventures/${adventureId}/maps/${sourceId}/clone`,
      { name: 'Clone' }, token);
    expect(res.status).toBe(201);
  });

  test('image quota: a soft-deleted image does not consume a slot', async () => {
    const { token, uid } = await registerHigherUser(app);
    const policy = getUserPolicy(UserLevel.Higher);
    // Insert images at the cap directly via the DB (rather than via the upload
    // route) so we don't touch S3 200 times for one assertion.
    const rows = Array.from({ length: policy.images }, (_, i) => ({
      id: `00000000-0000-7000-8000-${String(i).padStart(12, '0')}`,
      userId: uid,
      name: `image-${i}`,
      path: `images/${uid}/seed-${i}`,
    }));
    await db.insert(images).values(rows);
    // Soft-delete them all — live count back to zero.
    await db.update(images).set({ deletedAt: new Date() }).where(eq(images.userId, uid));

    const res = await apiUploadImage(app, token, TINY_PNG, 'pic.png', 'image/png', 'after-cleanup');
    expect(res.status).toBe(201);
  });
});

// ── Admin still inspects soft-deleted content ────────────────────────────────

describe('soft-delete: admin account-info', () => {
  test('GET /api/admin/users/:id still lists a banned account\'s soft-deleted content', async () => {
    const { token: adminToken } = await registerAdminUser(app);
    const target = await registerHigherUser(app, 'Target', `target-${uuidv7()}@example.com`);

    const adventureId = await createAdventure(target.token, 'Soft-deleted Adv');
    const mapId = await createMap(target.token, adventureId, 'Soft-deleted Map');
    const image = await uploadImage(target.token, 'Soft-deleted Image');

    // Soft-delete everything the target owns, then ban the target.
    await markAdventureDeleted(adventureId);
    await markMapDeleted(mapId);
    await markImageDeleted(image.id);
    await markUserBanned(target.uid);

    const res = await apiGet(app, `/api/admin/users/${target.uid}`, adminToken);
    expect(res.status).toBe(200);
    const body = await res.json();
    // Admin aggregation deliberately does not filter soft-deleted rows.
    expect(body.adventures.some((a: { id: string }) => a.id === adventureId)).toBe(true);
    expect(body.maps.some((m: { id: string }) => m.id === mapId)).toBe(true);
    expect(body.images.some((i: { id: string }) => i.id === image.id)).toBe(true);
  });
});

// ── WebSocket: banned upgrade + soft-deleted subscriptions ───────────────────

const WS_CLOSE_ACCOUNT_SUSPENDED = 4003;

describe('soft-delete + ban: WebSocket', () => {
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
      res.end(Buffer.from(await response.arrayBuffer()));
    });
    server.on('upgrade', createUpgradeHandler(wss, rooms));

    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address();
        port = typeof addr === 'object' && addr ? addr.port : 0;
        resolve();
      });
    });

    const dbUrl = process.env.DATABASE_URL ?? 'postgresql://was:wasdev@localhost:5432/wallandshadow';
    const listener = await startNotifyListener(dbUrl, rooms);
    stopNotify = listener.stop;
  });

  afterAll(async () => {
    if (stopNotify) await stopNotify();
    wss.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  // Open a socket and resolve when it connects; rejects on error.
  function connectWs(token: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${port}/ws?token=${token}`);
      ws.on('open', () => resolve(ws));
      ws.on('error', reject);
      setTimeout(() => reject(new Error('WebSocket connect timeout')), 5000);
    });
  }

  function send(ws: WebSocket, frame: Record<string, unknown>): void {
    ws.send(JSON.stringify(frame));
  }

  // Wait for the first frame matching `predicate`.
  function waitForFrame(
    ws: WebSocket,
    predicate: (f: Record<string, unknown>) => boolean,
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        ws.off('message', handler);
        reject(new Error('WS frame predicate timeout'));
      }, 5000);
      const handler = (data: WebSocket.Data) => {
        try {
          const f = JSON.parse(data.toString()) as Record<string, unknown>;
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

  test('a banned user is rejected at WS upgrade with close code 4003', async () => {
    const { token, uid } = await registerUser(app);
    await markUserBanned(uid);

    const ws = new WebSocket(`ws://localhost:${port}/ws?token=${token}`);
    const code = await new Promise<number>((resolve, reject) => {
      ws.on('close', (c: number) => resolve(c));
      ws.on('error', reject);
      setTimeout(() => reject(new Error('WS close timeout')), 5000);
    });
    expect(code).toBe(WS_CLOSE_ACCOUNT_SUSPENDED);
  });

  test('subscribing to a soft-deleted adventure fails cleanly', async () => {
    const { token } = await registerUser(app);
    const adventureId = await createAdventure(token);
    await markAdventureDeleted(adventureId);

    const ws = await connectWs(token);
    try {
      send(ws, { type: 'subscribe', subId: 1, scope: 'adventure', id: adventureId });
      const frame = await waitForFrame(ws, f => f.type === 'subscribeError' && f.subId === 1);
      expect(frame.type).toBe('subscribeError');
    } finally {
      ws.close();
    }
  });

  test('subscribing to a soft-deleted map fails cleanly', async () => {
    const { token } = await registerUser(app);
    const adventureId = await createAdventure(token);
    const mapId = await createMap(token, adventureId);
    await markMapDeleted(mapId);

    const ws = await connectWs(token);
    try {
      send(ws, { type: 'subscribe', subId: 1, scope: 'map', id: mapId });
      const frame = await waitForFrame(ws, f => f.type === 'subscribeError' && f.subId === 1);
      expect(frame.type).toBe('subscribeError');
    } finally {
      ws.close();
    }
  });

  test('a mapChange targeting a soft-deleted map is rejected', async () => {
    const { token, uid } = await registerUser(app);
    const adventureId = await createAdventure(token);
    const mapId = await createMap(token, adventureId);
    await markMapDeleted(mapId);

    const ws = await connectWs(token);
    try {
      send(ws, {
        type: 'mapChange', ackId: 7, adventureId, mapId,
        chs: [createAddToken1(uid)], idempotencyKey: uuidv7(),
      });
      const ack = await waitForFrame(ws, f => f.type === 'mapChangeAck' && f.ackId === 7);
      expect(ack.error).toBeDefined();
    } finally {
      ws.close();
    }
  });
});
