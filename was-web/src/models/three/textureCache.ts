import { ITokenProperties, IImage, ICacheLease, ISpriteManager, ISpritesheetEntry } from '@wallandshadow/shared';
import consoleLogger from '../../services/consoleLogger';
import { LoadState, loadWithRetry } from '../../services/loadWithRetry';
import { ICacheItem, ObjectCache } from '../../services/objectCache';

import { Observable, of } from 'rxjs';
import { filter, map, switchMap } from 'rxjs/operators';
import * as THREE from 'three';

const textureLoader = new THREE.TextureLoader();

export type TextureLoadState = LoadState<ICacheLease<THREE.Texture>>;

// Textures are cached by storage path rather than by signed URL: the URL for
// a path changes every time it is re-signed, and each load attempt resolves a
// fresh one so that a retry never reuses an expired URL.
export class TextureCache {
  private readonly _spriteManager: ISpriteManager;
  private readonly _resolveImageUrl: (path: string) => Promise<string>;
  private readonly _textureCache: ObjectCache<THREE.Texture>;

  constructor(
    spriteManager: ISpriteManager,
    resolveImageUrl: (path: string) => Promise<string>,
    logError: (message: string, e: unknown) => void
  ) {
    this._spriteManager = spriteManager;
    this._resolveImageUrl = resolveImageUrl;
    this._textureCache = new ObjectCache(logError);
    this.resolveTexture = this.resolveTexture.bind(this);
  }

  private async resolveTexture(path: string): Promise<ICacheItem<THREE.Texture>> {
    const url = await this._resolveImageUrl(path);

    // Load the texture, waiting for it to be fully available before returning
    // (I get visual glitches if I don't)
    return await new Promise((resolve, reject) => {
      const startTime = performance.now();
      textureLoader.load(url, t => {
        console.debug(`texture loaded from ${path} in ${performance.now() - startTime} millis`);
        resolve({
          value: t,
          cleanup: () => {
            console.debug(`disposing texture from ${path}`);
            t.dispose();
          }
        });
      }, () => {}, reject);
    });
  }

  // Emits the texture's load state, retrying failed loads indefinitely. The
  // subscriber owns the lease in the `loaded` state and must release it.
  resolvePath(path: string): Observable<TextureLoadState> {
    return loadWithRetry(
      () => this._textureCache.resolve(path, this.resolveTexture),
      {
        description: `texture ${path}`,
        logger: consoleLogger,
        discard: lease => { lease.release().catch(e => consoleLogger.logError(`Failed to release ${path}`, e)); }
      }
    );
  }

  // Emits the token's sprite once its spritesheet texture has loaded, or
  // `undefined` when the token has no sprite. While the sheet is loading or
  // retrying nothing is emitted, so the token keeps whatever it last drew.
  resolve(token: ITokenProperties): Observable<(ISpritesheetEntry & { texture: ICacheLease<THREE.Texture> }) | undefined> {
    return this._spriteManager.lookupToken(token).pipe(switchMap(
      e => e === undefined
        ? of(undefined)
        : this.resolvePath(e.path).pipe(
          filter(s => s.status === 'loaded'),
          map(s => ({ ...e, texture: s.value }))
        ),
    ));
  }

  resolveImage(image: IImage): Observable<TextureLoadState> {
    return this.resolvePath(image.path);
  }

  dispose() {
    this._textureCache.dispose();
  }
}
