# Session 3 — Soft-delete schema + read-path filtering

Part of [GH-356](2026-05-22-gh356-account-tiers-and-admin-overview.md). **Depends on:** Session 2. **Followed by:** Session 4.

## Goal

Add the soft-delete machinery — `bannedAt` on `users`, `deletedAt` on
`adventures`/`maps`/`images` — and make **every read path** honour it, plus reject
banned users at auth time. This session is behaviourally a near-no-op: nothing yet
*writes* these columns (that is Session 4). That is deliberate — it isolates the
most invasive, widest-blast-radius change so it can be reviewed and tested on its
own, by setting columns directly in tests.

## Context

- `was-web/server/src/db/schema.ts` — table definitions and indexes.
- Read paths: `routes/adventures.ts`, `routes/maps.ts`, `routes/images.ts`,
  `routes/players.ts`, and their service functions in `services/extensions.ts` /
  `services/imageExtensions.ts`.
- `was-web/server/src/ws/subscriptions.ts` — `fetchMeRow`, profile aggregation,
  map-change subscriptions; the WS upgrade handler.
- `imageExtensions.ts:68` — `assertImageDownloadAccess()`.
- `spriteExtensions.ts` — montage building (already drops sources that 404).
- `was-web/src/services/recentMaps.ts` — client recent-maps cache.
- `auth/middleware.ts` — `authMiddleware`.

## Changes

### Schema + migration

- `schema.ts`:
  - `users`: add `bannedAt timestamptz NULL`.
  - `adventures`, `maps`, `images`: add `deletedAt timestamptz NULL`.
  - Make these partial: `adventures_owner_id_idx`, `maps_adventure_id_idx`,
    `images_user_id_idx` each gain `.where(sql\`deleted_at IS NULL\`)`.
- Migration: add the four columns (instant — nullable, no default); drop & recreate
  the three indexes as partial.

### Read-path filtering — add `deleted_at IS NULL` everywhere content is read

| Read path | Behaviour |
|---|---|
| `GET /api/adventures` (list) | Exclude soft-deleted adventures. |
| `GET /api/adventures/:id` | `404` if soft-deleted. |
| `GET /api/adventures/:id/maps` | Exclude soft-deleted maps. |
| `GET /api/adventures/:id/maps/:id` | `404` if the map *or* its adventure is soft-deleted. |
| `GET /api/images` (image list) | Exclude soft-deleted images. |
| Profile aggregation (`fetchMeRow` / profile builder) | Adventure summaries exclude soft-deleted adventures. |
| WS subscriptions (`subscriptions.ts`) | Subscribing to a soft-deleted map/adventure fails cleanly. |
| WS `mapChange` submission | Reject changes targeting a soft-deleted map. |
| `assertImageDownloadAccess` | A soft-deleted image → `404` (before the existing path checks resolve). |
| Spritesheet montage (`spriteExtensions.ts`) | Skip source images that are soft-deleted (same handling as the existing 404/missing case). |
| `GET /api/adventures/:id/players` | Covered by the adventure-level `404`; no per-row change. |
| Admin queries (Session 2) | The account-info tables now naturally exclude soft-deleted rows — confirm the new filter reaches them, or keep them showing all rows deliberately (see note). |

> **Admin-page note:** decide explicitly — the admin account-info page is most
> useful if it *still shows* a banned user's (now soft-deleted) content, annotated.
> Recommended: the admin aggregation queries deliberately **do not** apply the
> `deleted_at IS NULL` filter, so an admin can still inspect a banned account.
> Session 5 annotates those rows as deleted.

### Banned-user rejection

- Extend `authMiddleware` (or add a thin `requireActiveUser` step composed after
  it, applied to all `/api/*` routes) to look up the `users` row after resolving
  `uid` and reject `bannedAt IS NOT NULL` with `403` and a distinguishable body:
  `{ error: 'account-suspended' }`. One indexed PK lookup per request — acceptable.
- WS upgrade handler: reject banned users the same way.
- `adminMiddleware` (from Session 2): add the `bannedAt IS NULL` check now
  (resolve the `TODO(session-3)`).
- Client: on a `403 account-suspended` response (in particular from the initial
  `/auth/me` call), route to a new **`Suspended`** page instead of the app — a
  short, plain message that the account has been suspended. Do not loop the user
  back through login.

## Tests

All tests in this session set the new columns **directly** (no `banUser` yet):

- **Server integration:** for each read path in the table above — insert a row,
  set its `deletedAt`, assert it is excluded from the list / returns `404`.
- A user with `bannedAt` set gets `403 account-suspended` on a representative API
  route and on WS upgrade.
- A soft-deleted image returns `404` from the download-access path.
- A spritesheet montage built over a soft-deleted source image skips it (no 500).
- **Client:** a `403 account-suspended` from `/auth/me` lands on the `Suspended`
  page.

## Acceptance criteria

- The four columns and three partial indexes exist; migration applies cleanly to
  dev and test DBs.
- Every read path in the table excludes soft-deleted rows / rejects as specified.
- Banned users receive `403 account-suspended` from the API and WS and see the
  `Suspended` page.
- No code yet writes `bannedAt` / `deletedAt`, so behaviour for live data is
  unchanged — existing tests stay green.
- `yarn lint` + `yarn build` clean (web + server); tests green.

## Out of scope

- `banUser()` and anything that *writes* the soft-delete columns (Session 4).
- Admin UI annotation of soft-deleted rows (Session 5).
