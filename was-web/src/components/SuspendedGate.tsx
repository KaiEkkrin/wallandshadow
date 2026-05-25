import { lazy, useContext, type ReactNode } from 'react';

import { UserContext } from './UserContext';

// Lazy so the Suspended page stays out of the main bundle. SuspendedGate is
// rendered inside App's <Suspense> boundary, which covers this load.
const Suspended = lazy(() => import('../Suspended'));

// When the account is suspended (banned), render the Suspended page in place of
// the normal routes — regardless of the current path, and without redirecting
// the user back through login.
function SuspendedGate({ children }: { children: ReactNode }) {
  const { suspended } = useContext(UserContext);
  if (suspended) return <Suspended />;
  return <>{children}</>;
}

export default SuspendedGate;
