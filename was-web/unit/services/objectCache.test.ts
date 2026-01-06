import { assert, vi } from 'vitest';
import { ICacheLease } from './interfaces';
import { ObjectCache } from './objectCache';
import { Subject } from 'rxjs';

function createFetch() {
  const trigger = new Subject<string>();
  const cleanup = vi.fn<() => void>();
  const promise = new Promise<string>((resolve, reject) => {
    trigger.subscribe(v => ({ value: resolve(v), cleanup: cleanup }), e => reject(e))
  });
  return {
    cleanup: cleanup,
    func: vi.fn(async (id: string) => ({
      value: await promise, cleanup: () => cleanup()
    })),
    trigger: trigger,
  };
}

test('Resolve one value immediately', async () => {
  const logError = vi.fn();
  const cache = new ObjectCache(logError);

  const f1 = createFetch();

  // Before a resolve, the `get` function should return undefined
  expect(cache.get('1')).toBeUndefined();

  f1.trigger.next('ook');
  const v1 = await cache.resolve('1', f1.func);
  expect(v1.value).toBe('ook');
  expect(f1.func).toHaveBeenCalledTimes(1);

  // I should be able to resolve it a few more times from the cached value...
  const v2 = await cache.resolve('1', f1.func);
  const v3 = await cache.resolve('1', f1.func);
  expect(v2.value).toBe('ook');
  expect(v3.value).toBe('ook');
  expect(f1.func).toHaveBeenCalledTimes(1);

  // ...and the `get` should now work
  const g1 = cache.get('1');
  expect(g1?.value).toBe('ook');
  await g1?.release();

  // Nothing should have been released yet
  expect(f1.cleanup).toHaveBeenCalledTimes(0);

  // Release two and we should still have a cached value
  await v3.release();
  await v2.release();

  const v4 = await cache.resolve('1', f1.func);
  expect(v4.value).toBe('ook');
  await v4.release();

  expect(f1.func).toHaveBeenCalledTimes(1);
  expect(f1.cleanup).toHaveBeenCalledTimes(0);

  // Release the last and we should not any more:
  await v1.release();
  expect(f1.cleanup).toHaveBeenCalledTimes(1);

  expect(cache.get('1')).toBeUndefined();

  // Resolve the value again and it should be re-created from the original
  const v5 = await cache.resolve('1', f1.func);
  expect(v5.value).toBe('ook');
  expect(f1.func).toHaveBeenCalledTimes(2);

  const v6 = cache.get('1');
  expect(v6?.value).toBe('ook');

  cache.dispose();
});

test('resolve one value with a delay, queueing requests', async () => {
  const logError = vi.fn();
  const cache = new ObjectCache(logError);

  const f1 = createFetch();

  // These should block
  const p1 = cache.resolve('1', f1.func);
  const p2 = cache.resolve('1', f1.func);
  const p3 = cache.resolve('1', f1.func);

  expect(cache.get('1')).toBeUndefined();

  f1.trigger.next('banana');

  const v1 = await p1;
  expect(v1.value).toBe('banana');

  const v2 = await p2;
  expect(v2.value).toBe('banana');

  const v3 = await p3;
  expect(v3.value).toBe('banana');

  expect(f1.func).toHaveBeenCalledTimes(1);

  const v4 = cache.get('1');
  expect(v4?.value).toBe('banana');

  cache.dispose();
});

test('resolve one value with an error the first time', async () => {
  const logError = vi.fn();
  const cache = new ObjectCache(logError);

  const f1 = createFetch();
  const p1 = cache.resolve('1', f1.func);
  f1.trigger.error('failed');

  try {
    await p1;
    assert.fail('p1 did not throw');
  } catch (e) {}

  expect(cache.get('1')).toBeUndefined();

  const f2 = createFetch();
  const p2 = cache.resolve('1', f2.func);
  f2.trigger.next('ok');

  const v2 = await p2;
  expect(v2.value).toBe('ok');

  expect(cache.get('1')?.value).toBe('ok');
  await v2.release();

  cache.dispose();
});

test('an accidental double release is ignored', async () => {
  const logError = vi.fn();
  const cache = new ObjectCache(logError);

  const f1 = createFetch();
  const p1 = cache.resolve('1', f1.func);
  f1.trigger.next('ready');

  const v1 = await p1;
  expect(v1.value).toBe('ready');

  const v2 = await cache.resolve('1', f1.func);
  expect(v2.value).toBe('ready');

  // If I dispose v2 twice, the cache should still not be cleaned out:
  await v2.release();
  await v2.release();

  const v3 = cache.get('1');
  expect(v3?.value).toBe('ready');
  
  // ...but it will be if I release the other leases
  await v3?.release();
  await v1.release();
  expect(cache.get('1')).toBeUndefined();

  cache.dispose();
});

test('multiple values can be loaded independently', async () => {
  const logError = vi.fn();
  const cache = new ObjectCache<string>(logError);

  const expectedValues = ['a', 'b', 'c', 'd'];
  const fetchers = expectedValues.map(v => createFetch());
  const promises = fetchers.map((f, i) => cache.resolve(`${i}`, f.func));

  // Resolve them one at a time and check the status tracks correctly
  const leases: ICacheLease<string>[] = [];
  const releases: Promise<void>[] = [];
  for (let i = 0; i < expectedValues.length; ++i) {
    fetchers[i].trigger.next(expectedValues[i]);
    const lease = await promises[i];
    leases.push(lease);

    expect(lease.value).toBe(expectedValues[i]);

    for (let j = 0; j < expectedValues.length; ++j) {
      const got = cache.get(`${j}`);
      if (j <= i) {
        expect(got?.value).toBe(expectedValues[j]);
        if (got !== undefined) {
          releases.push(got.release());
        }
      } else {
        expect(got).toBeUndefined();
      }
    }
  }

  await Promise.all(releases);

  fetchers.splice(0, fetchers.length);
  promises.splice(0, promises.length);
  releases.splice(0, releases.length);

  // Release and re-acquire them one at a time and check the status also
  // tracks correctly
  for (let i = 0; i < expectedValues.length; ++i) {
    // Release it
    await leases[i].release();

    // Check it's gone (and the others are as they should be)
    for (let j = 0; j < expectedValues.length; ++j) {
      const got = cache.get(`${j}`);
      if (j > i) {
        expect(got?.value).toBe(expectedValues[j]);
        if (got !== undefined) {
          releases.push(got.release());
        }
      } else {
        expect(got).toBeUndefined();
      }
    }

    // Start re-acquiring it
    const fetch = createFetch();
    fetchers.push(fetch);
    promises.push(cache.resolve(`${i}`, fetch.func));
  }

  // Re-do the one-at-a-time resolve -- the result should be the same
  leases.splice(0, leases.length);
  releases.splice(0, releases.length);
  for (let i = 0; i < expectedValues.length; ++i) {
    fetchers[i].trigger.next(expectedValues[i]);
    const lease = await promises[i];
    leases.push(lease);

    expect(lease.value).toBe(expectedValues[i]);

    for (let j = 0; j < expectedValues.length; ++j) {
      const got = cache.get(`${j}`);
      if (j <= i) {
        expect(got?.value).toBe(expectedValues[j]);
        if (got !== undefined) {
          releases.push(got.release());
        }
      } else {
        expect(got).toBeUndefined();
      }
    }
  }

  await Promise.all(releases);
  cache.dispose();
});