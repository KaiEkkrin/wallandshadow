# Scribble Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a universal "Scribble" pencil tool that lets any connected user hold the left mouse button and draw fading white lines on the map, captured in pixels, stored in world coordinates over the existing ephemeral overlay data layer, and rendered at a constant pixel width so they pin to the map under pan/zoom.

**Architecture:** Pointer events flow `Map.tsx → MapUi → MapStateMachine.scribbleStart/Move/End → ScribbleController`. The controller converts viewport points to world coordinates, sends fire-and-forget `overlayUpdate` frames via `ILiveData.sendOverlayUpdate`, subscribes to peers via `ILiveData.watchLiveOverlays`, merges remote + local strokes, and pushes flattened line **segments** to a new `ScribbleDrawing` — a single instanced draw call rendered last (on top of everything) with a custom shader that expands each segment to a fixed pixel width and fades it per-stroke. The ephemeral path never touches the persistent change tracker.

**Tech Stack:** TypeScript, React, Three.js (custom `ShaderMaterial` + `InstancedBufferGeometry`), RxJS-free plain callbacks, Vitest (node env). Consumes `@wallandshadow/shared` overlay types unchanged.

---

## Background the implementer needs

- **Spec:** `docs/superpowers/specs/2026-06-07-scribble-mode-design.md` — read it first.
- **Data layer (already merged, do not modify):**
  - `@wallandshadow/shared` exports (from `packages/shared/src/data/overlay.ts`): `ScribblePayload = { kind: 'scribble'; points: PixelCoord[] }`, `PixelCoord = { x: number; y: number }` (here holding **world** coords), `OutgoingOverlayItem = { itemId: string; payload: OverlayPayload; phase: 'active' | 'released' }`, `OverlayItem` (adds `authorId`, `updatedAt`, optional `releasedAt`), `MAX_SCRIBBLE_POINTS = 2000`.
  - `ILiveData` (from `packages/shared/src/services/liveData.ts`, exported via `@wallandshadow/shared`): `sendOverlayUpdate(mapId, item): void` (fire-and-forget, server stamps `authorId`); `watchLiveOverlays(mapId, onNext, onError?): () => void` (`onNext` gets the full reconciled `OverlayItem[]`; the server **excludes the originator**, so authors must render their own strokes optimistically).
- **Pixel→world transform:** `getClientToWorld(target: THREE.Matrix4, drawing: IDrawing): THREE.Matrix4` in `src/models/extensions.ts`, applied to a viewport vector (`clientX, window.innerHeight - clientY - 1, 0`). The camera is orthographic; this is the same transform walls/areas use.
- **Render loop:** `DrawingOrtho.animate()` (`src/models/three/drawingOrtho.ts`) is **on-demand** — it only renders when a `RedrawFlag` says so. `RedrawFlag` (`src/models/redrawFlag.ts`) has `setNeedsRedraw()` and `needsRedraw()` (the latter reads-and-clears). Scenes are rendered in sequence with `renderer.autoClear = false`; the last scene drawn is `_overlayScene`. Z constants live at the top of `drawingOrtho.ts` (highest currently `invalidSelectionZ = 0.6`).
- **Instanced pattern reference:** `src/models/three/paletteColouredFeatureObject.ts` (custom `ShaderMaterial`, `InstancedBufferGeometry`, `InstancedBufferAttribute` with `DynamicDrawUsage`, `frustumCulled = false`, `dispose()`).
- **Unit-test convention:** tests live under `was-web/unit/**`, mirror the source path with a **re-export shim**, and import the shim. Example: `unit/models/networkStatusTracker.ts` contains exactly `export * from '../../src/models/networkStatusTracker';`, and `unit/models/networkStatusTracker.test.ts` imports `./networkStatusTracker`. Run from `was-web/`: `yarn test --config ./unit/vitest.config.ts run <path>` (or `yarn test:unit` for watch).

### Float32 precision warning (already designed around)

Epoch-ms timestamps (~1.7e12) do **not** fit in a float32 attribute or a `float` uniform (exact integers only up to 2^24 ≈ 1.6e7). So `ScribbleDrawing` keeps a `_t0` base captured at construction and stores **relative** ms (`releaseTime - _t0`); the `uNow` uniform is likewise `Date.now() - _t0`. Both stay small for many hours. The "still active" sentinel is mapped to a large finite relative value to avoid `Infinity` on the GPU.

---

## File structure

| File | Responsibility | Action |
| --- | --- | --- |
| `src/models/scribbleTypes.ts` | Shared, THREE-free types + tuning constants (`ScribbleSegment`, `SCRIBBLE_ACTIVE`, fade/width/cap constants) | Create |
| `src/models/three/scribbleDrawing.ts` | One instanced draw call: GPU buffers, fade shader, `setSegments`/`updateNow`/`setViewport`/`render`/`dispose` | Create |
| `src/models/scribbleController.ts` | Capture (sampling + throttled sends), `watchLiveOverlays` subscription, remote+local merge, flatten to segments | Create |
| `src/models/interfaces.ts` | Add `setScribbles(segments: ScribbleSegment[])` to `IDrawing` | Modify |
| `src/models/three/drawingOrtho.ts` | Own a `ScribbleDrawing`, render it last, drive per-frame fade redraw, implement `setScribbles`, dispose | Modify |
| `src/models/mapStateMachine.ts` | Accept `live`, own a `ScribbleController`, expose `scribbleStart/Move/End`, bind on `configure`, dispose | Modify |
| `src/models/mapLifecycleManager.ts` | Pass `live` to `MapStateMachine` | Modify |
| `src/models/mapUi.ts` | `EditMode.Scribble` cases in `interactionStart/Move/End` (no `Change[]`, no auto-Select) | Modify |
| `src/components/MapControls.types.ts` | Add `EditMode.Scribble` | Modify |
| `src/components/MapControls.tsx` | Ungated `faPencil` tool button | Modify |
| `unit/models/scribbleTypes.ts` + `unit/models/three/scribbleDrawing.ts` + `unit/models/scribbleController.ts` | Re-export shims | Create |
| `unit/models/three/scribbleDrawing.test.ts` + `unit/models/scribbleController.test.ts` | Tests | Create |

---

## Task 1: Shared scribble types and constants

**Files:**
- Create: `was-web/src/models/scribbleTypes.ts`
- Create: `was-web/unit/models/scribbleTypes.ts` (re-export shim)

- [ ] **Step 1: Create the types module**

Create `was-web/src/models/scribbleTypes.ts`:

```typescript
// Shared, THREE-free types and tuning constants for the scribble overlay.
// Kept free of Three.js so the capture controller (and its tests) need not
// pull in the renderer.

// One straight line segment to be drawn, in world coordinates.
export interface ScribbleSegment {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  // Plain RGB in 0..1; THREE.Color is structurally compatible.
  colour: { r: number; g: number; b: number };
  // Epoch ms when the owning stroke was released, or SCRIBBLE_ACTIVE while
  // still being drawn (renders at full alpha, no fade yet).
  releaseTime: number;
}

// Sentinel meaning "this segment's stroke has not been released yet".
export const SCRIBBLE_ACTIVE = Number.POSITIVE_INFINITY;

// Fade timing. A released stroke holds full alpha for HOLD ms, then fades
// linearly to 0 over FADE ms. HOLD + FADE must match the server's ~10s
// scribble expiry so client fade and server removal converge.
export const SCRIBBLE_FADE_HOLD_MS = 3000;
export const SCRIBBLE_FADE_MS = 7000;
export const SCRIBBLE_FADE_TOTAL_MS = SCRIBBLE_FADE_HOLD_MS + SCRIBBLE_FADE_MS;

// Constant on-screen half-width of a stroke, in CSS pixels (≈3.5px line).
export const SCRIBBLE_HALF_WIDTH_PX = 1.75;

// Hard ceiling on rendered segments across all strokes/authors combined.
export const SCRIBBLE_MAX_SEGMENTS = 20000;
```

- [ ] **Step 2: Create the test shim**

Create `was-web/unit/models/scribbleTypes.ts`:

```typescript
export * from '../../src/models/scribbleTypes';
```

- [ ] **Step 3: Verify it type-checks**

Run from `was-web/`: `yarn tsc --noEmit -p tsconfig.json`
Expected: no errors referencing `scribbleTypes.ts`.

- [ ] **Step 4: Commit**

```bash
git add was-web/src/models/scribbleTypes.ts was-web/unit/models/scribbleTypes.ts
git commit -m "Add scribble shared types and tuning constants (#331)"
```

---

## Task 2: `ScribbleDrawing` — the instanced fade renderer

**Files:**
- Create: `was-web/src/models/three/scribbleDrawing.ts`
- Create: `was-web/unit/models/three/scribbleDrawing.ts` (re-export shim)
- Test: `was-web/unit/models/three/scribbleDrawing.test.ts`

- [ ] **Step 1: Write the failing test**

Create `was-web/unit/models/three/scribbleDrawing.test.ts`:

```typescript
import { describe, test, expect } from 'vitest';
import { ScribbleDrawing } from './scribbleDrawing';
import { SCRIBBLE_ACTIVE, ScribbleSegment } from '../scribbleTypes';

function seg(startX: number, endX: number, releaseTime: number): ScribbleSegment {
  return { startX, startY: 0, endX, endY: 0, colour: { r: 1, g: 1, b: 1 }, releaseTime };
}

describe('ScribbleDrawing', () => {
  test('starts empty', () => {
    const d = new ScribbleDrawing(100, 0.7);
    expect(d.hasContent).toBe(false);
    expect(d.segmentCount).toBe(0);
    d.dispose();
  });

  test('setSegments uploads instances and exposes a count', () => {
    const d = new ScribbleDrawing(100, 0.7);
    d.setSegments([seg(0, 1, SCRIBBLE_ACTIVE), seg(1, 2, 1000)]);
    expect(d.segmentCount).toBe(2);
    expect(d.hasContent).toBe(true);
    expect(d.geometry.instanceCount).toBe(2);
    const aStart = d.geometry.getAttribute('aStart').array as Float32Array;
    expect(aStart[0]).toBe(0); // first segment startX
    expect(aStart[2]).toBe(1); // second segment startX
    d.dispose();
  });

  test('setSegments([]) clears content', () => {
    const d = new ScribbleDrawing(100, 0.7);
    d.setSegments([seg(0, 1, 1000)]);
    d.setSegments([]);
    expect(d.hasContent).toBe(false);
    expect(d.segmentCount).toBe(0);
    expect(d.geometry.instanceCount).toBe(0);
    d.dispose();
  });

  test('setSegments clamps to the max segment budget', () => {
    const d = new ScribbleDrawing(2, 0.7);
    d.setSegments([seg(0, 1, 1000), seg(1, 2, 1000), seg(2, 3, 1000)]);
    expect(d.segmentCount).toBe(2);
    d.dispose();
  });

  test('active segments map to a finite (non-Infinity) release time', () => {
    const d = new ScribbleDrawing(100, 0.7);
    d.setSegments([seg(0, 1, SCRIBBLE_ACTIVE)]);
    const rel = (d.geometry.getAttribute('aReleaseTime').array as Float32Array)[0];
    expect(Number.isFinite(rel)).toBe(true);
    d.dispose();
  });
});
```

- [ ] **Step 2: Create the test shim**

Create `was-web/unit/models/three/scribbleDrawing.ts`:

```typescript
export * from '../../../src/models/three/scribbleDrawing';
```

- [ ] **Step 3: Run the test to verify it fails**

Run from `was-web/`: `yarn test --config ./unit/vitest.config.ts run unit/models/three/scribbleDrawing.test.ts`
Expected: FAIL — cannot find module `./scribbleDrawing` / `ScribbleDrawing is not a constructor`.

- [ ] **Step 4: Implement `ScribbleDrawing`**

Create `was-web/src/models/three/scribbleDrawing.ts`:

```typescript
import * as THREE from 'three';
import {
  ScribbleSegment,
  SCRIBBLE_FADE_HOLD_MS,
  SCRIBBLE_FADE_MS,
  SCRIBBLE_HALF_WIDTH_PX,
} from '../scribbleTypes';

// Large finite relative time used for still-active strokes, so the shader sees
// a hugely negative age (full alpha) without ever uploading Infinity to the GPU.
const ACTIVE_REL = 1e9;

const scribbleVertexShader = `
  attribute vec2 aStart;
  attribute vec2 aEnd;
  attribute vec3 aColour;
  attribute float aReleaseTime;

  uniform float uNow;          // ms relative to the drawing's t0
  uniform vec2 uViewport;      // CSS pixels (window inner size)
  uniform float uHalfWidthPx;
  uniform float uHoldMs;
  uniform float uFadeMs;
  uniform float uZ;

  varying vec3 vColour;
  varying float vAlpha;

  void main() {
    // Endpoints are world coords; project with the camera (model is identity).
    vec4 clipStart = projectionMatrix * modelViewMatrix * vec4(aStart, uZ, 1.0);
    vec4 clipEnd   = projectionMatrix * modelViewMatrix * vec4(aEnd, uZ, 1.0);

    vec2 ndcStart = clipStart.xy / clipStart.w;
    vec2 ndcEnd   = clipEnd.xy / clipEnd.w;
    vec2 pxStart = ndcStart * 0.5 * uViewport;
    vec2 pxEnd   = ndcEnd * 0.5 * uViewport;

    vec2 delta = pxEnd - pxStart;
    float len = length(delta);
    vec2 unit = len > 0.0001 ? delta / len : vec2(1.0, 0.0);
    vec2 perp = vec2(-unit.y, unit.x);

    // position.x in {0,1} picks start/end; position.y in {-1,+1} picks the side.
    vec2 basePx = mix(pxStart, pxEnd, position.x) + perp * (position.y * uHalfWidthPx);
    vec2 ndc = basePx / (0.5 * uViewport);
    gl_Position = vec4(ndc, 0.0, 1.0);

    vColour = aColour;

    float age = uNow - aReleaseTime; // negative while active or pre-hold
    float a = 1.0;
    if (age > uHoldMs) {
      a = 1.0 - clamp((age - uHoldMs) / uFadeMs, 0.0, 1.0);
    }
    vAlpha = a;
  }
`;

const scribbleFragmentShader = `
  precision mediump float;
  varying vec3 vColour;
  varying float vAlpha;
  void main() {
    if (vAlpha <= 0.0) discard;
    gl_FragColor = vec4(vColour, vAlpha);
  }
`;

// A single instanced draw call rendering every live scribble segment as a
// constant-pixel-width quad that fades per stroke. Endpoints are world coords
// so strokes track pan/zoom; the width is expanded in screen space.
export class ScribbleDrawing {
  private readonly _maxSegments: number;
  private readonly _t0 = Date.now();

  private readonly _aStart: Float32Array;
  private readonly _aEnd: Float32Array;
  private readonly _aColour: Float32Array;
  private readonly _aReleaseTime: Float32Array;

  private readonly _aStartAttr: THREE.InstancedBufferAttribute;
  private readonly _aEndAttr: THREE.InstancedBufferAttribute;
  private readonly _aColourAttr: THREE.InstancedBufferAttribute;
  private readonly _aReleaseAttr: THREE.InstancedBufferAttribute;

  private readonly _geometry: THREE.InstancedBufferGeometry;
  private readonly _material: THREE.ShaderMaterial;
  private readonly _mesh: THREE.Mesh;
  private readonly _scene: THREE.Scene;

  private _count = 0;

  get geometry() { return this._geometry; }
  get segmentCount() { return this._count; }
  get hasContent() { return this._count > 0; }

  constructor(maxSegments: number, z: number) {
    this._maxSegments = maxSegments;

    this._geometry = new THREE.InstancedBufferGeometry();
    const positions = new Float32Array([
      0, -1, 0,
      1, -1, 0,
      1,  1, 0,
      0,  1, 0,
    ]);
    this._geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this._geometry.setIndex([0, 1, 2, 0, 2, 3]);

    this._aStart = new Float32Array(maxSegments * 2);
    this._aEnd = new Float32Array(maxSegments * 2);
    this._aColour = new Float32Array(maxSegments * 3);
    this._aReleaseTime = new Float32Array(maxSegments);

    this._aStartAttr = new THREE.InstancedBufferAttribute(this._aStart, 2);
    this._aEndAttr = new THREE.InstancedBufferAttribute(this._aEnd, 2);
    this._aColourAttr = new THREE.InstancedBufferAttribute(this._aColour, 3);
    this._aReleaseAttr = new THREE.InstancedBufferAttribute(this._aReleaseTime, 1);
    for (const a of [this._aStartAttr, this._aEndAttr, this._aColourAttr, this._aReleaseAttr]) {
      a.setUsage(THREE.DynamicDrawUsage);
    }
    this._geometry.setAttribute('aStart', this._aStartAttr);
    this._geometry.setAttribute('aEnd', this._aEndAttr);
    this._geometry.setAttribute('aColour', this._aColourAttr);
    this._geometry.setAttribute('aReleaseTime', this._aReleaseAttr);
    this._geometry.instanceCount = 0;

    this._material = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
      vertexShader: scribbleVertexShader,
      fragmentShader: scribbleFragmentShader,
      uniforms: {
        uNow: { value: 0 },
        uViewport: { value: new THREE.Vector2(1, 1) },
        uHalfWidthPx: { value: SCRIBBLE_HALF_WIDTH_PX },
        uHoldMs: { value: SCRIBBLE_FADE_HOLD_MS },
        uFadeMs: { value: SCRIBBLE_FADE_MS },
        uZ: { value: z },
      },
    });

    this._mesh = new THREE.Mesh(this._geometry, this._material);
    this._mesh.frustumCulled = false;

    this._scene = new THREE.Scene();
    this._scene.add(this._mesh);
  }

  setSegments(segments: ScribbleSegment[]) {
    const n = Math.min(segments.length, this._maxSegments);
    for (let i = 0; i < n; ++i) {
      const s = segments[i];
      this._aStart[i * 2] = s.startX;
      this._aStart[i * 2 + 1] = s.startY;
      this._aEnd[i * 2] = s.endX;
      this._aEnd[i * 2 + 1] = s.endY;
      this._aColour[i * 3] = s.colour.r;
      this._aColour[i * 3 + 1] = s.colour.g;
      this._aColour[i * 3 + 2] = s.colour.b;
      this._aReleaseTime[i] = Number.isFinite(s.releaseTime)
        ? s.releaseTime - this._t0
        : ACTIVE_REL;
    }
    this._aStartAttr.needsUpdate = true;
    this._aEndAttr.needsUpdate = true;
    this._aColourAttr.needsUpdate = true;
    this._aReleaseAttr.needsUpdate = true;
    this._geometry.instanceCount = n;
    this._count = n;
  }

  setViewport(width: number, height: number) {
    (this._material.uniforms.uViewport.value as THREE.Vector2).set(
      Math.max(1, width), Math.max(1, height)
    );
  }

  updateNow(nowMs: number) {
    this._material.uniforms.uNow.value = nowMs - this._t0;
  }

  render(renderer: THREE.WebGLRenderer, camera: THREE.Camera) {
    renderer.render(this._scene, camera);
  }

  dispose() {
    this._geometry.dispose();
    this._material.dispose();
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run from `was-web/`: `yarn test --config ./unit/vitest.config.ts run unit/models/three/scribbleDrawing.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add was-web/src/models/three/scribbleDrawing.ts was-web/unit/models/three/scribbleDrawing.ts was-web/unit/models/three/scribbleDrawing.test.ts
git commit -m "Add ScribbleDrawing instanced fade renderer (#331)"
```

---

## Task 3: Wire `ScribbleDrawing` into `DrawingOrtho` + `IDrawing`

No unit test (rendering needs a real WebGL context, which the existing drawing code also lacks tests for). Verified by type-check, lint, and build; visual behaviour is verified manually in situ.

**Files:**
- Modify: `was-web/src/models/interfaces.ts`
- Modify: `was-web/src/models/three/drawingOrtho.ts`

- [ ] **Step 1: Add `setScribbles` to the `IDrawing` interface**

In `was-web/src/models/interfaces.ts`, add the import at the top (after the existing imports on lines 1-5):

```typescript
import { ScribbleSegment } from './scribbleTypes';
```

Then, inside the `IDrawing` interface, add this member just above `// Cleans up and releases all resources.` / `dispose(): void;`:

```typescript
  // Replaces the full set of ephemeral scribble segments to render (world
  // coordinates). Pass an empty array to clear. Triggers a redraw.
  setScribbles(segments: ScribbleSegment[]): void;
```

- [ ] **Step 2: Import `ScribbleDrawing` and the z/cap constants in `drawingOrtho.ts`**

In `was-web/src/models/three/drawingOrtho.ts`, add to the imports block (near the other `./` imports, e.g. after the `RedrawFlag` import on line 5):

```typescript
import { ScribbleDrawing } from './scribbleDrawing';
import { ScribbleSegment, SCRIBBLE_MAX_SEGMENTS } from '../scribbleTypes';
```

- [ ] **Step 3: Add the scribble z constant**

In `drawingOrtho.ts`, just after `const invalidSelectionZ = 0.6;` (line 40), add:

```typescript
const scribbleZ = 0.7; // above everything; depthTest is off so this only keeps it in clip range
```

- [ ] **Step 4: Declare the field**

In `drawingOrtho.ts`, add a field declaration alongside the other `private readonly` drawing fields (e.g. right after `private readonly _outlinedRectangle: OutlinedRectangle;` on line 67):

```typescript
  private readonly _scribbles: ScribbleDrawing;
```

- [ ] **Step 5: Construct it**

In the `DrawingOrtho` constructor, after the scenes are created (after `this._overlayScene = new THREE.Scene();` on line 165), add:

```typescript
    this._scribbles = new ScribbleDrawing(SCRIBBLE_MAX_SEGMENTS, scribbleZ);
```

- [ ] **Step 6: Implement `setScribbles`**

In `drawingOrtho.ts`, add this method to the class (e.g. just before `dispose()` on line 697):

```typescript
  setScribbles(segments: ScribbleSegment[]) {
    this._scribbles.setSegments(segments);
    this._needsRedraw.setNeedsRedraw();
  }
```

- [ ] **Step 7: Render scribbles last and keep the fade animating**

In `drawingOrtho.ts` `animate()`, change the redraw decision and render the scribble scene last. Replace lines 424-425:

```typescript
    const needsRedraw = this._needsRedraw.needsRedraw();
    const gridNeedsRedraw = this._gridNeedsRedraw.needsRedraw();
```

with:

```typescript
    const needsRedraw = this._needsRedraw.needsRedraw();
    const gridNeedsRedraw = this._gridNeedsRedraw.needsRedraw();
    const scribblesActive = this._scribbles.hasContent;
```

Then change the render guard on line 430 from:

```typescript
    if (gridNeedsRedraw || needsRedraw) {
```

to:

```typescript
    if (gridNeedsRedraw || needsRedraw || scribblesActive) {
```

Then, inside the `else` (normal rendering) branch, immediately after `this._renderer.render(this._overlayScene, this._overlayCamera);` (line 475), add:

```typescript
        this._scribbles.setViewport(window.innerWidth, window.innerHeight);
        this._scribbles.updateNow(Date.now());
        this._scribbles.render(this._renderer, this._camera);
```

Finally, keep the fade ticking: immediately after the `if (gridNeedsRedraw || needsRedraw || scribblesActive) { ... }` block closes (before `postAnimate?.();` on line 479), add:

```typescript
    if (scribblesActive) {
      this._needsRedraw.setNeedsRedraw();
    }
```

- [ ] **Step 8: Dispose it**

In `drawingOrtho.ts` `dispose()`, add (alongside the other dispose calls, e.g. after `this._outlinedRectangle.dispose();` on line 730):

```typescript
    this._scribbles.dispose();
```

- [ ] **Step 9: Verify type-check + lint + build**

Run from `was-web/`:
```bash
yarn tsc --noEmit -p tsconfig.json
yarn lint
yarn build
```
Expected: all succeed with no errors.

- [ ] **Step 10: Commit**

```bash
git add was-web/src/models/interfaces.ts was-web/src/models/three/drawingOrtho.ts
git commit -m "Render scribbles on top via DrawingOrtho (#331)"
```

---

## Task 4: `ScribbleController` — capture, subscription, merge

**Files:**
- Create: `was-web/src/models/scribbleController.ts`
- Create: `was-web/unit/models/scribbleController.ts` (re-export shim)
- Test: `was-web/unit/models/scribbleController.test.ts`

- [ ] **Step 1: Write the failing test**

Create `was-web/unit/models/scribbleController.test.ts`:

```typescript
import { describe, test, expect, beforeEach } from 'vitest';
import { ILiveData, OutgoingOverlayItem, OverlayItem } from '@wallandshadow/shared';
import { ScribbleController } from './scribbleController';
import { ScribbleSegment, SCRIBBLE_ACTIVE } from './scribbleTypes';

// Minimal fake of the bits of ILiveData the controller uses.
class FakeLive {
  sent: { mapId: string; item: OutgoingOverlayItem }[] = [];
  subs: { mapId: string; onNext: (items: OverlayItem[]) => void }[] = [];
  unsubscribes = 0;

  sendOverlayUpdate(mapId: string, item: OutgoingOverlayItem) {
    this.sent.push({ mapId, item });
  }
  watchLiveOverlays(mapId: string, onNext: (items: OverlayItem[]) => void) {
    const sub = { mapId, onNext };
    this.subs.push(sub);
    return () => { this.unsubscribes += 1; };
  }
  asLive(): ILiveData { return this as unknown as ILiveData; }
}

describe('ScribbleController', () => {
  let live: FakeLive;
  let rendered: ScribbleSegment[][];
  let nowMs: number;
  let pendingTimers: { fn: () => void; ms: number }[];

  function makeController() {
    return new ScribbleController({
      live: live.asLive(),
      // Identity transform: viewport coords == world coords for the test.
      toWorld: (cp) => ({ x: cp.x, y: cp.y }),
      setScribbles: (segs) => rendered.push(segs),
      now: () => nowMs,
      newId: () => 'item-1',
      schedule: (fn, ms) => { pendingTimers.push({ fn, ms }); return () => {}; },
    });
  }

  beforeEach(() => {
    live = new FakeLive();
    rendered = [];
    nowMs = 1000;
    pendingTimers = [];
  });

  test('setMap subscribes for that map', () => {
    const c = makeController();
    c.setMap('adv', 'map-1');
    expect(live.subs).toHaveLength(1);
    expect(live.subs[0].mapId).toBe('map-1');
  });

  test('a stroke sends a released frame on end with the world points', () => {
    const c = makeController();
    c.setMap('adv', 'map-1');
    c.start({ x: 0, y: 0 });
    nowMs += 200;
    c.move({ x: 50, y: 0 });   // beyond the sampling threshold
    c.end({ x: 100, y: 0 });

    const released = live.sent.filter(s => s.item.phase === 'released');
    expect(released).toHaveLength(1);
    expect(released[0].item.itemId).toBe('item-1');
    const payload = released[0].item.payload;
    expect(payload.kind).toBe('scribble');
    if (payload.kind === 'scribble') {
      expect(payload.points).toEqual([
        { x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 },
      ]);
    }
  });

  test('moves below the sampling threshold are dropped', () => {
    const c = makeController();
    c.setMap('adv', 'map-1');
    c.start({ x: 0, y: 0 });
    c.move({ x: 1, y: 0 }); // < threshold, ignored
    c.end({ x: 1, y: 0 });  // same point as last sampled, ignored as duplicate

    const released = live.sent.find(s => s.item.phase === 'released');
    const payload = released!.item.payload;
    if (payload.kind === 'scribble') {
      expect(payload.points).toEqual([{ x: 0, y: 0 }]);
    }
  });

  test('active sends are throttled by time', () => {
    const c = makeController();
    c.setMap('adv', 'map-1');
    c.start({ x: 0, y: 0 });
    c.move({ x: 50, y: 0 });   // same tick -> throttled, no active send
    nowMs += 100;              // past the throttle interval
    c.move({ x: 100, y: 0 });  // now an active send fires
    const active = live.sent.filter(s => s.item.phase === 'active');
    expect(active.length).toBe(1);
  });

  test('the local stroke is rendered optimistically', () => {
    const c = makeController();
    c.setMap('adv', 'map-1');
    c.start({ x: 0, y: 0 });
    c.move({ x: 50, y: 0 });
    const last = rendered[rendered.length - 1];
    expect(last.length).toBeGreaterThanOrEqual(1);
    expect(last[0].releaseTime).toBe(SCRIBBLE_ACTIVE);
  });

  test('remote scribbles are merged into the rendered segments', () => {
    const c = makeController();
    c.setMap('adv', 'map-1');
    const remote: OverlayItem = {
      itemId: 'r1', authorId: 'other', updatedAt: 500, releasedAt: 800,
      phase: 'released', payload: { kind: 'scribble', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
    };
    live.subs[0].onNext([remote]);
    const last = rendered[rendered.length - 1];
    expect(last).toHaveLength(1);
    expect(last[0].releaseTime).toBe(800);
  });

  test('non-scribble overlay items are ignored', () => {
    const c = makeController();
    c.setMap('adv', 'map-1');
    const ruler = {
      itemId: 'k1', authorId: 'other', updatedAt: 500,
      phase: 'active', payload: { kind: 'ruler', nodes: [] },
    } as unknown as OverlayItem;
    live.subs[0].onNext([ruler]);
    const last = rendered[rendered.length - 1];
    expect(last).toHaveLength(0);
  });

  test('setMap a second time unsubscribes the previous map', () => {
    const c = makeController();
    c.setMap('adv', 'map-1');
    c.setMap('adv', 'map-2');
    expect(live.unsubscribes).toBe(1);
    expect(live.subs[1].mapId).toBe('map-2');
  });

  test('dispose unsubscribes', () => {
    const c = makeController();
    c.setMap('adv', 'map-1');
    c.dispose();
    expect(live.unsubscribes).toBe(1);
  });
});
```

- [ ] **Step 2: Create the test shim**

Create `was-web/unit/models/scribbleController.ts`:

```typescript
export * from '../../src/models/scribbleController';
```

- [ ] **Step 3: Run the test to verify it fails**

Run from `was-web/`: `yarn test --config ./unit/vitest.config.ts run unit/models/scribbleController.test.ts`
Expected: FAIL — cannot find module `./scribbleController`.

- [ ] **Step 4: Implement `ScribbleController`**

Create `was-web/src/models/scribbleController.ts`:

```typescript
import { ILiveData, OverlayItem, PixelCoord, MAX_SCRIBBLE_POINTS } from '@wallandshadow/shared';
import {
  ScribbleSegment,
  SCRIBBLE_ACTIVE,
  SCRIBBLE_FADE_TOTAL_MS,
} from './scribbleTypes';

// Minimum movement (in viewport pixels) between sampled points, to bound the
// number of points/segments and avoid flooding the wire.
const SAMPLE_PX = 3;
// Minimum gap between fire-and-forget "active" frames while drawing.
const SEND_INTERVAL_MS = 80;

const WHITE = { r: 1, g: 1, b: 1 } as const;

interface Point2 { x: number; y: number; }

export interface ScribbleControllerParams {
  live: ILiveData;
  // Converts a viewport point (x,y) into world coordinates.
  toWorld: (cp: Point2) => Point2;
  // Pushes the current full segment set to the renderer.
  setScribbles: (segments: ScribbleSegment[]) => void;
  // Clock, injectable for tests.
  now: () => number;
  // Item id factory, injectable for tests.
  newId?: () => string;
  // Timer factory returning a cancel function, injectable for tests.
  schedule?: (fn: () => void, ms: number) => () => void;
}

interface LocalStroke {
  itemId: string;
  points: PixelCoord[];
  lastSampled: Point2;     // viewport coords of the last accepted sample
  lastSentAt: number;
}

interface ReleasedStroke {
  itemId: string;
  points: PixelCoord[];
  releasedAt: number;
  cancel: () => void;
}

// Owns ephemeral scribble capture for one map at a time: turns pointer drags
// into world-space strokes, sends them fire-and-forget, subscribes to peers,
// and merges remote + local strokes into renderable segments. It deliberately
// never touches the persistent map-change tracker.
export class ScribbleController {
  private readonly _live: ILiveData;
  private readonly _toWorld: (cp: Point2) => Point2;
  private readonly _setScribbles: (segments: ScribbleSegment[]) => void;
  private readonly _now: () => number;
  private readonly _newId: () => string;
  private readonly _schedule: (fn: () => void, ms: number) => () => void;

  private _mapId: string | undefined;
  private _unsub: (() => void) | undefined;

  private _remote: OverlayItem[] = [];
  private _local: LocalStroke | undefined;
  private _localReleased: ReleasedStroke[] = [];

  constructor(params: ScribbleControllerParams) {
    this._live = params.live;
    this._toWorld = params.toWorld;
    this._setScribbles = params.setScribbles;
    this._now = params.now;
    this._newId = params.newId ?? (() => crypto.randomUUID());
    this._schedule = params.schedule ?? ((fn, ms) => {
      const h = setTimeout(fn, ms);
      return () => clearTimeout(h);
    });
  }

  // Switches the active map: tears down old subscription/state and subscribes anew.
  setMap(_adventureId: string, mapId: string) {
    this._unsub?.();
    this._unsub = undefined;
    this._local = undefined;
    for (const r of this._localReleased) {
      r.cancel();
    }
    this._localReleased = [];
    this._remote = [];
    this._mapId = mapId;

    this._unsub = this._live.watchLiveOverlays(mapId, items => {
      this._remote = items.filter(it => it.payload.kind === 'scribble');
      this.pushRender();
    });
    this.pushRender();
  }

  start(cp: Point2) {
    if (this._mapId === undefined) {
      return;
    }
    const world = this._toWorld(cp);
    this._local = {
      itemId: this._newId(),
      points: [{ x: world.x, y: world.y }],
      lastSampled: { x: cp.x, y: cp.y },
      lastSentAt: this._now(),
    };
    this.pushRender();
  }

  move(cp: Point2) {
    const local = this._local;
    if (local === undefined) {
      return;
    }
    const dx = cp.x - local.lastSampled.x;
    const dy = cp.y - local.lastSampled.y;
    if (dx * dx + dy * dy < SAMPLE_PX * SAMPLE_PX) {
      return;
    }
    if (local.points.length >= MAX_SCRIBBLE_POINTS) {
      return;
    }
    const world = this._toWorld(cp);
    local.points.push({ x: world.x, y: world.y });
    local.lastSampled = { x: cp.x, y: cp.y };
    this.pushRender();

    const t = this._now();
    if (t - local.lastSentAt >= SEND_INTERVAL_MS) {
      this.send(local.itemId, local.points, 'active');
      local.lastSentAt = t;
    }
  }

  end(cp: Point2) {
    const local = this._local;
    if (local === undefined) {
      return;
    }
    // Append the final point only if it clears the sampling threshold from the
    // last accepted sample (same rule as move), so a barely-moved release does
    // not add a redundant point.
    const dx = cp.x - local.lastSampled.x;
    const dy = cp.y - local.lastSampled.y;
    if (dx * dx + dy * dy >= SAMPLE_PX * SAMPLE_PX && local.points.length < MAX_SCRIBBLE_POINTS) {
      const world = this._toWorld(cp);
      local.points.push({ x: world.x, y: world.y });
    }

    this.send(local.itemId, local.points, 'released');

    const releasedAt = this._now();
    const itemId = local.itemId;
    const released: ReleasedStroke = {
      itemId,
      points: local.points,
      releasedAt,
      cancel: () => {},
    };
    released.cancel = this._schedule(() => {
      this._localReleased = this._localReleased.filter(r => r.itemId !== itemId);
      this.pushRender();
    }, SCRIBBLE_FADE_TOTAL_MS);
    this._localReleased.push(released);

    this._local = undefined;
    this.pushRender();
  }

  dispose() {
    this._unsub?.();
    this._unsub = undefined;
    for (const r of this._localReleased) {
      r.cancel();
    }
    this._localReleased = [];
    this._local = undefined;
  }

  private send(itemId: string, points: PixelCoord[], phase: 'active' | 'released') {
    if (this._mapId === undefined) {
      return;
    }
    this._live.sendOverlayUpdate(this._mapId, {
      itemId,
      phase,
      payload: { kind: 'scribble', points: points.map(p => ({ x: p.x, y: p.y })) },
    });
  }

  private pushRender() {
    const segments: ScribbleSegment[] = [];

    // Remote strokes first (oldest update first), then locally-released, then
    // the in-progress local stroke on top. Painter's order = newer on top.
    const remote = [...this._remote].sort((a, b) => a.updatedAt - b.updatedAt);
    for (const it of remote) {
      if (it.payload.kind !== 'scribble') {
        continue;
      }
      appendSegments(segments, it.payload.points, it.releasedAt ?? SCRIBBLE_ACTIVE);
    }
    for (const r of [...this._localReleased].sort((a, b) => a.releasedAt - b.releasedAt)) {
      appendSegments(segments, r.points, r.releasedAt);
    }
    if (this._local !== undefined) {
      appendSegments(segments, this._local.points, SCRIBBLE_ACTIVE);
    }

    this._setScribbles(segments);
  }
}

function appendSegments(out: ScribbleSegment[], points: PixelCoord[], releaseTime: number) {
  for (let i = 0; i + 1 < points.length; ++i) {
    out.push({
      startX: points[i].x,
      startY: points[i].y,
      endX: points[i + 1].x,
      endY: points[i + 1].y,
      colour: WHITE,
      releaseTime,
    });
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run from `was-web/`: `yarn test --config ./unit/vitest.config.ts run unit/models/scribbleController.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 6: Commit**

```bash
git add was-web/src/models/scribbleController.ts was-web/unit/models/scribbleController.ts was-web/unit/models/scribbleController.test.ts
git commit -m "Add ScribbleController for ephemeral scribble capture (#331)"
```

---

## Task 5: Wire the controller into `MapStateMachine` and `MapLifecycleManager`

No new unit test (the state machine constructs the real WebGL drawing). Verified by the controller tests plus type-check/lint/build, and manually in situ.

**Files:**
- Modify: `was-web/src/models/mapStateMachine.ts`
- Modify: `was-web/src/models/mapLifecycleManager.ts`

- [ ] **Step 1: Import the controller and `ILiveData` in `mapStateMachine.ts`**

In `was-web/src/models/mapStateMachine.ts`, add to the local imports block (after the `import { MapChangeTracker } ...` line ~8):

```typescript
import { ScribbleController } from './scribbleController';
```

Add `ILiveData` to the existing `@wallandshadow/shared` import list (the long destructured import ending line ~13). Append `, ILiveData` before the closing `}`.

- [ ] **Step 2: Add a `live` constructor parameter and a controller field**

In `mapStateMachine.ts`, add the field near the other `private readonly` fields (e.g. after `_sendChanges` on line 80):

```typescript
  private readonly _scribbleController: ScribbleController;
```

Add a `live` parameter to the constructor. Change the parameter list (lines 156-167) so that immediately after:

```typescript
    sendChanges: (adventureId: string, mapId: string, changes: Change[]) => Promise<void>,
```

it reads:

```typescript
    sendChanges: (adventureId: string, mapId: string, changes: Change[]) => Promise<void>,
    live: ILiveData,
```

- [ ] **Step 3: Construct the controller after the drawing exists**

In `mapStateMachine.ts`, the drawing is created at lines 185-188 (`this._drawing = createDrawing(...)`). Immediately after that assignment, add:

```typescript
    const scribbleScratchM = new THREE.Matrix4();
    const scribbleScratchV = new THREE.Vector3();
    this._scribbleController = new ScribbleController({
      live,
      toWorld: cp => {
        const m = getClientToWorld(scribbleScratchM, this._drawing);
        const v = scribbleScratchV.set(cp.x, cp.y, 0).applyMatrix4(m);
        return { x: v.x, y: v.y };
      },
      setScribbles: segs => this._drawing.setScribbles(segs),
      now: () => Date.now(),
    });
    this._scribbleController.setMap(map.adventureId, map.id);
```

`getClientToWorld` is already imported at line 4; `map` is the constructor parameter; `live` is the new constructor parameter from Step 2. The `ScribbleControllerParams` shape (Task 4) is `{ live, toWorld, setScribbles, now, newId?, schedule? }` — pass exactly those.

- [ ] **Step 4: Rebind on map change**

In `mapStateMachine.ts` `configure()`, after `this._map = map;` (line 1123), add:

```typescript
    this._scribbleController.setMap(map.adventureId, map.id);
```

- [ ] **Step 5: Add the `scribbleStart/Move/End` delegators**

In `mapStateMachine.ts`, add these methods to the class (e.g. just before `dispose()` on line 1707):

```typescript
  scribbleStart(cp: THREE.Vector3) {
    this._scribbleController.start({ x: cp.x, y: cp.y });
  }

  scribbleMove(cp: THREE.Vector3) {
    this._scribbleController.move({ x: cp.x, y: cp.y });
  }

  scribbleEnd(cp: THREE.Vector3) {
    this._scribbleController.end({ x: cp.x, y: cp.y });
  }
```

- [ ] **Step 6: Dispose the controller**

In `mapStateMachine.ts` `dispose()` (lines 1707-1714), add `this._scribbleController.dispose();` before `this._drawing.dispose();`:

```typescript
  dispose() {
    if (this._isDisposed === false) {
      console.debug("disposing map state machine");
      this._stateSubj.complete();
      this._scribbleController.dispose();
      this._drawing.dispose();
      this._isDisposed = true;
    }
  }
```

- [ ] **Step 7: Pass `live` from `MapLifecycleManager`**

In `was-web/src/models/mapLifecycleManager.ts`, the state machine is built at lines 57-67. Insert the `live` argument right after the `sendChanges` closure. Change:

```typescript
    const newStateMachine = new MapStateMachine(
      (adventureId, mapId, changes) => live.sendMapChange(adventureId, mapId, changes),
      map,
```

to:

```typescript
    const newStateMachine = new MapStateMachine(
      (adventureId, mapId, changes) => live.sendMapChange(adventureId, mapId, changes),
      live,
      map,
```

- [ ] **Step 8: Verify type-check + lint + the existing unit suite**

Run from `was-web/`:
```bash
yarn tsc --noEmit -p tsconfig.json
yarn lint
yarn test --config ./unit/vitest.config.ts run
```
Expected: type-check and lint clean; all unit tests pass (including the new scribble tests).

- [ ] **Step 9: Commit**

```bash
git add was-web/src/models/mapStateMachine.ts was-web/src/models/mapLifecycleManager.ts
git commit -m "Wire ScribbleController into the map state machine (#331)"
```

---

## Task 6: Add the `Scribble` edit mode, toolbar button, and pointer routing

**Files:**
- Modify: `was-web/src/components/MapControls.types.ts`
- Modify: `was-web/src/components/MapControls.tsx`
- Modify: `was-web/src/models/mapUi.ts`

- [ ] **Step 1: Add the enum value**

In `was-web/src/components/MapControls.types.ts`, add `Scribble` to the `EditMode` enum:

```typescript
export enum EditMode {
  Select = "select",
  Token = "token",
  CharacterToken = "characterToken",
  Notes = "notes",
  Area = "area",
  PlayerArea = "playerArea",
  Wall = "wall",
  Room = "room",
  Image = "image",
  Scribble = "scribble"
}
```

- [ ] **Step 2: Import the pencil icon**

In `was-web/src/components/MapControls.tsx`, add `faPencil` to the `@fortawesome/free-solid-svg-icons` import on line 17 (append `, faPencil` before the closing `}`).

- [ ] **Step 3: Add the ungated tool button**

In `MapControls.tsx`, inside the `modeButtons` `useMemo` (lines 147-227), add the Scribble button so it is available to **every** user in **every** layer. Place it immediately after the `buttons` array is initialised with the Select button — i.e. right after the closing `];` of the initial `const buttons = [ ... ];` (line 153):

```typescript
    buttons.push(
      <ModeButton key={EditMode.Scribble} value={EditMode.Scribble}
        icon={<FontAwesomeIcon icon={faPencil} color="white" />}
        mode={editMode} setMode={setEditMode} name={editModeRadioName}
      >
        Scribble on the map.  Hold the left button and draw; scribbles fade after a few seconds.
      </ModeButton>
    );
```

- [ ] **Step 4: Route pointer events in `mapUi.ts`**

In `was-web/src/models/mapUi.ts`:

In `interactionStart` (the `switch` at lines 245-265), add a case (e.g. after the `EditMode.Room` case on line 264):

```typescript
      case EditMode.Scribble:
        this._stateMachine?.scribbleStart(cp);
        break;
```

In `interactionMove` (the `switch` at lines 221-237), add a case (e.g. after the `EditMode.Room` case on line 230):

```typescript
        case EditMode.Scribble: this._stateMachine?.scribbleMove(cp); break;
```

In `interactionEnd` (the `switch` at lines 160-205), add a case (e.g. after the `EditMode.Room` case on lines 196-198). It must leave `changes` undefined so nothing is committed and the tool is **not** reset to Select:

```typescript
        case EditMode.Scribble:
          this._stateMachine?.scribbleEnd(cp);
          break;
```

- [ ] **Step 5: Verify type-check + lint + build**

Run from `was-web/`:
```bash
yarn tsc --noEmit -p tsconfig.json
yarn lint
yarn build
```
Expected: all succeed.

- [ ] **Step 6: Commit**

```bash
git add was-web/src/components/MapControls.types.ts was-web/src/components/MapControls.tsx was-web/src/models/mapUi.ts
git commit -m "Add scribble pencil tool and pointer routing (#331)"
```

---

## Task 7: Full verification pass

- [ ] **Step 1: Run the whole unit suite + lint + build**

Run from `was-web/`:
```bash
yarn lint
yarn build
yarn test --config ./unit/vitest.config.ts run
```
Expected: lint clean, build succeeds, all unit tests pass.

- [ ] **Step 2: Manual smoke test in situ**

In two terminals from `was-web/`: `cd server && yarn dev`, and `yarn dev:vite`. Open http://localhost:5000 in two browsers signed in as different users on the same map.

Verify:
1. The pencil tool appears in the toolbar for both the owner and a non-owner player.
2. Selecting it and holding the left button draws a white line that follows the cursor.
3. The scribble is visible above tokens, walls, areas, and the grid.
4. Panning and zooming move/scale the scribble with the map; the line stays ~3-4px wide at any zoom.
5. After releasing, the scribble holds briefly then fades to nothing over ~10s.
6. The second browser sees the first user's scribble appear and fade.
7. Selecting the pencil again and drawing a second time works (the tool does not auto-switch back to Select).

Note any deviations for the next iteration (this first take is intended to be iterated on after visual inspection).

---

## Notes for the implementer

- **Do not** route scribbles through `addChanges`, the change tracker, or `live.sendMapChange`. Scribbles are ephemeral; they only ever use `live.sendOverlayUpdate` / `live.watchLiveOverlays`.
- **Do not** modify `@wallandshadow/shared`. If you find yourself wanting to, stop — the design deliberately reuses the data layer as-is.
- White colour is intentional for v1. The `aColour` instance attribute and `ScribbleSegment.colour` exist so a later iteration can derive the author's first-token hue without touching the buffer layout.
- The fade clock is `Date.now()` everywhere (local `releasedAt`, the `uNow` uniform, and remote `releasedAt` from the server). `ScribbleDrawing` rebases to a small relative range internally to keep float32 precision.
