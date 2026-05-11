import type {
  IAdventure,
  IAdventureSummary,
  IInvite,
  IMap,
  IMapSummary,
  IPlayer,
  ISpritesheet,
  MapType,
} from '@wallandshadow/shared';
import type {
  AdventureDetailRow,
  AdventureRow,
  InviteDetailRow,
  MapRow,
  PlayerRow,
  SpritesheetRow,
} from './honoApiClient';

export function emptyAdventureRow(adventureId: string): AdventureRow {
  return { id: adventureId, name: '', description: '', owner: '', ownerName: '', imagePath: '' };
}

export function adventureRowToIAdventure(row: AdventureRow | AdventureDetailRow): IAdventure {
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

export function adventureRowToSummary(row: AdventureRow): IAdventureSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    owner: row.owner,
    ownerName: row.ownerName,
    imagePath: row.imagePath,
  };
}

export function mapRowToIMap(row: MapRow, adventureName: string, owner: string): IMap {
  return {
    adventureName,
    name: row.name,
    description: row.description,
    owner,
    ty: row.ty as MapType,
    ffa: row.ffa,
    enableGroupVision: row.enableGroupVision,
    imagePath: row.imagePath,
  };
}

export function playerRowToIPlayer(row: PlayerRow, adventure: AdventureRow): IPlayer {
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

export function inviteRowToIInvite(row: InviteDetailRow): IInvite {
  return {
    adventureId: row.adventureId,
    adventureName: row.adventureName,
    owner: '',
    ownerName: row.ownerName,
    timestamp: new Date(row.expiresAt).getTime(),
  };
}

export function spritesheetRowToISpritesheet(r: SpritesheetRow | { sprites: string[]; geometry: string; freeSpaces: number; supersededBy: string; refs: number }): ISpritesheet {
  return {
    sprites: r.sprites,
    geometry: r.geometry,
    freeSpaces: r.freeSpaces,
    date: Date.now(),
    supersededBy: r.supersededBy,
    refs: r.refs,
  };
}
