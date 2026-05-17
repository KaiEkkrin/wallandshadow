import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Changes, IApi, ILiveData } from '@wallandshadow/shared';

import { watchChangesAndConsolidate } from '../../src/models/mapChangeConsolidator';

const adventureId = 'adv-1';
const mapId = 'map-1';

function baseChange(resync = false): Changes {
  return { chs: [], incremental: false, resync, user: 'u' };
}

function incrementalChange(): Changes {
  return { chs: [], incremental: true, resync: false, user: 'u' };
}

// Consolidators created by setup(), disposed in afterEach: an invalid
// incremental lazily subscribes an RxJS interval()-backed timer that would
// otherwise outlive the test.
const created: Array<(() => void) | undefined> = [];

// Drives a consolidator with stubbed ILiveData / IApi. `feed` invokes the
// onNext the consolidator registered with watchMapChanges; `feedSubscribed`
// invokes the onSubscribed callback (a full-reload signal).
function setup(opts: {
  onNextResult?: (chs: Changes) => boolean;
  resyncIntervalMillis?: number;
} = {}) {
  const onNextResult = opts.onNextResult ?? (() => true);

  const onNext = vi.fn((chs: Changes) => onNextResult(chs));
  const onReset = vi.fn();
  const onError = vi.fn();

  let feed: (chs: Changes) => void = () => { throw new Error('not subscribed'); };
  let feedSubscribed: () => void = () => {};
  const stopWatching = vi.fn();

  const live = {
    watchMapChanges: vi.fn((
      _mapId: string,
      next: (chs: Changes) => void,
      _err?: (e: Error) => void,
      subscribed?: () => void,
    ) => {
      feed = next;
      feedSubscribed = subscribed ?? (() => {});
      return stopWatching;
    }),
  } as unknown as ILiveData;

  const consolidateMap = vi.fn().mockResolvedValue(undefined);
  const api = { consolidateMap } as unknown as IApi;

  const stop = watchChangesAndConsolidate(
    live, api, adventureId, mapId, onNext, onReset, onError, opts.resyncIntervalMillis,
  );

  created.push(stop);
  return {
    onNext, onReset, onError, consolidateMap, stopWatching, stop,
    feed: (chs: Changes) => feed(chs),
    feedSubscribed: () => feedSubscribed(),
  };
}

beforeEach(() => {
  // The consolidator emits console.debug chatter on every change — silence it.
  vi.spyOn(console, 'debug').mockImplementation(() => {});
});

afterEach(() => {
  created.forEach(stop => stop?.());
  created.length = 0;
  vi.restoreAllMocks();
});

describe('watchChangesAndConsolidate', () => {
  test('returns undefined when live or api is undefined', () => {
    const onNext = vi.fn(() => true);
    expect(watchChangesAndConsolidate(undefined, {} as IApi, adventureId, mapId, onNext, () => {}))
      .toBeUndefined();
    expect(watchChangesAndConsolidate({} as ILiveData, undefined, adventureId, mapId, onNext, () => {}))
      .toBeUndefined();
  });

  test('a base change resets the map state before applying it', () => {
    const ctx = setup();
    ctx.feed(baseChange());

    expect(ctx.onReset).toHaveBeenCalledTimes(1);
    expect(ctx.onNext).toHaveBeenCalledTimes(1);
    expect(ctx.onReset.mock.invocationCallOrder[0])
      .toBeLessThan(ctx.onNext.mock.invocationCallOrder[0]);
  });

  test('a redundant non-resync base change is skipped once the base is seen', () => {
    const ctx = setup();
    ctx.feed(baseChange());
    ctx.onReset.mockClear();
    ctx.onNext.mockClear();

    // Second identical base change carries no new information.
    ctx.feed(baseChange());

    expect(ctx.onReset).not.toHaveBeenCalled();
    expect(ctx.onNext).not.toHaveBeenCalled();
  });

  test('a resync base change is re-applied even after the base is seen', () => {
    const ctx = setup();
    ctx.feed(baseChange());
    ctx.onReset.mockClear();
    ctx.onNext.mockClear();

    ctx.feed(baseChange(true));

    expect(ctx.onReset).toHaveBeenCalledTimes(1);
    expect(ctx.onNext).toHaveBeenCalledTimes(1);
  });

  test('the onSubscribed full-reload signal re-arms base-change application', () => {
    const ctx = setup();
    ctx.feed(baseChange());
    ctx.feedSubscribed(); // full reload: forget that the base was seen
    ctx.onReset.mockClear();
    ctx.onNext.mockClear();

    ctx.feed(baseChange());

    expect(ctx.onReset).toHaveBeenCalledTimes(1);
    expect(ctx.onNext).toHaveBeenCalledTimes(1);
  });

  test('an invalid base change is fatal: reports map corruption and throws', () => {
    const ctx = setup({ onNextResult: () => false });

    expect(() => ctx.feed(baseChange())).toThrow('Invalid base change -- map corrupt');
    expect(ctx.onError).toHaveBeenCalledWith('Invalid base change -- map corrupt');
  });

  test('an invalid incremental change triggers a resync consolidate', () => {
    const ctx = setup({ onNextResult: chs => chs.incremental === false });

    ctx.feed(incrementalChange());

    // throttle emits its first value immediately, so the resync fires now.
    expect(ctx.consolidateMap).toHaveBeenCalledWith(adventureId, mapId, true);
  });

  test('rapid invalid incrementals are throttled to a single resync', () => {
    const ctx = setup({
      onNextResult: chs => chs.incremental === false,
      resyncIntervalMillis: 5000,
    });

    ctx.feed(incrementalChange());
    ctx.feed(incrementalChange()); // within the throttle window — dropped

    expect(ctx.consolidateMap).toHaveBeenCalledTimes(1);
  });

  test('a counted run of valid incrementals triggers a regular consolidate', () => {
    // Math.random=0 makes createConsolidateInterval deterministic: 100 changes.
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const ctx = setup();

    for (let i = 0; i < 99; i++) {
      ctx.feed(incrementalChange());
    }
    expect(ctx.consolidateMap).not.toHaveBeenCalled();

    ctx.feed(incrementalChange()); // the 100th change trips the countdown

    expect(ctx.consolidateMap).toHaveBeenCalledTimes(1);
    expect(ctx.consolidateMap).toHaveBeenCalledWith(adventureId, mapId, false);
  });

  test('the returned disposer stops watching', () => {
    const ctx = setup();
    expect(ctx.stop).toBeDefined();
    ctx.stop?.();
    expect(ctx.stopWatching).toHaveBeenCalledTimes(1);
  });
});
