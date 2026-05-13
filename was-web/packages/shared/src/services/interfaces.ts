import { ICharacter } from '../data/character';
import { ITokenProperties } from '../data/feature';
import { ISprite, ISpritesheet } from '../data/sprite';

import { Observable } from 'rxjs';

// App version information used to detect when a new version has been deployed.
export interface IAppVersion {
  commit: string;
  version?: string;
}

// Authentication abstraction implemented by HonoAuth.
export interface IAuth {
  createUserWithEmailAndPassword(email: string, password: string, displayName: string): Promise<IUser | null>;
  signInWithEmailAndPassword(email: string, password: string): Promise<IUser | null>;
  signInWithPopup(provider: IAuthProvider | undefined): Promise<IUser | null>;
  signOut(): Promise<void>;

  onAuthStateChanged(
    onNext: (user: IUser | null) => void,
    onError?: ((e: Error) => void) | undefined
  ): () => void;
}

export type IAuthProvider = object;

// A user, as projected to the client.
export interface IUser {
  displayName: string | null;
  email: string | null;
  emailMd5: string | null; // MD5 hash of the email address
  emailVerified: boolean;
  providerId: string;
  uid: string;
}

// Provides logging for the extensions.
export interface ILogger {
  logError(message: string, ...optionalParams: unknown[]): void;
  logInfo(message: string, ...optionalParams: unknown[]): void;
  logWarning(message: string, ...optionalParams: unknown[]): void;
}

// The object cache emits these.
export interface ICacheLease<T> {
  value: T;
  release: () => Promise<void>;
}

export interface ISpritesheetEntry {
  sheet: ISpritesheet,
  position: number,
  url: string
}

// Looks up sprites for us with caching.
export interface ISpriteManager {
  // The adventure this manager is for.
  adventureId: string;

  // Looks up the character record associated with a token.  (For when you don't need to
  // draw the sprite.)
  lookupCharacter(token: ITokenProperties): Observable<ICharacter | undefined>;

  // Looks up a sprite, returning a feed of its latest entries and download URLs.
  lookupSprite(sprite: ISprite): Observable<ISpritesheetEntry>;

  // Looks up a token's character and sprite, which could either be the token's character, or
  // (if none) embedded in the token itself. Emits `undefined` when the token has no sprite
  // (or its sprite reference is not present in any current spritesheet) so that subscribers
  // can clear stale renderings — without an explicit signal, an observable that switched to
  // "no sprite" would silently retain its last emitted value.
  lookupToken(token: ITokenProperties): Observable<(ISpritesheetEntry & { character: ICharacter | undefined }) | undefined>;

  // Cleans up this manager, stopping subscriptions.
  dispose(): void;
}

// Object-storage abstraction (currently used only by the server-side S3 client).
// The web client talks to the server through IApi instead.
export interface IStorage {
  // Gets a reference to this path.
  ref(path: string): IStorageReference;
}

export interface IStorageReference {
  // Deletes the object.
  delete(): Promise<void>;

  // Downloads the object from storage.
  download(destination: string): Promise<void>;

  // Gets the download URL for this object.
  getDownloadURL(): Promise<string>;

  // Uploads a file here.
  put(file: Blob, metadata: { contentType?: string; customMetadata?: Record<string, string> }): Promise<void>;

  // Uploads a file here (from the filesystem.)
  upload(source: string, metadata: { contentType: string }): Promise<void>;
}
