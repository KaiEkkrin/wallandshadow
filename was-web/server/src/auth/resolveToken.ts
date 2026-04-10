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
      return upsertOidcUser(claims.sub, claims.email, claims.name);
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
 * Handles three cases:
 * 1. User exists with this provider_sub → update cached claims and return.
 * 2. No provider_sub match, but a user exists with the same email (e.g. a local
 *    email/password account) → link the OIDC identity to that user.
 * 3. No match at all → create a new user.
 *
 * Case 2 is the common "account linking" scenario: user signed up with
 * email/password, then later logs in via the OIDC provider using the same
 * email address.
 */
async function upsertOidcUser(sub: string, email: string | undefined, name: string | undefined): Promise<string> {
  const displayName = name || email || 'User';

  return db.transaction(async (tx) => {
    // 1. Look up by provider_sub, locking the row to prevent concurrent upserts
    const subResult = await tx.execute<{ id: string }>(
      sql`SELECT id FROM users WHERE provider_sub = ${sub} LIMIT 1 FOR UPDATE`
    );
    const bySub = subResult.rows[0];

    if (bySub) {
      const updates: Partial<{ email: string | null; name: string }> = {};
      if (name !== undefined) updates.name = name;
      if (email !== undefined) {
        // Only update email if no other user owns it
        const [emailOwner] = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, email))
          .limit(1);
        if (!emailOwner || emailOwner.id === bySub.id) {
          updates.email = email;
        }
      }
      if (Object.keys(updates).length > 0) {
        await tx.update(users).set(updates).where(eq(users.id, bySub.id));
      }
      return bySub.id;
    }

    // 2. Link: existing local account with the same email → attach provider_sub
    if (email) {
      const emailResult = await tx.execute<{ id: string }>(
        sql`SELECT id FROM users WHERE email = ${email} LIMIT 1 FOR UPDATE`
      );
      const byEmail = emailResult.rows[0];

      if (byEmail) {
        await tx.update(users).set({
          providerSub: sub,
          name: displayName,
        }).where(eq(users.id, byEmail.id));
        return byEmail.id;
      }
    }

    // 3. Brand-new user
    const id = uuidv7();
    await tx.insert(users).values({
      id,
      providerSub: sub,
      email: email ?? null,
      name: displayName,
      level: 'standard',
    });
    return id;
  });
}
