import { IAdventure, IPlayer } from '../data/adventure';
import { IAdminUserDetail, IAdminUserSummary } from '../data/admin';
import { ICharacter } from '../data/character';
import { IIdentified } from '../data/identified';
import { IImage } from '../data/image';
import { IInvite } from '../data/invite';
import { IMap, MapType } from '../data/map';
import { IInviteExpiryPolicy } from '../data/policy';
import { UserLevel } from '../data/policy';
import { IAdventureSummary } from '../data/profile';
import { ISprite, ISpritesheet } from '../data/sprite';

// The current user as returned by the server.
export interface IMe {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  name: string;
  level: UserLevel;
}

// The typed REST surface for the Hono backend. All one-shot HTTP operations
// (queries + commands) live here. Real-time subscriptions live on `ILiveData`.
export interface IApi {
  // ── Account ──────────────────────────────────────────────────────────────
  getMe(): Promise<IMe>;
  updateMe(fields: { name?: string }): Promise<void>;
  deleteMe(): Promise<void>;

  // ── Adventures ───────────────────────────────────────────────────────────
  listAdventures(): Promise<IIdentified<IAdventureSummary>[]>;
  getAdventure(id: string): Promise<IAdventure>;
  createAdventure(name: string, description: string): Promise<string>;
  updateAdventure(
    id: string,
    fields: { name?: string; description?: string; imagePath?: string },
  ): Promise<void>;
  deleteAdventure(id: string): Promise<void>;
  leaveAdventure(id: string): Promise<void>;

  // ── Players ──────────────────────────────────────────────────────────────
  listPlayers(adventureId: string): Promise<IPlayer[]>;
  getPlayer(adventureId: string, uid: string): Promise<IPlayer | undefined>;
  updatePlayer(
    adventureId: string,
    uid: string,
    fields: { allowed?: boolean; characters?: ICharacter[] },
  ): Promise<void>;

  editCharacter(adventureId: string, uid: string, character: ICharacter): Promise<void>;
  deleteCharacter(adventureId: string, uid: string, characterId: string): Promise<void>;

  // ── Maps ─────────────────────────────────────────────────────────────────
  listMaps(adventureId: string): Promise<IIdentified<IMap>[]>;
  getMap(adventureId: string, mapId: string): Promise<IMap | undefined>;
  createMap(
    adventureId: string,
    fields: {
      name: string;
      description: string;
      ty: MapType;
      ffa: boolean;
      enableGroupVision: boolean;
    },
  ): Promise<string>;
  cloneMap(
    adventureId: string,
    mapId: string,
    name: string,
    description: string,
  ): Promise<string>;
  updateMap(
    adventureId: string,
    mapId: string,
    fields: {
      name?: string;
      description?: string;
      imagePath?: string;
      ffa?: boolean;
      enableGroupVision?: boolean;
    },
  ): Promise<void>;
  deleteMap(adventureId: string, mapId: string): Promise<void>;
  consolidateMap(adventureId: string, mapId: string, resync: boolean): Promise<void>;

  // ── Invites ──────────────────────────────────────────────────────────────
  getInvite(inviteId: string): Promise<IInvite>;
  createInvite(adventureId: string, policy?: IInviteExpiryPolicy): Promise<string>;
  joinInvite(inviteId: string, policy?: IInviteExpiryPolicy): Promise<string>;

  // ── Images ───────────────────────────────────────────────────────────────
  listImages(): Promise<IImage[]>;
  uploadImage(file: Blob, name?: string): Promise<IImage>;
  getImageDownloadUrl(path: string): Promise<string>;
  deleteImage(path: string): Promise<void>;

  // ── Spritesheets ─────────────────────────────────────────────────────────
  listSpritesheets(adventureId: string): Promise<IIdentified<ISpritesheet>[]>;
  addSprites(adventureId: string, geometry: string, sources: string[]): Promise<ISprite[]>;

  // ── Admin ────────────────────────────────────────────────────────────────
  // Search by a single term: an email, an internal account id, or an external
  // (OIDC provider) id — the server auto-detects which.
  adminSearchUser(term: string): Promise<IAdminUserSummary | undefined>;
  adminGetUser(id: string): Promise<IAdminUserDetail>;
}
