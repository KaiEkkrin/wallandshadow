import { count, eq } from 'drizzle-orm';
import type { Db } from '../db/connection.js';
import { adventures, images, maps, users } from '../db/schema.js';
import { throwApiError } from '../errors.js';
import {
  MapType,
  UserLevel,
  type IAdminUserDetail,
  type IAdminUserSummary,
} from '@wallandshadow/shared';

// Matches a canonical UUID (any version). Used to reject malformed ids before
// they reach a Postgres uuid-typed column, which would otherwise raise a 500.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The users columns that make up an IAdminUserSummary.
const summaryColumns = {
  id: users.id,
  email: users.email,
  name: users.name,
  level: users.level,
  createdAt: users.createdAt,
  emailVerified: users.emailVerified,
  providerSub: users.providerSub,
};

type SummaryRow = {
  id: string;
  email: string | null;
  name: string;
  level: string;
  createdAt: Date;
  emailVerified: boolean;
  providerSub: string | null;
};

function toSummary(row: SummaryRow): IAdminUserSummary {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    level: row.level as UserLevel,
    createdAt: row.createdAt.toISOString(),
    emailVerified: row.emailVerified,
    isOidc: row.providerSub !== null,
  };
}

// Exact-match account lookup by lowercased email or by id. Returns undefined
// when there is no match (the route turns that into a 404).
export async function findUserSummary(
  db: Db,
  query: { email: string } | { id: string },
): Promise<IAdminUserSummary | undefined> {
  let row: SummaryRow | undefined;
  if ('email' in query) {
    [row] = await db
      .select(summaryColumns)
      .from(users)
      .where(eq(users.email, query.email.toLowerCase()))
      .limit(1);
  } else {
    if (!UUID_RE.test(query.id)) return undefined;
    [row] = await db
      .select(summaryColumns)
      .from(users)
      .where(eq(users.id, query.id))
      .limit(1);
  }
  return row ? toSummary(row) : undefined;
}

// Full admin account-info view: summary plus the three owned-content tables.
// Throws not-found (404) when the id is malformed or matches no user.
//
// Session 3 adds soft-delete (deletedAt). By design these aggregation queries
// keep returning ALL rows, including soft-deleted ones, so an admin can still
// inspect a banned account; Session 5 annotates soft-deleted rows in the UI.
export async function getUserDetail(db: Db, id: string): Promise<IAdminUserDetail> {
  const summary = await findUserSummary(db, { id });
  if (!summary) {
    throwApiError('not-found', 'User not found');
  }

  // Adventures owned, each with its map count (leftJoin → 0 for empty ones).
  const adventureRows = await db
    .select({
      id: adventures.id,
      name: adventures.name,
      createdAt: adventures.createdAt,
      mapCount: count(maps.id),
    })
    .from(adventures)
    .leftJoin(maps, eq(maps.adventureId, adventures.id))
    .where(eq(adventures.ownerId, id))
    .groupBy(adventures.id);

  // Maps inside every adventure the user owns.
  const mapRows = await db
    .select({
      id: maps.id,
      name: maps.name,
      adventureName: adventures.name,
      ty: maps.ty,
    })
    .from(maps)
    .innerJoin(adventures, eq(adventures.id, maps.adventureId))
    .where(eq(adventures.ownerId, id));

  // Images owned by the user.
  const imageRows = await db
    .select({
      id: images.id,
      name: images.name,
      path: images.path,
      createdAt: images.createdAt,
    })
    .from(images)
    .where(eq(images.userId, id));

  return {
    summary,
    adventures: adventureRows.map((r) => ({
      id: r.id,
      name: r.name,
      createdAt: r.createdAt.toISOString(),
      mapCount: Number(r.mapCount),
    })),
    maps: mapRows.map((r) => ({
      id: r.id,
      name: r.name,
      adventureName: r.adventureName,
      // DB column is text; the stored values are MapType enum members.
      ty: r.ty as MapType,
    })),
    images: imageRows.map((r) => ({
      id: r.id,
      name: r.name,
      path: r.path,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}
