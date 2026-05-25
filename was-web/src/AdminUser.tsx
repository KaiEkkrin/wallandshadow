import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { v7 as uuidv7 } from 'uuid';

import Badge from 'react-bootstrap/Badge';
import Button from 'react-bootstrap/Button';
import Card from 'react-bootstrap/Card';
import Col from 'react-bootstrap/Col';
import Container from 'react-bootstrap/Container';
import Form from 'react-bootstrap/Form';
import InputGroup from 'react-bootstrap/InputGroup';
import Row from 'react-bootstrap/Row';
import Table from 'react-bootstrap/Table';

import { UserLevel, type IAdminUserDetail, type IAdminUserSummary } from '@wallandshadow/shared';

import BanUserModal from './components/BanUserModal';
import Navigation from './components/Navigation';
import { StatusContext } from './components/StatusContext';
import Throbber from './components/Throbber';
import { UserContext } from './components/UserContext';
import { useDocumentTitle } from './hooks/useDocumentTitle';
import { logError } from './services/consoleLogger';

// Admin account-info page: a summary card plus three tables for the
// adventures, maps and images the account owns. Includes the tier-change and
// ban mutations.
function AdminUser() {
  const { api, user } = useContext(UserContext);
  const statusContext = useContext(StatusContext);
  const { id } = useParams<{ id: string }>();
  useDocumentTitle('Account info');

  const [detail, setDetail] = useState<IAdminUserDetail | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  const [pendingLevel, setPendingLevel] = useState<UserLevel | undefined>(undefined);
  const [isApplyingLevel, setIsApplyingLevel] = useState(false);
  const [showBanModal, setShowBanModal] = useState(false);

  useEffect(() => {
    if (api === undefined || id === undefined) return;
    let cancelled = false;
    setDetail(undefined);
    setError(undefined);
    api.adminGetUser(id)
      .then((d) => { if (!cancelled) { setDetail(d); setPendingLevel(d.summary.level); } })
      .catch((err) => {
        logError('Admin account-info load failed', err);
        if (!cancelled) setError('Could not load this account.');
      });
    return () => { cancelled = true; };
  }, [api, id]);

  const isSelf = useMemo(
    () => detail !== undefined && user?.uid === detail.summary.id,
    [detail, user?.uid],
  );

  const surfaceError = useCallback((title: string, e: unknown) => {
    const message = e instanceof Error ? e.message : 'Something went wrong';
    statusContext.toasts.next({ id: uuidv7(), record: { title, message } });
  }, [statusContext]);

  const surfaceSuccess = useCallback((title: string, message: string) => {
    statusContext.toasts.next({ id: uuidv7(), record: { title, message } });
  }, [statusContext]);

  const applyLevel = useCallback(() => {
    if (api === undefined || detail === undefined || pendingLevel === undefined) return;
    if (pendingLevel === detail.summary.level) return;
    setIsApplyingLevel(true);
    api.adminSetUserLevel(detail.summary.id, pendingLevel)
      .then((summary) => {
        setDetail(d => d === undefined ? d : { ...d, summary });
        setPendingLevel(summary.level);
        surfaceSuccess('Tier updated', `Account is now ${summary.level}.`);
      })
      .catch((e) => {
        logError('Admin tier change failed', e);
        surfaceError('Could not change tier', e);
        // Revert the pending selection on failure.
        setPendingLevel(detail.summary.level);
      })
      .finally(() => setIsApplyingLevel(false));
  }, [api, detail, pendingLevel, surfaceError, surfaceSuccess]);

  const onBanned = useCallback((summary: IAdminUserSummary) => {
    setDetail(d => d === undefined ? d : { ...d, summary });
    setShowBanModal(false);
    surfaceSuccess('Account banned', `${summary.name || summary.email || summary.id} has been banned.`);
  }, [surfaceSuccess]);

  if (error !== undefined) {
    return (
      <div>
        <Navigation />
        <Container><Row><Col>
          <p className="text-danger mt-4">{error}</p>
        </Col></Row></Container>
      </div>
    );
  }
  if (detail === undefined) {
    return (
      <div>
        <Navigation />
        <Container><Row><Col><Throbber /></Col></Row></Container>
      </div>
    );
  }

  const summary = detail.summary;
  const isBanned = summary.bannedAt !== null;
  const isAdminTarget = summary.level === UserLevel.Admin;
  const confirmTarget = summary.name && summary.name.trim().length > 0
    ? summary.name : (summary.email ?? summary.id);

  return (
    <div>
      <Navigation />
      <Container>
        <Row>
          <Col>
            <h5 className="mt-4">
              Account: {summary.name}{' '}
              {isBanned && <Badge bg="danger" id="bannedBadge">Banned</Badge>}
            </h5>
            <Card className="mt-2">
              <Card.Body>
                <div>Email: {summary.email ?? '(none)'}</div>
                <div>Tier: {summary.level}</div>
                <div>Account ID: {summary.id}</div>
                {summary.externalId !== null && (
                  <div>External ID: {summary.externalId}</div>
                )}
                <div>Created: {summary.createdAt}</div>
                <div>Email verified: {summary.emailVerified ? 'yes' : 'no'}</div>
                <div>Sign-in: {summary.externalId !== null ? 'OIDC' : 'local password'}</div>
                {isBanned && <div id="bannedAtRow">Banned at: {summary.bannedAt}</div>}
              </Card.Body>
            </Card>

            {/* Admin actions: hidden on a self-view and on a banned account. */}
            {!isSelf && !isBanned && (
              <Card className="mt-3">
                <Card.Body>
                  <h6>Admin actions</h6>
                  <Form.Group className="mt-2">
                    <Form.Label htmlFor="adminTierSelect">Tier</Form.Label>
                    <InputGroup>
                      <Form.Select
                        id="adminTierSelect"
                        value={pendingLevel ?? summary.level}
                        disabled={isApplyingLevel}
                        onChange={e => setPendingLevel(e.target.value as UserLevel)}
                      >
                        <option value={UserLevel.Basic}>Basic</option>
                        <option value={UserLevel.Higher}>Higher</option>
                        <option value={UserLevel.Admin}>Admin</option>
                      </Form.Select>
                      <Button
                        id="adminTierApply"
                        variant="primary"
                        disabled={
                          isApplyingLevel ||
                          pendingLevel === undefined ||
                          pendingLevel === summary.level
                        }
                        onClick={applyLevel}
                      >
                        {isApplyingLevel ? 'Applying…' : 'Apply'}
                      </Button>
                    </InputGroup>
                  </Form.Group>
                  {!isAdminTarget && (
                    <div className="mt-3">
                      <Button
                        id="adminBanButton"
                        variant="danger"
                        onClick={() => setShowBanModal(true)}
                      >
                        Ban this account…
                      </Button>
                    </div>
                  )}
                </Card.Body>
              </Card>
            )}

            <h6 className="mt-4">Adventures owned ({detail.adventures.length})</h6>
            <Table striped bordered size="sm">
              <thead>
                <tr><th>Name</th><th>Created</th><th>Maps</th><th>ID</th></tr>
              </thead>
              <tbody>
                {detail.adventures.map((a) => (
                  <tr key={a.id} className={a.deletedAt !== null ? 'text-muted' : undefined}>
                    <td>
                      {a.name}
                      {a.deletedAt !== null && <> <Badge bg="secondary">deleted</Badge></>}
                    </td>
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
                  <tr key={m.id} className={m.deletedAt !== null ? 'text-muted' : undefined}>
                    <td>
                      {m.name}
                      {m.deletedAt !== null && <> <Badge bg="secondary">deleted</Badge></>}
                    </td>
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
                  <tr key={img.id} className={img.deletedAt !== null ? 'text-muted' : undefined}>
                    <td>
                      {img.name}
                      {img.deletedAt !== null && <> <Badge bg="secondary">deleted</Badge></>}
                    </td>
                    <td>{img.path}</td>
                    <td>{img.createdAt}</td>
                    <td>{img.id}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Col>
        </Row>
      </Container>
      <BanUserModal
        show={showBanModal}
        confirmTarget={confirmTarget}
        targetId={summary.id}
        api={api}
        handleClose={() => setShowBanModal(false)}
        onBanned={onBanned}
      />
    </div>
  );
}

export default AdminUser;
