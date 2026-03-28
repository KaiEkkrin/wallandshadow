import { useEffect, useState, useContext } from 'react';

import { FirebaseContext } from './FirebaseContext';
import { UserContext } from './UserContext';
import { SignInMethodsContext } from './SignInMethodsContext';
import { IContextProviderProps, ISignInMethodsContext, IUserContext } from './interfaces';

import { DataService } from '../services/dataService';
import { FunctionsService } from '../services/functions';
import { Storage } from '../services/storage';
import { IStorage } from '../services/interfaces';
import { ExpiringStringCache } from '../services/expiringStringCache';

function createResolveImageUrl(storageService: IStorage | undefined): ((path: string) => Promise<string>) | undefined {
  if (storageService === undefined) {
    return undefined;
  }

  const imageUrlCache = new ExpiringStringCache(1000 * 60 * 10); // the URL has a token; 10 minutes should be okay
  return (path: string) => imageUrlCache.resolve(path, p => storageService.ref(p).getDownloadURL());
}

// This provides the user context.
function UserContextProvider(props: IContextProviderProps) {
  const { auth, db, functions, storage, timestampProvider } = useContext(FirebaseContext);
  const [userContext, setUserContext] = useState<IUserContext>({ user: undefined });

  // When we're connected to Firebase, subscribe to the auth state change event and create a
  // suitable user context
  useEffect(() => {
    const functionsService = functions === undefined ? undefined :
      new FunctionsService(functions);

    const realStorageService = storage === undefined ? undefined :
      new Storage(storage);

    return auth?.onAuthStateChanged(u => {
      // Create the relevant storage service (if any.)
      const storageService = functionsService === undefined || !u ? undefined : realStorageService;

      setUserContext({
        user: u,
        dataService: (db === undefined || timestampProvider === undefined || u === null || u === undefined) ?
          undefined : new DataService(db, timestampProvider),
        functionsService: functionsService,
        storageService: storageService,
        resolveImageUrl: createResolveImageUrl(storageService)
      });
    }, e => console.error("Authentication state error: ", e));
  }, [auth, db, functions, storage, timestampProvider]);

  // Check newly logged in users for sign-in methods (e.g. governs whether we can reset passwords)
  const [signInMethodsContext, setSignInMethodsContext] = useState<ISignInMethodsContext>({ signInMethods: [] });

  useEffect(() => {
    const email = userContext.user?.email;
    if (email !== undefined && email !== null) {
      auth?.fetchSignInMethodsForEmail(email)
        .then(m => setSignInMethodsContext({ signInMethods: m }))
        .catch(e => console.error("Unable to fetch sign-in methods for " + email, e));
    } else {
      setSignInMethodsContext({ signInMethods: [] });
    }
  }, [auth, userContext, setSignInMethodsContext]);

  return (
    <UserContext.Provider value={userContext}>
      <SignInMethodsContext.Provider value={signInMethodsContext}>
        {props.children}
      </SignInMethodsContext.Provider>
    </UserContext.Provider>
  );
}

export default UserContextProvider;