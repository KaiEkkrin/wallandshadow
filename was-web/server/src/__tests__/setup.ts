import { afterAll, beforeEach } from 'vitest';
import { pool } from '../db/connection.js';
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';

// Safety: refuse to run if DATABASE_URL doesn't point to a test database.
// This prevents accidental truncation of the dev database.
const dbUrl = process.env.DATABASE_URL ?? '';
if (!dbUrl.includes('_test')) {
  throw new Error(
    'Refusing to run: DATABASE_URL does not point to a test database. ' +
    'Expected URL containing "_test". Got: ' + dbUrl
  );
}

export const testS3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
  region: process.env.S3_REGION ?? 'us-east-1',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY ?? 'wasdev',
    secretAccessKey: process.env.S3_SECRET_KEY ?? 'wasdevpass',
  },
  forcePathStyle: true,
});
export const testBucket = process.env.S3_BUCKET ?? 'wallandshadow';

async function clearS3Bucket(): Promise<void> {
  let continuationToken: string | undefined;
  do {
    const list = await testS3.send(new ListObjectsV2Command({
      Bucket: testBucket,
      ContinuationToken: continuationToken,
    }));
    if (list.Contents && list.Contents.length > 0) {
      await testS3.send(new DeleteObjectsCommand({
        Bucket: testBucket,
        Delete: { Objects: list.Contents.map(o => ({ Key: o.Key! })) },
      }));
    }
    continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (continuationToken);
}

// Wipe all data between tests by truncating from the root table.
// CASCADE handles all dependent tables (adventures, maps, map_changes,
// adventure_players, invites, images, spritesheets, app_config).
beforeEach(async () => {
  await pool.query('TRUNCATE users CASCADE');
  await clearS3Bucket();
});

afterAll(async () => {
  await pool.end();
});
