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
  const endpoint = process.env.S3_ENDPOINT ?? 'http://127.0.0.1:9000';
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
        failed.push({ path: e.Key ?? '', message: e.Message ?? e.Code ?? 'unknown error' });
      }
    }
    return { failed };
  }
}

class StorageReference implements IStorageReference {
  constructor(private readonly path: string) {}

  async delete(): Promise<void> {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: this.path }));
  }

  async download(destination: string): Promise<void> {
    const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: this.path }));
    if (!response.Body) {
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
