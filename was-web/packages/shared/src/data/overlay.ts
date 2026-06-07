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
