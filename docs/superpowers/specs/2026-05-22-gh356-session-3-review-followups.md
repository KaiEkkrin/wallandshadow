# Session 3 review follow-ups — complete soft-delete coverage

Part of [GH-356](2026-05-22-gh356-account-tiers-and-admin-overview.md).
**Follows:** [Session 3 — Soft-delete schema + read-path filtering](2026-05-22-gh356-session-3-soft-delete.md).

## Context

Session 3 added the soft-delete machinery and filtered most read paths, but a
code review surfaced eight defects (one read leak, one quota miscount latent
in the current ban model, several missed lookups, a brittle path-comparison
guard, two cosmetic flow issues, and a partial-index regression).

## Settled design

**Soft-deleted entities appear deleted for every purpose except admin views.**

Concretely:
1. Invite-detail and invite-join error out ("no such adventure") for any
   adventure with `deleted_at` set.
2. Any read-or-resolve path users can reach must filter `deleted_at IS NULL` —
   even ones the original spec table missed (invites, owner-side mutations).
3. Soft-deleted rows do **not** consume tier quota (image, map, adventure caps
   count live rows only).
4. The admin account-info page is the only context where soft-deleted rows
   appear; that path is already deliberately unfiltered (Session 5 will
   annotate the rows as deleted).
5. Indexes are revisited so the queries above can use them, and the unfiltered
   admin queries can use them too. The current partial indexes don't serve the
   admin path.

## Findings

| # | Severity | File | Issue |
|---|---|---|---|
| 1 | medium | `routes/invites.ts:28` | `GET /api/invites/:id` joins `adventures` without `isNull(deletedAt)` — leaks a soft-deleted adventure's name + (banned) owner's display name to any user holding the invite id. The Session 3 overview claimed invites are covered by the adventure-level filter; they are not, because this endpoint goes around `assertAdventureMember`. |
| 2 | low-medium | `services/extensions.ts:1188` (`joinAdventure`) | Same omission for the join path: a stale invite can insert an `adventure_players` row into a soft-deleted adventure. The joiner never sees it, but the orphan membership would silently grant access if the row were ever undeleted. |
| 3 | low | `services/imageExtensions.ts:42` (`addImage` quota) and `services/extensions.ts:487` (`createMap` quota) | Quota counts have no `deletedAt` filter, so soft-deleted rows count toward `policy.images` / `policy.maps`. Also: these queries can no longer use the now-partial `images_user_id_idx` / `maps_adventure_id_idx` (Postgres can't use a partial index whose predicate the query doesn't restate) — sequential scans on every upload / map creation. |
| 4 | low | `services/adminExtensions.ts:107` (`getUserDetail`) | Admin aggregation deliberately omits `deleted_at IS NULL` and so cannot use the partial `adventures_owner_id_idx` / `maps_adventure_id_idx` / `images_user_id_idx`. No fallback non-partial index exists. The schema comment "read paths only ever query live rows" is contradicted by this admin read path. |
| 5 | low | `OidcCallback.tsx:36` | When `completeOidcLogin` detects suspension it now swallows the error and returns; `OidcCallback` then `navigate(getPostLoginPath(rawFrom), {replace:true})` to a protected route (e.g. `/app`). `SuspendedGate` masks the page, but the URL is wrong and inconsistent with the rejected-token path (which goes to `/login`). |
| 6 | low | `services/imageExtensions.ts:83` (`assertImageDownloadAccess` soft-delete guard) | The new lookup `eq(images.path, path)` uses the raw client-supplied path. `getImageUid` tolerates an optional leading slash; `images.path` is stored slash-free. `?path=/images/{owner}/{id}` skips the soft-delete check and falls into the owner shortcut. Unreachable today (owner of a soft-deleted image is banned), but a brittle guard in security-sensitive code. |
| 7 | low | `services/extensions.ts:191` (`assertAdventureOwner`), plus `cloneMap` (~514) source-map lookup, `consolidate` route map lookup (`routes/maps.ts:186`), `inviteToAdventure` (~775), `updateMap`, `deleteMap` | Write paths still resolve soft-deleted adventures/maps. Currently unreachable because `deleted_at` implies `bannedAt` on the owner (banned ⇒ `authMiddleware` 403), but the asymmetry violates the settled design "soft-deleted = deleted for every purpose". |
| 8 | low | `services/honoWebSocket.ts:273` | WS 4003 → `onAuthFailure` → `window.location.replace('/login')`. Until the post-reload `restoreSession` resolves, `UserContext.suspended` is undefined and the user briefly sees the Login form before `SuspendedGate` flips. Cosmetic on a rare mid-session-ban event. |

## Fixes

### 1. Invite endpoints — error on soft-deleted adventure

- `routes/invites.ts:16` `GET /api/invites/:id`: add `isNull(adventures.deletedAt)` to the `.where(...)`. A soft-deleted target → no row → existing `404 'Invite not found'`. (No need for a distinct error code — the invite is effectively gone.)
- `services/extensions.ts:1188` `joinAdventure`: add `isNull(adventures.deletedAt)` to the `for('update')` select. → `throwApiError('not-found', 'No such adventure')`.
- `services/extensions.ts:775` `inviteToAdventure`: add `isNull(adventures.deletedAt)` to its select. Unreachable today (owner is banned), but matches the "deleted everywhere" rule.

### 2. Write-path coverage — `assertAdventureOwner` and direct map lookups

- `services/extensions.ts:191` `assertAdventureOwner`: add `isNull(adventures.deletedAt)` to its select. This single change covers every owner-only mutation that calls it: `updateAdventure`, `updateMap`, `createMap`, `cloneMap`, `deleteMap`, `consolidateMapChanges` setup paths, plus `inviteToAdventure` if it routes through here (it doesn't today — fix that one separately, item 1).
- `services/extensions.ts` `cloneMap` source-map select: add `isNull(maps.deletedAt)`. Defense in depth — covers the (currently impossible) "live adventure, soft-deleted map" case.
- `routes/maps.ts:186` consolidate route's map+adventure select: add `isNull(mapsTable.deletedAt)`.
- `services/extensions.ts` `deleteMap`: the map lookup (~line 754) — add `isNull(maps.deletedAt)`. Deleting an already-soft-deleted map is a no-op anyway, but matches the rule.

### 3. Quota counts ignore soft-deleted rows

- `services/imageExtensions.ts:42` `addImage` count: `where(and(eq(images.userId, uid), isNull(images.deletedAt)))`.
- `services/extensions.ts:487` `createMap` count: `where(and(eq(maps.adventureId, adventureId), isNull(maps.deletedAt)))`.
- Check `createAdventure` for an adventure-count quota — if present, same treatment.
- Check `cloneMap` for a map-count quota — same treatment.

### 4. Image download path normalisation

- `services/imageExtensions.ts:72` `assertImageDownloadAccess` Case 1: strip a single leading `/` from `path` once at the top of the function, before any DB comparison. Reuse the normalised value for both the soft-delete lookup and the UNION's `${path}` interpolation, so a leading-slash request behaves identically to the canonical form. This also closes the pre-existing non-owner inconsistency (slashed path → UNION matches nothing → wrong 404 reason).

### 5. OIDC callback on suspension

- `OidcCallback.tsx`: after `await auth.completeOidcLogin(token)`, check the concrete `auth.suspended` flag (the `auth instanceof HonoAuth` check at line 32 is already in scope). If suspended, `navigate('/login', { replace: true })` and return. Symmetric with the rejected-token path; URL bar matches the Suspended page that's rendered.

### 6. WS 4003 → Suspended without flashing Login (optional)

Two options; pick (a) unless someone reports the flash.

- **(a) Live with it.** Mid-session ban is rare; the flash is < 1 RTT of `getMe()`. Documented as expected behaviour.
- **(b) `sessionStorage` handshake.** In `honoWebSocket.ts`, before the 4003 → reload, do `sessionStorage.setItem('was_was_suspended', '1')`. In `HonoAuth`'s constructor, read it: if set, `this.suspended = true` and `sessionStorage.removeItem(...)`. `HonoContextProvider`'s initial render then reads `auth.suspended === true` via the existing else-branch path **after** the first auth callback fires — needs a small tweak to fire it synchronously when the flag is present so `SuspendedGate` masks immediately.

### 7. Index inventory & adjustments

The three indexes Session 3 made partial don't serve the admin or cleanup
paths. Revert them to full.

#### Inventory — `adventures` table

| Caller | Predicate | Suitable index |
|---|---|---|
| `assertAdventureMember`, `assertAdventureOwner` (after fix), `snapshotAdventureDetail`, `snapshotMap`, `fetchAdventureMapPairs`, `deleteMap`, `cloneMap`, `joinAdventure`, `inviteToAdventure`, `createMap` | `id = ? [AND deleted_at IS NULL]` | PK — no `owner_id` index needed |
| `snapshotAdventures` (join from `adventure_players`) | `adventures.id = adventure_players.adventure_id AND adventures.deleted_at IS NULL` | PK on `adventures.id` |
| `adminExtensions.getUserDetail` | `owner_id = ?` (no `deletedAt`) | needs **full** `adventures_owner_id_idx` |
| `deleteUser` cleanup | `owner_id = ?` (no `deletedAt` — wants everything to delete) | needs **full** `adventures_owner_id_idx` |
| Any per-tier `policy.adventures` count (verify whether `createAdventure` has one) | `owner_id = ? AND deleted_at IS NULL` (after fix) | full index serves this too |

Decision: `adventures_owner_id_idx` → **full** (drop the `WHERE deleted_at IS NULL`).

#### Inventory — `maps` table

| Caller | Predicate | Suitable index |
|---|---|---|
| Every `id = ?` lookup | PK | PK |
| `listMaps`, `snapshotAdventureDetail`, `snapshotMap`, `fetchAdventureMapPairs`, `addMapChanges`, WS `map`/`mapChanges` subscribe, `consolidate` (after fix), `createMap` count (after fix), `cloneMap` count (verify) | `adventure_id = ? AND deleted_at IS NULL` | partial works |
| `adminExtensions.getUserDetail` maps join | `INNER JOIN adventures ON maps.adventure_id = adventures.id WHERE adventures.owner_id = ?` (no map-side `deletedAt`) | needs **full** `maps_adventure_id_idx` (so the per-adventure nested loop can find soft-deleted maps too) |
| `deleteUser` cleanup of maps (cascaded via FK on adventures; verify the audit-only queries) | `adventure_id = ?` (no `deletedAt`) | needs **full** index |

Decision: `maps_adventure_id_idx` → **full**.

#### Inventory — `images` table

| Caller | Predicate | Suitable index |
|---|---|---|
| `imagesList` route | `user_id = ? AND deleted_at IS NULL` | partial works |
| `addImage` count (after fix) | `user_id = ? AND deleted_at IS NULL` | partial works |
| `adminExtensions.getUserDetail` images | `user_id = ?` (no `deletedAt`) | needs **full** `images_user_id_idx` |
| `deleteUser` cleanup, `deleteUserS3Audit` — verify | `user_id = ?` | needs **full** index |
| `assertImageDownloadAccess` soft-delete lookup (new this PR) | `path = ?` | no index today — single-row, fine for now but consider `unique index on (path)` later if S3 layout changes |

Decision: `images_user_id_idx` → **full**.

#### Migration `0011_*.sql`

DROP and recreate each of the three indexes without the partial WHERE. Generate
via `yarn db:generate` after the schema edits; apply with `yarn db:push` (dev)
and `yarn db:push:test` (test).

If a future hot path is shown to benefit from a partial `WHERE deleted_at IS
NULL` form, add a partial index **alongside** the full one — Postgres will
pick the more selective one per query.

### 8. Schema comment

Update the inline comment on the three indexes in `schema.ts`. The current
"read paths only ever query live rows, so soft-deleted rows are excluded from
the index entirely" is wrong (admin reads all rows). New wording: "Full index
— admin and cleanup paths need to find soft-deleted rows."

## Tests

Add to `softDelete.test.ts`:

- `GET /api/invites/:id` for an invite to a soft-deleted adventure → `404`.
- `POST /api/invites/:id/join` against a soft-deleted adventure → `404` and **no** `adventure_players` row inserted.
- `PATCH /api/adventures/:id`, `POST /api/adventures/:id/maps`, `POST .../clone`, `PATCH/DELETE .../maps/:id`, `POST .../consolidate`, `POST /api/adventures/:id/invites` — each against a soft-deleted adventure → `404`.
- Image quota: a user with N live + M soft-deleted images can upload `policy.images − N` more (was: blocked at `N + M`).
- Map quota: same shape against an adventure with soft-deleted maps.
- `assertImageDownloadAccess` for `?path=/images/{owner}/{id}` (leading slash) → `404` if soft-deleted, and matches canonical-path behaviour for live images.
- OIDC suspension: assert `completeOidcLogin` + `OidcCallback` lands on `/login` (URL) — covered by a small `OidcCallback` unit test or e2e step.
- Regression: `GET /api/admin/users/:id` still returns soft-deleted adventures/maps/images (the deliberate non-filtering).

## Acceptance

- All eight findings closed; the read leak (#1) and join orphan (#2) tests pass.
- Three indexes are non-partial; the migration applies cleanly.
- `yarn lint` + `yarn build` clean (web + server); `yarn test` green (server + client).
- Schema comment on the three indexes describes the actual usage.

## Out of scope (still)

- Mid-session ban kicking already-open WebSockets (Session 4 concern).
- `notify.ts` broadcast on soft-delete (Session 4 chooses the wire shape).
- Unban / restore-from-quarantine (overview §2 — out of scope for #356).
