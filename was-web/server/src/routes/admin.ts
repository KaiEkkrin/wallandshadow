import { Hono } from 'hono';
import { authMiddleware, type AuthVariables } from '../auth/middleware.js';
import { adminMiddleware } from '../auth/adminMiddleware.js';
import { db } from '../db/connection.js';
import { findUserSummary, getUserDetail } from '../services/adminExtensions.js';

export const adminRoutes = new Hono<{ Variables: AuthVariables }>();

// Every /admin/* route is gated: authenticate, then require the admin tier.
adminRoutes.use('/admin/*', authMiddleware);
adminRoutes.use('/admin/*', adminMiddleware);

// ── Search for a single account by exact email or exact id ───────────────────

adminRoutes.get('/admin/users', async (c) => {
  const email = c.req.query('email');
  const id = c.req.query('id');
  // Exactly one of email / id is required — reject neither and both.
  if ((email === undefined) === (id === undefined)) {
    return c.json({ error: 'Provide exactly one of email or id' }, 400);
  }
  const summary = email !== undefined
    ? await findUserSummary(db, { email })
    : await findUserSummary(db, { id: id as string });
  if (!summary) {
    return c.json({ error: 'User not found' }, 404);
  }
  return c.json(summary);
});

// ── Full account info: summary + adventures / maps / images tables ───────────

adminRoutes.get('/admin/users/:id', async (c) => {
  const detail = await getUserDetail(db, c.req.param('id'));
  return c.json(detail);
});
