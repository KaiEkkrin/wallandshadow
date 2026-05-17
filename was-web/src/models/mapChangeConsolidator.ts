import { Changes, IApi, ILiveData } from '@wallandshadow/shared';

import { interval, Subject } from 'rxjs';
import { throttle } from 'rxjs/operators';

// Watches map changes and automatically consolidates at a suitable interval.
export function watchChangesAndConsolidate(
  live: ILiveData | undefined,
  api: IApi | undefined,
  adventureId: string,
  mapId: string,
  onNext: (chs: Changes) => boolean, // applies changes and returns true if successful, else false
  onReset: () => void, // reset the map state to blank (expect an onNext() right after)
  onError?: ((message: string, ...params: unknown[]) => void) | undefined,
  resyncIntervalMillis?: number | undefined
) {
  if (live === undefined || api === undefined) {
    return undefined;
  }

  // This creates the changes interval that non-resync consolidates are done on.
  function createConsolidateInterval() {
    // We want to consolidate before 500 incremental changes (so it can all
    // be done in one transaction), and randomly, so that clients don't all
    // try to consolidate at once
    const i = Math.floor(100 + Math.random() * 350);
    console.debug("next consolidate after " + i + " changes");
    return i;
  }

  let changesBeforeConsolidate = createConsolidateInterval();

  // This mechanism should throttle resync calls to at most the given time interval.
  const resyncSubject = new Subject<void>();
  const resyncSub = resyncSubject.pipe(throttle(() => interval(resyncIntervalMillis ?? 5000)))
    .subscribe(() => {
      console.debug("lost sync -- trying to consolidate");
      changesBeforeConsolidate = createConsolidateInterval();
      api.consolidateMap(adventureId, mapId, true)
        .catch(e => onError?.("Consolidate call failed", e));
    });

  let seenBaseChange = false;
  const stopWatching = live.watchMapChanges(
    mapId,
    (chs: Changes) => {
      // If this isn't a resync and we've seen the base change already, we can
      // safely skip this; there shouldn't be any new information
      if (chs.incremental === false && chs.resync === false && seenBaseChange === true) {
        console.debug("skipping non-resync base change");
        return;
      }

      if (chs.incremental === false) {
        // This is a first base change or a resync.  Reset the map state before this one
        console.debug("accepting base change");
        onReset();
        seenBaseChange = true;
      }

      if (onNext(chs) === false) {
        if (chs.incremental === false) {
          // An invalid base change is fatal.
          onError?.("Invalid base change -- map corrupt");
          throw Error("Invalid base change -- map corrupt");
        }

        // An invalid incremental change suggests we might be confused; trigger a resync.
        resyncSubject.next();
      } else if (--changesBeforeConsolidate <= 0) {
        // Issue regular consolidate on interval to reduce the number of in-flight changes
        // users opening the map have to handle
        console.debug("consolidating map changes upon counted interval");
        changesBeforeConsolidate = createConsolidateInterval();
        api.consolidateMap(adventureId, mapId, false)
          .catch(e => onError?.("Consolidate call failed", e));
      }
    },
    (e: Error) => onError?.("Watch changes failed for map " + mapId, e),
    () => { seenBaseChange = false; }  // reset on full-reload so base change is re-applied
  );

  return () => {
    stopWatching();
    resyncSub.unsubscribe();
  }
}
