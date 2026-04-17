# Ephemeral WebSocket Messages (`ping`, `measurement`)

Broken out of @docs/REPLATFORM.md during Phase 4. The original replatforming plan
anticipated bidirectional ephemeral messages on the map WebSocket for live collaboration
cues. Those messages were never implemented and nothing currently depends on them. This
document captures the motivation and the shape of the work so we can decide later whether
to build it.

**Status**: unfunded. Server currently registers no `'message'` handler on the map
WebSocket; clients do not send anything over the socket. All writes go through the REST
API (`POST /api/adventures/:id/maps/:id/changes`) and the server broadcasts the persisted
result back via PostgreSQL LISTEN/NOTIFY.

---

## Motivation

Two collaboration signals that feel much better when they're live, and that are cheap
because they never need to be persisted:

| Message       | UX                                                           | Why ephemeral                                          |
| ------------- | ------------------------------------------------------------ | ------------------------------------------------------ |
| `ping`        | A player taps somewhere to say "look here" — a pulse shown to everyone | Nothing to save; the signal IS the UX                   |
| `measurement` | Live drag-to-measure line (ruler) that others see as you drag it | Per-frame updates, tens of messages per second possibly |

Both exist to reduce friction during a session ("pass me the tokens", "how far is that",
"what are you looking at"). Today a measurement is either an internal tool (not visible to
others) or has to be emulated with a feature/token, which forces a DB write for something
that's about to be cleared.

### Would this improve interactivity / performance?

- **Interactivity**: yes, noticeably for `measurement`. Round-tripping a drag through
  REST + NOTIFY + broadcast is at least 10× the latency of a direct WebSocket forward,
  and the write amplification would be embarrassing. For `ping` the effect is smaller
  (it's one message), but it's a natural fit.
- **Performance (server)**: mixed. Forwarding-only messages are cheap individually,
  but a measurement can fire many messages per second per user. At current traffic
  (small, known group) this is fine; it would be worth rate-limiting if sessions
  ever got busier. No DB load either way.
- **Performance (client)**: rendering cost is the real question — rendering a live
  ruler for each other connected user during drag. Not a protocol concern.

---

## Sketch

```
Client A drags ruler
    │
    ▼
ws.send({ type: 'measurement', ... })
    │
    ▼
WebSocket server
    ├─ (measurement) → room.broadcastExcept(senderWs, raw)   ← no DB, no NOTIFY
    └─ (change)      → reject; writes go through REST
                                   │
                                   ▼
                        (REST path handles changes;
                         NOTIFY → room broadcast as today)
```

Minimum protocol:

| Field    | Notes                                                                                          |
| -------- | ---------------------------------------------------------------------------------------------- |
| `type`   | `'ping'` \| `'measurement'` — discriminator; server rejects unknown types                      |
| `from`   | Server fills this in from the authenticated socket (don't trust the client)                    |
| `mapId`  | Implicit from the URL path; no need to repeat                                                  |
| `seq`    | Optional per-sender sequence number so stale frames can be dropped on the receiver             |
| payload  | Type-specific. `ping`: a single map coord. `measurement`: start + end coord, optional style    |

The server registers a `'message'` listener on each joined socket. Dispatch by `type`;
for ephemerals, fan out to all other sockets in the room (not back to the sender) and
stop. For non-ephemerals, reject — we do not want to blur the boundary between the
persistent REST write path and the ephemeral fire-and-forget path.

---

## Server implications

- **Auth**: already done at upgrade time. The ephemeral handler trusts the socket's
  established identity.
- **Room multi-instance**: today, LISTEN/NOTIFY glues rooms across processes for
  persisted changes. Ephemerals would need a parallel fan-out if we ever go
  multi-instance (Postgres NOTIFY, Redis pub/sub, or similar). At single-instance
  scale this is a no-op.
- **Rate limiting**: per-sender token bucket on `measurement` (e.g. 60 msg/sec) to
  protect against pathological clients. `ping` can be coarser (e.g. 5/sec).
- **Validation**: coord shape checks only — same helpers the REST change path uses.
  Drop anything malformed silently; do not close the socket for bad ephemerals.
- **Back-pressure**: `ws.send` on a slow receiver should drop frames rather than queue
  unbounded. This matters for `measurement` specifically.

## Client implications

- A hook that exposes `sendPing(coord)` / `sendMeasurement(start, end)` and a stream
  of incoming ephemerals for rendering.
- Render layer: transient overlays that auto-fade. Do not route ephemerals through
  the map change tracker — they are not changes.
- Cleanup: on socket close, clear any in-flight remote rulers (otherwise you get a
  stale ghost ruler from a dropped peer).

---

## Open questions

- Do we want a presence message type too (`join` / `leave` / `activeUser`)? Probably
  a separate discussion, but the infrastructure is the same.
- Do measurements deserve a "snap to grid" server-side, or is that purely client?
  Purely client feels right — keep the server dumb.
- Is there any security-sensitive data in a `measurement` or `ping` that would
  require filtering by adventure membership at broadcast time? Only the sender's
  identity, which we control.

## Decision criteria

Build it when:

- A user reports friction that a live ruler or ping would fix, AND
- We have bandwidth to add client rendering (the server work is small).

Otherwise defer indefinitely — the REST + NOTIFY path handles the must-have case
(persistent collaboration) and this is pure quality-of-life.
