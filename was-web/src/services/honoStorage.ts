import { IStorage, IStorageReference } from '@wallandshadow/shared';

// Minimal IStorage stub for Session 1.
// Full S3 presigned URL support comes in Session 2.

// TODO Phase 3: replace with S3-backed storage
export class HonoStorage implements IStorage {
  ref(path: string): IStorageReference {
    return new HonoStorageReference(path);
  }
}

class HonoStorageReference implements IStorageReference {
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  async delete(): Promise<void> {
    // Stub — image deletion goes through IFunctionsService.deleteImage
  }

  async download(_destination: string): Promise<void> {
    throw new Error('download not implemented in Phase 1');
  }

  async getDownloadURL(): Promise<string> {
    // Return a placeholder — actual S3 presigned URL support comes in Session 2
    return `/api/images/download?path=${encodeURIComponent(this.path)}`;
  }

  async put(_file: Blob, _metadata: { contentType?: string; customMetadata?: Record<string, string> }): Promise<void> {
    // Stub — image upload comes in Session 2
    throw new Error('Image upload not implemented in Phase 1');
  }

  async upload(_source: string, _metadata: { contentType: string }): Promise<void> {
    throw new Error('upload not implemented in Phase 1');
  }
}
