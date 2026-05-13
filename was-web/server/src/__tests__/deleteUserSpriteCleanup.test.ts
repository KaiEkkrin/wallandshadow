import { describe, test, expect } from 'vitest';
import { createApp } from '../app.js';
import {
  registerUser,
  apiPost,
  apiDelete,
  apiUploadImage,
  TINY_PNG,
} from './helpers.js';

const app = createApp();

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
});
