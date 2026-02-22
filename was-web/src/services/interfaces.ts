import { IAdventure, IPlayer } from '../data/adventure';
import { Change, Changes } from '../data/change';
import { ICharacter } from '../data/character';
import { ITokenProperties } from '../data/feature';
import { IIdentified } from '../data/identified';
import { IImages } from '../data/image';
import { IInvite } from '../data/invite';
import { IMap, MapType } from '../data/map';
import { IInviteExpiryPolicy } from '../data/policy';
import { IProfile } from '../data/profile';
import { ISprite, ISpritesheet } from '../data/sprite';
import { IConverter } from './converter';

import { Observable } from 'rxjs';

// App version information stored in Firestore (config/version document).
// Used to detect when a new version has been deployed.
export interface IAppVersion {
  commit: string;
  version?: string;
}

// Abstracts the Firebase authentication stuff, which isn't supported by the
// simulator.
export interface IAuth {
  createUserWithEmailAndPassword(email: string, password: string, displayName: string): Promise<IUser | null>;
  fetchSignInMethodsForEmail(email: string): Promise<Array<string>>;
  sendPasswordResetEmail(email: string): Promise<void>;
  signInWithEmailAndPassword(email: string, password: string): Promise<IUser | null>;
  signInWithPopup(provider: IAuthProvider | undefined): Promise<IUser | null>;
  signOut(): Promise<void>;

  onAuthStateChanged(
    onNext: (user: IUser | null) => void,
    onError?: ((e: Error) => void) | undefined
  ): () => void;
}

export type IAuthProvider = object;

// A user.  (Exposes the things we want from `firebase.User` -- may need extending;
// but needs to be hidden behind this interface to facilitate unit testing.)
export interface IUser {
  displayName: string | null;
  email: string | null;
  emailMd5: string | null; // MD5 hash of the email address
  emailVerified: boolean;
  providerId: string;
  uid: string;

  changePassword: (oldPassword: string, newPassword: string) => Promise<void>;
  sendEmailVerification: () => Promise<void>;
  updateProfile: (p: { displayName?: string | null; photoURL?: string | null }) => Promise<void>;
}

// The analytics service.
export interface IAnalytics {
  logEvent(event: string, parameters: Record<string, unknown>): void;
}

// A reference to stored data.
export interface IDataReference<T> {
  id: string;
  convert(rawData: Record<string, unknown>): T;
  isEqual(other: IDataReference<T>): boolean;
}

export interface IChildDataReference<T, U> extends IDataReference<T> {
  getParent(): IDataReference<U> | undefined;
}

// A reference to stored data, *and* the data fetched.
export interface IDataAndReference<T> extends IDataReference<T> {
  data: T;
}

// This service is for datastore-related operations.
export interface IDataService extends IDataView {
  // Adds incremental changes to a map.
  addChanges(adventureId: string, uid: string, mapId: string, changes: Change[]): Promise<void>;

  // Gets all the maps in one adventure.
  getAdventureMapRefs(adventureId: string): Promise<IDataAndReference<IMap>[]>;

  // Gets an adventure.
  getAdventureRef(id: string): IDataReference<IAdventure>;

  // Gets a reference to a user's images record.
  getImagesRef(uid: string): IDataReference<IImages>;

  // Gets an invite reference.
  getInviteRef(id: string): IDataReference<IInvite>;

  // Gets a map.
  getMapRef(adventureId: string, id: string): IChildDataReference<IMap, IAdventure>;
  getMapBaseChangeRef(adventureId: string, id: string, converter: IConverter<Changes>): IDataReference<Changes>;
  getMapIncrementalChangesRefs(adventureId: string, id: string, limit: number, converter: IConverter<Changes>): Promise<IDataAndReference<Changes>[] | undefined>;

  // Gets all my adventures, invites, and player records.
  getMyAdventures(uid: string): Promise<IDataAndReference<IAdventure>[]>;
  getMyPlayerRecords(uid: string): Promise<IDataAndReference<IPlayer>[]>;

  // Gets a reference to a player record for an adventure.
  getPlayerRef(adventureId: string, uid: string): IDataReference<IPlayer>;

  // Gets refs to all players currently in an adventure.
  getPlayerRefs(adventureId: string): Promise<IDataAndReference<IPlayer>[]>;

  // Gets the user's profile.
  getProfileRef(uid: string): IDataReference<IProfile>;

  // Gets the app version document reference (for version checking).
  getVersionRef(): IDataReference<IAppVersion>;

  // Gets all spritesheets containing one of the supplied images.
  // No more than 10 sources in one go!
  getSpritesheetsBySource(adventureId: string, geometry: string, sources: string[]): Promise<IDataAndReference<ISpritesheet>[]>;

  // Runs a transaction. The `dataView` parameter accepted by the
  // transaction function does things in the transaction's context.
  runTransaction<T>(fn: (dataView: IDataView) => Promise<T>): Promise<T>;

  // Waits until all currently pending writes have been acknowledged by the backend.
  // Use this before calling Cloud Functions that need to see recent writes.
  // Returns a Promise that resolves when all pending writes are committed.
  waitForPendingWrites(): Promise<void>;

  // Watches a single object.  Call the returned function to stop.
  watch<T>(
    d: IDataReference<T>,
    onNext: (r: T | undefined) => void,
    onError?: ((error: Error) => void) | undefined,
    onCompletion?: (() => void) | undefined
  ): () => void;

  // Watches all the user's adventures.  Call the returned function to stop.
  watchAdventures(
    uid: string,
    onNext: (adventures: IIdentified<IAdventure>[]) => void,
    onError?: ((error: Error) => void) | undefined,
    onCompletion?: (() => void) | undefined
  ): () => void;

  // Watches changes to a map.
  watchChanges(
    adventureId: string,
    mapId: string,
    onNext: (changes: Changes) => void,
    onError?: ((error: Error) => void) | undefined,
    onCompletion?: (() => void) | undefined
  ): () => void;

  // Watches the players in a particular adventure.
  watchPlayers(
    adventureId: string,
    onNext: (players: IPlayer[]) => void,
    onError?: ((error: Error) => void) | undefined,
    onCompletion?: (() => void) | undefined
  ): () => void;

  // Watches all adventures shared with this user.
  watchSharedAdventures(
    uid: string,
    onNext: (adventures: IPlayer[]) => void,
    onError?: ((error: Error) => void) | undefined,
    onCompletion?: (() => void) | undefined
  ): () => void;

  // Watches all (current) spritesheets in this adventure.
  watchSpritesheets(
    adventureId: string,
    onNext: (spritesheets: IDataAndReference<ISpritesheet>[]) => void,
    onError?: ((error: Error) => void) | undefined,
    onCompletion?: (() => void) | undefined
  ): () => void;
}

// A view of data, either the generalised data service or a transaction.
export interface IDataView {
  delete<T>(r: IDataReference<T>): Promise<void>;
  get<T>(r: IDataReference<T>): Promise<T | undefined>;
  set<T>(r: IDataReference<T>, value: T): Promise<void>; // call this with an explicit type so TypeScript
                                                         // can check you included all the right fields
  update<T>(r: IDataReference<T>, changes: Partial<T>): Promise<void>;
}

// Provides access to Firebase Functions.
export interface IFunctionsService {
  // Adds images to spritesheets.
  addSprites(adventureId: string, geometry: string, sources: string[]): Promise<ISprite[]>;

  // Creates a new adventure, returning its ID.
  createAdventure(name: string, description: string): Promise<string>;

  // Creates a new map, returning its ID.
  createMap(adventureId: string, name: string, description: string, ty: MapType, ffa: boolean): Promise<string>;

  // Clones a map in the same adventure, returning the new map ID.
  cloneMap(adventureId: string, mapId: string, name: string, description: string): Promise<string>;

  // Consolidates changes in the given map.
  consolidateMapChanges(adventureId: string, mapId: string, resync: boolean): Promise<void>;

  // Deletes an image.
  deleteImage(path: string): Promise<void>;

  // Creates and returns an adventure invite.
  inviteToAdventure(adventureId: string, policy?: IInviteExpiryPolicy | undefined): Promise<string>;

  // Joins an adventure, returning the adventure id.
  joinAdventure(inviteId: string, policy?: IInviteExpiryPolicy | undefined): Promise<string>;
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
  // (if none) embedded in the token itself.
  lookupToken(token: ITokenProperties): Observable<ISpritesheetEntry & { character: ICharacter | undefined }>;

  // Cleans up this manager, stopping subscriptions.
  dispose(): void;
}

// A stripped-down abstraction around Firebase Storage that lets me use a mock one in local
// testing (standing in for an emulator.)
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
