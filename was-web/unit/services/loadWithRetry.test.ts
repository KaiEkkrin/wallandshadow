import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Subject } from 'rxjs';

import { LoadState, loadWithRetry, retryDelayMs, RETRY_MAX_DELAY_MS } from './loadWithRetry';

// random() === 0.5 means no jitter, so delays are exact powers of two.
const noJitter = () => 0.5;

function createLogger() {
  return { logWarning: vi.fn(), logError: vi.fn() };
}

function collect<T>(states: LoadState<T>[]) {
  return (s: LoadState<T>) => states.push(s);
}

describe('retryDelayMs', () => {
  test('doubles from 2 seconds', () => {
    expect([1, 2, 3, 4].map(a => retryDelayMs(a, noJitter))).toEqual([2000, 4000, 8000, 16000]);
  });

  test('caps at 30 minutes', () => {
    expect(retryDelayMs(11, noJitter)).toBe(RETRY_MAX_DELAY_MS);
    expect(retryDelayMs(1000, noJitter)).toBe(RETRY_MAX_DELAY_MS);
  });

  test('jitters by up to 20% either way', () => {
    expect(retryDelayMs(1, () => 0)).toBe(1600);
    expect(retryDelayMs(1, () => 1)).toBe(2400);
  });
});

describe('loadWithRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('emits loading then loaded, and completes, when the first attempt succeeds', async () => {
    const states: LoadState<string>[] = [];
    let completed = false;
    loadWithRetry(async () => 'ok', { description: 'thing', logger: createLogger(), wake: new Subject() })
      .subscribe({ next: collect(states), complete: () => { completed = true; } });

    await vi.advanceTimersByTimeAsync(0);
    expect(states).toEqual([{ status: 'loading' }, { status: 'loaded', value: 'ok' }]);
    expect(completed).toBe(true);
  });

  test('retries after a failure on the backoff schedule until an attempt succeeds', async () => {
    const attempt = vi.fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('504'))
      .mockRejectedValueOnce(new Error('504'))
      .mockResolvedValueOnce('ok');
    const logger = createLogger();
    const states: LoadState<string>[] = [];
    loadWithRetry(attempt, { description: 'thing', logger, wake: new Subject(), random: noJitter })
      .subscribe(collect(states));

    await vi.advanceTimersByTimeAsync(0);
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(states.at(-1)).toMatchObject({ status: 'failed', attempt: 1 });

    // The first retry waits 2s, the second 4s
    await vi.advanceTimersByTimeAsync(1999);
    expect(attempt).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(states.at(-1)).toMatchObject({ status: 'failed', attempt: 2 });

    await vi.advanceTimersByTimeAsync(4000);
    expect(attempt).toHaveBeenCalledTimes(3);
    expect(states.at(-1)).toEqual({ status: 'loaded', value: 'ok' });
    expect(logger.logWarning).toHaveBeenCalledTimes(2);
    expect(logger.logError).not.toHaveBeenCalled();
  });

  test('keeps retrying forever, logging an error once when it slows to the maximum delay', async () => {
    const attempt = vi.fn(async () => { throw new Error('504'); });
    const logger = createLogger();
    loadWithRetry(attempt, { description: 'thing', logger, wake: new Subject(), random: noJitter })
      .subscribe();

    // 2 + 4 + ... + 1024 seconds covers the first 10 retries; then three more
    // at the 30 minute cap
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2046 * 1000 + 3 * RETRY_MAX_DELAY_MS);
    expect(attempt).toHaveBeenCalledTimes(14);
    expect(logger.logWarning).toHaveBeenCalledTimes(14);
    expect(logger.logError).toHaveBeenCalledTimes(1);
  });

  test('retries straight away when woken', async () => {
    const attempt = vi.fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce('ok');
    const wake = new Subject<void>();
    const states: LoadState<string>[] = [];
    loadWithRetry(attempt, { description: 'thing', logger: createLogger(), wake, random: noJitter })
      .subscribe(collect(states));

    await vi.advanceTimersByTimeAsync(0);
    expect(attempt).toHaveBeenCalledTimes(1);

    wake.next();
    await vi.advanceTimersByTimeAsync(0);
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(states.at(-1)).toEqual({ status: 'loaded', value: 'ok' });

    // The timer for the retry the wake pre-empted must not fire a third attempt
    await vi.advanceTimersByTimeAsync(10000);
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  test('a wake while an attempt is in flight does nothing', async () => {
    const attempt = vi.fn(() => new Promise<string>(() => { /* never settles */ }));
    const wake = new Subject<void>();
    loadWithRetry(attempt, { description: 'thing', logger: createLogger(), wake }).subscribe();

    await vi.advanceTimersByTimeAsync(0);
    wake.next();
    await vi.advanceTimersByTimeAsync(0);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  test('unsubscribing cancels the pending retry', async () => {
    const attempt = vi.fn(async () => { throw new Error('504'); });
    const wake = new Subject<void>();
    const sub = loadWithRetry(attempt, { description: 'thing', logger: createLogger(), wake }).subscribe();

    await vi.advanceTimersByTimeAsync(0);
    sub.unsubscribe();
    wake.next();
    await vi.advanceTimersByTimeAsync(RETRY_MAX_DELAY_MS);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  test('unsubscribing aborts the attempt in flight and discards a value that arrives late', async () => {
    let resolveAttempt: (v: string) => void = () => { /* replaced below */ };
    let signal: AbortSignal | undefined;
    const attempt = (s: AbortSignal) => {
      signal = s;
      return new Promise<string>(resolve => { resolveAttempt = resolve; });
    };
    const discard = vi.fn();
    const states: LoadState<string>[] = [];
    const sub = loadWithRetry(attempt, { description: 'thing', logger: createLogger(), wake: new Subject(), discard })
      .subscribe(collect(states));

    await vi.advanceTimersByTimeAsync(0);
    sub.unsubscribe();
    expect(signal?.aborted).toBe(true);

    resolveAttempt('late');
    await vi.advanceTimersByTimeAsync(0);
    expect(discard).toHaveBeenCalledWith('late');
    expect(states).toEqual([{ status: 'loading' }]);
  });

  test('a synchronous throw from the attempt counts as a failure', async () => {
    const attempt = vi.fn((): Promise<string> => { throw new Error('boom'); });
    const states: LoadState<string>[] = [];
    loadWithRetry(attempt, { description: 'thing', logger: createLogger(), wake: new Subject() })
      .subscribe(collect(states));

    await vi.advanceTimersByTimeAsync(0);
    expect(states.at(-1)).toMatchObject({ status: 'failed', attempt: 1 });
  });
});
