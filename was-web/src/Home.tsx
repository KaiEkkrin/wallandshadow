import { useContext, useEffect, useMemo } from 'react';
import './App.css';

import AdventureCollection from './components/AdventureCollection';
import MapCollection from './components/MapCollection';
import Navigation from './components/Navigation';
import { ProfileContext } from './components/ProfileContext';
import { UserContext } from './components/UserContext';
import { useDocumentTitle } from './hooks/useDocumentTitle';
import { useRecentMaps } from './hooks/useRecentMaps';

import Col from 'react-bootstrap/Col';
import Container from 'react-bootstrap/Container';
import Row from 'react-bootstrap/Row';
import { useNavigate } from 'react-router-dom';

function Home() {
  const { user } = useContext(UserContext);
  const { profile } = useContext(ProfileContext);
  const navigate = useNavigate();

  useDocumentTitle('Home');

  // Redirect to login if not logged in
  // Use replace: true to avoid creating a history entry, so the back button
  // from the login page goes to the previous page instead of looping back to login
  useEffect(() => {
    if (user === null) {
      navigate('/login', { replace: true });
    }
  }, [user, navigate]);

  const myAdventures = useMemo(
    () => profile?.adventures?.filter(a => a.owner === user?.uid) ?? [],
    [profile, user]
  );

  const showNewMap = useMemo(() => myAdventures.length > 0, [myAdventures]);
  const adventures = useMemo(() => profile?.adventures ?? [], [profile]);
  const latestMaps = useRecentMaps(user?.uid);

  return (
    <div>
      <Navigation />
      <Container>
        <Row>
          <Col>
            <h5 className="mt-4">Latest maps</h5>
            <MapCollection
              adventures={myAdventures}
              maps={latestMaps}
              showNewMap={showNewMap}
            />
          </Col>
        </Row>
        <Row>
          <Col>
            <h5 className="mt-4">Latest adventures</h5>
            <AdventureCollection
              uid={user?.uid}
              adventures={adventures}
              showNewAdventure={true}
            />
          </Col>
        </Row>
      </Container>
    </div>
  );
}

export default Home;