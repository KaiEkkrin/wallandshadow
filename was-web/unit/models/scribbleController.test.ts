import { describe, test, expect, beforeEach } from 'vitest';
import { ILiveData, OutgoingOverlayItem, OverlayItem } from '@wallandshadow/shared';
import { ScribbleController } from './scribbleController';
import { ScribbleStroke, ScribbleStyle, SCRIBBLE_ACTIVE } from './scribbleTypes';

// Minimal fake of the bits of ILiveData the controller uses.
class FakeLive {
  sent: { mapId: string; item: OutgoingOverlayItem }[] = [];
  subs: { mapId: string; onNext: (items: OverlayItem[]) => void }[] = [];
  unsubscribes = 0;

  sendOverlayUpdate(mapId: string, item: OutgoingOverlayItem) {
    this.sent.push({ mapId, item });
  }
  watchLiveOverlays(mapId: string, onNext: (items: OverlayItem[]) => void) {
    const sub = { mapId, onNext };
    this.subs.push(sub);
    return () => { this.unsubscribes += 1; };
  }
  asLive(): ILiveData { return this as unknown as ILiveData; }
}

// A style that records which author it was resolved for.
function styleOf(authorId: string, generation = 0): ScribbleStyle {
  const tag = authorId.length / 10 + generation;
  return { fill: { r: tag, g: 0, b: 0 }, outline: { r: 0, g: tag, b: 0 }, widthScale: 1 };
}

describe('ScribbleController', () => {
  let live: FakeLive;
  let rendered: ScribbleStroke[][];
  let nowMs: number;
  let pendingTimers: { fn: () => void; ms: number }[];
  let styleFor: (authorId: string) => ScribbleStyle;

  function makeController() {
    return new ScribbleController({
      live: live.asLive(),
      uid: 'me',
      styleFor: () => styleFor,
      // Identity transform: viewport coords == world coords for the test.
      toWorld: (cp) => ({ x: cp.x, y: cp.y }),
      setScribbles: (strokes) => rendered.push(strokes),
      now: () => nowMs,
      newId: () => 'item-1',
      schedule: (fn, ms) => { pendingTimers.push({ fn, ms }); return () => {}; },
    });
  }

  beforeEach(() => {
    live = new FakeLive();
    rendered = [];
    nowMs = 1000;
    pendingTimers = [];
    styleFor = id => styleOf(id);
  });

  test('setMap subscribes for that map', () => {
    const c = makeController();
    c.setMap('adv', 'map-1');
    expect(live.subs).toHaveLength(1);
    expect(live.subs[0].mapId).toBe('map-1');
  });

  test('a stroke sends a released frame on end with the world points', () => {
    const c = makeController();
    c.setMap('adv', 'map-1');
    c.start({ x: 0, y: 0 });
    nowMs += 200;
    c.move({ x: 50, y: 0 });   // beyond the sampling threshold
    c.end({ x: 100, y: 0 });

    const released = live.sent.filter(s => s.item.phase === 'released');
    expect(released).toHaveLength(1);
    expect(released[0].item.itemId).toBe('item-1');
    const payload = released[0].item.payload;
    expect(payload.kind).toBe('scribble');
    if (payload.kind === 'scribble') {
      expect(payload.points).toEqual([
        { x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 },
      ]);
    }
  });

  test('moves below the sampling threshold are dropped', () => {
    const c = makeController();
    c.setMap('adv', 'map-1');
    c.start({ x: 0, y: 0 });
    c.move({ x: 1, y: 0 }); // < threshold, ignored
    c.end({ x: 1, y: 0 });  // same point as last sampled, ignored as duplicate

    const released = live.sent.find(s => s.item.phase === 'released');
    const payload = released!.item.payload;
    if (payload.kind === 'scribble') {
      expect(payload.points).toEqual([{ x: 0, y: 0 }]);
    }
  });

  test('active sends are throttled by time', () => {
    const c = makeController();
    c.setMap('adv', 'map-1');
    c.start({ x: 0, y: 0 });
    c.move({ x: 50, y: 0 });   // same tick -> throttled, no active send
    nowMs += 100;              // past the throttle interval
    c.move({ x: 100, y: 0 });  // now an active send fires
    const active = live.sent.filter(s => s.item.phase === 'active');
    expect(active.length).toBe(1);
  });

  test('the local stroke is rendered optimistically', () => {
    const c = makeController();
    c.setMap('adv', 'map-1');
    c.start({ x: 0, y: 0 });
    c.move({ x: 50, y: 0 });
    const last = rendered[rendered.length - 1];
    expect(last).toHaveLength(1);
    expect(last[0].points).toEqual([{ x: 0, y: 0 }, { x: 50, y: 0 }]);
    expect(last[0].releaseTime).toBe(SCRIBBLE_ACTIVE);
    expect(last[0].style).toEqual(styleOf('me'));
  });

  test('a single-point local stroke is not rendered', () => {
    const c = makeController();
    c.setMap('adv', 'map-1');
    c.start({ x: 0, y: 0 });
    expect(rendered[rendered.length - 1]).toHaveLength(0);
  });

  test('remote scribbles are merged into the rendered strokes', () => {
    const c = makeController();
    c.setMap('adv', 'map-1');
    const remote: OverlayItem = {
      itemId: 'r1', authorId: 'other', updatedAt: 500, releasedAt: 800,
      phase: 'released', payload: { kind: 'scribble', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
    };
    live.subs[0].onNext([remote]);
    const last = rendered[rendered.length - 1];
    expect(last).toHaveLength(1);
    expect(last[0].releaseTime).toBe(800);
    expect(last[0].style).toEqual(styleOf('other'));
  });

  test('remote strokes draw under local ones, oldest first', () => {
    const c = makeController();
    c.setMap('adv', 'map-1');
    const item = (itemId: string, updatedAt: number, x: number): OverlayItem => ({
      itemId, authorId: 'other', updatedAt, phase: 'active',
      payload: { kind: 'scribble', points: [{ x, y: 0 }, { x: x + 1, y: 0 }] },
    });
    live.subs[0].onNext([item('newer', 900, 20), item('older', 500, 10)]);
    c.start({ x: 0, y: 0 });
    c.move({ x: 50, y: 0 });
    const last = rendered[rendered.length - 1];
    expect(last.map(s => s.points[0].x)).toEqual([10, 20, 0]);
  });

  test('refreshStyles re-renders the same strokes with the current styles', () => {
    const c = makeController();
    c.setMap('adv', 'map-1');
    c.start({ x: 0, y: 0 });
    c.move({ x: 50, y: 0 });
    const before = rendered[rendered.length - 1];

    styleFor = id => styleOf(id, 1);
    c.refreshStyles();
    const after = rendered[rendered.length - 1];
    expect(after).toHaveLength(1);
    expect(after[0].points).toEqual(before[0].points);
    expect(after[0].style).toEqual(styleOf('me', 1));
  });

  test('non-scribble overlay items are ignored', () => {
    const c = makeController();
    c.setMap('adv', 'map-1');
    const ruler = {
      itemId: 'k1', authorId: 'other', updatedAt: 500,
      phase: 'active', payload: { kind: 'ruler', nodes: [] },
    } as unknown as OverlayItem;
    live.subs[0].onNext([ruler]);
    const last = rendered[rendered.length - 1];
    expect(last).toHaveLength(0);
  });

  test('setMap a second time unsubscribes the previous map', () => {
    const c = makeController();
    c.setMap('adv', 'map-1');
    c.setMap('adv', 'map-2');
    expect(live.unsubscribes).toBe(1);
    expect(live.subs[1].mapId).toBe('map-2');
  });

  test('dispose unsubscribes', () => {
    const c = makeController();
    c.setMap('adv', 'map-1');
    c.dispose();
    expect(live.unsubscribes).toBe(1);
  });

  test('a released stroke is pruned after its fade timer fires', () => {
    const c = makeController();
    c.setMap('adv', 'map-1');
    c.start({ x: 0, y: 0 });
    c.move({ x: 50, y: 0 });
    c.end({ x: 100, y: 0 });

    // After release the stroke is still rendered (fading)...
    expect(rendered[rendered.length - 1].length).toBeGreaterThan(0);

    // ...until the prune timer fires, after which it is gone.
    expect(pendingTimers).toHaveLength(1);
    pendingTimers[0].fn();
    expect(rendered[rendered.length - 1]).toHaveLength(0);
  });
});
