import { describe, test, expect } from 'vitest';
import { MapType } from '@wallandshadow/shared';
import { createApp } from '../app.js';
import {
  registerUser,
  registerHigherUser,
  apiPost,
  apiUploadImage,
  TINY_PNG,
} from './helpers.js';

const app = createApp();

// New accounts default to the Basic tier; `registerUser` exercises that default.

describe('account tier: image upload gate', () => {
  test('a Basic user cannot upload images', async () => {
    const { token } = await registerUser(app);
    const res = await apiUploadImage(app, token, TINY_PNG, 'photo.png', 'image/png');
    expect(res.status).toBe(403);
    expect(await res.text()).toContain('does not permit image uploads');
  });

  test('a Higher user can upload images', async () => {
    const { token } = await registerHigherUser(app);
    const res = await apiUploadImage(app, token, TINY_PNG, 'photo.png', 'image/png');
    expect(res.status).toBe(201);
  });
});

describe('account tier: Basic-tier caps', () => {
  test('a Basic user can create 2 adventures but not a 3rd', async () => {
    const { token } = await registerUser(app);
    for (let i = 0; i < 2; i++) {
      const res = await apiPost(app, '/api/adventures', { name: `Adventure ${i}`, description: '' }, token);
      expect(res.status).toBe(201);
    }
    const over = await apiPost(app, '/api/adventures', { name: 'Adventure 3', description: '' }, token);
    expect(over.status).toBe(403);
  });

  test('a Basic user can create 6 maps in an adventure but not a 7th', async () => {
    const { token } = await registerUser(app);
    const advRes = await apiPost(app, '/api/adventures', { name: 'Adventure', description: '' }, token);
    expect(advRes.status).toBe(201);
    const { id: adventureId } = (await advRes.json()) as { id: string };

    for (let i = 0; i < 6; i++) {
      const res = await apiPost(app, `/api/adventures/${adventureId}/maps`, {
        name: `Map ${i}`, description: '', ty: MapType.Square, ffa: false,
      }, token);
      expect(res.status).toBe(201);
    }
    const over = await apiPost(app, `/api/adventures/${adventureId}/maps`, {
      name: 'Map 7', description: '', ty: MapType.Square, ffa: false,
    }, token);
    expect(over.status).toBe(403);
  });
});
