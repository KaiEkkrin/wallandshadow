import { Hono } from 'hono';
import type { ICharacter } from '@wallandshadow/shared';
import { authMiddleware, type AuthVariables } from '../auth/middleware.js';
import { db } from '../db/connection.js';
import { adventurePlayers } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import {
  updatePlayer,
  upsertCharacter,
  removeCharacter,
  assertAdventureMember,
} from '../services/extensions.js';
import { throwApiError } from '../errors.js';

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

// Single-character upsert/delete. Lives alongside the whole-array PATCH
// because the per-character path needs server-side RMW under FOR UPDATE —
// see upsertCharacter in extensions.ts.

playerRoutes.put('/adventures/:id/players/:userId/characters/:characterId', async (c) => {
  const uid = c.get('uid');
  const adventureId = c.req.param('id');
  const playerId = c.req.param('userId');
  const characterId = c.req.param('characterId');
  const body = await c.req.json<ICharacter>();
  // Guard against id-laundering: the path identifies the slot; the body must
  // agree with the path.
  if (body.id !== characterId) {
    throwApiError('invalid-argument', 'Character id in body does not match path');
  }
  await upsertCharacter(db, uid, adventureId, playerId, body);
  return c.body(null, 204);
});

playerRoutes.delete('/adventures/:id/players/:userId/characters/:characterId', async (c) => {
  const uid = c.get('uid');
  const adventureId = c.req.param('id');
  const playerId = c.req.param('userId');
  const characterId = c.req.param('characterId');
  await removeCharacter(db, uid, adventureId, playerId, characterId);
  return c.body(null, 204);
});
