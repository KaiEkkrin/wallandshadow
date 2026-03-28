import { ICharacter } from '../data/character';

import Button from 'react-bootstrap/Button';
import Modal from 'react-bootstrap/Modal';

interface ICharacterDeletionModalProps {
  show: boolean;
  character: ICharacter | undefined;
  handleClose: () => void;
  handleDelete: () => void;
}

function CharacterDeletionModal(
  { show, character, handleClose, handleDelete }: ICharacterDeletionModalProps
) {
  return (
    <Modal show={show} onHide={handleClose}>
      <Modal.Header closeButton>
        <Modal.Title>Delete character</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p>You are about to delete {character?.name}.  Are you sure?</p>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={handleClose}>Close</Button>
        <Button variant="danger" onClick={handleDelete}>Yes, delete character!</Button>
      </Modal.Footer>
    </Modal>
  );
}

export default CharacterDeletionModal;