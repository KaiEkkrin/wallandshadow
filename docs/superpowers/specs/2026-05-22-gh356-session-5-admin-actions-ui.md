# Session 5 — Admin actions UI

Part of [GH-356](2026-05-22-gh356-account-tiers-and-admin-overview.md). **Depends on:** Session 4. **Final session.**

## Goal

Wire the two admin mutations — change a user's tier, and ban a user — into the
account-info page built in Session 2. Add end-to-end coverage and update the
project docs.

## Context

- `routes/admin.ts` + `adminMiddleware` (Session 2); `banUser()` +
  `POST /api/admin/users/:id/ban` (Session 4).
- The read-only account-info page and `IApi.adminGetUser` / `adminSearchUser`
  (Session 2).
- `was-web/src/components/DeleteAccountModal.tsx` — the typed-confirmation modal
  pattern to mirror for the ban confirmation.
- `notifyUserProfile()` — `was-web/server/src/ws/notify.ts` — pushes a profile
  refresh to a user's client.

## Changes

### Server — tier-change endpoint

- `PATCH /api/admin/users/:id` in `routes/admin.ts`, behind `adminMiddleware`:
  body `{ level: 'basic' | 'higher' | 'admin' }`; validate against `UserLevel`;
  `UPDATE users SET level = ... WHERE id = :id`.
- Guard: an admin **cannot change their own level** (prevents self-lockout) →
  `403` / `400`.
- After the update, `notifyUserProfile(:id)` so the affected user's client picks
  up the new caps live.
- Returns the updated `IAdminUserSummary`.
- (The ban endpoint already exists from Session 4.)

### Client — API surface

- `IApi`: add `adminSetUserLevel(id: string, level: UserLevel):
  Promise<IAdminUserSummary>` and `adminBanUser(id: string):
  Promise<IAdminUserSummary>`.
- Implement both in `honoApiClient.ts`.

### Client — account-info page actions

The account-info page (`/admin/users/:id`) gains, alongside the existing summary +
three tables:

- **Tier selector** — a Basic/Higher/Admin dropdown with an Apply action →
  `adminSetUserLevel`. Disabled on the admin's own account row.
- **Ban button** — opens a confirmation modal mirroring `DeleteAccountModal`
  (type the target's name or email to confirm) → `adminBanUser`. Hidden or
  disabled when the target is already banned or is an admin.
- **Banned-state display** — a "Banned" badge and the `bannedAt` timestamp; the
  three tables annotate soft-deleted rows (e.g. greyed with a "deleted" tag),
  consistent with Session 3's decision that admin queries still surface a banned
  account's content.
- Success and failure surface via the project's standard toast / inline-error
  pattern; errors are logged with context (`logError`).

### Docs

- `CLAUDE.md` — document the `/api/admin/*` routes, the three-tier model, and the
  admin role.
- `docs/REPLATFORM.md` — add the admin routes to the REST API table; note the
  `admin` level and the ban behaviour in the account-types section.

## Tests

- **Server integration:** `PATCH /api/admin/users/:id` validates `level`; an admin
  changing their own level is rejected; a successful change triggers a profile
  notify.
- **E2E (`e2e/`):**
  - An admin promotes a Basic user to Higher; the promoted user can then upload an
    image.
  - An admin bans a user via the confirmation modal; the banned user is locked out
    and lands on the `Suspended` page.
  - A non-admin cannot reach `/admin`.

## Acceptance criteria

- An admin can change any other user's tier and ban any non-admin user, entirely
  from the account-info page.
- An admin cannot demote themselves or ban themselves / another admin.
- A banned user is locked out immediately and sees the `Suspended` page.
- A promoted user's new caps take effect without a re-login (profile notify).
- `CLAUDE.md` and `docs/REPLATFORM.md` are updated.
- Full `yarn lint` + `yarn build` + `yarn test:unit` + `yarn test:server` +
  `yarn test:e2e` green.

## Out of scope

- Unban / restore from quarantine — bans are permanent by design.
