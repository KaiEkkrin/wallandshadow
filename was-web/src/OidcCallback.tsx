import { useEffect, useContext, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { handleOidcCallback } from './services/oidcAuth';
import { FirebaseContext } from './components/FirebaseContext';
import { HonoAuth } from './services/honoAuth';
import Throbber from './components/Throbber';

// Module-level flag to guard against React StrictMode double-mount.
// The OIDC authorization code is single-use, so we must only call
// signinRedirectCallback() once per page load.
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
        // Use the id_token (always a JWT) rather than the access_token (which may be opaque).
        // The server validates the token against Zitadel's JWKS and extracts the sub claim.
        const token = oidcUser.id_token ?? oidcUser.access_token;
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
