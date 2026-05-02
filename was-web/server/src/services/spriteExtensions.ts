import {
  fromSpriteGeometryString,
  getSpritePathFromId,
  ISprite,
  ISpritesheet,
  ILogger,
  IStorage,
  IStorageReference,
} from '@wallandshadow/shared';
import { throwApiError } from '../errors.js';
import { Db } from '../db/connection.js';
import { notifyAdventureSpritesheets, notifySafe } from '../ws/notify.js';
import { adventures, adventurePlayers, spritesheets } from '../db/schema.js';
import { eq, and, gt, isNull, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import sharp from 'sharp';

async function createMontage(
  storage: IStorage,
  logger: ILogger,
  sources: string[],
  geometry: string,
  newSheetId: string,
): Promise<IStorageReference> {
  const tmp = os.tmpdir();
  const tmpPaths: string[] = [];
  try {
    logger.logInfo('downloading: ' + sources);
    const downloaded = await Promise.all(sources.map(async s => {
      if (s === '') return null;
      const tmpPath = path.join(tmp, uuidv7());
      await storage.ref(s).download(tmpPath);
      tmpPaths.push(tmpPath);
      return tmpPath;
    }));

    const { columns, rows } = fromSpriteGeometryString(geometry);
    const tileWidth = Math.floor(1024 / columns);
    const tileHeight = Math.floor(1024 / rows);
    logger.logInfo('assembling spritesheet');

    const composites = (await Promise.all(
      downloaded.map(async (p, i) => {
        if (p === null) return null;
        const buf = await sharp(p).resize(tileWidth, tileHeight, { fit: 'fill' }).toBuffer();
        return {
          input: buf,
          left: (i % columns) * tileWidth,
          top: Math.floor(i / columns) * tileHeight,
        };
      }),
    )).filter((c): c is NonNullable<typeof c> => c !== null);

    const tmpSheetPath = path.join(tmp, `${uuidv7()}.png`);
    tmpPaths.push(tmpSheetPath);
    await sharp({
      create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite(composites)
      .png()
      .toFile(tmpSheetPath);

    const spritePath = getSpritePathFromId(newSheetId);
    logger.logInfo(`uploading: ${spritePath}`);
    const sheetRef = storage.ref(spritePath);
    await sheetRef.upload(tmpSheetPath, { contentType: 'image/png' });
    return sheetRef;
  } finally {
    await Promise.all(
      tmpPaths.map(p => fs.unlink(p).catch(() => {})),
    );
  }
}

async function getExistingSprites(
  db: Db,
  adventureId: string,
  geometry: string,
  sources: string[],
): Promise<{ found: ISprite[]; missing: string[] }> {
  const rows = await db.select({ geometry: spritesheets.geometry, sprites: spritesheets.sprites })
    .from(spritesheets)
    .where(and(
      eq(spritesheets.adventureId, adventureId),
      eq(spritesheets.geometry, geometry),
      isNull(spritesheets.supersededBy),
    ));

  const sourceSet = new Set(sources);
  const foundSources = new Set<string>();
  const found: ISprite[] = [];

  for (const row of rows) {
    for (const sprite of row.sprites as string[]) {
      if (sourceSet.has(sprite) && !foundSources.has(sprite)) {
        found.push({ source: sprite, geometry: row.geometry });
        foundSources.add(sprite);
      }
    }
  }

  const missing = sources.filter(s => !foundSources.has(s));
  return { found, missing };
}

interface AllocatedSprites {
  sources: string[];
  oldSheetId: string | undefined;
  newSheetId: string;
}

async function allocateNewSpritesToSheets(
  db: Db,
  logger: ILogger,
  adventureId: string,
  geometry: string,
  sources: string[],
): Promise<AllocatedSprites[]> {
  const canExtend = await db.select({ id: spritesheets.id, freeSpaces: spritesheets.freeSpaces, sprites: spritesheets.sprites })
    .from(spritesheets)
    .where(and(
      eq(spritesheets.adventureId, adventureId),
      eq(spritesheets.geometry, geometry),
      gt(spritesheets.freeSpaces, 0),
      isNull(spritesheets.supersededBy),
    ));

  logger.logInfo(`found ${canExtend.length} extendable sheets`);

  const toAllocate = [...sources];
  const allAllocated: AllocatedSprites[] = [];

  for (const s of canExtend) {
    let freeSpaces = s.freeSpaces;
    logger.logInfo(`trying to extend ${s.id} (${freeSpaces} free)`);
    const currentSources = [...(s.sprites as string[])];

    while (freeSpaces > 0 && toAllocate.length > 0) {
      const source = toAllocate.pop()!;
      const gapIndex = currentSources.indexOf('');
      if (gapIndex >= 0) {
        currentSources[gapIndex] = source;
      } else {
        currentSources.push(source);
      }
      --freeSpaces;
    }

    allAllocated.push({ sources: currentSources, oldSheetId: s.id, newSheetId: uuidv7() });

    if (toAllocate.length === 0) break;
  }

  // Increment refs on old sheets (concurrent-safe deletion guard)
  await db.transaction(async (tx) => {
    for (const a of allAllocated) {
      if (a.oldSheetId) {
        await tx.update(spritesheets)
          .set({ refs: sql`${spritesheets.refs} + 1` })
          .where(eq(spritesheets.id, a.oldSheetId));
      }
    }
  });

  if (toAllocate.length > 0) {
    allAllocated.push({ sources: toAllocate, oldSheetId: undefined, newSheetId: uuidv7() });
  }

  for (const a of allAllocated) {
    logger.logInfo(`allocated ${a.sources} to ${a.newSheetId} (from ${a.oldSheetId})`);
  }

  return allAllocated;
}

async function writeNewSpritesheets(
  db: Db,
  storage: IStorage,
  logger: ILogger,
  allocated: AllocatedSprites[],
  geometry: string,
  adventureId: string,
): Promise<void> {
  try {
    await Promise.all(allocated.map(a => createMontage(storage, logger, a.sources, geometry, a.newSheetId)));

    const toDelete: string[] = [];
    await db.transaction(async (tx) => {
      const sg = fromSpriteGeometryString(geometry);

      for (const a of allocated) {
        const newSheet: ISpritesheet = {
          sprites: a.sources,
          geometry,
          freeSpaces: sg.columns * sg.rows - a.sources.length,
          date: Date.now(),
          supersededBy: '',
          refs: 0,
        };
        await tx.insert(spritesheets).values({
          id: a.newSheetId,
          adventureId,
          sprites: newSheet.sprites as unknown as object,
          geometry: newSheet.geometry,
          freeSpaces: newSheet.freeSpaces,
          supersededBy: null,
          refs: 0,
        });

        if (a.oldSheetId) {
          const [old] = await tx.select({ refs: spritesheets.refs })
            .from(spritesheets).where(eq(spritesheets.id, a.oldSheetId)).limit(1);
          if (old) {
            const refsNow = old.refs - 1;
            if (refsNow <= 0) {
              await tx.delete(spritesheets).where(eq(spritesheets.id, a.oldSheetId));
              toDelete.push(a.oldSheetId);
            } else {
              await tx.update(spritesheets)
                .set({ supersededBy: a.newSheetId, refs: refsNow })
                .where(eq(spritesheets.id, a.oldSheetId));
            }
          }
        }
      }
    });

    await Promise.all(toDelete.map(i => storage.ref(getSpritePathFromId(i)).delete()));
  } catch (e) {
    // Roll back refs increment on failure
    await db.transaction(async (tx) => {
      for (const a of allocated) {
        if (a.oldSheetId) {
          await tx.update(spritesheets)
            .set({ refs: sql`${spritesheets.refs} - 1` })
            .where(eq(spritesheets.id, a.oldSheetId));
        }
      }
    });
    throw e;
  }
}

export async function addSprites(
  db: Db,
  logger: ILogger,
  storage: IStorage,
  uid: string,
  adventureId: string,
  geometry: string,
  sources: string[],
): Promise<ISprite[]> {
  const [adventure] = await db.select({ ownerId: adventures.ownerId })
    .from(adventures).where(eq(adventures.id, adventureId)).limit(1);
  if (!adventure) {
    throwApiError('not-found', 'No such adventure');
  }

  if (adventure.ownerId !== uid) {
    const [player] = await db.select({ allowed: adventurePlayers.allowed })
      .from(adventurePlayers)
      .where(and(eq(adventurePlayers.adventureId, adventureId), eq(adventurePlayers.userId, uid)))
      .limit(1);
    if (!player || player.allowed === false) {
      throwApiError('not-found', 'No such adventure');
    }
  }

  if (sources.length > 10) {
    throwApiError('invalid-argument', 'Not more than 10 sources');
  }

  logger.logInfo(`looking for sprites: ${sources}`);
  const { found, missing } = await getExistingSprites(db, adventureId, geometry, sources);
  if (missing.length === 0) {
    return found;
  }

  logger.logInfo(`found ${found.length}, missing ${missing.length}`);
  const allocated = await allocateNewSpritesToSheets(db, logger, adventureId, geometry, missing);
  await writeNewSpritesheets(db, storage, logger, allocated, geometry, adventureId);

  for (const a of allocated) {
    found.push(...a.sources.map((s, i) => ({
      source: s,
      geometry,
      id: a.newSheetId,
      position: i,
    })));
  }

  await notifySafe(notifyAdventureSpritesheets(adventureId));
  return found;
}
