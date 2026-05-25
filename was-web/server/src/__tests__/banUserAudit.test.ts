import { describe, test, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { users, images } from '../db/schema.js';
import { v7 as uuidv7 } from 'uuid';
import { banUser } from '../services/banExtensions.js';
import type { IStorage, IStorageReference, ILogger } from '@wallandshadow/shared';
import './setup.js';

// Matches the flat-string pattern used in deleteUserS3Audit.test.ts.
class CapturingLogger implements ILogger {
  readonly errors: string[] = [];
  logError(message: string): void { this.errors.push(message); }
  logInfo(): void { /* not asserted on */ }
  logWarning(): void { /* not asserted on */ }
}

// Minimal storage stub whose copy/deleteMany behaviour is supplied per-test.
function makeStubStorage(overrides: Partial<IStorage> = {}): IStorage {
  return {
    ref(): IStorageReference { throw new Error('ref not stubbed'); },
    deleteMany: async () => ({ failed: [] }),
    copy: async () => {},
    ...overrides,
  };
}

// Inserts an admin user and returns their uid.
async function seedAdminUser(): Promise<string> {
  const uid = uuidv7();
  await db.insert(users).values({
    id: uid,
    email: `admin-${uid}@example.com`,
    name: 'Admin',
    passwordHash: 'x',
    level: 'admin',
  });
  return uid;
}

// Inserts a target user with one image row (no real S3 upload needed) and
// returns the user uid and the image path stored in the DB.
async function seedTargetWithImage(): Promise<{ uid: string; path: string }> {
  const uid = uuidv7();
  await db.insert(users).values({
    id: uid,
    email: `target-${uid}@example.com`,
    name: 'Target',
    passwordHash: 'x',
    level: 'higher',
  });
  const path = `images/${uid}/00000000-0000-0000-0000-000000000001`;
  await db.insert(images).values({
    id: uuidv7(),
    userId: uid,
    name: 'audit.png',
    path,
  });
  return { uid, path };
}

describe('banUser — S3 audit logging', () => {
  test('a failed copy logs ORPHANED_S3_OBJECT context=user-ban-copy and the source is NOT deleted', async () => {
    const adminUid = await seedAdminUser();
    const { uid: targetUid, path } = await seedTargetWithImage();

    const logger = new CapturingLogger();
    const deletedPaths: string[] = [];
    const storage = makeStubStorage({
      copy: async () => { throw new Error('simulated copy failure'); },
      deleteMany: async (paths) => {
        deletedPaths.push(...paths);
        return { failed: [] };
      },
    });

    await banUser(db, storage, logger, adminUid, targetUid);

    // The ban DB-side still succeeded.
    const [row] = await db.select({ bannedAt: users.bannedAt })
      .from(users).where(eq(users.id, targetUid)).limit(1);
    expect(row.bannedAt).not.toBeNull();

    // Audit log fired with the copy phase marker.
    const copyOrphans = logger.errors.filter(e =>
      e.includes('ORPHANED_S3_OBJECT') &&
      e.includes('context=user-ban-copy') &&
      e.includes(targetUid) &&
      e.includes(path),
    );
    expect(copyOrphans.length).toBeGreaterThan(0);

    // Source was NOT included in the deleteMany batch (copy failed → source left in place).
    expect(deletedPaths).not.toContain(path);
  });

  test('successful copies followed by a deleteMany batch failure logs ORPHANED_S3_OBJECT context=user-ban-delete', async () => {
    const adminUid = await seedAdminUser();
    const { uid: targetUid, path } = await seedTargetWithImage();

    const logger = new CapturingLogger();
    const storage = makeStubStorage({
      copy: async () => {},
      deleteMany: async (paths) => ({
        failed: paths.map(p => ({ path: p, message: 'simulated delete failure' })),
      }),
    });

    await banUser(db, storage, logger, adminUid, targetUid);

    const deleteOrphans = logger.errors.filter(e =>
      e.includes('ORPHANED_S3_OBJECT') &&
      e.includes('context=user-ban-delete') &&
      e.includes(targetUid) &&
      e.includes(path),
    );
    expect(deleteOrphans.length).toBeGreaterThan(0);
  });
});
