import {
  MapType,
  IInviteExpiryPolicy,
  ISprite,
  IFunctionsService,
  spriteConverter,
} from '@wallandshadow/shared';
import { HonoApiClient } from './honoApi';

// TODO Phase 2: replace local JWT auth with OIDC
export class HonoFunctionsService implements IFunctionsService {
  private readonly api: HonoApiClient;

  constructor(api: HonoApiClient) {
    this.api = api;
  }

  async addSprites(adventureId: string, geometry: string, sources: string[]): Promise<ISprite[]> {
    // Split into batches of 10 to match the server's limit
    const sprites: ISprite[] = [];
    for (let i = 0; i < sources.length; i += 10) {
      const batch = sources.slice(i, Math.min(i + 10, sources.length));
      const result = await this.api.addSprites(adventureId, geometry, batch);
      if (Array.isArray(result.sprites)) {
        sprites.push(
          ...result.sprites.map((d: unknown) => spriteConverter.convert(d as Record<string, unknown>))
        );
      }
    }
    return sprites;
  }

  async createAdventure(name: string, description: string): Promise<string> {
    const { id } = await this.api.createAdventure(name, description);
    return id;
  }

  async createMap(adventureId: string, name: string, description: string, ty: MapType, ffa: boolean): Promise<string> {
    const { id } = await this.api.createMap(adventureId, name, description, ty, ffa);
    return id;
  }

  async cloneMap(adventureId: string, mapId: string, name: string, description: string): Promise<string> {
    const { id } = await this.api.cloneMap(adventureId, mapId, name, description);
    return id;
  }

  async consolidateMapChanges(adventureId: string, mapId: string, resync: boolean): Promise<void> {
    await this.api.consolidateMapChanges(adventureId, mapId, resync);
  }

  async deleteMap(adventureId: string, mapId: string): Promise<void> {
    await this.api.deleteMap(adventureId, mapId);
  }

  async deleteAdventure(adventureId: string): Promise<void> {
    await this.api.deleteAdventure(adventureId);
  }

  async deleteImage(path: string): Promise<void> {
    await this.api.deleteImage(path);
  }

  async inviteToAdventure(adventureId: string, policy?: IInviteExpiryPolicy): Promise<string> {
    const { inviteId } = await this.api.createInvite(adventureId, policy);
    return inviteId;
  }

  async joinAdventure(inviteId: string, policy?: IInviteExpiryPolicy): Promise<string> {
    const { adventureId } = await this.api.joinInvite(inviteId, policy);
    return adventureId;
  }
}
