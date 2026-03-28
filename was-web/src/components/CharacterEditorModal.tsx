import { useCallback, useEffect, useMemo, useState } from 'react';

import { ICharacter } from '../data/character';
import { IImage } from '../data/image';
import { ISprite } from '../data/sprite';

import Button from 'react-bootstrap/Button';
import Form from 'react-bootstrap/Form';
import Modal from 'react-bootstrap/Modal';
import Tab from 'react-bootstrap/Tab';
import Tabs from 'react-bootstrap/Tabs';

import { v7 as uuidv7 } from 'uuid';
import TokenImageEditor from './TokenImageEditor';

interface ICharacterEditorModalProps {
  show: boolean;
  adventureId: string;
  character: ICharacter | undefined;
  handleClose: () => void;
  handleImageDelete: (image: IImage | undefined) => void;
  handleSave: (character: ICharacter) => void;
}

// This is similar to the token editor modal, but different enough I'm not going to
// try sharing it as a whole
function CharacterEditorModal(
  { show, adventureId, character, handleClose, handleImageDelete, handleSave }: ICharacterEditorModalProps
) {
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [sprites, setSprites] = useState<ISprite[]>([]);

  useEffect(() => {
    if (show) {
      setName(character?.name ?? "");
      setText(character?.text ?? "");
      setSprites(character?.sprites ?? []);
    }
  }, [character, show]);

  const [imageTabTitle, setImageTabTitle] = useState("Image");

  // We can't save if there's no name, no text/image or name or we're busy handling an image:
  const [busySettingImage, setBusySettingImage] = useState(false);
  const saveDisabled = useMemo(
    () => name.length === 0 || (text.length === 0 && sprites.length === 0) || busySettingImage,
    [busySettingImage, name, sprites, text]
  );

  const doHandleSave = useCallback(() => {
    handleSave({
      id: character?.id ?? uuidv7(),
      name: name,
      text: text,
      sprites: sprites
    });
  }, [character, handleSave, name, sprites, text]);

  return (
    <Modal show={show} onHide={handleClose}>
      <Modal.Header closeButton>
        <Modal.Title>Character</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Tabs defaultActiveKey="properties">
          <Tab eventKey="properties" title="Properties">
            <Form>
              <Form.Group>
                <Form.Label htmlFor="characterName">Name</Form.Label>
                <Form.Control id="characterName" type="text" maxLength={30} value={name}
                  onChange={e => setName(e.target.value)} />
              </Form.Group>
              <Form.Group>
                <Form.Label htmlFor="characterLabel">Label (maximum 3 characters)</Form.Label>
                <Form.Control id="characterLabel" type="text" maxLength={3} value={text}
                  onChange={e => setText(e.target.value)} />
                <Form.Text className="text-muted">
                  This is the text drawn on the token in maps. A character must have either this label, an image or both.
                </Form.Text>
              </Form.Group>
            </Form>
          </Tab>
          <Tab eventKey="image" title={imageTabTitle}>
            <TokenImageEditor adventureId={adventureId} altText={text} colour="grey" show={show}
              busySettingImage={busySettingImage} setBusySettingImage={setBusySettingImage}
              setImageTabTitle={setImageTabTitle}
              sprites={sprites} setSprites={setSprites} handleImageDelete={handleImageDelete} />
          </Tab>
        </Tabs>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={handleClose}>Close</Button>
        <Button variant="primary"
          disabled={saveDisabled}
          onClick={doHandleSave}>Save</Button>
      </Modal.Footer>
    </Modal>
  );
}

export default CharacterEditorModal;