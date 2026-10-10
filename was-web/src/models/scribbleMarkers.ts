import {
  ScribbleMarker,
  ScribbleStyle,
  SCRIBBLE_MARKER_FADE_MS,
  SCRIBBLE_MARKER_SMOOTH_MS,
} from './scribbleTypes';

interface Point2 { x: number; y: number; }

// The visible part of the screen, in CSS pixels from the screen centre, y up.
// Not necessarily symmetric (the navbar covers the top); must contain the centre.
export interface ScreenBounds {
  left: number;
  right: number;
  bottom: number;
  top: number;
}

export type MarkerPlacement =
  | { kind: 'ring'; centre: Point2 }
  | { kind: 'arrow'; tip: Point2; dir: Point2 };

// Decides how to show a hot point at `px` (CSS pixels from the screen centre).
// Within the bounds: a ring centred on it. Outside: an arrow whose tip is where
// the line from the screen centre to the hot point leaves the bounds, pointing
// along that line.
export function placeMarker(px: Point2, bounds: ScreenBounds): MarkerPlacement {
  if (px.x >= bounds.left && px.x <= bounds.right && px.y >= bounds.bottom && px.y <= bounds.top) {
    return { kind: 'ring', centre: { x: px.x, y: px.y } };
  }
  const tx = px.x > 0 ? bounds.right / px.x : px.x < 0 ? bounds.left / px.x : Infinity;
  const ty = px.y > 0 ? bounds.top / px.y : px.y < 0 ? bounds.bottom / px.y : Infinity;
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
