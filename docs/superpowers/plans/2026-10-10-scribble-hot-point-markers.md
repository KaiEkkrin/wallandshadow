# Scribble Hot-Point Markers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While another user is scribbling, mark their hot point (the newest point of the stroke in progress). On screen, it gets a pulsing hollow ring. Off screen, a pulsing arrow at the screen edge points at it. Both use the author's scribble colours. Also stop a held-but-still stroke from expiring on peers' screens.

**Spec:** [`docs/superpowers/specs/2026-10-10-scribble-hot-point-markers-design.md`](../specs/2026-10-10-scribble-hot-point-markers-design.md). Read it first; this plan does not repeat its reasoning.

**Architecture:** `ScribbleController` emits one `ScribbleMarker` per remote active item. A THREE-free `ScribbleMarkerTracker` smooths and fades the markers. A pure `placeMarker` decides between ring and arrow and does the edge intersection. `ScribbleMarkerDrawing` projects the markers on the CPU each frame and draws them in one instanced pass with a small shader that draws the shapes. The controller also gains an 80 ms tick while a stroke is held, which handles the trailing flush and the keepalive. Nothing changes in `@wallandshadow/shared`, on the wire or on the server.

**Tech Stack:** TypeScript, Three.js (`ShaderMaterial` + `InstancedBufferGeometry`), Vitest (node env).

---

## File structure

| File | Responsibility | Action |
| --- | --- | --- |
| `src/models/scribbleTypes.ts` | `ScribbleMarker` type; marker constants | Modify |
| `src/models/scribbleMarkers.ts` | `ScribbleMarkerTracker` (smoothing + fade), `placeMarker` (ring vs arrow, edge intersection) | Create |
| `src/models/scribbleController.ts` | Emit markers; 80 ms tick with trailing flush + keepalive | Modify |
| `src/models/three/scribbleMarkerDrawing.ts` | Per-frame projection + layout; instanced ring/arrow shader | Create |
| `src/models/three/drawingOrtho.ts` | Own, update, render, resize and dispose the marker drawing; keep the loop alive while markers exist | Modify |
| `src/models/interfaces.ts` | `IDrawing.setScribbleMarkers` | Modify |
| `src/models/mapStateMachine.ts` | Wire `setMarkers` into the controller | Modify |
| `unit/models/scribbleMarkers.ts` + `.test.ts` | Shim + tests | Create |
| `unit/models/three/scribbleMarkerDrawing.ts` + `.test.ts` | Shim + tests | Create |
| `unit/models/scribbleController.test.ts` | Marker, tick and keepalive tests; fix the prune-timer test | Modify |
| `docs/architecture/ephemeral-state.md` | Markers exist; keepalive; code locations | Modify |

Run tests from `was-web/`: `npm test -- <path>` (one-shot) or `npm run test:unit` (watch).

Commit after each task. Per project preference these are sequential commits on this branch, not separate PRs.

---

## Task 1: Types and constants

**Files:** Modify `was-web/src/models/scribbleTypes.ts`

- [ ] **Step 1:** Append:

```typescript
// A remote scribbler's hot point (the newest point of their stroke in
// progress), in world coordinates. Keyed by authorId/itemId.
export interface ScribbleMarker {
  key: string;
  point: { x: number; y: number };
  style: ScribbleStyle;
}

// Hot-point markers: a hollow ring over the hot point when it is on screen, or
// an arrow at the screen edge pointing towards it when it is not. Sizes are
// CSS pixels; the arrow scales with the author's widthScale, and the ring's
// band uses the stroke half-widths above.
export const SCRIBBLE_MARKER_RING_RADIUS_PX = 12;
export const SCRIBBLE_MARKER_ARROW_LENGTH_PX = 22;
export const SCRIBBLE_MARKER_ARROW_HALF_WIDTH_PX = 9;
// Every marker pulses in phase: up to GROW larger and DIM fainter at the peak.
export const SCRIBBLE_MARKER_PULSE_MS = 1000;
export const SCRIBBLE_MARKER_PULSE_GROW = 0.25;
export const SCRIBBLE_MARKER_PULSE_DIM = 0.35;
// Remote points arrive at most every 80 ms; markers ease towards the latest
// one with this time constant, and fade out over FADE when their stroke ends.
export const SCRIBBLE_MARKER_SMOOTH_MS = 60;
export const SCRIBBLE_MARKER_FADE_MS = 250;
export const SCRIBBLE_MARKER_MAX = 64;
```

- [ ] **Step 2:** `cd was-web && npx tsc --noEmit -p .`. Expected: passes, since this only adds.
- [ ] **Step 3:** Commit: `Add scribble hot-point marker types and constants`.

---

## Task 2: `placeMarker` and `ScribbleMarkerTracker` (TDD)

**Files:** Create `was-web/src/models/scribbleMarkers.ts`, `was-web/unit/models/scribbleMarkers.ts`, `was-web/unit/models/scribbleMarkers.test.ts`

- [ ] **Step 1:** Shim `unit/models/scribbleMarkers.ts`:

```typescript
export * from '../../src/models/scribbleMarkers';
```

- [ ] **Step 2:** Write the failing tests in `unit/models/scribbleMarkers.test.ts`:

```typescript
import { describe, test, expect } from 'vitest';
import { placeMarker, ScribbleMarkerTracker } from './scribbleMarkers';
import { ScribbleMarker, ScribbleStyle, SCRIBBLE_MARKER_FADE_MS, SCRIBBLE_MARKER_SMOOTH_MS } from './scribbleTypes';

const HW = 400;
const HH = 300;

describe('placeMarker', () => {
  test('a point on screen gets a ring centred on it', () => {
    expect(placeMarker({ x: 100, y: -50 }, HW, HH)).toEqual({ kind: 'ring', centre: { x: 100, y: -50 } });
  });

  test('a point exactly on the corner is still on screen', () => {
    expect(placeMarker({ x: HW, y: HH }, HW, HH).kind).toBe('ring');
  });

  test('off the right edge: tip on the right edge, pointing right', () => {
    expect(placeMarker({ x: 800, y: 0 }, HW, HH)).toEqual({ kind: 'arrow', tip: { x: 400, y: 0 }, dir: { x: 1, y: 0 } });
  });

  test('off the bottom edge with a zero x component', () => {
    expect(placeMarker({ x: 0, y: -900 }, HW, HH)).toEqual({ kind: 'arrow', tip: { x: 0, y: -300 }, dir: { x: 0, y: -1 } });
  });

  test('off a corner: the tip lands on whichever edge the ray crosses first', () => {
    // Crosses x = -400 (t = 0.5) before y = 300 (t = 1).
    const left = placeMarker({ x: -800, y: 300 }, HW, HH);
    expect(left.kind === 'arrow' && left.tip).toEqual({ x: -400, y: 150 });
    // Crosses y = 300 (t = 0.5) before x = 400 (t = 0.8).
    const top = placeMarker({ x: 500, y: 600 }, HW, HH);
    expect(top.kind === 'arrow' && top.tip).toEqual({ x: 250, y: 300 });
  });

  test('the tip is on the boundary and in line with the hot point', () => {
    for (const p of [{ x: 1234, y: 77 }, { x: -50, y: 4000 }, { x: -999, y: -999 }, { x: 401, y: -1 }]) {
      const m = placeMarker(p, HW, HH);
      if (m.kind !== 'arrow') throw new Error('expected an arrow');
      expect(Math.max(Math.abs(m.tip.x) / HW, Math.abs(m.tip.y) / HH)).toBeCloseTo(1);
      // Parallel and in the same direction.
      expect(m.tip.x * p.y - m.tip.y * p.x).toBeCloseTo(0);
      expect(m.dir.x * p.x + m.dir.y * p.y).toBeGreaterThan(0);
      expect(Math.hypot(m.dir.x, m.dir.y)).toBeCloseTo(1);
    }
  });
});

const style: ScribbleStyle = { fill: { r: 1, g: 0, b: 0 }, outline: { r: 0, g: 0, b: 1 }, widthScale: 1 };

function marker(key: string, x: number, y: number): ScribbleMarker {
  return { key, point: { x, y }, style };
}

describe('ScribbleMarkerTracker', () => {
  test('a new marker starts at its point, fully opaque', () => {
    const t = new ScribbleMarkerTracker();
    t.setMarkers([marker('a/1', 10, 20)], 0);
    expect(t.hasContent).toBe(true);
    expect(t.update(0)).toEqual([{ point: { x: 10, y: 20 }, style, alpha: 1 }]);
  });

  test('a moved marker eases towards its new point', () => {
    const t = new ScribbleMarkerTracker();
    t.setMarkers([marker('a/1', 0, 0)], 0);
    t.setMarkers([marker('a/1', 100, 0)], 0);
    const [f] = t.update(SCRIBBLE_MARKER_SMOOTH_MS);
    expect(f.point.x).toBeCloseTo(100 * (1 - Math.exp(-1)));
  });

  test('easing does not depend on how time is split into frames', () => {
    const one = new ScribbleMarkerTracker();
    const many = new ScribbleMarkerTracker();
    for (const t of [one, many]) {
      t.setMarkers([marker('a/1', 0, 0)], 0);
      t.setMarkers([marker('a/1', 100, 0)], 0);
    }
    const [a] = one.update(90);
    many.update(10);
    many.update(45);
    const [b] = many.update(90);
    expect(b.point.x).toBeCloseTo(a.point.x);
  });

  test('a marker that disappears fades out linearly, then is dropped', () => {
    const t = new ScribbleMarkerTracker();
    t.setMarkers([marker('a/1', 0, 0)], 0);
    t.setMarkers([], 1000);
    expect(t.update(1000)[0].alpha).toBeCloseTo(1);
    expect(t.update(1000 + SCRIBBLE_MARKER_FADE_MS / 2)[0].alpha).toBeCloseTo(0.5);
    expect(t.update(1000 + SCRIBBLE_MARKER_FADE_MS)).toEqual([]);
    expect(t.hasContent).toBe(false);
  });

  test('a marker that comes back cancels its fade', () => {
    const t = new ScribbleMarkerTracker();
    t.setMarkers([marker('a/1', 0, 0)], 0);
    t.setMarkers([], 1000);
    t.setMarkers([marker('a/1', 0, 0)], 1100);
    expect(t.update(1100 + SCRIBBLE_MARKER_FADE_MS)[0].alpha).toBe(1);
  });

  test('frames come out in the order markers first appeared', () => {
    const t = new ScribbleMarkerTracker();
    t.setMarkers([marker('a/1', 0, 0)], 0);
    t.setMarkers([marker('b/1', 5, 5), marker('a/1', 0, 0)], 0);
    expect(t.update(0).map(f => f.point.x)).toEqual([0, 5]);
  });
});
```

- [ ] **Step 3:** `npm test -- unit/models/scribbleMarkers.test.ts`. Expected: fails, because the module doesn't exist.

- [ ] **Step 4:** Implement `src/models/scribbleMarkers.ts`:

```typescript
import {
  ScribbleMarker,
  ScribbleStyle,
  SCRIBBLE_MARKER_FADE_MS,
  SCRIBBLE_MARKER_SMOOTH_MS,
} from './scribbleTypes';

interface Point2 { x: number; y: number; }

export type MarkerPlacement =
  | { kind: 'ring'; centre: Point2 }
  | { kind: 'arrow'; tip: Point2; dir: Point2 };

// Decides how to show a hot point at `px` (CSS pixels from the screen centre)
// on a screen of the given half-size. On screen: a ring centred on it. Off
// screen: an arrow whose tip is where the line from the centre to the hot point
// crosses the screen edge, pointing along that line.
export function placeMarker(px: Point2, halfWidth: number, halfHeight: number): MarkerPlacement {
  if (Math.abs(px.x) <= halfWidth && Math.abs(px.y) <= halfHeight) {
    return { kind: 'ring', centre: { x: px.x, y: px.y } };
  }
  const tx = px.x === 0 ? Infinity : halfWidth / Math.abs(px.x);
  const ty = px.y === 0 ? Infinity : halfHeight / Math.abs(px.y);
  const t = Math.min(tx, ty);
  const len = Math.hypot(px.x, px.y);
  return {
    kind: 'arrow',
    tip: { x: px.x * t, y: px.y * t },
    dir: { x: px.x / len, y: px.y / len },
  };
}

export interface ScribbleMarkerFrame {
  point: Point2;
  style: ScribbleStyle;
  alpha: number;
}

interface TrackedMarker {
  pos: Point2;
  target: Point2;
  style: ScribbleStyle;
  lastUpdate: number;
  // When the marker left the set, or undefined while it is present.
  goneSince: number | undefined;
}

// Presentation state for hot-point markers: eases each one towards its latest
// point, and fades it out briefly once its stroke is released or removed.
export class ScribbleMarkerTracker {
  private readonly _markers = new Map<string, TrackedMarker>();

  get hasContent() { return this._markers.size > 0; }

  setMarkers(markers: ScribbleMarker[], now: number) {
    const present = new Set<string>();
    for (const m of markers) {
      present.add(m.key);
      const tracked = this._markers.get(m.key);
      if (tracked === undefined) {
        this._markers.set(m.key, {
          pos: { ...m.point }, target: { ...m.point }, style: m.style, lastUpdate: now, goneSince: undefined,
        });
      } else {
        tracked.target = { ...m.point };
        tracked.style = m.style;
        tracked.goneSince = undefined;
      }
    }
    for (const [key, tracked] of this._markers) {
      if (!present.has(key) && tracked.goneSince === undefined) {
        tracked.goneSince = now;
      }
    }
  }

  update(now: number): ScribbleMarkerFrame[] {
    const frames: ScribbleMarkerFrame[] = [];
    for (const [key, tracked] of this._markers) {
      const alpha = tracked.goneSince === undefined
        ? 1
        : 1 - (now - tracked.goneSince) / SCRIBBLE_MARKER_FADE_MS;
      if (alpha <= 0) {
        this._markers.delete(key);
        continue;
      }
      // Exponential easing, so the result is independent of the frame rate.
      const k = 1 - Math.exp(-Math.max(0, now - tracked.lastUpdate) / SCRIBBLE_MARKER_SMOOTH_MS);
      tracked.pos = {
        x: tracked.pos.x + (tracked.target.x - tracked.pos.x) * k,
        y: tracked.pos.y + (tracked.target.y - tracked.pos.y) * k,
      };
      tracked.lastUpdate = now;
      frames.push({ point: { ...tracked.pos }, style: tracked.style, alpha: Math.min(1, alpha) });
    }
    return frames;
  }
}
```

- [ ] **Step 5:** Run the tests again. Expected: all pass.
- [ ] **Step 6:** Commit: `Add scribble marker placement and smoothing`.

---

## Task 3: Controller — tick, trailing flush and keepalive (TDD)

**Files:** Modify `was-web/src/models/scribbleController.ts` and `was-web/unit/models/scribbleController.test.ts`

- [ ] **Step 1:** In the test file, add a tick helper next to `pendingTimers`, and fix the existing prune-timer test, which assumes the fade timer is the only timer:

```typescript
import { ScribbleController, SEND_INTERVAL_MS, KEEPALIVE_MS } from './scribbleController';
import { SCRIBBLE_FADE_TOTAL_MS } from './scribbleTypes';

  // Fires the pending send ticks (and only those), as their timer would.
  function tick() {
    const due = pendingTimers.filter(t => t.ms === SEND_INTERVAL_MS);
    pendingTimers = pendingTimers.filter(t => t.ms !== SEND_INTERVAL_MS);
    for (const t of due) {
      t.fn();
    }
  }

  function activeFrames() {
    return live.sent.filter(s => s.item.phase === 'active');
  }
```

In `'a released stroke is pruned after its fade timer fires'`, replace the two `pendingTimers` lines with:

```typescript
    const prune = pendingTimers.filter(t => t.ms === SCRIBBLE_FADE_TOTAL_MS);
    expect(prune).toHaveLength(1);
    prune[0].fn();
```

- [ ] **Step 2:** Add the failing tests:

```typescript
  test('the first tick sends the held stroke, even before the pointer moves', () => {
    const c = makeController();
    c.setMap('adv', 'map-1');
    c.start({ x: 10, y: 20 });
    nowMs += SEND_INTERVAL_MS;
    tick();
    expect(activeFrames()).toHaveLength(1);
    const payload = activeFrames()[0].item.payload;
    expect(payload.kind === 'scribble' && payload.points).toEqual([{ x: 10, y: 20 }]);
  });

  test('a tick flushes points that the send throttle held back', () => {
    const c = makeController();
    c.setMap('adv', 'map-1');
    c.start({ x: 0, y: 0 });
    nowMs += 100;
    c.move({ x: 50, y: 0 });   // sent: 100 ms since start
    nowMs += 10;
    c.move({ x: 100, y: 0 });  // held back: 10 ms since the last send
    expect(activeFrames()).toHaveLength(1);

    nowMs += SEND_INTERVAL_MS;
    tick();
    expect(activeFrames()).toHaveLength(2);
    const payload = activeFrames()[1].item.payload;
    expect(payload.kind === 'scribble' && payload.points.length).toBe(3);
  });

  test('a held, still stroke is resent as a keepalive', () => {
    const c = makeController();
    c.setMap('adv', 'map-1');
    c.start({ x: 0, y: 0 });
    nowMs += 100;
    c.move({ x: 50, y: 0 });
    expect(activeFrames()).toHaveLength(1);

    nowMs += KEEPALIVE_MS / 2;
    tick();
    expect(activeFrames()).toHaveLength(1);  // nothing new, and not due yet
    nowMs += KEEPALIVE_MS / 2;
    tick();
    expect(activeFrames()).toHaveLength(2);
  });

  test('ticks stop at release, and a late tick sends nothing', () => {
    const c = makeController();
    c.setMap('adv', 'map-1');
    c.start({ x: 0, y: 0 });
    c.move({ x: 50, y: 0 });
    c.end({ x: 100, y: 0 });
    const sent = live.sent.length;

    nowMs += KEEPALIVE_MS * 2;
    tick();
    expect(live.sent).toHaveLength(sent);
    expect(pendingTimers.filter(t => t.ms === SEND_INTERVAL_MS)).toHaveLength(0);
  });

  test('switching maps abandons the held stroke and its ticks', () => {
    const c = makeController();
    c.setMap('adv', 'map-1');
    c.start({ x: 0, y: 0 });
    c.setMap('adv', 'map-2');
    nowMs += KEEPALIVE_MS * 2;
    tick();
    expect(live.sent).toHaveLength(0);
  });
```

- [ ] **Step 3:** `npm test -- unit/models/scribbleController.test.ts`. Expected: the new tests fail, because the constants aren't exported and there is no tick.

- [ ] **Step 4:** Implement in `scribbleController.ts`:
  - Export the interval, and add the keepalive next to it:

    ```typescript
    // Minimum gap between fire-and-forget "active" frames while drawing.
    export const SEND_INTERVAL_MS = 80;
    // While a stroke is held, resend it at least this often even if nothing has
    // changed, so the server's staleness timeout (ACTIVE_STALE_MS, 5 s) never
    // drops a stroke whose author is simply holding still.
    export const KEEPALIVE_MS = 2000;
    ```

  - `LocalStroke` gains `sentCount: number` (points sent in the last frame) and `cancelTick: () => void`.
  - `start()`: build the stroke with `sentCount: 0` and `cancelTick: () => {}`, assign it to `this._local`, then call `this.scheduleTick(this._local)`. `lastSentAt` stays `this._now()`, so the first tick (80 ms later) sends the one-point stroke.
  - `move()`: replace the throttled send block with:

    ```typescript
    if (this._now() - local.lastSentAt >= SEND_INTERVAL_MS) {
      this.sendActive(local);
    }
    ```

  - `end()`: call `local.cancelTick()` straight after the `undefined` check.
  - `setMap()` and `dispose()`: call `this._local?.cancelTick()` before clearing `this._local`.
  - New private methods:

    ```typescript
    private scheduleTick(local: LocalStroke) {
      local.cancelTick = this._schedule(() => this.tick(local), SEND_INTERVAL_MS);
    }

    // Runs every SEND_INTERVAL_MS while a stroke is held: flushes points the
    // send throttle held back, and resends a still stroke as a keepalive.
    private tick(local: LocalStroke) {
      // A tick that outlived its stroke (released, or the map changed) does nothing.
      if (this._local !== local) {
        return;
      }
      const elapsed = this._now() - local.lastSentAt;
      const unsent = local.sentCount < local.points.length;
      if ((unsent && elapsed >= SEND_INTERVAL_MS) || elapsed >= KEEPALIVE_MS) {
        this.sendActive(local);
      }
      this.scheduleTick(local);
    }

    private sendActive(local: LocalStroke) {
      this.send(local.itemId, local.points, 'active');
      local.lastSentAt = this._now();
      local.sentCount = local.points.length;
    }
    ```

- [ ] **Step 5:** Run the controller tests. Expected: all pass, old and new.
- [ ] **Step 6:** Commit: `Keep held scribbles alive and flush throttled points`.

---

## Task 4: Controller — emit markers (TDD)

**Files:** Modify `was-web/src/models/scribbleController.ts` and `was-web/unit/models/scribbleController.test.ts`

- [ ] **Step 1:** In the tests, add `let markers: ScribbleMarker[];` (reset to `[]` in `beforeEach`), pass `setMarkers: m => { markers = m; }` in `makeController`, and add a remote-item helper:

```typescript
function remote(
  authorId: string, itemId: string, phase: 'active' | 'released', points: { x: number; y: number }[]
): OverlayItem {
  return {
    authorId, itemId, phase, updatedAt: 1, payload: { kind: 'scribble', points },
    ...(phase === 'released' ? { releasedAt: 2 } : {}),
  };
}
```

- [ ] **Step 2:** Add the failing tests:

```typescript
  test('a remote active stroke is marked at its last point', () => {
    const c = makeController();
    c.setMap('adv', 'map-1');
    live.subs[0].onNext([
      remote('alice', 'x', 'active', [{ x: 0, y: 0 }, { x: 5, y: 6 }]),
      remote('bob', 'y', 'released', [{ x: 1, y: 1 }, { x: 2, y: 2 }]),
    ]);
    expect(markers).toEqual([{ key: 'alice/x', point: { x: 5, y: 6 }, style: styleOf('alice') }]);
  });

  test('a one-point remote stroke is marked, though it draws no line', () => {
    const c = makeController();
    c.setMap('adv', 'map-1');
    live.subs[0].onNext([remote('alice', 'x', 'active', [{ x: 3, y: 4 }])]);
    expect(markers.map(m => m.point)).toEqual([{ x: 3, y: 4 }]);
    expect(rendered[rendered.length - 1]).toHaveLength(0);
  });

  test('the local stroke is never marked', () => {
    const c = makeController();
    c.setMap('adv', 'map-1');
    c.start({ x: 0, y: 0 });
    c.move({ x: 50, y: 0 });
    expect(markers).toEqual([]);
  });

  test('switching maps clears the markers', () => {
    const c = makeController();
    c.setMap('adv', 'map-1');
    live.subs[0].onNext([remote('alice', 'x', 'active', [{ x: 0, y: 0 }])]);
    c.setMap('adv', 'map-2');
    expect(markers).toEqual([]);
  });
```

- [ ] **Step 3:** Run them. Expected: they fail. (TypeScript in Vitest won't complain about the unknown `setMarkers` param until Step 4 adds it.)

- [ ] **Step 4:** Implement:
  - Import `ScribbleMarker` from `./scribbleTypes`.
  - Add the param, with the field assigned in the constructor:

    ```typescript
    // Pushes the remote scribblers' current hot points to the renderer.
    setMarkers: (markers: ScribbleMarker[]) => void;
    ```

  - In `pushRender()`'s remote loop, after `add(...)`:

    ```typescript
    if (it.phase === 'active' && it.payload.points.length > 0) {
      markers.push({
        key: `${it.authorId}/${it.itemId}`,
        point: it.payload.points[it.payload.points.length - 1],
        style: styleFor(it.authorId),
      });
    }
    ```

    Declare `const markers: ScribbleMarker[] = [];` beside `strokes`, and call `this._setMarkers(markers);` after `this._setScribbles(strokes);`.

- [ ] **Step 5:** Run the controller tests. Expected: all pass. `npx tsc --noEmit -p .` now fails at `mapStateMachine.ts` (missing `setMarkers`); Task 6 fixes it. Commit anyway, or hold the commit until Task 6 if you want every commit to compile.
- [ ] **Step 6:** Commit: `Emit hot-point markers for remote active scribbles`.

---

## Task 5: `ScribbleMarkerDrawing` (TDD)

**Files:** Create `was-web/src/models/three/scribbleMarkerDrawing.ts`, `was-web/unit/models/three/scribbleMarkerDrawing.ts`, `was-web/unit/models/three/scribbleMarkerDrawing.test.ts`

- [ ] **Step 1:** Shim:

```typescript
export * from '../../../src/models/three/scribbleMarkerDrawing';
```

- [ ] **Step 2:** Failing tests:

```typescript
import { describe, test, expect } from 'vitest';
import * as THREE from 'three';
import { ScribbleMarkerDrawing } from './scribbleMarkerDrawing';
import { ScribbleMarker, ScribbleStyle, SCRIBBLE_MARKER_FADE_MS, SCRIBBLE_MARKER_MAX } from '../scribbleTypes';

const style: ScribbleStyle = { fill: { r: 1, g: 0.5, b: 0 }, outline: { r: 0, g: 0, b: 0.25 }, widthScale: 1.5 };

function marker(key: string, x: number, y: number): ScribbleMarker {
  return { key, point: { x, y }, style };
}

// World units are pixels, centred on the origin, on an 800x600 screen.
function makeCamera() {
  const camera = new THREE.OrthographicCamera(-400, 400, 300, -300, -1, 1);
  camera.updateMatrixWorld();
  return camera;
}

function attr(d: ScribbleMarkerDrawing, name: string) {
  return d.geometry.getAttribute(name).array as Float32Array;
}

describe('ScribbleMarkerDrawing', () => {
  test('lays out an on-screen ring and an off-screen arrow', () => {
    const d = new ScribbleMarkerDrawing();
    d.setViewport(800, 600);
    d.setMarkers([marker('a/1', 100, 50), marker('b/1', 1000, 0)], 0);
    d.update(0, makeCamera());

    expect(d.geometry.instanceCount).toBe(2);
    expect(Array.from(attr(d, 'aMode'))).toEqual(expect.arrayContaining([0, 1]));
    expect(attr(d, 'aMode')[0]).toBe(0);
    expect(attr(d, 'aAnchor')[0]).toBeCloseTo(100);
    expect(attr(d, 'aAnchor')[1]).toBeCloseTo(50);
    expect(attr(d, 'aMode')[1]).toBe(1);
    expect(attr(d, 'aAnchor')[2]).toBeCloseTo(400);
    expect(attr(d, 'aAnchor')[3]).toBeCloseTo(0);
    expect(attr(d, 'aDir')[2]).toBeCloseTo(1);
    expect(attr(d, 'aDir')[3]).toBeCloseTo(0);
    expect(attr(d, 'aScale')[0]).toBe(1.5);
    expect(Array.from(attr(d, 'aFill').slice(0, 3))).toEqual([1, 0.5, 0]);
    expect(Array.from(attr(d, 'aOutline').slice(0, 3))).toEqual([0, 0, 0.25]);
    d.dispose();
  });

  test('caps the instance count', () => {
    const d = new ScribbleMarkerDrawing();
    d.setViewport(800, 600);
    d.setMarkers(Array.from({ length: SCRIBBLE_MARKER_MAX + 6 }, (_, i) => marker(`a/${i}`, 0, 0)), 0);
    d.update(0, makeCamera());
    expect(d.geometry.instanceCount).toBe(SCRIBBLE_MARKER_MAX);
    d.dispose();
  });

  test('has content until a removed marker has faded', () => {
    const d = new ScribbleMarkerDrawing();
    d.setViewport(800, 600);
    d.setMarkers([marker('a/1', 0, 0)], 0);
    d.setMarkers([], 100);
    d.update(100 + SCRIBBLE_MARKER_FADE_MS / 2, makeCamera());
    expect(d.hasContent).toBe(true);
    expect(attr(d, 'aAlpha')[0]).toBeCloseTo(0.5);
    d.update(100 + SCRIBBLE_MARKER_FADE_MS, makeCamera());
    expect(d.hasContent).toBe(false);
    expect(d.geometry.instanceCount).toBe(0);
    d.dispose();
  });
});
```

- [ ] **Step 3:** Run it. Expected: fails, because the module is missing.

- [ ] **Step 4:** Implement `src/models/three/scribbleMarkerDrawing.ts`:

```typescript
import * as THREE from 'three';
import { placeMarker, ScribbleMarkerTracker } from '../scribbleMarkers';
import {
  ScribbleMarker,
  SCRIBBLE_FILL_HALF_WIDTH_PX,
  SCRIBBLE_OUTLINE_HALF_WIDTH_PX,
  SCRIBBLE_MARKER_ARROW_HALF_WIDTH_PX,
  SCRIBBLE_MARKER_ARROW_LENGTH_PX,
  SCRIBBLE_MARKER_MAX,
  SCRIBBLE_MARKER_PULSE_DIM,
  SCRIBBLE_MARKER_PULSE_GROW,
  SCRIBBLE_MARKER_PULSE_MS,
  SCRIBBLE_MARKER_RING_RADIUS_PX,
} from '../scribbleTypes';

const MODE_RING = 0;
const MODE_ARROW = 1;

const markerVertexShader = `
  attribute vec2 aAnchor;    // CSS px from the screen centre, y up: ring centre or arrow tip
  attribute vec2 aDir;       // arrow direction (unit); unused for rings
  attribute float aMode;     // 0 ring, 1 arrow
  attribute vec3 aFill;
  attribute vec3 aOutline;
  attribute float aScale;    // the author's widthScale
  attribute float aAlpha;

  uniform vec2 uViewport;    // CSS pixels
  uniform float uPulse;      // 0..1, shared by every marker
  uniform float uGrow;
  uniform float uDim;
  uniform float uRingRadius;
  uniform float uArrowLength;
  uniform float uArrowHalfWidth;
  uniform float uFillHalf;
  uniform float uOutlineHalf;

  varying vec2 vLocal;       // px in the shape's own frame
  varying vec3 vShape;       // ring: (radius, fill half, outline half); arrow: (length, half-width, border)
  varying float vMode;
  varying vec3 vFill;
  varying vec3 vOutline;
  varying float vAlpha;

  void main() {
    float grow = 1.0 + uGrow * uPulse;
    vec2 px;
    if (aMode < 0.5) {
      float r = uRingRadius * grow;
      float extent = r + uOutlineHalf * aScale + 1.0;
      vLocal = position.xy * extent;
      px = aAnchor + vLocal;
      vShape = vec3(r, uFillHalf * aScale, uOutlineHalf * aScale);
    } else {
      // Tip at the origin pointing along +x, so growing about it keeps the tip on the edge.
      float len = uArrowLength * aScale * grow;
      float hw = uArrowHalfWidth * aScale * grow;
      vLocal = vec2(mix(-len - 1.0, 1.0, position.x * 0.5 + 0.5), position.y * (hw + 1.0));
      vec2 perp = vec2(-aDir.y, aDir.x);
      px = aAnchor + aDir * vLocal.x + perp * vLocal.y;
      vShape = vec3(len, hw, (uOutlineHalf - uFillHalf) * aScale);
    }
    gl_Position = vec4(px / (0.5 * uViewport), 0.0, 1.0);
    vMode = aMode;
    vFill = aFill;
    vOutline = aOutline;
    vAlpha = aAlpha * (1.0 - uDim * uPulse);
  }
`;

const markerFragmentShader = `
  precision mediump float;
  varying vec2 vLocal;
  varying vec3 vShape;
  varying float vMode;
  varying vec3 vFill;
  varying vec3 vOutline;
  varying float vAlpha;

  void main() {
    vec3 colour;
    if (vMode < 0.5) {
      // A hollow ring with the same fill-over-outline band as a stroke.
      float d = abs(length(vLocal) - vShape.x);
      if (d > vShape.z) discard;
      colour = d <= vShape.y ? vFill : vOutline;
    } else {
      // Triangle with its tip at the origin and its base at x = -length.
      // The maximum of the edge half-plane distances is exact inside a convex shape.
      vec2 n = normalize(vec2(vShape.y, vShape.x));
      float s = max(-vShape.x - vLocal.x, max(dot(vLocal, n), dot(vLocal, vec2(n.x, -n.y))));
      if (s > 0.0) discard;
      // The outline border sits inside the triangle, so the tip is not clipped at the edge.
      colour = s > -vShape.z ? vOutline : vFill;
    }
    gl_FragColor = vec4(colour, vAlpha);
  }
`;

// Draws the remote scribblers' hot-point markers: a pulsing ring over each one
// on screen, or a pulsing arrow at the screen edge pointing at it. Markers are
// projected and laid out on the CPU each frame (there are only a handful); the
// shader only draws the shape at the screen position it is given.
export class ScribbleMarkerDrawing {
  private readonly _tracker = new ScribbleMarkerTracker();
  private readonly _viewport = new THREE.Vector2(1, 1);
  private readonly _scratch = new THREE.Vector3();

  private readonly _aAnchor = new Float32Array(SCRIBBLE_MARKER_MAX * 2);
  private readonly _aDir = new Float32Array(SCRIBBLE_MARKER_MAX * 2);
  private readonly _aMode = new Float32Array(SCRIBBLE_MARKER_MAX);
  private readonly _aFill = new Float32Array(SCRIBBLE_MARKER_MAX * 3);
  private readonly _aOutline = new Float32Array(SCRIBBLE_MARKER_MAX * 3);
  private readonly _aScale = new Float32Array(SCRIBBLE_MARKER_MAX);
  private readonly _aAlpha = new Float32Array(SCRIBBLE_MARKER_MAX);
  private readonly _attributes: THREE.InstancedBufferAttribute[];

  private readonly _geometry: THREE.InstancedBufferGeometry;
  private readonly _material: THREE.ShaderMaterial;
  private readonly _scene: THREE.Scene;

  get geometry() { return this._geometry; }
  get hasContent() { return this._tracker.hasContent; }

  constructor() {
    this._geometry = new THREE.InstancedBufferGeometry();
    this._geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      -1, -1, 0,
       1, -1, 0,
       1,  1, 0,
      -1,  1, 0,
    ]), 3));
    this._geometry.setIndex([0, 1, 2, 0, 2, 3]);

    const named: [string, Float32Array, number][] = [
      ['aAnchor', this._aAnchor, 2],
      ['aDir', this._aDir, 2],
      ['aMode', this._aMode, 1],
      ['aFill', this._aFill, 3],
      ['aOutline', this._aOutline, 3],
      ['aScale', this._aScale, 1],
      ['aAlpha', this._aAlpha, 1],
    ];
    this._attributes = named.map(([name, array, size]) => {
      const a = new THREE.InstancedBufferAttribute(array, size);
      a.setUsage(THREE.DynamicDrawUsage);
      this._geometry.setAttribute(name, a);
      return a;
    });
    this._geometry.instanceCount = 0;

    this._material = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
      vertexShader: markerVertexShader,
      fragmentShader: markerFragmentShader,
      uniforms: {
        uViewport: { value: this._viewport },
        uPulse: { value: 0 },
        uGrow: { value: SCRIBBLE_MARKER_PULSE_GROW },
        uDim: { value: SCRIBBLE_MARKER_PULSE_DIM },
        uRingRadius: { value: SCRIBBLE_MARKER_RING_RADIUS_PX },
        uArrowLength: { value: SCRIBBLE_MARKER_ARROW_LENGTH_PX },
        uArrowHalfWidth: { value: SCRIBBLE_MARKER_ARROW_HALF_WIDTH_PX },
        uFillHalf: { value: SCRIBBLE_FILL_HALF_WIDTH_PX },
        uOutlineHalf: { value: SCRIBBLE_OUTLINE_HALF_WIDTH_PX },
      },
    });

    const mesh = new THREE.Mesh(this._geometry, this._material);
    mesh.frustumCulled = false;
    this._scene = new THREE.Scene();
    this._scene.add(mesh);
  }

  setMarkers(markers: ScribbleMarker[], now: number) {
    this._tracker.setMarkers(markers, now);
  }

  setViewport(width: number, height: number) {
    this._viewport.set(Math.max(1, width), Math.max(1, height));
  }

  // Advances the markers to `now` and lays them out against the camera's
  // current view of the map.
  update(now: number, camera: THREE.Camera) {
    const frames = this._tracker.update(now);
    const halfW = this._viewport.x / 2;
    const halfH = this._viewport.y / 2;
    const count = Math.min(frames.length, SCRIBBLE_MARKER_MAX);
    for (let i = 0; i < count; ++i) {
      const { point, style, alpha } = frames[i];
      const ndc = this._scratch.set(point.x, point.y, 0).project(camera);
      const placement = placeMarker({ x: ndc.x * halfW, y: ndc.y * halfH }, halfW, halfH);
      const anchor = placement.kind === 'ring' ? placement.centre : placement.tip;
      const dir = placement.kind === 'ring' ? { x: 1, y: 0 } : placement.dir;
      this._aAnchor[i * 2] = anchor.x;
      this._aAnchor[i * 2 + 1] = anchor.y;
      this._aDir[i * 2] = dir.x;
      this._aDir[i * 2 + 1] = dir.y;
      this._aMode[i] = placement.kind === 'ring' ? MODE_RING : MODE_ARROW;
      this._aFill.set([style.fill.r, style.fill.g, style.fill.b], i * 3);
      this._aOutline.set([style.outline.r, style.outline.g, style.outline.b], i * 3);
      this._aScale[i] = style.widthScale;
      this._aAlpha[i] = alpha;
    }
    if (count > 0) {
      for (const a of this._attributes) {
        a.needsUpdate = true;
      }
    }
    this._geometry.instanceCount = count;
    this._material.uniforms.uPulse.value = 0.5 - 0.5 * Math.cos(2 * Math.PI * now / SCRIBBLE_MARKER_PULSE_MS);
  }

  // The shader maps pixels straight to clip space, so the camera is unused;
  // the renderer just needs one.
  render(renderer: THREE.WebGLRenderer, camera: THREE.Camera) {
    if (this._geometry.instanceCount > 0) {
      renderer.render(this._scene, camera);
    }
  }

  dispose() {
    this._geometry.dispose();
    this._material.dispose();
  }
}
```

- [ ] **Step 5:** Run the tests. Expected: they pass. If `project()` gives NDC y with the wrong sign for this camera, check the camera, not the code: `DrawingOrtho`'s camera is set up the same way the stroke shader consumes it, so anything that works for strokes works here.
- [ ] **Step 6:** Commit: `Add the scribble hot-point marker drawing`.

---

## Task 6: Wire it in

**Files:** Modify `src/models/interfaces.ts`, `src/models/three/drawingOrtho.ts`, `src/models/mapStateMachine.ts`

- [ ] **Step 1:** `IDrawing`, after `setScribbles`:

```typescript
  // Replaces the set of remote scribblers' hot points to mark (world
  // coordinates). Pass an empty array to clear; markers fade out briefly.
  setScribbleMarkers(markers: ScribbleMarker[]): void;
```

(Import `ScribbleMarker` alongside `ScribbleStroke`.)

- [ ] **Step 2:** `DrawingOrtho`:
  - Field `private readonly _scribbleMarkers: ScribbleMarkerDrawing;`. Construct it right after `_scribbles`, then call `setViewport(renderWidth, renderHeight)`.
  - In `animate()`, beside `scribblesActive`: `const markersActive = this._scribbleMarkers.hasContent;`. Add `|| markersActive` to the redraw condition.
  - Inside that `if`, before the debug-mode check, so markers keep fading in debug mode too:

    ```typescript
    const now = Date.now();
    this._scribbleMarkers.update(now, this._camera);
    ```

    Then, in the normal branch, replace the scribble render lines with:

    ```typescript
    this._scribbles.updateNow(now);
    this._scribbles.render(this._renderer, this._camera);
    this._scribbleMarkers.render(this._renderer, this._camera);
    ```

  - The keep-alive at the end becomes `if (scribblesActive || markersActive)`. Extend its comment: markers keep the loop running until their release fade has finished.
  - `resize()`: `this._scribbleMarkers.setViewport(width, height);`
  - New method beside `setScribbles`:

    ```typescript
    setScribbleMarkers(markers: ScribbleMarker[]) {
      this._scribbleMarkers.setMarkers(markers, Date.now());
      this._needsRedraw.setNeedsRedraw();
    }
    ```

  - `dispose()`: `this._scribbleMarkers.dispose();` next to `this._scribbles.dispose();`.

- [ ] **Step 3:** `MapStateMachine`, in the `ScribbleController` params: `setMarkers: markers => this._drawing.setScribbleMarkers(markers),`.

- [ ] **Step 4:** `cd was-web && npx tsc --noEmit -p . && npm run lint && npm test`. Expected: all green.
- [ ] **Step 5:** Commit: `Draw scribble hot-point markers on the map`.

---

## Task 7: Docs

**Files:** Modify `docs/architecture/ephemeral-state.md`

- [ ] **Step 1:** **Status** paragraph: scribbles now also show each remote scribbler's hot point, as a ring on screen or an edge arrow off screen.
- [ ] **Step 2:** **Lifecycle** section, after the `active` staleness bullet, add: a live scribbler's client resends its stroke at least every 2 s while the button is held, so holding still never trips the staleness guard. The guard only catches clients that have actually gone.
- [ ] **Step 3:** **Where the code lives**, scribble bullet: add `scribbleMarkers.ts` (marker smoothing, fade and edge placement) and `three/scribbleMarkerDrawing.ts` (ring/arrow renderer).
- [ ] **Step 4:** Commit: `Document scribble hot-point markers`.

---

## Task 8: Check it by hand

Start the dev servers (`cd was-web/server && npm run dev`; `cd was-web && npm run dev:vite`). Open the same map as two different users, in two browser windows or one normal and one private. In window A, scribble while watching window B.

- [ ] Ring appears about 80 ms after A presses the button, before A moves, at A's pen position on B's screen.
- [ ] The ring follows A's strokes smoothly, not in 80 ms jumps. It is hollow, so the line shows through it, and it uses A's fill and outline colours.
- [ ] Pan B so A's hot point is off each edge in turn, then off each corner. An arrow sits with its tip on the edge and points at the hot point; it swaps back to a ring as soon as the hot point comes on screen.
- [ ] Ring and arrow pulse; the arrow's tip stays on the edge while it pulses.
- [ ] Releasing fades the marker out quickly (about a quarter of a second) while the stroke keeps its normal 10 s fade.
- [ ] As the GM, the marker is visibly bigger and uses the near-white outline.
- [ ] Holding the button still for more than 5 s: the stroke **stays** on B's screen (it used to vanish).
- [ ] A sees no marker for their own stroke.
- [ ] Two scribblers off the same edge: arrows overlap, newest on top.
- [ ] Browser console is clean in both windows.

Then `npm run build && npm run test:smoke`.

---

## Done when

- All unit tests, lint and type-checks pass; the smoke test passes on a fresh build.
- The manual checklist above is ticked.
- `ephemeral-state.md` reflects the change.
