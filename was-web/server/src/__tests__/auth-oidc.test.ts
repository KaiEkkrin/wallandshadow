import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { createLocalJWKSet } from 'jose';
import { createApp } from '../app.js';
import { createOidcVerifier, setOidcVerifier } from '../auth/oidc.js';
import { apiGet, registerUser } from './helpers.js';

import './setup.js';

const TEST_ISSUER = 'https://test-oidc.example.com';

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
  setOidcVerifier(createOidcVerifier(TEST_ISSUER, jwks));

  app = createApp();
});

afterAll(() => {
  setOidcVerifier(undefined);
});

async function signOidcToken(claims: {
  sub: string;
  email?: string;
  name?: string;
}): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
    .setIssuer(TEST_ISSUER)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey);
}

describe('OIDC authentication', () => {
  test('OIDC token auto-creates user and /me returns their data', async () => {
    const token = await signOidcToken({
      sub: 'oidc-user-001',
      email: 'alice@example.com',
      name: 'Alice',
    });

    const res = await apiGet(app, '/api/auth/me', token);
    expect(res.status).toBe(200);
    const body = await res.json() as { uid: string; email: string; name: string; level: string };
    expect(body.email).toBe('alice@example.com');
    expect(body.name).toBe('Alice');
    expect(body.level).toBe('standard');
    expect(body.uid).toBeTruthy();
  });

  test('subsequent OIDC login returns same user and updates cached claims', async () => {
    // First login
    const token1 = await signOidcToken({
      sub: 'oidc-user-002',
      email: 'bob@example.com',
      name: 'Bob',
    });
    const res1 = await apiGet(app, '/api/auth/me', token1);
    expect(res1.status).toBe(200);
    const user1 = await res1.json() as { uid: string; name: string };

    // Second login with updated name
    const token2 = await signOidcToken({
      sub: 'oidc-user-002',
      email: 'bob@example.com',
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

  test('OIDC token with wrong issuer falls through to local verification (and fails)', async () => {
    const token = await new SignJWT({ sub: 'wrong-issuer-user' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
      .setIssuer('https://wrong-issuer.example.com')
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
});
