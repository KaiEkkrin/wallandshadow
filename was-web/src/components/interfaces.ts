import { IAdventure, IApi, ILiveData, IPlayer, IAdventureIdentified, IIdentified, IMap, IUser, IAuth, ISpriteManager, IProfile, PresenceUserState } from '@wallandshadow/shared';
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
  api?: IApi | undefined;
  live?: ILiveData | undefined;

  // Resolves an image download URL, with expiry caching
  resolveImageUrl?: ((path: string) => Promise<string>) | undefined;

  // Immediately attempt a WebSocket reconnect rather than waiting for the backoff timer.
  forceReconnect?: (() => void) | undefined;
}

export interface IProfileContext {
  profile?: IProfile | undefined;
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
  // Live presence roster keyed by playerId. Absent until the WebSocket
  // delivers its first snapshot; absence in the map means "no presence
  // signal" — the UI should treat that as offline.
  presence?: ReadonlyMap<string, PresenceUserState> | undefined;
  viewerCurrentMapId?: string | undefined;
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