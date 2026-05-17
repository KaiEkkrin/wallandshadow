import { describe, test, expect, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { IStorage, IStorageReference, ILogger } from '@wallandshadow/shared';
import { createApp } from '../app.js';
import { db } from '../db/connection.js';
import { users } from '../db/schema.js';
import { deleteUser } from '../services/extensions.js';
import { registerUser, apiUploadImage, deleteS3Object, TINY_PNG } from './helpers.js';

const app = createApp();

// Each test uploads a real image but stubs out deleteUser's S3 cleanup, so the
// uploaded objects are deliberately orphaned. Track them and remove them once
// the suite finishes so the test bucket does not accumulate stray objects.
const orphanedPaths: string[] = [];
afterAll(async () => {
  await Promise.all(orphanedPaths.map(p => deleteS3Object(p)));
});

// Captures every log call so the test can assert on the orphan audit trail.
class CapturingLogger implements ILogger {
  readonly errors: string[] = [];
  logError(message: string): void { this.errors.push(message); }
  logInfo(): void { /* not asserted on */ }
  logWarning(): void { /* not asserted on */ }
}

// A storage stub whose deleteMany either reports per-key failures or throws a
// transport-level error, so we can drive auditedDeleteS3 down both branches
// without depending on MinIO actually failing.
class StubStorage implements IStorage {
  constructor(
    private readonly behaviour:
      | { kind: 'fail'; failed: { path: string; message: string }[] }
      | { kind: 'throw'; error: Error }
      | { kind: 'ok' },
  ) {}

  ref(): IStorageReference {
    throw new Error('ref() is not used by deleteUser');
  }

  async deleteMany(): Promise<{ failed: { path: string; message: string }[] }> {
    if (this.behaviour.kind === 'throw') {
      throw this.behaviour.error;
    }
    return { failed: this.behaviour.kind === 'fail' ? this.behaviour.failed : [] };
  }
}

// Registers a user and uploads one image, returning the user id and the stored
// image path — deleteUser will try to clean that path out of S3.
async function userWithImage(): Promise<{ uid: string; imagePath: string }> {
  const { token, uid } = await registerUser(app);
  const res = await apiUploadImage(app, token, TINY_PNG, 'photo.png', 'image/png', 'sprite');
  expect(res.status).toBe(201);
  const { path } = await res.json() as { path: string };
  orphanedPaths.push(path);
  return { uid, imagePath: path };
}

async function userExists(uid: string): Promise<boolean> {
  const rows = await db.select({ id: users.id }).from(users).where(eq(users.id, uid));
  return rows.length > 0;
}

describe('account deletion logs orphaned S3 objects at Error level', () => {
  test('per-key S3 failures are logged with an ORPHANED_S3_OBJECT marker', async () => {
    const { uid, imagePath } = await userWithImage();
    const logger = new CapturingLogger();
    const storage = new StubStorage({
      kind: 'fail',
      failed: [{ path: imagePath, message: 'AccessDenied' }],
    });

    // The DB erasure must still succeed even though the S3 cleanup failed.
    await deleteUser(db, storage, logger, uid);
    expect(await userExists(uid)).toBe(false);

    // The leaked path is logged on its own line with a greppable marker and uid.
    const orphanLogs = logger.errors.filter(e => e.includes('ORPHANED_S3_OBJECT'));
    expect(orphanLogs).toHaveLength(1);
    expect(orphanLogs[0]).toContain(`path=${imagePath}`);
    expect(orphanLogs[0]).toContain(`uid=${uid}`);
    expect(orphanLogs[0]).toContain('AccessDenied');
  }, 60000);

  test('a whole-batch throw logs every path plus the underlying error', async () => {
    const { uid, imagePath } = await userWithImage();
    const logger = new CapturingLogger();
    const storage = new StubStorage({ kind: 'throw', error: new Error('connection reset') });

    await deleteUser(db, storage, logger, uid);
    expect(await userExists(uid)).toBe(false);

    // Every potentially-orphaned path is reported individually...
    const orphanLogs = logger.errors.filter(e => e.includes('ORPHANED_S3_OBJECT'));
    expect(orphanLogs).toHaveLength(1);
    expect(orphanLogs[0]).toContain(`path=${imagePath}`);
    expect(orphanLogs[0]).toContain(`uid=${uid}`);

    // ...and the batch-level failure is logged as well.
    expect(logger.errors.some(e => e.includes('S3 batch delete threw during account deletion')))
      .toBe(true);
  }, 60000);

  test('a clean S3 delete logs nothing at Error level', async () => {
    const { uid } = await userWithImage();
    const logger = new CapturingLogger();
    const storage = new StubStorage({ kind: 'ok' });

    await deleteUser(db, storage, logger, uid);
    expect(await userExists(uid)).toBe(false);
    expect(logger.errors).toHaveLength(0);
  }, 60000);
});
