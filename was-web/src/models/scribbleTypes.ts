// Shared, THREE-free types and tuning constants for the scribble overlay.
// Kept free of Three.js so the capture controller (and its tests) need not
// pull in the renderer.

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
  // Epoch ms when the stroke was released, or SCRIBBLE_ACTIVE while still
  // being drawn (renders at full alpha, no fade yet).
  releaseTime: number;
}

// Sentinel meaning "this stroke has not been released yet".
export const SCRIBBLE_ACTIVE = Number.POSITIVE_INFINITY;

// Fade timing. A released stroke holds full alpha for HOLD ms, then fades
// linearly to 0 over FADE ms. HOLD + FADE must match the server's ~10s
// scribble expiry so client fade and server removal converge.
export const SCRIBBLE_FADE_HOLD_MS = 3000;
export const SCRIBBLE_FADE_MS = 7000;
export const SCRIBBLE_FADE_TOTAL_MS = SCRIBBLE_FADE_HOLD_MS + SCRIBBLE_FADE_MS;

// Constant on-screen half-widths of a stroke, in CSS pixels: a 3px fill
// over a 6px outline. The GM's strokes are scaled up to stand out.
export const SCRIBBLE_FILL_HALF_WIDTH_PX = 1.5;
export const SCRIBBLE_OUTLINE_HALF_WIDTH_PX = 3.0;
export const SCRIBBLE_GM_WIDTH_SCALE = 1.5;

// Hard ceiling on rendered polyline segments across all strokes/authors
// combined. Each segment is drawn twice (fill and outline).
export const SCRIBBLE_MAX_SEGMENTS = 20000;
