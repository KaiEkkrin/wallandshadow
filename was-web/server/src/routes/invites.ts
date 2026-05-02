import { Hono } from 'hono';
import { authMiddleware, type AuthVariables } from '../auth/middleware.js';
import { inviteJoinRateLimiter } from '../middleware/rateLimiters.js';
import { db } from '../db/connection.js';
import { invites, adventures, users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { inviteToAdventure, joinAdventure } from '../services/extensions.js';
import { IInviteExpiryPolicy } from '@wallandshadow/shared';

export const inviteRoutes = new Hono<{ Variables: AuthVariables }>();

inviteRoutes.use('/*', authMiddleware);

// ── Get invite details ──────────────────────────────────────────────────────

inviteRoutes.get('/invites/:id', async (c) => {
  const inviteId = c.req.param('id');

  const [row] = await db
    .select({
      id: invites.id,
      adventureId: invites.adventureId,
      adventureName: adventures.name,
      ownerName: users.name,
      expiresAt: invites.expiresAt,
    })
    .from(invites)
    .innerJoin(adventures, eq(invites.adventureId, adventures.id))
    .innerJoin(users, eq(invites.ownerId, users.id))
    .where(eq(invites.id, inviteId))
    .limit(1);

  if (!row) {
    return c.json({ error: 'Invite not found' }, 404);
  }

  return c.json({
    id: row.id,
    adventureId: row.adventureId,
    adventureName: row.adventureName,
    ownerName: row.ownerName,
    expiresAt: row.expiresAt,
  });
});

inviteRoutes.post('/adventures/:id/invites', async (c) => {
  const uid = c.get('uid');
  const adventureId = c.req.param('id');
  const body = await c.req.json<{ policy?: IInviteExpiryPolicy }>().catch(() => ({}));
  const inviteId = await inviteToAdventure(db, uid, adventureId, (body as { policy?: IInviteExpiryPolicy }).policy);
  return c.json({ inviteId });
});

inviteRoutes.post('/invites/:id/join', inviteJoinRateLimiter, async (c) => {
  const uid = c.get('uid');
  const inviteId = c.req.param('id');
  const body = await c.req.json<{ policy?: IInviteExpiryPolicy }>().catch(() => ({}));
  const adventureId = await joinAdventure(db, uid, inviteId, (body as { policy?: IInviteExpiryPolicy }).policy);
  return c.json({ adventureId });
});
