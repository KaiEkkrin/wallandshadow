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

// Validate untrusted JSON at the route boundary. These bodies are persisted to
// JSONB columns, so a malformed object would be stored silently and surface
// later as a client renderer fault.
function assertObject(
  value: unknown,
  message: string,
): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    throwApiError('invalid-argument', message);
  }
}

function assertValidCharacter(value: unknown): asserts value is ICharacter {
  assertObject(value, 'Character must be an object');
  if (typeof value.id !== 'string' || value.id === '') {
    throwApiError('invalid-argument', 'Character id must be a non-empty string');
  }
  if (typeof value.name !== 'string') {
    throwApiError('invalid-argument', 'Character name must be a string');
  }
  if (typeof value.text !== 'string') {
    throwApiError('invalid-argument', 'Character text must be a string');
  }
  if (!Array.isArray(value.sprites)) {
    throwApiError('invalid-argument', 'Character sprites must be an array');
  }
  for (const sprite of value.sprites) {
    assertObject(sprite, 'Character sprite must be an object');
    if (typeof sprite.source !== 'string' || typeof sprite.geometry !== 'string') {
      throwApiError('invalid-argument', 'Character sprite must have string source and geometry');
    }
  }
}

function assertValidPlayerPatch(
  value: unknown,
): asserts value is { allowed?: boolean; characters?: ICharacter[] } {
  assertObject(value, 'Request body must be an object');
  if (value.allowed !== undefined && typeof value.allowed !== 'boolean') {
    throwApiError('invalid-argument', 'allowed must be a boolean');
  }
  if (value.characters !== undefined) {
    if (!Array.isArray(value.characters)) {
      throwApiError('invalid-argument', 'characters must be an array');
    }
    for (const character of value.characters) assertValidCharacter(character);
  }
}

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
  const body = await c.req.json<unknown>();
  assertValidPlayerPatch(body);
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
  const body = await c.req.json<unknown>();
  assertValidCharacter(body);
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
