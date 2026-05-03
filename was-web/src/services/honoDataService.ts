import {
  IAdventure,
  IPlayer,
  IMap,
  IProfile,
  IInvite,
  IImages,
  IIdentified,
  IAdventureSummary,
  IMapSummary,
  Changes,
  Change,
  IDataService,
  IDataView,
  IDataReference,
  IDataAndReference,
  IChildDataReference,
  IConverter,
  IAppVersion,
  ISpritesheet,
  MapType,
  UpdateScope,
} from '@wallandshadow/shared';
import {
  HonoApiClient,
  ApiError,
  AdventureRow,
  AdventureDetailRow,
  MapRow,
  PlayerRow,
  InviteDetailRow,
  SpritesheetRow,
} from './honoApi';
import { HonoWebSocket, SubscriptionHandlers } from './honoWebSocket';
import { PollingWatch } from './pollingWatch';
import { BehaviorSubject, Observable } from 'rxjs';
import { QUALITY_WINDOW_MS, RTT_EMA_ALPHA } from '../models/networkQualityConstants';

const POLL_INTERVAL_MS = 500;

interface PlayersScopeData {
  adventure: AdventureRow | null;
  players: PlayerRow[];
}

interface MapChangesSnapshot {
  changes: Changes[];
  lastSeq: string | null;
  full: boolean;
}

// ── Reference types ──────────────────────────────────────────────────────────

type RefKind = 'profile' | 'adventure' | 'player' | 'map' | 'invite' | 'images' | 'version' | 'mapBaseChange' | 'mapChanges';

interface RefMeta {
  kind: RefKind;
  adventureId?: string;
  mapId?: string;
}

const RE_MAP_CHANGES = /^adventures\/([^/]+)\/maps\/([^/]+)\/changes/;
const RE_MAP = /^adventures\/([^/]+)\/maps\/([^/]+)$/;
const RE_PLAYER = /^adventures\/([^/]+)\/players\/([^/]+)$/;

function parsePath(path: string): RefMeta {
  if (path.startsWith('profile/')) return { kind: 'profile' };
  if (path.startsWith('version')) return { kind: 'version' };
  if (path.startsWith('images/')) return { kind: 'images' };
  if (path.startsWith('invites/')) return { kind: 'invite' };

  const mapChangeMatch = RE_MAP_CHANGES.exec(path);
  if (mapChangeMatch) {
    const kind = path.endsWith('/changes/base') ? 'mapBaseChange' as const : 'mapChanges' as const;
    return { kind, adventureId: mapChangeMatch[1], mapId: mapChangeMatch[2] };
  }

  const mapMatch = RE_MAP.exec(path);
  if (mapMatch) return { kind: 'map', adventureId: mapMatch[1], mapId: mapMatch[2] };

  const playerMatch = RE_PLAYER.exec(path);
  if (playerMatch) return { kind: 'player', adventureId: playerMatch[1] };

  return { kind: 'adventure' };
}

class HonoDataReference<T> implements IDataReference<T> {
  readonly id: string;
  readonly path: string;
  readonly meta: RefMeta;
  private readonly converter: IConverter<T>;

  constructor(id: string, path: string, converter: IConverter<T>) {
    this.id = id;
    this.path = path;
    this.meta = parsePath(path);
    this.converter = converter;
  }

  convert(rawData: Record<string, unknown>): T {
    return this.converter.convert(rawData);
  }

  isEqual(other: IDataReference<T>): boolean {
    return other instanceof HonoDataReference && this.path === other.path;
  }
}

class HonoChildDataReference<T, U> extends HonoDataReference<T> implements IChildDataReference<T, U> {
  private readonly parentRef: IDataReference<U> | undefined;

  constructor(id: string, path: string, converter: IConverter<T>, parentRef?: IDataReference<U>) {
    super(id, path, converter);
    this.parentRef = parentRef;
  }

  getParent(): IDataReference<U> | undefined {
    return this.parentRef;
  }
}

class HonoDataAndReference<T> extends HonoDataReference<T> implements IDataAndReference<T> {
  readonly data: T;

  constructor(id: string, path: string, converter: IConverter<T>, data: T) {
    super(id, path, converter);
    this.data = data;
  }
}

// ── localStorage latestMaps ──────────────────────────────────────────────────

function getLatestMapsKey(uid: string): string {
  return `was_hono_latest_maps_${uid}`;
}

function readLatestMaps(uid: string): IMapSummary[] {
  try {
    const raw = localStorage.getItem(getLatestMapsKey(uid));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeLatestMaps(uid: string, maps: IMapSummary[]): void {
  localStorage.setItem(getLatestMapsKey(uid), JSON.stringify(maps.slice(0, 10)));
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function isNotFound(e: unknown): boolean {
  return e instanceof ApiError && e.status === 404;
}

function emptyAdventureRow(adventureId: string): AdventureRow {
  return { id: adventureId, name: '', description: '', owner: '', ownerName: '', imagePath: '' };
}

function spritesheetRowToISpritesheet(r: { sprites: string[]; geometry: string; freeSpaces: number; supersededBy: string; refs: number }): ISpritesheet {
  return {
    sprites: r.sprites,
    geometry: r.geometry,
    freeSpaces: r.freeSpaces,
    date: Date.now(),
    supersededBy: r.supersededBy,
    refs: r.refs,
  };
}

function adventureRowToSelfPlayer(row: AdventureRow, uid: string): IPlayer {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    owner: row.owner,
    ownerName: row.ownerName,
    imagePath: row.imagePath,
    playerId: uid,
    playerName: '',
    allowed: true,
    characters: [],
  };
}

// ── Data shape converters ────────────────────────────────────────────────────

function adventureRowToIAdventure(row: AdventureRow | AdventureDetailRow): IAdventure {
  const maps: IMapSummary[] = 'maps' in row
    ? (row as AdventureDetailRow).maps.map(m => ({
        adventureId: row.id,
        id: m.id,
        name: m.name,
        description: m.description,
        ty: m.ty as MapType,
        imagePath: m.imagePath,
      }))
    : [];

  return {
    name: row.name,
    description: row.description,
    owner: row.owner,
    ownerName: row.ownerName,
    maps,
    imagePath: row.imagePath,
  };
}

function adventureRowToSummary(row: AdventureRow): IAdventureSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    owner: row.owner,
    ownerName: row.ownerName,
    imagePath: row.imagePath,
  };
}

function mapRowToIMap(row: MapRow, adventureName: string, owner: string): IMap {
  return {
    adventureName,
    name: row.name,
    description: row.description,
    owner,
    ty: row.ty as MapType,
    ffa: row.ffa,
    imagePath: row.imagePath,
  };
}

function playerRowToIPlayer(row: PlayerRow, adventure: AdventureRow): IPlayer {
  return {
    id: adventure.id,
    name: adventure.name,
    description: adventure.description,
    owner: adventure.owner,
    ownerName: adventure.ownerName,
    imagePath: adventure.imagePath,
    playerId: row.playerId,
    playerName: row.playerName,
    allowed: row.allowed,
    characters: row.characters ?? [],
  };
}

function inviteRowToIInvite(row: InviteDetailRow): IInvite {
  return {
    adventureId: row.adventureId,
    adventureName: row.adventureName,
    owner: '',
    ownerName: row.ownerName,
    timestamp: new Date(row.expiresAt).getTime(),
  };
}

// The interface requires a converter, but REST data is converted manually.
function passthroughConverter<T>(): IConverter<T> {
  return { convert: (d: Record<string, unknown>) => d as T };
}

// ── IDataService implementation ──────────────────────────────────────────────

export class HonoDataService implements IDataService {
  private readonly api: HonoApiClient;
  private readonly uid: string;
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
  // Exposed so HonoContextProvider can feed networkStatusTracker.
  private readonly _isConnected$ = new BehaviorSubject<boolean>(false);
  private readonly _rtt$ = new BehaviorSubject<number | null>(null);
  private _rttEma: number | null = null;
  private _reconnectTimestamps: number[] = [];
  private readonly _reconnectCount$ = new BehaviorSubject<number>(0);

  readonly isConnected$: Observable<boolean> = this._isConnected$;
  readonly rtt$: Observable<number | null> = this._rtt$;
  readonly reconnectCount$: Observable<number> = this._reconnectCount$;

  constructor(api: HonoApiClient, uid: string, onAuthFailure: () => void) {
    this.api = api;
    this.uid = uid;
    this.onAuthFailure = onAuthFailure;
  }

  forceReconnect(): void {
    this.socket?.forceReconnect();
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

  dispose(): void {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  // ── IDataView CRUD ──────────────────────────────────────────────────────

  async get<T>(r: IDataReference<T>): Promise<T | undefined> {
    const ref = r as HonoDataReference<T>;

    switch (ref.meta.kind) {
      case 'profile':
        return await this.getProfile() as T;

      case 'adventure': {
        try {
          const detail = await this.api.getAdventure(ref.id);
          return adventureRowToIAdventure(detail) as T;
        } catch (e) {
          if (isNotFound(e)) return undefined;
          throw e;
        }
      }

      case 'player': {
        const adventureId = ref.meta.adventureId!;
        try {
          const [players, adv] = await Promise.all([
            this.api.getPlayers(adventureId),
            this.api.getAdventure(adventureId),
          ]);
          const p = players.find(p => p.playerId === ref.id);
          if (!p) return undefined;
          return playerRowToIPlayer(p, adv) as T;
        } catch (e) {
          if (isNotFound(e)) return undefined;
          throw e;
        }
      }

      case 'map': {
        const adventureId = ref.meta.adventureId!;
        try {
          const [mapRow, adv] = await Promise.all([
            this.api.getMap(adventureId, ref.id),
            this.api.getAdventure(adventureId),
          ]);
          return mapRowToIMap(mapRow, adv.name, adv.owner) as T;
        } catch (e) {
          if (isNotFound(e)) return undefined;
          throw e;
        }
      }

      case 'invite': {
        try {
          const invite = await this.api.getInvite(ref.id);
          return inviteRowToIInvite(invite) as T;
        } catch (e) {
          if (isNotFound(e)) return undefined;
          throw e;
        }
      }

      case 'mapBaseChange': {
        if (ref.meta.adventureId && ref.meta.mapId) {
          try {
            const response = await this.api.getMapChanges(ref.meta.adventureId, ref.meta.mapId);
            if (response.base) {
              return ref.convert(response.base as Record<string, unknown>);
            }
          } catch { /* return undefined */ }
        }
        return undefined;
      }

      case 'images': {
        try {
          const response = await this.api.getImages();
          return { images: response.images.map(r => ({ name: r.name, path: r.path })), lastError: '' } as T;
        } catch {
          return undefined;
        }
      }

      case 'version':
      case 'mapChanges':
        return undefined;
    }
  }

  async set<T>(_r: IDataReference<T>, _value: T): Promise<void> {
    // Profile creation handled by server during registration
  }

  async update<T>(r: IDataReference<T>, changes: Partial<T>): Promise<void> {
    const ref = r as HonoDataReference<T>;

    switch (ref.meta.kind) {
      case 'profile': {
        const c = changes as Partial<IProfile>;
        if (c.latestMaps !== undefined) {
          writeLatestMaps(this.uid, c.latestMaps);
        }
        if (c.name !== undefined) {
          await this.api.updateMe(c.name);
        }
        return;
      }

      case 'adventure': {
        const c = changes as Partial<IAdventure>;
        const fields: { name?: string; description?: string; imagePath?: string } = {};
        if (c.name !== undefined) fields.name = c.name;
        if (c.description !== undefined) fields.description = c.description;
        if (c.imagePath !== undefined) fields.imagePath = c.imagePath;
        if (Object.keys(fields).length > 0) {
          await this.api.updateAdventure(ref.id, fields);
        }
        return;
      }

      case 'player': {
        const adventureId = ref.meta.adventureId!;
        const c = changes as Partial<IPlayer>;
        const fields: { allowed?: boolean; characters?: IPlayer['characters'] } = {};
        if (c.allowed !== undefined) fields.allowed = c.allowed;
        if (c.characters !== undefined) fields.characters = c.characters;
        if (Object.keys(fields).length > 0) {
          await this.api.updatePlayer(adventureId, ref.id, fields);
        }
        return;
      }

      case 'map': {
        const adventureId = ref.meta.adventureId!;
        const c = changes as Partial<IMap>;
        const fields: { name?: string; description?: string; imagePath?: string; ffa?: boolean } = {};
        if (c.name !== undefined) fields.name = c.name;
        if (c.description !== undefined) fields.description = c.description;
        if (c.imagePath !== undefined) fields.imagePath = c.imagePath;
        if (c.ffa !== undefined) fields.ffa = c.ffa;
        if (Object.keys(fields).length > 0) {
          await this.api.updateMap(adventureId, ref.id, fields);
        }
        return;
      }

      default:
        return;
    }
  }

  async delete<T>(r: IDataReference<T>): Promise<void> {
    const ref = r as HonoDataReference<T>;

    switch (ref.meta.kind) {
      case 'adventure':
        await this.api.deleteAdventure(ref.id);
        return;

      case 'player':
        await this.api.leaveAdventure(ref.meta.adventureId!);
        return;

      case 'map':
        await this.api.deleteMap(ref.meta.adventureId!, ref.id);
        return;

      default:
        return;
    }
  }

  // ── Profile synthesis ───────────────────────────────────────────────────

  private toIProfile(
    me: { name: string; email: string | null; level: IProfile['level'] },
    adventures: AdventureRow[],
  ): IProfile {
    return {
      name: me.name,
      email: me.email ?? '',
      level: me.level,
      adventures: adventures.map(adventureRowToSummary),
      latestMaps: readLatestMaps(this.uid),
    };
  }

  private async getProfile(): Promise<IProfile> {
    const [me, adventures] = await Promise.all([
      this.api.getMe(),
      this.api.getAdventures(),
    ]);
    return this.toIProfile(me, adventures);
  }

  // ── Reference factories ─────────────────────────────────────────────────

  getAdventureRef(id: string): IDataReference<IAdventure> {
    return new HonoDataReference<IAdventure>(id, `adventures/${id}`, passthroughConverter());
  }

  getImagesRef(_uid: string): IDataReference<IImages> {
    return new HonoDataReference<IImages>(_uid, `images/${_uid}`, passthroughConverter());
  }

  getInviteRef(id: string): IDataReference<IInvite> {
    return new HonoDataReference<IInvite>(id, `invites/${id}`, passthroughConverter());
  }

  getMapRef(adventureId: string, id: string): IChildDataReference<IMap, IAdventure> {
    const advRef = this.getAdventureRef(adventureId);
    return new HonoChildDataReference<IMap, IAdventure>(
      id, `adventures/${adventureId}/maps/${id}`, passthroughConverter(), advRef
    );
  }

  getMapBaseChangeRef(adventureId: string, id: string, converter: IConverter<Changes>): IDataReference<Changes> {
    return new HonoDataReference<Changes>(
      'base', `adventures/${adventureId}/maps/${id}/changes/base`, converter
    );
  }

  getPlayerRef(adventureId: string, uid: string): IDataReference<IPlayer> {
    return new HonoDataReference<IPlayer>(uid, `adventures/${adventureId}/players/${uid}`, passthroughConverter());
  }

  getProfileRef(uid: string): IDataReference<IProfile> {
    return new HonoDataReference<IProfile>(uid, `profile/${uid}`, passthroughConverter());
  }

  getVersionRef(): IDataReference<IAppVersion> {
    return new HonoDataReference<IAppVersion>('version', 'version', passthroughConverter());
  }

  // ── Query methods ───────────────────────────────────────────────────────

  async getAdventureMapRefs(adventureId: string): Promise<IDataAndReference<IMap>[]> {
    const [maps, adv] = await Promise.all([
      this.api.getMaps(adventureId),
      this.api.getAdventure(adventureId).catch(() => emptyAdventureRow(adventureId)),
    ]);

    return maps.map(m => new HonoDataAndReference<IMap>(
      m.id,
      `adventures/${adventureId}/maps/${m.id}`,
      passthroughConverter(),
      mapRowToIMap(m, adv.name, adv.owner),
    ));
  }

  async getMyAdventures(_uid: string): Promise<IDataAndReference<IAdventure>[]> {
    const adventures = await this.api.getAdventures();
    return adventures
      .filter(a => a.owner === this.uid)
      .map(a => new HonoDataAndReference<IAdventure>(
        a.id,
        `adventures/${a.id}`,
        passthroughConverter(),
        adventureRowToIAdventure(a),
      ));
  }

  async getMyPlayerRecords(_uid: string): Promise<IDataAndReference<IPlayer>[]> {
    const adventures = await this.api.getAdventures();
    return adventures.map(a => new HonoDataAndReference<IPlayer>(
      this.uid,
      `adventures/${a.id}/players/${this.uid}`,
      passthroughConverter(),
      adventureRowToSelfPlayer(a, this.uid),
    ));
  }

  async getPlayerRefs(adventureId: string): Promise<IDataAndReference<IPlayer>[]> {
    const [players, adv] = await Promise.all([
      this.api.getPlayers(adventureId).catch(e => isNotFound(e) ? [] as PlayerRow[] : Promise.reject(e)),
      this.api.getAdventure(adventureId).catch(() => emptyAdventureRow(adventureId)),
    ]);

    return players.map(p => new HonoDataAndReference<IPlayer>(
      p.playerId,
      `adventures/${adventureId}/players/${p.playerId}`,
      passthroughConverter(),
      playerRowToIPlayer(p, adv),
    ));
  }

  async getMapIncrementalChangesRefs(
    adventureId: string, id: string, _limit: number, converter: IConverter<Changes>
  ): Promise<IDataAndReference<Changes>[] | undefined> {
    try {
      const response = await this.api.getMapChanges(adventureId, id);
      if (response.incremental.length === 0) return undefined;
      return response.incremental.map(row => new HonoDataAndReference<Changes>(
        row.id,
        `adventures/${adventureId}/maps/${id}/changes/${row.id}`,
        converter,
        converter.convert(row.changes as Record<string, unknown>),
      ));
    } catch {
      return undefined;
    }
  }

  async getSpritesheetsBySource(
    adventureId: string, geometry: string, sources: string[]
  ): Promise<IDataAndReference<ISpritesheet>[]> {
    let rows;
    try {
      rows = await this.api.getSpritesheets(adventureId);
    } catch (e) {
      if (isNotFound(e)) return [];
      throw e;
    }
    const sourceSet = new Set(sources);
    return rows
      .filter(r => r.geometry === geometry && r.sprites.some(s => sourceSet.has(s)))
      .map(r => new HonoDataAndReference<ISpritesheet>(
        r.id,
        `adventures/${adventureId}/spritesheets/${r.id}`,
        passthroughConverter(),
        spritesheetRowToISpritesheet(r),
      ));
  }

  // ── Transaction support ─────────────────────────────────────────────────

  async runTransaction<T>(fn: (dataView: IDataView) => Promise<T>): Promise<T> {
    return fn(this);
  }

  async waitForPendingWrites(): Promise<void> {}

  // ── Map changes ─────────────────────────────────────────────────────────

  async addChanges(adventureId: string, _uid: string, mapId: string, changes: Change[]): Promise<void> {
    await this.getSocket().sendMapChange(adventureId, mapId, changes);
  }

  // ── Watch methods ───────────────────────────────────────────────────────

  watch<T>(
    d: IDataReference<T>,
    onNext: (r: T | undefined) => void,
    onError?: ((error: Error) => void) | undefined,
    _onCompletion?: (() => void) | undefined
  ): () => void {
    const ref = d as HonoDataReference<T>;
    switch (ref.meta.kind) {
      case 'profile':
        return this.subscribeProfile(onNext as (p: IProfile | undefined) => void, onError);
      case 'adventure':
        return this.subscribeAdventureDetail(ref.id, onNext as (a: IAdventure | undefined) => void, onError);
      case 'map':
        return this.subscribeMap(ref.meta.adventureId!, ref.id, onNext as (m: IMap | undefined) => void, onError);
      default: {
        const w = new PollingWatch(() => this.get(d), onNext, onError, POLL_INTERVAL_MS);
        return () => w.stop();
      }
    }
  }

  private subscribeProfile(
    onNext: (p: IProfile | undefined) => void,
    onError?: (error: Error) => void,
  ): () => void {
    const emit = (payload: { me: { name: string; email: string | null; level: IProfile['level'] }; adventures: AdventureRow[] }) => {
      onNext(this.toIProfile(payload.me, payload.adventures));
    };
    return this.subscribeWs('profile', undefined, emit, onError);
  }

  private subscribeAdventureDetail(
    adventureId: string,
    onNext: (a: IAdventure | undefined) => void,
    onError?: (error: Error) => void,
  ): () => void {
    const emit = (detail: AdventureDetailRow) => onNext(adventureRowToIAdventure(detail));
    return this.subscribeWs('adventure', adventureId, emit, onError);
  }

  private subscribeMap(
    adventureId: string,
    mapId: string,
    onNext: (m: IMap | undefined) => void,
    onError?: (error: Error) => void,
  ): () => void {
    const emit = (payload: { adventure: AdventureRow; map: MapRow }) => {
      onNext(mapRowToIMap(payload.map, payload.adventure.name, payload.adventure.owner));
    };
    return this.subscribeWs('map', mapId, emit, onError);
  }

  watchAdventures(
    _uid: string,
    onNext: (adventures: IIdentified<IAdventure>[]) => void,
    onError?: ((error: Error) => void) | undefined,
    _onCompletion?: (() => void) | undefined
  ): () => void {
    const emit = (rows: AdventureRow[]) => onNext(rows.map(r => ({
      id: r.id,
      record: adventureRowToIAdventure(r),
    })));
    return this.subscribeWs<AdventureRow[]>('adventures', undefined, emit, onError);
  }

  watchChanges(
    _adventureId: string,
    mapId: string,
    onNext: (changes: Changes) => void,
    onError?: ((error: Error) => void) | undefined,
    _onCompletion?: (() => void) | undefined,
    onSubscribed?: (() => void) | undefined,
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
      console.error('watchChanges subscribe failed:', e);
      onError?.(e instanceof Error ? e : new Error(String(e)));
      return () => {};
    }
  }

  watchPlayers(
    adventureId: string,
    onNext: (players: IPlayer[]) => void,
    onError?: ((error: Error) => void) | undefined,
    _onCompletion?: (() => void) | undefined
  ): () => void {
    const emit = (payload: PlayersScopeData) => {
      const adv = payload.adventure ?? emptyAdventureRow(adventureId);
      onNext(payload.players.map(p => playerRowToIPlayer(p, adv)));
    };
    return this.subscribeWs<PlayersScopeData>('players', adventureId, emit, onError);
  }

  watchSharedAdventures(
    _uid: string,
    onNext: (adventures: IPlayer[]) => void,
    onError?: ((error: Error) => void) | undefined,
    _onCompletion?: (() => void) | undefined
  ): () => void {
    // Shared adventures are just the subset of this user's adventures not
    // owned by them. Derive from the same subscription.
    const emit = (rows: AdventureRow[]) => onNext(
      rows.filter(r => r.owner !== this.uid)
        .map(r => adventureRowToSelfPlayer(r, this.uid)),
    );
    return this.subscribeWs<AdventureRow[]>('adventures', undefined, emit, onError);
  }

  watchSpritesheets(
    adventureId: string,
    onNext: (spritesheets: IDataAndReference<ISpritesheet>[]) => void,
    onError?: ((error: Error) => void) | undefined,
    _onCompletion?: (() => void) | undefined
  ): () => void {
    const emit = (rows: SpritesheetRow[]) => onNext(rows.map(r => new HonoDataAndReference<ISpritesheet>(
      r.id,
      `adventures/${adventureId}/spritesheets/${r.id}`,
      passthroughConverter(),
      spritesheetRowToISpritesheet(r),
    )));
    return this.subscribeWs<SpritesheetRow[]>('spritesheets', adventureId, emit, onError);
  }

  /**
   * Treat snapshot + update frames the same from the caller's view. Dedup by
   * JSON-compare across all subscribers for the same (scope, id), so no-op
   * re-broadcasts and StrictMode's double-mount don't churn downstream React
   * effects. `mapChanges` uses a separate path in `watchChanges` because
   * each frame must emit.
   */
  private subscribeWs<T>(
    scope: Exclude<UpdateScope, 'mapChanges'>,
    id: string | undefined,
    emit: (data: T) => void,
    onError?: (error: Error) => void,
  ): () => void {
    try {
      const cacheKey = `${scope}:${id ?? ''}`;
      const dedupedEmit = (data: unknown) => {
        const json = JSON.stringify(data);
        if (this.lastEmitJson.get(cacheKey) === json) return;
        this.lastEmitJson.set(cacheKey, json);
        emit(data as T);
      };
      const handlers: SubscriptionHandlers = {
        onSnapshot: dedupedEmit,
        onUpdate: dedupedEmit,
        onError,
      };
      const sub = this.getSocket().subscribe(scope, id, handlers);
      return () => {
        sub.unsubscribe();
        // Clear so the next subscription for this key always sees its snapshot as fresh.
        this.lastEmitJson.delete(cacheKey);
      };
    } catch (e) {
      console.error(`${scope} subscribe failed:`, e);
      onError?.(e instanceof Error ? e : new Error(String(e)));
      return () => {};
    }
  }
}
