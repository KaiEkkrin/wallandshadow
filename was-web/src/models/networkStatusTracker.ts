import { Changes } from '@wallandshadow/shared';

import dayjs from 'dayjs';
import { BehaviorSubject, Observable } from 'rxjs';

const retentionMillis = 1000 * 60 * 5; // last 5 minutes' worth

export type NetworkStatus = 'success' | 'warning' | 'danger';

// Helps watch network conditions and emit a report.
export class NetworkStatusTracker {
  private readonly _resyncCount = new BehaviorSubject<number>(0);
  private readonly _status$ = new BehaviorSubject<NetworkStatus>('success');
  private readonly _isConnected$ = new BehaviorSubject<boolean>(false);
  private readonly _rttAverage$ = new BehaviorSubject<number | null>(null);
  private readonly _reconnectCount$ = new BehaviorSubject<number>(0);

  private _seenBaseChange = false;
  private _resyncs: dayjs.Dayjs[] = [];

  get resyncCount(): Observable<number> { return this._resyncCount; }
  get status$(): Observable<NetworkStatus> { return this._status$; }
  get isConnected$(): Observable<boolean> { return this._isConnected$; }
  get rttAverage$(): Observable<number | null> { return this._rttAverage$; }
  get reconnectCount$(): Observable<number> { return this._reconnectCount$; }

  clear() {
    this._seenBaseChange = false;
    this._resyncs = [];
    this._emit(this._isConnected$, false);
    this._emit(this._rttAverage$, null);
    this._emit(this._reconnectCount$, 0);
    this._emit(this._resyncCount, 0);
    this._emitStatus(0);
  }

  /** Called by HonoContextProvider whenever WebSocket quality data changes. */
  setConnectionQuality(connected: boolean, rtt: number | null, reconnects: number) {
    this._emit(this._isConnected$, connected);
    this._emit(this._rttAverage$, rtt);
    this._emit(this._reconnectCount$, reconnects);
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
    this._resyncs = this._resyncs.filter(r => now.diff(r, 'millisecond') <= retentionMillis);
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
    const connected = this._isConnected$.getValue();
    const rttAvg = this._rttAverage$.getValue();
    const reconnects = this._reconnectCount$.getValue();
    if (!connected) return 'danger';
    if (
      (rttAvg !== null && rttAvg > 800) ||
      reconnects >= 3 ||
      resyncCount >= 3
    ) return 'danger';
    if (
      (rttAvg !== null && rttAvg > 300) ||
      reconnects >= 1 ||
      resyncCount >= 1
    ) return 'warning';
    return 'success';
  }
}

export const networkStatusTracker = new NetworkStatusTracker();
