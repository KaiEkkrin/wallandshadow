import { createMiddleware } from 'hono/factory';
import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { users } from '../db/schema.js';
import type { AuthVariables } from './middleware.js';

// Requires the authenticated user to hold the 'admin' tier and not be banned.
// Must run AFTER authMiddleware, which resolves the Bearer token, already
// rejects banned accounts, and sets `uid` on the context. The bannedAt check
// here is belt-and-braces — it keeps this gate self-contained and is free,
// since the same row is fetched for the level check.
export const adminMiddleware = createMiddleware<{ Variables: AuthVariables }>(
  async (c, next) => {
    const uid = c.get('uid');
    const [row] = await db
      .select({ level: users.level, bannedAt: users.bannedAt })
      .from(users)
      .where(eq(users.id, uid))
      .limit(1);
    if (!row || row.level !== 'admin' || row.bannedAt) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    return next();
  },
);
