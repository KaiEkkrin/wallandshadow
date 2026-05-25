import { useCallback, useContext } from 'react';
import './App.css';

import Button from 'react-bootstrap/Button';
import Container from 'react-bootstrap/Container';
import { useNavigate } from 'react-router-dom';

import { AuthContext } from './components/AuthContext';
import { useDocumentTitle } from './hooks/useDocumentTitle';
import { logError } from './services/consoleLogger';

// Shown when the signed-in account has been suspended (banned). The user is
// deliberately not routed back through the login flow — see SuspendedGate.
function Suspended() {
  const { auth } = useContext(AuthContext);
  const navigate = useNavigate();
  useDocumentTitle('Account suspended');

  const handleSignOut = useCallback(() => {
    auth?.signOut()
      .then(() => navigate('/login', { replace: true }))
      .catch(e => logError('Sign out failed', e));
  }, [auth, navigate]);

  return (
    <div>
      <header className="App-header">
        <Container className="text-center">
          <h3>Account suspended</h3>
          <p>This account has been suspended and can no longer be used.</p>
          <Button variant="secondary" onClick={handleSignOut}>Sign out</Button>
        </Container>
      </header>
    </div>
  );
}

export default Suspended;
