import { ILiveData, OverlayItem, PixelCoord, MAX_SCRIBBLE_POINTS } from '@wallandshadow/shared';
import {
  ScribbleMarker,
  ScribbleStroke,
  ScribbleStyle,
  SCRIBBLE_ACTIVE,
  SCRIBBLE_FADE_TOTAL_MS,
} from './scribbleTypes';

// Minimum movement (in viewport pixels) between sampled points, to bound the
// number of points/segments and avoid flooding the wire.
const SAMPLE_PX = 3;
// Minimum gap between fire-and-forget "active" frames while drawing.
export const SEND_INTERVAL_MS = 80;
// While a stroke is held, resend it at least this often even if nothing has
// changed, so the server's staleness timeout (ACTIVE_STALE_MS, 5 s) never
// drops a stroke whose author is simply holding still.
export const KEEPALIVE_MS = 2000;

interface Point2 { x: number; y: number; }

export interface ScribbleControllerParams {
  live: ILiveData;
  // The local user, who authors the local strokes.
  uid: string;
  // Returns the current authorId -> style lookup. A getter, so the owner can
  // swap the lookup and call refreshStyles() without rebuilding the controller.
  styleFor: () => (authorId: string) => ScribbleStyle;
  // Converts a viewport point (x,y) into world coordinates.
  toWorld: (cp: Point2) => Point2;
  // Pushes the current full stroke set to the renderer.
  setScribbles: (strokes: ScribbleStroke[]) => void;
  // Pushes the remote scribblers' current hot points to the renderer.
  setMarkers: (markers: ScribbleMarker[]) => void;
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
  sentCount: number;       // points in the last frame sent
  cancelTick: () => void;
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
  private readonly _uid: string;
  private readonly _styleFor: () => (authorId: string) => ScribbleStyle;
  private readonly _toWorld: (cp: Point2) => Point2;
  private readonly _setScribbles: (strokes: ScribbleStroke[]) => void;
  private readonly _setMarkers: (markers: ScribbleMarker[]) => void;
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
    this._uid = params.uid;
    this._styleFor = params.styleFor;
    this._toWorld = params.toWorld;
    this._setScribbles = params.setScribbles;
    this._setMarkers = params.setMarkers;
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
    this._local?.cancelTick();
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
      // The first tick, SEND_INTERVAL_MS from now, sends this one-point stroke.
      lastSentAt: this._now(),
      sentCount: 0,
      cancelTick: () => {},
    };
    this.scheduleTick(this._local);
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

    if (this._now() - local.lastSentAt >= SEND_INTERVAL_MS) {
      this.sendActive(local);
    }
  }

  end(cp: Point2) {
    const local = this._local;
    if (local === undefined) {
      return;
    }
    local.cancelTick();
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

  // Re-renders the current strokes with the current styles, e.g. after the
  // players or tokens that styles derive from have changed.
  refreshStyles() {
    this.pushRender();
  }

  dispose() {
    this._unsub?.();
    this._unsub = undefined;
    for (const r of this._localReleased) {
      r.cancel();
    }
    this._localReleased = [];
    this._local?.cancelTick();
    this._local = undefined;
  }

  private scheduleTick(local: LocalStroke) {
    local.cancelTick = this._schedule(() => this.tick(local), SEND_INTERVAL_MS);
  }

  // Runs every SEND_INTERVAL_MS while a stroke is held: flushes points the
  // send throttle held back, and resends a still stroke as a keepalive.
  private tick(local: LocalStroke) {
    // A tick that outlived its stroke (released, or the map changed) does nothing.
    if (this._local !== local) {
      return;
    }
    const elapsed = this._now() - local.lastSentAt;
    const unsent = local.sentCount < local.points.length;
    if ((unsent && elapsed >= SEND_INTERVAL_MS) || elapsed >= KEEPALIVE_MS) {
      this.sendActive(local);
    }
    this.scheduleTick(local);
  }

  private sendActive(local: LocalStroke) {
    this.send(local.itemId, local.points, 'active');
    local.lastSentAt = this._now();
    local.sentCount = local.points.length;
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
    const styleFor = this._styleFor();
    const strokes: ScribbleStroke[] = [];
    // One per remote stroke in progress; the local author's cursor marks their own.
    const markers: ScribbleMarker[] = [];
    const add = (points: PixelCoord[], authorId: string, releaseTime: number) => {
      if (points.length >= 2) {
        strokes.push({ points, style: styleFor(authorId), releaseTime });
      }
    };

    // Remote strokes first (oldest update first), then locally-released, then
    // the in-progress local stroke on top. Painter's order = newer on top.
    const remote = [...this._remote].sort((a, b) => a.updatedAt - b.updatedAt);
    for (const it of remote) {
      if (it.payload.kind !== 'scribble') {
        continue;
      }
      add(it.payload.points, it.authorId, it.releasedAt ?? SCRIBBLE_ACTIVE);
      if (it.phase === 'active' && it.payload.points.length > 0) {
        markers.push({
          key: `${it.authorId}/${it.itemId}`,
          point: it.payload.points[it.payload.points.length - 1],
          style: styleFor(it.authorId),
        });
      }
    }
    for (const r of [...this._localReleased].sort((a, b) => a.releasedAt - b.releasedAt)) {
      add(r.points, this._uid, r.releasedAt);
    }
    if (this._local !== undefined) {
      add(this._local.points, this._uid, SCRIBBLE_ACTIVE);
    }

    this._setScribbles(strokes);
    this._setMarkers(markers);
  }
}
