import { useEffect } from 'react';
import Home from './Home';

/**
 * Wrapper component for the '/' route:
 * - In Vite dev mode (port 5000): Renders the Home component normally
 * - In the production/test deploy: Does a real browser navigation to '/' so
 *   Caddy serves the static landing page rather than the SPA
 */
function RootRedirect() {
  const isViteDevMode = window.location.port === '5000';

  useEffect(() => {
    if (!isViteDevMode) {
      window.location.href = '/';
    }
  }, [isViteDevMode]);

  return isViteDevMode ? <Home /> : null;
}

export default RootRedirect;
