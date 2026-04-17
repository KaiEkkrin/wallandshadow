import { useContext, useEffect, useRef } from 'react';

import { UserContext } from './UserContext';

// Session storage key to prevent infinite reload loops
const RELOAD_ATTEMPTED_KEY = 'version_reload_attempted';

/**
 * Checks if we're running in a local development environment.
 */
function isLocalDev(): boolean {
  const hostname = window.location.hostname;
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

/**
 * Silently watches for new app versions via the data service and triggers
 * automatic reload when the deployed commit changes.
 *
 * The component renders nothing - it's purely for side effects.
 */
function VersionChecker() {
  const { dataService } = useContext(UserContext);
  const initialVersionRef = useRef<string | null>(null);

  useEffect(() => {
    // Skip in development environment
    if (isLocalDev()) {
      console.info('[VersionChecker] Skipping in development environment');
      return;
    }

    // Wait for dataService to be available (requires authenticated user)
    if (!dataService) {
      return;
    }

    const versionRef = dataService.getVersionRef();
    const unsubscribe = dataService.watch(
      versionRef,
      (data) => {
        if (!data?.commit) {
          return;
        }

        if (initialVersionRef.current === null) {
          // First load - store the version
          initialVersionRef.current = data.commit;
          console.info('[VersionChecker] Monitoring version:', data.commit);
        } else if (data.commit !== initialVersionRef.current) {
          // Version changed - check for reload loop
          const lastAttempt = sessionStorage.getItem(RELOAD_ATTEMPTED_KEY);
          if (lastAttempt === data.commit) {
            console.warn(
              '[VersionChecker] Reload already attempted for version:',
              data.commit,
              '- skipping to prevent loop'
            );
            return;
          }

          console.info(
            '[VersionChecker] New version detected:',
            data.commit,
            '(was:',
            initialVersionRef.current,
            ')'
          );
          sessionStorage.setItem(RELOAD_ATTEMPTED_KEY, data.commit);
          window.location.reload();
        }
      },
      (error) => {
        console.error('[VersionChecker] Error watching version document:', error);
      }
    );

    return unsubscribe;
  }, [dataService]);

  // This component renders nothing
  return null;
}

export default VersionChecker;
