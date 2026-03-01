import { useCallback, useEffect, useMemo, useRef, useState, useContext } from 'react';

import { IProfile } from '../data/profile';

import { AnalyticsContext } from './AnalyticsContext';
import { ProfileContext } from './ProfileContext';
import { UserContext } from './UserContext';
import { IContextProviderProps } from './interfaces';
import { ensureProfile } from '../services/extensions';
import { IDataReference } from '../services/interfaces';

// This provides the profile context, and can be wrapped around individual components
// for unit testing.
function ProfileContextProvider(props: IContextProviderProps) {
  const { analytics, logError } = useContext(AnalyticsContext);
  const { dataService, user } = useContext(UserContext);
  const [profile, setProfile] = useState<IProfile | undefined>(undefined);

  // Because we don't get auth state changed notifications when the display name is
  // changed, the profile context provider (which ensures there is a profile) is stuck
  // in a race with the login component (which must create the display name *after*
  // creating the user, sadly).  To work around that, the login component shall submit
  // all new email+password users here (by email) along with their display names before
  // registering them.  The profile context provider can then pick this display name off
  // and add it to the profile.
  const [newUserDisplayNames] = useState(new Map<string, string>());
  const expectNewUser = useCallback((email: string, displayName: string) => {
    newUserDisplayNames.set(email, displayName);
  }, [newUserDisplayNames]);

  // For Google OAuth new users: we don't know the email before the popup opens, so we
  // store the display name separately and consume it on the next auth state change.
  const pendingGoogleDisplayName = useRef<string | undefined>(undefined);
  const expectGoogleSignup = useCallback((displayName: string) => {
    pendingGoogleDisplayName.current = displayName;
  }, []);

  const popNewUser = useCallback((email: string | null) => {
    // Always consume (and clear) the pending Google display name on any auth event,
    // so it doesn't linger and affect unrelated future logins.
    const googleDisplayName = pendingGoogleDisplayName.current;
    pendingGoogleDisplayName.current = undefined;

    if (!email) {
      return googleDisplayName;
    }

    const newDisplayName = newUserDisplayNames.get(email);
    if (newDisplayName !== undefined) {
      console.debug(`ensuring profile of ${email} setting display name ${newDisplayName}`);
      newUserDisplayNames.delete(email);
      return newDisplayName;
    }

    if (googleDisplayName !== undefined) {
      console.debug(`ensuring profile of ${email} setting Google signup display name ${googleDisplayName}`);
      return googleDisplayName;
    }

    console.debug(`ensuring profile of ${email}`);
    return undefined;
  }, [newUserDisplayNames]);

  // Upon start, make sure the user has an up-to-date profile, then set this:
  const [profileRef, setProfileRef] = useState<IDataReference<IProfile> | undefined>(undefined);
  useEffect(() => {
    if (dataService === undefined || user === undefined || user === null) {
      setProfile(undefined);
      setProfileRef(undefined);
      return;
    }

    const uid = user.uid;
    ensureProfile(dataService, user, analytics, popNewUser(user.email))
      .then(p => {
        setProfile(p);
        setProfileRef(dataService.getProfileRef(uid));
      })
      .catch(e => logError("Failed to ensure profile of user " + user?.displayName, e));
  }, [analytics, logError, popNewUser, setProfile, setProfileRef, dataService, user]);

  // Watch the user's profile:
  useEffect(() => {
    if (profileRef === undefined || dataService === undefined) {
      setProfile(undefined);
      return undefined;
    }

    return dataService.watch(profileRef,
        p => setProfile(p),
        e => logError("Failed to watch profile", e)
      );
  }, [logError, profileRef, setProfile, dataService]);

  const profileContext = useMemo(
    () => ({ profile: profile, expectNewUser: expectNewUser, expectGoogleSignup: expectGoogleSignup }),
    [profile, expectNewUser, expectGoogleSignup]
  );

  return (
    <ProfileContext.Provider value={profileContext}>
      {props.children}
    </ProfileContext.Provider>
  );
}

export default ProfileContextProvider;