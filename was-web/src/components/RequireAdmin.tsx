import { useContext, useEffect, useState, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';

import { UserLevel } from '@wallandshadow/shared';

import { UserContext } from './UserContext';
import Throbber from './Throbber';
import { logError } from '../services/consoleLogger';

// Route guard for the /admin pages. The admin check is an authoritative
// one-shot api.getMe() call rather than the live `profile` (which can stall
// indefinitely if its WebSocket subscription never delivers). getMe() always
// settles, so the guard never dead-ends on a throbber. It fails closed: any
// getMe() failure redirects to /app.
function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, api } = useContext(UserContext);
  const [level, setLevel] = useState<UserLevel | 'error' | undefined>(undefined);

  useEffect(() => {
    if (user === undefined || user === null || api === undefined) return;
    let cancelled = false;
    setLevel(undefined);
    api.getMe()
      .then((me) => { if (!cancelled) setLevel(me.level); })
      .catch((err) => {
        logError('RequireAdmin: getMe failed', err);
        if (!cancelled) setLevel('error');
      });
    return () => { cancelled = true; };
  }, [user, api]);

  // Session still resolving.
  if (user === undefined) return <Throbber />;
  // Not signed in.
  if (user === null) return <Navigate to="/login" replace />;
  // getMe() still in flight.
  if (level === undefined) return <Throbber />;
  // Not an admin, or getMe() failed — fail closed.
  if (level !== UserLevel.Admin) return <Navigate to="/app" replace />;
  return <>{children}</>;
}

export default RequireAdmin;
