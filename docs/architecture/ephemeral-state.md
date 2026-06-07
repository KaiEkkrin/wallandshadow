# Ephemeral state & live overlays

How Wall & Shadow handles *transient, in-memory, never-persisted* collaboration
signals — distinct from the durable map data that flows through the database.

This note describes the subsystem as a whole. For what a particular function
does, read the code; for the data-layer build that introduced live overlays,
see `docs/superpowers/specs/2026-06-07-ephemeral-overlay-data-layer-design.md`.

## What counts as ephemeral state

Some collaboration signals only matter for the few seconds they're happening
and never need to survive a refresh:

| Signal | Tenant | Lifetime |
| --- | --- | --- |
| Who is connected / which map they're viewing | **presence** | until last socket closes + idle TTL |
| Free-hand **scribbles** on the map | **live overlay** | drawn, then fades ~10s after release |
| Shared **rulers** (measure distance) | **live overlay** | visible while drawn, fades ~1s after release |

The defining property is that **the signal *is* the UX** — there is nothing to
save. Persisting them would be write amplification on data that's about to be
deleted, and would couple a fast, latency-sensitive interaction to a database
round-trip.

## The central boundary: two write paths

The most important thing to understand about this codebase's real-time layer is
that there are **two parallel paths over the same multiplexed WebSocket**, and
they are deliberately kept apart:

```
                         ┌─ persistent path ───────────────────────────────┐
  client map edit  ──►   │  mapChange frame → insert into map_changes (DB)  │
                         │  → Postgres LISTEN/NOTIFY → broadcast to room     │
                         └──────────────────────────────────────────────────┘

                         ┌─ ephemeral path ────────────────────────────────┐
  presence / overlay ─►  │  in-memory registry on the server (no DB)        │
                         │  → direct broadcast to the room                  │
                         └──────────────────────────────────────────────────┘
```

- The **persistent path** is the source of truth for map content. It is
  durable, ordered (sequence numbers), and survives restarts. It pays a DB
  write + NOTIFY fan-out per change. This is correct for map edits and wrong
  for transient signals.
- The **ephemeral path** never touches the database. State lives in plain
  in-memory maps on the server and is broadcast directly to the sockets in a
  room. It is cheap and low-latency, and it is *expected* to be lost on a
  server restart — that's fine, because the signals are transient anyway.

Keeping these separate is a design rule, not an accident. Mixing them (e.g.
routing scribbles through `map_changes`) would pollute the durable store and
slow the interaction; routing map edits through the ephemeral path would lose
data. New ephemeral features belong on the ephemeral path; anything that must
survive a refresh belongs on the persistent path.

## Shape of the ephemeral backplane

Both tenants follow the same server-side pattern (presence came first; live
overlay was built as the second tenant of it):

- **An in-memory registry**, keyed by room, holding the current state plus a
  set of expiry timers. No locks, no DB; single-process.
- **Snapshot on subscribe.** A newly-subscribing socket is sent the current
  state immediately, so a late joiner sees what's already happening (who's
  online; an in-progress ruler; a still-fading scribble).
- **Broadcast on change, excluding the originator.** The author already rendered
  their own action optimistically; peers get the update.
- **TTL / expiry owned by the server.** When a timer fires the entry is dropped
  and (for overlays) a removal is broadcast, so every client converges even if
  the originator vanished.

The two tenants differ only in scope and payload:

| | presence | live overlay |
| --- | --- | --- |
| Keyed by | adventure | **map** (you only see overlays on the map you're viewing) |
| Identity | one entry per user | one entry per **(author, item)** — many coexist |
| Payload | connection + current map | a discriminated union: scribble (pixel path) or ruler (grid nodes) |
| Expiry | idle TTL after disconnect | per-kind fade after release; staleness timeout while active |

## Why per-author streams (and not a shared document)

Live overlays are modelled as **independent per-author streams**, not as one
shared versioned document that everyone patches. This was a deliberate choice.
The whole point of the feature is *several players drawing at once*; a single
shared document with one version counter would serialise every writer through
that counter, so concurrent edits would constantly collide and force full
re-syncs. Per-author streams have no shared counter and no cross-writer
contention: each item has exactly one author, nobody edits anyone else's, and
"conflict resolution" simply doesn't arise.

A consequence worth internalising: an overlay update **replaces** the item's
geometry wholesale rather than appending to it. This keeps the backplane
*payload-agnostic* — the server stores, forwards, and expires opaque items
without understanding scribble points or ruler nodes. That agnosticism is what
made adding rulers alongside scribbles nearly free, and what will make a third
ephemeral kind cheap: define a payload type, a renderer, and an expiry timing.

## Lifecycle: one timer, read two ways

Each overlay item carries a `phase` (`active` while being drawn, `released`
once let go) and an expiry timer that **every update re-arms**:

- While `active`, the timer is a *staleness* guard (a few seconds) — it cleans
  up after an author whose client died mid-drag.
- On `released`, the timer becomes a *fade* deadline (per kind: short for
  rulers, longer for scribbles).
- A re-grab — a fresh `active` update on the same item after a release —
  re-arms the timer, which cancels the pending fade. This is how a ruler's
  multi-segment construction works (draw a leg, release to commit a node,
  grab again to continue) with no special-case code: it's just repeated
  updates to one item.

## Who owns what: existence vs. pixels

A useful split when reasoning about overlays:

- **The server owns existence.** It is authoritative about whether an item is
  still live, and it broadcasts a removal when an item expires. Reconnecting
  clients get a fresh snapshot, which corrects any local drift.
- **Clients own the pixels.** The visual fade is animated locally from the
  item's `releasedAt` timestamp; clients don't wait for the server to tell them
  to dim. This keeps the animation smooth and means a dropped fire-and-forget
  frame is self-healing.

Implications that fall out of this:

- Overlay sends are **fire-and-forget**: unacked, and *not* queued for resend if
  the socket is down (a stale scribble replayed after a reconnect would be
  wrong). A lost frame is corrected by the next snapshot.
- A hard disconnect mid-drag doesn't leave a ghost forever — the staleness /
  fade timer expires the item and peers converge, with a latency bounded by the
  timer (seconds), not indefinitely.

## Trust and safety

Everything from the wire is treated as untrusted at the server boundary:

- **Author identity is stamped from the authenticated socket**, never read from
  the payload. A client cannot attribute an overlay to someone else.
- **Membership is enforced at subscribe time**, and an overlay send is only
  accepted from a socket that already holds a subscription for that map.
- **Inputs are validated and bounded**: the payload is shape-checked and size-
  capped, there's a per-author item ceiling, and a per-socket rate limit guards
  against floods. Malformed frames are dropped and logged, not fatal — a bad
  transient frame should never close a session.

## Deliberate non-goals (today)

- **No persistence** — by definition.
- **No multi-instance fan-out.** The ephemeral registries are per-process. The
  persistent path already survives multiple server instances via Postgres
  LISTEN/NOTIFY; if the ephemeral path ever needs to span instances it would
  need a parallel fan-out (Postgres NOTIFY, Redis pub/sub, …). At single-
  instance scale this is a no-op and intentionally not built.
- **No UI in the data layer.** Rendering, input capture, per-author colour, and
  the off-edge "someone is scribbling over there" arrow live in the feature UIs,
  not the backplane.

## Where the code lives

- Server backplane: `was-web/server/src/ws/presence.ts`,
  `was-web/server/src/ws/liveOverlay.ts`, wired in `was-web/server/src/ws/handler.ts`.
- Wire contract + payload types + validator: `was-web/packages/shared/src/data/overlay.ts`,
  `was-web/packages/shared/src/data/presence.ts`,
  `was-web/packages/shared/src/services/wsProtocol.ts`.
- Client surface: `ILiveData` in `was-web/packages/shared/src/services/liveData.ts`,
  implemented in `was-web/src/services/honoLiveData.ts` over
  `was-web/src/services/honoWebSocket.ts`.
