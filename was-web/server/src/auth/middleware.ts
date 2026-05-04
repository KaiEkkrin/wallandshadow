import { createMiddleware } from 'hono/factory';
import { resolveTokenToUid } from './resolveToken.js';
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
  try {
    const uid = await resolveTokenToUid(token);
    c.set('uid', uid);
    return next();
  } catch (e) {
    logger.logWarning('Auth middleware: token rejected:', e);
    return c.json({ error: 'Unauthorized' }, 401);
  }
});
