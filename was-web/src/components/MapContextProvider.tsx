import { useEffect, useState, useContext, useReducer } from 'react';

import { trackChanges } from '../data/changeTracking';
import { IAdventureIdentified } from '../data/identified';
import { IMap } from '../data/map';
import { MapLifecycleManager } from '../models/mapLifecycleManager';
import { createDefaultState, MapStateMachine } from '../models/mapStateMachine';
import { networkStatusTracker } from '../models/networkStatusTracker';
import { registerMapAsRecent, removeMapFromRecent, watchChangesAndConsolidate } from '../services/extensions';

import { AdventureContext } from './AdventureContext';
import { AnalyticsContext } from './AnalyticsContext';
import { MapContext } from './MapContext';
import { IContextProviderProps, IMapContext } from './interfaces';
import { ProfileContext } from './ProfileContext';
import { StatusContext } from './StatusContext';
import { UserContext } from './UserContext';

import { useNavigate, useLocation } from 'react-router-dom';
import { from, Observable } from 'rxjs';
import { first, map, scan, share, switchMap } from 'rxjs/operators';
import { v7 as uuidv7 } from 'uuid';

function MapContextProvider(props: IContextProviderProps) {
  const { analytics, logError, logEvent } = useContext(AnalyticsContext);
  const { dataService, functionsService, resolveImageUrl, user } = useContext(UserContext);
  const { profile } = useContext(ProfileContext);
  const { toasts } = useContext(StatusContext);
  const { spriteManager } = useContext(AdventureContext);

  const navigate = useNavigate();
  const location = useLocation();

  // We need to re-create the map lifecycle manager only when the user login changes
  // (I expect this will still leak resources but it'll be rare)
  const [lcm, setLcm] = useReducer(
    (state: MapLifecycleManager | undefined, action: MapLifecycleManager | undefined) => {
      state?.dispose();
      return action;
    }, undefined
  );

  useEffect(() => {
    const uid = user?.uid;
    if (!dataService || !functionsService || !resolveImageUrl || !uid) {
      setLcm(undefined);
      return;
    }

    setLcm(new MapLifecycleManager(dataService, functionsService, logError, resolveImageUrl, uid));
  }, [dataService, functionsService, logError, resolveImageUrl, user]);

  // Watch the map when it changes.
  // We'll try not to depend on `dataService` in here to avoid repeated calls
  const [mapContext, setMapContext] = useState<IMapContext>({ mapState: createDefaultState() });
  useEffect(() => {
    //console.debug('[MapContextProvider] useEffect running, pathname:', location?.pathname);
    const matches = /^\/adventure\/([^/]+)\/map\/([^/]+)$/.exec(location?.pathname);
    //console.debug('[MapContextProvider] regex matches:', matches ? 'YES' : 'NO');
    //console.debug('[MapContextProvider] lcm:', lcm ? 'DEFINED' : 'UNDEFINED');
    //console.debug('[MapContextProvider] profile:', profile ? 'DEFINED' : 'UNDEFINED');
    //console.debug('[MapContextProvider] spriteManager:', spriteManager ? 'DEFINED' : 'UNDEFINED');

    if (!lcm || !matches || !profile || !spriteManager) {
      //console.debug('[MapContextProvider] Early return - missing dependencies');
      return undefined;
    }

    const [adventureId, mapId] = [matches[1], matches[2]];
    console.debug('[MapContextProvider] Setting up map watch for:', adventureId, mapId);
    const mapRef = lcm.dataService.getMapRef(adventureId, mapId);

    // How to handle a map load failure.
    function couldNotLoad(message: string) {
      console.warn('[MapContextProvider] couldNotLoad called with message:', message);
      if (lcm && mapRef) {
        removeMapFromRecent(lcm.dataService, lcm.uid, mapRef.id)
          .catch(e => logError("Error removing map from recent", e));
      }

      toasts.next({
        id: uuidv7(),
        record: { title: 'Error loading map', message: message }
      });

      console.warn('[MapContextProvider] Navigating back to home due to error');
      navigate('/app', { replace: true });
    }

    // We're going to do several things with this.
    // To properly stop a published observable we need to smuggle out the
    // underlying stop function
    let stopWatchingMap: (() => void) | undefined = undefined;
    const watchMap = new Observable<IAdventureIdentified<IMap>>(sub => {
      stopWatchingMap = lcm.dataService.watch(
        mapRef,
        m => {
          if (m === undefined) {
            sub.error("That map does not exist.");
          } else {
            analytics?.logEvent("select_content", {
              "content_type": "map",
              "item_id": mapId
            });
            sub.next({ adventureId: adventureId, id: mapId, record: m });
          }
        },
        e => sub.error(e),
        () => sub.complete()
      );
      return stopWatchingMap;
    }).pipe(share());

    // On first load, register the map as recent, and fire a consolidate.
    // Neither of these is fatal if it goes wrong
    const registerAsRecentSub = watchMap.pipe(first(), switchMap(m =>
      from(registerMapAsRecent(lcm.dataService, lcm.uid, m.adventureId, m.id, m.record))
    )).subscribe(
      () => {},
      e => logError(`Error registering map ${adventureId}/${mapId} as recent`, e)
    );

    const consolidateSub = watchMap.pipe(first(), switchMap(m =>
      from((async () => {
        console.debug(`consolidating map changes for ${m.adventureId}/${m.id}`);
        await lcm.functionsService?.consolidateMapChanges(m.adventureId, m.id, false);
      })())
    )).subscribe(
      () => {},
      e => logError(`Error consolidating map ${adventureId}/${mapId} changes`, e)
    );

    // Provide the map state machine, updating its state as the map changes.
    // We update the map context all in one go like this to avoid transient states
    // (map field pointing to a different one to the state machine for example) which
    // might cause subscribers to double-execute operations.
    const watchSub = watchMap.pipe(switchMap(m => new Observable<MapStateMachine>(sub => {
      const sm = lcm.getStateMachine(m, profile, spriteManager);

      networkStatusTracker.clear();
      const stop = watchChangesAndConsolidate(
        lcm.dataService,
        lcm.functionsService,
        m.adventureId,
        m.id,
        chs => {
          networkStatusTracker.onChanges(chs);
          return trackChanges(m.record, sm.changeTracker, chs.chs, chs.user);
        },
        () => sm.changeTracker.clear(),
        logEvent,
        e => logError("Error watching map changes", e)
      );

      sub.next(sm);
      return stop;
    })), scan((oldSm, newSm) => {
      // When we get a new state machine, unmount the old one (the map component will
      // mount the new one if it has a mount point.)
      if (oldSm !== newSm) {
        oldSm.setMount(undefined);
      }
      return newSm;
    }), switchMap(sm => sm.state.pipe(map(st => ({
      map: sm.map, mapState: st, stateMachine: sm
    }))))).subscribe(
      setMapContext,
      e => {
        logError(`Error watching changes of map ${adventureId}/${mapId}`, e);
        couldNotLoad(String(e?.message));
      }
    );

    return () => {
      watchSub.unsubscribe();
      consolidateSub.unsubscribe();
      registerAsRecentSub.unsubscribe();
      stopWatchingMap?.();
    };
  }, [
    analytics, navigate, lcm, location, logError, logEvent,
    profile, setMapContext, spriteManager, toasts
  ]);

  return (
    <MapContext.Provider value={mapContext}>
      {props.children}
    </MapContext.Provider>
  );
}

export default MapContextProvider;