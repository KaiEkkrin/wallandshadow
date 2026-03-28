import { useEffect, useState } from 'react';

import { initializeApp } from 'firebase/app';
import { getAnalytics, logEvent as firebaseLogEvent } from 'firebase/analytics';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, serverTimestamp } from 'firebase/firestore';
import { getFunctions, Functions, connectFunctionsEmulator } from 'firebase/functions';
import { getStorage, FirebaseStorage, connectStorageEmulator } from 'firebase/storage';
import { IAnalytics } from '../services/interfaces';

import { FirebaseContext } from './FirebaseContext';
import { IContextProviderProps, IFirebaseContext, IFirebaseProps } from './interfaces';
import * as Auth from '../services/auth';

const region = 'europe-west2';

async function configureFirebase(setFirebaseContext: (c: IFirebaseContext) => void) {
  let config;
  // Detect local development: Vite sets import.meta.env.DEV, webpack had webpackHotUpdate
  const isLocalDevelopment = import.meta.env.DEV;

  // Try to get app config from Firebase Hosting
  try {
    const response = await fetch('/__/firebase/init.json?v=2');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    config = await response.json();
  } catch (error) {
    // Fallback to local development config when not served via Firebase Hosting
    console.debug("Using local development Firebase config (emulator mode)", error);

    // Try to get project ID from admin credentials file
    let projectId = "hexland-test";
    try {
      const credsResponse = await fetch('/firebase-admin-credentials.json');
      if (credsResponse.ok) {
        const creds = await credsResponse.json();
        projectId = creds.project_id || projectId;
        console.debug(`Using project ID from credentials: ${projectId}`);
      }
    } catch (e) {
      console.debug("Could not load admin credentials, using default project ID", e);
    }

    config = {
      apiKey: "fake-api-key-for-emulator",
      authDomain: `${projectId}.firebaseapp.com`,
      projectId: projectId,
      storageBucket: `${projectId}.firebasestorage.app`,
      messagingSenderId: "123456789",
      appId: "1:123456789:web:abcdef"
    };
  }

  const app = initializeApp(config);
  const auth = getAuth(app);
  const db = getFirestore(app);
  let storage: FirebaseStorage | undefined = undefined;
  let usingLocalEmulators = false;

  // Configure to use local emulators when running locally with webpack hot-plugging
  let functions: Functions;
  if (isLocalDevelopment) {
    const hostname = document.location.hostname;
    connectAuthEmulator(auth, `http://${hostname}:9099`);
    connectFirestoreEmulator(db, hostname, 8080);
    // In emulator mode, don't use region - the server exports functions without region
    // to avoid issues with test libraries (see functions/src/index.ts getFunctionBuilder)
    functions = getFunctions(app);
    connectFunctionsEmulator(functions, hostname, 5001);
    storage = getStorage(app);
    connectStorageEmulator(storage, hostname, 9199);
    usingLocalEmulators = true;
    console.debug("Running with local emulators");
  } else {
    functions = getFunctions(app, region);
    storage = getStorage(app);
  }

  setFirebaseContext({
    auth: new Auth.FirebaseAuth(auth),
    db: db,
    functions: functions,
    googleAuthProvider: Auth.googleAuthProviderWrapper,
    storage: storage,
    timestampProvider: serverTimestamp,
    usingLocalEmulators: usingLocalEmulators,
    // Don't initialize Analytics in local development mode (requires real API key)
    createAnalytics: isLocalDevelopment ? undefined : (): IAnalytics => {
      const analytics = getAnalytics(app);
      return {
        logEvent: (event: string, parameters: Record<string, unknown>) => firebaseLogEvent(analytics, event, parameters)
      };
    }
  });
}

// This provides the Firebase context, and should be replaced to unit test with the
// Firebase simulator.
function FirebaseContextProvider(props: IContextProviderProps & IFirebaseProps) {
  const [firebaseContext, setFirebaseContext] = useState<IFirebaseContext>({});

  // On load, fetch our Firebase config and initialize
  useEffect(() => {
    configureFirebase(setFirebaseContext)
      .catch(e => console.error("Error configuring Firebase", e));
  }, []);

  return (
    <FirebaseContext.Provider value={firebaseContext}>
      {props.children}
    </FirebaseContext.Provider>
  );
}

export default FirebaseContextProvider;