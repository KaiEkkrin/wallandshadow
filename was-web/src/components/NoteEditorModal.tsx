import { useCallback, useEffect, useState } from 'react';
import * as React from 'react';

import { IAnnotation } from '../data/annotation';

import Button from 'react-bootstrap/Button';
import Form from 'react-bootstrap/Form';
import Modal from 'react-bootstrap/Modal';

import { v7 as uuidv7 } from 'uuid';

interface INoteEditorModalProps {
  show: boolean;
  note: IAnnotation | undefined;
  handleClose: () => void;
  handleDelete: () => void;
  handleSave: (id: string, colour: number, text: string, visibleToPlayers: boolean) => void;
}

function NoteEditorModal({ show, note, handleClose, handleDelete, handleSave }: INoteEditorModalProps) {
  const [id, setId] = useState("");
  const [colour, setColour] = useState(0); // TODO do something with this?
  const [text, setText] = useState("");
  const [visibleToPlayers, setVisibleToPlayers] = useState(false);

  useEffect(() => {
    if (show) {
      setId(note?.id ?? uuidv7());
      setColour(note?.colour ?? 0);
      setText(note?.text ?? "");
      setVisibleToPlayers(note?.visibleToPlayers ?? false);
    }
  }, [show, note]);

  const [saveDisabled, setSaveDisabled] = useState(false);
  useEffect(() => {
    setSaveDisabled(text.length === 0);
  }, [text]);

  const handleVtoPChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setVisibleToPlayers(e.currentTarget.checked);
  }, [setVisibleToPlayers]);

  return (
    <Modal show={show} onHide={handleClose}>
      <Modal.Header closeButton>
        <Modal.Title>Note</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Form>
          <Form.Group>
            <Form.Label htmlFor="noteText">Text</Form.Label>
            <Form.Control id="noteText" type="text" maxLength={30} value={text}
              onChange={e => setText(e.target.value)} />
          </Form.Group>
          <Form.Group>
            <Form.Check type="checkbox" label="Visible to players" checked={visibleToPlayers}
              onChange={handleVtoPChange} />
          </Form.Group>
        </Form>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="danger" onClick={handleDelete}>Delete</Button>
        <Button variant="secondary" onClick={handleClose}>Close</Button>
        <Button variant="primary"
          disabled={saveDisabled}
          onClick={() => handleSave(id, colour, text, visibleToPlayers)}>Save</Button>
      </Modal.Footer>
    </Modal>
  );
}

export default NoteEditorModal;