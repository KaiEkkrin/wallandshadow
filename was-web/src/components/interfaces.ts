import { IAdventure, IPlayer, IAdventureIdentified, IIdentified, IMap, IDataService, IUser, IAuth, IFunctionsService, IStorage, ISpriteManager, IProfile } from '@wallandshadow/shared';
import { MapState, MapStateMachine } from '../models/mapStateMachine';

import { Subject } from 'rxjs';

export interface IContextProviderProps {
  children?: React.ReactNode;
}

export interface IAuthContext {
  auth?: IAuth | undefined;
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

  // Immediately attempt a WebSocket reconnect rather than waiting for the backoff timer.
  forceReconnect?: (() => void) | undefined;
}

export interface IProfileContext {
  profile?: IProfile | undefined;

  // The login component must call this *before* registering any new user with a
  // specified display name.  The profile context, which is responsible for ensuring
  // the user's profile, will pop the new email and set the display name accordingly.
  expectNewUser?: (email: string, displayName: string) => void;
}

export interface ISignInMethodsContext {
  signInMethods: string[];
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

export interface IRoutingProps {
  // For testing only -- ignored by the real routing.
  defaultRoute?: string | undefined;
}