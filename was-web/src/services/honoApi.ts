import type {
  IAdventure,
  IAdventureSummary,
  IApi,
  ICharacter,
  IIdentified,
  IImage,
  IInvite,
  IInviteExpiryPolicy,
  IMap,
  IMe,
  IPlayer,
  ISprite,
  ISpritesheet,
  MapType,
} from '@wallandshadow/shared';
import { spriteConverter } from '@wallandshadow/shared';
import { ApiError, HonoApiClient } from './honoApiClient';
import {
  adventureRowToIAdventure,
  adventureRowToSummary,
  emptyAdventureRow,
  inviteRowToIInvite,
  mapRowToIMap,
  playerRowToIPlayer,
  spritesheetRowToISpritesheet,
} from './honoConverters';

function isNotFound(e: unknown): boolean {
  return e instanceof ApiError && e.status === 404;
}

// Typed REST surface implementing IApi over the raw HonoApiClient.
export class HonoApi implements IApi {
  private readonly client: HonoApiClient;

  constructor(client: HonoApiClient) {
    this.client = client;
  }

  // ── Account ────────────────────────────────────────────────────────────────

  async getMe(): Promise<IMe> {
    return await this.client.getMe();
  }

  async updateMe(fields: { name?: string }): Promise<void> {
    if (fields.name === undefined) return;
    await this.client.updateMe(fields.name);
  }

  // ── Adventures ─────────────────────────────────────────────────────────────

  async listAdventures(): Promise<IIdentified<IAdventureSummary>[]> {
    const rows = await this.client.getAdventures();
    return rows.map(r => ({ id: r.id, record: adventureRowToSummary(r) }));
  }

  async getAdventure(id: string): Promise<IAdventure> {
    const detail = await this.client.getAdventure(id);
    return adventureRowToIAdventure(detail);
  }

  async createAdventure(name: string, description: string): Promise<string> {
    const { id } = await this.client.createAdventure(name, description);
    return id;
  }

  async updateAdventure(
    id: string,
    fields: { name?: string; description?: string; imagePath?: string },
  ): Promise<void> {
    if (Object.keys(fields).length === 0) return;
    await this.client.updateAdventure(id, fields);
  }

  async deleteAdventure(id: string): Promise<void> {
    await this.client.deleteAdventure(id);
  }

  async leaveAdventure(id: string): Promise<void> {
    await this.client.leaveAdventure(id);
  }

  // ── Players ────────────────────────────────────────────────────────────────

  async listPlayers(adventureId: string): Promise<IPlayer[]> {
    const [players, adv] = await Promise.all([
      this.client.getPlayers(adventureId).catch(e => {
        if (isNotFound(e)) return [];
        throw e;
      }),
      this.client.getAdventure(adventureId).catch(() => emptyAdventureRow(adventureId)),
    ]);
    return players.map(p => playerRowToIPlayer(p, adv));
  }

  async getPlayer(adventureId: string, uid: string): Promise<IPlayer | undefined> {
    const players = await this.listPlayers(adventureId);
    return players.find(p => p.playerId === uid);
  }

  async updatePlayer(
    adventureId: string,
    uid: string,
    fields: { allowed?: boolean; characters?: ICharacter[] },
  ): Promise<void> {
    if (Object.keys(fields).length === 0) return;
    await this.client.updatePlayer(adventureId, uid, fields);
  }

  async editCharacter(adventureId: string, uid: string, character: ICharacter): Promise<void> {
    // TODO GH-136: replace with `POST /adventures/:id/players/:uid/characters`.
    // The server only exposes a whole-array PATCH today, so we read-modify-write.
    const player = await this.getPlayer(adventureId, uid);
    if (player === undefined) {
      throw new Error('Player not found');
    }
    const characters = [...player.characters];
    const existing = characters.findIndex(c => c.id === character.id);
    if (existing >= 0) {
      characters[existing] = { ...characters[existing], ...character };
    } else {
      characters.push(character);
    }
    await this.client.updatePlayer(adventureId, uid, { characters });
  }

  async deleteCharacter(adventureId: string, uid: string, characterId: string): Promise<void> {
    // TODO GH-136: replace with `DELETE /adventures/:id/players/:uid/characters/:characterId`.
    const player = await this.getPlayer(adventureId, uid);
    if (player === undefined) return;
    const characters = player.characters.filter(c => c.id !== characterId);
    if (characters.length === player.characters.length) return;
    await this.client.updatePlayer(adventureId, uid, { characters });
  }

  // ── Maps ───────────────────────────────────────────────────────────────────

  async listMaps(adventureId: string): Promise<IIdentified<IMap>[]> {
    const [maps, adv] = await Promise.all([
      this.client.getMaps(adventureId),
      this.client.getAdventure(adventureId).catch(() => emptyAdventureRow(adventureId)),
    ]);
    return maps.map(m => ({
      id: m.id,
      record: mapRowToIMap(m, adv.name, adv.owner),
    }));
  }

  async getMap(adventureId: string, mapId: string): Promise<IMap | undefined> {
    try {
      const [mapRow, adv] = await Promise.all([
        this.client.getMap(adventureId, mapId),
        this.client.getAdventure(adventureId),
      ]);
      return mapRowToIMap(mapRow, adv.name, adv.owner);
    } catch (e) {
      if (isNotFound(e)) return undefined;
      throw e;
    }
  }

  async createMap(
    adventureId: string,
    fields: { name: string; description: string; ty: MapType; ffa: boolean; enableGroupVision: boolean },
  ): Promise<string> {
    const { id } = await this.client.createMap(
      adventureId, fields.name, fields.description, fields.ty, fields.ffa, fields.enableGroupVision,
    );
    return id;
  }

  async cloneMap(
    adventureId: string,
    mapId: string,
    name: string,
    description: string,
  ): Promise<string> {
    const { id } = await this.client.cloneMap(adventureId, mapId, name, description);
    return id;
  }

  async updateMap(
    adventureId: string,
    mapId: string,
    fields: {
      name?: string;
      description?: string;
      imagePath?: string;
      ffa?: boolean;
      enableGroupVision?: boolean;
    },
  ): Promise<void> {
    if (Object.keys(fields).length === 0) return;
    await this.client.updateMap(adventureId, mapId, fields);
  }

  async deleteMap(adventureId: string, mapId: string): Promise<void> {
    await this.client.deleteMap(adventureId, mapId);
  }

  async consolidateMap(adventureId: string, mapId: string, resync: boolean): Promise<void> {
    await this.client.consolidateMapChanges(adventureId, mapId, resync);
  }

  // ── Invites ────────────────────────────────────────────────────────────────

  async getInvite(inviteId: string): Promise<IInvite> {
    const row = await this.client.getInvite(inviteId);
    return inviteRowToIInvite(row);
  }

  async createInvite(adventureId: string, policy?: IInviteExpiryPolicy): Promise<string> {
    const { inviteId } = await this.client.createInvite(adventureId, policy);
    return inviteId;
  }

  async joinInvite(inviteId: string, policy?: IInviteExpiryPolicy): Promise<string> {
    const { adventureId } = await this.client.joinInvite(inviteId, policy);
    return adventureId;
  }

  // ── Images ─────────────────────────────────────────────────────────────────

  async listImages(): Promise<IImage[]> {
    const { images } = await this.client.getImages();
    return images.map(r => ({ name: r.name, path: r.path }));
  }

  async uploadImage(file: Blob, name?: string): Promise<IImage> {
    const row = await this.client.uploadImage(file, name);
    return { name: row.name, path: row.path };
  }

  async getImageDownloadUrl(path: string): Promise<string> {
    const { url } = await this.client.getImageDownloadUrl(path);
    return url;
  }

  async deleteImage(path: string): Promise<void> {
    await this.client.deleteImage(path);
  }

  // ── Spritesheets ───────────────────────────────────────────────────────────

  async listSpritesheets(adventureId: string): Promise<IIdentified<ISpritesheet>[]> {
    const rows = await this.client.getSpritesheets(adventureId);
    return rows.map(r => ({ id: r.id, record: spritesheetRowToISpritesheet(r) }));
  }

  async addSprites(adventureId: string, geometry: string, sources: string[]): Promise<ISprite[]> {
    // Split into batches of 10 to match the server's limit; run in parallel.
    const batches: string[][] = [];
    for (let i = 0; i < sources.length; i += 10) {
      batches.push(sources.slice(i, i + 10));
    }
    const results = await Promise.all(
      batches.map(batch => this.client.addSprites(adventureId, geometry, batch)),
    );
    return results.flatMap(r =>
      Array.isArray(r.sprites)
        ? r.sprites.map(d => spriteConverter.convert(d as Record<string, unknown>))
        : [],
    );
  }
}
