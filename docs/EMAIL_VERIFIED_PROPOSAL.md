# Proposal: Use `email_verified` in OIDC Account Linking

**Status**: Proposed
**Context**: Security review identified that `upsertOidcUser` links OIDC identities to existing local accounts by email match without checking whether the OIDC provider has verified the email.

## Problem

When a user logs in via Zitadel with an email that matches an existing local (email/password) account, the server links the OIDC identity to that account unconditionally (`resolveToken.ts`, Case 2). If the OIDC token's email is not verified by Zitadel, this could allow an attacker to claim someone else's account.

## Design Constraints

- **New users with unverified emails must be allowed to onboard**, as long as there's no email conflict. Flow: user signs up on Zitadel, verification email is in flight, Zitadel lets them through to Wall & Shadow with `email_verified: false`.
- **Verified emails always win ownership.** An unverified token should never claim an email belonging to an existing account.
- **Don't downgrade.** If a returning user's stored email is already verified, an unverified token should not revert that status.

## Schema Change

Add `email_verified` column to the `users` table:

```ts
// schema.ts
emailVerified: boolean('email_verified').notNull().default(false),
```

Migration: `ALTER TABLE users ADD COLUMN email_verified boolean NOT NULL DEFAULT false;`

Existing users get `false` by default. On their next OIDC login with a verified email, it upgrades automatically.

## OidcClaims Change

```ts
// oidc.ts
export interface OidcClaims {
  sub: string;
  email?: string;
  emailVerified?: boolean;  // new
  name?: string;
}
```

Extract from JWT payload: `typeof payload.email_verified === 'boolean' ? payload.email_verified : undefined`

Default to `false` when missing (`claims.emailVerified ?? false`).

## Account Linking Logic

### Case 1 — Returning OIDC user (provider_sub match)

| Incoming email | Incoming verified? | Current stored state | Action |
|---|---|---|---|
| Same email | `true` | `emailVerified=false` | Upgrade: set `emailVerified=true` |
| Same email | `false` | `emailVerified=true` | No change (don't downgrade) |
| New email | `true` | Any | Update email + set `emailVerified=true` (if email available) |
| New email | `false` | Has email | Don't touch email |
| New email | `false` | No email | Accept unverified email |

### Case 2 — Account linking (email match, no provider_sub match)

**Only link when `emailVerified === true`.** If unverified, skip to Case 3.

### Case 3 — New user

| Email | Verified? | Conflict? | Action |
|---|---|---|---|
| Present | `true` | No | Create with email, `emailVerified=true` |
| Present | `false` | No | Create with email, `emailVerified=false` |
| Present | `false` | Yes | Create with `email: null` (user has `provider_sub`, satisfies identity constraint) |
| Present | `true` | Yes | This is Case 2 (account linking) |
| None | N/A | N/A | Create with `email: null` |

## Test Cases

1. Unverified email, no conflict -- user created with email, `emailVerified=false`
2. Unverified email, conflicts with existing local account -- new user created with `email: null`
3. Verified email, no conflict -- user created with `emailVerified=true`
4. Verified email, conflicts with existing account -- account linked (same uid)
5. Returning user: verified email upgrades previously unverified
6. Returning user: unverified email does not downgrade verified email

## Files to Modify

- `was-web/server/src/db/schema.ts` -- add column
- `was-web/server/drizzle/` -- new migration (generate with `yarn db:generate`)
- `was-web/server/src/auth/oidc.ts` -- add `emailVerified` to `OidcClaims`, extract from payload
- `was-web/server/src/auth/resolveToken.ts` -- rewrite `upsertOidcUser` with verification-aware logic
- `was-web/server/src/__tests__/auth-oidc.test.ts` -- add `email_verified` to test helper, add 6 test cases
