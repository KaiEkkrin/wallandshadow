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
