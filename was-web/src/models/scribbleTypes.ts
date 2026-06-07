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
