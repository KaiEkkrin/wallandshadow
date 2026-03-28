import { Changes } from '../data/change';

import dayjs from 'dayjs';
import { Observable, Subject } from 'rxjs';

const retentionMillis = 1000 * 60 * 5; // last 5 minutes' worth

// Helps watch network conditions and emit a report.
class NetworkStatusTracker {
  private readonly _resyncCount = new Subject<number>();

  // True if we've seen the first base change (which might be a resync -- that wouldn't count),
  // else false.
  private _seenBaseChange = false;

  // Resync timestamps
  private _resyncs: dayjs.Dayjs[] = [];

  get resyncCount(): Observable<number> { return this._resyncCount; }

  clear() {
    this._seenBaseChange = false;
    this._resyncs = [];
  }

  // Call this with any applicable changes and we'll measure the apparent latency
  // and add it to our readings.
  onChanges(changes: Changes) {
    const now = dayjs();
    this._resyncs = this._resyncs.filter(r => now.diff(r, 'millisecond') <= retentionMillis);
    if (changes.resync === true && this._seenBaseChange === true) {
      this._resyncs.push(now);
    }

    if (changes.incremental === false) {
      this._seenBaseChange = true;
    }

    this._resyncCount.next(this._resyncs.length);
  }
}

export const networkStatusTracker = new NetworkStatusTracker();