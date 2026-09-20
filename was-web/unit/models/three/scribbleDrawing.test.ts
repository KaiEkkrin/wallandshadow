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
