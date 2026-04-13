import { eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { db } from '../db/connection.js';
import { users } from '../db/schema.js';
import { verifyJwt } from './jwt.js';
import { getOidcVerifier } from './oidc.js';

/**
 * Peek at a JWT's payload without verifying the signature.
 * Returns the parsed payload object, or undefined if the token is malformed.
 */
function peekPayload(token: string): Record<string, unknown> | undefined {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return undefined;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    return typeof payload === 'object' && payload !== null ? payload : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve a Bearer token to a user ID.
 * Auto-detects whether the token is a local HS256 JWT or an OIDC RS256 JWT
 * by peeking at the `iss` claim.
 *
 * For OIDC tokens, creates the user on first login (upsert by provider_sub).
 *
 * Used by both HTTP auth middleware and the WebSocket upgrade handler.
 */
export async function resolveTokenToUid(token: string): Promise<string> {
  const oidc = getOidcVerifier();
  if (oidc) {
    const payload = peekPayload(token);
    if (payload && payload.iss === oidc.issuer) {
      const claims = await oidc.verify(token);
      return upsertOidcUser(claims.sub, claims.email, claims.emailVerified ?? false, claims.name);
    }
  }

  // In OIDC-only mode, do not accept local JWTs — all tokens must come from the provider
  if (process.env.AUTH_MODE === 'oidc') {
    throw new Error('Invalid token: OIDC token required');
  }

  // Fall through to local JWT verification
  const { uid } = await verifyJwt(token);
  return uid;
}

/**
 * Find or create a user for the given OIDC subject.
 *
 * OIDC users are identified solely by provider_sub. No email-based account
 * linking — that is Zitadel's responsibility (configured per-IdP in Zitadel's
 * admin console). Local dev accounts and OIDC accounts are separate identity
 * domains.
 *
 * On each login, email, emailVerified, and name are synced from the token.
 */
async function upsertOidcUser(
  sub: string,
  email: string | undefined,
  emailVerified: boolean,
  name: string | undefined,
): Promise<string> {
  const displayName = name || email || 'User';

  return db.transaction(async (tx) => {
    // Look up by provider_sub, locking the row to prevent concurrent upserts
    const subResult = await tx.execute<{ id: string }>(
      sql`SELECT id FROM users WHERE provider_sub = ${sub} LIMIT 1 FOR UPDATE`
    );
    const existing = subResult.rows[0];

    if (existing) {
      // Returning user — sync cached claims from the token
      await tx.update(users).set({
        email: email ?? null,
        emailVerified,
        name: displayName,
      }).where(eq(users.id, existing.id));
      return existing.id;
    }

    // New OIDC user
    const id = uuidv7();
    await tx.insert(users).values({
      id,
      providerSub: sub,
      email: email ?? null,
      emailVerified,
      name: displayName,
      level: 'standard',
    });
    return id;
  });
}
