import { IApi } from '@wallandshadow/shared';
import { ExpiringStringCache } from './expiringStringCache';

// 10-minute cache — S3 presigned URLs include a signature that expires
export function createResolveImageUrl(api: IApi | undefined): ((path: string) => Promise<string>) | undefined {
  if (api === undefined) {
    return undefined;
  }

  const imageUrlCache = new ExpiringStringCache(1000 * 60 * 10);
  return (path: string) => imageUrlCache.resolve(path, p => api.getImageDownloadUrl(p));
}
