import { Fragment, useMemo } from 'react';

import { IImage } from '../data/image';

import Button from 'react-bootstrap/Button';
import Modal from 'react-bootstrap/Modal';
import ImageCollectionItem from './ImageCollectionItem';

interface IImageDeletionModalProps {
  image: IImage | undefined;
  show: boolean;
  handleClose: () => void;
  handleDelete: () => void;
}

function ImageDeletionModal(props: IImageDeletionModalProps) {
  const imageItem = useMemo(
    () => props.image === undefined ? <Fragment></Fragment> :
      <ImageCollectionItem image={props.image}
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}
      />,
    [props.image]
  );

  return (
    <Modal show={props.show} onHide={props.handleClose}>
      <Modal.Header closeButton>
        <Modal.Title>Delete image</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p>You are about to delete this image. This will remove it from any adventures and maps it is seen on, and it will no longer be available as a token image. Are you sure?</p>
        {imageItem}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={props.handleClose}>Close</Button>
        <Button variant="danger" onClick={props.handleDelete}>Yes, delete image!</Button>
      </Modal.Footer>
    </Modal>
  );
}

export default ImageDeletionModal;