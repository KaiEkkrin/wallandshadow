# GH-356 — Account Tiers, Account Deletion & Admin Ban — Overview

**Issue:** [#356](https://github.com/KaiEkkrin/wallandshadow/issues/356) — "Set up legalese, account tiers and basic admin UI"
**Branch:** `gh-356-compliance`
**Date:** 2026-05-22
**Status:** Design approved; ready for implementation planning.

The legalese half of #356 (about pages, third-party notices) is already done. This
spec covers the remaining half: **account tiers, an admin role, an admin
account-search/info UI, and an admin "ban user" function** — plus verification of
the existing account self-deletion flow.

---

## 1. Background — what already exists

- **Account self-deletion (hard delete) is fully implemented**, server and client:
  - `deleteUser()` — `was-web/server/src/services/extensions.ts:365`
  - `DELETE /api/auth/me` — `was-web/server/src/auth/routes.ts:61`
  - `DeleteAccountModal.tsx` + the "Delete account…" button in `Navigation.tsx:200`
  - It already hard-deletes the `users` row, cascades adventures/maps/images,
    scrubs the user's images out of other people's spritesheets, nulls
    `map_changes.userId`, and audits S3 cleanup. **It matches the GDPR hard-delete
    requirement** — no rebuild needed, only end-to-end verification (incl. OIDC).
- **Account tiers half-exist**: a `users.level` column, a `UserLevel` enum
  (`Standard`/`Gold`), `getUserPolicy()`, and caps enforced on adventure/map/image
  creation. But `level` is hardcoded at sign-up and can never change; there is no
  `Admin`; there is no "Basic cannot upload images" gate.
- **Greenfield**: admin role, admin middleware, admin routes, ban/quarantine,
  soft-delete, account search/info pages. Zero `admin` references in the client.
- **No background job system** exists; `deleteUser()` and `deleteAdventure()` run
  synchronously in the request handler.

## 2. Settled design decisions

| Decision | Choice | Consequence |
|---|---|---|
| Ban lifecycle | **Permanent, no auto-purge.** No unban, no scheduler. | No background-job system needed. Operators can purge manually. |
| Tier defaults | **Everyone → Basic.** New and existing users start Basic; owner promotes individually. | Migration sets all users to `basic`; one admin must be bootstrapped. |
| Admin model | **Single `level` enum** (`basic`/`higher`/`admin`) — admin is a tier. | One column, one switch. Admin tier also carries the most generous limits. |
| Account deletion | **Stays a hard delete** — already implemented. | Out of scope except OIDC end-to-end verification. |
| OIDC re-creation | A deleted OIDC user who signs in again gets a **fresh empty account** (acceptable — data is erased; the Zitadel identity is the user's own to remove). | No tombstone table; no PII retained. |
| Background jobs | **Not adopted.** Ban runs synchronously like `deleteUser()`. | If S3 throughput ever bites, parallelise with a Promise pool — not a queue. |

## 3. Architecture — ban is a soft-delete sibling of delete

Ban and delete are the same operation with two swaps:

| | delete (exists) | ban (new) |
|---|---|---|
| own `users` row | `DELETE` | `SET banned_at` |
| own adventures / maps / images | `CASCADE` delete | `SET deleted_at` |
| own S3 image objects | S3 delete | S3 copy → `quarantine/`, then delete original |
| footprint in **other** users' content | ← identical scrub → | ← identical scrub → |

The "scrub footprint from other users' content" step is **extracted into a shared
helper** (`scrubUserFootprint`) that both `deleteUser()` and the new `banUser()`
call. See Session 4.

Both run synchronously, reusing `deleteUser()`'s established partial-failure
pattern: pre-transaction snapshot → DB transaction → post-transaction best-effort
S3 with `ORPHANED_S3_OBJECT` audit logging (`extensions.ts:249`).

## 4. Consolidated schema changes

All in `was-web/server/src/db/schema.ts`. New columns are nullable with no default,
so they apply instantly on existing rows (no table rewrite).

| Table | Change |
|---|---|
| `users` | `level` default `'standard'` → `'basic'`; add `CHECK (level IN ('basic','higher','admin'))`; add `bannedAt timestamptz NULL` |
| `adventures` | add `deletedAt timestamptz NULL`; `adventures_owner_id_idx` → partial `WHERE deleted_at IS NULL` |
| `maps` | add `deletedAt timestamptz NULL`; `maps_adventure_id_idx` → partial `WHERE deleted_at IS NULL` |
| `images` | add `deletedAt timestamptz NULL`; `images_user_id_idx` → partial `WHERE deleted_at IS NULL` |

`adventure_players`, `spritesheets`, `map_changes`, `invites` need **no new
columns** — they are reached through an adventure, so the adventure-level
`deletedAt` filter hides them. `map_changes_user_id_idx` already exists (for
delete's anonymisation scan) and is reused unchanged by the ban scrub.

**Migration** (`yarn db:generate` produces the DDL; data steps are hand-added to
the generated SQL file):

1. Add the four nullable columns + the `users` `CHECK` constraint; redefine the
   three partial indexes.
2. `UPDATE users SET level = 'basic';`
3. Change the `users.level` column default to `'basic'`.
4. **Admin bootstrap** — a documented one-off operator step, run once after
   deploy: `UPDATE users SET level = 'admin' WHERE email = '<owner-email>';`
   Not baked into the migration file (no hardcoded email).

Apply with `yarn db:push` (dev) / `yarn db:push:test` (test) / `yarn db:migrate`
(prod). The schema column/index changes land in Session 1 (`users.level` default +
`CHECK`) and Session 3 (`bannedAt` / `deletedAt` columns + partial indexes); each
session ships its own migration.

## 5. Tier model

`UserLevel` (`was-web/packages/shared/src/data/policy.ts`) becomes:

```ts
export enum UserLevel {
  Basic = "basic",
  Higher = "higher",
  Admin = "admin",
}
```

Proposed `IUserPolicy` limits — **tune freely; these are starting values**:

| Tier | adventures | images | maps | players | objects (warn) | admin pages |
|---|---|---|---|---|---|---|
| Basic | 2 | **0** | 6 | 6 | 4000 (3600) | no |
| Higher | 8 | 200 | 24 | 12 | 10000 (9000) | no |
| Admin | 50 | 2000 | 100 | 24 | 10000 (9000) | yes |

`images: 0` makes the existing `addImage()` cap check reject Basic uploads.

## 6. Session sequencing

Five sequential commits on `gh-356-compliance` (sequential commits on the current
branch — not separate PR branches). The chain is strictly linear; each session is
an independently reviewable commit:

1. **[Tier model rework](2026-05-22-gh356-session-1-tier-model.md)** — `UserLevel`
   Basic/Higher/Admin, policy, migration, Basic image-upload gate.
2. **[Admin role + read-only account-info](2026-05-22-gh356-session-2-admin-role.md)**
   — `adminMiddleware`, `/api/admin/*`, search + info UI (read-only).
3. **[Soft-delete schema + read-path filtering](2026-05-22-gh356-session-3-soft-delete.md)**
   — `deletedAt`/`bannedAt` columns, filter every read path, banned-user auth
   rejection.
4. **[Shared scrub core + ban service](2026-05-22-gh356-session-4-ban-service.md)**
   — extract `scrubUserFootprint`, implement `banUser()`, `POST .../ban`.
5. **[Admin actions UI](2026-05-22-gh356-session-5-admin-actions-ui.md)** —
   tier-change endpoint + UI, ban button + confirmation modal, e2e, docs.

## 7. Out of scope

- Rebuilding account self-deletion (already done — only verified end-to-end).
- Unban / restore-from-quarantine.
- Automatic purge of quarantined data.
- A background job system / scheduler.
- Reaping expired `invites` (pre-existing latent gap, unrelated to #356).
- Email notification to a banned user.
