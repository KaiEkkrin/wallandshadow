import {
  S3Client,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { IStorage, IStorageReference } from '@wallandshadow/shared';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';

function createS3Client(): S3Client {
  const endpoint = process.env.S3_ENDPOINT ?? 'http://localhost:9000';
  const region = process.env.S3_REGION ?? 'us-east-1';
  return new S3Client({
    endpoint,
    region,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY ?? 'wasdev',
      secretAccessKey: process.env.S3_SECRET_KEY ?? 'wasdevpass',
    },
    forcePathStyle: true, // required for MinIO
  });
}

const s3 = createS3Client();
const bucket = process.env.S3_BUCKET ?? 'wallandshadow';

// S3 DeleteObjects accepts at most 1000 keys per call.
const DELETE_OBJECTS_BATCH_SIZE = 1000;

// Thrown by StorageReference.download when the object genuinely does not exist
// (S3 404 / NoSuchKey). Callers can distinguish this from a transient storage
// error (throttling, timeout, mid-stream socket error) — a missing object is
// permanent and must not be retried; a transient failure must not be treated as
// a missing object.
export class StorageObjectNotFoundError extends Error {
  constructor(public readonly path: string, options?: { cause?: unknown }) {
    super(`Storage object not found: ${path}`, options);
    this.name = 'StorageObjectNotFoundError';
  }
}

// True when an S3 SDK error means "the object is not there" rather than a
// transient failure. MinIO and Hetzner Object Storage both return NoSuchKey.
function isNotFoundError(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) {
    return false;
  }
  const err = e as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return (
    err.name === 'NoSuchKey' ||
    err.name === 'NotFound' ||
    err.$metadata?.httpStatusCode === 404
  );
}

export class Storage implements IStorage {
  ref(path: string): IStorageReference {
    return new StorageReference(path);
  }

  async deleteMany(paths: string[]): Promise<{ failed: { path: string; message: string }[] }> {
    const failed: { path: string; message: string }[] = [];
    for (let i = 0; i < paths.length; i += DELETE_OBJECTS_BATCH_SIZE) {
      const chunk = paths.slice(i, i + DELETE_OBJECTS_BATCH_SIZE);
      const response = await s3.send(new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: chunk.map(p => ({ Key: p })), Quiet: true },
      }));
      for (const e of response.Errors ?? []) {
        if (e.Key === undefined) {
          // S3 reported a delete error not attributable to any specific key.
          // We cannot name the orphaned object, so surface the whole error
          // entry in the message — the caller's log line is otherwise empty
          // and useless.
          failed.push({ path: '', message: `keyless S3 delete error: ${JSON.stringify(e)}` });
        } else {
          failed.push({ path: e.Key, message: e.Message ?? e.Code ?? 'unknown error' });
        }
      }
    }
    return { failed };
  }
}

class StorageReference implements IStorageReference {
  constructor(private readonly path: string) { }

  async delete(): Promise<void> {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: this.path }));
  }

  async download(destination: string): Promise<void> {
    let response;
    try {
      response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: this.path }));
    } catch (e) {
      if (isNotFoundError(e)) {
        throw new StorageObjectNotFoundError(this.path, { cause: e });
      }
      throw e;
    }
    if (!response.Body) {
      // Not a 404 — an unexpectedly empty response. Treat as transient.
      throw new Error(`No body for object ${this.path}`);
    }
    const writeStream = fs.createWriteStream(destination);
    await new Promise<void>((resolve, reject) => {
      (response.Body as NodeJS.ReadableStream).pipe(writeStream)
        .on('finish', resolve)
        .on('error', reject);
    });
  }

  async getDownloadURL(): Promise<string> {
    return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: this.path }), { expiresIn: 3600 });
  }

  async put(file: Blob, metadata: { contentType?: string }): Promise<void> {
    const buffer = Buffer.from(await file.arrayBuffer());
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: this.path,
      Body: buffer,
      ContentType: metadata.contentType,
    }));
  }

  async upload(source: string, metadata: { contentType: string }): Promise<void> {
    const body = await fsPromises.readFile(source);
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: this.path,
      Body: body,
      ContentType: metadata.contentType,
    }));
  }
}

export const storage = new Storage();
