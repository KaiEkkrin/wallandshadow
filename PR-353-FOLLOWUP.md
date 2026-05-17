# PR #353 Review — Follow-up Improvements

These four items came out of the PR #353 review (`PR-353-REVIEW.md`). They are
worth fixing but each needs more than a small in-place edit — design thought, a
type-model change, an E2E harness addition, or a cross-cutting refactor. They
were deliberately split out of the "easily fixed" subset so they can be tracked
as a single GitHub improvement issue rather than rushed into the PR.

Branch context: `gh-136-etc-rollup-improvements`. Items are referenced by their
number in `PR-353-REVIEW.md`.

---

## 1. (Review item 14) `scrubMapSpriteReferences` inserts a non-idempotent cleanup change

**Location:** `was-web/server/src/services/extensions.ts` —
`scrubMapSpriteReferences` calls `insertMapChangesInTx` with no `idempotencyKey`.

**Problem:** `deleteImage` may be retried (client retry, at-least-once delivery).
Each retry that still finds token/character references re-runs the scrub and
inserts a *fresh* `TokenRemove` + `TokenAdd` cleanup batch into incremental
history. The cleanup is logically idempotent (removing the same sprite again is
a no-op once applied) but the history row is not deduplicated, so a retried
delete inflates `map_changes`.

**Proposed fix:** derive a deterministic `idempotencyKey` for the cleanup batch,
e.g. from `(mapId, spritePath)` plus a stable `scrub` discriminator, and pass it
through `insertMapChangesInTx` (which already supports `onConflictDoNothing` +
idempotency-key lookup).

**Why it is not a quick fix:** the key must be stable across retries of the
*same* delete, yet must not suppress a *legitimately distinct* later scrub of
the same `(mapId, spritePath)` — e.g. if a new token referencing that path were
somehow created between retries. The semantics need to be reasoned through and
covered by a concurrency-aware integration test, not just a one-liner.

**Effort:** S–M. **Risk:** medium (touches real-time history correctness).

---

## 2. (Review item 19) WebSocket frame payloads are not a discriminated union

**Location:** `was-web/src/services/honoLiveData.ts` — `dedupedHandlers` and the
per-scope subscribe handlers; wire frames arrive typed as `unknown`.

**Problem:** incoming WS frame payloads are narrowed with ad-hoc type guards and,
in `dedupedHandlers`, an unchecked `emit(data as T)` cast (explicitly left in
place by review item 7 as dependent on this work). There is no single typed
description of "what a frame for scope X looks like", so the compiler cannot
exhaustively check frame handling.

**Proposed fix:** define a discriminated union keyed by `scope`:

```ts
type WsScopePayload =
  | { scope: 'profile'; data: MeResponse }
  | { scope: 'map'; data: MapChangesSnapshot | MapChangesUpdate }
  | …;
```

Dispatch with a `switch (frame.scope)` and a `never` default so a new scope is a
compile error. This retires the remaining `as` casts in items 7 and 19 entirely.

**Why it is not a quick fix:** it is a genuine type-design change that ripples
through `honoLiveData.ts`'s subscription plumbing and the shared wire types. The
review flagged it as *"highest-leverage type-design improvement; worth its own
ticket."*

**Effort:** M. **Risk:** low-medium (compiler-guided; behaviour-preserving).

---

## 3. (Review item 30) No test confirms a map appears in / leaves "Latest maps"

**Location:** `was-web/e2e/` — current E2E coverage only asserts the "Latest
maps" heading is visible.

**Problem:** the user-facing payoff of the `recentMaps` rewrite — an opened map
showing up under "Latest maps", and a deleted map disappearing — is never
asserted end-to-end. Unit coverage was added (review item 11,
`unit/services/recentMaps.test.ts`), but nothing exercises the
load-map → list-updates path through the real UI.

**Proposed fix:** add an E2E assertion: open a map, assert it appears in the
"Latest maps" list; delete it, assert it leaves the list.

**Why it is not a quick fix:** needs a multi-step Playwright flow (create
adventure → create map → open → navigate home → assert → delete → assert) and a
run against the full dev-server harness. Slower to write and to run than a unit
test.

**Effort:** M. **Risk:** low.

---

## 4. (Review item 31) `deleteImage` uses an ad-hoc single-object S3 delete path

**Location:** `was-web/server/src/services/imageExtensions.ts` — the
`storage.ref(path).delete()` + local `try/catch` that logs at Warning level.

**Problem:** account/adventure deletion routes S3 cleanup through
`auditedDeleteS3` / `bestEffortDeleteS3` / `Storage.deleteMany`, which have a
defined failure-logging contract (Error-level orphan markers, re-runnable path
lists — see review item 1). `deleteImage` instead does its own one-object delete
with a different, weaker logging convention (Warning, no orphan marker). Two
cleanup conventions for the same class of operation is a maintenance hazard and
an auditability gap.

**Proposed fix:** route `deleteImage`'s S3 delete through the same helper used
by `deleteUser`/`deleteAdventure` (likely `auditedDeleteS3` with an
`image-delete` context marker), so a failed erase produces a consistent,
re-runnable orphan log.

**Why it is not a quick fix:** it is a cross-cutting consolidation — it needs the
shared helper to accept this call site's context, plus tests confirming the
orphan-logging behaviour matches the account-deletion path. Worth doing
alongside or just after item 1's `auditedDeleteS3` work settles.

**Effort:** S–M. **Risk:** low-medium (changes a GDPR-relevant cleanup path).

---

## Explicitly not pursued

For completeness, three review items were assessed and deliberately *not*
scheduled:

- **Item 16** — `markMapRecent` updates a revisited map in place rather than
  promoting it to the front. Confirmed: recency ordering is **not** a
  requirement; position-stable behaviour is intentional. No change.
- **Item 21** — `IProfile.email: string` vs `IMe.email: string | null`. The
  `?? ''` coalesce in `watchProfile` is a deliberate, harmless boundary
  decision; making `IProfile.email` nullable would ripple through every
  consumer for negligible benefit.
- **Item 22** — branded id types for the wire `*Row` types. A large refactor for
  a codebase that uses no branding today; not justified at present.
