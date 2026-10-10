import { describe, test, expect } from 'vitest';
import { ScribbleDrawing } from './scribbleDrawing';
import {
  SCRIBBLE_ACTIVE,
  SCRIBBLE_FILL_HALF_WIDTH_PX,
  SCRIBBLE_OUTLINE_HALF_WIDTH_PX,
  ScribbleStroke,
  ScribbleStyle,
} from '../scribbleTypes';

const style: ScribbleStyle = {
  fill: { r: 1, g: 0.5, b: 0 },
  outline: { r: 0, g: 0, b: 0.25 },
  widthScale: 1,
};

// A horizontal stroke through x = xs[0], xs[1], ...
function stroke(xs: number[], releaseTime: number, s: ScribbleStyle = style): ScribbleStroke {
  return { points: xs.map(x => ({ x, y: 0 })), style: s, releaseTime };
}

function attr(d: ScribbleDrawing, name: string) {
  return d.geometry.getAttribute(name).array as Float32Array;
}

describe('ScribbleDrawing', () => {
  test('starts empty', () => {
    const d = new ScribbleDrawing(100);
    expect(d.hasContent).toBe(false);
    expect(d.segmentCount).toBe(0);
    d.dispose();
  });

  test('each segment is drawn as a fill instance and an outline instance', () => {
    const d = new ScribbleDrawing(100);
    d.setStrokes([stroke([0, 1, 2], SCRIBBLE_ACTIVE)]);
    expect(d.segmentCount).toBe(2);
    expect(d.hasContent).toBe(true);
    expect(d.geometry.instanceCount).toBe(4);

    // Fill instances first, then outline instances, each walking the polyline.
    expect(Array.from(attr(d, 'aStart').filter((_, i) => i % 2 === 0).slice(0, 4))).toEqual([0, 1, 0, 1]);
    const colour = attr(d, 'aColour');
    expect(Array.from(colour.slice(0, 3))).toEqual([1, 0.5, 0]);
    expect(Array.from(colour.slice(6, 9))).toEqual([0, 0, 0.25]);
    const halfWidth = attr(d, 'aHalfWidth');
    expect(Array.from(halfWidth.slice(0, 4))).toEqual([
      SCRIBBLE_FILL_HALF_WIDTH_PX, SCRIBBLE_FILL_HALF_WIDTH_PX,
      SCRIBBLE_OUTLINE_HALF_WIDTH_PX, SCRIBBLE_OUTLINE_HALF_WIDTH_PX,
    ]);
    d.dispose();
  });

  test('widthScale scales both passes', () => {
    const d = new ScribbleDrawing(100);
    d.setStrokes([stroke([0, 1], 1000, { ...style, widthScale: 1.5 })]);
    const halfWidth = attr(d, 'aHalfWidth');
    expect(halfWidth[0]).toBeCloseTo(SCRIBBLE_FILL_HALF_WIDTH_PX * 1.5);
    expect(halfWidth[1]).toBeCloseTo(SCRIBBLE_OUTLINE_HALF_WIDTH_PX * 1.5);
    d.dispose();
  });

  test('strokes are drawn in order, each at its own depth, newer nearer', () => {
    const d = new ScribbleDrawing(100);
    d.setStrokes([stroke([0, 1], 1000), stroke([10, 11], 2000), stroke([20, 21], 3000)]);
    // Stroke-major: both passes of stroke 0, then stroke 1, then stroke 2.
    expect(Array.from(attr(d, 'aStart').filter((_, i) => i % 2 === 0).slice(0, 6))).toEqual([0, 0, 10, 10, 20, 20]);
    const depth = attr(d, 'aDepth');
    for (let k = 0; k < 3; ++k) {
      expect(depth[2 * k]).toBe(depth[2 * k + 1]);
      expect(depth[2 * k]).toBeGreaterThan(-1);
      expect(depth[2 * k]).toBeLessThan(1);
    }
    expect(depth[2]).toBeLessThan(depth[0]);
    expect(depth[4]).toBeLessThan(depth[2]);
    d.dispose();
  });

  test('strokes with fewer than two points draw nothing', () => {
    const d = new ScribbleDrawing(100);
    d.setStrokes([stroke([5], 1000)]);
    expect(d.hasContent).toBe(false);
    expect(d.geometry.instanceCount).toBe(0);
    d.dispose();
  });

  test('setStrokes([]) clears content', () => {
    const d = new ScribbleDrawing(100);
    d.setStrokes([stroke([0, 1], 1000)]);
    d.setStrokes([]);
    expect(d.hasContent).toBe(false);
    expect(d.segmentCount).toBe(0);
    expect(d.geometry.instanceCount).toBe(0);
    d.dispose();
  });

  test('clamps to the max segment budget, keeping fill and outline paired', () => {
    const d = new ScribbleDrawing(2);
    d.setStrokes([stroke([0, 1, 2, 3], 1000), stroke([10, 11], 1000)]);
    expect(d.segmentCount).toBe(2);
    expect(d.geometry.instanceCount).toBe(4);
    expect(Array.from(attr(d, 'aStart').filter((_, i) => i % 2 === 0).slice(0, 4))).toEqual([0, 1, 0, 1]);
    d.dispose();
  });

  test('active strokes map to a finite (non-Infinity) release time', () => {
    const d = new ScribbleDrawing(100);
    d.setStrokes([stroke([0, 1], SCRIBBLE_ACTIVE)]);
    const rel = attr(d, 'aReleaseTime')[0];
    expect(Number.isFinite(rel)).toBe(true);
    d.dispose();
  });
});
