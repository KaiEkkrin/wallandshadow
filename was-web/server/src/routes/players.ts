import { Hono } from 'hono';
import type { ICharacter } from '@wallandshadow/shared';
import { authMiddleware, type AuthVariables } from '../auth/middleware.js';
import { db } from '../db/connection.js';
import { adventurePlayers } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import {
  updatePlayer,
  assertAdventureMember,
} from '../services/extensions.js';

export const playerRoutes = new Hono<{ Variables: AuthVariables }>();

playerRoutes.use('/*', authMiddleware);

// ── List players in an adventure ─────────────────────────────────────────────

playerRoutes.get('/adventures/:id/players', async (c) => {
  const uid = c.get('uid');
  const adventureId = c.req.param('id');

  await assertAdventureMember(db, uid, adventureId);

  const rows = await db
    .select({
      userId: adventurePlayers.userId,
      playerName: adventurePlayers.playerName,
      allowed: adventurePlayers.allowed,
      characters: adventurePlayers.characters,
      joinedAt: adventurePlayers.joinedAt,
    })
    .from(adventurePlayers)
    .where(eq(adventurePlayers.adventureId, adventureId));

  return c.json(rows.map(r => ({
    playerId: r.userId,
    playerName: r.playerName,
    allowed: r.allowed,
    characters: r.characters as ICharacter[],
  })));
});

// ── Update a player (own characters; owner can also change `allowed`) ────────

playerRoutes.patch('/adventures/:id/players/:userId', async (c) => {
  const uid = c.get('uid');
  const adventureId = c.req.param('id');
  const playerId = c.req.param('userId');
  const body = await c.req.json<{ allowed?: boolean; characters?: ICharacter[] }>();
  const fields: { allowed?: boolean; characters?: ICharacter[] } = {};
  if (body.allowed !== undefined) fields.allowed = body.allowed;
  if (body.characters !== undefined) fields.characters = body.characters;
  await updatePlayer(db, uid, adventureId, playerId, fields);
  return c.body(null, 204);
});
