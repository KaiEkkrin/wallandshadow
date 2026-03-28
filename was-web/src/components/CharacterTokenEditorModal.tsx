import { useCallback, useEffect, useMemo, useState } from 'react';
import * as React from 'react';

import { IPlayer } from '../data/adventure';
import { ITokenProperties, TokenSize } from '../data/feature';

import CharacterList from './CharacterList';
import ColourSelection from './ColourSelection';
import { TokenSizeSelection } from './TokenEditorModal';

import Button from 'react-bootstrap/Button';
import Form from 'react-bootstrap/Form';
import Modal from 'react-bootstrap/Modal';
import Row from 'react-bootstrap/Row';

import { v7 as uuidv7 } from 'uuid';

interface ICharacterTokenEditorModalProps {
  selectedColour: number;
  sizes: TokenSize[] | undefined;
  show: boolean;
  token: ITokenProperties | undefined;
  players: IPlayer[];
  handleClose: () => void;
  handleDelete: () => void;
  handleSave: (properties: ITokenProperties) => void;
}

function CharacterTokenEditorModal(
  { selectedColour, sizes, show, token, players,
    handleClose, handleDelete, handleSave }: ICharacterTokenEditorModalProps
) {
  const [colour, setColour] = useState(0);
  const [size, setSize] = useState<TokenSize>("1");
  const [note, setNote] = useState("");
  const [noteVisibleToPlayers, setNoteVisibleToPlayers] = useState(true);
  const [characterId, setCharacterId] = useState("");

  useEffect(() => {
    if (show) {
      setColour(token?.colour ?? selectedColour);
      setSize(token?.size ?? "1");
      setNote(token?.note ?? "");
      setNoteVisibleToPlayers(token?.noteVisibleToPlayers ?? false);
      setCharacterId(token?.characterId ?? "");
    }
  }, [
    selectedColour, show, token,
    setColour, setSize, setNote, setNoteVisibleToPlayers, setCharacterId
  ]);

  const handleVtoPChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setNoteVisibleToPlayers(e.currentTarget.checked);
  }, [setNoteVisibleToPlayers]);

  const saveDisabled = useMemo(() => characterId === "", [characterId]);

  const doHandleSave = useCallback(() => {
    handleSave({
      colour: colour,
      // If this was a new token, make a new id for it
      id: token === undefined ? uuidv7() : token.id,
      text: "", // sychronised with the character
      players: players.filter(p => p.characters.find(c => c.id === characterId) !== undefined)
        .map(p => p.playerId),
      size: size,
      note: note,
      noteVisibleToPlayers: noteVisibleToPlayers,
      characterId: characterId,
      sprites: [],
      outline: false
    });
  }, [characterId, colour, note, noteVisibleToPlayers, handleSave, players, token, size]);

  return (
    <Modal show={show} onHide={handleClose}>
      <Modal.Header closeButton>
        <Modal.Title>Character token</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Form>
          <Form.Group>
            <Form.Label htmlFor="tokenCharacter">Character</Form.Label>
            <Row>
              <CharacterList activeId={characterId} players={players} setActiveId={setCharacterId}
                showPlayerNames={true} style={{ width: '100%' }} />
            </Row>
          </Form.Group>
          <Form.Group>
            <Form.Label htmlFor="tokenNoteText">Note text</Form.Label>
            <Form.Control id="tokenNoteText" type="text" maxLength={30} value={note}
              onChange={e => setNote(e.target.value)} />
          </Form.Group>
          <Form.Group>
            <Form.Check type="checkbox" label="Note visible to players" checked={noteVisibleToPlayers}
              onChange={handleVtoPChange} />
          </Form.Group>
          <Form.Group>
            <Form.Label htmlFor="tokenColour">Colour</Form.Label>
            <div>
              <ColourSelection id="tokenColour"
                hidden={false}
                includeNegative={false}
                isVertical={false}
                selectedColour={colour}
                setSelectedColour={setColour} />
            </div>
          </Form.Group>
          <TokenSizeSelection size={size} sizes={sizes} setSize={setSize} />
        </Form>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="danger" onClick={handleDelete}>Delete</Button>
        <Button variant="secondary" onClick={handleClose}>Close</Button>
        <Button variant="primary"
          disabled={saveDisabled}
          onClick={doHandleSave}>Save</Button>
      </Modal.Footer>
    </Modal>
  );
}

export default CharacterTokenEditorModal;