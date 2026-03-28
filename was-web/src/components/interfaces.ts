import { IAdventure, IPlayer } from '../data/adventure';
import { IAdventureIdentified, IIdentified } from '../data/identified';
import { IMap } from '../data/map';
import { MapState, MapStateMachine } from '../models/mapStateMachine';
import { IDataService, IUser, IAuth, IAuthProvider, IAnalytics, IFunctionsService, IStorage, ISpriteManager } from '../services/interfaces';

import { Firestore, FieldValue } from 'firebase/firestore';
import { Functions } from 'firebase/functions';
import { FirebaseStorage } from 'firebase/storage';
import { Subject } from 'rxjs';
import { IProfile } from '../data/profile';

export interface IContextProviderProps {
  children?: React.ReactNode;
}
 
export interface IFirebaseContext {
  auth?: IAuth | undefined;
  db?: Firestore | undefined;
  functions?: Functions | undefined;
  googleAuthProvider?: IAuthProvider | undefined;
  storage?: FirebaseStorage | undefined;
  timestampProvider?: (() => FieldValue) | undefined;
  usingLocalEmulators?: boolean | undefined;

  // Creates an Analytics provider
  createAnalytics?: (() => IAnalytics) | undefined;
}

export interface IUserContext {
  user: IUser | null | undefined; // This is the field to query for "is a user logged in?"
                                  // undefined means "I don't know yet, wait"
                                  // null means "Not logged in"
  dataService?: IDataService | undefined;
  functionsService?: IFunctionsService | undefined;
  storageService?: IStorage | undefined;

  // Resolves an image download URL, with expiry caching
  resolveImageUrl?: ((path: string) => Promise<string>) | undefined;
}

export interface IProfileContext {
  profile?: IProfile | undefined;

  // The login component must call this *before* registering any new user with a
  // specified display name.  The profile context, which is responsible for ensuring
  // the user's profile, will pop the new email and set the display name accordingly.
  expectNewUser?: (email: string, displayName: string) => void;

  // For Google OAuth new users: call this *before* opening the sign-in popup so the
  // display name is captured before auth state fires (we don't know the email yet).
  expectGoogleSignup?: (displayName: string) => void;
}

export interface ISignInMethodsContext {
  signInMethods: string[];
}

export interface IAnalyticsContext {
  analytics: IAnalytics | undefined;
  enabled: boolean | undefined; // Residing in local storage, this signals consent.
  setEnabled: (enabled: boolean | undefined) => void;
  logError: (message: string, e: unknown, fatal?: boolean | undefined) => void; // Use this error helper to track errors in GA where possible.
  logEvent: (event: string, parameters: Record<string, unknown>) => void;
}

export interface IToast {
  title: string;
  message: string;
}

export interface IStatusContext {
  // The subject of toast additions (record set) or removals (record not set.)
  toasts: Subject<IIdentified<IToast | undefined>>;
}

export interface IAdventureContext {
  adventure?: IIdentified<IAdventure> | undefined;
  players: IPlayer[];
  spriteManager?: ISpriteManager | undefined;
}

export interface IMapContext {
  map?: IAdventureIdentified<IMap> | undefined;
  mapState: MapState;
  stateMachine?: MapStateMachine | undefined;
}

export interface IFirebaseProps {
  // For testing only -- ignored by the real context provider.
  user?: IUser | null; // null for no user
}

export interface IRoutingProps {
  // For testing only -- ignored by the real routing.
  defaultRoute?: string | undefined;
}

export interface IAnalyticsProps {
  // These two optional functions can be set in testing to override the
  // use of local storage.
  getItem?: ((key: string) => string | null) | undefined;
  setItem?: ((key: string, value: string | null) => void) | undefined;
}