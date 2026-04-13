import FirebaseContextProvider from './FirebaseContextProvider';
import HonoContextProvider from './HonoContextProvider';
import UserContextProvider from './UserContextProvider';
import { IContextProviderProps, IFirebaseProps } from './interfaces';

// Selects the backend based on the VITE_BACKEND environment variable.
// 'hono' → HonoContextProvider (replaces both Firebase + User providers)
// default → FirebaseContextProvider + UserContextProvider (original stack)
function BackendProvider(props: IContextProviderProps & IFirebaseProps) {
  if (import.meta.env.VITE_BACKEND === 'hono') {
    return <HonoContextProvider>{props.children}</HonoContextProvider>;
  }

  return (
    <FirebaseContextProvider {...props}>
      <UserContextProvider>
        {props.children}
      </UserContextProvider>
    </FirebaseContextProvider>
  );
}

export default BackendProvider;
