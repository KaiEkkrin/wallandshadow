import { useEffect, useMemo, useState, useContext } from 'react';

import { IProfile } from '@wallandshadow/shared';

import { ProfileContext } from './ProfileContext';
import { UserContext } from './UserContext';
import { IContextProviderProps } from './interfaces';
import { logError } from '../services/consoleLogger';

// Subscribes to the current user's profile via the live data feed and exposes
// it through ProfileContext.
function ProfileContextProvider(props: IContextProviderProps) {
  const { live, user } = useContext(UserContext);
  const [profile, setProfile] = useState<IProfile | undefined>(undefined);

  useEffect(() => {
    if (live === undefined || user === undefined || user === null) {
      setProfile(undefined);
      return undefined;
    }

    return live.watchProfile(
      p => setProfile(p),
      e => logError("Failed to watch profile", e),
    );
  }, [live, user]);

  const profileContext = useMemo(
    () => ({ profile }),
    [profile]
  );

  return (
    <ProfileContext.Provider value={profileContext}>
      {props.children}
    </ProfileContext.Provider>
  );
}

export default ProfileContextProvider;