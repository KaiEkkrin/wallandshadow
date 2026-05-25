import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { UserLevel } from '@wallandshadow/shared';
import { db } from '../db/connection.js';
import { users } from '../db/schema.js';
import { ensureAdminUser } from '../services/adminBootstrap.js';
import { createOidcUser, promoteUser } from './helpers.js';
import './setup.js';

const ENV_VAR = 'ADMIN_USER_ID';
let savedEnv: string | undefined;

beforeEach(() => {
  savedEnv = process.env[ENV_VAR];
  delete process.env[ENV_VAR];
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env[ENV_VAR];
  else process.env[ENV_VAR] = savedEnv;
});

async function readLevel(uid: string): Promise<string> {
  const [row] = await db.select({ level: users.level })
    .from(users).where(eq(users.id, uid)).limit(1);
  return row.level;
}

describe('ensureAdminUser (startup hook)', () => {
  test('does nothing when ADMIN_USER_ID is unset', async () => {
    const u = await createOidcUser({ providerSub: 'sub-noop' });
    await ensureAdminUser(db);
    expect(await readLevel(u.uid)).toBe(UserLevel.Basic);
  });

  test('does nothing (silently) when ADMIN_USER_ID is empty/whitespace', async () => {
    process.env[ENV_VAR] = '   ';
    const u = await createOidcUser({ providerSub: 'sub-empty' });
    await ensureAdminUser(db);
    expect(await readLevel(u.uid)).toBe(UserLevel.Basic);
  });

  test('logs warning and makes no DB change when no matching user exists', async () => {
    process.env[ENV_VAR] = 'nonexistent-sub';
    const u = await createOidcUser({ providerSub: 'unrelated-sub' });
    await ensureAdminUser(db);
    expect(await readLevel(u.uid)).toBe(UserLevel.Basic);
  });

  test('promotes a matching basic user to admin', async () => {
    const sub = 'admin-sub-basic';
    process.env[ENV_VAR] = sub;
    const u = await createOidcUser({ providerSub: sub });
    await ensureAdminUser(db);
    expect(await readLevel(u.uid)).toBe(UserLevel.Admin);
  });

  test('promotes a matching higher-tier user to admin', async () => {
    const sub = 'admin-sub-higher';
    process.env[ENV_VAR] = sub;
    const u = await createOidcUser({ providerSub: sub });
    await promoteUser(u.uid, UserLevel.Higher);
    await ensureAdminUser(db);
    expect(await readLevel(u.uid)).toBe(UserLevel.Admin);
  });

  test('is idempotent when matching user is already admin', async () => {
    const sub = 'admin-sub-already';
    process.env[ENV_VAR] = sub;
    const u = await createOidcUser({ providerSub: sub });
    await promoteUser(u.uid, UserLevel.Admin);
    await ensureAdminUser(db);
    expect(await readLevel(u.uid)).toBe(UserLevel.Admin);
  });
});
