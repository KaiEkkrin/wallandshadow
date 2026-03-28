import { MapType } from "../data/map";
import { IInviteExpiryPolicy } from "../data/policy";
import { ISprite } from "../data/sprite";
import { spriteConverter } from "./converter";
import { IFunctionsService } from "./interfaces";
import * as Req from './request';

import { Functions, httpsCallable } from 'firebase/functions';

export class FunctionsService implements IFunctionsService {
  private readonly _functions: Functions;

  constructor(functions: Functions) {
    this._functions = functions;
  }

  private get addSpritesCallable() {
    return httpsCallable(this._functions, 'addSprites');
  }

  private get interactCallable() {
    return httpsCallable(this._functions, 'interact');
  }

  async addSprites(adventureId: string, geometry: string, sources: string[]): Promise<ISprite[]> {
    // We split the sources list up into groups of 10, since that's the longest
    // the Function will accept
    const sprites: ISprite[] = [];
    for (let i = 0; i < sources.length; i += 10) {
      const result = await this.addSpritesCallable({
        adventureId: adventureId, geometry: geometry,
        sources: sources.slice(i, Math.min(i + 10, sources.length))
      });
      if (Array.isArray(result.data)) {
        sprites.push(...result.data.map((d: unknown) => spriteConverter.convert(d as Record<string, unknown>)));
      }
    }

    return sprites;
  }

  async createAdventure(name: string, description: string): Promise<string> {
    const request: Req.CreateAdventureRequest = {
      verb: 'createAdventure',
      name, description
    };
    const result = await this.interactCallable(request);
    return String(result.data);
  }

  async createMap(adventureId: string, name: string, description: string, ty: MapType, ffa: boolean): Promise<string> {
    const request: Req.CreateMapRequest = {
      verb: 'createMap',
      adventureId, name, description, ty, ffa
    };
    const result = await this.interactCallable(request);
    return String(result.data);
  }

  async cloneMap(adventureId: string, mapId: string, name: string, description: string): Promise<string> {
    const request: Req.CloneMapRequest = {
      verb: 'cloneMap',
      adventureId, mapId, name, description
    };
    const result = await this.interactCallable(request);
    return String(result.data);
  }

  async consolidateMapChanges(adventureId: string, mapId: string, resync: boolean) {
    const request: Req.ConsolidateMapChangesRequest = {
      verb: 'consolidateMapChanges',
      adventureId, mapId, resync
    };
    await this.interactCallable(request);
  }

  async deleteMap(adventureId: string, mapId: string): Promise<void> {
    const request: Req.DeleteMapRequest = {
      verb: 'deleteMap',
      adventureId, mapId
    };
    await this.interactCallable(request);
  }

  async deleteAdventure(adventureId: string): Promise<void> {
    const request: Req.DeleteAdventureRequest = {
      verb: 'deleteAdventure',
      adventureId
    };
    await this.interactCallable(request);
  }

  async deleteImage(path: string): Promise<void> {
    const request: Req.DeleteImageRequest = {
      verb: 'deleteImage', path
    };
    await this.interactCallable(request);
  }

  async inviteToAdventure(
    adventureId: string,
    policy?: IInviteExpiryPolicy | undefined // for testing purposes only
  ) {
    const request: Req.InviteToAdventureRequest = {
      verb: 'inviteToAdventure',
      adventureId, policy
    };
    const result = await this.interactCallable(request);
    return String(result.data);
  }

  async joinAdventure(
    inviteId: string, policy?: IInviteExpiryPolicy | undefined // for testing purposes only
  ) {
    const request: Req.JoinAdventureRequest = {
      verb: 'joinAdventure',
      inviteId, policy
    };
    const result = await this.interactCallable(request);
    return String(result.data);
  }
}