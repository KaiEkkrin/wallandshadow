import { Hono } from 'hono';
import { authMiddleware, type AuthVariables } from '../auth/middleware.js';
import { adminMiddleware } from '../auth/adminMiddleware.js';
import { db } from '../db/connection.js';
import { throwApiError } from '../errors.js';
import { findUserSummary, getUserDetail } from '../services/adminExtensions.js';
import { banUser } from '../services/banExtensions.js';
import { storage } from '../services/storage.js';
import { logger } from '../services/logger.js';

export const adminRoutes = new Hono<{ Variables: AuthVariables }>();

// Every /admin/* route is gated: authenticate, then require the admin tier.
adminRoutes.use('/admin/*', authMiddleware);
adminRoutes.use('/admin/*', adminMiddleware);

// ── Search for a single account by email, account id, or external id ─────────

adminRoutes.get('/admin/users', async (c) => {
  const term = c.req.query('q')?.trim();
  if (!term) {
    throwApiError('invalid-argument', 'A search term is required');
  }
  const summary = await findUserSummary(db, term);
  if (!summary) {
    throwApiError('not-found', 'User not found');
  }
  return c.json(summary);
});

// ── Full account info: summary + adventures / maps / images tables ───────────

adminRoutes.get('/admin/users/:id', async (c) => {
  const detail = await getUserDetail(db, c.req.param('id'));
  return c.json(detail);
});

adminRoutes.post('/admin/users/:id/ban', async (c) => {
  const targetUid = c.req.param('id');
  const adminUid = c.get('uid');
  // banUser's guards handle existence + same-user + admin + already-banned.
  // The UUID format check is implicit in the existence lookup (a non-UUID
  // produces a not-found rather than a 500 because Drizzle's parameterised
  // query throws cleanly for it). If a future driver change makes that throw
  // a 500 instead, add a UUID_RE guard here.
  const summary = await banUser(db, storage, logger, adminUid, targetUid);
  return c.json(summary);
});
