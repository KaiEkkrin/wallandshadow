# OIDC Identity and `email_verified` — Design Decision

**Status**: Implemented
**Date**: 2026-04-10

## Decision

OIDC users are identified solely by `provider_sub` (Zitadel's `sub` claim). There is no email-based account linking in the application — that responsibility belongs to Zitadel, which can be configured per-IdP via its admin console.

Local dev accounts (`provider_sub IS NULL`) and OIDC accounts are separate identity domains.

## Rationale

Security research (USENIX 2022 "Pre-hijacked Accounts", Auth0/Keycloak/Ory documentation) consistently advises against automatic email-based account linking:

- Federated IdPs can misrepresent `email_verified` status
- A compromised social account cascades into app account takeover
- The OIDC spec says only `(iss, sub)` is a reliable identity; email is mutable

Since Zitadel is our sole OIDC provider, it handles account linking at the provider level (before the JWT reaches our server). When a user authenticates via GitHub, Discord, or Google, Zitadel decides whether to create a new Zitadel user or link to an existing one. Our server only sees Zitadel's `sub`.

## Schema

```sql
-- email uniqueness only for local (dev) accounts
CREATE UNIQUE INDEX users_email_local_idx ON users (email)
  WHERE email IS NOT NULL AND provider_sub IS NULL;

-- email_verified synced from OIDC token on every login
ALTER TABLE users ADD COLUMN email_verified boolean NOT NULL DEFAULT false;
```

## Behaviour

- **OIDC login**: `upsertOidcUser` finds-or-creates by `provider_sub`, syncs `email`, `email_verified`, and `name` from the token on every login
- **Local login** (dev only): unchanged, identified by email, `email_verified` stays `false`
- **No email-based linking**: an OIDC user with the same email as a local user creates a separate account
