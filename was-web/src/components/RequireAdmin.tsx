import { useContext, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';

import { UserLevel } from '@wallandshadow/shared';

import { ProfileContext } from './ProfileContext';
import { UserContext } from './UserContext';
import Throbber from './Throbber';

// Route guard for the /admin pages. Renders its children only for a signed-in
// admin; everyone else is redirected. While the session or profile is still
// resolving it shows a throbber rather than redirecting prematurely.
function RequireAdmin({ children }: { children: ReactNode }) {
  const { user } = useContext(UserContext);
  const { profile } = useContext(ProfileContext);

  // Still resolving the session, or the profile of a signed-in user.
  if (user === undefined || (user !== null && profile === undefined)) {
    return <Throbber />;
  }
  // Not signed in.
  if (user === null) {
    return <Navigate to="/login" replace />;
  }
  // Signed in but not an admin.
  if (profile?.level !== UserLevel.Admin) {
    return <Navigate to="/app" replace />;
  }
  return <>{children}</>;
}

export default RequireAdmin;
