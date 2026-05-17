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
  createTokenAdd,
  createTokenRemove,
  IUserPolicy,
  UserLevel,
  ICharacter,
  IStorage,
  ILogger,
  getSpritePathFromId,
} from '@wallandshadow/shared';
import { throwApiError } from '../errors.js';
import { Db } from '../db/connection.js';
import {
  notifyMapChange,
  notifyAdventuresUser,
  notifyAdventuresUsers,
  notifyAdventurePlayers,
  notifyAdventureDetail,
  notifyAdventureSpritesheets,
  notifySafe,
} from '../ws/notify.js';
import {
  adventures,
  adventurePlayers,
  maps,
  mapChanges,
  mapImages,
  images,
  invites,
  spritesheets,
  users,
} from '../db/schema.js';
import { eq, and, count, sql, inArray, gt, or, isNull } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import dayjs from 'dayjs';

// ─── Shared query helpers ────────────────────────────────────────────────────

function buildMapChangeTracker(m: IMap, ownerPolicy: IUserPolicy | undefined) {
  const tokens = new Tokens(getTokenGeometry(m.ty), new SimpleTokenDrawing());
  const outlineTokens = new Tokens(getTokenGeometry(m.ty), new SimpleTokenDrawing());
  const tracker = new SimpleChangeTracker(
    new FeatureDictionary<GridCoord, StripedArea>(coordString),
    new FeatureDictionary<GridCoord, StripedArea>(coordString),
    tokens,
    outlineTokens,
    new FeatureDictionary<GridEdge, IFeature<GridEdge>>(edgeString),
    new FeatureDictionary<GridCoord, IAnnotation>(coordString),
    new IdDictionary<IMapImage>(),
    ownerPolicy,
  );
  return { tracker, tokens };
}

async function reconcileTokenSprites(
  tx: Pick<Db, 'select'>,
  mapId: string,
  consolidated: Change[],
): Promise<Change[]> {
  const sheetRows = await tx.select({ sprites: spritesheets.sprites })
    .from(spritesheets)
    .innerJoin(maps, eq(maps.adventureId, spritesheets.adventureId))
    .where(and(eq(maps.id, mapId), isNull(spritesheets.supersededBy)));
  const validSpritePaths = new Set(
    sheetRows.flatMap(r => (r.sprites as string[]).filter(p => p !== '')),
  );
  return consolidated.map(ch => {
    if (ch.cat !== ChangeCategory.Token || ch.ty !== ChangeType.Add) return ch;
    const filteredSprites = ch.feature.sprites.filter(s => validSpritePaths.has(s.source));
    if (filteredSprites.length === ch.feature.sprites.length) return ch;
    return { ...ch, feature: { ...ch.feature, sprites: filteredSprites } };
  });
}

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
type MapChangesTx = Pick<Db, 'insert' | 'delete' | 'select' | 'execute'>;

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

// ─── S3 cleanup helpers ──────────────────────────────────────────────────────

// Best-effort batch delete of S3 objects after a successful DB delete. Failures
// are logged at warning level and never thrown — an orphaned S3 object is
// preferable to rolling back a committed DB delete. Note that the DB rows that
// named these paths are already gone by this point, so a failure here is not
// automatically recoverable: the warning log is the only surviving record of
// the leak. For the GDPR-critical account-deletion path use auditedDeleteS3
// instead, which logs orphans at Error level with re-runnable markers.
async function bestEffortDeleteS3(
  storage: IStorage,
  logger: ILogger,
  paths: string[],
  context: string,
): Promise<void> {
  try {
    const { failed } = await storage.deleteMany(paths);
    for (const f of failed) {
      logger.logWarning(`Failed to delete S3 object ${f.path} during ${context}: ${f.message}`);
    }
  } catch (e) {
    logger.logWarning(`S3 batch delete threw during ${context} (paths: ${paths.length})`, e);
  }
}

// S3 cleanup for account deletion. Unlike bestEffortDeleteS3, failures here are
// logged at Error level: orphaned uploads left behind by a GDPR erasure are a
// data-protection event, not a tolerable inconsistency. Each leaked path is
// logged on its own line with a stable `ORPHANED_S3_OBJECT` marker so an
// operator can grep the error log to recover the full path list and re-run the
// delete manually — S3 DELETE is idempotent for missing keys, so a re-run is
// safe. Like bestEffortDeleteS3 this never throws: the user's DB rows are
// already gone, so the erasure itself has succeeded regardless.
async function auditedDeleteS3(
  storage: IStorage,
  logger: ILogger,
  paths: string[],
  uid: string,
): Promise<void> {
  if (paths.length === 0) {
    return;
  }
  try {
    const { failed } = await storage.deleteMany(paths);
    for (const f of failed) {
      logger.logError(
        `ORPHANED_S3_OBJECT context=user-delete uid=${uid} path=${f.path} — ${f.message}`,
      );
    }
  } catch (e) {
    // A whole-batch throw can leave any path orphaned (deleteMany processes in
    // chunks, and we cannot tell which chunks committed). Report every path:
    // over-reporting is harmless because the re-run is idempotent.
    for (const path of paths) {
      logger.logError(`ORPHANED_S3_OBJECT context=user-delete uid=${uid} path=${path}`);
    }
    logger.logError(
      `S3 batch delete threw during account deletion for uid ${uid} ` +
      `(${paths.length} path(s) potentially orphaned)`,
      e,
    );
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

  await notifySafe(notifyAdventuresUser(uid));
  return id;
}

export async function deleteAdventure(
  db: Db,
  storage: IStorage,
  logger: ILogger,
  uid: string,
  adventureId: string,
): Promise<void> {
  const [adventure] = await db.select({ ownerId: adventures.ownerId })
    .from(adventures).where(eq(adventures.id, adventureId)).limit(1);

  if (!adventure) {
    throwApiError('not-found', 'Adventure not found');
  }
  if (adventure.ownerId !== uid) {
    throwApiError('not-found', 'Adventure not found');
  }

  // Capture members + spritesheet ids now: CASCADE wipes the rows, so we need
  // their identities before the delete to notify members and clean up the
  // spritesheet PNGs in S3.
  const [memberRows, sheetRows] = await Promise.all([
    db.select({ userId: adventurePlayers.userId })
      .from(adventurePlayers)
      .where(eq(adventurePlayers.adventureId, adventureId)),
    db.select({ id: spritesheets.id })
      .from(spritesheets)
      .where(eq(spritesheets.adventureId, adventureId)),
  ]);

  // CASCADE handles maps, map_changes, adventure_players, spritesheets, invites
  await db.delete(adventures).where(eq(adventures.id, adventureId));

  await bestEffortDeleteS3(
    storage,
    logger,
    sheetRows.map(r => getSpritePathFromId(r.id)),
    'adventure delete',
  );

  await notifySafe(notifyAdventuresUsers(memberRows.map(r => r.userId)));
}

// ─── User account deletion ───────────────────────────────────────────────────

export async function deleteUser(
  db: Db,
  storage: IStorage,
  logger: ILogger,
  uid: string,
): Promise<void> {
  // Pre-transaction snapshots: we need recipient ids and S3 paths after the
  // rows are gone, so capture them before the DELETE runs. Spritesheets are
  // captured so we can clean up their PNGs after CASCADE wipes the rows when
  // the user's adventures are deleted.
  const [imageRows, sheetRows, coMemberRows, otherAdventureRows] = await Promise.all([
    db.select({ path: images.path })
      .from(images).where(eq(images.userId, uid)),
    db.select({ id: spritesheets.id })
      .from(spritesheets)
      .innerJoin(adventures, eq(adventures.id, spritesheets.adventureId))
      .where(eq(adventures.ownerId, uid)),
    db.select({ userId: adventurePlayers.userId })
      .from(adventurePlayers)
      .innerJoin(adventures, eq(adventures.id, adventurePlayers.adventureId))
      .where(eq(adventures.ownerId, uid)),
    db.select({ adventureId: adventurePlayers.adventureId })
      .from(adventurePlayers).where(eq(adventurePlayers.userId, uid)),
  ]);
  const imagePaths = imageRows.map(r => r.path);
  const sheetPaths = sheetRows.map(r => getSpritePathFromId(r.id));
  const coMemberIds = Array.from(new Set(coMemberRows.map(r => r.userId)));
  const otherAdventureIds = otherAdventureRows.map(r => r.adventureId);

  const affectedSheetAdventureIds = new Set<string>();
  await db.transaction(async (tx) => {
    await tx.delete(adventures).where(eq(adventures.ownerId, uid));
    await tx.delete(adventurePlayers).where(eq(adventurePlayers.userId, uid));
    await tx.delete(invites).where(eq(invites.ownerId, uid));
    // Scrub stale references to this user's images from other adventures the
    // user was a member of. Without this, spritesheets, map_images, and map
    // backgrounds in those adventures keep pointing at paths whose S3 objects
    // and images rows are about to vanish — extending a spritesheet that holds
    // such a reference then 500s when createMontage tries to download it.
    if (imagePaths.length > 0) {
      await tx.update(adventures).set({ imagePath: '' })
        .where(inArray(adventures.imagePath, imagePaths));
      await tx.update(maps).set({ imagePath: '' })
        .where(inArray(maps.imagePath, imagePaths));
      await tx.delete(mapImages).where(inArray(mapImages.path, imagePaths));

      // One indexed lookup for every sheet referencing any of the user's
      // images, rather than a containment query per path. Each `@>` clause is
      // served by the GIN index on `spritesheets.sprites`; the planner
      // BitmapOr's them.
      const pathSet = new Set(imagePaths);
      const sheetRowsToScrub = await tx.select({
        id: spritesheets.id,
        adventureId: spritesheets.adventureId,
        sprites: spritesheets.sprites,
        freeSpaces: spritesheets.freeSpaces,
      })
        .from(spritesheets)
        .where(or(...imagePaths.map(p =>
          sql`${spritesheets.sprites} @> ${JSON.stringify([p])}::jsonb`)));

      for (const row of sheetRowsToScrub) {
        const sprites = row.sprites as string[];
        let freed = 0;
        const newSprites = sprites.map(s => {
          if (pathSet.has(s)) { freed += 1; return ''; }
          return s;
        });
        if (freed === 0) continue; // defensive — every returned row should match
        await tx.update(spritesheets)
          .set({ sprites: newSprites as unknown as object, freeSpaces: row.freeSpaces + freed })
          .where(eq(spritesheets.id, row.id));
        affectedSheetAdventureIds.add(row.adventureId);
      }
    }
    // NULL preserves the change row + history while releasing the FK so the
    // user can be deleted.
    await tx.update(mapChanges).set({ userId: null }).where(eq(mapChanges.userId, uid));
    await tx.delete(users).where(eq(users.id, uid));
  });

  await auditedDeleteS3(storage, logger, [...imagePaths, ...sheetPaths], uid);

  await notifySafe(
    notifyAdventuresUsers(coMemberIds),
    ...otherAdventureIds.map(id => notifyAdventurePlayers(id)),
    ...Array.from(affectedSheetAdventureIds).map(id => notifyAdventureSpritesheets(id)),
  );
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
  enableGroupVision: boolean,
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

    await tx.insert(maps).values({ id, adventureId, name, description, ty, ffa, enableGroupVision, imagePath: '' });
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
    enableGroupVision: existingMap.enableGroupVision,
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
      enableGroupVision: existingMap.enableGroupVision,
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

    const [user] = await tx.select({ level: users.level })
      .from(users).where(eq(users.id, m.owner)).limit(1);
    const ownerPolicy = getUserPolicy((user?.level ?? 'standard') as UserLevel);

    const { tracker, tokens: tokenDict } = buildMapChangeTracker(m, ownerPolicy);

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

    // Belt-and-braces against the `scrubMapSpriteReferences` race: a concurrent
    // TokenMove between the scrub's read and write can leave a token still
    // referencing a sprite path that's been removed from every spritesheet.
    // Skip the work entirely when no consolidated token carries any sprites.
    const hasTokenSprites = consolidated.some(
      ch => ch.cat === ChangeCategory.Token && ch.ty === ChangeType.Add && ch.feature.sprites.length > 0,
    );
    const reconciled: Change[] = hasTokenSprites
      ? await reconcileTokenSprites(tx, mapId, consolidated)
      : consolidated;

    // Use the adventure owner as the consolidated-state author — the base change
    // contains all users' changes merged together, and trackChanges enforces
    // ownership (e.g. only the owner can edit areas). Using the consolidator's UID
    // would cause trackChange to reject owner-only operations when a player triggers
    // consolidation.
    const newBaseChange: Changes = {
      chs: reconciled,
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
    await notifySafe(notifyMapChange(mapId, notifyInfo.id, notifyInfo.seq));
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

  // CASCADE handles map_changes and map_images. No S3 cleanup here: every
  // image referenced by a map (background, placed images, token sprites) is a
  // user-owned object in the images table that survives the map and is only
  // collected when the user is deleted.
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
  fields: { name?: string; description?: string; imagePath?: string; ffa?: boolean; enableGroupVision?: boolean },
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

// FOR UPDATE on the adventurePlayers row serialises concurrent edits on
// the same player; without it, two concurrent character upserts both read
// the pre-change array and the second write loses one of the characters.
export async function upsertCharacter(
  db: Db,
  uid: string,
  adventureId: string,
  playerId: string,
  character: ICharacter,
): Promise<void> {
  // Players can edit their own characters; the owner can edit anyone's.
  if (uid === playerId) {
    await assertAdventureMember(db, uid, adventureId);
  } else {
    await assertAdventureOwner(db, uid, adventureId);
  }

  await db.transaction(async (tx) => {
    const [row] = await tx.select({ characters: adventurePlayers.characters })
      .from(adventurePlayers)
      .where(and(
        eq(adventurePlayers.adventureId, adventureId),
        eq(adventurePlayers.userId, playerId),
      ))
      .for('update')
      .limit(1);
    if (!row) {
      throwApiError('not-found', 'Player not found');
    }

    const existing = (row.characters as ICharacter[]) ?? [];
    const idx = existing.findIndex(c => c.id === character.id);
    const next = idx >= 0
      ? existing.map((c, i) => i === idx ? { ...c, ...character } : c)
      : [...existing, character];

    await tx.update(adventurePlayers)
      .set({ characters: next as unknown as object })
      .where(and(
        eq(adventurePlayers.adventureId, adventureId),
        eq(adventurePlayers.userId, playerId),
      ));
  });

  await notifySafe(
    notifyAdventurePlayers(adventureId),
    notifyAdventuresUser(playerId),
  );
}

// Same FOR-UPDATE pattern as upsertCharacter. No-op (still 204) when the
// character isn't present so DELETE is idempotent.
export async function removeCharacter(
  db: Db,
  uid: string,
  adventureId: string,
  playerId: string,
  characterId: string,
): Promise<void> {
  if (uid === playerId) {
    await assertAdventureMember(db, uid, adventureId);
  } else {
    await assertAdventureOwner(db, uid, adventureId);
  }

  const changed = await db.transaction(async (tx) => {
    const [row] = await tx.select({ characters: adventurePlayers.characters })
      .from(adventurePlayers)
      .where(and(
        eq(adventurePlayers.adventureId, adventureId),
        eq(adventurePlayers.userId, playerId),
      ))
      .for('update')
      .limit(1);
    if (!row) {
      throwApiError('not-found', 'Player not found');
    }

    const existing = (row.characters as ICharacter[]) ?? [];
    const next = existing.filter(c => c.id !== characterId);
    if (next.length === existing.length) return false;

    await tx.update(adventurePlayers)
      .set({ characters: next as unknown as object })
      .where(and(
        eq(adventurePlayers.adventureId, adventureId),
        eq(adventurePlayers.userId, playerId),
      ));
    return true;
  });

  if (!changed) return;

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

/**
 * Inserts one incremental map-change row inside an existing transaction.
 * Callers — `addMapChanges` (the live WebSocket submission path) and
 * `scrubMapSpriteReferences` (image-deletion cleanup) — are responsible for
 * auth/map-existence checks and for firing notifyMapChange after commit (the
 * lock is shared so its ordering relative to consolidation's exclusive lock
 * is preserved, but commit must finish before clients are notified).
 */
export async function insertMapChangesInTx(
  tx: MapChangesTx,
  uid: string,
  mapId: string,
  chs: Change[],
  idempotencyKey?: string,
): Promise<{ id: string; seq: string }> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock_shared(hashtext(${mapId}))`);

  const changesDoc: Changes = {
    chs,
    incremental: true,
    user: uid,
    resync: false,
  };

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
}

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

  const result = await db.transaction(async (tx) =>
    insertMapChangesInTx(tx, uid, mapId, chs, idempotencyKey),
  );

  await notifySafe(notifyMapChange(mapId, result.id, result.seq));
  return result;
}

/**
 * The cleanup batch is attributed to the adventure owner so the change
 * tracker's permission checks accept it (a player not on this map may
 * have authored the original TokenAdd). Uses only the shared advisory
 * lock: a concurrent TokenMove between read and write may make the
 * cleanup batch fail to apply during the next consolidation — an accepted
 * race for what is otherwise an interactive operation.
 */
export async function scrubMapSpriteReferences(
  tx: MapChangesTx,
  mapId: string,
  spritePath: string,
): Promise<{ id: string; seq: string } | undefined> {
  const [row] = await tx.select({
    name: maps.name,
    description: maps.description,
    ty: maps.ty,
    ffa: maps.ffa,
    enableGroupVision: maps.enableGroupVision,
    imagePath: maps.imagePath,
    adventureName: adventures.name,
    ownerId: adventures.ownerId,
  })
    .from(maps)
    .innerJoin(adventures, eq(adventures.id, maps.adventureId))
    .where(eq(maps.id, mapId))
    .limit(1);
  if (!row) return undefined;

  const m: IMap = {
    adventureName: row.adventureName,
    name: row.name,
    description: row.description,
    owner: row.ownerId,
    ty: row.ty as MapType,
    ffa: row.ffa,
    enableGroupVision: row.enableGroupVision,
    imagePath: row.imagePath,
  };

  const [baseRow] = await tx.select({ changes: mapChanges.changes })
    .from(mapChanges)
    .where(and(eq(mapChanges.mapId, mapId), eq(mapChanges.isBase, true)))
    .limit(1);
  const incRows = await tx.select({ changes: mapChanges.changes })
    .from(mapChanges)
    .where(and(eq(mapChanges.mapId, mapId), eq(mapChanges.isBase, false)))
    .orderBy(mapChanges.seq);

  const { tracker } = buildMapChangeTracker(m, undefined);
  const converter = createChangesConverter();
  if (baseRow) {
    const baseChange = converter.convert(baseRow.changes as Record<string, unknown>);
    trackChanges(m, tracker, baseChange.chs, baseChange.user);
  }
  for (const r of incRows) {
    const ch = converter.convert(r.changes as Record<string, unknown>);
    trackChanges(m, tracker, ch.chs, ch.user);
  }

  const cleanupChs: Change[] = [];
  for (const ch of tracker.getConsolidated()) {
    if (ch.cat !== ChangeCategory.Token || ch.ty !== ChangeType.Add) continue;
    const token = ch.feature;
    if (!token.sprites.some(s => s.source === spritePath)) continue;
    cleanupChs.push(createTokenRemove(token.position, token.id));
    cleanupChs.push(createTokenAdd({
      ...token,
      sprites: token.sprites.filter(s => s.source !== spritePath),
    }));
  }

  if (cleanupChs.length === 0) return undefined;
  return insertMapChangesInTx(tx, row.ownerId, mapId, cleanupChs);
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
    // FOR UPDATE serialises concurrent joins to this adventure: without it,
    // two joiners can both pass the cap check at READ COMMITTED and both insert.
    const [adventure] = await tx.select({ ownerId: adventures.ownerId, name: adventures.name })
      .from(adventures).where(eq(adventures.id, adventureId)).for('update').limit(1);
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
