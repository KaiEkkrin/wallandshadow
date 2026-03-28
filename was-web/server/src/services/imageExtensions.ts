import { IStorage, ILogger } from '@wallandshadow/shared';
import { throwApiError } from '../errors.js';
import { Db } from '../db/connection.js';
import { adventures, maps, images, spritesheets } from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';

function getImageUid(path: string): string | undefined {
  // Extract the uid from the image path: images/{uid}/{filename}
  const result = /^\/?images\/([^/]+)\/([^/]+)/.exec(path);
  return result ? result[1] : undefined;
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

  await db.transaction(async (tx) => {
    // Remove from images table
    await tx.delete(images).where(eq(images.path, path));

    // Clear image_path on adventures and maps that reference it
    await tx.update(adventures).set({ imagePath: '' }).where(eq(adventures.imagePath, path));
    await tx.update(maps).set({ imagePath: '' }).where(eq(maps.imagePath, path));

    // Clear path from spritesheets sprites JSONB arrays:
    // Replace matching source string with "" in the sprites JSON array, increment free_spaces
    const spritesheetRows = await tx.select({ id: spritesheets.id, sprites: spritesheets.sprites, freeSpaces: spritesheets.freeSpaces })
      .from(spritesheets)
      .where(sql`${spritesheets.sprites}::jsonb @> ${JSON.stringify([path])}::jsonb`);

    for (const row of spritesheetRows) {
      const sprites = row.sprites as string[];
      const newSprites = sprites.map(s => s === path ? '' : s);
      const freed = sprites.filter(s => s === path).length;
      await tx.update(spritesheets)
        .set({ sprites: newSprites as unknown as object, freeSpaces: row.freeSpaces + freed })
        .where(eq(spritesheets.id, row.id));
    }
  });

  try {
    await storage.ref(path).delete();
  } catch (e) {
    logger.logWarning(`Failed to delete storage object at ${path}`, e);
  }
}
