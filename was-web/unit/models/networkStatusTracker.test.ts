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

  describe('pending state', () => {
    test('initial state before any quality data → pending', async () => {
      expect(await firstValueFrom(tracker.status$)).toBe('pending');
    });

    test('setConnectionQuality with null RTT stays pending', async () => {
      tracker.setConnectionQuality(false, null, 0);
      expect(await firstValueFrom(tracker.status$)).toBe('pending');
    });

    test('connected with null RTT also stays pending', async () => {
      tracker.setConnectionQuality(true, null, 0);
      expect(await firstValueFrom(tracker.status$)).toBe('pending');
    });

    test('setConnectionQuality with non-null RTT exits pending', async () => {
      tracker.setConnectionQuality(true, 50, 0);
      expect(await firstValueFrom(tracker.status$)).toBe('success');
    });

    test('exitPending() with no connection shows danger', async () => {
      tracker.exitPending();
      expect(await firstValueFrom(tracker.status$)).toBe('danger');
    });

    test('exitPending() when connected with null RTT shows success', async () => {
      tracker.setConnectionQuality(true, null, 0);
      tracker.exitPending();
      expect(await firstValueFrom(tracker.status$)).toBe('success');
    });

    test('exitPending() is idempotent', async () => {
      tracker.setConnectionQuality(true, 50, 0); // exits pending naturally
      tracker.exitPending();                      // no-op
      expect(await firstValueFrom(tracker.status$)).toBe('success');
    });
  });

  describe('status$ composite colour', () => {
    test('disconnected (after having measurements) → danger', async () => {
      tracker.setConnectionQuality(true, 50, 0);  // exits pending
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

    test('RTT above 800 ms → caution', async () => {
      tracker.setConnectionQuality(true, 900, 0);
      expect(await firstValueFrom(tracker.status$)).toBe('caution');
    });

    test('1 reconnection → warning', async () => {
      tracker.setConnectionQuality(true, 10, 1);
      expect(await firstValueFrom(tracker.status$)).toBe('warning');
    });

    test('3 reconnections → caution', async () => {
      tracker.setConnectionQuality(true, 10, 3);
      expect(await firstValueFrom(tracker.status$)).toBe('caution');
    });

    test('null RTT does not degrade status once out of pending', async () => {
      tracker.exitPending();
      tracker.setConnectionQuality(true, null, 0);
      expect(await firstValueFrom(tracker.status$)).toBe('success');
    });

    test('worst-of: good RTT but high reconnects → caution', async () => {
      tracker.setConnectionQuality(true, 50, 3);
      expect(await firstValueFrom(tracker.status$)).toBe('caution');
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

    test('3 resyncs → warning (resyncs never exceed warning)', async () => {
      tracker.setConnectionQuality(true, 50, 0);  // exits pending
      tracker.onChanges({ incremental: false, resync: false } as never);
      tracker.onChanges({ incremental: true, resync: true } as never);
      tracker.onChanges({ incremental: true, resync: true } as never);
      tracker.onChanges({ incremental: true, resync: true } as never);
      expect(await firstValueFrom(tracker.status$)).toBe('warning');
    });

    test('many resyncs cap at warning, never reach caution', async () => {
      tracker.setConnectionQuality(true, 50, 0);  // exits pending
      tracker.onChanges({ incremental: false, resync: false } as never);
      for (let i = 0; i < 10; i++) {
        tracker.onChanges({ incremental: true, resync: true } as never);
      }
      expect(await firstValueFrom(tracker.status$)).toBe('warning');
    });
  });

  describe('clear()', () => {
    test('resets only the map-specific resync state, leaving connection quality intact', async () => {
      tracker.setConnectionQuality(true, 200, 2);
      tracker.onChanges({ incremental: false, resync: false } as never);
      tracker.onChanges({ incremental: true, resync: true } as never);
      expect(await firstValueFrom(tracker.resyncCount)).toBe(1);

      tracker.clear();

      // Connection quality is unchanged — clear() must not clobber live WS state.
      expect(await firstValueFrom(tracker.isConnected$)).toBe(true);
      expect(await firstValueFrom(tracker.rttAverage$)).toBe(200);
      expect(await firstValueFrom(tracker.reconnectCount$)).toBe(2);
      // Resync count is reset.
      expect(await firstValueFrom(tracker.resyncCount)).toBe(0);
      // Status re-computed from unchanged quality: connected, rtt=200, reconnects=2 → warning.
      expect(await firstValueFrom(tracker.status$)).toBe('warning');
    });

    test('does not reset pending — remains non-pending after clear', async () => {
      tracker.setConnectionQuality(true, 200, 2);  // exits pending via non-null RTT
      tracker.clear();
      // Quality state preserved; still non-pending.
      expect(await firstValueFrom(tracker.status$)).toBe('warning');
    });
  });
});
