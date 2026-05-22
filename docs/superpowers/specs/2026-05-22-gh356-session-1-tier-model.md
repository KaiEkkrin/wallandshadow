# Session 1 — Tier model rework

Part of [GH-356](2026-05-22-gh356-account-tiers-and-admin-overview.md). **Depends on:** nothing. **Followed by:** Session 2.

## Goal

Replace the vestigial `Standard`/`Gold` tiers with `Basic`/`Higher`/`Admin`,
enforce "Basic cannot upload images", migrate every existing user to `Basic`, and
bootstrap one `Admin` account. No admin features yet — this session only changes
the tier vocabulary, limits, defaults, and the image-upload gate.

## Context

- `was-web/packages/shared/src/data/policy.ts` — `UserLevel` enum, `IUserPolicy`,
  the `standardUser`/`goldUser` constants, `getUserPolicy()`.
- `was-web/server/src/db/schema.ts:20-35` — `users` table; `level` is
  `text('level').notNull().default('standard')`.
- `was-web/server/src/auth/routes.ts:99` — local register inserts `level: 'standard'`.
- `was-web/server/src/auth/resolveToken.ts:95` — OIDC first-login inserts `level: 'standard'`.
- `getUserPolicy(... as UserLevel)` call sites: `extensions.ts:302` (createAdventure),
  `extensions.ts:490` (createMap), `imageExtensions.ts:31,39` (addImage), plus the
  per-map object-cap check, and client policy hooks (`All.tsx`, `Adventure.tsx`,
  `Map.tsx`, etc.).

## Changes

### Shared — `policy.ts`

- `UserLevel` → `{ Basic = "basic", Higher = "higher", Admin = "admin" }`.
- Replace `standardUser`/`goldUser` with `basicUser`/`higherUser`/`adminUser`
  `IUserPolicy` constants using the limits below.
- `getUserPolicy()` — exhaustive 3-way `switch`; default case unreachable.
- Add a helper `canUploadImages(level)` → `getUserPolicy(level).images > 0`, and/or
  `isAdmin(level)` → `level === UserLevel.Admin`, for reuse by later sessions.

**Proposed limits (tune freely):**

| Tier | adventures | images | maps | players | objects | objectsWarning |
|---|---|---|---|---|---|---|
| Basic | 2 | 0 | 6 | 6 | 4000 | 3600 |
| Higher | 8 | 200 | 24 | 12 | 10000 | 9000 |
| Admin | 50 | 2000 | 100 | 24 | 10000 | 9000 |

### Server — schema + migration

- `schema.ts`: `users.level` default `'standard'` → `'basic'`; add
  `check('users_level_check', sql\`level IN ('basic','higher','admin')\`)`.
- Migration (`yarn db:generate`, then hand-add the data step):
  1. `ALTER` the default + add the `CHECK` constraint.
  2. `UPDATE users SET level = 'basic';` (covers all current values, incl. legacy
     `'standard'`/`'gold'`).
- **Admin bootstrap**: document the one-off operator step in the migration's PR
  description and in `docs/DEVELOPMENT.md` — `UPDATE users SET level = 'admin'
  WHERE email = '<owner-email>';`. Do **not** hardcode an email in the migration.
- `auth/routes.ts` + `auth/resolveToken.ts`: drop the explicit `level: 'standard'`
  from both inserts so the new `'basic'` column default applies (or set `'basic'`
  explicitly — pick one and be consistent).

### Server — image-upload gate

- `imageExtensions.ts addImage()`: when the user's policy has `images === 0`,
  throw a clear, tier-specific error (`throwApiError('permission-denied', 'Your
  account tier does not permit image uploads.')`) **before** the count query —
  the existing "you already have the maximum number of images" message is
  misleading at a cap of 0.

### Client

- `IProfile.level` is already typed `UserLevel`; no type change, but verify all
  `getUserPolicy(profile.level)` consumers still compile.
- Image-upload affordance: wherever the client offers image upload (image picker /
  sprite picker components), disable or hide the upload control when
  `getUserPolicy(profile.level).images === 0`, with a short explanatory note
  ("Image upload is not available on the Basic tier"). Find the component(s) via a
  search for the image-upload call into `IApi`.

## Tests

- **Unit (`unit/`, Vitest):** `getUserPolicy` returns the right policy for each of
  the three levels; `canUploadImages` / `isAdmin` helpers.
- **Server integration (`yarn test:server`):**
  - A `Basic` user's image upload is rejected with the tier-specific message.
  - A `Higher` user's image upload succeeds.
  - Adventure/map creation caps enforce the new Basic limits.
- Confirm the migration leaves every pre-existing user at `level = 'basic'`.

## Acceptance criteria

- `UserLevel` is `Basic`/`Higher`/`Admin`; `getUserPolicy` is exhaustive.
- New sign-ups (local **and** OIDC) default to `basic`.
- A Basic user cannot upload images (server rejects; client affordance disabled).
- The migration sets every existing user to `basic`; the admin-bootstrap step is
  documented.
- `yarn lint` + `yarn build` clean in both `was-web/` and `was-web/server/`;
  `yarn test:unit` and `yarn test:server` green.

## Out of scope

- Admin middleware, routes, and UI (Session 2).
- Changing a user's tier at runtime (Session 5).
- `bannedAt` / `deletedAt` columns (Session 3).
