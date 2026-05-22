import { useContext, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import Card from 'react-bootstrap/Card';
import Col from 'react-bootstrap/Col';
import Container from 'react-bootstrap/Container';
import Row from 'react-bootstrap/Row';
import Table from 'react-bootstrap/Table';

import type { IAdminUserDetail } from '@wallandshadow/shared';

import Navigation from './components/Navigation';
import Throbber from './components/Throbber';
import { UserContext } from './components/UserContext';
import { useDocumentTitle } from './hooks/useDocumentTitle';
import { logError } from './services/consoleLogger';

// Read-only admin account-info page: a summary card plus three tables for the
// adventures, maps and images the account owns. No mutating actions (Session 5).
function AdminUser() {
  const { api } = useContext(UserContext);
  const { id } = useParams<{ id: string }>();
  useDocumentTitle('Account info');

  const [detail, setDetail] = useState<IAdminUserDetail | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (api === undefined || id === undefined) return;
    let cancelled = false;
    setDetail(undefined);
    setError(undefined);
    api.adminGetUser(id)
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch((err) => {
        logError('Admin account-info load failed', err);
        if (!cancelled) setError('Could not load this account.');
      });
    return () => { cancelled = true; };
  }, [api, id]);

  return (
    <div>
      <Navigation />
      <Container>
        <Row>
          <Col>
            {error !== undefined && <p className="text-danger mt-4">{error}</p>}
            {error === undefined && detail === undefined && <Throbber />}
            {detail !== undefined && (
              <>
                <h5 className="mt-4">Account: {detail.summary.name}</h5>
                <Card className="mt-2">
                  <Card.Body>
                    <div>Email: {detail.summary.email ?? '(none)'}</div>
                    <div>Tier: {detail.summary.level}</div>
                    <div>Account ID: {detail.summary.id}</div>
                    {detail.summary.externalId !== null && (
                      <div>External ID: {detail.summary.externalId}</div>
                    )}
                    <div>Created: {detail.summary.createdAt}</div>
                    <div>Email verified: {detail.summary.emailVerified ? 'yes' : 'no'}</div>
                    <div>Sign-in: {detail.summary.externalId !== null ? 'OIDC' : 'local password'}</div>
                  </Card.Body>
                </Card>

                <h6 className="mt-4">Adventures owned ({detail.adventures.length})</h6>
                <Table striped bordered size="sm">
                  <thead>
                    <tr><th>Name</th><th>Created</th><th>Maps</th><th>ID</th></tr>
                  </thead>
                  <tbody>
                    {detail.adventures.map((a) => (
                      <tr key={a.id}>
                        <td>{a.name}</td>
                        <td>{a.createdAt}</td>
                        <td>{a.mapCount}</td>
                        <td>{a.id}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>

                <h6 className="mt-4">Maps owned ({detail.maps.length})</h6>
                <Table striped bordered size="sm">
                  <thead>
                    <tr><th>Name</th><th>Adventure</th><th>Type</th><th>ID</th></tr>
                  </thead>
                  <tbody>
                    {detail.maps.map((m) => (
                      <tr key={m.id}>
                        <td>{m.name}</td>
                        <td>{m.adventureName}</td>
                        <td>{m.ty}</td>
                        <td>{m.id}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>

                <h6 className="mt-4">Images owned ({detail.images.length})</h6>
                <Table striped bordered size="sm">
                  <thead>
                    <tr><th>Name</th><th>Path</th><th>Created</th><th>ID</th></tr>
                  </thead>
                  <tbody>
                    {detail.images.map((img) => (
                      <tr key={img.id}>
                        <td>{img.name}</td>
                        <td>{img.path}</td>
                        <td>{img.createdAt}</td>
                        <td>{img.id}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </>
            )}
          </Col>
        </Row>
      </Container>
    </div>
  );
}

export default AdminUser;
