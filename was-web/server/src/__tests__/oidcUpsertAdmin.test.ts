import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import {
  SignJWT,
  exportJWK,
  generateKeyPair,
  createLocalJWKSet,
} from 'jose';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { UserLevel } from '@wallandshadow/shared';
import { createApp } from '../app.js';
import { createOidcVerifier, setOidcVerifier } from '../auth/oidc.js';
import { db } from '../db/connection.js';
import { users } from '../db/schema.js';
import { apiGet } from './helpers.js';
import './setup.js';

const TEST_ISSUER = 'https://test-oidc-upsert.example.com';
const TEST_AUDIENCE = 'test-client-id';
const ENV_VAR = 'ADMIN_USER_ID';

let privateKey: CryptoKey;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  const kp = await generateKeyPair('RS256');
  privateKey = kp.privateKey;
  const pubJwk = await exportJWK(kp.publicKey);
  pubJwk.alg = 'RS256';
  pubJwk.use = 'sig';
  pubJwk.kid = 'test-key-1';
  const jwks = createLocalJWKSet({ keys: [pubJwk] });
  setOidcVerifier(createOidcVerifier(TEST_ISSUER, TEST_AUDIENCE, jwks));
  app = createApp();
});

afterAll(() => {
  setOidcVerifier(undefined);
});

let savedEnv: string | undefined;
beforeEach(() => {
  savedEnv = process.env[ENV_VAR];
  delete process.env[ENV_VAR];
});
afterEach(() => {
  if (savedEnv === undefined) delete process.env[ENV_VAR];
  else process.env[ENV_VAR] = savedEnv;
});

async function signOidcToken(claims: {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
}): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
    .setIssuer(TEST_ISSUER)
    .setAudience(TEST_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey);
}

describe('OIDC upsert auto-promotion via ADMIN_USER_ID', () => {
  test('new user matching ADMIN_USER_ID is inserted at admin tier', async () => {
    const sub = 'admin-new-sub';
    process.env[ENV_VAR] = sub;
    const token = await signOidcToken({ sub, email: 'admin@example.com', name: 'Admin' });
    const res = await apiGet(app, '/api/auth/me', token);
    expect(res.status).toBe(200);
    const body = await res.json() as { uid: string; level: string };
    expect(body.level).toBe(UserLevel.Admin);

    const [row] = await db.select({ level: users.level })
      .from(users).where(eq(users.id, body.uid)).limit(1);
    expect(row.level).toBe(UserLevel.Admin);
  });

  test('non-matching sub is created as basic even when ADMIN_USER_ID is set', async () => {
    process.env[ENV_VAR] = 'something-else';
    const token = await signOidcToken({ sub: 'plain-user', email: 'plain@example.com', name: 'Plain' });
    const res = await apiGet(app, '/api/auth/me', token);
    expect(res.status).toBe(200);
    const body = await res.json() as { uid: string; level: string };
    expect(body.level).toBe(UserLevel.Basic);
  });

  test('new user with no ADMIN_USER_ID set is created as basic', async () => {
    const token = await signOidcToken({ sub: 'no-env-user', email: 'a@example.com', name: 'A' });
    const res = await apiGet(app, '/api/auth/me', token);
    expect(res.status).toBe(200);
    const body = await res.json() as { uid: string; level: string };
    expect(body.level).toBe(UserLevel.Basic);
  });

  test('existing basic user matching ADMIN_USER_ID is promoted on sign-in and a user_profile NOTIFY is emitted', async () => {
    const sub = 'admin-existing-sub';
    // First sign-in without env var → user created as basic.
    const token1 = await signOidcToken({ sub, email: 'admin@example.com', name: 'Admin' });
    const res1 = await apiGet(app, '/api/auth/me', token1);
    expect(res1.status).toBe(200);
    const user = await res1.json() as { uid: string; level: string };
    expect(user.level).toBe(UserLevel.Basic);

    // Set env var; open NOTIFY listener; sign in again.
    process.env[ENV_VAR] = sub;

    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    const seenPayloads: string[] = [];
    try {
      await client.connect();
      await client.query('LISTEN user_profile');
      const gotNotify = new Promise<void>((resolve) => {
        client.on('notification', (msg) => {
          if (msg.channel === 'user_profile' && msg.payload) {
            seenPayloads.push(msg.payload);
            if (msg.payload === user.uid) resolve();
          }
        });
      });

      const token2 = await signOidcToken({ sub, email: 'admin@example.com', name: 'Admin' });
      const res2 = await apiGet(app, '/api/auth/me', token2);
      expect(res2.status).toBe(200);
      const me = await res2.json() as { level: string };
      expect(me.level).toBe(UserLevel.Admin);

      let timeoutId: NodeJS.Timeout | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('no NOTIFY')), 2000);
      });
      try {
        await Promise.race([gotNotify, timeoutPromise]);
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
      expect(seenPayloads).toContain(user.uid);
    } finally {
      await client.end().catch(() => {});
    }
  });

  test('existing admin user matching ADMIN_USER_ID is unchanged on sign-in (no surplus NOTIFY)', async () => {
    const sub = 'admin-stable-sub';
    process.env[ENV_VAR] = sub;
    // First sign-in: created at admin (env var matches).
    const token1 = await signOidcToken({ sub, email: 'admin@example.com', name: 'Admin' });
    const res1 = await apiGet(app, '/api/auth/me', token1);
    expect(res1.status).toBe(200);
    const user = await res1.json() as { uid: string; level: string };
    expect(user.level).toBe(UserLevel.Admin);

    // Listen for surplus NOTIFY during a no-op subsequent sign-in.
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    const seenPayloads: string[] = [];
    try {
      await client.connect();
      await client.query('LISTEN user_profile');
      client.on('notification', (msg) => {
        if (msg.channel === 'user_profile' && msg.payload === user.uid) {
          seenPayloads.push(msg.payload);
        }
      });

      const token2 = await signOidcToken({ sub, email: 'admin@example.com', name: 'Admin' });
      const res2 = await apiGet(app, '/api/auth/me', token2);
      expect(res2.status).toBe(200);

      // Brief wait to let any NOTIFY land (would be a regression).
      await new Promise(r => setTimeout(r, 500));
      expect(seenPayloads).toEqual([]);
    } finally {
      await client.end().catch(() => {});
    }
  });
});
