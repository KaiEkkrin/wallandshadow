import { Fragment, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import ImageCollectionItem from './ImageCollectionItem';
import { ImagePickerForm } from './ImagePickerModal';
import { ProfileContext } from './ProfileContext';
import { IImage, IMapImageProperties, MapImageRotation } from '../data/image';
import { getUserPolicy } from '../data/policy';

import Button from 'react-bootstrap/Button';
import Form from 'react-bootstrap/Form';
import Modal from 'react-bootstrap/Modal';

import { v7 as uuidv7 } from 'uuid';

interface IMapImageEditorProps {
  show: boolean;
  mapImage: IMapImageProperties | undefined;
  handleClose: () => void;
  handleDelete: (id: string) => void;
  handleImageDelete: (image: IImage | undefined) => void;
  handleSave: (mapImage: IMapImageProperties) => void;
}

function MapImageEditorModal(
  { show, mapImage, handleClose, handleDelete, handleImageDelete, handleSave }: IMapImageEditorProps
) {
  // This is of course quite similar to the image picker modal
  const { profile } = useContext(ProfileContext);
  const maxImages = useMemo(
    () => profile === undefined ? undefined : getUserPolicy(profile.level).images,
    [profile]
  );

  const [image, setImage] = useState<IImage | undefined>(undefined);
  const [rotation, setRotation] = useState<MapImageRotation>("0");

  // The active image is the image shown in the carousel, as distinct from the one chosen
  // for the map image
  const [activeImage, setActiveImage] = useState<IImage | undefined>(undefined);
  const [imageCount, setImageCount] = useState(0);
  const saveDisabled = useMemo(() => image === undefined, [image]);

  // Initialise the active image to the one in the map image record if we have one
  useEffect(() => {
    if (show) {
      setImage(mapImage?.image);
      setRotation(mapImage?.rotation ?? "0");
      setActiveImage(mapImage?.image);
    }
  }, [mapImage, setActiveImage, setImage, setRotation, show]);

  const currentImage = useMemo(() => {
    if (image === undefined) {
      return <p>No image selected.</p>;
    }

    return (
      <Fragment>
        Current image&nbsp;
        <ImageCollectionItem image={image} />
      </Fragment>
    );
  }, [image]);

  const useImageDisabled = useMemo(() => activeImage === undefined, [activeImage]);
  const handleUseImage = useCallback(() => {
    setImage(activeImage);
  }, [activeImage, setImage]);
  
  const doHandleSave = useCallback(() => {
    if (image === undefined) {
      return;
    }

    handleSave({
      id: mapImage === undefined ? uuidv7() : mapImage.id,
      image: image,
      rotation: rotation
    });
  }, [handleSave, image, mapImage, rotation]);

  const doHandleDelete = useCallback(() => {
    if (mapImage === undefined) {
      return;
    }

    handleDelete(mapImage.id);
  }, [handleDelete, mapImage]);

  const doHandleDeleteImage = useCallback(() => {
    if (activeImage === undefined) {
      return;
    }

    handleImageDelete(activeImage);
  }, [activeImage, handleImageDelete]);

  return (
    <Modal show={show} onHide={handleClose}>
      <Modal.Header closeButton>
        <Modal.Title>Map image ({imageCount}/{maxImages})</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {currentImage}
        <ImagePickerForm show={show} setActiveImage={setActiveImage} setImageCount={setImageCount}
          handleDelete={doHandleDeleteImage} />
        <Form>
          <Form.Group>
            <Form.Label htmlFor="mapImageRotation">Rotation</Form.Label>
            <Form.Control id="mapImageRotation" as="select" value={rotation}
              onChange={e => setRotation(e.target.value as MapImageRotation)}
            >
              <option>0</option>
              <option>90</option>
              <option>180</option>
              <option>270</option>
            </Form.Control>
          </Form.Group>
        </Form>
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
          <Button variant="primary" onClick={handleUseImage} disabled={useImageDisabled}>
            Use image
          </Button>
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="danger" onClick={doHandleDelete}>Delete</Button>
        <Button variant="secondary" onClick={handleClose}>Close</Button>
        <Button variant="primary" disabled={saveDisabled} onClick={doHandleSave}>Save</Button>
      </Modal.Footer>
    </Modal>
  );
}

export default MapImageEditorModal;