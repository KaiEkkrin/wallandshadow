import { useContext, useEffect, useMemo, useState } from 'react';
import './App.css';

import AdventureCollection from './components/AdventureCollection';
import Navigation from './components/Navigation';
import { RequireLoggedIn } from './components/RequireLoggedIn';
import { UserContext } from './components/UserContext';
import { useDocumentTitle } from './hooks/useDocumentTitle';
import { logError } from './services/consoleLogger';

import { IAdventure, IIdentified, summariseAdventure } from '@wallandshadow/shared';

import Col from 'react-bootstrap/Col';
import Container from 'react-bootstrap/Container';
import Row from 'react-bootstrap/Row';

function Shared() {
  const { live, user } = useContext(UserContext);
  const [adventures, setAdventures] = useState<IIdentified<IAdventure>[]>([]);

  useDocumentTitle('Shared With Me');

  useEffect(() => {
    const uid = user?.uid;
    if (uid === undefined || live === undefined) {
      return undefined;
    }

    return live.watchAdventures(
      a => {
        console.debug("Received " + a.length + " adventures");
        setAdventures(a);
      },
      e => logError("Error watching adventures: ", e)
    );
  }, [live, user]);

  // Shared = adventures I'm a member of but don't own.
  const shared = useMemo(
    () => adventures
      .filter(a => a.record.owner !== user?.uid)
      .map(a => summariseAdventure(a.id, a.record)),
    [adventures, user]
  );

  return (
    <RequireLoggedIn>
      <Navigation>
        Adventures shared with me
      </Navigation>
      <Container>
        <Row>
          <Col className="mt-4">
            <h5>Adventures shared with me</h5>
            <AdventureCollection uid={user?.uid}
              adventures={shared} showNewAdventure={false} />
          </Col>
        </Row>
      </Container>
    </RequireLoggedIn>
  );
}

export default Shared;