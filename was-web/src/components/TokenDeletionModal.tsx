import { ITokenProperties } from '../data/feature';

import Button from 'react-bootstrap/Button';
import Modal from 'react-bootstrap/Modal';

interface ITokenDeletionModalProps {
  show: boolean;
  tokens: ITokenProperties[];
  handleClose: () => void;
  handleDelete: () => void;
}

function TokenDeletionModal({ show, tokens, handleClose, handleDelete }: ITokenDeletionModalProps) {
  return (
    <Modal show={show} onHide={handleClose}>
      <Modal.Header closeButton>
        <Modal.Title>Delete tokens</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p>You are about to delete {tokens.length} tokens.  Are you sure?</p>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={handleClose}>Close</Button>
        <Button variant="danger" onClick={handleDelete}>Yes, delete token!</Button>
      </Modal.Footer>
    </Modal>
  );
}

export default TokenDeletionModal;