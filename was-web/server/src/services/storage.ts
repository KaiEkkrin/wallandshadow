import {
  S3Client,
  CopyObjectCommand,
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
    forcePathStyle: true, // required for RustFS (dev), which serves path-style only by default
  });
}

const s3 = createS3Client();
const bucket = process.env.S3_BUCKET ?? 'wallandshadow';

// Signed download URLs are stable for a window: every request for an object
// within the same window gets an identical URL, valid until the end of the
// following window, with a Cache-Control header so that the browser serves
// repeat loads from its cache -- after a page reload, and through an object
// storage outage, too. A per-request URL would defeat the browser's cache,
// which is keyed by URL.
//
// This relies on an object's content never changing once written: images and
// spritesheets are always written to new uuidv7 keys and never overwritten.
// Anything that replaces an object's content must write it to a new key, or
// browsers will go on showing the old content for up to a window.
export const DOWNLOAD_URL_WINDOW_MS = 6 * 60 * 60 * 1000;

// The start of the window containing `nowMs`. Windows are aligned to the Unix
// epoch, so every server instance agrees on them.
export function downloadUrlSigningDate(nowMs: number): Date {
  return new Date(Math.floor(nowMs / DOWNLOAD_URL_WINDOW_MS) * DOWNLOAD_URL_WINDOW_MS);
}

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
// transient failure. RustFS and Hetzner Object Storage both return NoSuchKey.
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

  async copy(srcPath: string, dstPath: string): Promise<void> {
    // CopySource must be `bucket/key`; the S3 SDK does not encode it for us.
    // Our keys contain only UUID-safe characters (hex, hyphens) and slashes,
    // so encodeURI is sufficient — # and ? (which encodeURI leaves alone)
    // never appear. If the key alphabet ever broadens, switch to per-segment
    // encodeURIComponent.
    await s3.send(new CopyObjectCommand({
      Bucket: bucket,
      Key: dstPath,
      CopySource: encodeURI(`${bucket}/${srcPath}`),
    }));
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
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: this.path,
      ResponseCacheControl: `private, max-age=${DOWNLOAD_URL_WINDOW_MS / 1000}`,
    });
    return getSignedUrl(s3, command, {
      signingDate: downloadUrlSigningDate(Date.now()),
      expiresIn: (2 * DOWNLOAD_URL_WINDOW_MS) / 1000,
    });
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
