import { ITokenProperties } from '../../data/feature';
import { IImage } from '../../data/image';
import { ICacheLease, ISpriteManager, ISpritesheetEntry } from '../../services/interfaces';
import { ICacheItem, ObjectCache } from '../../services/objectCache';

import { from, Observable } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import * as THREE from 'three';

const textureLoader = new THREE.TextureLoader();

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

  private async resolveTexture(url: string): Promise<ICacheItem<THREE.Texture>> {
    // Load the texture, waiting for it to be fully available before returning
    // (I get visual glitches if I don't)
    return await new Promise((resolve, reject) => {
      const startTime = performance.now();
      textureLoader.load(url, t => {
        console.debug(`texture loaded from ${url} in ${performance.now() - startTime} millis`);
        resolve({
          value: t,
          cleanup: () => {
            console.debug(`disposing texture from ${url}`);
            t.dispose();
          }
        });
      }, () => {}, reject);
    });
  }

  get(url: string): ICacheLease<THREE.Texture> | undefined {
    return this._textureCache.get(url);
  }

  resolve(token: ITokenProperties): Observable<ISpritesheetEntry & { texture: ICacheLease<THREE.Texture> }> {
    return this._spriteManager.lookupToken(token).pipe(switchMap(
      e => from(this._textureCache.resolve(e.url, this.resolveTexture)).pipe(
        map(t => ({ ...e, texture: t }))
      )
    ));
  }

  resolveImage(image: IImage): Observable<ICacheLease<THREE.Texture>> {
    return from(this._resolveImageUrl(image.path)).pipe(switchMap(
      u => from(this._textureCache.resolve(u, this.resolveTexture))
    ));
  }

  resolveUrl(url: string): Observable<ICacheLease<THREE.Texture>> {
    return from(this._textureCache.resolve(url, this.resolveTexture));
  }

  dispose() {
    this._textureCache.dispose();
  }
}