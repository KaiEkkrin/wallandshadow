# Scribble Mode — design (first take)

**Issue:** [#331 Scribble mode](https://github.com/KaiEkkrin/wallandshadow/issues/331)
**Date:** 2026-06-07
**Branch:** `gh-331-scribble-mode`
**Builds on:** the ephemeral overlay data layer merged in `fad682a` (#365).

This is **session 2** of the three-session ephemeral-overlay plan (data layer →
scribble UI → ruler UI). It consumes the data layer unchanged; no edits to
`@wallandshadow/shared`.

## Goal

The simplest scribble visual we can iterate on in situ. A `Scribble` pencil tool,
available to **all** connected users, that lets you hold the left mouse button and
draw fading lines on the map. The lines are captured in pixels, stored in **world**
coordinates in the ephemeral state, and rendered at a **constant pixel width** so
they stay pinned to the map under pan/zoom while remaining clearly visible.

### Explicitly out of scope (deferred to later iterations)

- **Off-edge arrow indicator** (the #331 "scribbling over there" arrow).
- **Per-author colour** — v1 renders every scribble **white**.
- **Per-segment age/fade** — v1 fades each stroke as a whole.
- **Touch drawing** — touch continues to pan as today; drawing is mouse/pen only.
- Any change to the shared data layer.

## Decisions taken during brainstorming

1. **Per-stroke fade, not per-segment.** The merged data layer models a scribble as
   one `OverlayItem` with a single `releasedAt` and a bare `PixelCoord[]` — there are
   no per-point timestamps, and remote viewers could not reconstruct them. True
   per-segment alpha aging would require extending the shared payload (reopening the
   data-layer scope). So a stroke holds full alpha while drawn and briefly after
   release, then fades to 0 over ~10 s as a whole. "Newer on top" is still achieved
   (see Rendering).
2. **White only for v1.** Skip the author-first-token hue lookup entirely. A stubbed
   `aColour` attribute is left in place so adding token-hue colour later is a small
   change.

## Background: the data layer this consumes

From `packages/shared/src/data/overlay.ts` and `services/liveData.ts` (already merged
and tested):

- `ScribblePayload = { kind: 'scribble'; points: PixelCoord[] }`, where `PixelCoord`
  is a bare `{ x: number; y: number }` used here to hold **world** coordinates.
- `OutgoingOverlayItem = { itemId: string; payload: OverlayPayload; phase: 'active' | 'released' }`.
- `OverlayItem` adds server-stamped `authorId`, `updatedAt`, optional `releasedAt`.
- Caps: `MAX_SCRIBBLE_POINTS = 2000`, `MAX_ITEM_ID_LENGTH = 64`.
- `live.sendOverlayUpdate(mapId, item)` — fire-and-forget, dropped if the socket is
  down, server stamps `authorId`.
- `live.watchLiveOverlays(mapId, onNext, onError?)` — `onNext` receives the full
  reconciled `OverlayItem[]` (snapshot + update + removal merged client-side). The
  server **excludes the originator** from broadcasts, so an author never sees its own
  strokes echoed back — it must render them optimistically.
- Server expires a released scribble (and broadcasts a removal) ~10 s after release.

`live` reaches the model layer via `MapLifecycleManager` (holds `ILiveData`), which
constructs `MapStateMachine` with a `sendMapChange` closure. The pixel→world
transform used by every painting tool is `getClientToWorld(target, drawing)`
(`models/extensions.ts`), applied to the viewport vector produced by
`Map.tsx:getClientPosition` (`clientX, window.innerHeight - clientY - 1, 0`).

## Architecture

Four new/changed seams, keeping the **ephemeral path physically separate** from the
persistent change tracker (per `docs/architecture/ephemeral-state.md`):

```
pointer events (Map.tsx)
   → MapUi.interactionStart/Move/End   [EditMode.Scribble cases]
       → MapStateMachine.scribbleStart/Move/End   (thin delegators)
           → ScribbleController            (NEW — capture + subscription + merge)
               ├─ live.sendOverlayUpdate(mapId, …)         (out)
               ├─ live.watchLiveOverlays(mapId, …)         (in)
               └─ drawing.setScribbles(items)              (render)
                       → ScribbleDrawing   (NEW — one instanced draw call)
```

Scribble capture **never** calls `addChanges` / produces `Change[]`.

### 2. Capture — `ScribbleController` (new, `was-web/src/models/scribbleController.ts`)

Holds: `live`, current `{ adventureId, mapId }`, a `drawing` reference (for the
transform and for pushing render data), `uid`, `logError`, the current local stroke
buffer, a list of locally-released-but-still-fading strokes, and the active
`watchLiveOverlays` unsubscribe.

- **start(cp)**: `itemId = crypto.randomUUID()`; begin a local stroke; capture the
  first world point (apply `getClientToWorld` to `cp`).
- **move(cp)**: convert to world; append only if it moved > ~3 px (viewport) from the
  last sampled point; clamp total points to `MAX_SCRIBBLE_POINTS`; throttle
  `sendOverlayUpdate(mapId, { itemId, phase:'active', payload:{ kind:'scribble', points }})`
  to ~every 80 ms. Each send carries the **whole** accumulated array (wholesale
  replacement). Push the merged set to the drawing so the author sees their stroke
  immediately.
- **end(cp)**: append the final point; send one `phase:'released'` frame; stamp a
  local `releasedAt = Date.now()`; move the stroke into the fading-locally list; clear
  the active buffer.

**Fade clock.** Remote `OverlayItem.releasedAt` is a server epoch-ms timestamp, so
local `releasedAt` and the renderer's `uNow` uniform must use the **same clock**:
`Date.now()` (epoch ms) throughout, so the shader can compare every instance's
`aReleaseTime` against `uNow` uniformly regardless of origin. (Minor server/client
clock skew only shifts a stroke's fade start by a fraction of the ~10 s window —
acceptable for a transient effect.)
- **subscription**: on configure/map-change, (re)bind `watchLiveOverlays`; `onNext`
  filters to `kind:'scribble'`, and the controller merges remote strokes with local
  strokes (local active + locally-released-fading) keyed by `authorId:itemId`, then
  calls `drawing.setScribbles(merged)`. A locally-released stroke is dropped after the
  fade window elapses (or when a server removal for it arrives). Unsubscribe on map
  change and on dispose.

Merge ordering is **chronological** (oldest `updatedAt`/`releasedAt` first; local
active stroke last) — this ordering is what drives newer-on-top at render time.

### 3. Rendering — `ScribbleDrawing` (new) + `drawingOrtho.ts` integration

One **instanced draw call** of line-segment quads for all strokes and authors
combined, modelled on `paletteColouredFeatureObject.ts`.

- **Geometry**: a unit quad whose vertex positions encode `(t ∈ {0,1}, side ∈ {-1,+1})`.
- **Per-instance attributes** (`InstancedBufferAttribute`, `DynamicDrawUsage`):
  - `aStart` (vec2, world), `aEnd` (vec2, world) — segment endpoints.
  - `aReleaseTime` (float, ms; a large sentinel while `active`).
  - `aColour` (vec3) — **stubbed**; written white in v1, kept so token-hue is a
    one-liner later. (The fragment shader may hardcode white in v1; the attribute
    still exists for the buffer layout.)
- **Custom `ShaderMaterial`**:
  - *Vertex*: project `aStart`/`aEnd` to clip space via `projectionMatrix * viewMatrix`
    (model transform is identity, so endpoints stay in world space and track the
    camera); convert to screen pixels using a `uViewport` (vec2) uniform; offset the
    vertex perpendicular to the segment direction by a constant `uHalfWidthPx`
    (≈1.5–2 px ⇒ 3–4 px line); convert back to NDC for `gl_Position`. Compute
    `vAlpha` from `aReleaseTime` vs a `uNow` uniform and pass it through.
  - *Fragment*: `gl_FragColor = vec4(vec3(1.0) /* white */, vAlpha)`.
  - `transparent: true`, `depthTest: false`, `depthWrite: false`, normal alpha
    blending.
- **"Newer on top"**: because instances are built in chronological order and drawn in
  one transparent pass with depth test off, painter's order yields newer-over-older.
  No per-instance z attribute is needed. The scribble scene is rendered **last**
  (after every existing scene) so scribbles sit above everything on the canvas.
- **Fade curve**: `vAlpha = 1` while `active` (sentinel) or while
  `uNow - aReleaseTime < holdMs`; then linear from 1 → 0 between `holdMs` and
  `holdMs + fadeMs`, clamped. `holdMs + fadeMs ≈ 10 s` to align with the server's
  expiry. `uHalfWidthPx`, `holdMs`, `fadeMs` are constants chosen for easy tuning.
- **Per-frame redraw**: the current render loop (`drawingOrtho.animate`) is on-demand.
  While any scribble is alive, force a redraw each frame and bump `uNow`, so the fade
  animates without rebuilding instance buffers. Instance buffers rebuild only when
  `setScribbles(items)` is called (stroke set changed).
- **Capacity**: preallocate a max segment budget (e.g. 20 000 instances). If exceeded,
  drop oldest segments and `logError`/warn rather than silently truncating.
- **Disposal**: `dispose()` releases geometry + material; called from
  `drawingOrtho.dispose()`. Add `setScribbles` (and any needed accessor) to the
  `IDrawing` interface (`models/interfaces.ts`).

### 4. Tool wiring

- `EditMode.Scribble = "scribble"` added to `components/MapControls.types.ts`.
- A `faPencil` `ModeButton` in `components/MapControls.tsx`, placed **next to Select**
  and **ungated** (outside the `canDoAnything` check, in every layer) so all connected
  users get it. Tooltip e.g. "Scribble on the map (fades after a few seconds)".
- `models/mapUi.ts`: `EditMode.Scribble` cases in `interactionStart/Move/End` that
  delegate to `stateMachine.scribbleStart/Move/End`. Scribble:
  - produces **no `Change[]`** (never calls `addChanges`),
  - does **not** auto-return to `EditMode.Select` on release (you keep scribbling),
  - draws on left-drag rather than panning; existing pan triggers are unaffected.
- `models/mapStateMachine.ts`: construct a `ScribbleController` (constructor gains
  `live`, or narrowly `sendOverlayUpdate` + `watchLiveOverlays`); add thin
  `scribbleStart/Move/End`; bind/rebind the controller's subscription in `configure`
  (map change) and tear it down in `dispose`.
- `models/mapLifecycleManager.ts`: pass `live` through to `MapStateMachine`.

## Testing & verification

- **Unit** (`unit/`): `ScribbleController` with a fake `live` and an injected
  transform — itemId generation, distance sampling, active-throttle then a single
  released frame, local-stroke optimistic merge, subscription teardown on map change.
- **Render**: a construction + `dispose()` smoke test for `ScribbleDrawing` (no GPU
  pixel assertions).
- **Manual**: pixel-level appearance, width, and fade timing verified in situ and
  iterated (per the stated plan to iterate after seeing it).
- **Gates**: `yarn lint`, `yarn build`, `yarn test:unit` all green.

## Key trade-offs

- **Instance ordering** instead of a per-instance z attribute for newer-on-top —
  simpler, identical result in a single transparent draw call.
- **Screen-space-constant line width** in the shader (the "transform back to viewport"
  intent) so width does not scale with zoom while endpoints track the map.
- Scribble capture lives in its **own controller**, not on the change-tracking state
  machine, to honour the ephemeral/persistent boundary.
- **Butt-capped segments** in v1 (small gaps possible at sharp turns); dense sampling
  keeps this minor. Round joins/caps are a later iteration if needed.
