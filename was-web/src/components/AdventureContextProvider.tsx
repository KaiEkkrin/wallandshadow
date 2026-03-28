import { useEffect, useMemo, useState, useContext, useReducer } from 'react';

import { UserContext } from './UserContext';
import { AnalyticsContext } from './AnalyticsContext';
import { AdventureContext } from './AdventureContext';
import { IAdventureContext, IContextProviderProps } from './interfaces';
import { StatusContext } from './StatusContext';

import { IAdventure, IPlayer } from '../data/adventure';
import { IIdentified } from '../data/identified';
import { registerAdventureAsRecent, removeAdventureFromRecent } from '../services/extensions';
import { ISpriteManager } from '../services/interfaces';
import { SpriteManager } from '../services/spriteManager';

import { useNavigate, useLocation } from 'react-router-dom';
import { Observable } from 'rxjs';
import { shareReplay } from 'rxjs/operators';
import { v7 as uuidv7 } from 'uuid';

function AdventureContextProvider(props: IContextProviderProps) {
  const { dataService, resolveImageUrl, user } = useContext(UserContext);
  const { analytics, logError } = useContext(AnalyticsContext);
  const { toasts } = useContext(StatusContext);

  const navigate = useNavigate();
  const location = useLocation();

  const adventureId = useMemo(() => {
    const matches = /^\/adventure\/([^/]+)/.exec(location?.pathname);
    return matches ? matches[1] : undefined;
  }, [location]);

  const [adventure, setAdventure] = useState<IIdentified<IAdventure> | undefined>(undefined);
  useEffect(() => {
    const uid = user?.uid;
    if (uid === undefined || adventureId === undefined) {
      return undefined;
    }

    const d = dataService?.getAdventureRef(adventureId);
    const playerRef = dataService?.getPlayerRef(adventureId, uid);
    if (d === undefined || playerRef === undefined) {
      return undefined;
    }

    function couldNotLoad(message: string) {
      if (uid && d) {
        removeAdventureFromRecent(dataService, uid, d.id)
          .catch(e => logError("Error removing adventure from recent", e));
      }

      toasts.next({
        id: uuidv7(),
        record: { title: 'Error loading adventure', message: message }
      });

      navigate('/app', { replace: true });
    }

    // Check this adventure exists and can be fetched (the watch doesn't do this for us)
    // We do this by checking for the player record because that also allows us to check if
    // we're blocked; being blocked necessarily doesn't stop us from getting the adventure
    // from the db (only the maps), but showing it to the user in that state would *not*
    // be a helpful thing to do
    dataService?.get(playerRef)
      .then(r => {
        // Deliberately try not to show the player the difference between the adventure being
        // deleted and the player being blocked!  Might avoid a confrontation...
        if (r === undefined || r?.allowed === false) {
          couldNotLoad("That adventure does not exist.");
        }
      })
      .catch(e => {
        logError("Error checking for adventure " + adventureId + ": ", e);
        couldNotLoad(e.message);
      });

    analytics?.logEvent("select_content", {
      "content_type": "adventure",
      "item_id": adventureId
    });
    return dataService?.watch(d,
      a => setAdventure(a === undefined ? undefined : { id: adventureId, record: a }),
      e => logError("Error watching adventure " + adventureId + ": ", e));
  }, [adventureId, analytics, dataService, navigate, logError, toasts, user]);
  
  const [players, setPlayers] = useState<IPlayer[]>([]);

  // Old sprite managers need to be disposed, so we create them on a rolling basis
  // thus:
  const [spriteManager, setSpriteManager] = useReducer(
    (state: ISpriteManager | undefined, action: ISpriteManager | undefined) => {
      state?.dispose();
      return action;
    }, undefined
  );

  // Once we've got an adventure, watch its players, create the sprite manager, etc.
  useEffect(() => {
    const uid = user?.uid;
    if (
      dataService === undefined ||
      resolveImageUrl === undefined ||
      adventure === undefined ||
      uid === undefined
    ) {
      setSpriteManager(undefined);
      return undefined;
    }

    registerAdventureAsRecent(dataService, uid, adventure.id, adventure.record)
      .then(() => console.debug("registered adventure " + adventure.id + " as recent"))
      .catch(e => logError("Failed to register adventure " + adventure.id + " as recent", e));

    // We need the feed of players both so that we can expose it in the adventure context
    // and so that the sprite manager can use it, so we publish it thus:
    let unsub: (() => void) | undefined = undefined;
    const playerObs = new Observable<IPlayer[]>(sub => {
      unsub = dataService.watchPlayers(
        adventure.id,
        ps => sub.next(ps),
        e => {
          logError("Failed to watch players of adventure " + adventure.id, e);
          sub.error(e);
        },
        () => sub.complete()
      );
      return unsub;
    }).pipe(shareReplay(1));

    const playerSub = playerObs.subscribe(setPlayers);

    console.debug('creating sprite manager');
    setSpriteManager(new SpriteManager(dataService, resolveImageUrl, adventure.id, playerObs));
    return () => {
      playerSub.unsubscribe();
      unsub?.();
    }
  }, [adventure, dataService, logError, setPlayers, setSpriteManager, resolveImageUrl, user]);

  const adventureContext: IAdventureContext = useMemo(
    () => ({
      adventure: adventure,
      players: players,
      spriteManager: spriteManager
    }),
    [adventure, players, spriteManager]
  );

  return (
    <AdventureContext.Provider value={adventureContext}>
      {props.children}
    </AdventureContext.Provider>
  );
}

export default AdventureContextProvider;