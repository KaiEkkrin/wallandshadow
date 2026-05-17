# PR #353 Review — Action Items

"Rollup of miscellaneous improvements" · branch `gh-136-etc-rollup-improvements`

96 files, ~4,800 insertions / ~3,350 deletions. Web lint, server lint, and server
`tsc --noEmit` all pass clean. Items below are numbered and actionable, grouped by
severity.

> **Status update:** the easily-fixed subset has been applied on this branch —
> items **1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15, 18, 23, 25, 26, 27, 29** (marked ✅ below). Client lint/build,
> server tsc/lint, and all 233 client + 168 server tests pass. The rest stand as
> follow-up work.

---

## Critical (fix before merge)

1. ✅ **Account deletion can silently leave user data in S3.**
   `server/src/services/extensions.ts` (`bestEffortDeleteS3` ~225–237, called from
   `deleteUser` ~390); `server/src/auth/routes.ts:60-64`.
   `bestEffortDeleteS3` logs failed S3 deletes only at Warning and never throws, then
   the route returns `{ ok: true }`. For a GDPR-relevant account deletion, a failure to
   erase uploaded images/spritesheet PNGs is an Error-level event.
   **Resolved:** added `auditedDeleteS3`, used by `deleteUser` in place of
   `bestEffortDeleteS3`. It logs every leaked path at Error level on its own line with a
   stable `ORPHANED_S3_OBJECT context=user-delete uid=… path=…` marker — the error log
   is the re-runnable list. A whole-batch throw reports all paths (chunked deletes can't
   tell which committed; over-reporting is safe as the re-run is idempotent). The route
   still returns `{ ok: true }` — the erasure itself succeeded; the orphan log is an
   operator signal. The misleading "safe to re-run with the same path list" comment on
   `bestEffortDeleteS3` was corrected. Covered by `deleteUserS3Audit.test.ts`.

2. ✅ **`recentMaps.readFromStorage` is a forbidden empty catch.**
   `src/services/recentMaps.ts:16-18` — `catch { return []; }` swallows
   `JSON.parse`/localStorage failures with no log, violating CLAUDE.md "all errors must
   be logged". Log a warning on corrupt storage. Also resolve the asymmetry:
   `writeToStorage` (line 21-23) does not catch at all, so a write quota error crashes —
   pick one deliberate policy for read and write.

---

## Important (should fix)

3. ✅ **`createMontage` permanently drops valid sprites on transient S3 errors.**
   `server/src/services/spriteExtensions.ts:33-44` — the catch treated a transient S3
   timeout/throttle (503 SlowDown, credential error) identically to a genuinely-deleted
   image; the empty slot was written into `spritesheets.sprites` permanently.
   **Resolved:** `Storage.download` now throws a typed `StorageObjectNotFoundError`
   (`storage.ts`) for a genuine S3 404, distinct from transient failures — AWS SDK
   error-shape knowledge stays inside the one file that imports the SDK. `createMontage`
   downloads through a `downloadWithRetry` helper: a `StorageObjectNotFoundError` warns
   and drops the slot (the legitimate self-heal case); any other error is retried up to
   3× with backoff (covers shared-storage hiccups without a background job) and, if it
   persists, is logged at Error level and re-thrown to **abort the whole montage**.
   `writeNewSpritesheets` runs the montages with `Promise.allSettled` so an abort still
   rolls back the `refs` increment (existing catch) and best-effort deletes the assembled
   PNGs of any montage that did complete — no orphan, no partial write. A user retry
   re-montages cleanly because nothing was persisted. Covered by `createMontageErrors.test.ts`.

4. ✅ **`writeNewSpritesheets` rollback can mask the root-cause exception.**
   `server/src/services/spriteExtensions.ts:247-258` — if the rollback `db.transaction`
   throws, `throw e` never runs and the original error is lost. Wrap the rollback so its
   failure is logged (Error level — a `refs` leak is real) without supplanting `e`.

5. ✅ **`deleteImage` skips token/character scrub when no spritesheet references the image.**
   `server/src/services/imageExtensions.ts:184-186` — both scrub loops were nested inside
   iteration over `affectedAdventureIds`, which is populated only from spritesheet rows
   containing the path. A sprite referenced by a token/character but absent from any
   current sheet left a dangling reference after the S3 object was deleted.
   **Resolved:** the map-token scrub now runs from its own `selectDistinct` over
   `map_changes` containment, and the character scrub from its own `adventure_players`
   containment query — both independent of the spritesheet set. The single
   `affectedAdventureIds` set was split into `spritesheetAdventureIds` and
   `playerAdventureIds`, which also fixes a pre-existing imprecision (`notifyAdventurePlayers`
   previously fired for spritesheet-affected adventures with no character change).
   Covered by two new `storage.test.ts` cases that reproduce the sheet-less token and
   character scenarios.

6. ✅ **New `PUT .../characters/:characterId` route does not validate the body.**
   `server/src/routes/players.ts:69-73` — `c.req.json<ICharacter>()` is persisted via
   `upsertCharacter` after only an `id` check. Add shape validation at the route
   boundary per CLAUDE.md. (The pre-existing PATCH route shares this weakness.)
   **Resolved:** added `assertValidCharacter` — a route-boundary assertion that rejects
   any body whose `id`/`name`/`text`/`sprites` (and each `ISprite`'s `source`/`geometry`)
   is not the right type, throwing `invalid-argument` (400). It is applied in the PUT
   route (before the id-laundering check) and in the PATCH route via
   `assertValidPlayerPatch`, which also requires `allowed` to be a boolean and validates
   every element of `characters`. Validation is shape/type only — `text` length and the
   `maxCharacters` cap stay unenforced (per the `character.ts` comment). A shared
   `assertObject` helper backs both validators. Covered by new `characterEndpoints.test.ts`
   cases; one pre-existing `ws.test.ts` test that sent a partial character was corrected.

7. ✅ **Unchecked `as` casts on WebSocket wire data.**
   `src/services/honoLiveData.ts:186, 190, 299` — `data` arrives as `unknown`; CLAUDE.md
   requires `unknown` + type guards. At minimum narrow `snap.changes` is an array before
   iterating in `watchMapChanges`. (The generic `emit(data as T)` in `dedupedHandlers` is
   harder to remove without the discriminated-union change in item 19.)
   **Resolved:** added `isMapChangesSnapshot` / `isMapChangesUpdate` type guards;
   `watchMapChanges` now narrows the `unknown` frame in `onSnapshot`/`onUpdate` and
   `logError`s + drops a malformed frame instead of throwing on iteration. The guards
   check only the outer frame shape — `decode()` already validates each `Changes` via the
   shared converter. The `emit(data as T)` cast in `dedupedHandlers` (line 299) is left
   for item 19, as noted.

8. ✅ **`IMe` / `MeResponse` are structurally identical but unrelated types.**
   `shared/src/services/api.ts:13-19` vs `src/services/honoApiClient.ts:10-16`.
   `HonoApi.getMe()` (`honoApi.ts:43-45`) compiles only because the shapes coincide; the
   `me` payload shape is re-declared a third time inline in `watchProfile`
   (`honoLiveData.ts:135`). Map `MeResponse → IMe` explicitly, or alias the types.

9. ✅ **Stale TODO contradicts shipped code.**
   `shared/src/services/api.ts:49-52` — the comment calls `editCharacter`/
   `deleteCharacter` a temporary RMW-and-PATCH hack pending "dedicated POST/DELETE
   character endpoints (TODO GH-136)", but those endpoints exist on this branch
   (`players.ts:60, 74`) and `HonoApi.editCharacter` already uses `client.putCharacter`.
   Delete the TODO.

10. ✅ **`HonoApi.listMaps` softens `getAdventure` but not `getMaps`.**
    `src/services/honoApi.ts:133-145` — inconsistent with the carefully-commented
    `listPlayers`. If the adventure was deleted, `getMaps` 404s and throws before the
    softened `getAdventure` matters, making the `emptyAdventureRow` fallback partly dead
    code. Either remove the fallback or add a comment matching `listPlayers` explaining
    the real case it handles.
    **Resolved:** kept the fallback (removing it would make `listMaps` 500 in the race
    below, inconsistent with `listPlayers`) and added a comment matching the
    `listPlayers` precedent. The fallback genuinely covers the narrow race where the
    adventure is deleted *after* `getMaps` has already responded but *before*
    `getAdventure` does — the two run concurrently, so `getMaps` can succeed while
    `getAdventure` 404s. The comment also states why `getMaps` is *not* softened: a
    `getMaps` failure leaves no map list to emit, so it must propagate. Existing
    `honoApi.test.ts` cases already cover the 404-fallback and 500-propagation paths.

11. ✅ **`recentMaps.ts` has zero behavioural tests.**
    `src/services/recentMaps.ts` — untested branching: `markMapRecent` dedup /
    unchanged-short-circuit / prepend-vs-update-in-place, `forgetMap` same-reference
    short-circuit, the `maxProfileEntries` cap, and `readFromStorage`'s corrupt-storage
    path. Add a unit test (the `unit/services/expiringStringCache.test.ts` pattern fits).
    **Resolved:** added `unit/services/recentMaps.test.ts` covering new-entry prepend,
    unchanged-short-circuit, in-place (position-stable) update, the prepend cap at
    `maxProfileEntries`, `forgetMap` removal and absent-map case, localStorage
    persistence, `recentMaps$` emissions, and the corrupt-storage path (invalid JSON →
    `[]` + a logged warning). A minimal in-memory `localStorage` stub is installed via
    `vi.stubGlobal` (the Vitest `node` env has none); each test uses a unique uid to
    isolate the module-level `BehaviorSubject` cache.

12. ✅ **`mapChangeConsolidator.ts` is untested.**
    `src/models/mapChangeConsolidator.ts` — `watchChangesAndConsolidate` governs
    real-time sync: the `seenBaseChange` skip, `onReset()` ordering, "map corrupt" vs
    throttled-resync branching, and the consolidate countdown. Logic was moved from the
    deleted `src/services/extensions.ts` (untested there too) — add coverage now.
    `ILiveData`/`IApi` are interface-typed and stubbable; `resyncIntervalMillis` exists
    for `TestScheduler`.
    **Resolved:** added `unit/models/mapChangeConsolidator.test.ts` with stubbed
    `ILiveData`/`IApi` (the test captures the `watchMapChanges` callbacks and drives
    changes directly). Covers: `onReset`-before-`onNext` ordering on a base change, the
    redundant-base-change skip, resync base changes bypassing the skip, the
    `onSubscribed` full-reload re-arming the skip, the fatal "map corrupt" throw on an
    invalid base change, an invalid incremental triggering a resync consolidate, RxJS
    `throttle` collapsing rapid resyncs to one, the counted-interval regular consolidate
    (`Math.random` stubbed for a deterministic interval), the `undefined` live/api
    short-circuit, and the disposer stopping the watch.

13. ✅ **`Storage.deleteMany` logs an empty path on keyless S3 errors.**
    `server/src/services/storage.ts:39-49` — when S3 returns an error without a `Key`,
    `path` becomes `''` and `bestEffortDeleteS3` logs a warning naming no object. Log the
    raw error object instead when `e.Key` is absent (compounds item 1's auditability
    gap).
    **Resolved:** `deleteMany` now branches on `e.Key === undefined`. `Storage` has no
    logger dependency, so rather than logging directly it folds the raw S3 error entry
    into the `message` field (`keyless S3 delete error: {…}`) — the `{ path, message }[]`
    return contract is unchanged, so both `bestEffortDeleteS3`/`auditedDeleteS3` callers
    and their tests keep working, and the otherwise-empty caller log line now carries
    the actionable error detail.

---

## Suggestions (nice to have)

14. **`scrubMapSpriteReferences` inserts a non-idempotent cleanup change.**
    `server/src/services/extensions.ts` — `insertMapChangesInTx` is called without an
    `idempotencyKey`; a retried `deleteImage` inflates incremental history. Derive a
    deterministic key from `(mapId, spritePath)`.

15. ✅ **`reconcileTokenSprites` treats superseded spritesheets as valid sources.**
    `server/src/services/extensions.ts` — `validSpritePaths` is built from all
    spritesheet rows with no `supersededBy = ''` filter, so a path in a superseded sheet
    (PNG already deleted from S3) is still "valid". Filter to current sheets.

16. **`markMapRecent` does not promote a revisited map to the front.**
    `src/services/recentMaps.ts:51` — a re-loaded map updates in place rather than moving
    to position 0. Confirm position-stable is intentional vs a recency bug.

17. **`insertMapChangesInTx` JSDoc references a contract no caller follows.**
    `server/src/services/extensions.ts` — the doc frames the WS handler as caller, but
    the WS handler calls `addMapChanges`; the only caller is `scrubMapSpriteReferences`.
    Tighten the comment to match reality.

18. ✅ **Client subscribe errors use raw `console.error`.**
    `src/services/honoLiveData.ts:198, 237, 282` — use the standard `logError` helper
    from `src/services/consoleLogger.ts` (as `DeleteAccountModal.tsx` does).

19. **WebSocket frame payloads are not a discriminated union.** *(follow-up issue)*
    Define `type WsScopePayload = { scope: 'profile'; data: … } | { scope: 'map'; data: … } | …`
    keyed by `scope` so a `switch` gets exhaustive `never`-checking — this eliminates the
    casts in item 7 entirely. Highest-leverage type-design improvement; worth its own
    ticket.

20. **`ty: m.ty as MapType` casts launder an untrusted string into an enum.**
    `src/services/honoConverters.ts:31, 63` — validate against `MapType` values so a bad
    server enum is a caught error, not a downstream rendering fault.

21. **`IProfile.email: string` vs `IMe.email: string | null` mismatch.**
    `watchProfile` papers over it with `?? ''` (`honoLiveData.ts:138`). Consider
    `email: string | null` on `IProfile`, or document why profile guarantees non-null.

22. **Consider branded id types.** Wire `*Row` types (`honoApiClient.ts:18-73`) type
    every identifier as bare `string` — `owner`, `id`, `adventureId`, `imagePath` are
    interchangeable to the compiler. Branded types would make mismatches illegal.
    Optional; codebase uses no branding today.

23. ✅ **Orphaned `IAppVersion` interface (dead code).**
    `shared/src/services/interfaces.ts:7-11` — its only consumer, `VersionChecker.tsx`,
    was deleted in this PR; `grep` finds zero remaining usages. Delete the interface and
    its now-false comment.

24. **Symlink in the unit test tree.**
    `unit/components/userNameText.ts` is a symlink to `src/components/userNameText.ts`;
    CLAUDE.md says no symlinks. Import the real path directly. (Pre-existing pattern
    elsewhere in `unit/` — confirm intent.)

25. ✅ **`docs/REPLATFORM.md:47` diagram contradicts its own prose.**
    Diagram still reads `• WebSocket (/ws/maps/:id)`; actual path is the multiplexed
    `/ws` (`WS_PATH = '/ws'`). Change to `• WebSocket (/ws — multiplexed)`.

26. ✅ **`docs/REPLATFORM.md:78-90` REST table missing new routes.**
    Add `PUT` and `DELETE /api/adventures/:id/players/:userId/characters/:characterId`
    (`players.ts:64, 84`). `DELETE /api/auth/me` is also new but `/api/auth/*` was never
    in the table — optional.

27. ✅ **`docs/EPHEMERAL_WS.md:9-11` is factually wrong.**
    States clients "do not send anything over the socket" and writes go through
    `POST .../changes` — no longer true. Pre-existing rot this PR exposes; fix the
    `**Status**` paragraph for consistency.

28. **`main.test.ts:60` stale screenshot label.**
    Still named `create-account-navbar-dropdown`, but the navbar `Dropdown` was replaced
    with a display-name button + modal. Rename to e.g. `create-account-navbar`.

29. ✅ **`extensions.ts:964` JSDoc typo.** "so it ordering" → "so its ordering".

30. **No test confirms a map appears in / leaves "Latest maps".**
    E2E tests only assert the heading's visibility, never that an opened map shows up or
    a deleted one disappears — the user-facing point of the `recentMaps` rewrite is
    unverified. Largely covered if item 11 is done; one E2E assertion would close it
    end-to-end.

31. **`deleteImage` uses an ad hoc single-object S3 delete path.**
    `server/src/services/imageExtensions.ts:232-244` — not routed through
    `bestEffortDeleteS3`/`deleteMany`, so it has a different failure-logging convention
    from `deleteUser`/`deleteAdventure`. Two cleanup conventions for the same operation
    class is a maintenance hazard; consider unifying.

32. **`resolveImageUrl` cache — verify rejected promises are not cached.**
    `src/services/resolveImageUrl.ts:11` — confirm `ExpiringStringCache` does not pin a
    rejected `getImageDownloadUrl` promise for 10 minutes (would break every image render
    for that path with no log).

33. **`deleteUser` NOTIFY fan-out has all-or-nothing logging granularity.**
    `server/src/services/extensions.ts` — a variadic `notifySafe` over many adventures'
    `notify*` calls means one rejecting NOTIFY logs one generic message and discards the
    rest. Low impact (reconciliation covers it); add a comment acknowledging it.

34. **`honoConverters.ts` only transitively tested.**
    Pure functions (`adventureRowToIAdventure` etc.); the `'maps' in row` discriminant
    branch is uncovered. Cheap to add a small dedicated test file.

---

## Notes

- No Critical *bugs* (no crash-on-happy-path, no compile failure). The two Criticals are
  a data-erasure gap and a CLAUDE.md error-logging violation.
- Type design rated 6.5/10; server test coverage rated excellent, client-side coverage
  has gaps (items 11, 12, 30, 34).
- Strengths: thorough dead-code removal, clean `IApi`/`ILiveData` split, exemplary server
  integration tests (full account-deletion blast radius, a real `FOR UPDATE` concurrency
  test), `DeleteAccountModal.tsx` error handling, and faithful CLAUDE.md doc updates.
