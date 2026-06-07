import { ILiveData, OverlayItem, PixelCoord, MAX_SCRIBBLE_POINTS } from '@wallandshadow/shared';
import {
  ScribbleSegment,
  SCRIBBLE_ACTIVE,
  SCRIBBLE_FADE_TOTAL_MS,
} from './scribbleTypes';

// Minimum movement (in viewport pixels) between sampled points, to bound the
// number of points/segments and avoid flooding the wire.
const SAMPLE_PX = 3;
// Minimum gap between fire-and-forget "active" frames while drawing.
const SEND_INTERVAL_MS = 80;

const WHITE = { r: 1, g: 1, b: 1 } as const;

interface Point2 { x: number; y: number; }

export interface ScribbleControllerParams {
  live: ILiveData;
  // Converts a viewport point (x,y) into world coordinates.
  toWorld: (cp: Point2) => Point2;
  // Pushes the current full segment set to the renderer.
  setScribbles: (segments: ScribbleSegment[]) => void;
  // Clock, injectable for tests.
  now: () => number;
  // Item id factory, injectable for tests.
  newId?: () => string;
  // Timer factory returning a cancel function, injectable for tests.
  schedule?: (fn: () => void, ms: number) => () => void;
}

interface LocalStroke {
  itemId: string;
  points: PixelCoord[];
  lastSampled: Point2;     // viewport coords of the last accepted sample
  lastSentAt: number;
}

interface ReleasedStroke {
  itemId: string;
  points: PixelCoord[];
  releasedAt: number;
  cancel: () => void;
}

// Owns ephemeral scribble capture for one map at a time: turns pointer drags
// into world-space strokes, sends them fire-and-forget, subscribes to peers,
// and merges remote + local strokes into renderable segments. It deliberately
// never touches the persistent map-change tracker.
export class ScribbleController {
  private readonly _live: ILiveData;
  private readonly _toWorld: (cp: Point2) => Point2;
  private readonly _setScribbles: (segments: ScribbleSegment[]) => void;
  private readonly _now: () => number;
  private readonly _newId: () => string;
  private readonly _schedule: (fn: () => void, ms: number) => () => void;

  private _mapId: string | undefined;
  private _unsub: (() => void) | undefined;

  // Authoritative scribble set owned by the live-data reconciler; this field
  // is replaced wholesale on each update, never mutated in place.
  private _remote: OverlayItem[] = [];
  private _local: LocalStroke | undefined;
  private _localReleased: ReleasedStroke[] = [];

  constructor(params: ScribbleControllerParams) {
    this._live = params.live;
    this._toWorld = params.toWorld;
    this._setScribbles = params.setScribbles;
    this._now = params.now;
    this._newId = params.newId ?? (() => crypto.randomUUID());
    this._schedule = params.schedule ?? ((fn, ms) => {
      const h = setTimeout(fn, ms);
      return () => clearTimeout(h);
    });
  }

  // Switches the active map: tears down old subscription/state and subscribes anew.
  setMap(_adventureId: string, mapId: string) {
    this._unsub?.();
    this._unsub = undefined;
    // A drag in progress on the old map is abandoned; the server's staleness
    // TTL clears its last 'active' frame for peers.
    this._local = undefined;
    for (const r of this._localReleased) {
      r.cancel();
    }
    this._localReleased = [];
    this._remote = [];
    this._mapId = mapId;

    this._unsub = this._live.watchLiveOverlays(mapId, items => {
      this._remote = items.filter(it => it.payload.kind === 'scribble');
      this.pushRender();
    });
    this.pushRender();
  }

  start(cp: Point2) {
    if (this._mapId === undefined) {
      return;
    }
    const world = this._toWorld(cp);
    this._local = {
      itemId: this._newId(),
      points: [{ x: world.x, y: world.y }],
      lastSampled: { x: cp.x, y: cp.y },
      lastSentAt: this._now(),
    };
    this.pushRender();
  }

  move(cp: Point2) {
    const local = this._local;
    if (local === undefined) {
      return;
    }
    const dx = cp.x - local.lastSampled.x;
    const dy = cp.y - local.lastSampled.y;
    if (dx * dx + dy * dy < SAMPLE_PX * SAMPLE_PX) {
      return;
    }
    if (local.points.length >= MAX_SCRIBBLE_POINTS) {
      return;
    }
    const world = this._toWorld(cp);
    local.points.push({ x: world.x, y: world.y });
    local.lastSampled = { x: cp.x, y: cp.y };
    this.pushRender();

    const t = this._now();
    if (t - local.lastSentAt >= SEND_INTERVAL_MS) {
      this.send(local.itemId, local.points, 'active');
      local.lastSentAt = t;
    }
  }

  end(cp: Point2) {
    const local = this._local;
    if (local === undefined) {
      return;
    }
    // Append the final point only if it clears the sampling threshold from the
    // last accepted sample (same rule as move), so a barely-moved release does
    // not add a redundant point.
    const dx = cp.x - local.lastSampled.x;
    const dy = cp.y - local.lastSampled.y;
    if (dx * dx + dy * dy >= SAMPLE_PX * SAMPLE_PX && local.points.length < MAX_SCRIBBLE_POINTS) {
      const world = this._toWorld(cp);
      local.points.push({ x: world.x, y: world.y });
    }

    this.send(local.itemId, local.points, 'released');

    const releasedAt = this._now();
    const itemId = local.itemId;
    const cancel = this._schedule(() => {
      this._localReleased = this._localReleased.filter(r => r.itemId !== itemId);
      this.pushRender();
    }, SCRIBBLE_FADE_TOTAL_MS);
    this._localReleased.push({ itemId, points: local.points, releasedAt, cancel });

    this._local = undefined;
    this.pushRender();
  }

  dispose() {
    this._unsub?.();
    this._unsub = undefined;
    for (const r of this._localReleased) {
      r.cancel();
    }
    this._localReleased = [];
    this._local = undefined;
  }

  private send(itemId: string, points: PixelCoord[], phase: 'active' | 'released') {
    if (this._mapId === undefined) {
      return;
    }
    this._live.sendOverlayUpdate(this._mapId, {
      itemId,
      phase,
      payload: { kind: 'scribble', points: points.map(p => ({ x: p.x, y: p.y })) },
    });
  }

  private pushRender() {
    const segments: ScribbleSegment[] = [];

    // Remote strokes first (oldest update first), then locally-released, then
    // the in-progress local stroke on top. Painter's order = newer on top.
    const remote = [...this._remote].sort((a, b) => a.updatedAt - b.updatedAt);
    for (const it of remote) {
      if (it.payload.kind !== 'scribble') {
        continue;
      }
      appendSegments(segments, it.payload.points, it.releasedAt ?? SCRIBBLE_ACTIVE);
    }
    for (const r of [...this._localReleased].sort((a, b) => a.releasedAt - b.releasedAt)) {
      appendSegments(segments, r.points, r.releasedAt);
    }
    if (this._local !== undefined) {
      appendSegments(segments, this._local.points, SCRIBBLE_ACTIVE);
    }

    this._setScribbles(segments);
  }
}

function appendSegments(out: ScribbleSegment[], points: PixelCoord[], releaseTime: number) {
  for (let i = 0; i + 1 < points.length; ++i) {
    out.push({
      startX: points[i].x,
      startY: points[i].y,
      endX: points[i + 1].x,
      endY: points[i + 1].y,
      colour: WHITE,
      releaseTime,
    });
  }
}
