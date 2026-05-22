import { useEffect, useMemo, useState } from 'react';
import { combineLatest, debounceTime, delay, filter, merge, take, timer } from 'rxjs';

import { AuthContext } from './AuthContext';
import { UserContext } from './UserContext';
import { IContextProviderProps, IUserContext } from './interfaces';

import { HonoApiClient } from '../services/honoApiClient';
import { HonoApi } from '../services/honoApi';
import { HonoAuth } from '../services/honoAuth';
import { HonoLiveData } from '../services/honoLiveData';
import { createResolveImageUrl } from '../services/resolveImageUrl';
import { networkStatusTracker } from '../models/networkStatusTracker';
import { PENDING_EXIT_FALLBACK_MS, RTT_DANGER_MS } from '../models/networkQualityConstants';

function HonoContextProvider(props: IContextProviderProps) {
  const apiClient = useMemo(() => {
    const baseUrl = import.meta.env.VITE_HONO_URL ?? '';
    return new HonoApiClient(baseUrl);
  }, []);

  const auth = useMemo(() => new HonoAuth(apiClient), [apiClient]);
  const api = useMemo(() => new HonoApi(apiClient), [apiClient]);
  const resolveImageUrl = useMemo(() => createResolveImageUrl(api), [api]);
  const [userContext, setUserContext] = useState<IUserContext>({ user: undefined });

  useEffect(() => {
    let currentLive: HonoLiveData | undefined;

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
      currentLive?.dispose();
      if (user) {
        currentLive = new HonoLiveData(apiClient, onAuthFailure);
        const live = currentLive;
        // Feed WebSocket quality data into networkStatusTracker so both the
        // map view and adventure view can read it from the tracker singleton.
        const qualitySub = combineLatest([
          live.isConnected$,
          live.rtt$,
          live.reconnectCount$,
        ]).pipe(debounceTime(0)).subscribe(([connected, rtt, reconnects]) => {
          networkStatusTracker.setConnectionQuality(connected, rtt, reconnects);
        });

        // Exit the "Getting ready…" pending state via whichever fires first:
        //   — RTT_DANGER_MS after first connection (covers "pong still in flight")
        //   — PENDING_EXIT_FALLBACK_MS overall (covers "WebSocket never connects")
        const pendingExitSub = merge(
          live.isConnected$.pipe(filter((v): v is true => v), take(1), delay(RTT_DANGER_MS)),
          timer(PENDING_EXIT_FALLBACK_MS),
        ).pipe(take(1)).subscribe(() => networkStatusTracker.exitPending());

        qualityUnsub = () => {
          qualitySub.unsubscribe();
          pendingExitSub.unsubscribe();
        };
        setUserContext({
          user,
          api,
          live,
          resolveImageUrl,
          forceReconnect: () => live.forceReconnect(),
        });
      } else {
        currentLive = undefined;
        // auth.suspended distinguishes a banned account from a plain logout —
        // SuspendedGate routes the former to the Suspended page.
        setUserContext({ user: null, suspended: auth.suspended });
      }
    }, e => console.error('Authentication state error:', e));

    return () => {
      qualityUnsub?.();
      unsub();
      currentLive?.dispose();
    };
  }, [api, auth, apiClient, resolveImageUrl]);

  return (
    <AuthContext.Provider value={{ auth }}>
      <UserContext.Provider value={userContext}>
        {props.children}
      </UserContext.Provider>
    </AuthContext.Provider>
  );
}

export default HonoContextProvider;
