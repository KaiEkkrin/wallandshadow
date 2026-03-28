import { useCallback, useEffect, useState, useContext, useMemo } from 'react';

import { AnalyticsContext } from './AnalyticsContext';
import { UserContext } from './UserContext';

import { IMapSummary } from '../data/adventure';
import { IAdventureSummary } from '../data/profile';

import Button from 'react-bootstrap/Button';
import Form from 'react-bootstrap/Form';
import Modal from 'react-bootstrap/Modal';

import { useNavigate } from 'react-router-dom';

// The map clone modal is like the map editor modal but intentionally more limited.
// We only expect to be integrated into the adventure page, so we don't need to
// provide things like an adventure selection (for now).

interface IMapCloneModalProps {
  show: boolean;
  adventure: IAdventureSummary | undefined;
  sourceMap: IMapSummary | undefined;
  handleClose: () => void; // not called if we clone and redirect
}

function MapCloneModal({ show, adventure, sourceMap, handleClose }: IMapCloneModalProps) {
  const { logError } = useContext(AnalyticsContext);
  const { functionsService } = useContext(UserContext);
  const navigate = useNavigate();

  const [isSaving, setIsSaving] = useState(false);
  useEffect(() => {
    if (show === true) {
      setIsSaving(false);
    }
  }, [show, setIsSaving]);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const isSaveDisabled = useMemo(
    () => name.length === 0 || description.length === 0 || name === sourceMap?.name,
    [description, name, sourceMap]
  );

  const saveText = useMemo(() => isSaving ? "Cloning..." : "Clone map", [isSaving]);

  useEffect(() => {
    setName(sourceMap?.name ?? "");
    setDescription(sourceMap?.description ?? "");
    setIsSaving(false);
  }, [sourceMap, setDescription, setIsSaving, setName]);

  const handleSave = useCallback(() => {
    if (
      functionsService === undefined ||
      adventure === undefined ||
      sourceMap === undefined
    ) {
      return;
    }

    setIsSaving(true);
    functionsService.cloneMap(adventure.id, sourceMap.id, name, description)
      .then(mapId => navigate('/adventure/' + adventure?.id + '/map/' + mapId, { replace: true }))
      .catch(e => {
        handleClose();
        setIsSaving(false);
        logError("Failed to clone map " + sourceMap?.name, e);
      });
  }, [
    logError, description, navigate, name, setIsSaving, functionsService,
    adventure, handleClose, sourceMap
  ]);

  return (
    <Modal show={show} onHide={handleClose}>
      <Modal.Header closeButton>
        <Modal.Title>Clone map {sourceMap?.name}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Form>
          <Form.Group>
            <Form.Label htmlFor="mapNameInput">Map name</Form.Label>
            <Form.Control id="mapNameInput" type="text" maxLength={30} value={name}
              onChange={e => setName(e.target.value)} />
          </Form.Group>
          <Form.Group>
            <Form.Label htmlFor="mapDescriptionInput">Map description</Form.Label>
            <Form.Control id="mapDescriptionInput" as="textarea" rows={5} maxLength={300}
              value={description} onChange={e => setDescription(e.target.value)} />
          </Form.Group>
        </Form>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={handleClose}>Close</Button>
        <Button disabled={isSaveDisabled} variant="primary" onClick={handleSave}>{saveText}</Button>
      </Modal.Footer>
    </Modal>
  );
}

export default MapCloneModal;