## Proposed `map_changes` schema

```typescript
export const mapChanges = pgTable('map_changes', {
  id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
  mapId: uuid('map_id').notNull().references(() => maps.id, { onDelete: 'cascade' }),
  seq: bigint('seq', { mode: 'bigint' }).generatedAlwaysAsIdentity().notNull(),
  isBase: boolean('is_base').notNull().default(false),
  changes: jsonb('changes').notNull(),
  resync: boolean('resync').notNull().default(false),
  userId: uuid('user_id').references(() => users.id),
  idempotencyKey: uuid('idempotency_key'),
  createdAt: tstz('created_at').notNull().defaultNow(),
}, (t) => [
  // Incremental catch-up: ordered by seq for a specific map
  index('map_changes_map_seq_idx').on(t.mapId, t.seq)
    .where(sql`is_base = false`),
  // Exactly one base change per map
  uniqueIndex('map_changes_base_idx').on(t.mapId)
    .where(sql`is_base = true`),
  // Idempotent inserts from clients
  uniqueIndex('map_changes_idempotency_key_idx').on(t.idempotencyKey)
    .where(sql`idempotency_key IS NOT NULL`),
  // resync is only meaningful on the base row
  check('map_changes_resync_check', sql`resync = false OR is_base = true`),
]);
```

### Changes from current schema

| Column / index | Action | Reason |
|---|---|---|
| `incremental BOOLEAN` | **Remove** | Replaced by `is_base` (inverted, clearer name) |
| `is_base BOOLEAN NOT NULL DEFAULT false` | **Add** | Replaces `incremental` and the `id = mapId` base-row convention; partial unique index enforces one base per map |
| `seq BIGINT GENERATED ALWAYS AS IDENTITY` | **Add** | Monotonic ordering column; enables client catch-up and deterministic consolidation ordering. Uses a PostgreSQL sequence internally — sequence lock is lightweight, not a table lock, so concurrent inserts don't block each other |
| `idempotency_key UUID` | **Add** | Nullable, client-provided. Server does `INSERT … ON CONFLICT (idempotency_key) DO NOTHING`. Base rows (server-written) leave this NULL |
| `id UUID PRIMARY KEY` | **Keep** | Stays as UUID rather than switching to a BIGINT PK — a PK type change cascades across FKs and NOTIFY payloads; `seq` serves the ordering role cleanly as a separate column |
| `created_at` | **Keep** | Still useful for audit |
| `resync` | **Keep + constrain** | `CHECK (resync = false OR is_base = true)` makes it explicit that `resync` is only meaningful on the base row |
| `(map_id, incremental, created_at)` index | **Remove** | Replaced by the two partial indexes below |
| `(map_id, seq) WHERE is_base = false` | **Add** | Efficient incremental catch-up query |
| `UNIQUE (map_id) WHERE is_base = true` | **Add** | Database-enforced one-base-per-map invariant |
| `UNIQUE (idempotency_key) WHERE idempotency_key IS NOT NULL` | **Add** | Enforces idempotency at the database level |

### Advisory lock protocol

The `seq` column's usefulness rests on a key ordering invariant:

> **Every incremental row always has `seq` greater than the current base row's `seq`.**

Without enforcement, this invariant can be broken: a write that commits *during* a consolidation transaction gets a lower seq than the base row written at the end of that transaction. The result is a "stranded" incremental — connected clients apply it, then receive the base broadcast and reset, silently losing its effects. The inconsistency persists until the next consolidation.

The invariant is enforced by a **shared/exclusive PostgreSQL advisory lock keyed on `map_id`**:

| Operation | Lock acquired |
|---|---|
| `addMapChanges` | `pg_advisory_xact_lock_shared(mapId)` |
| `consolidateMapChanges` | `pg_advisory_xact_lock(mapId)` (exclusive) |
| reads (snapshot, catch-up) | none — MVCC provides per-statement consistency |

Multiple writes run concurrently (shared locks are compatible with each other). Consolidation blocks until all in-flight writes commit, then runs uncontested. Any write that arrives after consolidation starts waits until consolidation commits, then proceeds — getting a seq higher than the base's seq, satisfying the invariant.

Both lock variants are transaction-level (`_xact_`): released automatically on commit or rollback, safe for use with connection pools, no risk of leaking.

Reads need no lock because a single `SELECT` statement is already consistent under PostgreSQL's MVCC (it sees a point-in-time snapshot), and the catch-up two-query path is safe at READ COMMITTED isolation (explained below).

### Catch-up protocol enabled by this schema

When a client reconnects with `lastSeq`:

```sql
-- Does the client's seq still exist as an incremental?
SELECT 1 FROM map_changes
  WHERE map_id = $mapId AND is_base = false AND seq = $lastSeq;

-- Yes → send only the delta (no lock needed; MVCC is sufficient)
SELECT * FROM map_changes
  WHERE map_id = $mapId AND is_base = false AND seq > $lastSeq
  ORDER BY seq;

-- No → seq was consolidated; send a full reload
-- The advisory lock invariant guarantees the base row has the lowest seq,
-- so ORDER BY seq returns base first, then all incrementals.
SELECT * FROM map_changes
  WHERE map_id = $mapId
  ORDER BY seq;
```

**Why the two-query catch-up is safe at READ COMMITTED**: if consolidation commits between the two queries, the incremental the client last saw (seq X) is now in the base. The new incrementals returned by query 2 were authored on top of the consolidated state — which equals the client's current state — so they apply correctly.

**Why reads need no lock**: a single `SELECT` statement always sees a consistent snapshot under MVCC. The full-reload query is a single statement, so it will see either the pre-consolidation world or the post-consolidation world, never a partial mix.

---

## Easy review issues

* **Consolidation race condition**: Use a postgres advisory lock keyed on mapID to prevent concurrent consolidates.
* **timestamp inside JSONB is redundant**: Remove it, use `created_at` only.
* **Semantic collision on map ID as base change ID**: as suggested, add an `is_base BOOLEAN NOT NULL DEFAULT false` column, and a suitable partial unique index to prevent there from being more than one base change per map.
* **Consolidation policy enforcement uses adventure owner**: Yes this is deliberate: the owner's tier applies. Include some documentation.

## ID problem

* **Change IDs**: Replace UUIDv7 change ID with a monotonic counter, big enough to be unlikely to wrap 
within the lifetime of the program. Please confirm that incrementing this counter (to insert a changes row) won't acquire an exclusive lock on the changes table.
* **Client catch-up**: Upon reconnect, the client should send the latest counter (ID) value it has (if any) so that the server can reply with only changes following on after it. **Exception**: If the given ID value doesn't exist in the database, that means it's been packed down by a consolidate operation; the client should receive a full reload in that case.
* **Potential duplicate submissions**: Can we have the client generate an idempotency key (UUIDv7?) for each change it tries to send, and include those in the changes table with a unique index? This would allow us to insert-or-do-nothing for resubmitted changes if the original submission was written to the database.

## Other

* **Token-move changes**: We should review specifically what information these changes contain, because I suspect they might not have enough. They should contain enough information to determine both the starting and ending squares/hexes of the moved token, so that they can be validated (did the token start where the change says it started? No? Not valid -- discard!)

---

## Full architecture review (Claude)

### Overview

The system implements a persistent, append-only change log with periodic consolidation,
broadcast via PostgreSQL LISTEN/NOTIFY, and a client-side change tracker that replays
the log to reconstruct state. The Firebase migration preserved the original `chs[]`
change format entirely; only the transport and persistence layers changed.

**Data flow:**

```
Client → WS mapChange frame → server addMapChanges()
    → INSERT map_changes (incremental=true) → NOTIFY map_changes
    → LISTEN handler → broadcast to room → all WebSocket clients
    → watchChanges() → trackChanges() → onNext() callback
    → if failed: throttled consolidate(resync=true) → broadcast new base
```

### Strengths

**Two-phase change application with rollback** (`changeTracking.ts`)
The `trackChanges` function applies changes in two passes (removes first, then adds) and
rolls back the entire batch if any step fails. Individual changes within a batch either
all succeed or all fail, with no partial state left behind.

**Deliberate pedantry in `trackChange`**
The comment "I want to quickly detect any out-of-sync situations" is exactly right.
Rejecting obviously-invalid operations (double-remove, adding to an occupied cell) turns
data errors into detectable sync failures immediately rather than silently accumulating
corruption.

**Server-authoritative `timestamp`**
`addMapChanges` sets `timestamp: Date.now()` on the server, not the client. Clients
cannot spoof change timestamps. The server's wall clock is the canonical time source.

**Thundering-herd mitigation on consolidation**
The random interval `100 + Math.random() * 350` before triggering consolidation spreads
consolidation load across clients. The `throttle` on resync (5 s minimum) prevents a
feedback loop when many clients are simultaneously out-of-sync.

**PostgreSQL NOTIFY as the single broadcast primitive**
All broadcasts — including those from the REST `POST /changes` path — go through NOTIFY.
This means the REST path and the WS path are behaviorally identical and could support
horizontal scaling with no code changes.

**`uuidv7` for change IDs**
UUIDv7 embeds a millisecond timestamp prefix, making IDs monotonically increasing within
the same millisecond window. Replaced by the proposed monotonic counter, but the
idempotency-key use case (§4) still benefits from client-generated UUIDv7s.

**Resync and network health tracking**
The `NetworkStatusTracker` counting resyncs per client in a sliding window is a
lightweight but effective indicator for surfacing degraded-sync situations to the UI.

### Issues and Opportunities

#### 1. No monotonic sequence number — the largest gap

Changes are fetched and ordered by `created_at` (a wall-clock timestamp). Two changes
arriving within the same millisecond have undefined relative ordering. More importantly,
**there is no way for a client to express "I have seen up to change N; send me only what
I've missed."**

Consequences:
- Every reconnect triggers a full snapshot replay (base + up to 499 incrementals).
- There is no reliable way to detect a gap in received changes.
- Duplicate submissions (see §4) cannot be idempotently rejected.

The fix is a per-map monotonic `seq BIGINT NOT NULL` column on `map_changes`, populated
from a PostgreSQL sequence at insert time. With a sequence number, the client can send
its last-seen seq on subscribe and the server sends only the delta. Ordering becomes
fully deterministic and independent of clock drift.

#### 2. Wall-clock ordering of incrementals in consolidation

```typescript
.orderBy(mapChanges.createdAt)
.limit(499);
```

If `created_at` has two rows with the same timestamp (possible at millisecond resolution
under load), relative ordering is undefined. PostgreSQL will apply an arbitrary ordering,
and applying the same changes in a different order can produce different state (e.g.,
"move token A then move token B to A's old position" vs. the reverse).

Fix: order by `id` (UUIDv7) instead of `created_at`, or by the proposed monotonic seq.
Either gives deterministic, crash-safe ordering. One-line change.

#### 3. Consolidation race condition

`tryConsolidateMapChanges` reads incremental rows, then acquires a row-level lock on the
base row only inside the transaction. Two concurrent consolidations can both read the
same set of incrementals, both succeed, and both write a new base row. The retry loop
handles this but each wasted consolidation replays up to 499 changes and writes a
transaction. Under a thundering herd of resync consolidations this is wasteful.

Fix: acquire the base-row lock (or a PostgreSQL advisory lock keyed on mapId) before
reading incrementals. `SKIP LOCKED` lets a second caller bail out immediately.

```sql
SELECT id FROM map_changes WHERE id = $mapId FOR UPDATE SKIP LOCKED
```

#### 4. Potential duplicate submissions on reconnect

The WebSocket reconnect logic queues `mapChange` frames and drains the queue on
reconnect. If a `mapChange` is sent, the server persists it, but the connection drops
before the ack arrives, the client re-sends the same frame on reconnect. The server
inserts a second incremental row.

The duplicate usually self-heals via resync, but produces one spurious resync for all
clients on that map per reconnect event.

Fix: include the client-generated idempotency key as the change's primary key. The
insert becomes `ON CONFLICT (id) DO NOTHING`. This makes `addMapChanges` idempotent
with no extra state.

#### 5. `timestamp` inside the JSONB is redundant with `created_at`

The `Changes` JSONB payload stores `timestamp: Date.now()` (server wall clock at insert
time). The `created_at` column stores the same value. Two sources of truth that can
diverge if the JSONB is written directly. Fix: remove `timestamp` from `Changes` JSONB;
use `created_at` as the canonical time everywhere. This is a shared-type change with
some breadth.

#### 6. `seenBaseChange` survives reconnect — potential correctness gap

In `watchChangesAndConsolidate`, the `seenBaseChange` flag lives in the closure. After
a reconnect the fresh snapshot's non-resync base is silently skipped:

```typescript
if (chs.incremental === false && chs.resync === false && seenBaseChange === true) {
  return;
}
```

Safe if (and only if) the client's pre-disconnect state equals the new base — which
holds when no consolidation happened during the disconnect. A monotonic seq makes this
verifiable. Conservative fix: reset `seenBaseChange = false` on every re-subscribe.

#### 7. Base-change row uses `mapId` as its `id` — semantic collision

The convention `INSERT INTO map_changes (id = mapId, ...)` for the base row conflates
"which map" (`map_id`) with "which change record" (`id`). It works but breaks the
assumption that `id` is always a fresh UUID. Cleaner alternative: an explicit
`is_base BOOLEAN NOT NULL DEFAULT false` column with a partial unique index
`WHERE is_base = true` to enforce one base per map, plus a fresh UUIDv7 for every
consolidation.

#### 8. Consolidation policy enforcement uses adventure owner, not the submitter

```typescript
const ownerPolicy = getUserPolicy((user?.level ?? 'standard') as UserLevel);
```

Consolidation applies the adventure owner's object-count policy regardless of who
triggered it. This is probably correct — map state should be governed by the owner's
entitlements — but deserves explicit documentation so the reasoning is clear when the
policy model is revisited.

### Summary of Recommended Changes

| Priority | Change | Effort |
|---|---|---|
| High | Order incrementals by `id` instead of `created_at` | 1 line |
| High | Idempotent `addMapChanges` using client idempotency key as `id` | Small |
| Medium | Monotonic `seq` column on `map_changes` + seq-aware subscription | Medium |
| Medium | Consolidation advisory lock / `SKIP LOCKED` to prevent races | Small |
| Low | Remove `timestamp` from `Changes` JSONB (use `created_at`) | Medium (shared type) |
| Low | Reset `seenBaseChange` on re-subscribe | 1 line (or superseded by seq) |
| Low | Replace `id = mapId` base convention with `is_base` column | Small schema migration |

The ordering fix (§2) and idempotency fix (§4) are the most impactful for correctness
and would each take under an hour. The monotonic sequence (§1) is the most
architecturally significant improvement and unlocks efficient reconnect, gap detection,
and a significantly cleaner subscription model.
