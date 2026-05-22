# Session 4 — Shared scrub core + ban service

Part of [GH-356](2026-05-22-gh356-account-tiers-and-admin-overview.md). **Depends on:** Sessions 2 & 3. **Followed by:** Session 5.

## Goal

Extract the shared "scrub the user's footprint from other users' content" logic
out of `deleteUser()`, implement `banUser()` on top of it, and expose
`POST /api/admin/users/:id/ban`. Also verify the existing OIDC account-deletion
flow end-to-end.

## Context

- `deleteUser()` — `was-web/server/src/services/extensions.ts:365-453`. Its
  transaction body (lines ~397-442) already does the footprint scrub: delete the
  user's `adventure_players` rows, delete their `invites`, scrub their images out
  of other adventures' `imagePath` / `map_images` / spritesheets, and null
  `map_changes.userId`.
- `auditedDeleteS3()` — `extensions.ts:249` — the `ORPHANED_S3_OBJECT` audit
  pattern for post-transaction S3 cleanup.
- `was-web/server/src/services/storage.ts` — S3 wrapper; has `deleteMany()`
  (batches of 1000) and `ref(path).put(...)`. **No copy operation yet.**
- `getSpritePathFromId()` — maps a spritesheet id to its `sprites/{id}.png` key.
- `adminMiddleware` + `routes/admin.ts` (Session 2); `bannedAt` / `deletedAt`
  columns + read-path filtering (Session 3).

## Changes

### Refactor — extract `scrubUserFootprint`

Pull `deleteUser()`'s shared logic into a helper in `extensions.ts`:

```
scrubUserFootprint(tx, uid, imagePaths): Promise<Set<string>>
```

It performs, inside the caller's transaction:
- `DELETE adventure_players WHERE userId = uid`
- `DELETE invites WHERE ownerId = uid`
- if `imagePaths` non-empty: null matching `adventures.imagePath` / `maps.imagePath`;
  `DELETE map_images` matching; scrub matching spritesheets via the GIN-indexed
  `@>` loop (set slots to `''`, increment `freeSpaces`)
- `UPDATE map_changes SET userId = NULL WHERE userId = uid`
- returns the set of affected spritesheet adventure ids (for notification)

`deleteUser()` becomes: snapshot → `tx { delete own adventures; scrubUserFootprint;
delete users row }` → `auditedDeleteS3` → notify. **Behaviour unchanged** — the
existing delete tests must stay green.

### Storage — add a copy operation

Add `storage.copy(srcKey, dstKey)` to `storage.ts`, using the S3
`CopyObjectCommand`. A "move to quarantine" is copy-then-delete (S3 has no rename).

### `banUser(db, storage, logger, adminUid, targetUid)`

New service function in `extensions.ts` (or a dedicated `banExtensions.ts`).

**Guards** (before any write):
- target exists, else `404`;
- `targetUid !== adminUid` — no self-ban;
- `target.level !== 'admin'` — admins cannot be banned (demote first);
- `target.bannedAt IS NULL`, else `409` already banned.

**Pre-transaction snapshot:** the target's image rows (`id`, original `path`);
their adventures' ids and spritesheet ids; co-members of their adventures; their
memberships in other users' adventures.

**Transaction:**
- `UPDATE users SET bannedAt = now() WHERE id = targetUid`
- `UPDATE adventures SET deletedAt = now() WHERE ownerId = targetUid`
- `UPDATE maps SET deletedAt = now() WHERE adventureId IN (<target's adventures>)`
- `UPDATE images SET deletedAt = now(), path = regexp_replace(path, '^images/',
  'quarantine/') WHERE userId = targetUid`
- `scrubUserFootprint(tx, targetUid, <original image paths>)` — scrubs the banned
  user's images out of *other* users' content, exactly as delete does.

**Post-transaction S3** (best-effort, audited — reuse / generalise the
`ORPHANED_S3_OBJECT` pattern):
- for each image: `copy(images/{uid}/{id} → quarantine/{uid}/{id})`, then delete
  the originals in a batch via `deleteMany`;
- for each of the target's adventures' spritesheet PNGs:
  `copy(sprites/{id}.png → quarantine/sprites/{id}.png)`, then delete the original.
- A failed copy or delete is logged at Error level with a stable marker (e.g.
  `ORPHANED_S3_OBJECT context=user-ban`) — never thrown; the DB state is the
  source of truth and the ban has already succeeded.

**After:** disconnect the banned user's live WebSocket connection(s); notify the
affected adventures / co-members so their UIs drop the now-inaccessible content.

### Route

`POST /api/admin/users/:id/ban` in `routes/admin.ts`, behind `adminMiddleware` →
`banUser(...)`. Returns the updated `IAdminUserSummary`.

### OIDC delete verification

Add (or confirm) a test proving an OIDC-authenticated user can delete their own
account via `DELETE /api/auth/me` and is RP-logged-out. The flow already exists
(`DeleteAccountModal` → `api.deleteMe()` → `auth.signOut()`); this just locks it in
with coverage.

## Tests

- **Server integration — ban:** seed a target with adventures, maps, images,
  spritesheets, and membership in *another* user's adventure that uses one of the
  target's images. Ban, then assert:
  - `users.bannedAt` set; the target's adventures/maps/images have `deletedAt` set;
  - `images.path` rewritten to `quarantine/...`;
  - the S3 objects physically moved to `quarantine/` (originals gone);
  - the target's images scrubbed from the *other* user's spritesheet (slot `''`,
    `freeSpaces` incremented);
  - `map_changes.userId` nulled; the target's `adventure_players` / `invites` gone;
  - the banned user gets `403 account-suspended`.
- **Guards:** self-ban rejected; banning an admin rejected; double-ban → `409`.
- **Regression:** the existing `deleteUser` tests pass unchanged after the refactor.
- **OIDC delete:** the verification test above.

## Acceptance criteria

- `scrubUserFootprint` is shared by `deleteUser` and `banUser`; delete behaviour is
  unchanged.
- `banUser` soft-deletes the target's own content, quarantines their S3 objects,
  scrubs their footprint from other users' content, and disconnects their socket.
- All guards hold; partial S3 failures are audit-logged, never fatal.
- `POST /api/admin/users/:id/ban` works behind `adminMiddleware`.
- `yarn lint` + `yarn build` clean (web + server); tests green.

## Out of scope

- The admin UI for triggering a ban or changing a tier (Session 5).
- Unban / restore from quarantine (not built — bans are permanent).
