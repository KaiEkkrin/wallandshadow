import { eq, and, gt } from 'drizzle-orm';
import type { Changes, ICharacter, MapType, UserLevel } from '@wallandshadow/shared';
import type { Db } from '../db/connection.js';
import {
  adventures,
  adventurePlayers,
  maps as mapsTable,
  mapChanges,
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
  lastSeq: string | null;  // seq of the last change in this payload, null if no changes
  full: boolean;           // true = client should reset before applying; false = delta
}

export interface MapRowPayload {
  adventureId: string;
  id: string;
  name: string;
  description: string;
  ty: string;
  ffa: boolean;
  imagePath: string;
}

export interface MapSummaryRowPayload {
  adventureId: string;
  id: string;
  name: string;
  description: string;
  ty: string;
  imagePath: string;
}

export interface AdventureDetailPayload extends AdventureRowPayload {
  maps: MapSummaryRowPayload[];
}

export interface MapScopePayload {
  adventure: AdventureRowPayload;
  map: MapRowPayload;
}

export interface ProfilePayload {
  me: {
    uid: string;
    email: string | null;
    emailVerified: boolean;
    name: string;
    level: UserLevel;
  };
  adventures: AdventureRowPayload[];
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

/** Base + incremental change documents for a map, in apply order.
 *
 * If `lastSeq` is provided and still exists as an incremental row, returns only
 * the delta (changes with seq > lastSeq, full: false). If the seq has been
 * consolidated away, falls back to a full reload (full: true).
 */
export async function snapshotMapChanges(
  database: Db,
  mapId: string,
  lastSeq?: string,
): Promise<MapChangesScopePayload> {
  if (lastSeq !== undefined) {
    const seqBig = BigInt(lastSeq);

    // Check whether the client's last-seen incremental still exists
    const [existing] = await database
      .select({ seq: mapChanges.seq })
      .from(mapChanges)
      .where(and(eq(mapChanges.mapId, mapId), eq(mapChanges.isBase, false), eq(mapChanges.seq, seqBig)))
      .limit(1);

    if (existing) {
      // Delta path: send only what the client hasn't seen yet
      const deltaRows = await database
        .select({ seq: mapChanges.seq, changes: mapChanges.changes })
        .from(mapChanges)
        .where(and(eq(mapChanges.mapId, mapId), eq(mapChanges.isBase, false), gt(mapChanges.seq, seqBig)))
        .orderBy(mapChanges.seq);

      const out = deltaRows.map(r => r.changes as Changes);
      const newLastSeq = deltaRows.length > 0
        ? deltaRows[deltaRows.length - 1].seq.toString()
        : lastSeq;
      return { changes: out, lastSeq: newLastSeq, full: false };
    }
    // Fall through to full reload — the seq was consolidated.
  }

  // Full reload
  const { baseRow, incrementalRows } = await fetchMapChanges(database, mapId);
  const out: Changes[] = [];
  if (baseRow) out.push(baseRow.changes as Changes);
  for (const row of incrementalRows) out.push(row.changes as Changes);

  let lastSeqOut: string | null = null;
  if (incrementalRows.length > 0) {
    lastSeqOut = incrementalRows[incrementalRows.length - 1].seq.toString();
  } else if (baseRow) {
    lastSeqOut = baseRow.seq.toString();
  }

  return { changes: out, lastSeq: lastSeqOut, full: true };
}

/** Shared row fetcher used by both the REST `GET /api/auth/me` and the WS `profile` snapshot. */
export async function fetchMeRow(database: Db, uid: string) {
  const [user] = await database.select({
    id: users.id,
    email: users.email,
    emailVerified: users.emailVerified,
    name: users.name,
    level: users.level,
  }).from(users).where(eq(users.id, uid)).limit(1);
  return user;
}

export async function snapshotProfile(database: Db, uid: string): Promise<ProfilePayload | null> {
  const [me, advs] = await Promise.all([
    fetchMeRow(database, uid),
    snapshotAdventures(database, uid),
  ]);
  if (!me) return null;
  return {
    me: {
      uid: me.id,
      email: me.email,
      emailVerified: me.emailVerified,
      name: me.name,
      level: me.level as UserLevel,
    },
    adventures: advs,
  };
}

/** Adventure detail (metadata + maps list) — matches GET /api/adventures/:id. */
export async function snapshotAdventureDetail(
  database: Db,
  adventureId: string,
): Promise<AdventureDetailPayload | null> {
  const [advRows, mapRows] = await Promise.all([
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
        id: mapsTable.id,
        name: mapsTable.name,
        description: mapsTable.description,
        ty: mapsTable.ty,
        imagePath: mapsTable.imagePath,
      })
      .from(mapsTable)
      .where(eq(mapsTable.adventureId, adventureId)),
  ]);

  const adv = advRows[0];
  if (!adv) return null;
  return {
    id: adv.id,
    name: adv.name,
    description: adv.description,
    owner: adv.ownerId,
    ownerName: adv.ownerName,
    imagePath: adv.imagePath,
    maps: mapRows.map(m => ({
      adventureId,
      id: m.id,
      name: m.name,
      description: m.description,
      ty: m.ty as MapType,
      imagePath: m.imagePath,
    })),
  };
}

/** { map, adventure } — matches the pair HonoDataService.get('map') composes today. */
export async function snapshotMap(
  database: Db,
  adventureId: string,
  mapId: string,
): Promise<MapScopePayload | null> {
  const [mapRows, advRows] = await Promise.all([
    database
      .select({
        id: mapsTable.id,
        name: mapsTable.name,
        description: mapsTable.description,
        ty: mapsTable.ty,
        ffa: mapsTable.ffa,
        imagePath: mapsTable.imagePath,
      })
      .from(mapsTable)
      .where(and(eq(mapsTable.id, mapId), eq(mapsTable.adventureId, adventureId)))
      .limit(1),
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
  ]);

  const mapRow = mapRows[0];
  const advRow = advRows[0];
  if (!mapRow || !advRow) return null;
  return {
    adventure: {
      id: advRow.id,
      name: advRow.name,
      description: advRow.description,
      owner: advRow.ownerId,
      ownerName: advRow.ownerName,
      imagePath: advRow.imagePath,
    },
    map: {
      adventureId,
      id: mapRow.id,
      name: mapRow.name,
      description: mapRow.description,
      ty: mapRow.ty,
      ffa: mapRow.ffa,
      imagePath: mapRow.imagePath,
    },
  };
}

/**
 * Fetch the adventure row + every map row in one pair of queries, then build
 * all `{ adventure, map }` scope payloads locally. This is what the NOTIFY
 * fan-out calls so a single adventure-level NOTIFY doesn't become O(maps)
 * round-trips to Postgres.
 */
export async function fetchAdventureMapPairs(
  database: Db,
  adventureId: string,
): Promise<MapScopePayload[]> {
  const [advRows, mapRows] = await Promise.all([
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
        id: mapsTable.id,
        name: mapsTable.name,
        description: mapsTable.description,
        ty: mapsTable.ty,
        ffa: mapsTable.ffa,
        imagePath: mapsTable.imagePath,
      })
      .from(mapsTable)
      .where(eq(mapsTable.adventureId, adventureId)),
  ]);

  const adv = advRows[0];
  if (!adv) return [];
  const advPayload: AdventureRowPayload = {
    id: adv.id,
    name: adv.name,
    description: adv.description,
    owner: adv.ownerId,
    ownerName: adv.ownerName,
    imagePath: adv.imagePath,
  };
  return mapRows.map(m => ({
    adventure: advPayload,
    map: {
      adventureId,
      id: m.id,
      name: m.name,
      description: m.description,
      ty: m.ty,
      ffa: m.ffa,
      imagePath: m.imagePath,
    },
  }));
}

