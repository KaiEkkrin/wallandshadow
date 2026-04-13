import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { createLocalJWKSet } from 'jose';
import { createApp } from '../app.js';
import { createOidcVerifier, setOidcVerifier } from '../auth/oidc.js';
import { apiGet, registerUser } from './helpers.js';
import { db } from '../db/connection.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';

import './setup.js';

const TEST_ISSUER = 'https://test-oidc.example.com';
const TEST_AUDIENCE = 'test-client-id';

let privateKey: CryptoKey;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  const kp = await generateKeyPair('RS256');
  privateKey = kp.privateKey;

  // Build a local JWKS from the public key
  const pubJwk = await exportJWK(kp.publicKey);
  pubJwk.alg = 'RS256';
  pubJwk.use = 'sig';
  pubJwk.kid = 'test-key-1';
  const jwks = createLocalJWKSet({ keys: [pubJwk] });

  // Inject the test verifier so the middleware uses our local keys
  setOidcVerifier(createOidcVerifier(TEST_ISSUER, TEST_AUDIENCE, jwks));

  app = createApp();
});

afterAll(() => {
  setOidcVerifier(undefined);
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

/** Read the emailVerified column directly from the DB for a user. */
async function getEmailVerified(userId: string): Promise<boolean> {
  const [row] = await db.select({ emailVerified: users.emailVerified })
    .from(users).where(eq(users.id, userId)).limit(1);
  return row.emailVerified;
}

describe('OIDC authentication', () => {
  test('OIDC token auto-creates user and /me returns their data', async () => {
    const token = await signOidcToken({
      sub: 'oidc-user-001',
      email: 'alice@example.com',
      email_verified: true,
      name: 'Alice',
    });

    const res = await apiGet(app, '/api/auth/me', token);
    expect(res.status).toBe(200);
    const body = await res.json() as { uid: string; email: string; emailVerified: boolean; name: string; level: string };
    expect(body.email).toBe('alice@example.com');
    expect(body.emailVerified).toBe(true);
    expect(body.name).toBe('Alice');
    expect(body.level).toBe('standard');
    expect(body.uid).toBeTruthy();
  });

  test('subsequent OIDC login returns same user and updates cached claims', async () => {
    // First login
    const token1 = await signOidcToken({
      sub: 'oidc-user-002',
      email: 'bob@example.com',
      email_verified: true,
      name: 'Bob',
    });
    const res1 = await apiGet(app, '/api/auth/me', token1);
    expect(res1.status).toBe(200);
    const user1 = await res1.json() as { uid: string; name: string };

    // Second login with updated name
    const token2 = await signOidcToken({
      sub: 'oidc-user-002',
      email: 'bob@example.com',
      email_verified: true,
      name: 'Robert',
    });
    const res2 = await apiGet(app, '/api/auth/me', token2);
    expect(res2.status).toBe(200);
    const user2 = await res2.json() as { uid: string; name: string };

    expect(user2.uid).toBe(user1.uid);
    expect(user2.name).toBe('Robert');
  });

  test('OIDC and local tokens work side by side', async () => {
    // Create a local user
    const local = await registerUser(app);
    const localRes = await apiGet(app, '/api/auth/me', local.token);
    expect(localRes.status).toBe(200);
    const localUser = await localRes.json() as { uid: string; name: string };

    // Create an OIDC user
    const oidcToken = await signOidcToken({
      sub: 'oidc-user-003',
      email: 'carol@example.com',
      email_verified: true,
      name: 'Carol',
    });
    const oidcRes = await apiGet(app, '/api/auth/me', oidcToken);
    expect(oidcRes.status).toBe(200);
    const oidcUser = await oidcRes.json() as { uid: string; name: string };

    // Different users
    expect(localUser.uid).not.toBe(oidcUser.uid);
    expect(oidcUser.name).toBe('Carol');
  });

  test('OIDC token with invalid signature is rejected', async () => {
    // Sign with a different key
    const { privateKey: badKey } = await generateKeyPair('RS256');
    const badToken = await new SignJWT({ sub: 'bad-user' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
      .setIssuer(TEST_ISSUER)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(badKey);

    const res = await apiGet(app, '/api/auth/me', badToken);
    expect(res.status).toBe(401);
  });

  test('OIDC token with wrong audience is rejected', async () => {
    const badToken = await new SignJWT({ sub: 'aud-test-user' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
      .setIssuer(TEST_ISSUER)
      .setAudience('wrong-client-id')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);

    const res = await apiGet(app, '/api/auth/me', badToken);
    expect(res.status).toBe(401);
  });

  test('OIDC token with wrong issuer falls through to local verification (and fails)', async () => {
    const token = await new SignJWT({ sub: 'wrong-issuer-user' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
      .setIssuer('https://wrong-issuer.example.com')
      .setAudience(TEST_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);

    // Falls through to local HS256 verification, which fails because it's RS256
    const res = await apiGet(app, '/api/auth/me', token);
    expect(res.status).toBe(401);
  });

  test('OIDC user without email is created with null email', async () => {
    const token = await signOidcToken({
      sub: 'oidc-user-no-email',
      name: 'NoEmail User',
    });

    const res = await apiGet(app, '/api/auth/me', token);
    expect(res.status).toBe(200);
    const body = await res.json() as { uid: string; email: string | null; name: string };
    expect(body.email).toBeNull();
    expect(body.name).toBe('NoEmail User');
  });

  test('OIDC user with same email as local user creates separate account', async () => {
    // Create a local user with a specific email
    const local = await registerUser(app, 'Local Dave', 'dave@example.com');
    const localRes = await apiGet(app, '/api/auth/me', local.token);
    const localUser = await localRes.json() as { uid: string };

    // OIDC login with the same email — should NOT link, should create a new user
    const oidcToken = await signOidcToken({
      sub: 'oidc-dave-different-identity',
      email: 'dave@example.com',
      email_verified: true,
      name: 'OIDC Dave',
    });
    const oidcRes = await apiGet(app, '/api/auth/me', oidcToken);
    expect(oidcRes.status).toBe(200);
    const oidcUser = await oidcRes.json() as { uid: string; name: string };

    // Separate accounts
    expect(oidcUser.uid).not.toBe(localUser.uid);
    expect(oidcUser.name).toBe('OIDC Dave');
  });
});

describe('OIDC email_verified sync', () => {
  test('email_verified=true is stored on first login', async () => {
    const token = await signOidcToken({
      sub: 'ev-user-001',
      email: 'verified@example.com',
      email_verified: true,
      name: 'Verified',
    });
    const res = await apiGet(app, '/api/auth/me', token);
    expect(res.status).toBe(200);
    const body = await res.json() as { uid: string; emailVerified: boolean };
    expect(body.emailVerified).toBe(true);
  });

  test('email_verified=false is stored on first login', async () => {
    const token = await signOidcToken({
      sub: 'ev-user-002',
      email: 'unverified@example.com',
      email_verified: false,
      name: 'Unverified',
    });
    const res = await apiGet(app, '/api/auth/me', token);
    expect(res.status).toBe(200);
    const body = await res.json() as { uid: string; emailVerified: boolean };
    expect(body.emailVerified).toBe(false);
  });

  test('missing email_verified defaults to false', async () => {
    const token = await signOidcToken({
      sub: 'ev-user-003',
      email: 'nofield@example.com',
      name: 'NoField',
    });
    const res = await apiGet(app, '/api/auth/me', token);
    expect(res.status).toBe(200);
    const body = await res.json() as { uid: string; emailVerified: boolean };
    expect(body.emailVerified).toBe(false);
  });

  test('email_verified upgrades from false to true on subsequent login', async () => {
    // First login — unverified
    const token1 = await signOidcToken({
      sub: 'ev-user-004',
      email: 'upgrading@example.com',
      email_verified: false,
      name: 'Upgrading',
    });
    const res1 = await apiGet(app, '/api/auth/me', token1);
    const user = await res1.json() as { uid: string };

    expect(await getEmailVerified(user.uid)).toBe(false);

    // Second login — now verified
    const token2 = await signOidcToken({
      sub: 'ev-user-004',
      email: 'upgrading@example.com',
      email_verified: true,
      name: 'Upgrading',
    });
    await apiGet(app, '/api/auth/me', token2);

    expect(await getEmailVerified(user.uid)).toBe(true);
  });

  test('email and emailVerified sync on every login', async () => {
    // First login
    const token1 = await signOidcToken({
      sub: 'ev-user-005',
      email: 'old@example.com',
      email_verified: true,
      name: 'Syncer',
    });
    const res1 = await apiGet(app, '/api/auth/me', token1);
    const user = await res1.json() as { uid: string; email: string };
    expect(user.email).toBe('old@example.com');

    // Second login — email changed at Zitadel, verification reset
    const token2 = await signOidcToken({
      sub: 'ev-user-005',
      email: 'new@example.com',
      email_verified: false,
      name: 'Syncer',
    });
    const res2 = await apiGet(app, '/api/auth/me', token2);
    const user2 = await res2.json() as { uid: string; email: string; emailVerified: boolean };
    expect(user2.uid).toBe(user.uid);
    expect(user2.email).toBe('new@example.com');
    expect(user2.emailVerified).toBe(false);
  });
});
