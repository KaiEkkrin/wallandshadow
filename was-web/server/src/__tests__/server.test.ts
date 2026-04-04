import { describe, test, expect } from 'vitest';
import { MapType, ChangeCategory, ChangeType } from '@wallandshadow/shared';
import type { TokenAdd, WallAdd } from '@wallandshadow/shared';
import { createApp } from '../app.js';
import { db } from '../db/connection.js';
import { adventures, adventurePlayers, maps, mapChanges, invites } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import {
  registerUser,
  apiPost,
  apiDelete,
  seedMapChanges,
  getBaseChange,
  countMapChanges,
  createAddToken1,
  createMoveToken1,
  createAddWall1,
} from './helpers.js';

const app = createApp();

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function createAdventure(token: string, name = 'Adventure One', description = 'First adventure'): Promise<string> {
  const res = await apiPost(app, '/api/adventures', { name, description }, token);
  expect(res.status).toBe(201);
  const { id } = await res.json<{ id: string }>();
  return id;
}

async function createMap(
  token: string,
  adventureId: string,
  name = 'Map One',
  description = 'First map',
  ty: MapType = MapType.Square,
  ffa = false,
): Promise<string> {
  const res = await apiPost(app, `/api/adventures/${adventureId}/maps`, { name, description, ty, ffa }, token);
  expect(res.status).toBe(201);
  const { id } = await res.json<{ id: string }>();
  return id;
}

async function consolidate(token: string, adventureId: string, mapId: string): Promise<void> {
  const res = await apiPost(app, `/api/adventures/${adventureId}/maps/${mapId}/consolidate`, {}, token);
  expect(res.status).toBe(204);
}

function verifyBaseChange(base: ReturnType<typeof getBaseChange> extends Promise<infer T> ? T : never, uid: string, expectedX: number) {
  expect(base).not.toBeUndefined();
  expect(base!.chs).toHaveLength(2);

  const tokenRecord = base!.chs.find(ch => ch.cat === ChangeCategory.Token) as TokenAdd | undefined;
  expect(tokenRecord?.ty).toBe(ChangeType.Add);
  expect((tokenRecord as TokenAdd).feature.id).toBe('token1');
  expect((tokenRecord as TokenAdd).feature.position.x).toBe(expectedX);
  expect((tokenRecord as TokenAdd).feature.position.y).toBe(3);

  const wallRecord = base!.chs.find(ch => ch.cat === ChangeCategory.Wall) as WallAdd | undefined;
  expect(wallRecord?.ty).toBe(ChangeType.Add);
  expect((wallRecord as WallAdd).feature.position.x).toBe(0);
  expect((wallRecord as WallAdd).feature.position.y).toBe(0);
  expect((wallRecord as WallAdd).feature.colour).toBe(0);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('server integration tests', () => {
  // ── Adventures and maps ──────────────────────────────────────────────────

  describe('adventures and maps', () => {
    test('create and delete adventures and maps', async () => {
      const { token, uid } = await registerUser(app, 'Owner');

      // Create two adventures
      const a1Id = await createAdventure(token, 'Adventure One', 'First adventure');
      const a2Id = await createAdventure(token, 'Adventure Two', 'Second adventure');
      expect(a1Id).not.toBe(a2Id);

      // Verify both exist in DB
      const [a1Row] = await db.select().from(adventures).where(eq(adventures.id, a1Id));
      expect(a1Row?.name).toBe('Adventure One');
      expect(a1Row?.ownerId).toBe(uid);

      const [a2Row] = await db.select().from(adventures).where(eq(adventures.id, a2Id));
      expect(a2Row?.name).toBe('Adventure Two');

      // Create a map in each adventure
      const m1Id = await createMap(token, a1Id, 'Map One', 'First map', MapType.Square, false);
      const m2Id = await createMap(token, a2Id, 'Map Two', 'Second map', MapType.Hex, true);

      // Verify map records
      const [m1Row] = await db.select().from(maps).where(eq(maps.id, m1Id));
      expect(m1Row?.name).toBe('Map One');
      expect(m1Row?.ty).toBe(MapType.Square);
      expect(m1Row?.ffa).toBe(false);

      const [m2Row] = await db.select().from(maps).where(eq(maps.id, m2Id));
      expect(m2Row?.name).toBe('Map Two');
      expect(m2Row?.ty).toBe(MapType.Hex);
      expect(m2Row?.ffa).toBe(true);

      // Delete map 1
      const delMapRes = await apiDelete(app, `/api/adventures/${a1Id}/maps/${m1Id}`, token);
      expect(delMapRes.status).toBe(204);

      const [m1After] = await db.select().from(maps).where(eq(maps.id, m1Id));
      expect(m1After).toBeUndefined();

      // Adventure 2 and map 2 should still exist
      const [a2After] = await db.select().from(adventures).where(eq(adventures.id, a2Id));
      expect(a2After?.name).toBe('Adventure Two');
      const [m2After] = await db.select().from(maps).where(eq(maps.id, m2Id));
      expect(m2After?.name).toBe('Map Two');

      // Delete adventure 2
      const delAdvRes = await apiDelete(app, `/api/adventures/${a2Id}`, token);
      expect(delAdvRes.status).toBe(204);

      const [a2Gone] = await db.select().from(adventures).where(eq(adventures.id, a2Id));
      expect(a2Gone).toBeUndefined();

      // Map 2 should also be gone via CASCADE
      const [m2Gone] = await db.select().from(maps).where(eq(maps.id, m2Id));
      expect(m2Gone).toBeUndefined();
    });
  });

  // ── Consolidation ────────────────────────────────────────────────────────

  async function testConsolidate(moveCount: number) {
    const { token, uid } = await registerUser(app);
    const a1Id = await createAdventure(token);
    const m1Id = await createMap(token, a1Id, 'Map One', 'First map', MapType.Hex);

    // Seed changes: addToken + N moves + addWall
    // TODO Phase 4: replace direct DB insert with WebSocket client once real-time sync is implemented
    await seedMapChanges(m1Id, uid, [createAddToken1(uid)]);
    for (let i = 0; i < moveCount; ++i) {
      await seedMapChanges(m1Id, uid, [createMoveToken1(i)]);
    }
    await seedMapChanges(m1Id, uid, [createAddWall1()]);

    // Verify incremental rows exist
    const incrementalCount = await countMapChanges(m1Id);
    expect(incrementalCount).toBe(2 + moveCount);

    // Consolidate
    await consolidate(token, a1Id, m1Id);

    // Only one base change should remain
    const base = await getBaseChange(m1Id);
    const totalAfter = await countMapChanges(m1Id);
    expect(totalAfter).toBe(1);
    verifyBaseChange(base, uid, moveCount);

    // Consolidate again with more moves (tests consolidation with existing base change)
    for (let i = moveCount; i < moveCount * 2; ++i) {
      await seedMapChanges(m1Id, uid, [createMoveToken1(i)]);
    }
    await consolidate(token, a1Id, m1Id);

    const base2 = await getBaseChange(m1Id);
    const totalAfter2 = await countMapChanges(m1Id);
    expect(totalAfter2).toBe(1);
    verifyBaseChange(base2, uid, moveCount * 2);
  }

  describe('consolidation', () => {
    test('consolidate 1 move', () => testConsolidate(1));
    test('consolidate 2 moves', () => testConsolidate(2));
    test('consolidate 10 moves', () => testConsolidate(10));
    test('consolidate 200 moves', () => testConsolidate(200), 120000);
    test('consolidate 600 moves', () => testConsolidate(600), 300000);
  });

  // ── Invites ──────────────────────────────────────────────────────────────

  describe('invites', () => {
    test('join an adventure via invite', async () => {
      const owner = await registerUser(app, 'Owner');
      const user = await registerUser(app, 'User 1');

      const a1Id = await createAdventure(owner.token);
      const m1Id = await createMap(owner.token, a1Id);

      // Create an invite
      const inviteRes = await apiPost(app, `/api/adventures/${a1Id}/invites`, {}, owner.token);
      expect(inviteRes.status).toBe(200);
      const { inviteId } = await inviteRes.json<{ inviteId: string }>();
      expect(inviteId).toBeTruthy();

      // User joins via invite
      const joinRes = await apiPost(app, `/api/invites/${inviteId}/join`, {}, user.token);
      expect(joinRes.status).toBe(200);
      const { adventureId } = await joinRes.json<{ adventureId: string }>();
      expect(adventureId).toBe(a1Id);

      // Verify the player record was created
      const [playerRow] = await db.select()
        .from(adventurePlayers)
        .where(and(
          eq(adventurePlayers.adventureId, a1Id),
          eq(adventurePlayers.userId, user.uid),
        ));
      expect(playerRow?.allowed).toBe(true);
      expect(playerRow?.playerName).toBe('User 1');

      // Joining again should be idempotent
      const joinRes2 = await apiPost(app, `/api/invites/${inviteId}/join`, {}, user.token);
      expect(joinRes2.status).toBe(200);
    });

    test('invites expire', async () => {
      const owner = await registerUser(app, 'Owner');
      const user1 = await registerUser(app, 'User 1');
      const user2 = await registerUser(app, 'User 2');

      const a1Id = await createAdventure(owner.token);

      const testPolicy = { timeUnit: 'second', recreate: 2, expiry: 3, deletion: 15 };

      // Create invite with short expiry
      const inviteRes = await apiPost(app, `/api/adventures/${a1Id}/invites`, { policy: testPolicy }, owner.token);
      expect(inviteRes.status).toBe(200);
      const { inviteId: invite } = await inviteRes.json<{ inviteId: string }>();

      // Re-issuing immediately should return the same invite
      const inviteRes2 = await apiPost(app, `/api/adventures/${a1Id}/invites`, { policy: testPolicy }, owner.token);
      const { inviteId: invite2 } = await inviteRes2.json<{ inviteId: string }>();
      expect(invite2).toBe(invite);

      // User 1 can join with the current invite
      const join1Res = await apiPost(app, `/api/invites/${invite}/join`, { policy: testPolicy }, user1.token);
      expect(join1Res.status).toBe(200);

      // Wait for the invite to expire
      await new Promise(r => setTimeout(r, 4000));

      // User 2 cannot join with the expired invite
      const join2Res = await apiPost(app, `/api/invites/${invite}/join`, { policy: testPolicy }, user2.token);
      expect(join2Res.status).toBe(408);

      // User 2 should not have been added as a player
      const players = await db.select()
        .from(adventurePlayers)
        .where(and(
          eq(adventurePlayers.adventureId, a1Id),
          eq(adventurePlayers.userId, user2.uid),
        ));
      expect(players).toHaveLength(0);

      // Owner creates a new invite
      const inviteRes3 = await apiPost(app, `/api/adventures/${a1Id}/invites`, { policy: testPolicy }, owner.token);
      const { inviteId: invite3 } = await inviteRes3.json<{ inviteId: string }>();
      expect(invite3).not.toBe(invite);

      // User 2 can now join with the new invite
      const join3Res = await apiPost(app, `/api/invites/${invite3}/join`, { policy: testPolicy }, user2.token);
      expect(join3Res.status).toBe(200);
      const { adventureId } = await join3Res.json<{ adventureId: string }>();
      expect(adventureId).toBe(a1Id);
    }, 10000);
  });

  // ── Clone map ────────────────────────────────────────────────────────────

  describe('clone', () => {
    test('clone a map', async () => {
      const moveCount = 5;
      const { token, uid } = await registerUser(app, 'Owner');
      const a1Id = await createAdventure(token);

      const m1Id = await createMap(token, a1Id, 'Map One', 'First map', MapType.Hex, false);

      // Clone the map before any changes (empty clone)
      const cloneRes = await apiPost(app, `/api/adventures/${a1Id}/maps/${m1Id}/clone`, {
        name: 'Clone of Map One',
        description: 'First map cloned',
      }, token);
      expect(cloneRes.status).toBe(201);
      const { id: m2Id } = await cloneRes.json<{ id: string }>();
      expect(m2Id).not.toBe(m1Id);

      // Verify clone metadata matches original
      const [m1Row] = await db.select().from(maps).where(eq(maps.id, m1Id));
      const [m2Row] = await db.select().from(maps).where(eq(maps.id, m2Id));
      expect(m2Row?.name).toBe('Clone of Map One');
      expect(m2Row?.description).toBe('First map cloned');
      expect(m2Row?.ty).toBe(m1Row?.ty);
      expect(m2Row?.ffa).toBe(m1Row?.ffa);

      // Add changes to the original
      // TODO Phase 4: replace direct DB insert with WebSocket client once real-time sync is implemented
      await seedMapChanges(m1Id, uid, [createAddToken1(uid)]);
      for (let i = 0; i < moveCount; ++i) {
        await seedMapChanges(m1Id, uid, [createMoveToken1(i)]);
      }
      await seedMapChanges(m1Id, uid, [createAddWall1()]);

      // Clone the map again (with changes)
      const clone2Res = await apiPost(app, `/api/adventures/${a1Id}/maps/${m1Id}/clone`, {
        name: 'Second clone',
        description: 'First map cloned with changes',
      }, token);
      expect(clone2Res.status).toBe(201);
      const { id: m3Id } = await clone2Res.json<{ id: string }>();

      const [m3Row] = await db.select().from(maps).where(eq(maps.id, m3Id));
      expect(m3Row?.name).toBe('Second clone');
      expect(m3Row?.ty).toBe(m1Row?.ty);

      // Both original and second clone should have same consolidated base change
      const m1Base = await getBaseChange(m1Id);
      const m3Base = await getBaseChange(m3Id);
      verifyBaseChange(m1Base, uid, moveCount);
      verifyBaseChange(m3Base, uid, moveCount);

      // First (empty) clone should have no changes
      const m2ChangeCount = await countMapChanges(m2Id);
      expect(m2ChangeCount).toBe(0);
    });
  });

  // ── Permissions ──────────────────────────────────────────────────────────

  describe('permissions', () => {
    test('non-member cannot consolidate map changes; owner and player can', async () => {
      const owner = await registerUser(app, 'Owner');
      const stranger = await registerUser(app, 'Stranger');
      const player = await registerUser(app, 'Player');

      const a1Id = await createAdventure(owner.token);
      const m1Id = await createMap(owner.token, a1Id, 'Map One', 'First map', MapType.Square);

      // TODO Phase 4: replace direct DB insert with WebSocket client once real-time sync is implemented
      await seedMapChanges(m1Id, owner.uid, [createAddToken1(owner.uid), createAddWall1()]);

      // Stranger (non-member) cannot consolidate — should get 403
      const strangerRes = await apiPost(app, `/api/adventures/${a1Id}/maps/${m1Id}/consolidate`, {}, stranger.token);
      expect(strangerRes.status).toBe(403);
      // HTTPException sends a plain text message body
      const errText = await strangerRes.text();
      expect(errText).toMatch(/not in this adventure/i);

      // Owner can consolidate
      const ownerRes = await apiPost(app, `/api/adventures/${a1Id}/maps/${m1Id}/consolidate`, {}, owner.token);
      expect(ownerRes.status).toBe(204);
      const base = await getBaseChange(m1Id);
      expect(base).not.toBeUndefined();

      // Player joins via invite
      const inviteRes = await apiPost(app, `/api/adventures/${a1Id}/invites`, {}, owner.token);
      const { inviteId } = await inviteRes.json<{ inviteId: string }>();
      await apiPost(app, `/api/invites/${inviteId}/join`, {}, player.token);

      // Add a change so there's something to consolidate
      await seedMapChanges(m1Id, owner.uid, [createMoveToken1(0)]);

      // Player can also consolidate
      const playerRes = await apiPost(app, `/api/adventures/${a1Id}/maps/${m1Id}/consolidate`, {}, player.token);
      expect(playerRes.status).toBe(204);
    });
  });

  // ── Cascade deletion ─────────────────────────────────────────────────────

  describe('cascade deletion', () => {
    test('deleteMap purges the changes subcollection', async () => {
      const { token, uid } = await registerUser(app);
      const a1Id = await createAdventure(token);
      const m1Id = await createMap(token, a1Id);

      // Seed changes and consolidate
      // TODO Phase 4: replace direct DB insert with WebSocket client once real-time sync is implemented
      await seedMapChanges(m1Id, uid, [createAddToken1(uid)]);
      for (let i = 0; i < 3; ++i) {
        await seedMapChanges(m1Id, uid, [createMoveToken1(i)]);
      }
      await seedMapChanges(m1Id, uid, [createAddWall1()]);
      await consolidate(token, a1Id, m1Id);

      // Verify we have exactly 1 consolidated change
      expect(await countMapChanges(m1Id)).toBe(1);

      // Delete the map
      const res = await apiDelete(app, `/api/adventures/${a1Id}/maps/${m1Id}`, token);
      expect(res.status).toBe(204);

      // Map should be gone
      const [mapRow] = await db.select().from(maps).where(eq(maps.id, m1Id));
      expect(mapRow).toBeUndefined();

      // Changes should be gone (FK CASCADE from maps)
      expect(await countMapChanges(m1Id)).toBe(0);
    });

    test('deleteMap leaves other maps in the same adventure untouched', async () => {
      const { token, uid } = await registerUser(app);
      const a1Id = await createAdventure(token);
      const m1Id = await createMap(token, a1Id, 'Map One', '', MapType.Square);
      const m2Id = await createMap(token, a1Id, 'Map Two', '', MapType.Hex);

      // Seed and consolidate both maps
      // TODO Phase 4: replace direct DB insert with WebSocket client once real-time sync is implemented
      await seedMapChanges(m1Id, uid, [createAddToken1(uid), createAddWall1()]);
      await seedMapChanges(m2Id, uid, [createAddToken1(uid), createAddWall1()]);
      await consolidate(token, a1Id, m1Id);
      await consolidate(token, a1Id, m2Id);

      // Delete map 1 only
      const res = await apiDelete(app, `/api/adventures/${a1Id}/maps/${m1Id}`, token);
      expect(res.status).toBe(204);

      // Map 1 and its changes should be gone
      const [m1Row] = await db.select().from(maps).where(eq(maps.id, m1Id));
      expect(m1Row).toBeUndefined();
      expect(await countMapChanges(m1Id)).toBe(0);

      // Map 2 should still exist with its changes
      const [m2Row] = await db.select().from(maps).where(eq(maps.id, m2Id));
      expect(m2Row?.name).toBe('Map Two');

      const m2Base = await getBaseChange(m2Id);
      expect(m2Base).not.toBeUndefined();
      expect(m2Base!.chs).toHaveLength(2); // token + wall
    });

    test('deleting the original map leaves its clone intact', async () => {
      const moveCount = 5;
      const { token, uid } = await registerUser(app);
      const a1Id = await createAdventure(token);
      const m1Id = await createMap(token, a1Id, 'Map One', '', MapType.Hex);

      // Add changes to the original
      // TODO Phase 4: replace direct DB insert with WebSocket client once real-time sync is implemented
      await seedMapChanges(m1Id, uid, [createAddToken1(uid)]);
      for (let i = 0; i < moveCount; ++i) {
        await seedMapChanges(m1Id, uid, [createMoveToken1(i)]);
      }
      await seedMapChanges(m1Id, uid, [createAddWall1()]);

      // Clone (cloneMap consolidates then copies the base change)
      const cloneRes = await apiPost(app, `/api/adventures/${a1Id}/maps/${m1Id}/clone`, {
        name: 'Clone of Map One',
      }, token);
      expect(cloneRes.status).toBe(201);
      const { id: m2Id } = await cloneRes.json<{ id: string }>();

      // Both original and clone should have the same state
      verifyBaseChange(await getBaseChange(m1Id), uid, moveCount);
      verifyBaseChange(await getBaseChange(m2Id), uid, moveCount);

      // Delete the original
      const delRes = await apiDelete(app, `/api/adventures/${a1Id}/maps/${m1Id}`, token);
      expect(delRes.status).toBe(204);

      // Original and its changes are gone
      const [m1Row] = await db.select().from(maps).where(eq(maps.id, m1Id));
      expect(m1Row).toBeUndefined();
      expect(await countMapChanges(m1Id)).toBe(0);

      // Clone still exists with correct state
      const [m2Row] = await db.select().from(maps).where(eq(maps.id, m2Id));
      expect(m2Row?.name).toBe('Clone of Map One');
      verifyBaseChange(await getBaseChange(m2Id), uid, moveCount);
    });

    test('deleteAdventure cascades to all maps and their changes', async () => {
      const { token, uid } = await registerUser(app);
      const a1Id = await createAdventure(token);
      const m1Id = await createMap(token, a1Id, 'Map One', '', MapType.Square);
      const m2Id = await createMap(token, a1Id, 'Map Two', '', MapType.Hex);

      // Seed and consolidate both
      // TODO Phase 4: replace direct DB insert with WebSocket client once real-time sync is implemented
      await seedMapChanges(m1Id, uid, [createAddToken1(uid), createAddWall1()]);
      await seedMapChanges(m2Id, uid, [createAddToken1(uid)]);
      await consolidate(token, a1Id, m1Id);
      await consolidate(token, a1Id, m2Id);

      // Delete the adventure
      const res = await apiDelete(app, `/api/adventures/${a1Id}`, token);
      expect(res.status).toBe(204);

      // Adventure, both maps, and all their changes should be gone
      const [advRow] = await db.select().from(adventures).where(eq(adventures.id, a1Id));
      expect(advRow).toBeUndefined();

      const [m1Row] = await db.select().from(maps).where(eq(maps.id, m1Id));
      expect(m1Row).toBeUndefined();

      const [m2Row] = await db.select().from(maps).where(eq(maps.id, m2Id));
      expect(m2Row).toBeUndefined();

      expect(await countMapChanges(m1Id)).toBe(0);
      expect(await countMapChanges(m2Id)).toBe(0);
    });

    test('deleteAdventure leaves other adventures untouched', async () => {
      const { token, uid } = await registerUser(app);
      const a1Id = await createAdventure(token, 'Adventure One');
      const a2Id = await createAdventure(token, 'Adventure Two');

      const m1Id = await createMap(token, a1Id, 'Map One', '', MapType.Square);
      const m2Id = await createMap(token, a2Id, 'Map Two', '', MapType.Hex);

      // Seed and consolidate both
      // TODO Phase 4: replace direct DB insert with WebSocket client once real-time sync is implemented
      await seedMapChanges(m1Id, uid, [createAddToken1(uid), createAddWall1()]);
      await seedMapChanges(m2Id, uid, [createAddToken1(uid)]);
      await consolidate(token, a1Id, m1Id);
      await consolidate(token, a2Id, m2Id);

      // Delete adventure 1
      const res = await apiDelete(app, `/api/adventures/${a1Id}`, token);
      expect(res.status).toBe(204);

      // Adventure 1, map 1, and its changes should be gone
      const [a1Row] = await db.select().from(adventures).where(eq(adventures.id, a1Id));
      expect(a1Row).toBeUndefined();
      const [m1Row] = await db.select().from(maps).where(eq(maps.id, m1Id));
      expect(m1Row).toBeUndefined();
      expect(await countMapChanges(m1Id)).toBe(0);

      // Adventure 2, map 2, and its changes should be intact
      const [a2Row] = await db.select().from(adventures).where(eq(adventures.id, a2Id));
      expect(a2Row?.name).toBe('Adventure Two');

      const [m2Row] = await db.select().from(maps).where(eq(maps.id, m2Id));
      expect(m2Row?.name).toBe('Map Two');

      const m2Base = await getBaseChange(m2Id);
      expect(m2Base).not.toBeUndefined();
      expect(m2Base!.chs).toHaveLength(1); // token only
    });
  });
});
