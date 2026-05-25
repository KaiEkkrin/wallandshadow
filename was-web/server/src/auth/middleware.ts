import { createMiddleware } from 'hono/factory';
import { eq } from 'drizzle-orm';
import { resolveTokenToUid } from './resolveToken.js';
import { db } from '../db/connection.js';
import { users } from '../db/schema.js';
import { logger } from '../services/logger.js';

export type AuthVariables = {
  uid: string;
};

export const authMiddleware = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const token = authHeader.slice(7);
  let uid: string;
  try {
    uid = await resolveTokenToUid(token);
  } catch (e) {
    logger.logWarning('Auth middleware: token rejected:', e);
    return c.json({ error: 'Unauthorized' }, 401);
  }

  // Reject suspended (banned) accounts before any handler runs — one indexed
  // PK lookup per authenticated request. A missing row is left to the
  // downstream handler, which returns its own 404.
  const [row] = await db.select({ bannedAt: users.bannedAt })
    .from(users)
    .where(eq(users.id, uid))
    .limit(1);
  if (row?.bannedAt) {
    return c.json({ error: 'account-suspended' }, 403);
  }

  c.set('uid', uid);
  return next();
});
