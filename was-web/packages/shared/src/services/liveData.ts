import type { Observable } from 'rxjs';
import { IAdventure, IPlayer } from '../data/adventure';
import { Change, Changes } from '../data/change';
import { IIdentified } from '../data/identified';
import { IMap } from '../data/map';
import { PresenceSubscription, PresenceUserState } from '../data/presence';
import { IProfile } from '../data/profile';
import { ISpritesheet } from '../data/sprite';

// WebSocket-backed live data subscriptions for the Hono backend.
//
// One method per WS scope. Each `watchXxx` returns an `unsubscribe` function;
// `watchPresence` returns a `PresenceSubscription` because its consumer can
// update the "current map" without resubscribing.
//
// Connection observables (`isConnected$`, `rtt$`, `reconnectCount$`) and
// connection control (`forceReconnect`, `dispose`) sit on this interface
// because they're produced by the same single WS.
//
// `sendMapChange` is here too because it goes over the WS, not REST.
export interface ILiveData {
  watchProfile(
    onNext: (profile: IProfile | undefined) => void,
    onError?: (error: Error) => void,
  ): () => void;

  watchAdventures(
    onNext: (adventures: IIdentified<IAdventure>[]) => void,
    onError?: (error: Error) => void,
  ): () => void;

  watchAdventureDetail(
    adventureId: string,
    onNext: (adventure: IAdventure | undefined) => void,
    onError?: (error: Error) => void,
  ): () => void;

  watchMap(
    mapId: string,
    onNext: (map: IMap | undefined) => void,
    onError?: (error: Error) => void,
  ): () => void;

  // Map changes include both the initial base + replay and subsequent
  // incrementals. `onSubscribed` fires when the server has acknowledged the
  // subscription (used by mapChangeConsolidator to know it's safe to reset
  // local state on a full reload).
  watchMapChanges(
    mapId: string,
    onNext: (changes: Changes) => void,
    onError?: (error: Error) => void,
    onSubscribed?: () => void,
  ): () => void;

  watchPlayers(
    adventureId: string,
    onNext: (players: IPlayer[]) => void,
    onError?: (error: Error) => void,
  ): () => void;

  watchPresence(
    adventureId: string,
    initialCurrentMapId: string | undefined,
    onNext: (presence: PresenceUserState[]) => void,
    onError?: (error: Error) => void,
  ): PresenceSubscription;

  watchSpritesheets(
    adventureId: string,
    onNext: (spritesheets: IIdentified<ISpritesheet>[]) => void,
    onError?: (error: Error) => void,
  ): () => void;

  // Send an incremental map change. Goes over the WS, not REST.
  sendMapChange(adventureId: string, mapId: string, changes: Change[]): Promise<void>;

  // Connection observables and control.
  readonly isConnected$: Observable<boolean>;
  readonly rtt$: Observable<number | null>;
  readonly reconnectCount$: Observable<number>;
  forceReconnect(): void;
  dispose(): void;
}
