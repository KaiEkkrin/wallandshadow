import type {
  Change,
  Changes,
  IAdventure,
  IIdentified,
  ILiveData,
  IMap,
  IPlayer,
  IProfile,
  ISpritesheet,
  PresenceSubscription,
  PresenceUserState,
  UpdateScope,
} from '@wallandshadow/shared';
import { BehaviorSubject, Observable } from 'rxjs';
import { logError } from './consoleLogger';
import { distinctUntilChanged } from 'rxjs/operators';
import { QUALITY_WINDOW_MS, RTT_EMA_ALPHA } from '../models/networkQualityConstants';
import type { HonoApiClient, AdventureDetailRow, AdventureRow, MapRow, PlayerRow, SpritesheetRow } from './honoApiClient';
import {
  adventureRowToIAdventure,
  adventureRowToSummary,
  emptyAdventureRow,
  mapRowToIMap,
  playerRowToIPlayer,
  spritesheetRowToISpritesheet,
} from './honoConverters';
import { HonoWebSocket, SubscriptionHandlers } from './honoWebSocket';

interface PlayersScopeData {
  adventure: AdventureRow | null;
  players: PlayerRow[];
}

interface MapChangesSnapshot {
  changes: Changes[];
  lastSeq: string | null;
  full: boolean;
}

// HonoLiveData owns the multiplexed WebSocket and presents the typed
// `ILiveData` interface to consumers.
export class HonoLiveData implements ILiveData {
  private readonly api: HonoApiClient;
  private readonly onAuthFailure: () => void;
  private socket: HonoWebSocket | null = null;

  /**
   * Per-(scope,id) JSON of the last payload emitted to any subscriber.
   * Shared across all subscribeWs calls so that React StrictMode's
   * double-mount (which creates two overlapping subscriptions) doesn't fire
   * the same emission twice and churn downstream effects.
   */
  private readonly lastEmitJson = new Map<string, string>();

  // ── Connection quality observables ──────────────────────────────────────
  private readonly _isConnected$ = new BehaviorSubject<boolean>(false);
  private readonly _rtt$ = new BehaviorSubject<number | null>(null);
  private _rttEma: number | null = null;
  private _reconnectTimestamps: number[] = [];
  private readonly _reconnectCount$ = new BehaviorSubject<number>(0);

  readonly isConnected$: Observable<boolean> = this._isConnected$.pipe(distinctUntilChanged());
  readonly rtt$: Observable<number | null> = this._rtt$.pipe(distinctUntilChanged());
  readonly reconnectCount$: Observable<number> = this._reconnectCount$.pipe(distinctUntilChanged());

  constructor(api: HonoApiClient, onAuthFailure: () => void) {
    this.api = api;
    this.onAuthFailure = onAuthFailure;
  }

  forceReconnect(): void {
    this.socket?.forceReconnect();
  }

  dispose(): void {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  /**
   * Lazily open the multiplexed WS. The token is fetched fresh on every
   * reconnect via the callback so silently-renewed OIDC tokens are picked up.
   */
  private getSocket(): HonoWebSocket {
    if (!this.socket) {
      this.socket = new HonoWebSocket(
        this.api.baseUrl,
        () => this.api.getToken(),
        {
          onAuthFailure: this.onAuthFailure,
          onConnected: (isReconnect) => {
            if (isReconnect) {
              const now = Date.now();
              this._reconnectTimestamps.push(now);
              this._reconnectTimestamps = this._reconnectTimestamps.filter(
                t => now - t <= QUALITY_WINDOW_MS,
              );
              this._reconnectCount$.next(this._reconnectTimestamps.length);
            }
            this._isConnected$.next(true);
          },
          onDisconnected: () => {
            this._isConnected$.next(false);
            this._rttEma = null;
            this._rtt$.next(null);
          },
          onRtt: (rttMs) => {
            // Prune aged-out reconnects on each pong so the count stays current
            // without needing a dedicated timer.
            const now = Date.now();
            const pruned = this._reconnectTimestamps.filter(t => now - t <= QUALITY_WINDOW_MS);
            if (pruned.length !== this._reconnectTimestamps.length) {
              this._reconnectTimestamps = pruned;
              this._reconnectCount$.next(pruned.length);
            }
            this._rttEma = this._rttEma === null
              ? rttMs
              : RTT_EMA_ALPHA * rttMs + (1 - RTT_EMA_ALPHA) * this._rttEma;
            this._rtt$.next(Math.round(this._rttEma));
          },
        },
      );
    }
    return this.socket;
  }

  // ── Watch methods ───────────────────────────────────────────────────────

  watchProfile(
    onNext: (profile: IProfile | undefined) => void,
    onError?: (error: Error) => void,
  ): () => void {
    const emit = (payload: { me: { name: string; email: string | null; level: IProfile['level'] }; adventures: AdventureRow[] }) => {
      onNext({
        name: payload.me.name,
        email: payload.me.email ?? '',
        level: payload.me.level,
        adventures: payload.adventures.map(adventureRowToSummary),
      });
    };
    return this.subscribeWs('profile', undefined, emit, onError);
  }

  watchAdventures(
    onNext: (adventures: IIdentified<IAdventure>[]) => void,
    onError?: (error: Error) => void,
  ): () => void {
    const emit = (rows: AdventureRow[]) => onNext(rows.map(r => ({
      id: r.id,
      record: adventureRowToIAdventure(r),
    })));
    return this.subscribeWs<AdventureRow[]>('adventures', undefined, emit, onError);
  }

  watchAdventureDetail(
    adventureId: string,
    onNext: (adventure: IAdventure | undefined) => void,
    onError?: (error: Error) => void,
  ): () => void {
    const emit = (detail: AdventureDetailRow) => onNext(adventureRowToIAdventure(detail));
    return this.subscribeWs('adventure', adventureId, emit, onError);
  }

  watchMap(
    mapId: string,
    onNext: (map: IMap | undefined) => void,
    onError?: (error: Error) => void,
  ): () => void {
    const emit = (payload: { adventure: AdventureRow; map: MapRow }) => {
      onNext(mapRowToIMap(payload.map, payload.adventure.name, payload.adventure.owner));
    };
    return this.subscribeWs('map', mapId, emit, onError);
  }

  watchMapChanges(
    mapId: string,
    onNext: (changes: Changes) => void,
    onError?: (error: Error) => void,
    onSubscribed?: () => void,
  ): () => void {
    try {
      const sub = this.getSocket().subscribe('mapChanges', mapId, {
        onSnapshot: (data) => {
          const snap = data as MapChangesSnapshot;
          for (const c of snap.changes) onNext(c);
        },
        onUpdate: (data) => {
          const { changes } = data as { seq: string; changes: Changes };
          onNext(changes);
        },
        onError,
        onSubscribed,
      });
      return () => sub.unsubscribe();
    } catch (e) {
      logError('watchMapChanges subscribe failed', e);
      onError?.(e instanceof Error ? e : new Error(String(e)));
      return () => {};
    }
  }

  watchPlayers(
    adventureId: string,
    onNext: (players: IPlayer[]) => void,
    onError?: (error: Error) => void,
  ): () => void {
    const emit = (payload: PlayersScopeData) => {
      const adv = payload.adventure ?? emptyAdventureRow(adventureId);
      onNext(payload.players.map(p => playerRowToIPlayer(p, adv)));
    };
    return this.subscribeWs<PlayersScopeData>('players', adventureId, emit, onError);
  }

  watchPresence(
    adventureId: string,
    initialCurrentMapId: string | undefined,
    onNext: (presence: PresenceUserState[]) => void,
    onError?: (error: Error) => void,
  ): PresenceSubscription {
    try {
      const { handlers, cacheKey } = this.dedupedHandlers<PresenceUserState[]>(
        'presence', adventureId, onNext, onError,
      );
      const sub = this.getSocket().subscribe('presence', adventureId, handlers, {
        currentMapId: initialCurrentMapId,
      });
      return {
        setCurrentMapId: (currentMapId: string | undefined) => sub.setCurrentMapId(currentMapId),
        unsubscribe: () => {
          sub.unsubscribe();
          this.lastEmitJson.delete(cacheKey);
        },
      };
    } catch (e) {
      logError('presence subscribe failed', e);
      onError?.(e instanceof Error ? e : new Error(String(e)));
      return { setCurrentMapId: () => {}, unsubscribe: () => {} };
    }
  }

  watchSpritesheets(
    adventureId: string,
    onNext: (spritesheets: IIdentified<ISpritesheet>[]) => void,
    onError?: (error: Error) => void,
  ): () => void {
    const emit = (rows: SpritesheetRow[]) => onNext(rows.map(r => ({
      id: r.id,
      record: spritesheetRowToISpritesheet(r),
    })));
    return this.subscribeWs<SpritesheetRow[]>('spritesheets', adventureId, emit, onError);
  }

  async sendMapChange(adventureId: string, mapId: string, changes: Change[]): Promise<void> {
    await this.getSocket().sendMapChange(adventureId, mapId, changes);
  }

  // ── WS subscription plumbing ────────────────────────────────────────────

  /**
   * Treat snapshot + update frames the same from the caller's view. Dedup by
   * JSON-compare across all subscribers for the same (scope, id), so no-op
   * re-broadcasts and StrictMode's double-mount don't churn downstream React
   * effects. `mapChanges` uses a separate path in `watchMapChanges` because
   * each frame must emit.
   */
  private subscribeWs<T>(
    scope: Exclude<UpdateScope, 'mapChanges'>,
    id: string | undefined,
    emit: (data: T) => void,
    onError?: (error: Error) => void,
  ): () => void {
    try {
      const { handlers, cacheKey } = this.dedupedHandlers<T>(scope, id, emit, onError);
      const sub = this.getSocket().subscribe(scope, id, handlers);
      return () => {
        sub.unsubscribe();
        this.lastEmitJson.delete(cacheKey);
      };
    } catch (e) {
      logError(`${scope} subscribe failed`, e);
      onError?.(e instanceof Error ? e : new Error(String(e)));
      return () => {};
    }
  }

  private dedupedHandlers<T>(
    scope: UpdateScope,
    id: string | undefined,
    emit: (data: T) => void,
    onError?: (error: Error) => void,
  ): { handlers: SubscriptionHandlers; cacheKey: string } {
    const cacheKey = `${scope}:${id ?? ''}`;
    const dedupedEmit = (data: unknown) => {
      const json = JSON.stringify(data);
      if (this.lastEmitJson.get(cacheKey) === json) return;
      this.lastEmitJson.set(cacheKey, json);
      emit(data as T);
    };
    return {
      handlers: { onSnapshot: dedupedEmit, onUpdate: dedupedEmit, onError },
      cacheKey,
    };
  }
}
