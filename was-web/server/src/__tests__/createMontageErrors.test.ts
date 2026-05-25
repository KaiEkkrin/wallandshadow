import { describe, test, expect } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import type { ILogger, IStorage, IStorageReference } from '@wallandshadow/shared';
import { createApp } from '../app.js';
import { db } from '../db/connection.js';
import { spritesheets } from '../db/schema.js';
import { storage, StorageObjectNotFoundError } from '../services/storage.js';
import { addSprites } from '../services/spriteExtensions.js';
import { registerHigherUser, apiPost, apiUploadImage, TINY_PNG } from './helpers.js';
import { testS3, testBucket } from './setup.js';

const app = createApp();

// Quiet logger — the abort path deliberately logs at Error level; that noise is
// expected and not wanted in passing test output.
const silentLogger: ILogger = {
  logError() {},
  logInfo() {},
  logWarning() {},
};

type DownloadBehaviour = 'ok' | 'notfound' | 'transient' | 'transient-once';

function transientError(): Error {
  const err = new Error('simulated transient storage error');
  err.name = 'SlowDown';
  return err;
}

// Wraps the real storage but lets a test script per-path download failures.
// Everything else (ref / upload / delete) passes straight through to real S3.
function makeStubStorage(behaviours: Record<string, DownloadBehaviour>): IStorage {
  const attempts = new Map<string, number>();
  return {
    deleteMany: paths => storage.deleteMany(paths),
    copy: (src, dst) => storage.copy(src, dst),
    ref(path: string): IStorageReference {
      const real = storage.ref(path);
      const behaviour = behaviours[path] ?? 'ok';
      return {
        delete: () => real.delete(),
        getDownloadURL: () => real.getDownloadURL(),
        put: (file, metadata) => real.put(file, metadata),
        upload: (source, metadata) => real.upload(source, metadata),
        async download(destination: string): Promise<void> {
          const n = (attempts.get(path) ?? 0) + 1;
          attempts.set(path, n);
          if (behaviour === 'notfound') {
            throw new StorageObjectNotFoundError(path);
          }
          if (behaviour === 'transient' || (behaviour === 'transient-once' && n === 1)) {
            throw transientError();
          }
          return real.download(destination);
        },
      };
    },
  };
}

async function setupOwnerAdventure(): Promise<{ token: string; uid: string; adventureId: string }> {
  const { token, uid } = await registerHigherUser(app);
  const res = await apiPost(app, '/api/adventures', { name: 'a1', description: '' }, token);
  expect(res.status).toBe(201);
  const { id } = await res.json() as { id: string };
  return { token, uid, adventureId: id };
}

async function uploadImage(token: string, name: string): Promise<string> {
  const res = await apiUploadImage(app, token, TINY_PNG, 'photo.png', 'image/png', name);
  expect(res.status).toBe(201);
  return (await res.json() as { path: string }).path;
}

async function getSheets(adventureId: string, geometry: string): Promise<
  { id: string; sprites: string[]; refs: number; freeSpaces: number }[]
> {
  const rows = await db.select({
    id: spritesheets.id,
    sprites: spritesheets.sprites,
    refs: spritesheets.refs,
    freeSpaces: spritesheets.freeSpaces,
  })
    .from(spritesheets)
    .where(and(eq(spritesheets.adventureId, adventureId), eq(spritesheets.geometry, geometry)));
  return rows.map(r => ({ ...r, sprites: r.sprites as string[] }));
}

// Count the assembled spritesheet PNGs currently in storage.
async function countSpriteSheetPngs(): Promise<number> {
  const list = await testS3.send(new ListObjectsV2Command({ Bucket: testBucket, Prefix: 'sprites/' }));
  return list.Contents?.length ?? 0;
}

describe('createMontage error handling', () => {
  test('a genuinely-missing (404) source is dropped and the montage still succeeds', async () => {
    const { token, uid, adventureId } = await setupOwnerAdventure();
    const good = await uploadImage(token, 'good');
    const gone = await uploadImage(token, 'gone');

    // `gone` reports as a hard 404 — the legitimate self-heal case.
    const stub = makeStubStorage({ [gone]: 'notfound' });
    const result = await addSprites(db, silentLogger, stub, uid, adventureId, '2x2', [good, gone]);

    // The good source is returned; the missing one is silently dropped.
    expect(result.some(s => s.source === good)).toBe(true);
    expect(result.some(s => s.source === gone)).toBe(false);

    // The new sheet persists the gap as '' so it can self-heal later.
    const [sheet] = await getSheets(adventureId, '2x2');
    expect(sheet.sprites).toContain(good);
    expect(sheet.sprites).toContain('');
    expect(sheet.sprites).not.toContain(gone);
  }, 60000);

  test('a persistent transient error aborts the montage without writing anything', async () => {
    const { token, uid, adventureId } = await setupOwnerAdventure();
    const good = await uploadImage(token, 'good');
    const flaky = await uploadImage(token, 'flaky');

    // `flaky` fails every download attempt with a non-404 error.
    const stub = makeStubStorage({ [flaky]: 'transient' });
    await expect(
      addSprites(db, silentLogger, stub, uid, adventureId, '2x2', [good, flaky]),
    ).rejects.toThrow();

    // No spritesheet row was inserted — the valid `good` sprite is not silently
    // lost, it simply was never persisted, so a retry re-montages it cleanly.
    const sheets = await getSheets(adventureId, '2x2');
    expect(sheets).toHaveLength(0);
    // And no assembled PNG was orphaned in storage.
    expect(await countSpriteSheetPngs()).toBe(0);
  }, 60000);

  test('a transient error that clears within the retry budget still succeeds', async () => {
    const { token, uid, adventureId } = await setupOwnerAdventure();
    const a = await uploadImage(token, 'a');
    const b = await uploadImage(token, 'b');

    // `b` fails its first download attempt, then succeeds on retry.
    const stub = makeStubStorage({ [b]: 'transient-once' });
    const result = await addSprites(db, silentLogger, stub, uid, adventureId, '2x2', [a, b]);

    expect(result.some(s => s.source === a)).toBe(true);
    expect(result.some(s => s.source === b)).toBe(true);

    const [sheet] = await getSheets(adventureId, '2x2');
    expect(sheet.sprites).toContain(a);
    expect(sheet.sprites).toContain(b);
    expect(sheet.sprites).not.toContain('');
  }, 60000);

  test('a partial failure across parallel montages cleans up the completed montage PNG', async () => {
    const { token, uid, adventureId } = await setupOwnerAdventure();

    // Seed a 2x1 sheet with one sprite, leaving a single free slot.
    const seed = await uploadImage(token, 'seed');
    await addSprites(db, silentLogger, storage, uid, adventureId, '2x1', [seed]);
    expect(await countSpriteSheetPngs()).toBe(1); // only the seed sheet's PNG
    const [seedSheetBefore] = await getSheets(adventureId, '2x1');
    expect(seedSheetBefore.refs).toBe(0);

    // Add two more sources. The allocator extends the seed sheet with one of
    // them (montage X) and overflows the other into a brand-new sheet (montage
    // Y). `overflow` lands in montage X and fails transiently, so X aborts;
    // montage Y completes and uploads its assembled PNG.
    const fillsGap = await uploadImage(token, 'fillsGap');
    const overflow = await uploadImage(token, 'overflow');
    const stub = makeStubStorage({ [overflow]: 'transient' });
    await expect(
      addSprites(db, silentLogger, stub, uid, adventureId, '2x1', [fillsGap, overflow]),
    ).rejects.toThrow();

    // Montage Y uploaded a PNG but its DB row was never committed — the abort
    // path must have deleted it, leaving only the original seed sheet's PNG.
    expect(await countSpriteSheetPngs()).toBe(1);

    // The seed sheet's refs increment was rolled back.
    const [seedSheetAfter] = await getSheets(adventureId, '2x1');
    expect(seedSheetAfter.refs).toBe(0);
  }, 60000);
});
