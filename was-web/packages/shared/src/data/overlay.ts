import type { GridCoord } from './coord';

// Continuous, un-snapped coordinate for free-hand scribbles, in map/world space.
// Scribbles are NOT snapped to the grid (unlike rulers, which use GridCoord).
export interface PixelCoord {
  x: number;
  y: number;
}

export type OverlayKind = 'scribble' | 'ruler';
export type OverlayPhase = 'active' | 'released';

export interface ScribblePayload {
  kind: 'scribble';
  points: PixelCoord[];
}

export interface RulerPayload {
  kind: 'ruler';
  nodes: GridCoord[]; // committed turning points
  live?: GridCoord;   // cursor position during an active drag (absent once released)
}

// Discriminated by `kind`. The backplane never inspects this; only the boundary
// validator and the UI sessions interpret it.
export type OverlayPayload = ScribblePayload | RulerPayload;

// Sent by the client. The server stamps authorId + timestamps; they are never
// trusted from the wire (the validator strips any extra fields).
export interface OutgoingOverlayItem {
  itemId: string;        // client-generated (uuid); unique per item within an author
  payload: OverlayPayload;
  phase: OverlayPhase;
}

// Held in the server registry and broadcast to peers on the `liveOverlay` scope.
export interface OverlayItem extends OutgoingOverlayItem {
  authorId: string;      // filled from the authenticated socket
  updatedAt: number;     // server ms timestamp
  releasedAt?: number;   // set when phase flips to 'released'; clients fade from here
}

// Broadcast when an item expires, so peers converge deterministically.
export interface OverlayRemoval {
  removed: { authorId: string; itemId: string };
}

// Caps enforced at the server boundary; shared so the validator (and any future
// client-side guard) agree on the same limits.
export const MAX_SCRIBBLE_POINTS = 2000;
export const MAX_RULER_NODES = 64;
export const MAX_ITEM_ID_LENGTH = 64;

// ── Boundary validation ─────────────────────────────────────────────────────
// Re-constructs a clean object from untrusted input: strips unknown fields,
// rejects malformed shapes, and enforces the caps above. Returns null on any
// problem (callers drop the frame). Never throws.

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function asCoord(v: unknown): { x: number; y: number } | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (!isFiniteNumber(o.x) || !isFiniteNumber(o.y)) return null;
  return { x: o.x, y: o.y };
}

function asCoordArray(v: unknown, max: number): { x: number; y: number }[] | null {
  if (!Array.isArray(v)) return null;
  if (v.length === 0 || v.length > max) return null;
  const out: { x: number; y: number }[] = [];
  for (const item of v) {
    const c = asCoord(item);
    if (!c) return null;
    out.push(c);
  }
  return out;
}

function validatePayload(v: unknown): OverlayPayload | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (o.kind === 'scribble') {
    const points = asCoordArray(o.points, MAX_SCRIBBLE_POINTS);
    if (!points) return null;
    return { kind: 'scribble', points };
  }
  if (o.kind === 'ruler') {
    const nodes = asCoordArray(o.nodes, MAX_RULER_NODES);
    if (!nodes) return null;
    if (o.live === undefined) return { kind: 'ruler', nodes };
    const live = asCoord(o.live);
    if (!live) return null;
    return { kind: 'ruler', nodes, live };
  }
  return null;
}

export function validateOutgoingOverlayItem(v: unknown): OutgoingOverlayItem | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.itemId !== 'string' || o.itemId.length === 0 || o.itemId.length > MAX_ITEM_ID_LENGTH) {
    return null;
  }
  if (o.phase !== 'active' && o.phase !== 'released') return null;
  const payload = validatePayload(o.payload);
  if (!payload) return null;
  return { itemId: o.itemId, phase: o.phase, payload };
}
