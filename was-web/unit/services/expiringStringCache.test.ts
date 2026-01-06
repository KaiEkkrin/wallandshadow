import { assert, vi } from 'vitest';
import { ExpiringStringCache } from './expiringStringCache';

test('Entries are cached successfully', async () => {
  // We map string -> 'fetched_{string}'
  const fetch = vi.fn((id: string) => new Promise<string>((resolve) => resolve(`fetched_${id}`)));

  // We won't expire anything until this subject trips
  const cache = new ExpiringStringCache(10);

  // These should cause fetches
  let oneEntry = await cache.resolve('one', fetch);
  expect(oneEntry).toBe('fetched_one');
  expect(fetch).toHaveBeenLastCalledWith('one');
  expect(fetch).toHaveBeenCalledTimes(1);

  let twoEntry = await cache.resolve('two', fetch);
  expect(twoEntry).toBe('fetched_two');
  expect(fetch).toHaveBeenLastCalledWith('two');
  expect(fetch).toHaveBeenCalledTimes(2);

  // These should not
  oneEntry = await cache.resolve('one', fetch);
  expect(oneEntry).toBe('fetched_one');
  expect(fetch).toHaveBeenCalledTimes(2);

  twoEntry = await cache.resolve('two', fetch);
  expect(twoEntry).toBe('fetched_two');
  expect(fetch).toHaveBeenCalledTimes(2);

  // But after expiry, re-fetches should happen
  await new Promise((resolve) => setTimeout(resolve, 100));
  oneEntry = await cache.resolve('one', fetch);
  expect(oneEntry).toBe('fetched_one');
  expect(fetch).toHaveBeenLastCalledWith('one');
  expect(fetch).toHaveBeenCalledTimes(3);

  twoEntry = await cache.resolve('two', fetch);
  expect(twoEntry).toBe('fetched_two');
  expect(fetch).toHaveBeenLastCalledWith('two');
  expect(fetch).toHaveBeenCalledTimes(4);
});

test('Failed entries do not stay in the cache', async () => {
  // Here's a canned failure
  const failingFetch = vi.fn(
    (id: string) => new Promise<string>((resolve, reject) => reject('blah'))
  );

  // We map string -> 'fetched_{string}'
  const successfulFetch = vi.fn((id: string) => new Promise<string>((resolve) => resolve(`fetched_${id}`)));

  // We won't expire anything until this subject trips
  const cache = new ExpiringStringCache(1000);

  // This should cause a fetch, and a failure
  try {
    await cache.resolve('one', failingFetch);
    assert.fail('Error did not propagate');
  } catch {
    expect(failingFetch).toHaveBeenCalledTimes(1);
  }

  // If I wait a bit and try again, it should re-fetch because of the failure
  // despite the timeout
  await new Promise((resolve) => setTimeout(resolve, 10));

  let oneEntry = await cache.resolve('one', successfulFetch);
  expect(oneEntry).toBe('fetched_one');
  expect(successfulFetch).toHaveBeenLastCalledWith('one');
  expect(successfulFetch).toHaveBeenCalledTimes(1);

  // ...and the caching mechanism should still be working
  oneEntry = await cache.resolve('one', successfulFetch);
  expect(oneEntry).toBe('fetched_one');
  expect(successfulFetch).toHaveBeenCalledTimes(1);
});