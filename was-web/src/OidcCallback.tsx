import { useEffect, useContext, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { handleOidcCallback, getOidcBearerToken } from './services/oidcAuth';
import { FirebaseContext } from './components/FirebaseContext';
import { HonoAuth } from './services/honoAuth';
import Throbber from './components/Throbber';

// Module-level flag to guard against React StrictMode double-mount.
// The OIDC authorization code is single-use, so we must only call
// signinRedirectCallback() once per page load.
// This flag never needs resetting: /auth/callback is only reachable via
// external redirect from Zitadel, which is a full page navigation that
// re-initializes all modules.
let callbackProcessed = false;

function OidcCallback() {
  const { auth } = useContext(FirebaseContext);
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current || callbackProcessed) return;
    started.current = true;
    callbackProcessed = true;

    async function complete() {
      try {
        const oidcUser = await handleOidcCallback();
        const token = getOidcBearerToken(oidcUser);
        if (auth instanceof HonoAuth) {
          await auth.completeOidcLogin(token);
        }
        navigate('/app', { replace: true });
      } catch (e) {
        console.error('OIDC callback error:', e);
        setError(e instanceof Error ? e.message : 'Login failed');
        navigate('/login', { replace: true });
      }
    }

    complete();
  }, [auth, navigate]);

  if (error) {
    return <div className="App-header"><p style={{ color: 'red' }}>Login failed: {error}</p></div>;
  }

  return <Throbber />;
}

export default OidcCallback;
