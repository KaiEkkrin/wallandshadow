import { createMiddleware } from 'hono/factory';
import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { users } from '../db/schema.js';
import type { AuthVariables } from './middleware.js';

// Requires the authenticated user to hold the 'admin' tier. Must run AFTER
// authMiddleware, which resolves the Bearer token and sets `uid` on the context.
// TODO(session-3): also reject banned users here once users.bannedAt exists.
export const adminMiddleware = createMiddleware<{ Variables: AuthVariables }>(
  async (c, next) => {
    const uid = c.get('uid');
    const [row] = await db
      .select({ level: users.level })
      .from(users)
      .where(eq(users.id, uid))
      .limit(1);
    if (!row || row.level !== 'admin') {
      return c.json({ error: 'Forbidden' }, 403);
    }
    return next();
  },
);
