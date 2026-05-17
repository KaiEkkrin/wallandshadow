import { ICharacter, IStorage, ILogger, getUserPolicy, UserLevel } from '@wallandshadow/shared';
import { throwApiError } from '../errors.js';
import { Db } from '../db/connection.js';
import { adventures, adventurePlayers, mapChanges, maps, mapImages, images, spritesheets, users } from '../db/schema.js';
import { eq, and, sql, count } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { assertAdventureMember, scrubMapSpriteReferences } from './extensions.js';
import {
  notifyAdventurePlayers,
  notifyAdventureSpritesheets,
  notifyMapChange,
  notifySafe,
} from '../ws/notify.js';

export async function addImage(
  db: Db,
  storage: IStorage,
  uid: string,
  name: string,
  contentType: string,
  fileData: Blob,
): Promise<{ id: string; name: string; path: string }> {
  if (!contentType.startsWith('image/')) {
    throwApiError('invalid-argument', 'Only image files are allowed');
  }

  const id = uuidv7();
  const path = `images/${uid}/${id}`;

  await db.transaction(async (tx) => {
    const [user] = await tx.select({ level: users.level })
      .from(users).where(eq(users.id, uid)).limit(1);
    if (!user) {
      throwApiError('permission-denied', 'No profile available');
    }

    const [{ imageCount }] = await tx.select({ imageCount: count() })
      .from(images).where(eq(images.userId, uid));
    const policy = getUserPolicy(user.level as UserLevel);
    if (imageCount >= policy.images) {
      throwApiError('resource-exhausted', 'You have too many images; delete one to upload another.');
    }

    await tx.insert(images).values({ id, userId: uid, name, path });
  });

  try {
    await storage.ref(path).put(fileData, { contentType });
  } catch (e) {
    await db.delete(images).where(eq(images.id, id));
    throw e;
  }

  return { id, name, path };
}

export function getImageUid(path: string): string | undefined {
  // Extract the uid from the image path: images/{uid}/{filename}
  const result = /^\/?images\/([^/]+)\/([^/]+)/.exec(path);
  return result ? result[1] : undefined;
}

function getSpritesheetId(path: string): string | undefined {
  const match = /^sprites\/([^/]+)\.png$/.exec(path);
  return match ? match[1] : undefined;
}

export async function assertImageDownloadAccess(
  db: Db,
  logger: ILogger,
  uid: string,
  path: string,
): Promise<void> {
  // Case 1: images/{ownerUid}/{id}
  const imageOwner = getImageUid(path);
  if (imageOwner) {
    if (imageOwner === uid) return; // Owner can always download their own images

    // Four grant sources: adventure background, map background, spritesheet source,
    // or an image placed onto a map (tracked in map_images junction).
    const memberOfAdventure = sql`(${adventures.ownerId} = ${uid} OR (${adventurePlayers.userId} = ${uid} AND ${adventurePlayers.allowed} = true))`;
    const result = await db.execute<{ found: boolean }>(sql`
      SELECT EXISTS (
        SELECT 1 FROM ${adventures}
          LEFT JOIN ${adventurePlayers} ON ${adventurePlayers.adventureId} = ${adventures.id}
        WHERE ${adventures.imagePath} = ${path} AND ${memberOfAdventure}
        UNION ALL
        SELECT 1 FROM ${maps}
          JOIN ${adventures} ON ${adventures.id} = ${maps.adventureId}
          LEFT JOIN ${adventurePlayers} ON ${adventurePlayers.adventureId} = ${adventures.id}
        WHERE ${maps.imagePath} = ${path} AND ${memberOfAdventure}
        UNION ALL
        SELECT 1 FROM ${spritesheets}
          JOIN ${adventures} ON ${adventures.id} = ${spritesheets.adventureId}
          LEFT JOIN ${adventurePlayers} ON ${adventurePlayers.adventureId} = ${adventures.id}
        WHERE ${spritesheets.sprites}::jsonb @> ${JSON.stringify([path])}::jsonb AND ${memberOfAdventure}
        UNION ALL
        SELECT 1 FROM ${mapImages}
          JOIN ${maps} ON ${maps.id} = ${mapImages.mapId}
          JOIN ${adventures} ON ${adventures.id} = ${maps.adventureId}
          LEFT JOIN ${adventurePlayers} ON ${adventurePlayers.adventureId} = ${adventures.id}
        WHERE ${mapImages.path} = ${path} AND ${memberOfAdventure}
      ) AS found
    `);
    // Return 404 rather than 403 to avoid leaking whether the image exists (RFC 9110 §15.5.4).
    // Log at warning level so operators can investigate reports of missing images without
    // exposing information to the client.
    if (!result.rows[0]?.found) {
      logger.logWarning(`Image download denied (not referenced) for user ${uid}, path ${path}`);
      throwApiError('not-found', 'Image not found');
    }
    return;
  }

  // Case 2: sprites/{id}.png
  const sheetId = getSpritesheetId(path);
  if (sheetId) {
    const [row] = await db.select({ adventureId: spritesheets.adventureId })
      .from(spritesheets)
      .where(eq(spritesheets.id, sheetId))
      .limit(1);
    if (!row) {
      logger.logWarning(`Image download denied (no spritesheet) for user ${uid}, path ${path}`);
      throwApiError('not-found', 'Image not found');
    }
    // assertAdventureMember throws 403 for non-members; convert to 404 to avoid leaking existence
    try {
      await assertAdventureMember(db, uid, row.adventureId);
    } catch {
      logger.logWarning(`Image download denied (not adventure member) for user ${uid}, path ${path}`);
      throwApiError('not-found', 'Image not found');
    }
    return;
  }

  // Case 3: unrecognised path — also 404 (don't reveal which paths are valid)
  logger.logWarning(`Image download denied (unrecognised path format) for user ${uid}, path ${path}`);
  throwApiError('not-found', 'Image not found');
}

export async function deleteImage(
  db: Db,
  storage: IStorage,
  logger: ILogger,
  uid: string,
  path: string,
): Promise<void> {
  const pathUid = getImageUid(path);
  if (!pathUid || pathUid !== uid) {
    throwApiError('permission-denied', 'This image path corresponds to a different user id');
  }

  const spritesheetAdventureIds = new Set<string>();  // → notifyAdventureSpritesheets
  const playerAdventureIds = new Set<string>();        // → notifyAdventurePlayers
  const mapChangeNotifies: { mapId: string; id: string; seq: string }[] = [];

  await db.transaction(async (tx) => {
    await tx.delete(images).where(eq(images.path, path));
    await tx.update(adventures).set({ imagePath: '' }).where(eq(adventures.imagePath, path));
    await tx.update(maps).set({ imagePath: '' }).where(eq(maps.imagePath, path));
    await tx.delete(mapImages).where(eq(mapImages.path, path));

    // The freed spritesheet slot is recycled when a new sprite of matching
    // geometry is added (see spriteExtensions.allocateNewSpritesToSheets) —
    // that regeneration is what physically removes the deleted image's pixels
    // from object storage. Leaving the stale pixels in place until then is OK
    // because the token/character cleanup below clears every live reference.
    const spritesheetRows = await tx.select({
      id: spritesheets.id,
      adventureId: spritesheets.adventureId,
      sprites: spritesheets.sprites,
      freeSpaces: spritesheets.freeSpaces,
    })
      .from(spritesheets)
      .where(sql`${spritesheets.sprites}::jsonb @> ${JSON.stringify([path])}::jsonb`);

    for (const row of spritesheetRows) {
      const sprites = row.sprites as string[];
      const newSprites = sprites.map(s => s === path ? '' : s);
      const freed = sprites.filter(s => s === path).length;
      await tx.update(spritesheets)
        .set({ sprites: newSprites as unknown as object, freeSpaces: row.freeSpaces + freed })
        .where(eq(spritesheets.id, row.id));
      spritesheetAdventureIds.add(row.adventureId);
    }

    // Driven by its own containment query, not the spritesheet set: a token
    // can reference an image whose spritesheet slot was already recycled.
    const mapRows = await tx.selectDistinct({ mapId: mapChanges.mapId })
      .from(mapChanges)
      .where(sql`${mapChanges.changes}::jsonb @> ${JSON.stringify({ chs: [{ feature: { sprites: [{ source: path }] } }] })}::jsonb`);

    for (const m of mapRows) {
      const result = await scrubMapSpriteReferences(tx, m.mapId, path);
      if (result) {
        mapChangeNotifies.push({ mapId: m.mapId, id: result.id, seq: result.seq });
      }
    }

    // Likewise independent of the spritesheet set: a character can reference an
    // image with no spritesheet at all.
    const playerRows = await tx.select({
      adventureId: adventurePlayers.adventureId,
      userId: adventurePlayers.userId,
      characters: adventurePlayers.characters,
    })
      .from(adventurePlayers)
      .where(sql`${adventurePlayers.characters}::jsonb @> ${JSON.stringify([{ sprites: [{ source: path }] }])}::jsonb`);

    for (const p of playerRows) {
      const updated = (p.characters as ICharacter[]).map(c => ({
        ...c,
        sprites: c.sprites.filter(s => s.source !== path),
      }));
      await tx.update(adventurePlayers)
        .set({ characters: updated as unknown as object })
        .where(and(
          eq(adventurePlayers.adventureId, p.adventureId),
          eq(adventurePlayers.userId, p.userId),
        ));
      playerAdventureIds.add(p.adventureId);
    }
  });

  try {
    await storage.ref(path).delete();
  } catch (e) {
    logger.logWarning(`Failed to delete storage object at ${path}`, e);
  }

  const notifyPromises: Promise<void>[] = [];
  for (const adventureId of spritesheetAdventureIds) {
    notifyPromises.push(notifyAdventureSpritesheets(adventureId));
  }
  for (const adventureId of playerAdventureIds) {
    notifyPromises.push(notifyAdventurePlayers(adventureId));
  }
  for (const m of mapChangeNotifies) {
    notifyPromises.push(notifyMapChange(m.mapId, m.id, m.seq));
  }
  await notifySafe(...notifyPromises);
}
