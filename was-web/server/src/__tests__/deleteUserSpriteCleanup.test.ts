import { describe, test, expect } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createApp } from '../app.js';
import { db } from '../db/connection.js';
import { spritesheets } from '../db/schema.js';
import {
  registerUser,
  apiPost,
  apiDelete,
  apiUploadImage,
  TINY_PNG,
} from './helpers.js';

const app = createApp();

async function createSpritesheet(
  token: string,
  adventureId: string,
  geometry: string,
  sources: string[],
): Promise<void> {
  const res = await apiPost(
    app,
    `/api/adventures/${adventureId}/spritesheets`,
    { geometry, sources },
    token,
  );
  expect(res.status).toBe(200);
}

// Read the single spritesheet row for an adventure + geometry directly from the
// DB so we can assert on the raw sprites JSONB and freeSpaces accounting.
async function getSheet(
  adventureId: string,
  geometry: string,
): Promise<{ sprites: string[]; freeSpaces: number }> {
  const rows = await db.select({
    sprites: spritesheets.sprites,
    freeSpaces: spritesheets.freeSpaces,
  })
    .from(spritesheets)
    .where(and(
      eq(spritesheets.adventureId, adventureId),
      eq(spritesheets.geometry, geometry),
    ));
  expect(rows).toHaveLength(1);
  return { sprites: rows[0].sprites as string[], freeSpaces: rows[0].freeSpaces };
}

async function uploadImage(token: string, name = 'sprite'): Promise<{ path: string }> {
  const res = await apiUploadImage(app, token, TINY_PNG, 'photo.png', 'image/png', name);
  expect(res.status).toBe(201);
  return res.json();
}

async function createAdventure(token: string): Promise<string> {
  const res = await apiPost(app, '/api/adventures', { name: 'a1', description: '' }, token);
  expect(res.status).toBe(201);
  return (await res.json() as { id: string }).id;
}

async function inviteAndJoin(ownerToken: string, joinerToken: string, adventureId: string): Promise<void> {
  const inviteRes = await apiPost(app, `/api/adventures/${adventureId}/invites`, {}, ownerToken);
  expect(inviteRes.status).toBe(200);
  const { inviteId } = await inviteRes.json() as { inviteId: string };
  const joinRes = await apiPost(app, `/api/invites/${inviteId}/join`, {}, joinerToken);
  expect(joinRes.status).toBe(200);
}

describe('user deletion clears references to the user\'s sprites', () => {
  test('owner can extend a spritesheet after a player whose sprite is in it is deleted', async () => {
    // Owner creates the adventure
    const { token: ownerToken } = await registerUser(app);
    const adventureId = await createAdventure(ownerToken);

    // Player joins, uploads an image, and adds it as a sprite (creates the
    // spritesheet)
    const { token: playerToken } = await registerUser(app);
    await inviteAndJoin(ownerToken, playerToken, adventureId);
    const playerImg = await uploadImage(playerToken, 'player sprite');
    const playerSpriteRes = await apiPost(
      app,
      `/api/adventures/${adventureId}/spritesheets`,
      { geometry: '4x4', sources: [playerImg.path] },
      playerToken,
    );
    expect(playerSpriteRes.status).toBe(200);

    // Player deletes their account — image row CASCADEs out, S3 object cleaned
    // up, but the spritesheet's sprites JSONB still references the dead path
    const deleteRes = await apiDelete(app, '/api/auth/me', playerToken);
    expect(deleteRes.status).toBe(200);

    // Owner uploads a new image and tries to extend the same 4x4 sheet — with
    // the bug, createMontage tries to download the deleted player's image and
    // 500s on the missing S3 object
    const ownerImg = await uploadImage(ownerToken, 'owner sprite');
    const ownerSpriteRes = await apiPost(
      app,
      `/api/adventures/${adventureId}/spritesheets`,
      { geometry: '4x4', sources: [ownerImg.path] },
      ownerToken,
    );
    expect(ownerSpriteRes.status).toBe(200);
    const { sprites } = await ownerSpriteRes.json() as { sprites: { source: string }[] };
    expect(sprites.some(s => s.source === ownerImg.path)).toBe(true);
  }, 60000);

  test('deletion scrubs the user\'s images from every spritesheet that references them, in one batch', async () => {
    // Owner creates the adventure; the player joins it
    const { token: ownerToken } = await registerUser(app);
    const adventureId = await createAdventure(ownerToken);
    const { token: playerToken } = await registerUser(app);
    await inviteAndJoin(ownerToken, playerToken, adventureId);

    // Player uploads three images
    const playerImg1 = await uploadImage(playerToken, 'player sprite 1');
    const playerImg2 = await uploadImage(playerToken, 'player sprite 2');
    const playerImg3 = await uploadImage(playerToken, 'player sprite 3');

    // One sheet (4x4) holds TWO of the player's images — exercises the
    // multiple-matches-per-sheet path
    await createSpritesheet(playerToken, adventureId, '4x4', [playerImg1.path, playerImg2.path]);
    // A second sheet (2x2, distinct geometry so the allocator does not merge
    // it with the 4x4) holds the player's third image
    await createSpritesheet(playerToken, adventureId, '2x2', [playerImg3.path]);
    // An unrelated sheet (3x3) holds only the owner's image — must be untouched
    const ownerImg = await uploadImage(ownerToken, 'owner sprite');
    await createSpritesheet(ownerToken, adventureId, '3x3', [ownerImg.path]);

    // Snapshot the three sheets before the deletion
    const before4x4 = await getSheet(adventureId, '4x4');
    const before2x2 = await getSheet(adventureId, '2x2');
    const before3x3 = await getSheet(adventureId, '3x3');
    expect(before4x4.sprites).toContain(playerImg1.path);
    expect(before4x4.sprites).toContain(playerImg2.path);
    expect(before2x2.sprites).toContain(playerImg3.path);

    // Player deletes their account — all three image rows CASCADE out; the
    // single batched lookup must find and scrub both referencing sheets
    const deleteRes = await apiDelete(app, '/api/auth/me', playerToken);
    expect(deleteRes.status).toBe(200);

    // The 4x4 sheet: both player images scrubbed to '', freeSpaces +2
    const after4x4 = await getSheet(adventureId, '4x4');
    expect(after4x4.sprites).not.toContain(playerImg1.path);
    expect(after4x4.sprites).not.toContain(playerImg2.path);
    expect(after4x4.freeSpaces).toBe(before4x4.freeSpaces + 2);

    // The 2x2 sheet: the player's image scrubbed to '', freeSpaces +1
    const after2x2 = await getSheet(adventureId, '2x2');
    expect(after2x2.sprites).not.toContain(playerImg3.path);
    expect(after2x2.freeSpaces).toBe(before2x2.freeSpaces + 1);

    // The owner's unrelated 3x3 sheet is left exactly as it was
    const after3x3 = await getSheet(adventureId, '3x3');
    expect(after3x3.sprites).toEqual(before3x3.sprites);
    expect(after3x3.freeSpaces).toBe(before3x3.freeSpaces);
    expect(after3x3.sprites).toContain(ownerImg.path);
  }, 60000);
});
