import { Hono } from 'hono';
import { authMiddleware, type AuthVariables } from '../auth/middleware.js';
import { db } from '../db/connection.js';
import { spritesheets } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { storage } from '../services/storage.js';
import { logger } from '../services/logger.js';
import { addSprites } from '../services/spriteExtensions.js';
import { assertAdventureMember } from '../services/extensions.js';

export const spritesheetRoutes = new Hono<{ Variables: AuthVariables }>();

spritesheetRoutes.use('/*', authMiddleware);

// GET /adventures/:id/spritesheets — list all spritesheets for an adventure
spritesheetRoutes.get('/adventures/:id/spritesheets', async (c) => {
  const uid = c.get('uid');
  const adventureId = c.req.param('id');
  await assertAdventureMember(db, uid, adventureId);

  const rows = await db.select({
    id: spritesheets.id,
    sprites: spritesheets.sprites,
    geometry: spritesheets.geometry,
    freeSpaces: spritesheets.freeSpaces,
    supersededBy: spritesheets.supersededBy,
    refs: spritesheets.refs,
    createdAt: spritesheets.createdAt,
  })
    .from(spritesheets)
    .where(eq(spritesheets.adventureId, adventureId));

  return c.json(rows.map(r => ({
    id: r.id,
    sprites: r.sprites,
    geometry: r.geometry,
    freeSpaces: r.freeSpaces,
    supersededBy: r.supersededBy ?? '',
    refs: r.refs,
  })));
});

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
