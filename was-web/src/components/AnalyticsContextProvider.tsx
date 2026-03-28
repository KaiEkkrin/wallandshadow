import { useContext, useEffect, useState, useMemo, useCallback } from 'react';

import { FirebaseContext } from './FirebaseContext';
import { AnalyticsContext } from './AnalyticsContext';
import { IAnalyticsProps, IContextProviderProps } from './interfaces';
import { IAnalytics } from '../services/interfaces';

const enabledKey = "analyticsEnabled";

function getExMessage(e: unknown): string {
  if (typeof(e) === 'string') {
    return e;
  } else if (e instanceof Error) {
    return e.message;
  } else {
    return String(e);
  }
}

// This provides a context for Google Analytics -- whether it is enabled, the interface
// to use it through, etc.
// The enabled setting is stored not in the user profile but in local storage.
export function AnalyticsContextProvider({ children, getItem, setItem }: IContextProviderProps & IAnalyticsProps) {
  const { createAnalytics } = useContext(FirebaseContext);

  // Resolve our storage functions
  const doGetItem = useCallback(
    (key: string) => getItem?.(key) ?? localStorage.getItem(key),
    [getItem]
  );

  const doSetItem = useCallback(
    (key: string, value: string | null) => {
      if (setItem !== undefined) {
        setItem(key, value);
      } else if (value !== null) {
        localStorage.setItem(key, value);
      } else {
        localStorage.removeItem(key);
      }
    }, [setItem]
  );

  const [enabled, setEnabled] = useState<boolean | undefined>(undefined);
  const [analytics, setAnalytics] = useState<IAnalytics | undefined>(undefined);
  const analyticsContext = useMemo(() => ({
    analytics: enabled ? analytics : undefined,
    enabled: enabled,
    setEnabled: setEnabled,
    logError: (message: string, e: unknown, fatal?: boolean | undefined) => {
      console.error("Analytics error:", message, e);
      if (enabled) {
        console.info("logging to analytics with error: " + getExMessage(e));
        analytics?.logEvent("exception", {
          "exDescription": message,
          "exMessage": getExMessage(e),
          "exFatal": fatal !== false
        });
      }
    },
    logEvent: (event: string, parameters: Record<string, unknown>) => {
      if (enabled) {
        analytics?.logEvent(event, parameters);
      }
    }
  }), [analytics, enabled, setEnabled]);

  // On load, fetch any current enabled value from local storage
  useEffect(() => {
    const isEnabled = doGetItem(enabledKey);
    if (isEnabled !== null) {
      setEnabled(/true/i.test(isEnabled));
    }
  }, [doGetItem, setEnabled]);

  // When the setting is changed, save its value back to local storage
  useEffect(() => {
    if (enabled === true) {
      // User chose to enable GA
      console.info("Enabling Google Analytics");
      setAnalytics(createAnalytics?.());
      doSetItem(enabledKey, "true");
    } else if (enabled === false) {
      // User chose to disable GA
      console.info("Disabling Google Analytics");
      setAnalytics(undefined);
      doSetItem(enabledKey, "false");
    } else {
      // User hasn't chosen yet (default to disabled)
      console.info("Disabling Google Analytics by default");
      setAnalytics(undefined);
      doSetItem(enabledKey, null);
    }
  }, [enabled, createAnalytics, setAnalytics, doSetItem]);

  return (
    <AnalyticsContext.Provider value={analyticsContext}>
      {children}
    </AnalyticsContext.Provider>
  );
}