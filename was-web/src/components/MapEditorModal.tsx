import { useCallback, useEffect, useState, useContext, useMemo } from 'react';
import * as React from 'react';

import BusyElement from './BusyElement';
import { UserContext } from './UserContext';

import { IAdventureIdentified } from '../data/identified';
import { IMap, MapType } from '../data/map';
import { IAdventureSummary } from '../data/profile';

import Button from 'react-bootstrap/Button';
import Form from 'react-bootstrap/Form';
import Modal from 'react-bootstrap/Modal';

import fluent from 'fluent-iterable';

interface IMapEditorModalProps {
  show: boolean;
  adventures?: IAdventureSummary[] | undefined; // for new map only
  map: IAdventureIdentified<IMap> | undefined; // undefined to create a new map
  handleClose: () => void;
  handleSave: (adventureId: string, updated: IMap) => Promise<void>;
}

function MapEditorModal({ show, adventures, map, handleClose, handleSave }: IMapEditorModalProps) {
  const { user } = useContext(UserContext);

  const [isSaving, setIsSaving] = useState(false);
  useEffect(() => {
    if (show === true) {
      setIsSaving(false);
    }
  }, [show, setIsSaving]);

  const [name, setName] = useState("");
  const [adventureId, setAdventureId] = useState<string | undefined>(undefined);
  const [description, setDescription] = useState("");
  const [ty, setTy] = useState(MapType.Square);
  const [ffa, setFfa] = useState(false);

  const newMapControlsDisabled = useMemo(() => map !== undefined, [map]);
  const firstAdventure = useMemo(
    () => adventures !== undefined ? fluent(adventures).first() : undefined,
    [adventures]
  );

  const isSaveDisabled = useMemo(
    () => name.length === 0 || description.length === 0 || isSaving,
    [isSaving, name, description]
  );

  useEffect(() => {
    setName(map?.record.name ?? "");
    setAdventureId(map?.adventureId ?? firstAdventure?.id);
    setDescription(map?.record.description ?? "");
    setTy(map?.record.ty ?? MapType.Square);
    setFfa(map?.record.ffa ?? false);
    setIsSaving(false);
  }, [map, firstAdventure, setName, setAdventureId, setDescription, setTy, setFfa, setIsSaving]);

  const handleFfaChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => setFfa(e.currentTarget.checked),
    [setFfa]
  );

  const doHandleSave = useCallback(() => {
    if (adventureId === undefined) {
      return;
    }

    setIsSaving(true);
    if (map !== undefined) {
      // This is an edit of an existing map:
      handleSave(adventureId, {
        ...map.record,
        name: name,
        description: description,
        ffa: ffa
      }).then(() => console.debug("edited map " + map?.id))
        .catch(_e => setIsSaving(false));
      return;
    }

    // We're adding a new map.
    // There must be a valid adventure to add it to and a valid user
    const adventureName = adventures?.find(a => a.id === adventureId)?.name;
    const uid = user?.uid;
    if (adventureName === undefined || uid === undefined) {
      return;
    }

    handleSave(adventureId, {
      adventureName: adventureName,
      name: name,
      description: description,
      owner: uid,
      ty: ty,
      ffa: ffa,
      imagePath: ""
    }).then(() => console.debug("created new map"))
      .catch(_e => setIsSaving(false));
  }, [adventures, map, handleSave, adventureId, description, ffa, name, setIsSaving, ty, user]);

  return (
    <Modal show={show} onHide={handleClose}>
      <Modal.Header closeButton>
        <Modal.Title>Map settings</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Form>
          <Form.Group>
            <Form.Label htmlFor="mapNameInput">Map name</Form.Label>
            <Form.Control id="mapNameInput" type="text" maxLength={30} value={name}
              onChange={e => setName(e.target.value)} />
          </Form.Group>
          {adventures !== undefined && adventures.length > 0 ?
            <Form.Group>
              <Form.Label htmlFor="mapAdventureSelect">Adventure this map is in</Form.Label>
              <Form.Control id="mapAdventureSelect" as="select" value={adventureId}
                disabled={newMapControlsDisabled}
                onChange={e => setAdventureId(e.target.value)}>
                {adventures?.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Form.Control>
            </Form.Group> : <div></div>
          }
          <Form.Group>
            <Form.Label htmlFor="mapDescriptionInput">Map description</Form.Label>
            <Form.Control id="mapDescriptionInput" as="textarea" rows={5} maxLength={300}
              value={description} onChange={e => setDescription(e.target.value)} />
          </Form.Group>
          <Form.Group>
            <Form.Label htmlFor="mapType">Map type</Form.Label>
            <Form.Control id="mapType" as="select" value={ty}
              disabled={newMapControlsDisabled}
              onChange={e => setTy(e.target.value as MapType)}>
              <option>{MapType.Hex}</option>
              <option>{MapType.Square}</option>
            </Form.Control>
          </Form.Group>
          <Form.Group>
            <Form.Check type="checkbox" id="mapFfa" label="Free-for-all mode" checked={ffa}
              onChange={handleFfaChange} />
          </Form.Group>
        </Form>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={handleClose}>Close</Button>
        <Button disabled={isSaveDisabled} variant="primary" onClick={doHandleSave}>
          <BusyElement normal="Save map" busy="Saving..." isBusy={isSaving} />
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

export default MapEditorModal;