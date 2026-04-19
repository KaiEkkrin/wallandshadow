import { Hono } from 'hono';
import { authMiddleware, type AuthVariables } from '../auth/middleware.js';
import { db } from '../db/connection.js';
import {
  createAdventure,
  deleteAdventure,
  updateAdventure,
  leaveAdventure,
  assertAdventureMember,
} from '../services/extensions.js';
import { snapshotAdventures, snapshotAdventureDetail } from '../ws/subscriptions.js';

export const adventureRoutes = new Hono<{ Variables: AuthVariables }>();

adventureRoutes.use('/*', authMiddleware);

// ── List adventures the user is a member of ──────────────────────────────────

adventureRoutes.get('/adventures', async (c) => {
  const uid = c.get('uid');
  return c.json(await snapshotAdventures(db, uid));
});

// ── Get one adventure ────────────────────────────────────────────────────────

adventureRoutes.get('/adventures/:id', async (c) => {
  const uid = c.get('uid');
  const adventureId = c.req.param('id');

  const [, detail] = await Promise.all([
    assertAdventureMember(db, uid, adventureId),
    snapshotAdventureDetail(db, adventureId),
  ]);
  if (!detail) {
    return c.json({ error: 'Adventure not found' }, 404);
  }
  return c.json(detail);
});

// ── Create adventure ─────────────────────────────────────────────────────────

adventureRoutes.post('/adventures', async (c) => {
  const uid = c.get('uid');
  const body = await c.req.json<{ name?: string; description?: string }>();
  const { name, description } = body;
  if (!name) {
    return c.json({ error: 'name is required' }, 400);
  }
  const id = await createAdventure(db, uid, name, description ?? '');
  return c.json({ id }, 201);
});

// ── Update adventure ─────────────────────────────────────────────────────────

adventureRoutes.patch('/adventures/:id', async (c) => {
  const uid = c.get('uid');
  const adventureId = c.req.param('id');
  const body = await c.req.json<{ name?: string; description?: string; imagePath?: string }>();
  const fields: { name?: string; description?: string; imagePath?: string } = {};
  if (body.name !== undefined) fields.name = body.name;
  if (body.description !== undefined) fields.description = body.description;
  if (body.imagePath !== undefined) fields.imagePath = body.imagePath;
  await updateAdventure(db, uid, adventureId, fields);
  return c.body(null, 204);
});

// ── Delete adventure ─────────────────────────────────────────────────────────

adventureRoutes.delete('/adventures/:id', async (c) => {
  const uid = c.get('uid');
  const adventureId = c.req.param('id');
  await deleteAdventure(db, uid, adventureId);
  return c.body(null, 204);
});

// ── Leave adventure (player removes themselves) ──────────────────────────────

adventureRoutes.delete('/adventures/:id/players/me', async (c) => {
  const uid = c.get('uid');
  const adventureId = c.req.param('id');
  await leaveAdventure(db, uid, adventureId);
  return c.body(null, 204);
});
