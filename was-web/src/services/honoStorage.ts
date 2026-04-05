import { IStorage, IStorageReference } from '@wallandshadow/shared';
import { HonoApiClient } from './honoApi.js';

export class HonoStorage implements IStorage {
  private readonly api: HonoApiClient;

  constructor(api: HonoApiClient) {
    this.api = api;
  }

  ref(path: string): IStorageReference {
    return new HonoStorageReference(path, this.api);
  }
}

class HonoStorageReference implements IStorageReference {
  private readonly path: string;
  private readonly api: HonoApiClient;

  constructor(path: string, api: HonoApiClient) {
    this.path = path;
    this.api = api;
  }

  async delete(): Promise<void> {
    // Actual deletion goes through IFunctionsService.deleteImage, not storage ref
  }

  async download(_destination: string): Promise<void> {
    throw new Error('Storage download not supported in browser');
  }

  async getDownloadURL(): Promise<string> {
    const { url } = await this.api.getImageDownloadUrl(this.path);
    return url;
  }

  async put(file: Blob, _metadata: { contentType?: string; customMetadata?: Record<string, string> }): Promise<void> {
    await this.api.uploadImage(file);
  }

  async upload(_source: string, _metadata: { contentType: string }): Promise<void> {
    throw new Error('Storage upload from file path not supported in browser');
  }
}
