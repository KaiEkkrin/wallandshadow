import { GridCoord, coordsEqual } from './coord';

// Represents a token's position and size for Line of Sight rendering.
// Extends GridCoord so it can be used wherever grid coordinates are expected.
// The radius is the token's effective size in world units (for shadow calculations).
export type LoSPosition = GridCoord & { radius: number; };

// Helper to compare two LoSPosition arrays for equality
export function losPositionsEqual(a: LoSPosition[], b: LoSPosition[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!coordsEqual(a[i], b[i]) || a[i].radius !== b[i].radius) {
      return false;
    }
  }
  return true;
}
