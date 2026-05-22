# Session 2 — Admin role + read-only account-info

Part of [GH-356](2026-05-22-gh356-account-tiers-and-admin-overview.md). **Depends on:** Session 1. **Followed by:** Session 3.

## Goal

Introduce the admin role gate (`adminMiddleware`) and a **read-only** admin
account-search + account-info UI. Search is by exact email or exact ID — there is
no "list all accounts". The account-info page shows a user summary and three
tables (adventures, maps, images owned). No mutating actions yet.

## Context

- `was-web/server/src/auth/middleware.ts` — `authMiddleware` resolves the Bearer
  token to `uid` and sets it on the Hono context.
- `was-web/server/src/routes/` — existing route modules; the main app mounts them
  (see the server entrypoint, e.g. `server/src/index.ts` / `app.ts`).
- `was-web/packages/shared/src/services/interfaces.ts` — `IApi` typed REST surface.
- `was-web/src/services/honoApiClient.ts` — `IApi` implementation.
- `was-web/src/components/Navigation.tsx` — top nav.
- Routing lives in the SPA (`src/*.tsx` top-level pages + router setup).

## Changes

### Server — admin middleware

- Add `adminMiddleware` (in `auth/middleware.ts` or a new `auth/adminMiddleware.ts`):
  composes `authMiddleware`, then loads the `users` row for `uid` and requires
  `level === 'admin'`. Otherwise `403`.
  - Note: the `bannedAt` check is **not** added here — that column does not exist
    until Session 3, which extends the active-user check. Leave a `TODO(session-3)`.

### Server — admin routes

New `was-web/server/src/routes/admin.ts`, mounted at `/api/admin`, all handlers
behind `adminMiddleware`:

| Route | Purpose |
|---|---|
| `GET /api/admin/users?email=<exact>` | Exact (lowercased) email match → user summary, or `404`. |
| `GET /api/admin/users?id=<uuid>` | Exact id match → user summary, or `404`. |
| `GET /api/admin/users/:id` | Full account info — summary + 3 tables. |

- The search endpoint requires **exactly one** of `email` / `id`; reject `400`
  otherwise. No pagination, no listing.
- `GET /api/admin/users/:id` returns:
  - **summary**: `id`, `email`, `name`, `level`, `createdAt`, `emailVerified`,
    whether the account is OIDC (`providerSub` present) or local.
  - **adventures owned**: `id`, `name`, `createdAt`, map count.
  - **maps owned** (across the user's adventures): `id`, `name`, owning adventure
    name, `ty`.
  - **images owned**: `id`, `name`, `path`, `createdAt`.
- Keep handlers thin: validate → call a service function in
  `server/src/services/` (e.g. `adminExtensions.ts`) → return. Aggregation queries
  live in the service.

### Shared types

Add to `packages/shared` (e.g. `data/admin.ts`, re-exported from `index.ts`):
`IAdminUserSummary` and `IAdminUserDetail` (summary + `adventures[]` + `maps[]` +
`images[]`). Both server responses and the client consume these.

### Client — API surface

- `IApi`: add `adminSearchUser(query: { email: string } | { id: string }):
  Promise<IAdminUserSummary | undefined>` and `adminGetUser(id: string):
  Promise<IAdminUserDetail>`.
- Implement both in `honoApiClient.ts`. A `404` from search resolves to
  `undefined` (not an error); a `404` from `adminGetUser` bubbles as an error.

### Client — pages and nav

- New pages: an admin **search page** (route `/admin`) and an **account-info
  page** (route `/admin/users/:id`). Follow the existing top-level page pattern in
  `src/`.
- Route guard: both routes render only when `profile.level === 'admin'`; otherwise
  redirect home (or render not-found). Non-admins must not be able to reach them.
- `Navigation.tsx`: show an "Admin" nav link **only** when
  `profile.level === 'admin'`.
- The account-info page: a summary card + three read-only tables (adventures,
  maps, images). No action buttons — those arrive in Session 5.

## Tests

- **Server integration:**
  - Every `/api/admin/*` route returns `403` for a non-admin and `200` for an
    admin.
  - Search by email: hit returns the summary; miss returns `404`.
  - Search by id: hit / miss.
  - `GET /api/admin/users/:id` aggregates the three tables correctly (seed a user
    with adventures, maps, images).
  - Search with neither / both query params → `400`.
- **E2E (`e2e/`):** an admin sees the "Admin" link and can search to an
  account-info page; a non-admin does not see the link and cannot reach `/admin`.

## Acceptance criteria

- `adminMiddleware` gates all `/api/admin/*` routes; non-admins get `403`.
- Exact-match search by email and by id works; no listing endpoint exists.
- The account-info page shows the user summary and the three tables.
- The Admin nav link and admin routes are invisible/unreachable for non-admins.
- `yarn lint` + `yarn build` clean (web + server); tests green.

## Out of scope

- Ban, tier change, and any mutation (Session 5).
- Soft-delete filtering — it does not exist yet, so the three tables show live
  content. Session 3 introduces soft-delete; per its design note the admin
  aggregation queries deliberately keep showing **all** rows (including
  soft-deleted ones) so an admin can still inspect a banned account. Session 5
  annotates those rows.
