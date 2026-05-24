import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import type { Db } from '../db/connection.js';
import {
  adventurePlayers,
  adventures,
  images,
  maps,
  spritesheets,
  users,
} from '../db/schema.js';
import { throwApiError } from '../errors.js';
import {
  notifyAdventurePlayers,
  notifyAdventureSpritesheets,
  notifyAdventuresUsers,
  notifySafe,
} from '../ws/notify.js';
import { disconnectBannedUser } from '../ws/socketState.js';
import { scrubUserFootprint, auditedQuarantineS3 } from './extensions.js';
import { findUserSummary } from './adminExtensions.js';
import {
  getSpritePathFromId,
  UserLevel,
  type IAdminUserSummary,
  type ILogger,
  type IStorage,
} from '@wallandshadow/shared';

// Marks a user as banned, soft-deletes their content, quarantines their S3
// objects, scrubs references to their images from other users' content, and
// disconnects their live WebSocket connections. Idempotent against double
// invocation only insofar as the guard rejects it: a partial first run is
// not transparently resumable — the post-tx S3 quarantine is best-effort
// and logs orphans for manual recovery.
export async function banUser(
  db: Db,
  storage: IStorage,
  logger: ILogger,
  adminUid: string,
  targetUid: string,
): Promise<IAdminUserSummary> {
  // ── Guards (pre-write) ────────────────────────────────────────────────
  const [target] = await db
    .select({ id: users.id, level: users.level, bannedAt: users.bannedAt })
    .from(users)
    .where(eq(users.id, targetUid))
    .limit(1);
  if (!target) {
    throwApiError('not-found', 'User not found');
  }
  if (targetUid === adminUid) {
    throwApiError('invalid-argument', 'Cannot ban yourself');
  }
  if (target.level === UserLevel.Admin) {
    throwApiError('invalid-argument', 'Cannot ban an admin; demote first');
  }
  if (target.bannedAt) {
    throwApiError('already-exists', 'User is already banned');
  }

  // ── Pre-transaction snapshots ────────────────────────────────────────
  // We need the target's adventure ids and spritesheet ids for S3 quarantine,
  // plus the recipient sets for post-commit notification.
  const [ownAdventureRows, sheetRows, coMemberRows, otherAdventureRows] =
    await Promise.all([
      db.select({ id: adventures.id })
        .from(adventures).where(eq(adventures.ownerId, targetUid)),
      db.select({ id: spritesheets.id })
        .from(spritesheets)
        .innerJoin(adventures, eq(adventures.id, spritesheets.adventureId))
        .where(eq(adventures.ownerId, targetUid)),
      db.select({ userId: adventurePlayers.userId })
        .from(adventurePlayers)
        .innerJoin(adventures, eq(adventures.id, adventurePlayers.adventureId))
        .where(and(
          eq(adventures.ownerId, targetUid),
          // Exclude the target's own membership so we don't notify them.
          ne(adventurePlayers.userId, targetUid),
        )),
      // Adventures where the target is a member but NOT the owner. Unlike
      // deleteUser (which can include self-owned because they've already
      // been deleted), banUser soft-deletes the target's own adventures and
      // signals their co-members via notifyAdventuresUsers, so they don't
      // belong in this list.
      db.select({ adventureId: adventurePlayers.adventureId })
        .from(adventurePlayers)
        .innerJoin(adventures, eq(adventures.id, adventurePlayers.adventureId))
        .where(and(
          eq(adventurePlayers.userId, targetUid),
          ne(adventures.ownerId, targetUid),
        )),
    ]);

  const targetAdventureIds = ownAdventureRows.map(r => r.id);
  const sheetIds = sheetRows.map(r => r.id);
  const coMemberIds = Array.from(new Set(coMemberRows.map(r => r.userId)));
  const otherAdventureIds = otherAdventureRows.map(r => r.adventureId);

  // ── Transaction ──────────────────────────────────────────────────────
  const { imagePaths, affectedSheetAdventureIds } =
    await db.transaction(async (tx) => {
      const now = new Date();
      await tx.update(users).set({ bannedAt: now }).where(eq(users.id, targetUid));
      await tx.update(adventures).set({ deletedAt: now })
        .where(eq(adventures.ownerId, targetUid));
      if (targetAdventureIds.length > 0) {
        await tx.update(maps).set({ deletedAt: now })
          .where(inArray(maps.adventureId, targetAdventureIds));
      }

      // UPDATE … RETURNING gives us exactly the set of paths the in-tx UPDATE
      // rewrote. Driving the S3 quarantine from this set (rather than a pre-tx
      // snapshot) closes the race where a target's concurrent image upload
      // commits between the snapshot and the UPDATE: any such row is matched
      // by the UPDATE's `userId = targetUid` predicate and therefore appears
      // in the returning result here.
      const updatedImages = await tx.update(images).set({
        deletedAt: now,
        path: sql`regexp_replace(${images.path}, '^images/', 'quarantine/')`,
      })
      .where(eq(images.userId, targetUid))
      .returning({ newPath: images.path });

      // RETURNING gives the post-UPDATE (quarantine/…) path; the S3 source we
      // need to copy *from* is the original images/… path. Reversing the prefix
      // is sound because the upload handler always writes paths with the
      // `images/` prefix, so every row updated here started there.
      const imagePaths = updatedImages.map(r =>
        r.newPath.replace(/^quarantine\//, 'images/'));

      // Scrub footprint using the ORIGINAL image paths — those are still
      // what's stored on other users' adventures/maps/spritesheets/mapImages.
      const affected = await scrubUserFootprint(tx, targetUid, imagePaths);
      return { imagePaths, affectedSheetAdventureIds: affected };
    });

  // ── Post-transaction S3 quarantine ───────────────────────────────────
  const imagePairs = imagePaths.map(src => ({
    src,
    dst: src.replace(/^images\//, 'quarantine/'),
  }));
  const sheetPairs = sheetIds.map(id => {
    const src = getSpritePathFromId(id);
    return { src, dst: `quarantine/${src}` };
  });
  await auditedQuarantineS3(
    storage, logger, [...imagePairs, ...sheetPairs], 'user-ban', targetUid,
  );

  // ── Disconnect live WebSocket connections ────────────────────────────
  disconnectBannedUser(targetUid);

  // ── Notify ───────────────────────────────────────────────────────────
  // Matches deleteUser's pattern: co-members of the (now-soft-deleted)
  // adventures re-fetch their adventure list and see them vanish; players
  // in other adventures see the target removed from the player list;
  // affected spritesheets get re-fetched.
  await notifySafe(
    notifyAdventuresUsers(coMemberIds),
    ...otherAdventureIds.map(id => notifyAdventurePlayers(id)),
    ...Array.from(affectedSheetAdventureIds).map(id => notifyAdventureSpritesheets(id)),
  );

  // Return the updated summary. The bannedAt field reflects the ban.
  const summary = await findUserSummary(db, targetUid);
  if (!summary) {
    // Cannot happen under normal operation — the row was just updated above.
    // Log here so the unrecoverable case appears in the audit trail even if
    // the route layer swallows the HTTPException.
    logger.logError(`banUser: target uid=${targetUid} vanished between transaction commit and summary read`);
    throwApiError('internal', 'Banned user vanished');
  }
  return summary;
}
