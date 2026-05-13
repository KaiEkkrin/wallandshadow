import { useCallback, useEffect, useMemo, useState } from 'react';

import Alert from 'react-bootstrap/Alert';
import Button from 'react-bootstrap/Button';
import Form from 'react-bootstrap/Form';
import Modal from 'react-bootstrap/Modal';

import { IApi, IAuth } from '@wallandshadow/shared';

import { logError } from '../services/consoleLogger';

interface IDeleteAccountModalProps {
  show: boolean;
  displayName: string;
  api: IApi | undefined;
  auth: IAuth | undefined;
  handleClose: () => void;
}

function DeleteAccountModal({ show, displayName, api, auth, handleClose }: IDeleteAccountModalProps) {
  const [confirmText, setConfirmText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (show === true) {
      setConfirmText("");
      setIsDeleting(false);
      setError(undefined);
    }
  }, [show]);

  const isDeleteDisabled = useMemo(
    () => isDeleting || displayName.length === 0 || confirmText !== displayName,
    [confirmText, displayName, isDeleting],
  );

  const handleDelete = useCallback(() => {
    if (api === undefined || auth === undefined) {
      return;
    }
    setIsDeleting(true);
    setError(undefined);
    (async () => {
      try {
        await api.deleteMe();
      } catch (e) {
        setIsDeleting(false);
        setError(e instanceof Error ? e.message : 'Failed to delete account');
        logError('Failed to delete account', e);
        return;
      }
      // signOut also drives the auth state listener that redirects to /login,
      // and triggers Zitadel RP-initiated logout for OIDC users.
      try {
        await auth.signOut();
      } catch (e) {
        logError('Failed to sign out after account deletion', e);
        // Account is gone server-side; force a reload so the SPA drops its
        // cached auth state. Matches the pattern in HonoContextProvider.
        window.location.replace('/login');
      }
    })().catch(e => logError('Unexpected error in delete-account flow', e));
  }, [api, auth]);

  return (
    <Modal show={show} onHide={isDeleting ? undefined : handleClose}>
      <Modal.Header closeButton={!isDeleting}>
        <Modal.Title>Delete account</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Alert variant="danger">
          <Alert.Heading as="h6">This is permanent.</Alert.Heading>
          <p className="mb-2">
            Deleting your account will remove:
          </p>
          <ul className="mb-2">
            <li>Every adventure you own, along with its maps, players, invites, and uploaded images.</li>
            <li>Your membership of every adventure you joined as a player.</li>
            <li>All images you uploaded.</li>
          </ul>
          <p className="mb-0">
            Other players in your adventures will lose access. This cannot be undone.
          </p>
        </Alert>
        <Form>
          <Form.Group>
            <Form.Label htmlFor="deleteConfirmInput">
              Type <strong>{displayName}</strong> below to confirm:
            </Form.Label>
            <Form.Control id="deleteConfirmInput" type="text" autoComplete="off"
              value={confirmText} disabled={isDeleting}
              onChange={e => setConfirmText(e.target.value)} />
          </Form.Group>
        </Form>
        {error !== undefined && (
          <Alert className="mt-3 mb-0" variant="danger">{error}</Alert>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" disabled={isDeleting} onClick={handleClose}>Cancel</Button>
        <Button variant="danger" disabled={isDeleteDisabled} onClick={handleDelete}>
          {isDeleting ? 'Deleting…' : 'Delete my account'}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

export default DeleteAccountModal;
