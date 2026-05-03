import { describe, test, expect, afterAll, beforeAll, beforeEach } from 'vitest';
import { createServer, type Server } from 'http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { PresenceUserState } from '@wallandshadow/shared';
import { createApp } from '../app.js';
import { RoomManager, type Rooms } from '../ws/rooms.js';
import { createUpgradeHandler } from '../ws/handler.js';
import {
  hasAdventureState,
  resetPresenceForTesting,
  setPresenceIdleTtlMsForTesting,
  getPresenceIdleTtlMs,
} from '../ws/presence.js';
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

const TEST_TTL_MS = 200;

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

  setPresenceIdleTtlMsForTesting(TEST_TTL_MS);
});

afterAll(async () => {
  setPresenceIdleTtlMsForTesting(5 * 60 * 1000);
  wss.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  resetPresenceForTesting();
});

// ── Helpers ─────────────────────────────────────────────────────────────────

async function subscribePresence(
  ws: WebSocket,
  adventureId: string,
  subId = 1,
): Promise<PresenceUserState[]> {
  send(ws, { type: 'subscribe', subId, scope: 'presence', id: adventureId });
  const snap = await waitForFrame(
    ws,
    f => f.type === 'snapshot' && f.subId === subId && f.scope === 'presence',
  );
  return snap.data as PresenceUserState[];
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('presence subscription', () => {
  test('snapshot includes self as connected', async () => {
    const owner = await registerUser(app, 'PresenceSelf');
    const aId = await createAdventure(app, owner.token);

    const ws = await connectWs(port, owner.token);
    const snap = await subscribePresence(ws, aId);
    expect(snap).toHaveLength(1);
    expect(snap[0].userId).toBe(owner.uid);
    expect(snap[0].connected).toBe(true);

    ws.close();
    // Wait past TTL so the per-user removal fires before the next test runs.
    await new Promise(r => setTimeout(r, TEST_TTL_MS + 100));
  });

  test('non-member cannot subscribe to presence', async () => {
    const owner = await registerUser(app, 'PresenceOwner1');
    const outsider = await registerUser(app, 'PresenceOutsider');
    const aId = await createAdventure(app, owner.token);

    const ws = await connectWs(port, outsider.token);
    send(ws, { type: 'subscribe', subId: 1, scope: 'presence', id: aId });
    const err = await waitForFrame(
      ws,
      f => f.type === 'subscribeError' && f.subId === 1,
    );
    expect(err.message).toMatch(/Adventure not found/);
    ws.close();
  });

  test('peer sees connect, disconnect within TTL, then removal', async () => {
    const owner = await registerUser(app, 'PresOwner2');
    const guest = await registerUser(app, 'PresGuest2');
    const aId = await createAdventure(app, owner.token);
    await joinAdventure(app, owner.token, guest.token, aId);
    await createMap(app, owner.token, aId);

    // Owner connects first and subscribes.
    const ownerWs = await connectWs(port, owner.token);
    const initialSnap = await subscribePresence(ownerWs, aId);
    expect(initialSnap.map(u => u.userId)).toEqual([owner.uid]);

    // Guest connects — owner should receive a roomUpdate that includes guest.
    const guestWs = await connectWs(port, guest.token);
    const updatePromise = waitForFrame(
      ownerWs,
      f => f.type === 'roomUpdate' && f.scope === 'presence' && f.key === aId,
    );
    const guestSnap = await subscribePresence(guestWs, aId);
    expect(guestSnap.map(u => u.userId).sort()).toEqual([owner.uid, guest.uid].sort());
    const upd = await updatePromise;
    const updUsers = upd.data as PresenceUserState[];
    expect(updUsers.find(u => u.userId === guest.uid)?.connected).toBe(true);

    // Guest disconnects — owner sees guest flip to connected:false (within TTL).
    const disconnectPromise = waitForFrame(
      ownerWs,
      f => {
        if (f.type !== 'roomUpdate' || f.scope !== 'presence' || f.key !== aId) return false;
        const users = f.data as PresenceUserState[];
        const g = users.find(u => u.userId === guest.uid);
        return g !== undefined && g.connected === false;
      },
    );
    guestWs.close();
    const disc = await disconnectPromise;
    const discUsers = disc.data as PresenceUserState[];
    expect(discUsers.find(u => u.userId === guest.uid)?.connected).toBe(false);

    // Wait past TTL — owner sees guest removed entirely.
    const removalPromise = waitForFrame(
      ownerWs,
      f => {
        if (f.type !== 'roomUpdate' || f.scope !== 'presence' || f.key !== aId) return false;
        const users = f.data as PresenceUserState[];
        return users.find(u => u.userId === guest.uid) === undefined;
      },
      TEST_TTL_MS + 2000,
    );
    const removed = await removalPromise;
    expect((removed.data as PresenceUserState[]).map(u => u.userId)).toEqual([owner.uid]);

    ownerWs.close();
    await new Promise(r => setTimeout(r, TEST_TTL_MS + 100));
  });

  test('reconnect within TTL cancels removal — no removal frame fires', async () => {
    const owner = await registerUser(app, 'PresOwner3');
    const guest = await registerUser(app, 'PresGuest3');
    const aId = await createAdventure(app, owner.token);
    await joinAdventure(app, owner.token, guest.token, aId);

    const ownerWs = await connectWs(port, owner.token);
    await subscribePresence(ownerWs, aId);

    // Listener BEFORE triggering — broadcast can land before subscribePresence
    // resolves on the guest socket.
    const guestWs1 = await connectWs(port, guest.token);
    const connectPromise = waitForFrame(
      ownerWs,
      f => {
        if (f.type !== 'roomUpdate' || f.scope !== 'presence') return false;
        const users = f.data as PresenceUserState[];
        return users.find(u => u.userId === guest.uid)?.connected === true;
      },
    );
    await subscribePresence(guestWs1, aId);
    await connectPromise;

    // Disconnect guest, wait for connected:false frame.
    const disconnectPromise = waitForFrame(
      ownerWs,
      f => {
        if (f.type !== 'roomUpdate' || f.scope !== 'presence') return false;
        const users = f.data as PresenceUserState[];
        return users.find(u => u.userId === guest.uid)?.connected === false;
      },
    );
    guestWs1.close();
    await disconnectPromise;

    // Reconnect well within TTL; observe owner sees connected:true again.
    await new Promise(r => setTimeout(r, Math.floor(TEST_TTL_MS / 2)));
    const reconnectPromise = waitForFrame(
      ownerWs,
      f => {
        if (f.type !== 'roomUpdate' || f.scope !== 'presence') return false;
        const users = f.data as PresenceUserState[];
        return users.find(u => u.userId === guest.uid)?.connected === true;
      },
    );
    const guestWs2 = await connectWs(port, guest.token);
    await subscribePresence(guestWs2, aId);
    await reconnectPromise;

    // Now wait past the original TTL — there must be NO removal frame.
    const noRemoval = await noFrameWithin(
      ownerWs,
      f => {
        if (f.type !== 'roomUpdate' || f.scope !== 'presence') return false;
        const users = f.data as PresenceUserState[];
        return users.find(u => u.userId === guest.uid) === undefined;
      },
      TEST_TTL_MS + 200,
    );
    expect(noRemoval).toBe(true);

    ownerWs.close();
    guestWs2.close();
    await new Promise(r => setTimeout(r, TEST_TTL_MS + 100));
  });

  test('two tabs of same user count as one — closing one keeps connected', async () => {
    const owner = await registerUser(app, 'PresOwner4');
    const guest = await registerUser(app, 'PresGuest4');
    const aId = await createAdventure(app, owner.token);
    await joinAdventure(app, owner.token, guest.token, aId);

    const ownerWs = await connectWs(port, owner.token);
    await subscribePresence(ownerWs, aId);

    // Guest opens two tabs.
    const guestTab1 = await connectWs(port, guest.token);
    const connectPromise = waitForFrame(
      ownerWs,
      f => {
        if (f.type !== 'roomUpdate' || f.scope !== 'presence') return false;
        return (f.data as PresenceUserState[]).find(u => u.userId === guest.uid)?.connected === true;
      },
    );
    await subscribePresence(guestTab1, aId);
    await connectPromise;

    const guestTab2 = await connectWs(port, guest.token);
    await subscribePresence(guestTab2, aId);

    // Closing tab1 while tab2 is still open must NOT flip the guest to disconnected.
    guestTab1.close();
    const noFlip = await noFrameWithin(
      ownerWs,
      f => {
        if (f.type !== 'roomUpdate' || f.scope !== 'presence') return false;
        return (f.data as PresenceUserState[]).find(u => u.userId === guest.uid)?.connected === false;
      },
      300,
    );
    expect(noFlip).toBe(true);

    // Close the second tab — now we should see disconnected:false.
    const flipPromise = waitForFrame(
      ownerWs,
      f => {
        if (f.type !== 'roomUpdate' || f.scope !== 'presence') return false;
        return (f.data as PresenceUserState[]).find(u => u.userId === guest.uid)?.connected === false;
      },
    );
    guestTab2.close();
    await flipPromise;

    ownerWs.close();
    await new Promise(r => setTimeout(r, TEST_TTL_MS + 100));
  });

  // Modelling navigate-away: the client unsubscribes from `presence` without
  // closing its WebSocket (the socket stays multiplexed across the app). The
  // server must treat explicit unsubscribe the same as socket close —
  // otherwise the user stays green on peers' screens until they navigate to
  // a different adventure or close the tab entirely.
  test('explicit unsubscribe flips user to connected:false', async () => {
    const owner = await registerUser(app, 'PresOwnerNavAway');
    const guest = await registerUser(app, 'PresGuestNavAway');
    const aId = await createAdventure(app, owner.token);
    await joinAdventure(app, owner.token, guest.token, aId);

    const ownerWs = await connectWs(port, owner.token);
    await subscribePresence(ownerWs, aId);

    // Listener BEFORE triggering — the server can broadcast before the
    // guest's snapshot frame returns.
    const guestWs = await connectWs(port, guest.token);
    const connectPromise = waitForFrame(
      ownerWs,
      f => {
        if (f.type !== 'roomUpdate' || f.scope !== 'presence') return false;
        return (f.data as PresenceUserState[]).find(u => u.userId === guest.uid)?.connected === true;
      },
    );
    await subscribePresence(guestWs, aId, /* subId */ 7);
    await connectPromise;

    // Guest unsubscribes WITHOUT closing the socket — the navigate-away case.
    const flipPromise = waitForFrame(
      ownerWs,
      f => {
        if (f.type !== 'roomUpdate' || f.scope !== 'presence') return false;
        return (f.data as PresenceUserState[]).find(u => u.userId === guest.uid)?.connected === false;
      },
    );
    send(guestWs, { type: 'unsubscribe', subId: 7 });
    const flip = await flipPromise;
    const flipUsers = flip.data as PresenceUserState[];
    expect(flipUsers.find(u => u.userId === guest.uid)?.connected).toBe(false);

    // Guest's WS is still open (still subscribed to other scopes in real
    // app usage) — confirm the presence flip didn't depend on close.
    expect(guestWs.readyState).toBe(guestWs.OPEN);

    guestWs.close();
    ownerWs.close();
    await new Promise(r => setTimeout(r, TEST_TTL_MS + 100));
  });

  test('registry GCs adventure when last user TTLs out', async () => {
    const owner = await registerUser(app, 'PresOwner5');
    const aId = await createAdventure(app, owner.token);

    const ws = await connectWs(port, owner.token);
    await subscribePresence(ws, aId);
    expect(hasAdventureState(aId)).toBe(true);

    ws.close();
    // Disconnect → state still around (entry pending TTL).
    await new Promise(r => setTimeout(r, 50));
    expect(hasAdventureState(aId)).toBe(true);

    // Wait past TTL — registry entry GC'd.
    await new Promise(r => setTimeout(r, TEST_TTL_MS + 200));
    expect(hasAdventureState(aId)).toBe(false);
  });

  test('TTL constant getter returns the active value', () => {
    expect(getPresenceIdleTtlMs()).toBe(TEST_TTL_MS);
  });
});
