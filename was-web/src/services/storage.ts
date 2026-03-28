import { IStorage, IStorageReference } from './interfaces';

import {
  FirebaseStorage,
  StorageReference as FirebaseStorageReference,
  ref,
  deleteObject,
  getDownloadURL as getDownloadURLFn,
  uploadBytes
} from 'firebase/storage';

// The real Firebase storage implementation.

export class Storage implements IStorage {
  private readonly _storage: FirebaseStorage;

  constructor(storage: FirebaseStorage) {
    this._storage = storage;
  }

  ref(path: string): IStorageReference {
    return new StorageReference(ref(this._storage, path));
  }
}

export class StorageReference implements IStorageReference {
  private readonly _ref: FirebaseStorageReference;

  constructor(storageRef: FirebaseStorageReference) {
    this._ref = storageRef;
  }

  async delete(): Promise<void> {
    await deleteObject(this._ref);
  }

  async download(_destination: string): Promise<void> {
    throw Error("Not supported");
  }

  async getDownloadURL(): Promise<string> {
    const url = await getDownloadURLFn(this._ref);
    return String(url);
  }

  async put(file: Blob, metadata: { contentType?: string; customMetadata?: Record<string, string> }) {
    // For now, I'll enumerate explicitly what metadata I expect here
    // contentType is required for the onUpload trigger to recognize the file as an image
    await uploadBytes(this._ref, file, {
      contentType: metadata.contentType ?? file.type,
      customMetadata: metadata.customMetadata
    });
  }

  async upload(_source: string, _metadata: { contentType: string }): Promise<void> {
    throw Error("Not supported");
  }
}