import type { Hono } from 'hono';
import {
  ChangeType,
  ChangeCategory,
  UserLevel,
  type Changes,
  type Change,
  type ImageAdd,
  type TokenAdd,
  type TokenMove,
  type WallAdd,
} from '@wallandshadow/shared';
import { db } from '../db/connection.js';
import { adventures, images, mapChanges, maps, users } from '../db/schema.js';
import { and, eq } from 'drizzle-orm';
import { DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { v7 as uuidv7 } from 'uuid';
import { testS3, testBucket } from './setup.js';

// ─── Test fixtures ─────────────────────────────────────────────────────────────

// Minimal 1x1 red PNG (68 bytes)
export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
  'base64',
);

// ─── S3 helpers ───────────────────────────────────────────────────────────────

export async function s3ObjectExists(key: string): Promise<boolean> {
  try {
    await testS3.send(new HeadObjectCommand({ Bucket: testBucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

// Removes a test object from S3. Idempotent (S3 DELETE succeeds for missing
// keys); for cleaning up objects a test deliberately left orphaned.
export async function deleteS3Object(key: string): Promise<void> {
  await testS3.send(new DeleteObjectCommand({ Bucket: testBucket, Key: key }));
}

// ─── Auth helpers ─────────────────────────────────────────────────────────────

let _userCounter = 0;

// TODO Phase 2: replace local JWT registration with OIDC test flow
export async function registerUser(
  app: Hono,
  name?: string,
  email?: string,
  password?: string,
): Promise<{ token: string; uid: string }> {
  const n = ++_userCounter;
  const res = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: name ?? `User ${n}`,
      email: email ?? `user${n}@example.com`,
      password: password ?? 'TestPass1',
    }),
  });
  if (res.status !== 201) {
    throw new Error(`registerUser failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

// Directly sets a user's account tier. New accounts default to Basic; tests
// that need higher caps (e.g. image upload) promote past it. Runtime tier
// changes via the admin API arrive in a later session — tests reach past it.
export async function promoteUser(uid: string, level: UserLevel): Promise<void> {
  await db.update(users).set({ level }).where(eq(users.id, uid));
}

// Registers a user and immediately promotes them to the Higher tier — the
// common case for tests that upload images or exceed Basic-tier caps.
export async function registerHigherUser(
  app: Hono,
  name?: string,
  email?: string,
  password?: string,
): Promise<{ token: string; uid: string }> {
  const u = await registerUser(app, name, email, password);
  await promoteUser(u.uid, UserLevel.Higher);
  return u;
}

// Registers a user and immediately promotes them to the Admin tier — for tests
// exercising the /api/admin/* routes. Runtime tier changes via an admin API
// arrive in a later session; tests reach past it, like registerHigherUser.
export async function registerAdminUser(
  app: Hono,
  name?: string,
  email?: string,
  password?: string,
): Promise<{ token: string; uid: string }> {
  const u = await registerUser(app, name, email, password);
  await promoteUser(u.uid, UserLevel.Admin);
  return u;
}

// Inserts a user row with an OIDC provider_sub set (no local password) — for
// tests of external-id search and shared-email de-confliction. The register
// endpoint only creates local accounts, so OIDC rows are inserted directly.
// `createdAt` is settable so "oldest wins" ordering is deterministic.
export async function createOidcUser(opts: {
  providerSub: string;
  email?: string;
  name?: string;
  createdAt?: Date;
}): Promise<{ uid: string }> {
  const uid = uuidv7();
  await db.insert(users).values({
    id: uid,
    providerSub: opts.providerSub,
    email: opts.email ?? null,
    emailVerified: true,
    name: opts.name ?? 'OIDC User',
    level: 'basic',
    ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
  });
  return { uid };
}

// ─── Soft-delete / ban helpers ────────────────────────────────────────────────

// Session 3 adds the soft-delete columns (deletedAt / bannedAt) but nothing
// that writes them — banUser() arrives in Session 4. Tests set the columns
// directly through these helpers.

export async function markAdventureDeleted(adventureId: string): Promise<void> {
  await db.update(adventures).set({ deletedAt: new Date() }).where(eq(adventures.id, adventureId));
}

export async function markMapDeleted(mapId: string): Promise<void> {
  await db.update(maps).set({ deletedAt: new Date() }).where(eq(maps.id, mapId));
}

export async function markImageDeleted(imageId: string): Promise<void> {
  await db.update(images).set({ deletedAt: new Date() }).where(eq(images.id, imageId));
}

export async function markUserBanned(uid: string): Promise<void> {
  await db.update(users).set({ bannedAt: new Date() }).where(eq(users.id, uid));
}

// ─── Request helpers ──────────────────────────────────────────────────────────

export async function apiGet(
  app: Hono,
  path: string,
  token: string,
): Promise<Response> {
  return app.request(path, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function apiPost(
  app: Hono,
  path: string,
  body: unknown,
  token: string,
): Promise<Response> {
  return app.request(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

export async function apiPatch(
  app: Hono,
  path: string,
  body: unknown,
  token: string,
): Promise<Response> {
  return app.request(path, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

export async function apiPut(
  app: Hono,
  path: string,
  body: unknown,
  token: string,
): Promise<Response> {
  return app.request(path, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

export async function apiDelete(
  app: Hono,
  path: string,
  token: string,
): Promise<Response> {
  return app.request(path, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function apiUploadImage(
  app: Hono,
  token: string,
  fileContent: Buffer | Uint8Array,
  fileName: string,
  contentType: string,
  name?: string,
): Promise<Response> {
  const formData = new FormData();
  // Copy into a plain ArrayBuffer — Buffer.buffer is ArrayBufferLike which Blob rejects
  const ab = fileContent.buffer.slice(fileContent.byteOffset, fileContent.byteOffset + fileContent.byteLength) as ArrayBuffer;
  formData.append('file', new Blob([ab], { type: contentType }), fileName);
  if (name !== undefined) {
    formData.append('name', name);
  }
  return app.request('/api/images', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
}

export async function postMapChanges(
  app: Hono,
  token: string,
  adventureId: string,
  mapId: string,
  chs: Change[],
): Promise<void> {
  const res = await apiPost(app, `/api/adventures/${adventureId}/maps/${mapId}/changes`, { chs }, token);
  if (res.status !== 201) {
    throw new Error(`postMapChanges failed: ${res.status} ${await res.text()}`);
  }
}

// ─── DB read helpers (used for verifying internal consolidation state) ────────

export async function getBaseChange(mapId: string): Promise<Changes | undefined> {
  const rows = await db.select({ changes: mapChanges.changes })
    .from(mapChanges)
    .where(and(eq(mapChanges.mapId, mapId), eq(mapChanges.isBase, true)))
    .limit(1);
  return rows[0]?.changes as Changes | undefined;
}

export async function getIncrementalChanges(mapId: string): Promise<Changes[]> {
  const rows = await db.select({ changes: mapChanges.changes })
    .from(mapChanges)
    .where(and(eq(mapChanges.mapId, mapId), eq(mapChanges.isBase, false)))
    .orderBy(mapChanges.seq);
  return rows.map(r => r.changes as Changes);
}

export async function countMapChanges(mapId: string): Promise<number> {
  const rows = await db.select({ id: mapChanges.id })
    .from(mapChanges)
    .where(eq(mapChanges.mapId, mapId));
  return rows.length;
}

// ─── Change factories (ported from functions.test.ts) ────────────────────────

export function createAddToken1(uid: string): TokenAdd {
  return {
    ty: ChangeType.Add,
    cat: ChangeCategory.Token,
    feature: {
      position: { x: 0, y: 3 },
      colour: 1,
      id: 'token1',
      players: [uid],
      size: '1',
      text: 'ONE',
      note: 'token one',
      noteVisibleToPlayers: true,
      characterId: '',
      sprites: [],
      outline: true,
    },
  };
}

export function createMoveToken1(x: number): TokenMove {
  return {
    ty: ChangeType.Move,
    cat: ChangeCategory.Token,
    tokenId: 'token1',
    oldPosition: { x, y: 3 },
    newPosition: { x: x + 1, y: 3 },
  };
}

export function createAddImage(imagePath: string, id = 'image1', name = 'placed.png'): ImageAdd {
  return {
    ty: ChangeType.Add,
    cat: ChangeCategory.Image,
    feature: {
      id,
      image: { name, path: imagePath },
      rotation: '0',
      start: { anchorType: 'vertex', position: { x: 0, y: 0, vertex: 0 } },
      end: { anchorType: 'vertex', position: { x: 2, y: 2, vertex: 0 } },
    },
  };
}

export function createAddWall1(): WallAdd {
  return {
    ty: ChangeType.Add,
    cat: ChangeCategory.Wall,
    feature: {
      position: { x: 0, y: 0, edge: 0 },
      colour: 0,
    },
  };
}
