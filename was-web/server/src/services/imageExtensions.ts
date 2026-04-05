import { IStorage, ILogger, getUserPolicy, UserLevel } from '@wallandshadow/shared';
import { throwApiError } from '../errors.js';
import { Db } from '../db/connection.js';
import { adventures, maps, images, spritesheets, users } from '../db/schema.js';
import { eq, sql, count } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

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
