import { describe, test, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { UserLevel } from '@wallandshadow/shared';
import { createApp } from '../app.js';
import { db } from '../db/connection.js';
import { users } from '../db/schema.js';
import {
  apiPatch,
  apiPost,
  markUserBanned,
  promoteUser,
  registerAdminUser,
  registerUser,
} from './helpers.js';
import './setup.js';

let app: ReturnType<typeof createApp>;
beforeAll(() => { app = createApp(); });

describe('PATCH /api/admin/users/:id — tier change', () => {
  test('promoting a basic user to higher returns the updated summary and persists the level', async () => {
    const admin = await registerAdminUser(app, 'AdminPromote');
    const target = await registerUser(app);

    const res = await apiPatch(
      app, `/api/admin/users/${target.uid}`, { level: 'higher' }, admin.token,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { id: string; level: string };
    expect(body.id).toBe(target.uid);
    expect(body.level).toBe('higher');

    const [row] = await db.select({ level: users.level })
      .from(users).where(eq(users.id, target.uid)).limit(1);
    expect(row.level).toBe(UserLevel.Higher);
  });

  test('changing tier emits a user_profile NOTIFY', async () => {
    const admin = await registerAdminUser(app, 'AdminNotify');
    const target = await registerUser(app);

    // Open a dedicated LISTEN client and capture user_profile payloads.
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    const seenPayloads: string[] = [];
    try {
      await client.connect();
      await client.query('LISTEN user_profile');
      const gotNotify = new Promise<void>((resolve) => {
        client.on('notification', (msg) => {
          if (msg.channel === 'user_profile' && msg.payload) {
            seenPayloads.push(msg.payload);
            if (msg.payload === target.uid) resolve();
          }
        });
      });

      const res = await apiPatch(
        app, `/api/admin/users/${target.uid}`, { level: 'higher' }, admin.token,
      );
      expect(res.status).toBe(200);

      // Bound the wait so a missing NOTIFY fails fast instead of hanging.
      // Clear the timer on success so the loser of Promise.race doesn't fire
      // an orphan rejection after the test resolves.
      let timeoutId: NodeJS.Timeout | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('no NOTIFY')), 2000);
      });
      try {
        await Promise.race([gotNotify, timeoutPromise]);
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
      expect(seenPayloads).toContain(target.uid);
    } finally {
      await client.end().catch(() => {});
    }
  });

  test('rejects an unknown level value with 400', async () => {
    const admin = await registerAdminUser(app, 'AdminBadLevel');
    const target = await registerUser(app);
    const res = await apiPatch(
      app, `/api/admin/users/${target.uid}`, { level: 'super-user' }, admin.token,
    );
    expect(res.status).toBe(400);
  });

  test('rejects a missing level field with 400', async () => {
    const admin = await registerAdminUser(app, 'AdminMissing');
    const target = await registerUser(app);
    const res = await apiPatch(
      app, `/api/admin/users/${target.uid}`, {}, admin.token,
    );
    expect(res.status).toBe(400);
  });

  test('admin changing their own tier is rejected with 400', async () => {
    const admin = await registerAdminUser(app, 'AdminSelf');
    const res = await apiPatch(
      app, `/api/admin/users/${admin.uid}`, { level: 'basic' }, admin.token,
    );
    expect(res.status).toBe(400);
    const [row] = await db.select({ level: users.level })
      .from(users).where(eq(users.id, admin.uid)).limit(1);
    expect(row.level).toBe(UserLevel.Admin);
  });

  test('unknown target uid returns 404', async () => {
    const admin = await registerAdminUser(app, 'AdminMissingTarget');
    const res = await apiPatch(
      app, '/api/admin/users/00000000-0000-0000-0000-000000000000',
      { level: 'higher' }, admin.token,
    );
    expect(res.status).toBe(404);
  });

  test('malformed target uid returns 404', async () => {
    const admin = await registerAdminUser(app, 'AdminMalformed');
    const res = await apiPatch(
      app, '/api/admin/users/not-a-uuid', { level: 'higher' }, admin.token,
    );
    expect(res.status).toBe(404);
  });

  test('non-admin caller is rejected by adminMiddleware (403)', async () => {
    const caller = await registerUser(app);
    const target = await registerUser(app);
    const res = await apiPatch(
      app, `/api/admin/users/${target.uid}`, { level: 'higher' }, caller.token,
    );
    expect(res.status).toBe(403);
  });

  // The handler had previously crashed with a 500 on `null` (or any JSON
  // primitive) because c.req.json() resolves the value without throwing and
  // the cast `(body as { level?: unknown }).level` dereferenced null.
  test('rejects a JSON null body with 400', async () => {
    const admin = await registerAdminUser(app, 'AdminNullBody');
    const target = await registerUser(app);
    const res = await app.request(`/api/admin/users/${target.uid}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${admin.token}`,
      },
      body: 'null',
    });
    expect(res.status).toBe(400);
  });

  test('rejects a JSON array body with 400', async () => {
    const admin = await registerAdminUser(app, 'AdminArrayBody');
    const target = await registerUser(app);
    const res = await app.request(`/api/admin/users/${target.uid}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${admin.token}`,
      },
      body: '["higher"]',
    });
    expect(res.status).toBe(400);
  });

  test('refuses to change tier of a banned account', async () => {
    const admin = await registerAdminUser(app, 'AdminBannedTarget');
    const target = await registerUser(app);
    await markUserBanned(target.uid);
    const res = await apiPatch(
      app, `/api/admin/users/${target.uid}`, { level: 'higher' }, admin.token,
    );
    expect(res.status).toBe(400);
    // Verify level was not silently mutated.
    const [row] = await db.select({ level: users.level })
      .from(users).where(eq(users.id, target.uid)).limit(1);
    expect(row.level).toBe(UserLevel.Basic);
  });

  // In steady state, an admin demoting a peer admin succeeds as long as at
  // least one other active admin exists (the caller themselves counts).
  // adminMiddleware blocks non-admin callers and self-edit is blocked
  // separately, so the only way for the count-based guard to *fail* in
  // steady state is the racing-demotions case below — there the row lock
  // serialises the two transactions and one observes zero remaining
  // admins after the other has committed.
  test('admin can demote a peer admin while another active admin exists', async () => {
    const a = await registerAdminUser(app, 'PeerA');
    const b = await registerAdminUser(app, 'PeerB');
    const res = await apiPatch(
      app, `/api/admin/users/${b.uid}`, { level: 'basic' }, a.token,
    );
    expect(res.status).toBe(200);
    const [row] = await db.select({ level: users.level })
      .from(users).where(eq(users.id, b.uid)).limit(1);
    expect(row.level).toBe(UserLevel.Basic);
  });

  // Concurrent demotion-of-each-other: two admins racing to demote each other
  // must not both succeed (which would leave zero active admins). The row
  // lock inside updateUserLevel's tx serialises them; one wins, the other
  // sees that demoting their target would leave zero active admins and
  // returns 400.
  test('two admins racing to demote each other cannot both succeed', async () => {
    const a = await registerAdminUser(app, 'RaceA');
    const b = await registerAdminUser(app, 'RaceB');
    // A asks to demote B; B asks to demote A. At the moment each tx checks
    // the other-active-admins count, only their own demotion is visible.
    // The row lock means one tx commits first; the second tx then observes
    // remaining = 0 and is refused.
    const [resAtoB, resBtoA] = await Promise.all([
      apiPatch(app, `/api/admin/users/${b.uid}`, { level: 'basic' }, a.token),
      apiPatch(app, `/api/admin/users/${a.uid}`, { level: 'basic' }, b.token),
    ]);
    const statuses = [resAtoB.status, resBtoA.status].sort();
    expect(statuses).toEqual([200, 400]);

    // Final DB state: exactly one of A, B is admin; the other is basic.
    const [rowA] = await db.select({ level: users.level })
      .from(users).where(eq(users.id, a.uid)).limit(1);
    const [rowB] = await db.select({ level: users.level })
      .from(users).where(eq(users.id, b.uid)).limit(1);
    const levels = [rowA.level, rowB.level].sort();
    expect(levels).toEqual([UserLevel.Admin, UserLevel.Basic]);
  });

  // Concurrent PATCH (promote target to admin) + POST /ban must not produce
  // bannedAt != NULL AND level = 'admin'. The shared row lock on the target
  // ensures exactly one ordering: either ban commits first and PATCH then
  // refuses (bannedAt set), or PATCH commits first and ban refuses
  // (level = admin). Either way the invariant holds.
  test('concurrent promote-to-admin + ban on the same target cannot both succeed', async () => {
    const a = await registerAdminUser(app, 'RacePromote');
    const b = await registerAdminUser(app, 'RaceBan');
    const target = await registerUser(app);
    // Bump target to Higher first so the promotion path is realistic.
    await promoteUser(target.uid, UserLevel.Higher);

    const [promoteRes, banRes] = await Promise.all([
      apiPatch(app, `/api/admin/users/${target.uid}`, { level: 'admin' }, a.token),
      apiPost(app, `/api/admin/users/${target.uid}/ban`, {}, b.token),
    ]);
    const statuses = [promoteRes.status, banRes.status].sort();
    // Exactly one wins (200); the loser is rejected as 400.
    expect(statuses).toEqual([200, 400]);

    const [row] = await db.select({ level: users.level, bannedAt: users.bannedAt })
      .from(users).where(eq(users.id, target.uid)).limit(1);
    // Invariant: a banned admin must not exist.
    expect(row.bannedAt !== null && row.level === UserLevel.Admin).toBe(false);
  }, 30000);
});
