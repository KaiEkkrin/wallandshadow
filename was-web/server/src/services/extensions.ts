import {
  Change,
  Changes,
  SimpleChangeTracker,
  trackChanges,
  GridCoord,
  GridEdge,
  coordString,
  edgeString,
  FeatureDictionary,
  IFeature,
  ITokenDictionary,
  StripedArea,
  IdDictionary,
  IMapImage,
  IAnnotation,
  IMap,
  MapType,
  getUserPolicy,
  IInviteExpiryPolicy,
  defaultInviteExpiryPolicy,
  getTokenGeometry,
  Tokens,
  SimpleTokenDrawing,
  createChangesConverter,
  UserLevel,
  ICharacter,
} from '@wallandshadow/shared';
import { throwApiError } from '../errors.js';
import { Db } from '../db/connection.js';
import {
  adventures,
  adventurePlayers,
  maps,
  mapChanges,
  invites,
  users,
} from '../db/schema.js';
import { eq, and, count, sql, inArray, gt } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import dayjs from 'dayjs';

// ─── Shared auth helper ───────────────────────────────────────────────────────

export async function assertAdventureMember(db: Db, uid: string, adventureId: string): Promise<void> {
  const [row] = await db.select({ ownerId: adventures.ownerId })
    .from(adventures)
    .where(eq(adventures.id, adventureId))
    .limit(1);

  if (!row) {
    throwApiError('not-found', 'Adventure not found');
  }
  if (row.ownerId === uid) return;

  const [playerRow] = await db.select({ allowed: adventurePlayers.allowed })
    .from(adventurePlayers)
    .where(and(
      eq(adventurePlayers.adventureId, adventureId),
      eq(adventurePlayers.userId, uid),
      eq(adventurePlayers.allowed, true),
    ))
    .limit(1);

  if (!playerRow) {
    throwApiError('permission-denied', 'You are not in this adventure');
  }
}

export async function assertAdventureOwner(db: Db, uid: string, adventureId: string): Promise<void> {
  const [row] = await db.select({ ownerId: adventures.ownerId })
    .from(adventures)
    .where(eq(adventures.id, adventureId))
    .limit(1);

  if (!row) {
    throwApiError('not-found', 'Adventure not found');
  }
  if (row.ownerId !== uid) {
    throwApiError('permission-denied', 'Only the adventure owner can perform this action');
  }
}

// ─── Adventure ───────────────────────────────────────────────────────────────

export async function createAdventure(
  db: Db,
  uid: string,
  name: string,
  description: string,
): Promise<string> {
  const id = uuidv7();

  await db.transaction(async (tx) => {
    const [user] = await tx.select({ name: users.name, level: users.level })
      .from(users).where(eq(users.id, uid)).limit(1);
    if (!user) {
      throwApiError('permission-denied', 'No profile available');
    }

    const [{ adventureCount }] = await tx
      .select({ adventureCount: count() })
      .from(adventures)
      .where(eq(adventures.ownerId, uid));

    const policy = getUserPolicy(user.level as UserLevel);
    if (Number(adventureCount) >= policy.adventures) {
      throwApiError('permission-denied', 'You already have the maximum number of adventures.');
    }

    await tx.insert(adventures).values({ id, name, description, ownerId: uid, imagePath: '' });
    await tx.insert(adventurePlayers).values({
      adventureId: id,
      userId: uid,
      playerName: user.name,
      allowed: true,
      characters: [],
    });
  });

  return id;
}

export async function deleteAdventure(db: Db, uid: string, adventureId: string): Promise<void> {
  const [adventure] = await db.select({ ownerId: adventures.ownerId })
    .from(adventures).where(eq(adventures.id, adventureId)).limit(1);

  if (!adventure) {
    throwApiError('not-found', 'Adventure not found');
  }
  if (adventure.ownerId !== uid) {
    throwApiError('permission-denied', 'Only the owner can delete this adventure');
  }

  // CASCADE handles maps, map_changes, adventure_players, spritesheets, invites
  await db.delete(adventures).where(eq(adventures.id, adventureId));
}

// ─── Maps ────────────────────────────────────────────────────────────────────

export async function createMap(
  db: Db,
  uid: string,
  adventureId: string,
  name: string,
  description: string,
  ty: MapType,
  ffa: boolean,
): Promise<string> {
  const id = uuidv7();

  await db.transaction(async (tx) => {
    const [adventure] = await tx.select({ ownerId: adventures.ownerId })
      .from(adventures).where(eq(adventures.id, adventureId)).limit(1);
    if (!adventure) {
      throwApiError('invalid-argument', 'No such adventure');
    }
    if (adventure.ownerId !== uid) {
      throwApiError('permission-denied', 'You do not own this adventure');
    }

    const [user] = await tx.select({ level: users.level })
      .from(users).where(eq(users.id, uid)).limit(1);
    if (!user) {
      throwApiError('permission-denied', 'No profile available');
    }

    const [{ mapCount }] = await tx
      .select({ mapCount: count() })
      .from(maps)
      .where(eq(maps.adventureId, adventureId));

    const policy = getUserPolicy(user.level as UserLevel);
    if (Number(mapCount) >= policy.maps) {
      throwApiError('permission-denied', 'You already have the maximum number of maps in this adventure.');
    }

    await tx.insert(maps).values({ id, adventureId, name, description, ty, ffa, imagePath: '' });
  });

  return id;
}

export async function cloneMap(
  db: Db,
  uid: string,
  adventureId: string,
  mapId: string,
  name: string,
  description: string,
): Promise<string> {
  const [mapResult, adventureResult] = await Promise.all([
    db.select().from(maps)
      .where(and(eq(maps.id, mapId), eq(maps.adventureId, adventureId))).limit(1),
    db.select({ name: adventures.name, ownerId: adventures.ownerId })
      .from(adventures).where(eq(adventures.id, adventureId)).limit(1),
  ]);

  const [existingMap] = mapResult;
  if (!existingMap) {
    throwApiError('not-found', 'Existing map not found.');
  }

  const [adventure] = adventureResult;
  if (!adventure) {
    throwApiError('not-found', 'Adventure not found');
  }

  const mapRecord: IMap = {
    adventureName: adventure.name,
    name: existingMap.name,
    description: existingMap.description,
    ty: existingMap.ty as MapType,
    ffa: existingMap.ffa,
    imagePath: existingMap.imagePath,
    owner: adventure.ownerId,
  };

  // Consolidate the source map to get a clean base state
  const baseChange = await consolidateMapChanges(db, uid, adventureId, mapId, mapRecord, false);

  const id = uuidv7();

  await db.transaction(async (tx) => {
    const [user] = await tx.select({ level: users.level })
      .from(users).where(eq(users.id, uid)).limit(1);
    if (!user) {
      throwApiError('permission-denied', 'No profile available');
    }

    if (adventure.ownerId !== uid) {
      throwApiError('permission-denied', 'You do not own this adventure');
    }

    const [{ mapCount }] = await tx
      .select({ mapCount: count() })
      .from(maps)
      .where(eq(maps.adventureId, adventureId));

    const policy = getUserPolicy(user.level as UserLevel);
    if (Number(mapCount) >= policy.maps) {
      throwApiError('permission-denied', 'You already have the maximum number of maps in this adventure.');
    }

    await tx.insert(maps).values({
      id,
      adventureId,
      name,
      description,
      ty: existingMap.ty,
      ffa: existingMap.ffa,
      imagePath: existingMap.imagePath,
    });

    // Copy the consolidated base state to the new map
    if (baseChange !== undefined) {
      const baseChangeRow = {
        id: id, // deterministic: base row id == map id
        mapId: id,
        changes: baseChange as unknown as object,
        incremental: false,
        resync: baseChange.resync ?? false,
        userId: uid,
      };
      await tx.insert(mapChanges).values(baseChangeRow);
    }
  });

  return id;
}

// ─── Consolidation ───────────────────────────────────────────────────────────

interface ConsolidateResult {
  baseChange: Changes | undefined;
  isNew: boolean;
}

async function tryConsolidateMapChanges(
  db: Db,
  uid: string,
  mapId: string,
  m: IMap,
  resync: boolean,
  syncChanges?: (tokenDict: ITokenDictionary) => void,
): Promise<ConsolidateResult> {
  const converter = createChangesConverter();

  // Fetch base change row (id == mapId by convention)
  const baseRows = await db.select({ id: mapChanges.id, changes: mapChanges.changes })
    .from(mapChanges)
    .where(and(eq(mapChanges.mapId, mapId), eq(mapChanges.incremental, false)))
    .limit(1);
  const baseRow = baseRows[0];
  const baseChange: Changes | undefined = baseRow
    ? converter.convert(baseRow.changes as Record<string, unknown>)
    : undefined;

  // Fetch up to 499 incremental changes
  const incrementalRows = await db.select({ id: mapChanges.id, changes: mapChanges.changes })
    .from(mapChanges)
    .where(and(eq(mapChanges.mapId, mapId), eq(mapChanges.incremental, true)))
    .orderBy(mapChanges.createdAt)
    .limit(499);

  if (incrementalRows.length === 0) {
    return { baseChange, isNew: false };
  }

  // Look up owner policy for object cap
  const [user] = await db.select({ level: users.level })
    .from(users).where(eq(users.id, m.owner)).limit(1);
  const ownerPolicy = getUserPolicy((user?.level ?? 'standard') as UserLevel);

  // Replay all changes through SimpleChangeTracker
  const tokenDict = new Tokens(getTokenGeometry(m.ty), new SimpleTokenDrawing());
  const outlineTokenDict = new Tokens(getTokenGeometry(m.ty), new SimpleTokenDrawing());
  const tracker = new SimpleChangeTracker(
    new FeatureDictionary<GridCoord, StripedArea>(coordString),
    new FeatureDictionary<GridCoord, StripedArea>(coordString),
    tokenDict,
    outlineTokenDict,
    new FeatureDictionary<GridEdge, IFeature<GridEdge>>(edgeString),
    new FeatureDictionary<GridCoord, IAnnotation>(coordString),
    new IdDictionary<IMapImage>(),
    ownerPolicy,
  );

  if (baseChange !== undefined) {
    trackChanges(m, tracker, baseChange.chs, baseChange.user);
  }

  let isResync = resync;
  for (const row of incrementalRows) {
    const ch = converter.convert(row.changes as Record<string, unknown>);
    const success = trackChanges(m, tracker, ch.chs, ch.user);
    if (success === false) {
      isResync = true;
    }
  }

  syncChanges?.(tokenDict);
  const consolidated: Change[] = tracker.getConsolidated();

  // Write consolidated state atomically
  const newBaseChange: Changes = {
    chs: consolidated,
    timestamp: Date.now(),
    incremental: false,
    user: uid,
    resync: isResync,
  };

  await db.transaction(async (tx) => {
    if (baseRow) {
      // Lock the base row and update it
      await tx.execute(sql`SELECT id FROM map_changes WHERE id = ${baseRow.id} FOR UPDATE`);
      await tx.update(mapChanges)
        .set({ changes: newBaseChange as unknown as object, resync: isResync, userId: uid })
        .where(eq(mapChanges.id, baseRow.id));
    } else {
      // First consolidation: insert base row using map ID as its ID
      await tx.insert(mapChanges).values({
        id: mapId,
        mapId,
        changes: newBaseChange as unknown as object,
        incremental: false,
        resync: isResync,
        userId: uid,
      }).onConflictDoUpdate({
        target: mapChanges.id,
        set: { changes: newBaseChange as unknown as object, resync: isResync, userId: uid },
      });
    }

    // Delete the processed incremental rows
    const ids = incrementalRows.map(r => r.id);
    await tx.delete(mapChanges).where(inArray(mapChanges.id, ids));
  });

  return { baseChange: newBaseChange, isNew: true };
}

export async function consolidateMapChanges(
  db: Db,
  uid: string,
  adventureId: string,
  mapId: string,
  m: IMap,
  resync: boolean,
  syncChanges?: (tokenDict: ITokenDictionary) => void,
): Promise<Changes | undefined> {
  const maxIterations = 20;
  for (let i = 0; i < maxIterations; ++i) {
    const result = await tryConsolidateMapChanges(db, uid, mapId, m, resync, syncChanges);
    if (!result.isNew) {
      return result.baseChange;
    }
  }
  throwApiError('resource-exhausted', `Map ${mapId} consolidation did not converge after ${maxIterations} iterations`);
}

export async function deleteMap(db: Db, uid: string, adventureId: string, mapId: string): Promise<void> {
  const [adventure] = await db.select({ ownerId: adventures.ownerId })
    .from(adventures).where(eq(adventures.id, adventureId)).limit(1);
  if (!adventure) {
    throwApiError('not-found', 'Adventure not found');
  }
  if (adventure.ownerId !== uid) {
    throwApiError('permission-denied', 'Only the adventure owner can delete maps');
  }

  // CASCADE handles map_changes
  await db.delete(maps).where(and(eq(maps.id, mapId), eq(maps.adventureId, adventureId)));
}

// ─── Invites ─────────────────────────────────────────────────────────────────

export async function inviteToAdventure(
  db: Db,
  uid: string,
  adventureId: string,
  policy: IInviteExpiryPolicy = defaultInviteExpiryPolicy,
): Promise<string> {
  const [adventure] = await db.select({ ownerId: adventures.ownerId })
    .from(adventures).where(eq(adventures.id, adventureId)).limit(1);
  if (!adventure) {
    throwApiError('not-found', 'Adventure not found');
  }
  if (adventure.ownerId !== uid) {
    throwApiError('permission-denied', 'Only the owner can create invites');
  }

  // Return a valid existing invite if one exists and is within the recreate window
  const recreateCutoff = dayjs().subtract(policy.recreate, policy.timeUnit as dayjs.ManipulateType).toDate();
  const existingInvites = await db.select({ id: invites.id, createdAt: invites.createdAt })
    .from(invites)
    .where(and(eq(invites.adventureId, adventureId), gt(invites.expiresAt, new Date())))
    .orderBy(sql`${invites.createdAt} DESC`)
    .limit(1);

  if (existingInvites.length > 0) {
    const inv = existingInvites[0];
    if (inv.createdAt >= recreateCutoff) {
      return inv.id;
    }
  }

  // Create a new invite
  const id = uuidv7();
  const now = dayjs();
  await db.insert(invites).values({
    id,
    adventureId,
    ownerId: uid,
    expiresAt: now.add(policy.expiry, policy.timeUnit as dayjs.ManipulateType).toDate(),
    deleteAt: now.add(policy.deletion, policy.timeUnit as dayjs.ManipulateType).toDate(),
  });

  return id;
}

// ─── Adventure updates ────────────────────────────────────────────────────────

export async function updateAdventure(
  db: Db,
  uid: string,
  adventureId: string,
  fields: { name?: string; description?: string; imagePath?: string },
): Promise<void> {
  await assertAdventureOwner(db, uid, adventureId);
  if (Object.keys(fields).length === 0) return;
  await db.update(adventures)
    .set(fields)
    .where(eq(adventures.id, adventureId));
}

export async function updateMap(
  db: Db,
  uid: string,
  adventureId: string,
  mapId: string,
  fields: { name?: string; description?: string; imagePath?: string; ffa?: boolean },
): Promise<void> {
  await assertAdventureOwner(db, uid, adventureId);
  if (Object.keys(fields).length === 0) return;
  await db.update(maps)
    .set(fields)
    .where(and(eq(maps.id, mapId), eq(maps.adventureId, adventureId)));
}

export async function updatePlayer(
  db: Db,
  uid: string,
  adventureId: string,
  playerId: string,
  fields: { allowed?: boolean; characters?: ICharacter[] },
): Promise<void> {
  if (Object.keys(fields).length === 0) return;

  // Players can update their own characters; only the owner can change `allowed`
  if (uid === playerId && fields.allowed === undefined) {
    await assertAdventureMember(db, uid, adventureId);
  } else {
    await assertAdventureOwner(db, uid, adventureId);
  }

  await db.update(adventurePlayers)
    .set(fields)
    .where(and(
      eq(adventurePlayers.adventureId, adventureId),
      eq(adventurePlayers.userId, playerId),
    ));
}

export async function leaveAdventure(db: Db, uid: string, adventureId: string): Promise<void> {
  const [row] = await db.select({ ownerId: adventures.ownerId })
    .from(adventures)
    .where(eq(adventures.id, adventureId))
    .limit(1);
  if (!row) {
    throwApiError('not-found', 'Adventure not found');
  }
  if (row.ownerId === uid) {
    throwApiError('permission-denied', 'The owner cannot leave their own adventure');
  }
  await db.delete(adventurePlayers)
    .where(and(
      eq(adventurePlayers.adventureId, adventureId),
      eq(adventurePlayers.userId, uid),
    ));
}

// ─── Map changes ─────────────────────────────────────────────────────────────

export async function addMapChanges(
  db: Db,
  uid: string,
  adventureId: string,
  mapId: string,
  chs: Change[],
): Promise<string> {
  await assertAdventureMember(db, uid, adventureId);

  const [mapRow] = await db.select({ id: maps.id })
    .from(maps)
    .where(and(eq(maps.id, mapId), eq(maps.adventureId, adventureId)))
    .limit(1);
  if (!mapRow) {
    throwApiError('not-found', 'Map not found');
  }

  const id = uuidv7();
  const changesDoc: Changes = {
    chs,
    timestamp: Date.now(),
    incremental: true,
    user: uid,
    resync: false,
  };
  await db.insert(mapChanges).values({
    id,
    mapId,
    changes: changesDoc as unknown as object,
    incremental: true,
    resync: false,
    userId: uid,
  });
  return id;
}

// ─── Invites ─────────────────────────────────────────────────────────────────

export async function joinAdventure(
  db: Db,
  uid: string,
  inviteId: string,
  _policy: IInviteExpiryPolicy = defaultInviteExpiryPolicy,
): Promise<string> {
  const [invite] = await db.select({ adventureId: invites.adventureId, expiresAt: invites.expiresAt })
    .from(invites).where(eq(invites.id, inviteId)).limit(1);
  if (!invite) {
    throwApiError('not-found', 'No such invite');
  }
  if (invite.expiresAt < new Date()) {
    throwApiError('deadline-exceeded', 'Invite has expired');
  }

  const adventureId = invite.adventureId;

  return await db.transaction(async (tx) => {
    // Get adventure owner's policy for player cap
    const [adventure] = await tx.select({ ownerId: adventures.ownerId, name: adventures.name })
      .from(adventures).where(eq(adventures.id, adventureId)).limit(1);
    if (!adventure) {
      throwApiError('not-found', 'No such adventure');
    }

    const [ownerResult, countResult, joiningResult] = await Promise.all([
      tx.select({ level: users.level })
        .from(users).where(eq(users.id, adventure.ownerId)).limit(1),
      tx.select({ playerCount: count() })
        .from(adventurePlayers)
        .where(and(eq(adventurePlayers.adventureId, adventureId), eq(adventurePlayers.allowed, true))),
      tx.select({ name: users.name })
        .from(users).where(eq(users.id, uid)).limit(1),
    ]);

    const [ownerUser] = ownerResult;
    const ownerPolicy = getUserPolicy((ownerUser?.level ?? 'standard') as UserLevel);
    const [{ playerCount }] = countResult;
    if (Number(playerCount) >= ownerPolicy.players) {
      throwApiError('permission-denied', 'This adventure already has the maximum number of players');
    }

    const [joiningUser] = joiningResult;
    if (!joiningUser) {
      throwApiError('not-found', 'No profile for this user');
    }

    // Upsert player record
    await tx.insert(adventurePlayers)
      .values({
        adventureId,
        userId: uid,
        playerName: joiningUser.name,
        allowed: true,
        characters: [],
      })
      .onConflictDoUpdate({
        target: [adventurePlayers.adventureId, adventurePlayers.userId],
        set: { playerName: joiningUser.name, allowed: true },
      });

    return adventureId;
  });
}
