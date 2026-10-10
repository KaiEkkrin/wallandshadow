import * as React from 'react';

import ImagePlaceholder from './ImagePlaceholder';
import { useRetryingImageUrl } from '../hooks/useRetryingImageUrl';

import Card from 'react-bootstrap/Card';

// Draws a card, with an image if one is available at the given path.

interface IImageCardProps {
  altName: string | undefined;
  imagePath: string | undefined;
  children?: React.ReactNode | undefined;
}

function ImageCardContent({ altName, imagePath, children }: IImageCardProps) {
  const imageState = useRetryingImageUrl(imagePath);

  if (imageState === undefined) {
    return (
      <Card.Body>
        {children}
      </Card.Body>
    );
  }

  return (
    <React.Fragment>
      {imageState.status === 'loaded'
        ? <Card.Img crossOrigin="anonymous" src={imageState.value} alt={altName} style={{ maxHeight: '400px', objectFit: 'contain' }} />
        : <ImagePlaceholder status={imageState.status} alt={altName} className="card-img" style={{ height: '12rem' }} />}
      <Card.ImgOverlay style={{ textShadow: '2px 2px #000000' }}>
        {children}
      </Card.ImgOverlay>
    </React.Fragment>
  );
}

export default ImageCardContent;
