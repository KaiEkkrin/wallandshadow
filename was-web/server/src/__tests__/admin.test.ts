import { describe, test, expect } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { MapType } from '@wallandshadow/shared';
import { createApp } from '../app.js';
import {
  registerUser,
  registerHigherUser,
  registerAdminUser,
  apiGet,
  apiPost,
  apiUploadImage,
  TINY_PNG,
} from './helpers.js';

const app = createApp();

describe('admin routes: access gate', () => {
  test('a non-admin gets 403 from the user search', async () => {
    const { token } = await registerUser(app);
    const res = await apiGet(app, '/api/admin/users?email=nobody@example.com', token);
    expect(res.status).toBe(403);
  });

  test('a non-admin gets 403 from the account-info route', async () => {
    const { token, uid } = await registerUser(app);
    const res = await apiGet(app, `/api/admin/users/${uid}`, token);
    expect(res.status).toBe(403);
  });

  test('an admin passes the gate (search reaches a 404, not a 403)', async () => {
    const { token } = await registerAdminUser(app);
    const res = await apiGet(app, '/api/admin/users?email=nobody@example.com', token);
    expect(res.status).toBe(404);
  });
});

describe('admin routes: user search', () => {
  test('search by email returns the summary on a hit', async () => {
    const { token } = await registerAdminUser(app);
    const email = `target-${uuidv7()}@example.com`;
    const target = await registerUser(app, 'Search Target', email);
    const res = await apiGet(app, `/api/admin/users?email=${encodeURIComponent(email)}`, token);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(target.uid);
    expect(body.email).toBe(email);
    expect(body.level).toBe('basic');
    expect(body.isOidc).toBe(false);
  });

  test('search by email returns 404 on a miss', async () => {
    const { token } = await registerAdminUser(app);
    const res = await apiGet(app, `/api/admin/users?email=missing-${uuidv7()}@example.com`, token);
    expect(res.status).toBe(404);
  });

  test('search by id returns the summary on a hit', async () => {
    const { token } = await registerAdminUser(app);
    const target = await registerUser(app);
    const res = await apiGet(app, `/api/admin/users?id=${target.uid}`, token);
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe(target.uid);
  });

  test('search by id returns 404 on a miss', async () => {
    const { token } = await registerAdminUser(app);
    const res = await apiGet(
      app, '/api/admin/users?id=00000000-0000-0000-0000-000000000000', token,
    );
    expect(res.status).toBe(404);
  });

  test('search with neither email nor id returns 400', async () => {
    const { token } = await registerAdminUser(app);
    const res = await apiGet(app, '/api/admin/users', token);
    expect(res.status).toBe(400);
  });

  test('search with both email and id returns 400', async () => {
    const { token } = await registerAdminUser(app);
    const res = await apiGet(
      app,
      '/api/admin/users?email=x@example.com&id=00000000-0000-0000-0000-000000000000',
      token,
    );
    expect(res.status).toBe(400);
  });
});

describe('admin routes: account-info aggregation', () => {
  test('GET /api/admin/users/:id aggregates adventures, maps and images', async () => {
    const { token: adminToken } = await registerAdminUser(app);

    // Seed a Higher-tier target so it can own adventures, maps AND images
    // (Basic cannot upload images).
    const target = await registerHigherUser(app, 'Agg Target', `agg-${uuidv7()}@example.com`);

    // Two adventures: the first gets two maps, the second gets none.
    const a1 = await (await apiPost(
      app, '/api/adventures', { name: 'Adv One', description: '' }, target.token,
    )).json();
    const a2 = await (await apiPost(
      app, '/api/adventures', { name: 'Adv Two', description: '' }, target.token,
    )).json();
    await apiPost(app, `/api/adventures/${a1.id}/maps`, {
      name: 'Map A', description: '', ty: MapType.Hex, ffa: false, enableGroupVision: false,
    }, target.token);
    await apiPost(app, `/api/adventures/${a1.id}/maps`, {
      name: 'Map B', description: '', ty: MapType.Square, ffa: false, enableGroupVision: false,
    }, target.token);

    // One uploaded image.
    await apiUploadImage(app, target.token, TINY_PNG, 'pic.png', 'image/png', 'Pic');

    const res = await apiGet(app, `/api/admin/users/${target.uid}`, adminToken);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.summary.id).toBe(target.uid);
    expect(body.summary.level).toBe('higher');

    expect(body.adventures).toHaveLength(2);
    const advOne = body.adventures.find((a: { name: string }) => a.name === 'Adv One');
    const advTwo = body.adventures.find((a: { name: string }) => a.name === 'Adv Two');
    expect(advOne.mapCount).toBe(2);
    expect(advTwo.mapCount).toBe(0);

    expect(body.maps).toHaveLength(2);
    expect(body.maps.map((m: { name: string }) => m.name).sort()).toEqual(['Map A', 'Map B']);
    expect(body.maps.every((m: { adventureName: string }) => m.adventureName === 'Adv One')).toBe(true);

    expect(body.images).toHaveLength(1);
    expect(body.images[0].name).toBe('Pic');

    void a2; // a2 exists only to assert advTwo.mapCount === 0
  });

  test('GET /api/admin/users/:id returns 404 for an unknown id', async () => {
    const { token } = await registerAdminUser(app);
    const res = await apiGet(
      app, '/api/admin/users/00000000-0000-0000-0000-000000000000', token,
    );
    expect(res.status).toBe(404);
  });

  test('GET /api/admin/users/:id returns 404 for a malformed id', async () => {
    const { token } = await registerAdminUser(app);
    const res = await apiGet(app, '/api/admin/users/not-a-uuid', token);
    expect(res.status).toBe(404);
  });
});
