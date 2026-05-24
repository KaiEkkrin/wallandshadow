import { describe, test, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { MapType } from '@wallandshadow/shared';
import { createApp } from '../app.js';
import { db } from '../db/connection.js';
import {
  adventurePlayers,
  adventures,
  images,
  invites,
  mapChanges,
  maps,
  spritesheets,
  users,
} from '../db/schema.js';
import {
  TINY_PNG,
  apiGet,
  apiPost,
  apiUploadImage,
  postMapChanges,
  createAddWall1,
  registerAdminUser,
  registerHigherUser,
  registerUser,
  s3ObjectExists,
} from './helpers.js';
import './setup.js';

let app: ReturnType<typeof createApp>;
beforeAll(() => { app = createApp(); });

// ─── Local helpers ────────────────────────────────────────────────────────────

async function createAdventure(token: string, name = 'Adv'): Promise<string> {
  const res = await apiPost(app, '/api/adventures', { name, description: '' }, token);
  if (res.status !== 201) throw new Error(`createAdventure failed: ${res.status} ${await res.text()}`);
  const body = await res.json() as { id: string };
  return body.id;
}

async function createMap(token: string, adventureId: string, name = 'Map'): Promise<string> {
  const res = await apiPost(app, `/api/adventures/${adventureId}/maps`, {
    name, description: '', ty: MapType.Square, ffa: false, enableGroupVision: false,
  }, token);
  if (res.status !== 201) throw new Error(`createMap failed: ${res.status} ${await res.text()}`);
  const body = await res.json() as { id: string };
  return body.id;
}

// Invites endpoint returns { inviteId } at HTTP 200 (not 201, not { id }).
// Join endpoint also returns 200.
async function inviteAndJoin(
  ownerToken: string, adventureId: string, joinerToken: string,
): Promise<void> {
  const inviteRes = await apiPost(app, `/api/adventures/${adventureId}/invites`, {}, ownerToken);
  if (inviteRes.status !== 200) throw new Error(`invite failed: ${inviteRes.status} ${await inviteRes.text()}`);
  const inviteBody = await inviteRes.json() as { inviteId: string };
  const joinRes = await apiPost(app, `/api/invites/${inviteBody.inviteId}/join`, {}, joinerToken);
  if (joinRes.status !== 200) throw new Error(`join failed: ${joinRes.status} ${await joinRes.text()}`);
}

// Spritesheet endpoint expects { geometry, sources } and returns { sprites }
// at HTTP 200. The spritesheet row is looked up from the DB by adventureId
// after creation, since no ID is returned.
async function addSpritesheetSources(
  ownerToken: string,
  adventureId: string,
  sources: string[],
  geometry = '4x4',
): Promise<void> {
  const res = await apiPost(
    app,
    `/api/adventures/${adventureId}/spritesheets`,
    { geometry, sources },
    ownerToken,
  );
  if (res.status !== 200) throw new Error(`addSpritesheetSources failed: ${res.status} ${await res.text()}`);
}

async function uploadImage(token: string, label: string): Promise<string> {
  const res = await apiUploadImage(app, token, TINY_PNG, `${label}.png`, 'image/png', label);
  if (res.status !== 201) throw new Error(`uploadImage failed: ${res.status} ${await res.text()}`);
  const body = await res.json() as { path: string };
  return body.path;
}

// ─── Happy-path test ──────────────────────────────────────────────────────────

describe('banUser — happy path', () => {
  test('soft-deletes content, quarantines S3, scrubs others, disconnects, banned user is 403', async () => {
    const admin = await registerAdminUser(app, 'Admin');
    const target = await registerHigherUser(app, 'Target');
    const other = await registerHigherUser(app, 'Other');

    // Target owns an adventure with a map and an uploaded image.
    const targetAdv = await createAdventure(target.token, 'Target Adv');
    const targetImagePath = await uploadImage(target.token, 'target');
    await createMap(target.token, targetAdv, 'M1');

    // Target also creates an outstanding invite — exercises the invite-deletion
    // side of scrubUserFootprint.
    const targetInviteRes = await apiPost(
      app, `/api/adventures/${targetAdv}/invites`, {}, target.token,
    );
    expect(targetInviteRes.status).toBe(200);

    // Other user owns an adventure where target is a member.
    const otherAdv = await createAdventure(other.token, 'Other Adv');
    await inviteAndJoin(other.token, otherAdv, target.token);

    // Other uploads their own image; both images go into a spritesheet.
    const otherImagePath = await uploadImage(other.token, 'other');
    // Add both images to the same spritesheet so we can assert scrubbing later.
    await addSpritesheetSources(other.token, otherAdv, [targetImagePath, otherImagePath]);

    // Target authors a map change in otherAdv so we can assert userId nulling.
    const otherMapId = await createMap(other.token, otherAdv, 'OM1');
    await postMapChanges(app, target.token, otherAdv, otherMapId, [createAddWall1()]);

    // ── Act: ban target ──────────────────────────────────────────────────────
    const banRes = await apiPost(app, `/api/admin/users/${target.uid}/ban`, {}, admin.token);
    expect(banRes.status).toBe(200);
    const summary = await banRes.json() as { id: string; bannedAt: string | null };
    expect(summary.id).toBe(target.uid);
    expect(summary.bannedAt).not.toBeNull();

    // ── Assert: users.bannedAt set in DB ────────────────────────────────────
    const [u] = await db.select({ bannedAt: users.bannedAt })
      .from(users).where(eq(users.id, target.uid)).limit(1);
    expect(u.bannedAt).not.toBeNull();

    // ── Assert: target's adventure soft-deleted ──────────────────────────────
    const [adv] = await db.select({ deletedAt: adventures.deletedAt })
      .from(adventures).where(eq(adventures.id, targetAdv)).limit(1);
    expect(adv.deletedAt).not.toBeNull();

    // ── Assert: target's maps soft-deleted ──────────────────────────────────
    // banUser soft-deletes all maps in the target's own adventures.
    const targetMaps = await db.select({ id: maps.id, deletedAt: maps.deletedAt })
      .from(maps).where(eq(maps.adventureId, targetAdv));
    expect(targetMaps.length).toBeGreaterThan(0);
    for (const m of targetMaps) {
      expect(m.deletedAt).not.toBeNull();
    }

    // ── Assert: target's image soft-deleted and path rewritten ──────────────
    // The images.path column is atomically rewritten from 'images/…' to
    // 'quarantine/…' in the same transaction that sets deletedAt.
    const [img] = await db.select({ deletedAt: images.deletedAt, path: images.path })
      .from(images).where(eq(images.userId, target.uid)).limit(1);
    expect(img.deletedAt).not.toBeNull();
    expect(img.path.startsWith('quarantine/')).toBe(true);

    // ── Assert: S3 object physically moved to quarantine prefix ─────────────
    expect(await s3ObjectExists(targetImagePath)).toBe(false);
    expect(await s3ObjectExists(img.path)).toBe(true);

    // ── Assert: target's image scrubbed from other user's spritesheet ────────
    // The spritesheet is owned by otherAdv. The target's slot should be cleared
    // to '' (free space) while the other user's image remains intact.
    const sheets = await db.select({
      sprites: spritesheets.sprites,
      freeSpaces: spritesheets.freeSpaces,
    }).from(spritesheets).where(eq(spritesheets.adventureId, otherAdv));
    expect(sheets.length).toBeGreaterThan(0);
    const sprites = sheets[0].sprites as string[];
    // Target's image path no longer in sprites
    expect(sprites).not.toContain(targetImagePath);
    // Slot is replaced with empty string (free space)
    expect(sprites).toContain('');
    // Other user's image still present
    expect(sprites).toContain(otherImagePath);
    // freeSpaces incremented for the scrubbed slot
    expect(sheets[0].freeSpaces).toBeGreaterThan(0);

    // ── Assert: map_changes.userId nulled for target-authored changes ────────
    const targetAuthored = await db.select({ id: mapChanges.id })
      .from(mapChanges).where(eq(mapChanges.userId, target.uid));
    expect(targetAuthored.length).toBe(0);

    // ── Assert: target's adventure_players rows gone ─────────────────────────
    // scrubUserFootprint removes all player rows for the target (both owned
    // adventures and other adventures they joined).
    const remainingPlayer = await db.select({ userId: adventurePlayers.userId })
      .from(adventurePlayers).where(eq(adventurePlayers.userId, target.uid));
    expect(remainingPlayer.length).toBe(0);

    // ── Assert: target's invites gone ───────────────────────────────────────
    // scrubUserFootprint deletes invites where ownerId = targetUid.
    const remainingInvites = await db.select({ id: invites.id })
      .from(invites).where(eq(invites.ownerId, target.uid));
    expect(remainingInvites.length).toBe(0);

    // ── Assert: banned user gets 403 on any authenticated request ────────────
    // authMiddleware checks bannedAt before passing to the handler.
    const meRes = await apiGet(app, '/api/adventures', target.token);
    expect(meRes.status).toBe(403);
    const meBody = await meRes.json() as { error: string };
    expect(meBody.error).toBe('account-suspended');
  }, 60000);
});

// ─── Regression: in-tx UPDATE RETURNING covers rows not in pre-tx snapshot ───

test('an image inserted directly into the DB (no pre-tx snapshot) is still quarantined', async () => {
  const admin = await registerAdminUser(app, 'AdminRet');
  const target = await registerHigherUser(app, 'TargetRet');

  // Upload one image through the normal path so the S3 blob exists.
  const path = await uploadImage(target.token, 'late');

  // Insert a second images row referencing the SAME blob but with a different
  // id, simulating "this row didn't exist when the snapshot was taken". The
  // pre-tx snapshot would have missed it; the in-tx UPDATE will still match
  // on userId and rewrite it.
  await db.insert(images).values({
    id: uuidv7(),
    userId: target.uid,
    name: 'late-row',
    path,
  });

  const banRes = await apiPost(app, `/api/admin/users/${target.uid}/ban`, {}, admin.token);
  expect(banRes.status).toBe(200);

  // Both images rows should be soft-deleted with a quarantined path.
  const rows = await db.select({ path: images.path, deletedAt: images.deletedAt })
    .from(images).where(eq(images.userId, target.uid));
  expect(rows.length).toBe(2);
  for (const r of rows) {
    expect(r.deletedAt).not.toBeNull();
    expect(r.path.startsWith('quarantine/')).toBe(true);
  }

  // The single underlying blob has been moved to quarantine exactly once
  // (the second pair points at the same src/dst so the copy is idempotent).
  expect(await s3ObjectExists(path)).toBe(false);
  const quarantinedPath = path.replace(/^images\//, 'quarantine/');
  expect(await s3ObjectExists(quarantinedPath)).toBe(true);
}, 60000);

// ─── Guard tests ──────────────────────────────────────────────────────────────

describe('banUser — guards', () => {
  test('self-ban is rejected with 400', async () => {
    const admin = await registerAdminUser(app, 'AdminSelf');
    const res = await apiPost(app, `/api/admin/users/${admin.uid}/ban`, {}, admin.token);
    expect(res.status).toBe(400);
    // Confirm admin's bannedAt is still null
    const [row] = await db.select({ bannedAt: users.bannedAt })
      .from(users).where(eq(users.id, admin.uid)).limit(1);
    expect(row.bannedAt).toBeNull();
  });

  test('banning an admin is rejected with 400', async () => {
    const admin = await registerAdminUser(app, 'Admin1');
    const targetAdmin = await registerAdminUser(app, 'Admin2');
    const res = await apiPost(app, `/api/admin/users/${targetAdmin.uid}/ban`, {}, admin.token);
    expect(res.status).toBe(400);
    // Target admin should still be unbanned
    const [row] = await db.select({ bannedAt: users.bannedAt })
      .from(users).where(eq(users.id, targetAdmin.uid)).limit(1);
    expect(row.bannedAt).toBeNull();
  });

  test('double-ban returns 409', async () => {
    const admin = await registerAdminUser(app, 'AdminDup');
    const target = await registerUser(app);
    // First ban succeeds
    const first = await apiPost(app, `/api/admin/users/${target.uid}/ban`, {}, admin.token);
    expect(first.status).toBe(200);
    // Second ban on an already-banned user returns 409 (already-exists)
    const second = await apiPost(app, `/api/admin/users/${target.uid}/ban`, {}, admin.token);
    expect(second.status).toBe(409);
  }, 60000);

  test('non-existent target returns 404', async () => {
    const admin = await registerAdminUser(app, 'AdminNX');
    const fakeUid = '00000000-0000-0000-0000-000000000001';
    const res = await apiPost(app, `/api/admin/users/${fakeUid}/ban`, {}, admin.token);
    expect(res.status).toBe(404);
  });

  test('non-admin caller is rejected by adminMiddleware (403)', async () => {
    const target = await registerUser(app);
    const caller = await registerUser(app);
    const res = await apiPost(app, `/api/admin/users/${target.uid}/ban`, {}, caller.token);
    expect(res.status).toBe(403);
  });
});
