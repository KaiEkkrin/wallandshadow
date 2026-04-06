import { describe, test, expect } from 'vitest';
import { MapType } from '@wallandshadow/shared';
import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import { createApp } from '../app.js';
import { db } from '../db/connection.js';
import { images } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import {
  registerUser,
  apiGet,
  apiPost,
  apiPatch,
  apiDelete,
  apiUploadImage,
  s3ObjectExists,
  TINY_PNG,
} from './helpers.js';
import { testS3, testBucket } from './setup.js';

const app = createApp();

// ─── Local helpers ─────────────────────────────────────────────────────────────

async function createAdventure(token: string, name = 'Test Adventure'): Promise<string> {
  const res = await apiPost(app, '/api/adventures', { name, description: '' }, token);
  expect(res.status).toBe(201);
  const { id } = (await res.json()) as { id: string };
  return id;
}

async function createMap(token: string, adventureId: string, name = 'Test Map'): Promise<string> {
  const res = await apiPost(app, `/api/adventures/${adventureId}/maps`, {
    name, description: '', ty: MapType.Square, ffa: false,
  }, token);
  expect(res.status).toBe(201);
  const { id } = (await res.json()) as { id: string };
  return id;
}

async function uploadImage(token: string, name?: string): Promise<{ id: string; name: string; path: string }> {
  const res = await apiUploadImage(app, token, TINY_PNG, 'photo.png', 'image/png', name);
  expect(res.status).toBe(201);
  return res.json();
}

async function listImages(token: string): Promise<{ id: string; name: string; path: string }[]> {
  const res = await apiGet(app, '/api/images', token);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { images: { id: string; name: string; path: string }[] };
  return body.images;
}

async function s3PrefixCount(prefix: string): Promise<number> {
  const list = await testS3.send(new ListObjectsV2Command({ Bucket: testBucket, Prefix: prefix }));
  return list.Contents?.length ?? 0;
}

// ─── Image upload tests ────────────────────────────────────────────────────────

describe('image upload (POST /api/images)', () => {
  test('successful upload returns 201 with correct shape', async () => {
    const { token, uid } = await registerUser(app);
    const res = await apiUploadImage(app, token, TINY_PNG, 'photo.png', 'image/png', 'My Photo');
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; name: string; path: string };
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.name).toBe('My Photo');
    expect(body.path).toMatch(new RegExp(`^images/${uid}/`));
  });

  test('uploaded object exists in S3', async () => {
    const { token } = await registerUser(app);
    const { path } = await uploadImage(token, 'Test');
    expect(await s3ObjectExists(path)).toBe(true);
  });

  test('upload appears in GET /api/images', async () => {
    const { token } = await registerUser(app);
    const { id } = await uploadImage(token, 'My Image');
    const list = await listImages(token);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(id);
    expect(list[0].name).toBe('My Image');
  });

  test('name defaults to filename when not provided', async () => {
    const { token } = await registerUser(app);
    const res = await apiUploadImage(app, token, TINY_PNG, 'photo.png', 'image/png');
    expect(res.status).toBe(201);
    const { name } = (await res.json()) as { name: string };
    expect(name).toBe('photo.png');
  });

  test('rejects non-image MIME type with 400', async () => {
    const { token, uid } = await registerUser(app);
    const res = await apiUploadImage(app, token, Buffer.from('hello'), 'data.txt', 'text/plain');
    expect(res.status).toBe(400);
    // Verify no image row in DB
    const rows = await db.select().from(images).where(eq(images.userId, uid));
    expect(rows).toHaveLength(0);
  });

  test('rejects request without file field with 400', async () => {
    const { token } = await registerUser(app);
    const res = await app.request('/api/images', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name: 'test' }),
    });
    expect(res.status).toBe(400);
  });

  test('requires authentication', async () => {
    const formData = new FormData();
    formData.append('file', new Blob([TINY_PNG], { type: 'image/png' }), 'photo.png');
    const res = await app.request('/api/images', { method: 'POST', body: formData });
    expect(res.status).toBe(401);
  });

  test('multiple uploads accumulate in image list', async () => {
    const { token } = await registerUser(app);
    await uploadImage(token, 'First');
    await uploadImage(token, 'Second');
    const list = await listImages(token);
    expect(list).toHaveLength(2);
  });

  test('image list is scoped to the authenticated user', async () => {
    const { token: tokenA } = await registerUser(app);
    const { token: tokenB } = await registerUser(app);
    await uploadImage(tokenA, 'A image');
    const listB = await listImages(tokenB);
    expect(listB).toHaveLength(0);
  });

  test('enforces image quota', async () => {
    const { token, uid } = await registerUser(app);

    // Insert images directly up to one below the standard quota (50)
    const quota = 50;
    await db.insert(images).values(
      Array.from({ length: quota - 1 }, (_, i) => ({
        id: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
        userId: uid,
        name: `seed-${i}`,
        path: `images/${uid}/seed-${i}`,
      }))
    );

    // 50th upload should succeed
    const penultimate = await apiUploadImage(app, token, TINY_PNG, 'ok.png', 'image/png');
    expect(penultimate.status).toBe(201);

    // 51st should be rejected
    const over = await apiUploadImage(app, token, TINY_PNG, 'over.png', 'image/png');
    expect(over.status).toBe(429);
  });
});

// ─── GET /api/images ───────────────────────────────────────────────────────────

describe('image list (GET /api/images)', () => {
  test('returns empty list when user has no images', async () => {
    const { token } = await registerUser(app);
    const list = await listImages(token);
    expect(list).toEqual([]);
  });

  test('requires authentication', async () => {
    const res = await app.request('/api/images', { method: 'GET' });
    expect(res.status).toBe(401);
  });
});

// ─── Image deletion tests ──────────────────────────────────────────────────────

describe('image deletion (DELETE /api/images/*)', () => {
  test('successful deletion returns 204 and removes S3 object and DB row', async () => {
    const { token } = await registerUser(app);
    const { path } = await uploadImage(token, 'To delete');
    expect(await s3ObjectExists(path)).toBe(true);

    // path is like images/{uid}/{id}, strip the leading "images/"
    const apiPath = path.replace(/^images\//, '');
    const res = await apiDelete(app, `/api/images/${apiPath}`, token);
    expect(res.status).toBe(204);

    expect(await s3ObjectExists(path)).toBe(false);
    const list = await listImages(token);
    expect(list).toHaveLength(0);
  });

  test('cannot delete another user\'s image', async () => {
    const { token: tokenA } = await registerUser(app);
    const { token: tokenB } = await registerUser(app);
    const { path } = await uploadImage(tokenA, 'Protected');

    const apiPath = path.replace(/^images\//, '');
    const res = await apiDelete(app, `/api/images/${apiPath}`, tokenB);
    expect(res.status).toBe(403);

    // Image should still exist
    expect(await s3ObjectExists(path)).toBe(true);
    const list = await listImages(tokenA);
    expect(list).toHaveLength(1);
  });

  test('deletion clears imagePath on adventure', async () => {
    const { token } = await registerUser(app);
    const adventureId = await createAdventure(token);
    const { path } = await uploadImage(token, 'Adventure image');

    // Set imagePath on the adventure
    const patchRes = await apiPatch(app, `/api/adventures/${adventureId}`, { imagePath: path }, token);
    expect(patchRes.status).toBe(204);

    // Delete the image
    const apiPath = path.replace(/^images\//, '');
    await apiDelete(app, `/api/images/${apiPath}`, token);

    // Adventure imagePath should now be cleared
    const getRes = await apiGet(app, `/api/adventures/${adventureId}`, token);
    const adventure = (await getRes.json()) as { imagePath: string };
    expect(adventure.imagePath).toBe('');
  });

  test('deletion clears imagePath on map', async () => {
    const { token } = await registerUser(app);
    const adventureId = await createAdventure(token);
    const mapId = await createMap(token, adventureId);
    const { path } = await uploadImage(token, 'Map image');

    // Set imagePath on the map
    const patchRes = await apiPatch(app, `/api/adventures/${adventureId}/maps/${mapId}`, { imagePath: path }, token);
    expect(patchRes.status).toBe(204);

    // Delete the image
    const apiPath = path.replace(/^images\//, '');
    await apiDelete(app, `/api/images/${apiPath}`, token);

    // Map imagePath should be cleared
    const getRes = await apiGet(app, `/api/adventures/${adventureId}/maps/${mapId}`, token);
    const map = (await getRes.json()) as { imagePath: string };
    expect(map.imagePath).toBe('');
  });

  test('requires authentication', async () => {
    const res = await app.request('/api/images/some/path', { method: 'DELETE' });
    expect(res.status).toBe(401);
  });
});

// ─── Spritesheet tests ─────────────────────────────────────────────────────────

describe('spritesheet creation (POST /api/adventures/:id/spritesheets)', () => {
  test('creates sprites from uploaded images and returns them', async () => {
    const { token } = await registerUser(app);
    const adventureId = await createAdventure(token);
    const img1 = await uploadImage(token, 'Sprite 1');
    const img2 = await uploadImage(token, 'Sprite 2');

    const res = await apiPost(app, `/api/adventures/${adventureId}/spritesheets`, {
      geometry: '2x1',
      sources: [img1.path, img2.path],
    }, token);
    expect(res.status).toBe(200);

    const { sprites } = (await res.json()) as { sprites: { source: string; geometry: string }[] };
    expect(sprites).toHaveLength(2);
    expect(sprites.every(s => s.geometry === '2x1')).toBe(true);
    const sources = sprites.map(s => s.source);
    expect(sources).toContain(img1.path);
    expect(sources).toContain(img2.path);
  }, 30000);

  test('creates S3 spritesheet object', async () => {
    const { token } = await registerUser(app);
    const adventureId = await createAdventure(token);
    const img = await uploadImage(token, 'Sprite');

    await apiPost(app, `/api/adventures/${adventureId}/spritesheets`, {
      geometry: '1x1',
      sources: [img.path],
    }, token);

    expect(await s3PrefixCount('sprites/')).toBeGreaterThan(0);
  }, 30000);

  test('second identical request returns existing sprites without creating a new sheet', async () => {
    const { token } = await registerUser(app);
    const adventureId = await createAdventure(token);
    const img = await uploadImage(token, 'Sprite');

    const req = { geometry: '1x1', sources: [img.path] };
    const res1 = await apiPost(app, `/api/adventures/${adventureId}/spritesheets`, req, token);
    expect(res1.status).toBe(200);

    const sheetCountAfterFirst = await s3PrefixCount('sprites/');

    const res2 = await apiPost(app, `/api/adventures/${adventureId}/spritesheets`, req, token);
    expect(res2.status).toBe(200);

    // No new spritesheet object should have been created
    const sheetCountAfterSecond = await s3PrefixCount('sprites/');
    expect(sheetCountAfterSecond).toBe(sheetCountAfterFirst);
  }, 60000);

  test('non-member cannot create sprites', async () => {
    const { token: ownerToken } = await registerUser(app);
    const { token: strangerToken } = await registerUser(app);
    const adventureId = await createAdventure(ownerToken);
    const img = await uploadImage(ownerToken, 'Sprite');

    // 404 to avoid leaking adventure existence
    const res = await apiPost(app, `/api/adventures/${adventureId}/spritesheets`, {
      geometry: '1x1',
      sources: [img.path],
    }, strangerToken);
    expect(res.status).toBe(404);
  });

  test('rejects more than 10 sources with 400', async () => {
    const { token } = await registerUser(app);
    const adventureId = await createAdventure(token);
    const sources = Array.from({ length: 11 }, (_, i) => `images/uid/fake-${i}`);

    const res = await apiPost(app, `/api/adventures/${adventureId}/spritesheets`, {
      geometry: '4x4',
      sources,
    }, token);
    expect(res.status).toBe(400);
  });

  test('requires authentication', async () => {
    const res = await app.request('/api/adventures/fake-id/spritesheets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ geometry: '4x4', sources: [] }),
    });
    expect(res.status).toBe(401);
  });

  test('gap-filling: deleted image slot is reused for new sprite', async () => {
    const { token } = await registerUser(app);
    const adventureId = await createAdventure(token);

    // Upload 2 images and create a 2-slot sheet
    const img1 = await uploadImage(token, 'Sprite 1');
    const img2 = await uploadImage(token, 'Sprite 2');
    const createRes = await apiPost(app, `/api/adventures/${adventureId}/spritesheets`, {
      geometry: '2x1',
      sources: [img1.path, img2.path],
    }, token);
    expect(createRes.status).toBe(200);

    const sheetsAfterCreate = await s3PrefixCount('sprites/');

    // Delete img1 — creates a gap
    const apiPath1 = img1.path.replace(/^images\//, '');
    await apiDelete(app, `/api/images/${apiPath1}`, token);

    // Upload a 3rd image and request sprites for it — should fill the gap
    const img3 = await uploadImage(token, 'Sprite 3');
    const gapRes = await apiPost(app, `/api/adventures/${adventureId}/spritesheets`, {
      geometry: '2x1',
      sources: [img3.path],
    }, token);
    expect(gapRes.status).toBe(200);
    const { sprites } = (await gapRes.json()) as { sprites: { source: string }[] };
    expect(sprites.some(s => s.source === img3.path)).toBe(true);

    // The gap was filled: sheet count should stay the same (old sheet replaced by updated one)
    const sheetsAfterGapFill = await s3PrefixCount('sprites/');
    expect(sheetsAfterGapFill).toBe(sheetsAfterCreate);
  }, 60000);
});

// ─── End-to-end flow ───────────────────────────────────────────────────────────

describe('end-to-end storage flow', () => {
  test('upload → set paths → create sprites → delete → verify cascade → new upload → gap fill', async () => {
    const { token } = await registerUser(app);
    const adventureId = await createAdventure(token);
    const mapId = await createMap(token, adventureId);

    // Upload 3 images
    const img1 = await uploadImage(token, 'Image 1');
    const img2 = await uploadImage(token, 'Image 2');
    const img3 = await uploadImage(token, 'Image 3');

    // Set adventure imagePath to img1, map imagePath to img2
    await apiPatch(app, `/api/adventures/${adventureId}`, { imagePath: img1.path }, token);
    await apiPatch(app, `/api/adventures/${adventureId}/maps/${mapId}`, { imagePath: img2.path }, token);

    // Create sprites from all 3 (geometry 3x1 = 3 slots)
    const spriteRes = await apiPost(app, `/api/adventures/${adventureId}/spritesheets`, {
      geometry: '3x1',
      sources: [img1.path, img2.path, img3.path],
    }, token);
    expect(spriteRes.status).toBe(200);

    // Delete img1 — should clear adventure imagePath and leave a gap in the spritesheet
    const path1 = img1.path.replace(/^images\//, '');
    await apiDelete(app, `/api/images/${path1}`, token);

    // Adventure imagePath should be cleared
    const advRes = await apiGet(app, `/api/adventures/${adventureId}`, token);
    const adv = (await advRes.json()) as { imagePath: string };
    expect(adv.imagePath).toBe('');

    // Map imagePath should be unchanged (img2 not deleted)
    const mapRes = await apiGet(app, `/api/adventures/${adventureId}/maps/${mapId}`, token);
    const map = (await mapRes.json()) as { imagePath: string };
    expect(map.imagePath).toBe(img2.path);

    // Upload img4 and fill the gap
    const img4 = await uploadImage(token, 'Image 4');
    const gapRes = await apiPost(app, `/api/adventures/${adventureId}/spritesheets`, {
      geometry: '3x1',
      sources: [img4.path],
    }, token);
    expect(gapRes.status).toBe(200);
    const { sprites } = (await gapRes.json()) as { sprites: { source: string }[] };
    expect(sprites.some(s => s.source === img4.path)).toBe(true);
  }, 120000);
});
