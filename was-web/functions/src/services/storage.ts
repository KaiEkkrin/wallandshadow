import { IStorage, IStorageReference } from './interfaces';

import * as admin from 'firebase-admin';
// eslint-disable-next-line import/no-extraneous-dependencies
import { Bucket } from '@google-cloud/storage';

// The admin Firebase storage implementation.  This uses the Google Cloud
// storage API which looks kind of different to the firebase one O.o

export class Storage implements IStorage {
  private readonly _bucket: Bucket;

  constructor(app: admin.app.App, bucketName?: string) {
    // Use explicit bucket name if provided, otherwise use default
    // The bucket name format should be `${projectId}.firebasestorage.app` for compatibility
    // with the client SDK and Storage emulator
    this._bucket = bucketName
      ? app.storage().bucket(bucketName)
      : app.storage().bucket();
  }

  ref(path: string): IStorageReference {
    return new StorageReference(this._bucket, path);
  }
}

export class StorageReference implements IStorageReference {
  private readonly _bucket: Bucket;
  private readonly _path: string;

  constructor(bucket: Bucket, path: string) {
    this._bucket = bucket;
    this._path = path;
  }

  async delete(): Promise<void> {
    await this._bucket.file(this._path).delete();
  }

  async download(destination: string): Promise<void> {
    const file = this._bucket.file(this._path);
    await file.download({ destination: destination });
  }

  getDownloadURL(): Promise<string> {
    // I don't think I will ever need to be able to do this
    throw Error("Not supported");
  }

  put(file: Blob | Buffer, metadata: any): Promise<void> {
    // I don't think I need to be able to do this right now
    throw Error("Not supported");
  }

  async upload(source: string, metadata: { contentType: string }): Promise<void> {
    await this._bucket.upload(source, { destination: this._path, metadata: metadata });
  }
}