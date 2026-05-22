import { useCallback, useContext, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import Button from 'react-bootstrap/Button';
import Card from 'react-bootstrap/Card';
import Col from 'react-bootstrap/Col';
import Container from 'react-bootstrap/Container';
import Form from 'react-bootstrap/Form';
import Row from 'react-bootstrap/Row';

import type { IAdminUserSummary } from '@wallandshadow/shared';

import Navigation from './components/Navigation';
import { UserContext } from './components/UserContext';
import { useDocumentTitle } from './hooks/useDocumentTitle';
import { logError } from './services/consoleLogger';

// Read-only admin account search. One box accepts an email, an internal account
// id, or an external (OIDC) id — the server auto-detects which. A hit shows a
// summary card linking to the full account-info page.
function Admin() {
  const { api } = useContext(UserContext);
  useDocumentTitle('Admin');

  const [term, setTerm] = useState('');
  const [result, setResult] = useState<IAdminUserSummary | undefined>(undefined);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const handleSearch = useCallback((e: FormEvent) => {
    e.preventDefault();
    if (api === undefined) return;
    const trimmed = term.trim();
    if (trimmed.length === 0) return;

    // Reset every prior result field so nothing stale survives this search.
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    setSearched(false);
    api.adminSearchUser(trimmed)
      .then((summary) => {
        setResult(summary);
        setSearched(true);
      })
      .catch((err) => {
        logError('Admin user search failed', err);
        setError('The search failed. Please try again.');
      })
      .finally(() => setBusy(false));
  }, [api, term]);

  return (
    <div>
      <Navigation />
      <Container>
        <Row>
          <Col>
            <h5 className="mt-4">Admin — account search</h5>
            <Form onSubmit={handleSearch} className="mt-3">
              <Form.Group className="mb-2">
                <Form.Control
                  id="adminSearchInput"
                  type="text"
                  placeholder="email, account id, or external id"
                  value={term}
                  onChange={(e) => setTerm(e.target.value)}
                />
                <Form.Text className="text-muted">
                  Searches by exact email, internal account id, or external (OIDC) id.
                </Form.Text>
              </Form.Group>
              <Button type="submit" variant="primary" disabled={busy || term.trim().length === 0}>
                Search
              </Button>
            </Form>

            {error !== undefined && <p className="text-danger mt-3">{error}</p>}

            {searched && error === undefined && result === undefined && (
              <p className="text-muted mt-3">No account found.</p>
            )}

            {result !== undefined && (
              <Card className="mt-3">
                <Card.Body>
                  <Card.Title>{result.name}</Card.Title>
                  <Card.Text as="div">
                    <div>Email: {result.email ?? '(none)'}</div>
                    <div>Tier: {result.level}</div>
                    <div>Account ID: {result.id}</div>
                    {result.externalId !== null && (
                      <div>External ID: {result.externalId}</div>
                    )}
                  </Card.Text>
                  <Link to={`/admin/users/${result.id}`}>View full account info</Link>
                </Card.Body>
              </Card>
            )}
          </Col>
        </Row>
      </Container>
    </div>
  );
}

export default Admin;
