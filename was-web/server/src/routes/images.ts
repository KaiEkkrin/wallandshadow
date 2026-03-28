import { Hono } from 'hono';
import { authMiddleware, type AuthVariables } from '../auth/middleware.js';
import { db } from '../db/connection.js';
import { storage } from '../services/storage.js';
import { logger } from '../services/logger.js';
import { deleteImage } from '../services/imageExtensions.js';

export const imageRoutes = new Hono<{ Variables: AuthVariables }>();

imageRoutes.use('/*', authMiddleware);

// DELETE /images/:path — path may contain slashes, use wildcard
imageRoutes.delete('/images/*', async (c) => {
  const uid = c.get('uid');
  // Extract path after /images/
  const path = c.req.path.replace(/^\/api\/images\//, '');
  if (!path) {
    return c.json({ error: 'Path is required' }, 400);
  }
  await deleteImage(db, storage, logger, uid, `images/${path}`);
  return c.body(null, 204);
});
