import { Changes } from '@wallandshadow/shared';

import dayjs from 'dayjs';
import { BehaviorSubject, Observable } from 'rxjs';

import {
  QUALITY_WINDOW_MS,
  RTT_DANGER_MS,
  RTT_WARNING_MS,
  RECONNECT_DANGER_COUNT,
  RECONNECT_WARNING_COUNT,
  RESYNC_DANGER_COUNT,
  RESYNC_WARNING_COUNT,
} from './networkQualityConstants';

export type NetworkStatus = 'success' | 'warning' | 'danger' | 'pending';

// Helps watch network conditions and emit a report.
export class NetworkStatusTracker {
  private readonly _resyncCount = new BehaviorSubject<number>(0);
  private readonly _status$ = new BehaviorSubject<NetworkStatus>('pending');
  private readonly _isConnected$ = new BehaviorSubject<boolean>(false);
  private readonly _rttAverage$ = new BehaviorSubject<number | null>(null);
  private readonly _reconnectCount$ = new BehaviorSubject<number>(0);

  private _seenBaseChange = false;
  private _resyncs: dayjs.Dayjs[] = [];
  // True until we receive the first RTT measurement or exitPending() is called.
  // The indicator stays grey while pending so the user never sees a spurious red
  // "Disconnected" flash during initial WebSocket setup.
  private _isPending = true;

  get resyncCount(): Observable<number> { return this._resyncCount; }
  get status$(): Observable<NetworkStatus> { return this._status$; }
  get isConnected$(): Observable<boolean> { return this._isConnected$; }
  get rttAverage$(): Observable<number | null> { return this._rttAverage$; }
  get reconnectCount$(): Observable<number> { return this._reconnectCount$; }

  clear() {
    // Only reset the map-specific resync tracking. Connection quality state
    // (_isConnected$, _rttAverage$, _reconnectCount$) is managed exclusively by
    // setConnectionQuality/HonoContextProvider. Resetting it here would clobber the
    // live WebSocket state and cause a spurious 'danger' flash until the next ping.
    this._seenBaseChange = false;
    this._resyncs = [];
    this._emit(this._resyncCount, 0);
    this._emitStatus(0);
  }

  /** Called by HonoContextProvider whenever WebSocket quality data changes. */
  setConnectionQuality(connected: boolean, rtt: number | null, reconnects: number) {
    if (rtt !== null) this._isPending = false;
    this._emit(this._isConnected$, connected);
    this._emit(this._rttAverage$, rtt);
    this._emit(this._reconnectCount$, reconnects);
    this._emitStatus(this._pruneAndCount());
  }

  /** Called by HonoContextProvider when the first-ping timeout has elapsed,
   *  forcing the indicator out of the grey "Getting ready…" state. */
  exitPending() {
    if (!this._isPending) return;
    this._isPending = false;
    this._emitStatus(this._pruneAndCount());
  }

  onChanges(changes: Changes) {
    if (changes.resync === true && this._seenBaseChange === true) {
      this._resyncs.push(dayjs());
    }
    if (changes.incremental === false) {
      this._seenBaseChange = true;
    }
    const resyncCount = this._pruneAndCount();
    this._emit(this._resyncCount, resyncCount);
    this._emitStatus(resyncCount);
  }

  private _pruneAndCount(): number {
    const now = dayjs();
    this._resyncs = this._resyncs.filter(r => now.diff(r, 'millisecond') <= QUALITY_WINDOW_MS);
    return this._resyncs.length;
  }

  private _emit<T>(subject: BehaviorSubject<T>, value: T): void {
    if (subject.getValue() !== value) subject.next(value);
  }

  private _emitStatus(resyncCount: number): void {
    const next = this._computeStatus(resyncCount);
    if (this._status$.getValue() !== next) this._status$.next(next);
  }

  private _computeStatus(resyncCount: number): NetworkStatus {
    if (this._isPending) return 'pending';
    const connected = this._isConnected$.getValue();
    const rttAvg = this._rttAverage$.getValue();
    const reconnects = this._reconnectCount$.getValue();
    if (!connected) return 'danger';
    if (
      (rttAvg !== null && rttAvg > RTT_DANGER_MS) ||
      reconnects >= RECONNECT_DANGER_COUNT ||
      resyncCount >= RESYNC_DANGER_COUNT
    ) return 'danger';
    if (
      (rttAvg !== null && rttAvg > RTT_WARNING_MS) ||
      reconnects >= RECONNECT_WARNING_COUNT ||
      resyncCount >= RESYNC_WARNING_COUNT
    ) return 'warning';
    return 'success';
  }
}

export const networkStatusTracker = new NetworkStatusTracker();
