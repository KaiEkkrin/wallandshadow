import { eq } from 'drizzle-orm';
import type { Changes, ICharacter } from '@wallandshadow/shared';
import type { Db } from '../db/connection.js';
import {
  adventures,
  adventurePlayers,
  spritesheets,
  users,
} from '../db/schema.js';
import { fetchMapChanges } from '../services/extensions.js';

// Wire shapes for WebSocket subscription payloads. Each snapshot mirrors the
// equivalent REST GET response so the client can reuse the same JSON parsing
// path for both initial and delta state.

export interface AdventureRowPayload {
  id: string;
  name: string;
  description: string;
  owner: string;
  ownerName: string;
  imagePath: string;
}

export interface PlayerRowPayload {
  playerId: string;
  playerName: string;
  allowed: boolean;
  characters: ICharacter[];
}

export interface PlayersScopePayload {
  adventure: AdventureRowPayload | null;
  players: PlayerRowPayload[];
}

export interface SpritesheetRowPayload {
  id: string;
  sprites: string[];
  geometry: string;
  freeSpaces: number;
  supersededBy: string;
  refs: number;
}

export interface MapChangesScopePayload {
  changes: Changes[];
}

/** The full list of adventures user X is a member of — matches GET /api/adventures. */
export async function snapshotAdventures(database: Db, uid: string): Promise<AdventureRowPayload[]> {
  const rows = await database
    .select({
      id: adventures.id,
      name: adventures.name,
      description: adventures.description,
      ownerId: adventures.ownerId,
      imagePath: adventures.imagePath,
      ownerName: users.name,
    })
    .from(adventurePlayers)
    .innerJoin(adventures, eq(adventurePlayers.adventureId, adventures.id))
    .innerJoin(users, eq(adventures.ownerId, users.id))
    .where(eq(adventurePlayers.userId, uid));

  return rows.map(r => ({
    id: r.id,
    name: r.name,
    description: r.description,
    owner: r.ownerId,
    ownerName: r.ownerName,
    imagePath: r.imagePath,
  }));
}

/** Adventure + players list for one adventure. */
export async function snapshotPlayers(database: Db, adventureId: string): Promise<PlayersScopePayload> {
  const [advRows, playerRows] = await Promise.all([
    database
      .select({
        id: adventures.id,
        name: adventures.name,
        description: adventures.description,
        ownerId: adventures.ownerId,
        imagePath: adventures.imagePath,
        ownerName: users.name,
      })
      .from(adventures)
      .innerJoin(users, eq(adventures.ownerId, users.id))
      .where(eq(adventures.id, adventureId))
      .limit(1),
    database
      .select({
        userId: adventurePlayers.userId,
        playerName: adventurePlayers.playerName,
        allowed: adventurePlayers.allowed,
        characters: adventurePlayers.characters,
      })
      .from(adventurePlayers)
      .where(eq(adventurePlayers.adventureId, adventureId)),
  ]);

  const adv = advRows[0];
  return {
    adventure: adv ? {
      id: adv.id,
      name: adv.name,
      description: adv.description,
      owner: adv.ownerId,
      ownerName: adv.ownerName,
      imagePath: adv.imagePath,
    } : null,
    players: playerRows.map(p => ({
      playerId: p.userId,
      playerName: p.playerName,
      allowed: p.allowed,
      characters: p.characters as ICharacter[],
    })),
  };
}

/** Spritesheets for an adventure — matches GET /api/adventures/:id/spritesheets. */
export async function snapshotSpritesheets(database: Db, adventureId: string): Promise<SpritesheetRowPayload[]> {
  const rows = await database
    .select({
      id: spritesheets.id,
      sprites: spritesheets.sprites,
      geometry: spritesheets.geometry,
      freeSpaces: spritesheets.freeSpaces,
      supersededBy: spritesheets.supersededBy,
      refs: spritesheets.refs,
    })
    .from(spritesheets)
    .where(eq(spritesheets.adventureId, adventureId));

  return rows.map(r => ({
    id: r.id,
    sprites: r.sprites as string[],
    geometry: r.geometry,
    freeSpaces: r.freeSpaces,
    supersededBy: r.supersededBy ?? '',
    refs: r.refs,
  }));
}

/** Base + incremental change documents for a map, in apply order. */
export async function snapshotMapChanges(database: Db, mapId: string): Promise<MapChangesScopePayload> {
  const { baseRow, incrementalRows } = await fetchMapChanges(database, mapId);
  const out: Changes[] = [];
  if (baseRow) out.push(baseRow.changes as Changes);
  for (const row of incrementalRows) out.push(row.changes as Changes);
  return { changes: out };
}

