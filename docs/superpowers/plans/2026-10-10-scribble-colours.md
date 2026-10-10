# Scribble Colours Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each author's scribbles recognisable. Every stroke is drawn as a fill colour over a wider outline colour. The fill comes from the author's token on the current map; the outline is a per-player hue spaced evenly around the LCH wheel. The GM's strokes have a colourless outline and a thicker line. Progressive fade-out works as before, fading both colours to transparent.

**Architecture:** A pure resolver (`scribbleStyles.ts`) turns (adventure owner, player ids, map tokens) into an `authorId → ScribbleStyle` function. `MapStateMachine` rebuilds it when tokens change or when `MapContextProvider` hands it a new player list, and tells `ScribbleController` to re-render. The controller stops emitting flat white segments and instead emits **strokes** (points + style + release time). `ScribbleDrawing` expands each stroke into instanced quads — all fill quads, then all outline quads — and uses the depth buffer so each stroke covers each pixel exactly once. That keeps fill-over-outline and self-crossings correct while translucent. Segments get round caps in the fragment shader, so corners join cleanly. Nothing on the wire changes: colour is derived client-side from `authorId`, exactly as `docs/architecture/ephemeral-state.md` prescribes.

**Tech Stack:** TypeScript, React, Three.js (custom `ShaderMaterial` + `InstancedBufferGeometry`), chroma-js (already a dependency), Vitest (node env).

---

## Decisions already made (with the user, 2026-10-10)

1. **Player order:** sort player ids (UUIDv7, so roughly account-creation order) as strings. No server change.
2. **Outline lightness:** outlines are dark and saturated — LCH L=38, C=60 — so lightness, not just hue, separates them from the token palette (L=60, C=50).
3. **GM:** excluded from the wheel. Colourless (near-black) outline and a 1.5× thicker line.
4. Choosing your own scribble colour is out of scope.

## Design details

### Fill colour (per author, per map)

Take every token on the current map (`_tokens` **and** `_outlineTokens`), sorted by `id` (UUIDv7, so creation order; the map dictionary's iteration order differs between clients). The author's tokens are those whose `players` array contains the author's uid.

1. The first such token with a non-empty `characterId`, then
2. otherwise the first such token with an empty `characterId`, then
3. otherwise mid-grey (LCH L=60, C=0 — the same lightness as the palette, so all fills read alike).

The fill is `standardColours[token.colour].light` from `src/models/featureColour.ts`. If `token.colour` is out of range, fall back to mid-grey.

The GM follows the same fill rule. The GM is rarely in a token's `players` list, so the GM fill is normally mid-grey.

### Outline colour

- `ownerId` = `map.record.owner` (the map's owner is the adventure owner, i.e. the GM).
- Wheel members = all player ids from `AdventureContext.players` (blocked players included, so blocking someone does not recolour everyone), minus `ownerId`, de-duplicated, sorted ascending.
- Player at index *k* of *N* gets hue `SCRIBBLE_HUE_OFFSET_DEG + k * 360 / N`, outline `chroma.lch(38, 60, hue)`.
- `SCRIBBLE_HUE_OFFSET_DEG = 0`. The token palette's hues are 27.9°, 83.7°, 139.5°, 195.3°, 284.7°, 340.5° — unevenly spaced — and for N=6 an offset of 0° maximises the minimum hue gap (15.3°). 30° would be the worst choice, about 2° from the reds. The lightness difference does most of the separating work; the offset is a bonus.
- GM outline: `chroma.lch(10, 0, 0)` (near-black).
- An author who is neither the GM nor in the player list (the list has not loaded yet, or is stale): mid-grey outline (LCH L=38, C=0) at player width. They pick up their colour as soon as the list arrives.

### Widths (CSS pixels, constant on screen)

| | fill half-width | outline half-width | total line |
| --- | --- | --- | --- |
| player | 1.5 | 3.0 | 6 px |
| GM (× 1.5) | 2.25 | 4.5 | 9 px |

`ScribbleStyle` carries a `widthScale` (1 or 1.5). The base half-widths are constants in `scribbleTypes.ts`.

### Rendering: one pixel per stroke, via depth

Plain alpha blending would let a translucent outline show through a translucent fill, and darken places where a stroke crosses itself. Instead:

- Before the scribble pass, `renderer.clearDepth()`. The default `WebGLRenderer` has a depth buffer, and scribbles render last, so nothing else needs that depth.
- The material uses `depthTest: true`, `depthWrite: true`, `depthFunc: THREE.LessDepth`.
- Stroke *i* of *n* (oldest first) gets NDC depth `z_i = 0.9 - 1.8 * (i + 1) / (n + 1)`, so newer strokes are nearer.
- Instance order: for each stroke, oldest to newest, emit its **fill** quads, then its **outline** quads, all at `z_i`.
  - Fill pixels are written first. The same stroke's outline at the same depth fails `LESS` where the fill already is, so the outline only appears in the rim.
  - A stroke's second pass over a pixel it has already drawn (self-crossing, overlapping round caps) fails `LESS`, so no double alpha.
  - A newer stroke is nearer, so it passes over older strokes, and is drawn after them, so blending order is right.
- The fragment shader must `discard` (not merely output alpha 0) for fully faded fragments and for fragments outside the round cap, so they never write depth.

### Rendering: round caps

Extend each quad by its half-width beyond both endpoints along the segment direction, pass segment-local pixel coordinates to the fragment shader, and discard fragments farther than the half-width from the segment (a capsule). The joins between consecutive segments become round with no notches.

---

## File structure

| File | Responsibility | Action |
| --- | --- | --- |
| `src/models/scribbleTypes.ts` | Replace `ScribbleSegment` with `ScribbleStroke` + `ScribbleStyle`; width/colour constants | Modify |
| `src/models/scribbleStyles.ts` | Pure resolver: owner + players + tokens → `(authorId) => ScribbleStyle` | Create |
| `src/models/three/scribbleDrawing.ts` | `setStrokes`: expand strokes to fill+outline instances with per-instance colour, width, depth; capsule shader; depth setup | Modify |
| `src/models/three/drawingOrtho.ts` | `clearDepth()` before the scribble pass; `setScribbles(strokes)` | Modify |
| `src/models/interfaces.ts` | `IDrawing.setScribbles(strokes: ScribbleStroke[])` | Modify |
| `src/models/scribbleController.ts` | Take `uid` + `styleFor`; emit strokes; `refreshStyles()` | Modify |
| `src/models/mapStateMachine.ts` | Hold players, rebuild resolver on token/player change, `setScribblePlayers()` | Modify |
| `src/components/MapContextProvider.tsx` | Effect pushing `AdventureContext.players` into the state machine | Modify |
| `unit/models/scribbleStyles.ts` + `.test.ts` | Shim + resolver tests | Create |
| `unit/models/scribbleController.test.ts`, `unit/models/three/scribbleDrawing.test.ts` | Update for strokes and styles | Modify |
| `docs/architecture/ephemeral-state.md` | Per-author colour is no longer outstanding | Modify |

Run tests from `was-web/`: `npm test -- <path>` (one-shot) or `npm run test:unit` (watch).

---

## Task 1: Types and constants

**Files:** Modify `was-web/src/models/scribbleTypes.ts`

- [ ] **Step 1:** Replace `ScribbleSegment` with:

```typescript
// Plain RGB in 0..1; THREE.Color is structurally compatible.
export interface Rgb { r: number; g: number; b: number; }

// How one author's strokes look. Derived client-side from authorId; never sent.
export interface ScribbleStyle {
  fill: Rgb;
  outline: Rgb;
  // Multiplies the base half-widths; 1 for players, SCRIBBLE_GM_WIDTH_SCALE for the GM.
  widthScale: number;
}

// One stroke to be drawn: a polyline in world coordinates.
export interface ScribbleStroke {
  points: { x: number; y: number }[];
  style: ScribbleStyle;
  // Epoch ms when released, or SCRIBBLE_ACTIVE while still being drawn.
  releaseTime: number;
}
```

- [ ] **Step 2:** Replace `SCRIBBLE_HALF_WIDTH_PX` with `SCRIBBLE_FILL_HALF_WIDTH_PX = 1.5`, `SCRIBBLE_OUTLINE_HALF_WIDTH_PX = 3.0` and `SCRIBBLE_GM_WIDTH_SCALE = 1.5`. Keep `SCRIBBLE_MAX_SEGMENTS` meaning *polyline segments* (the drawing allocates twice that many instances).

- [ ] **Step 3:** `npx tsc --noEmit -p .` is expected to fail at the call sites. Tasks 3–4 fix them. Don't commit yet; commit Tasks 1–4 together if the intermediate state doesn't compile, or stage per task with the old type aliased temporarily.

## Task 2: The style resolver

**Files:** Create `was-web/src/models/scribbleStyles.ts`, `was-web/unit/models/scribbleStyles.ts` (shim: `export * from '../../src/models/scribbleStyles';`), `was-web/unit/models/scribbleStyles.test.ts`

- [ ] **Step 1: Write the failing tests first.** Cover:
  - Wheel order: players `['c','a','b']`, owner `'o'` → `a`, `b`, `c` get hues 0°, 120°, 240° (assert via `chroma(rgb).lch()` hue within 1°, L ≈ 38).
  - The owner is excluded from the wheel even when present in the player list, and gets the near-black outline and `widthScale` 1.5.
  - Duplicate player ids are counted once.
  - Fill precedence: a non-character token created first and a character token created later → the character token's colour. No character token → first non-character token by `id`. No tokens → mid-grey.
  - Token order is by `id`, not by array order (pass the same tokens shuffled; same result).
  - A token whose `players` doesn't include the author is ignored.
  - Out-of-range `colour` → mid-grey fill.
  - Unknown author → mid-grey outline, `widthScale` 1.
  - For N=6, every outline hue is at least 15° from every palette hue (guards the offset choice against a future palette change).
  - Determinism: two calls with the same inputs return equal styles.

- [ ] **Step 2: Implement.**

```typescript
import chroma from 'chroma-js';
import { ITokenProperties } from '@wallandshadow/shared';
import { standardColours } from './featureColour';
import { Rgb, ScribbleStyle, SCRIBBLE_GM_WIDTH_SCALE } from './scribbleTypes';

// Hue of wheel slot 0. With the current token palette, 0° maximises the
// minimum hue gap to the six pickable colours for six players (~15°); the
// darker outline lightness does most of the separating work.
export const SCRIBBLE_HUE_OFFSET_DEG = 0;
const OUTLINE_L = 38;
const OUTLINE_C = 60;

export interface ScribbleStyleInputs {
  ownerId: string;
  playerIds: readonly string[];
  tokens: Iterable<ITokenProperties>;
}

function lch(l: number, c: number, h: number): Rgb {
  const [r, g, b] = chroma.lch(l, c, h).rgb();
  return { r: r / 255, g: g / 255, b: b / 255 };
}

const MID_GREY_FILL = lch(60, 0, 0);
const UNKNOWN_OUTLINE = lch(OUTLINE_L, 0, 0);
const GM_OUTLINE = lch(10, 0, 0);

export function buildScribbleStyles(inputs: ScribbleStyleInputs): (authorId: string) => ScribbleStyle {
  // ... sort tokens by id once; build Map<uid, fill> walking the sorted tokens
  //     (character tokens win over non-character ones; first wins within each);
  //     build Map<uid, outline> from the sorted, de-duplicated, owner-free player ids;
  //     return a closure that looks both up, applying the GM and unknown fallbacks.
}
```

Precompute both maps in `buildScribbleStyles` so the returned closure is O(1) per stroke. `pushRender` calls it for every stroke on every pointer move.

- [ ] **Step 3:** Run `npm test -- unit/models/scribbleStyles.test.ts` and confirm it passes. `npm run lint`.
- [ ] **Step 4:** Commit: `Add per-author scribble style resolver (#331)`.

## Task 3: `ScribbleDrawing` — two-tone capsules with depth

**Files:** Modify `was-web/src/models/three/scribbleDrawing.ts`, `was-web/unit/models/three/scribbleDrawing.test.ts`

- [ ] **Step 1: Update the tests first.** Today they cover segment packing. Change them to `setStrokes` and assert on the CPU-side buffers (expose read-only getters for tests, as `segmentCount` does today):
  - A stroke of *k* points produces `k-1` fill instances followed by `k-1` outline instances. Instance count = `2(k-1)`.
  - A one-point stroke produces nothing (as today).
  - Fill instances carry the fill colour and `SCRIBBLE_FILL_HALF_WIDTH_PX * widthScale`; outline instances carry the outline colour and `SCRIBBLE_OUTLINE_HALF_WIDTH_PX * widthScale`.
  - Both passes of one stroke share a depth. Successive strokes have strictly decreasing depth, all within (-1, 1).
  - Order is stroke-major: all of stroke 0 (fill, then outline) before any of stroke 1.
  - The `SCRIBBLE_MAX_SEGMENTS` cap truncates at polyline-segment granularity. A truncated stroke still emits fill and outline for the same segments.
  - `releaseTime` mapping (relative ms, `ACTIVE_REL` sentinel) is unchanged.

- [ ] **Step 2: Attributes.** Replace `aColour` with `aColour` (vec3, per instance, either fill or outline colour), add `aHalfWidth` (float) and `aDepth` (float). Allocate `2 * maxSegments` instances.

- [ ] **Step 3: Shaders.**

```glsl
// vertex — additions/changes only
attribute float aHalfWidth;
attribute float aDepth;
varying vec2 vLocal;   // x: px along the segment from start; y: px across
varying float vLen;
varying float vHalfWidth;

  // position.x in {0,1} picks start/end; position.y in {-1,+1} picks the side.
  // Extend by the half-width past each end so the capsule's round caps fit.
  float along = mix(-aHalfWidth, len + aHalfWidth, position.x);
  float across = position.y * aHalfWidth;
  vec2 basePx = pxStart + unit * along + perp * across;
  gl_Position = vec4(basePx / (0.5 * uViewport), aDepth, 1.0);
  vLocal = vec2(along, across);
  vLen = len;
  vHalfWidth = aHalfWidth;

// fragment
  if (vAlpha <= 0.0) discard;
  float t = clamp(vLocal.x, 0.0, vLen);
  if (length(vec2(vLocal.x - t, vLocal.y)) > vHalfWidth) discard;
  gl_FragColor = vec4(vColour, vAlpha);
```

Remove the `uHalfWidthPx` and `uZ` uniforms (depth is per instance now). Remove the `z` constructor argument and `scribbleZ` in `drawingOrtho.ts` with it.

- [ ] **Step 4: Material.** `depthTest: true`, `depthWrite: true`, `depthFunc: THREE.LessDepth`; keep `transparent: true` and `NormalBlending`.

- [ ] **Step 5:** `render()` calls `renderer.clearDepth()` before `renderer.render(...)`. Put it here rather than in `DrawingOrtho`, so the depth contract lives next to the shader that relies on it.

- [ ] **Step 6:** Run the tests and lint. Commit: `Draw scribbles as two-tone round-capped strokes (#331)`.

## Task 4: `ScribbleController` emits styled strokes

**Files:** Modify `was-web/src/models/scribbleController.ts`, `was-web/src/models/interfaces.ts`, `was-web/src/models/three/drawingOrtho.ts`, `was-web/unit/models/scribbleController.test.ts`

- [ ] **Step 1: Tests first.** Update existing expectations from segments to strokes, and add:
  - Remote strokes use `styleFor(item.authorId)`; local (active and released) strokes use `styleFor(uid)`.
  - `refreshStyles()` re-pushes the same strokes with styles from the *current* `styleFor`. Build the controller with a mutable resolver, swap it, call `refreshStyles()`, and assert that the new colours are pushed.
  - Painter's order is unchanged: remote by `updatedAt`, then local released by `releasedAt`, then the active local stroke last.

- [ ] **Step 2:** Add `uid: string` and `styleFor: () => (authorId: string) => ScribbleStyle` to `ScribbleControllerParams`. A getter is used so the state machine can swap the resolver without reconstructing the controller. `setScribbles` takes `ScribbleStroke[]`. Delete `WHITE` and `appendSegments`. `pushRender` builds one `ScribbleStroke` per remote item / local stroke (skipping those with fewer than two points), resolving `const styleFor = this._styleFor()` once per push.

- [ ] **Step 3:** Add `refreshStyles() { this.pushRender(); }`.

- [ ] **Step 4:** Change `IDrawing.setScribbles` to take `ScribbleStroke[]`, and `DrawingOrtho.setScribbles` to call `this._scribbles.setStrokes(strokes)`. The fade-loop logic in `animate()` keys off `hasContent` and is unchanged.

- [ ] **Step 5:** `npm test`, `npx tsc --noEmit -p .`, `npm run lint`. Commit: `Colour scribbles per author (#331)`.

## Task 5: Feed players and tokens into the resolver

**Files:** Modify `was-web/src/models/mapStateMachine.ts`, `was-web/src/components/MapContextProvider.tsx`

- [ ] **Step 1: State machine fields.** Add `private _scribblePlayerIds: readonly string[] = []` and `private _scribbleStyles: (authorId: string) => ScribbleStyle`, plus

```typescript
private rebuildScribbleStyles() {
  this._scribbleStyles = buildScribbleStyles({
    ownerId: this._map.record.owner,
    playerIds: this._scribblePlayerIds,
    tokens: fluent(this._tokens).concat(this._outlineTokens),
  });
}
```

Call it in the constructor before the `ScribbleController` is created. Pass the controller `uid: this._uid` and `styleFor: () => this._scribbleStyles`.

- [ ] **Step 2: Token changes.** In `createChangeTracker`'s callback, when `haveTokensChanged`, call `this.rebuildScribbleStyles()` then `this._scribbleController.refreshStyles()`. The constructor creates the tracker before the controller; guard against that ordering, or construct the controller first. Check which, and keep the order explicit rather than relying on an `undefined` check.

- [ ] **Step 3: Map switch.** Where `configure` re-binds the controller (`setMap` around line 1146), rebuild styles first. The owner and the tokens both belong to the new map.

- [ ] **Step 4: Players.** Add a public method:

```typescript
setScribblePlayers(playerIds: readonly string[]) {
  this._scribblePlayerIds = playerIds;
  this.rebuildScribbleStyles();
  this._scribbleController.refreshStyles();
}
```

- [ ] **Step 5: `MapContextProvider`.** Read `players` from `AdventureContext` alongside `spriteManager`, and add an effect keyed on the current state machine and `players`:

```typescript
useEffect(() => {
  mapContext.stateMachine?.setScribblePlayers(players.map(p => p.playerId));
}, [mapContext.stateMachine, players]);
```

Use whatever name the provider's state actually has. A new state machine (map switch) also needs the current list, which the dependency on the state machine covers.

- **Already verified (2026-10-10):** every adventure member receives the full player list, not just themselves. `GET /api/adventures/:id/players` (`server/src/routes/players.ts`) only checks membership, and the WebSocket adventure snapshot (`server/src/ws/subscriptions.ts`) carries all player rows too. So every client builds the same wheel.

- [ ] **Step 6:** `npm test`, typecheck, lint. Commit: `Feed adventure players and map tokens into scribble styles (#331)`.

## Task 6: Docs

- [ ] In `docs/architecture/ephemeral-state.md`, update the status paragraph and the "Presentation is deliberately absent from the payload" paragraph: per-author colour now exists, derived client-side from `authorId` as designed. One or two sentences on the rule (token fill + wheel outline + GM style). Point to `src/models/scribbleStyles.ts` in "Where the code lives".
- [ ] Commit: `docs: record per-author scribble colours (#331)`.

## Task 7: Verification

- [ ] `npm run build`, `npm run lint`, `npm test`, `npm run test:shared`, `npm run test:smoke` (after the build).
- [ ] `npm run test:e2e` with both dev servers running. No screenshot should change: scribbles aren't in any baseline. If one does change, find out why before updating it.
- [ ] **Manual (dev server, three browser profiles: GM + two players):**
  - [ ] Each player's outline hue differs; the GM's is near-black and visibly thicker.
  - [ ] Give a player a character token. Their fill matches its colour. Change the token's colour, and their next and existing strokes recolour.
  - [ ] A player with no tokens draws with a mid-grey fill.
  - [ ] Draw a tight zig-zag and a self-crossing loop: corners are round, and the crossing doesn't look darker mid-fade.
  - [ ] Two players' strokes crossing: the newer one is on top throughout the fade.
  - [ ] Fade: hold ~3 s, then both colours fade together to nothing. No white or grey halo.
  - [ ] Check the near-black GM outline on the darkest map background in use. If it disappears, raise the GM outline lightness with the user rather than guessing.
- [ ] Tick the two remaining checkboxes on PR #366 once the user has done their manual check.

## Notes for the implementer

- Don't touch the wire protocol, the server, or `@wallandshadow/shared`'s overlay types. Styles are a pure client concern.
- Never route scribbles through the map change tracker (see `CLAUDE.md`, "Map Changes").
- `chroma.lch` clips out-of-gamut colours silently. L=38/C=60 is in gamut at most hues, and the clipping is acceptable; don't add gamut mapping.
