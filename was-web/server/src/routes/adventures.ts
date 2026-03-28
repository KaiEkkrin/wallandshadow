import { Hono } from 'hono';
import { authMiddleware, type AuthVariables } from '../auth/middleware.js';
import { db } from '../db/connection.js';
import { createAdventure, deleteAdventure } from '../services/extensions.js';

export const adventureRoutes = new Hono<{ Variables: AuthVariables }>();

adventureRoutes.use('/*', authMiddleware);

adventureRoutes.post('/adventures', async (c) => {
  const uid = c.get('uid');
  const body = await c.req.json<{ name?: string; description?: string }>();
  const { name, description } = body;
  if (!name) {
    return c.json({ error: 'name and description are required' }, 400);
  }
  const id = await createAdventure(db, uid, name, description ?? '');
  return c.json({ id }, 201);
});

adventureRoutes.delete('/adventures/:id', async (c) => {
  const uid = c.get('uid');
  const adventureId = c.req.param('id');
  await deleteAdventure(db, uid, adventureId);
  return c.body(null, 204);
});
