import { useEffect, useMemo, useState } from 'react';

import { FirebaseContext } from './FirebaseContext';
import { UserContext } from './UserContext';
import { SignInMethodsContext } from './SignInMethodsContext';
import { IContextProviderProps, IUserContext } from './interfaces';

import { HonoApiClient } from '../services/honoApi';
import { HonoAuth } from '../services/honoAuth';
import { HonoDataService } from '../services/honoDataService';
import { HonoFunctionsService } from '../services/honoFunctions';
import { HonoStorage } from '../services/honoStorage';
import { createResolveImageUrl } from '../services/resolveImageUrl';

// Replaces FirebaseContextProvider + UserContextProvider for the Hono backend.
// Provides FirebaseContext (with auth only), UserContext, and SignInMethodsContext.
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

    return auth.onAuthStateChanged(user => {
      if (user) {
        setUserContext({
          user,
          dataService: new HonoDataService(apiClient, user.uid),
          functionsService: new HonoFunctionsService(apiClient),
          storageService,
          resolveImageUrl,
        });
      } else {
        setUserContext({ user: null });
      }
    }, e => console.error('Authentication state error:', e));
  }, [auth, apiClient]);

  return (
    <FirebaseContext.Provider value={{ auth }}>
      <UserContext.Provider value={userContext}>
        <SignInMethodsContext.Provider value={{ signInMethods: ['password'] }}>
          {props.children}
        </SignInMethodsContext.Provider>
      </UserContext.Provider>
    </FirebaseContext.Provider>
  );
}

export default HonoContextProvider;
