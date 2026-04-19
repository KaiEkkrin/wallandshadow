import {
  Change,
  ChangeCategory,
  ChangeType,
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
  notifyMapChange,
  notifyAdventuresUser,
  notifyAdventuresUsers,
  notifyAdventurePlayers,
  notifyAdventureDetail,
  notifySafe,
} from '../ws/notify.js';
import {
  adventures,
  adventurePlayers,
  maps,
  mapChanges,
  mapImages,
  invites,
  users,
} from '../db/schema.js';
import { eq, and, count, sql, inArray, gt } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import dayjs from 'dayjs';

// ─── Shared query helpers ────────────────────────────────────────────────────

/** Fetch base and incremental map changes in parallel. */
export async function fetchMapChanges(db: Db, mapId: string) {
  const [baseRows, incrementalRows] = await Promise.all([
    db.select({ id: mapChanges.id, seq: mapChanges.seq, changes: mapChanges.changes })
      .from(mapChanges)
      .where(and(eq(mapChanges.mapId, mapId), eq(mapChanges.isBase, true)))
      .limit(1),
    db.select({ id: mapChanges.id, seq: mapChanges.seq, changes: mapChanges.changes })
      .from(mapChanges)
      .where(and(eq(mapChanges.mapId, mapId), eq(mapChanges.isBase, false)))
      .orderBy(mapChanges.seq),
  ]);
  return { baseRow: baseRows[0] as { id: string; seq: bigint; changes: unknown } | undefined, incrementalRows };
}

// ─── Map images junction ─────────────────────────────────────────────────────

// The map_images junction materialises "which images are placed on which map"
// so that the image download permission check can authorise adventure members
// without scanning map_changes JSONB at request time.

function extractImagePaths(chs: Change[]): string[] {
  const paths = new Set<string>();
  for (const ch of chs) {
    if (ch.cat === ChangeCategory.Image && ch.ty === ChangeType.Add) {
      const path = ch.feature.image.path;
      if (path) paths.add(path);
    }
  }
  return Array.from(paths);
}

// Accept both the top-level Db and a transaction scope.
type DbOrTx = Pick<Db, 'insert' | 'delete'>;

async function syncMapImagesFromChanges(
  tx: DbOrTx,
  mapId: string,
  chs: Change[],
): Promise<void> {
  const paths = extractImagePaths(chs);
  if (paths.length === 0) return;
  await tx.insert(mapImages)
    .values(paths.map(path => ({ mapId, path })))
    .onConflictDoNothing();
}

async function replaceMapImages(
  tx: DbOrTx,
  mapId: string,
  chs: Change[],
): Promise<void> {
  await tx.delete(mapImages).where(eq(mapImages.mapId, mapId));
  const paths = extractImagePaths(chs);
  if (paths.length === 0) return;
  await tx.insert(mapImages).values(paths.map(path => ({ mapId, path })));
}

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
    // Return 404 to avoid leaking whether the adventure exists (RFC 9110 §15.5.4)
    throwApiError('not-found', 'Adventure not found');
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
  if (row.ownerId === uid) return;

  // Check if user is at least a member — members get 403 (they know it exists),
  // non-members get 404 to avoid leaking existence
  const [playerRow] = await db.select({ allowed: adventurePlayers.allowed })
    .from(adventurePlayers)
    .where(and(
      eq(adventurePlayers.adventureId, adventureId),
      eq(adventurePlayers.userId, uid),
      eq(adventurePlayers.allowed, true),
    ))
    .limit(1);

  if (playerRow) {
    throwApiError('permission-denied', 'Only the adventure owner can perform this action');
  }
  throwApiError('not-found', 'Adventure not found');
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

  await notifySafe(notifyAdventuresUser(uid));
  return id;
}

export async function deleteAdventure(db: Db, uid: string, adventureId: string): Promise<void> {
  const [adventure] = await db.select({ ownerId: adventures.ownerId })
    .from(adventures).where(eq(adventures.id, adventureId)).limit(1);

  if (!adventure) {
    throwApiError('not-found', 'Adventure not found');
  }
  if (adventure.ownerId !== uid) {
    throwApiError('not-found', 'Adventure not found');
  }

  // Capture members now so we can notify them after CASCADE wipes the rows.
  const memberRows = await db.select({ userId: adventurePlayers.userId })
    .from(adventurePlayers)
    .where(eq(adventurePlayers.adventureId, adventureId));

  // CASCADE handles maps, map_changes, adventure_players, spritesheets, invites
  await db.delete(adventures).where(eq(adventures.id, adventureId));

  await notifySafe(notifyAdventuresUsers(memberRows.map(r => r.userId)));
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
      throwApiError('not-found', 'Adventure not found');
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

  await notifySafe(notifyAdventureDetail(adventureId));
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
      throwApiError('not-found', 'Adventure not found');
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
      await tx.insert(mapChanges).values({
        id: uuidv7(),
        mapId: id,
        changes: baseChange as unknown as object,
        isBase: true,
        resync: baseChange.resync ?? false,
        userId: uid,
      });
      await syncMapImagesFromChanges(tx, id, baseChange.chs);
    }
  });

  await notifySafe(notifyAdventureDetail(adventureId));
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

  // All reads and writes happen inside a single transaction. The exclusive
  // advisory lock (acquired first, released on commit) prevents concurrent
  // writes from getting a seq lower than the new base's seq, which would
  // strand those incrementals on connected clients.
  const txResult = await db.transaction(async (tx): Promise<ConsolidateResult & { notifyInfo?: { id: string; seq: string } }> => {
    const lockRows = await tx.execute(
      sql`SELECT pg_try_advisory_xact_lock(hashtext(${mapId})) AS acquired`,
    );
    const acquired = (lockRows.rows[0] as { acquired: boolean }).acquired;
    if (!acquired) return { baseChange: undefined, isNew: false };

    const baseRows = await tx.select({ id: mapChanges.id, seq: mapChanges.seq, changes: mapChanges.changes })
      .from(mapChanges)
      .where(and(eq(mapChanges.mapId, mapId), eq(mapChanges.isBase, true)))
      .limit(1);
    const baseRow = baseRows[0];
    const baseChange: Changes | undefined = baseRow
      ? converter.convert(baseRow.changes as Record<string, unknown>)
      : undefined;

    // Fetch up to 499 incremental changes ordered by seq
    const incrementalRows = await tx.select({ id: mapChanges.id, changes: mapChanges.changes })
      .from(mapChanges)
      .where(and(eq(mapChanges.mapId, mapId), eq(mapChanges.isBase, false)))
      .orderBy(mapChanges.seq)
      .limit(499);

    if (incrementalRows.length === 0) {
      return { baseChange, isNew: false };
    }

    // Look up owner policy for object cap
    const [user] = await tx.select({ level: users.level })
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

    // Use the adventure owner as the consolidated-state author — the base change
    // contains all users' changes merged together, and trackChanges enforces
    // ownership (e.g. only the owner can edit areas). Using the consolidator's UID
    // would cause trackChange to reject owner-only operations when a player triggers
    // consolidation.
    const newBaseChange: Changes = {
      chs: consolidated,
      incremental: false,
      user: m.owner,
      resync: isResync,
    };

    let returning: { id: string; seq: bigint }[];
    if (baseRow) {
      returning = await tx.update(mapChanges)
        .set({ changes: newBaseChange as unknown as object, resync: isResync, userId: uid })
        .where(eq(mapChanges.id, baseRow.id))
        .returning({ id: mapChanges.id, seq: mapChanges.seq });
    } else {
      // First consolidation: fresh UUID, not the map ID.
      returning = await tx.insert(mapChanges).values({
        id: uuidv7(),
        mapId,
        changes: newBaseChange as unknown as object,
        isBase: true,
        resync: isResync,
        userId: uid,
      }).returning({ id: mapChanges.id, seq: mapChanges.seq });
    }

    const returnedRow = returning[0];
    if (!returnedRow) throwApiError('internal', 'Failed to write consolidated base change');

    // Delete the processed incremental rows
    const ids = incrementalRows.map(r => r.id);
    await tx.delete(mapChanges).where(inArray(mapChanges.id, ids));

    // Rebuild the map_images junction to match the new consolidated base.
    // Images that were added but then removed between consolidations drop
    // out here, which revokes access for non-owners.
    await replaceMapImages(tx, mapId, consolidated);

    return { baseChange: newBaseChange, isNew: true, notifyInfo: { id: returnedRow.id, seq: returnedRow.seq.toString() } };
  });

  const { notifyInfo, baseChange, isNew } = txResult;
  if (notifyInfo) {
    await notifyMapChange(mapId, notifyInfo.id, notifyInfo.seq).catch(e =>
      console.error('NOTIFY failed:', e),
    );
  }

  return { baseChange, isNew };
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
    throwApiError('not-found', 'Adventure not found');
  }

  // CASCADE handles map_changes
  await db.delete(maps).where(and(eq(maps.id, mapId), eq(maps.adventureId, adventureId)));

  await notifySafe(notifyAdventureDetail(adventureId));
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
    throwApiError('not-found', 'Adventure not found');
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

  const memberRows = await db.select({ userId: adventurePlayers.userId })
    .from(adventurePlayers)
    .where(eq(adventurePlayers.adventureId, adventureId));
  await notifySafe(
    notifyAdventuresUsers(memberRows.map(r => r.userId)),
    notifyAdventurePlayers(adventureId),
    notifyAdventureDetail(adventureId),
  );
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

  await notifySafe(notifyAdventureDetail(adventureId));
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

  await notifySafe(
    notifyAdventurePlayers(adventureId),
    notifyAdventuresUser(playerId),
  );
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

  await notifySafe(
    notifyAdventurePlayers(adventureId),
    notifyAdventuresUser(uid),
  );
}

// ─── Map changes ─────────────────────────────────────────────────────────────

export async function addMapChanges(
  db: Db,
  uid: string,
  adventureId: string,
  mapId: string,
  chs: Change[],
  idempotencyKey?: string,
): Promise<{ id: string; seq: string }> {
  await assertAdventureMember(db, uid, adventureId);

  const [mapRow] = await db.select({ id: maps.id })
    .from(maps)
    .where(and(eq(maps.id, mapId), eq(maps.adventureId, adventureId)))
    .limit(1);
  if (!mapRow) {
    throwApiError('not-found', 'Map not found');
  }

  const changesDoc: Changes = {
    chs,
    incremental: true,
    user: uid,
    resync: false,
  };

  const result = await db.transaction(async (tx) => {
    // Shared advisory lock: compatible with other writes, but blocks if an
    // exclusive consolidation lock is held. Ensures all incrementals get a
    // seq higher than the base row written at the end of consolidation.
    await tx.execute(sql`SELECT pg_advisory_xact_lock_shared(hashtext(${mapId}))`);

    const id = uuidv7();
    const values = {
      id,
      mapId,
      changes: changesDoc as unknown as object,
      isBase: false as const,
      resync: false as const,
      userId: uid,
      ...(idempotencyKey ? { idempotencyKey } : {}),
    };

    let returning: { id: string; seq: bigint }[] = await tx.insert(mapChanges)
      .values(values)
      .onConflictDoNothing()
      .returning({ id: mapChanges.id, seq: mapChanges.seq });

    if (returning.length === 0 && idempotencyKey) {
      // Duplicate submission: fetch the existing row by idempotency key.
      returning = await tx.select({ id: mapChanges.id, seq: mapChanges.seq })
        .from(mapChanges)
        .where(eq(mapChanges.idempotencyKey, idempotencyKey))
        .limit(1);
    }

    const row = returning[0];
    if (!row) throwApiError('internal', 'Failed to insert map change');

    // Record any new placed-image paths so other adventure members can
    // download them. Orphans are reconciled at consolidation time.
    await syncMapImagesFromChanges(tx, mapId, chs);

    return { id: row.id, seq: row.seq.toString() };
  });

  await notifySafe(notifyMapChange(mapId, result.id, result.seq));
  return result;
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

  const joinedAdventureId = await db.transaction(async (tx) => {
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

  await notifySafe(
    notifyAdventurePlayers(joinedAdventureId),
    notifyAdventuresUser(uid),
  );

  return joinedAdventureId;
}
