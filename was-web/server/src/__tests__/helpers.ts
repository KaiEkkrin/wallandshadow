import type { Hono } from 'hono';
import {
  ChangeType,
  ChangeCategory,
  type Changes,
  type Change,
  type TokenAdd,
  type TokenMove,
  type WallAdd,
} from '@wallandshadow/shared';
import { db } from '../db/connection.js';
import { mapChanges } from '../db/schema.js';
import { and, eq } from 'drizzle-orm';
import { HeadObjectCommand } from '@aws-sdk/client-s3';
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
  formData.append('file', new Blob([fileContent], { type: contentType }), fileName);
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
    .where(and(eq(mapChanges.mapId, mapId), eq(mapChanges.incremental, false)))
    .limit(1);
  return rows[0]?.changes as Changes | undefined;
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
