# Scribble hot-point markers — design

**Issue:** [#331 Scribble mode](https://github.com/KaiEkkrin/wallandshadow/issues/331) (the off-edge arrow, deferred from the first take)
**Date:** 2026-10-10
**Branch:** `scribble-hot-point-markers`
**Builds on:** scribble mode (#366), including per-author colours.

## Goal

Show where everyone else is scribbling *right now*. While another user holds the
mouse button down in scribble mode, their **hot point** (the newest point of the
stroke in progress) is marked:

- **On screen:** a pulsing hollow ring centred on the hot point.
- **Off screen:** a pulsing arrow at the edge of the screen pointing towards it.
  Its tip sits where the line from the screen centre to the hot point crosses the
  screen edge, and it is rotated to point along that line.

Both are drawn in the scribbler's colours, fill over outline, exactly as their
strokes are, and scaled up the same way for the GM.

## Decisions taken during brainstorming

1. **Remote scribblers only.** Your own cursor already marks your hot point.
2. **Hollow ring.** A solid disc would hide what is being drawn underneath it.
3. **Smoothed motion.** Remote points arrive at most every 80 ms, so a marker
   pinned to the latest one would jump. The marker eases towards the latest point
   with a short time constant.
4. **Short fade on release.** When a stroke is released, or disappears, its
   marker fades out over about 250 ms rather than vanishing.
5. **No toolbar avoidance.** Arrows may sit under the map controls on the left
   edge, the same as anything else drawn on the map. Revisit if that turns out
   to hide them too often.
6. **No extras on the arrow**: no initials, names or distances.
7. **Overlapping arrows just overlap.** Newer markers draw on top.
8. **Keepalive while held.** Fix the existing staleness problem (below) in the
   same change.

## The staleness problem this fixes

The server drops an `active` overlay item after `ACTIVE_STALE_MS` (5 s) without
an update, and broadcasts its removal. `ScribbleController` only sends while the
pointer moves, and stops sending once a stroke reaches `MAX_SCRIBBLE_POINTS`. So
a scribbler who holds the button still for 5 s currently vanishes, stroke and
all, from everyone else's screen, and pops back on their next move. A "button
is held" marker would make this obvious.

Separately, the last points of a stroke are sent only if they are at least
80 ms after the previous send. Points drawn just before the pointer stops are
not sent until the release, so a marker would sit short of the real hot point
while the scribbler pauses.

**Fix, client-only:** while a stroke is held, the controller runs a tick every
`SEND_INTERVAL_MS` (80 ms). Each tick sends an `active` frame if

- there are points not yet sent and at least 80 ms have passed since the last
  send (a **trailing flush**), or
- at least `KEEPALIVE_MS` (2 s) have passed since the last send (a
  **keepalive**, comfortably inside the server's 5 s).

A side effect: the first tick sends a one-point stroke, so peers see the marker
about 80 ms after the button goes down, even before the pointer moves. The
boundary validator already accepts one-point scribbles, and the stroke renderer
already skips strokes with fewer than two points.

Nothing on the wire or on the server changes.

## Architecture

```
ScribbleController                       (THREE-free; unit tested)
  pushRender()
    ├─ setScribbles(strokes)              existing
    └─ setMarkers(markers)                NEW: one per remote active item
                                               { key, point (world), style }
       → IDrawing.setScribbleMarkers(markers)
          → DrawingOrtho → ScribbleMarkerDrawing   (NEW, Three.js)
               owns a ScribbleMarkerTracker        (NEW, THREE-free; unit tested)
                 smoothing + release fade, per key
               each frame:
                 tracker.update(now) → [{ point, style, alpha }]
                 project world → screen px with the map camera
                 placeMarker(px, viewport) → ring | arrow   (pure; unit tested)
                 upload per-instance attributes; draw
```

The split keeps every decision that can be tested out of the shader:

- **What** to mark: `ScribbleController` (which items are remote and active, and
  the last point of each).
- **How it moves and fades**: `ScribbleMarkerTracker`, a small state machine
  keyed by `authorId/itemId`, driven by explicit `now` values.
- **Where it goes on screen**: `placeMarker`, a pure function.
- **What it looks like**: the shader, which only draws a ring or an arrow at a
  screen position it is given.

Projection and placement run on the CPU each frame. There are only ever a
handful of markers, and doing it in TypeScript means the edge-intersection maths
exists once and is tested, rather than being duplicated in GLSL.

### Marker identity

The key is `` `${authorId}/${itemId}` ``. An author has at most one active item,
so this is one marker per scribbler. A new stroke has a new item id, so its
marker starts fresh at the new hot point rather than gliding across the map from
the end of the previous stroke.

### Smoothing and fade (`ScribbleMarkerTracker`)

- `setMarkers(markers, now)`:
  - A new key starts with its position at the target. It does not fade in.
  - A known key gets a new target and style, and any fade in progress is
    cancelled. That happens when an item reappears after a staleness removal.
  - A known key missing from the list starts fading at `now`.
- `update(now)`:
  - Moves each position towards its target by `1 − exp(−dt / SCRIBBLE_MARKER_SMOOTH_MS)`,
    with a time constant of 60 ms. This is frame-rate independent.
  - Alpha is 1, or for a fading marker `1 − (now − goneSince) / SCRIBBLE_MARKER_FADE_MS`,
    over 250 ms. A marker whose alpha reaches 0 is dropped.
  - Returns the frames in insertion order, so newer markers draw on top.
- `hasContent` is true while any marker, fading or not, remains. `DrawingOrtho`
  keeps the render loop running while it is true, as it already does for strokes.

Release is detected client-side (the item leaves the active list), so the fade
does not depend on the server's `releasedAt` clock.

### Placement (`placeMarker`)

Input: the hot point in screen pixels relative to the screen centre, y up (the
same convention as the stroke shader: `ndc * 0.5 * viewport`), and the viewport
half-size.

- If `|x| ≤ halfW` and `|y| ≤ halfH`, the hot point is on screen: a **ring**
  centred on it. It may be partly clipped when the hot point is near an edge.
  That is honest, and simpler than an in-between state.
- Otherwise, an **arrow**. With `d = (x, y)`:
  `t = min(halfW / |d.x|, halfH / |d.y|)`, ignoring a zero component;
  `tip = t · d`; `dir = d / |d|`.

### Look

All sizes are CSS pixels, constant on screen, multiplied by the author's
`widthScale` where noted.

| | value |
| --- | --- |
| Ring centre-line radius | 12 px |
| Ring band | the stroke's widths: fill half-width 1.5 px over outline half-width 3 px, × `widthScale` |
| Arrow | isosceles triangle, 22 px long, 18 px wide at the base, × `widthScale`; fill inside, with a 1.5 px × `widthScale` outline border drawn inside the triangle so the tip is not clipped |
| Pulse | `p = 0.5 − 0.5·cos(2πt / 1000 ms)`; size × `(1 + 0.25·p)`; alpha × `(1 − 0.35·p)` |
| Arrow pulse | scales about the tip, so the tip stays on the edge |

Every marker pulses in phase, so they read as one kind of signal.

### Rendering (`ScribbleMarkerDrawing`)

- One instanced draw call. Each instance is a quad sized to its shape. Its
  attributes are the screen-pixel anchor (ring centre or arrow tip), the
  direction, the mode (ring or arrow), fill, outline, `widthScale` and alpha.
- The vertex shader maps pixels straight to clip space (`px / (0.5 · viewport)`).
  It uses no camera matrices.
- The fragment shader computes a distance per mode:
  - Ring: `|length(local) − r|`. Fill within the fill half-width, outline
    within the outline half-width, otherwise discard.
  - Arrow: the maximum of the three edge half-plane distances (exact inside a
    convex polygon). Discard outside; outline within the border; fill inside that.
- A marker is a single shape drawn in one pass, so it covers each pixel at most
  once. The depth trick the strokes need is unnecessary: `depthTest: false`,
  `depthWrite: false`, normal blending.
- Drawn after the strokes, so markers sit on top of them.
- Capped at `SCRIBBLE_MARKER_MAX` (64) instances, which is far more than an
  adventure's players.

## Testing

- `placeMarker`: on screen, including exactly on an edge; off each edge; off a
  corner, where the tip lands on whichever edge the ray crosses first; directly
  above and to the side (a zero component); the tip always lies on the viewport
  boundary.
- `ScribbleMarkerTracker`: a new marker snaps to its target; the smoothing
  fraction after one time constant is about 63%; the result is independent of
  how a time span is split into frames; a missing marker fades linearly and is
  dropped; reappearing cancels the fade; `hasContent`.
- `ScribbleController`: markers only for remote **active** items (not released
  ones, not the local stroke); the marker uses the last point; trailing flush;
  keepalive; a one-point active frame on the first tick; ticks stop at release,
  on a map switch and on dispose, and a stale tick after release sends nothing.
- `ScribbleMarkerDrawing`: instance count, mode and anchor attributes for one
  ring and one arrow; the cap.
- By hand, with two browser windows: ring, arrow at each edge and corner,
  smoothing, pulse, release fade, GM scale, and holding still for more than 5 s
  no longer drops the stroke.

## Out of scope

- Markers for rulers (they have no UI yet).
- Labels, distances, dodging the toolbars, de-overlapping arrows.
- Any change to the shared package, the wire format or the server.
