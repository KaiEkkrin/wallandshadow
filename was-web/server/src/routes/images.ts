import { Hono } from 'hono';
import { authMiddleware, type AuthVariables } from '../auth/middleware.js';
import { db } from '../db/connection.js';
import { storage } from '../services/storage.js';
import { logger } from '../services/logger.js';
import { addImage, deleteImage, assertImageDownloadAccess } from '../services/imageExtensions.js';
import { images } from '../db/schema.js';
import { eq, desc } from 'drizzle-orm';

export const imageRoutes = new Hono<{ Variables: AuthVariables }>();

imageRoutes.use('/*', authMiddleware);

// GET /images/download — get a presigned download URL for an image
imageRoutes.get('/images/download', async (c) => {
  const uid = c.get('uid');
  const path = c.req.query('path');
  if (!path) {
    return c.json({ error: 'path query parameter is required' }, 400);
  }
  await assertImageDownloadAccess(db, uid, path);
  const url = await storage.ref(path).getDownloadURL();
  return c.json({ url });
});

// GET /images — list the authenticated user's images
imageRoutes.get('/images', async (c) => {
  const uid = c.get('uid');
  const rows = await db.select({ id: images.id, name: images.name, path: images.path })
    .from(images)
    .where(eq(images.userId, uid))
    .orderBy(desc(images.createdAt));
  return c.json({ images: rows });
});

// POST /images — upload a new image (multipart form: file, optional name)
imageRoutes.post('/images', async (c) => {
  const uid = c.get('uid');
  const body = await c.req.parseBody();
  const file = body['file'];
  if (!(file instanceof File)) {
    return c.json({ error: 'file is required (multipart form field "file")' }, 400);
  }
  const name = typeof body['name'] === 'string' && body['name']
    ? body['name']
    : (file.name || 'untitled');
  try {
    const result = await addImage(db, storage, uid, name, file.type, file);
    return c.json(result, 201);
  } catch (e) {
    logger.logError(`Failed to add image for user ${uid}`, e);
    throw e;
  }
});

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
