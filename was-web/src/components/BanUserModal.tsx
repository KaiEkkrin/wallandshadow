import { useCallback, useEffect, useMemo, useState } from 'react';

import Alert from 'react-bootstrap/Alert';
import Button from 'react-bootstrap/Button';
import Form from 'react-bootstrap/Form';
import Modal from 'react-bootstrap/Modal';

import { IApi, IAdminUserSummary } from '@wallandshadow/shared';

import { logError } from '../services/consoleLogger';

interface IBanUserModalProps {
  show: boolean;
  // The string the operator must type to enable the destructive button.
  // The page passes the target's display name (or email when no name).
  confirmTarget: string;
  targetId: string;
  api: IApi | undefined;
  handleClose: () => void;
  // Fired with the updated summary on a successful ban.
  onBanned: (summary: IAdminUserSummary) => void;
}

function BanUserModal({
  show, confirmTarget, targetId, api, handleClose, onBanned,
}: IBanUserModalProps) {
  const [confirmText, setConfirmText] = useState('');
  const [isBanning, setIsBanning] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (show === true) {
      setConfirmText('');
      setIsBanning(false);
      setError(undefined);
    }
  }, [show]);

  const isBanDisabled = useMemo(
    () => isBanning || confirmTarget.length === 0 || confirmText !== confirmTarget,
    [confirmText, confirmTarget, isBanning],
  );

  const handleBan = useCallback(() => {
    if (api === undefined) return;
    setIsBanning(true);
    setError(undefined);
    (async () => {
      try {
        const summary = await api.adminBanUser(targetId);
        onBanned(summary);
      } catch (e) {
        setIsBanning(false);
        setError(e instanceof Error ? e.message : 'Failed to ban this account');
        logError('Admin ban request failed', e);
      }
    })().catch(e => logError('Unexpected error in admin ban flow', e));
  }, [api, targetId, onBanned]);

  return (
    <Modal show={show} onHide={isBanning ? undefined : handleClose}>
      <Modal.Header closeButton={!isBanning}>
        <Modal.Title>Ban account</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Alert variant="danger">
          <Alert.Heading as="h6">This is permanent.</Alert.Heading>
          <p className="mb-2">
            Banning this account will:
          </p>
          <ul className="mb-2">
            <li>Soft-delete every adventure, map and image they own.</li>
            <li>Move all of their uploaded images to quarantine.</li>
            <li>Remove their footprint from other users&apos; content (membership, invites, spritesheet slots).</li>
            <li>Disconnect any open sessions and lock the account out immediately.</li>
          </ul>
          <p className="mb-0">
            Bans are not reversible from the admin UI.
          </p>
        </Alert>
        <Form onSubmit={e => { e.preventDefault(); if (!isBanDisabled) handleBan(); }}>
          <Form.Group>
            <Form.Label htmlFor="banConfirmInput">
              Type <strong>{confirmTarget}</strong> below to confirm:
            </Form.Label>
            <Form.Control id="banConfirmInput" type="text" autoComplete="off"
              value={confirmText} disabled={isBanning}
              onChange={e => setConfirmText(e.target.value)} />
          </Form.Group>
        </Form>
        {error !== undefined && (
          <Alert className="mt-3 mb-0" variant="danger">{error}</Alert>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" disabled={isBanning} onClick={handleClose}>Cancel</Button>
        <Button id="banConfirmButton" variant="danger" disabled={isBanDisabled} onClick={handleBan}>
          {isBanning ? 'Banning…' : 'Ban this account'}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

export default BanUserModal;
