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
    // The ring sits on the hot point.
    expect(attr(d, 'aMode')[0]).toBe(0);
    expect(attr(d, 'aAnchor')[0]).toBeCloseTo(100);
    expect(attr(d, 'aAnchor')[1]).toBeCloseTo(50);
    // The arrow's tip is on the right edge, pointing right.
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
