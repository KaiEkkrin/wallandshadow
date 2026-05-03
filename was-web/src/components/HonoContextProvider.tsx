import { useEffect, useMemo, useState } from 'react';
import { combineLatest, debounceTime } from 'rxjs';

import { AuthContext } from './AuthContext';
import { UserContext } from './UserContext';
import { SignInMethodsContext } from './SignInMethodsContext';
import { IContextProviderProps, IUserContext } from './interfaces';

import { HonoApiClient } from '../services/honoApi';
import { HonoAuth } from '../services/honoAuth';
import { HonoDataService } from '../services/honoDataService';
import { HonoFunctionsService } from '../services/honoFunctions';
import { HonoStorage } from '../services/honoStorage';
import { createResolveImageUrl } from '../services/resolveImageUrl';
import { networkStatusTracker } from '../models/networkStatusTracker';

function HonoContextProvider(props: IContextProviderProps) {
  const apiClient = useMemo(() => {
    const baseUrl = import.meta.env.VITE_HONO_URL ?? '';
    return new HonoApiClient(baseUrl);
  }, []);

  const auth = useMemo(() => new HonoAuth(apiClient), [apiClient]);
  const [userContext, setUserContext] = useState<IUserContext>({ user: undefined });

  useEffect(() => {
    const storageService = new HonoStorage(apiClient);
    const resolveImageUrl = createResolveImageUrl(storageService);
    let currentDataService: HonoDataService | undefined;

    // Guard prevents multiple in-flight redirects if OIDC expiry and WS 4001
    // both fire in the same session.
    let authFailureRedirected = false;
    const onAuthFailure = () => {
      if (!authFailureRedirected) {
        authFailureRedirected = true;
        window.location.replace('/login');
      }
    };

    let qualityUnsub: (() => void) | null = null;

    const unsub = auth.onAuthStateChanged(user => {
      qualityUnsub?.();
      qualityUnsub = null;
      // Tear down the previous session's WebSocket before replacing context.
      currentDataService?.dispose();
      if (user) {
        currentDataService = new HonoDataService(apiClient, user.uid, onAuthFailure);
        // Feed WebSocket quality data into networkStatusTracker so both the
        // map view and adventure view can read it from the tracker singleton.
        const qualitySub = combineLatest([
          currentDataService.isConnected$,
          currentDataService.rtt$,
          currentDataService.reconnectCount$,
        ]).pipe(debounceTime(0)).subscribe(([connected, rtt, reconnects]) => {
          networkStatusTracker.setConnectionQuality(connected, rtt, reconnects);
        });
        qualityUnsub = () => qualitySub.unsubscribe();
        setUserContext({
          user,
          dataService: currentDataService,
          functionsService: new HonoFunctionsService(apiClient),
          storageService,
          resolveImageUrl,
          forceReconnect: () => currentDataService?.forceReconnect(),
        });
      } else {
        currentDataService = undefined;
        setUserContext({ user: null });
      }
    }, e => console.error('Authentication state error:', e));

    return () => {
      qualityUnsub?.();
      unsub();
      currentDataService?.dispose();
    };
  }, [auth, apiClient]);

  return (
    <AuthContext.Provider value={{ auth }}>
      <UserContext.Provider value={userContext}>
        <SignInMethodsContext.Provider value={{ signInMethods: auth.oidcEnabled ? ['password', 'oidc'] : ['password'] }}>
          {props.children}
        </SignInMethodsContext.Provider>
      </UserContext.Provider>
    </AuthContext.Provider>
  );
}

export default HonoContextProvider;
