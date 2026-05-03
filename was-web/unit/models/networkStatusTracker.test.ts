import { describe, test, expect, beforeEach } from 'vitest';
import { firstValueFrom, skip } from 'rxjs';
import { NetworkStatusTracker } from './networkStatusTracker';

// Expose the class for testing; the module also exports the singleton instance.
// We import the class directly so each test gets a fresh instance.

describe('NetworkStatusTracker', () => {
  let tracker: NetworkStatusTracker;

  beforeEach(() => {
    tracker = new NetworkStatusTracker();
  });

  describe('status$ composite colour', () => {
    test('disconnected → danger regardless of other metrics', async () => {
      tracker.setConnectionQuality(false, null, 0);
      expect(await firstValueFrom(tracker.status$)).toBe('danger');
    });

    test('connected, no issues → success', async () => {
      tracker.setConnectionQuality(true, 50, 0);
      expect(await firstValueFrom(tracker.status$)).toBe('success');
    });

    test('RTT above 300 ms → warning', async () => {
      tracker.setConnectionQuality(true, 400, 0);
      expect(await firstValueFrom(tracker.status$)).toBe('warning');
    });

    test('RTT above 800 ms → danger', async () => {
      tracker.setConnectionQuality(true, 900, 0);
      expect(await firstValueFrom(tracker.status$)).toBe('danger');
    });

    test('1 reconnection → warning', async () => {
      tracker.setConnectionQuality(true, 10, 1);
      expect(await firstValueFrom(tracker.status$)).toBe('warning');
    });

    test('3 reconnections → danger', async () => {
      tracker.setConnectionQuality(true, 10, 3);
      expect(await firstValueFrom(tracker.status$)).toBe('danger');
    });

    test('null RTT (no pongs yet) does not degrade status', async () => {
      tracker.setConnectionQuality(true, null, 0);
      expect(await firstValueFrom(tracker.status$)).toBe('success');
    });

    test('worst-of: good RTT but high reconnects → danger', async () => {
      tracker.setConnectionQuality(true, 50, 3);
      expect(await firstValueFrom(tracker.status$)).toBe('danger');
    });
  });

  describe('isConnected$', () => {
    test('reflects connected state', async () => {
      tracker.setConnectionQuality(true, null, 0);
      expect(await firstValueFrom(tracker.isConnected$)).toBe(true);

      tracker.setConnectionQuality(false, null, 0);
      expect(await firstValueFrom(tracker.isConnected$)).toBe(false);
    });
  });

  describe('rttAverage$', () => {
    test('reflects rtt value', async () => {
      tracker.setConnectionQuality(true, 123, 0);
      expect(await firstValueFrom(tracker.rttAverage$)).toBe(123);
    });

    test('null when disconnected', async () => {
      tracker.setConnectionQuality(false, null, 0);
      expect(await firstValueFrom(tracker.rttAverage$)).toBeNull();
    });
  });

  describe('reconnectCount$', () => {
    test('reflects reconnect count', async () => {
      tracker.setConnectionQuality(true, null, 2);
      expect(await firstValueFrom(tracker.reconnectCount$)).toBe(2);
    });
  });

  describe('resync counting (onChanges)', () => {
    test('initial base change is not counted as a resync', async () => {
      tracker.setConnectionQuality(true, null, 0);
      tracker.onChanges({ incremental: false, resync: true } as never);
      expect(await firstValueFrom(tracker.resyncCount)).toBe(0);
    });

    test('resync after base change is counted', async () => {
      tracker.setConnectionQuality(true, null, 0);
      tracker.onChanges({ incremental: false, resync: false } as never);
      tracker.onChanges({ incremental: true, resync: true } as never);
      expect(await firstValueFrom(tracker.resyncCount)).toBe(1);
    });

    test('3 resyncs → danger status', async () => {
      tracker.setConnectionQuality(true, 50, 0);
      tracker.onChanges({ incremental: false, resync: false } as never);
      tracker.onChanges({ incremental: true, resync: true } as never);
      tracker.onChanges({ incremental: true, resync: true } as never);
      tracker.onChanges({ incremental: true, resync: true } as never);
      expect(await firstValueFrom(tracker.status$)).toBe('danger');
    });
  });

  describe('clear()', () => {
    test('resets all state to disconnected/empty defaults', async () => {
      tracker.setConnectionQuality(true, 200, 2);
      tracker.onChanges({ incremental: false, resync: false } as never);
      tracker.onChanges({ incremental: true, resync: true } as never);

      tracker.clear();

      expect(await firstValueFrom(tracker.isConnected$)).toBe(false);
      expect(await firstValueFrom(tracker.rttAverage$)).toBeNull();
      expect(await firstValueFrom(tracker.reconnectCount$)).toBe(0);
      expect(await firstValueFrom(tracker.status$)).toBe('danger');
    });
  });
});
