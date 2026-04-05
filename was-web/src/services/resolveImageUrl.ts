import { IStorage } from '@wallandshadow/shared';
import { ExpiringStringCache } from './expiringStringCache';

// 10-minute cache — Firebase download URLs include a token that expires
export function createResolveImageUrl(storageService: IStorage | undefined): ((path: string) => Promise<string>) | undefined {
  if (storageService === undefined) {
    return undefined;
  }

  const imageUrlCache = new ExpiringStringCache(1000 * 60 * 10);
  return (path: string) => imageUrlCache.resolve(path, p => storageService.ref(p).getDownloadURL());
}
