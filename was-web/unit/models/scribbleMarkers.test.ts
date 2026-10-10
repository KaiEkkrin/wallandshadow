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
      if (m.kind !== 'arrow') {
        throw new Error('expected an arrow');
      }
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
