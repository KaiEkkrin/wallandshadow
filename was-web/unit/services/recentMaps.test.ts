import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { MapType, maxProfileEntries } from '@wallandshadow/shared';
import type { IMapSummary } from '@wallandshadow/shared';

import {
  forgetMap,
  markMapRecent,
  readRecentMaps,
  recentMaps$,
} from '../../src/services/recentMaps';

// recentMaps.ts uses localStorage, which does not exist in the Vitest `node`
// environment — provide a minimal in-memory stub. recentMaps.ts also keeps a
// module-level per-uid BehaviorSubject cache that persists across tests, so
// every test uses a unique uid (see `uid()` below) to stay isolated.

function makeLocalStorageStub(): Storage {
  const store = new Map<string, string>();
  return {
    get length() { return store.size; },
    clear: () => store.clear(),
    getItem: (k: string) => store.get(k) ?? null,
    key: (i: number) => [...store.keys()][i] ?? null,
    removeItem: (k: string) => { store.delete(k); },
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
  };
}

let uidCounter = 0;
function uid(): string {
  return `uid-${++uidCounter}`;
}

function makeSummary(overrides: Partial<IMapSummary> = {}): IMapSummary {
  return {
    adventureId: 'adv-1',
    id: 'map-1',
    name: 'Map',
    description: 'desc',
    ty: MapType.Square,
    imagePath: '',
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', makeLocalStorageStub());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('markMapRecent', () => {
  test('a new map is prepended to the front of the list', () => {
    const u = uid();
    markMapRecent(u, makeSummary({ id: 'map-a' }));
    markMapRecent(u, makeSummary({ id: 'map-b' }));

    expect(readRecentMaps(u).map(m => m.id)).toEqual(['map-b', 'map-a']);
  });

  test('re-marking an unchanged map leaves the list content untouched', () => {
    const u = uid();
    markMapRecent(u, makeSummary({ id: 'map-a' }));
    markMapRecent(u, makeSummary({ id: 'map-b' }));
    markMapRecent(u, makeSummary({ id: 'map-a' }));

    expect(readRecentMaps(u)).toEqual([
      makeSummary({ id: 'map-b' }),
      makeSummary({ id: 'map-a' }),
    ]);
  });

  test('a changed map is updated in place (position-stable)', () => {
    const u = uid();
    markMapRecent(u, makeSummary({ id: 'map-a', name: 'Old' }));
    markMapRecent(u, makeSummary({ id: 'map-b' }));
    markMapRecent(u, makeSummary({ id: 'map-a', name: 'New' }));

    const result = readRecentMaps(u);
    // map-a stays at index 1 — it is not promoted to the front.
    expect(result.map(m => m.id)).toEqual(['map-b', 'map-a']);
    expect(result[1].name).toBe('New');
  });

  test('the list is capped at maxProfileEntries', () => {
    const u = uid();
    const total = maxProfileEntries + 3;
    for (let i = 0; i < total; i++) {
      markMapRecent(u, makeSummary({ id: `map-${i}` }));
    }

    const result = readRecentMaps(u);
    expect(result).toHaveLength(maxProfileEntries);
    // The most recently marked maps survive; the oldest are dropped.
    expect(result[0].id).toBe(`map-${total - 1}`);
    expect(result.some(m => m.id === 'map-0')).toBe(false);
  });

  test('the change is persisted to localStorage', () => {
    const u = uid();
    markMapRecent(u, makeSummary({ id: 'map-a' }));

    const raw = localStorage.getItem(`was_hono_latest_maps_${u}`);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toEqual([makeSummary({ id: 'map-a' })]);
  });
});

describe('forgetMap', () => {
  test('removes the named map from the list', () => {
    const u = uid();
    markMapRecent(u, makeSummary({ id: 'map-a' }));
    markMapRecent(u, makeSummary({ id: 'map-b' }));

    forgetMap(u, 'map-a');

    expect(readRecentMaps(u).map(m => m.id)).toEqual(['map-b']);
  });

  test('forgetting an absent map leaves the list content unchanged', () => {
    const u = uid();
    markMapRecent(u, makeSummary({ id: 'map-a' }));

    forgetMap(u, 'map-does-not-exist');

    expect(readRecentMaps(u)).toEqual([makeSummary({ id: 'map-a' })]);
  });
});

describe('recentMaps$', () => {
  test('emits the current list and subsequent updates', async () => {
    const u = uid();
    markMapRecent(u, makeSummary({ id: 'map-a' }));

    // The BehaviorSubject replays its current value to a new subscriber.
    expect((await firstValueFrom(recentMaps$(u))).map(m => m.id)).toEqual(['map-a']);

    const emissions: string[][] = [];
    const sub = recentMaps$(u).subscribe(maps => emissions.push(maps.map(m => m.id)));
    markMapRecent(u, makeSummary({ id: 'map-b' }));
    sub.unsubscribe();

    expect(emissions).toEqual([['map-a'], ['map-b', 'map-a']]);
  });
});

describe('readFromStorage corrupt-storage path', () => {
  test('invalid JSON in localStorage yields an empty list and logs a warning', () => {
    const u = uid();
    localStorage.setItem(`was_hono_latest_maps_${u}`, '{ this is not json');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // First access for this uid triggers readFromStorage via subjectFor.
    expect(readRecentMaps(u)).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('Failed to read recent maps');
  });
});
