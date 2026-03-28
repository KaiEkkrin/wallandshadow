import { Hono } from 'hono';
import { authMiddleware, type AuthVariables } from '../auth/middleware.js';
import { db } from '../db/connection.js';
import { inviteToAdventure, joinAdventure } from '../services/extensions.js';
import { IInviteExpiryPolicy } from '@wallandshadow/shared';

export const inviteRoutes = new Hono<{ Variables: AuthVariables }>();

inviteRoutes.use('/*', authMiddleware);

inviteRoutes.post('/adventures/:id/invites', async (c) => {
  const uid = c.get('uid');
  const adventureId = c.req.param('id');
  const body = await c.req.json<{ policy?: IInviteExpiryPolicy }>().catch(() => ({}));
  const inviteId = await inviteToAdventure(db, uid, adventureId, (body as { policy?: IInviteExpiryPolicy }).policy);
  return c.json({ inviteId });
});

inviteRoutes.post('/invites/:id/join', async (c) => {
  const uid = c.get('uid');
  const inviteId = c.req.param('id');
  const body = await c.req.json<{ policy?: IInviteExpiryPolicy }>().catch(() => ({}));
  const adventureId = await joinAdventure(db, uid, inviteId, (body as { policy?: IInviteExpiryPolicy }).policy);
  return c.json({ adventureId });
});
