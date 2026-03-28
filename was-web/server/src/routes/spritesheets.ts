import { Hono } from 'hono';
import { authMiddleware, type AuthVariables } from '../auth/middleware.js';
import { db } from '../db/connection.js';
import { storage } from '../services/storage.js';
import { logger } from '../services/logger.js';
import { addSprites } from '../services/spriteExtensions.js';

export const spritesheetRoutes = new Hono<{ Variables: AuthVariables }>();

spritesheetRoutes.use('/*', authMiddleware);

spritesheetRoutes.post('/adventures/:id/spritesheets', async (c) => {
  const uid = c.get('uid');
  const adventureId = c.req.param('id');
  const body = await c.req.json<{ geometry?: string; sources?: string[] }>();
  const { geometry, sources } = body;
  if (!geometry || !sources || !Array.isArray(sources)) {
    return c.json({ error: 'geometry and sources are required' }, 400);
  }
  const sprites = await addSprites(db, logger, storage, uid, adventureId, geometry, sources);
  return c.json({ sprites });
});
