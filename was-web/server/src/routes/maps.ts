import { Hono } from 'hono';
import { MapType } from '@wallandshadow/shared';
import { authMiddleware, type AuthVariables } from '../auth/middleware.js';
import { db } from '../db/connection.js';
import { adventures, adventurePlayers, maps as mapsTable } from '../db/schema.js';
import { and, eq } from 'drizzle-orm';
import {
  createMap,
  cloneMap,
  consolidateMapChanges,
  deleteMap,
} from '../services/extensions.js';
import { throwApiError } from '../errors.js';
import { IMap } from '@wallandshadow/shared';

export const mapRoutes = new Hono<{ Variables: AuthVariables }>();

mapRoutes.use('/*', authMiddleware);

mapRoutes.post('/adventures/:id/maps', async (c) => {
  const uid = c.get('uid');
  const adventureId = c.req.param('id');
  const body = await c.req.json<{
    name?: string;
    description?: string;
    ty?: MapType;
    ffa?: boolean;
  }>();
  const { name, description, ty, ffa } = body;
  if (!name || !ty) {
    return c.json({ error: 'name and ty are required' }, 400);
  }
  const id = await createMap(db, uid, adventureId, name, description ?? '', ty, ffa ?? false);
  return c.json({ id }, 201);
});

mapRoutes.post('/adventures/:id/maps/:mapId/clone', async (c) => {
  const uid = c.get('uid');
  const adventureId = c.req.param('id');
  const mapId = c.req.param('mapId');
  const body = await c.req.json<{ name?: string; description?: string }>();
  const { name, description } = body;
  if (!name) {
    return c.json({ error: 'name is required' }, 400);
  }

  // Check user is adventure owner or allowed player
  await assertAdventureMember(uid, adventureId);

  const id = await cloneMap(db, uid, adventureId, mapId, name, description ?? '');
  return c.json({ id }, 201);
});

mapRoutes.post('/adventures/:id/maps/:mapId/consolidate', async (c) => {
  const uid = c.get('uid');
  const adventureId = c.req.param('id');
  const mapId = c.req.param('mapId');
  const body = await c.req.json<{ resync?: boolean }>().catch(() => ({}));
  const resync = (body as { resync?: boolean }).resync ?? false;

  // Fetch map and adventure to construct IMap; also verify membership
  const [row] = await db.select({
    name: mapsTable.name,
    description: mapsTable.description,
    ty: mapsTable.ty,
    ffa: mapsTable.ffa,
    imagePath: mapsTable.imagePath,
    adventureName: adventures.name,
    ownerId: adventures.ownerId,
  })
    .from(mapsTable)
    .innerJoin(adventures, eq(mapsTable.adventureId, adventures.id))
    .where(and(eq(mapsTable.id, mapId), eq(mapsTable.adventureId, adventureId)))
    .limit(1);

  if (!row) {
    return c.json({ error: 'Map not found' }, 404);
  }

  // Check user is adventure owner or allowed player
  if (row.ownerId !== uid) {
    const [playerRow] = await db.select({ allowed: adventurePlayers.allowed })
      .from(adventurePlayers)
      .where(and(
        eq(adventurePlayers.adventureId, adventureId),
        eq(adventurePlayers.userId, uid),
        eq(adventurePlayers.allowed, true),
      ))
      .limit(1);
    if (!playerRow) {
      throwApiError('permission-denied', 'You are not in this adventure');
    }
  }

  const mapRecord: IMap = {
    adventureName: row.adventureName,
    name: row.name,
    description: row.description,
    ty: row.ty as MapType,
    ffa: row.ffa,
    imagePath: row.imagePath,
    owner: row.ownerId,
  };

  await consolidateMapChanges(db, uid, adventureId, mapId, mapRecord, resync);
  return c.body(null, 204);
});

mapRoutes.delete('/adventures/:id/maps/:mapId', async (c) => {
  const uid = c.get('uid');
  const adventureId = c.req.param('id');
  const mapId = c.req.param('mapId');
  await deleteMap(db, uid, adventureId, mapId);
  return c.body(null, 204);
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function assertAdventureMember(uid: string, adventureId: string): Promise<void> {
  const [row] = await db.select({ ownerId: adventures.ownerId })
    .from(adventures)
    .where(eq(adventures.id, adventureId))
    .limit(1);

  if (!row) {
    throwApiError('not-found', 'Adventure not found');
  }
  if (row.ownerId === uid) return;

  const [playerRow] = await db.select({ allowed: adventurePlayers.allowed })
    .from(adventurePlayers)
    .where(and(
      eq(adventurePlayers.adventureId, adventureId),
      eq(adventurePlayers.userId, uid),
      eq(adventurePlayers.allowed, true),
    ))
    .limit(1);

  if (!playerRow) {
    throwApiError('permission-denied', 'You are not in this adventure');
  }
}
