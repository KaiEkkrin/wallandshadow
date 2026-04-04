import { Hono } from 'hono';
import { authMiddleware, type AuthVariables } from '../auth/middleware.js';
import { db } from '../db/connection.js';
import {
  adventures,
  adventurePlayers,
  maps,
  users,
} from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import {
  createAdventure,
  deleteAdventure,
  updateAdventure,
  leaveAdventure,
  assertAdventureMember,
} from '../services/extensions.js';

export const adventureRoutes = new Hono<{ Variables: AuthVariables }>();

adventureRoutes.use('/*', authMiddleware);

// ── List adventures the user is a member of ──────────────────────────────────

adventureRoutes.get('/adventures', async (c) => {
  const uid = c.get('uid');

  const rows = await db
    .select({
      id: adventures.id,
      name: adventures.name,
      description: adventures.description,
      ownerId: adventures.ownerId,
      imagePath: adventures.imagePath,
      ownerName: users.name,
    })
    .from(adventurePlayers)
    .innerJoin(adventures, eq(adventurePlayers.adventureId, adventures.id))
    .innerJoin(users, eq(adventures.ownerId, users.id))
    .where(eq(adventurePlayers.userId, uid));

  return c.json(rows.map(r => ({
    id: r.id,
    name: r.name,
    description: r.description,
    owner: r.ownerId,
    ownerName: r.ownerName,
    imagePath: r.imagePath,
  })));
});

// ── Get one adventure ────────────────────────────────────────────────────────

adventureRoutes.get('/adventures/:id', async (c) => {
  const uid = c.get('uid');
  const adventureId = c.req.param('id');

  await assertAdventureMember(db, uid, adventureId);

  const [adv] = await db
    .select({
      id: adventures.id,
      name: adventures.name,
      description: adventures.description,
      ownerId: adventures.ownerId,
      imagePath: adventures.imagePath,
      ownerName: users.name,
    })
    .from(adventures)
    .innerJoin(users, eq(adventures.ownerId, users.id))
    .where(eq(adventures.id, adventureId))
    .limit(1);

  if (!adv) {
    return c.json({ error: 'Adventure not found' }, 404);
  }

  const mapRows = await db
    .select({
      id: maps.id,
      name: maps.name,
      description: maps.description,
      ty: maps.ty,
      imagePath: maps.imagePath,
    })
    .from(maps)
    .where(eq(maps.adventureId, adventureId));

  return c.json({
    id: adv.id,
    name: adv.name,
    description: adv.description,
    owner: adv.ownerId,
    ownerName: adv.ownerName,
    imagePath: adv.imagePath,
    maps: mapRows.map(m => ({
      adventureId,
      id: m.id,
      name: m.name,
      description: m.description,
      ty: m.ty,
      imagePath: m.imagePath,
    })),
  });
});

// ── Create adventure ─────────────────────────────────────────────────────────

adventureRoutes.post('/adventures', async (c) => {
  const uid = c.get('uid');
  const body = await c.req.json<{ name?: string; description?: string }>();
  const { name, description } = body;
  if (!name) {
    return c.json({ error: 'name is required' }, 400);
  }
  const id = await createAdventure(db, uid, name, description ?? '');
  return c.json({ id }, 201);
});

// ── Update adventure ─────────────────────────────────────────────────────────

adventureRoutes.patch('/adventures/:id', async (c) => {
  const uid = c.get('uid');
  const adventureId = c.req.param('id');
  const body = await c.req.json<{ name?: string; description?: string; imagePath?: string }>();
  const fields: { name?: string; description?: string; imagePath?: string } = {};
  if (body.name !== undefined) fields.name = body.name;
  if (body.description !== undefined) fields.description = body.description;
  if (body.imagePath !== undefined) fields.imagePath = body.imagePath;
  await updateAdventure(db, uid, adventureId, fields);
  return c.body(null, 204);
});

// ── Delete adventure ─────────────────────────────────────────────────────────

adventureRoutes.delete('/adventures/:id', async (c) => {
  const uid = c.get('uid');
  const adventureId = c.req.param('id');
  await deleteAdventure(db, uid, adventureId);
  return c.body(null, 204);
});

// ── Leave adventure (player removes themselves) ──────────────────────────────

adventureRoutes.delete('/adventures/:id/players/me', async (c) => {
  const uid = c.get('uid');
  const adventureId = c.req.param('id');
  await leaveAdventure(db, uid, adventureId);
  return c.body(null, 204);
});
