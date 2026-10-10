import * as React from 'react';

import ImagePlaceholder from './ImagePlaceholder';
import { useRetryingImageUrl } from '../hooks/useRetryingImageUrl';

import { IImage } from '@wallandshadow/shared';

interface IImageCollectionItemProps {
  image: IImage;
  style?: React.CSSProperties | undefined;
}

function ImageCollectionItem({ image, style }: IImageCollectionItemProps) {
  const imageState = useRetryingImageUrl(image.path);

  return (
    <div style={style}>
      {imageState?.status === 'loaded'
        ? <img crossOrigin="anonymous" className="App-image-collection-image" src={imageState.value} alt={image.name} />
        : imageState !== undefined && <ImagePlaceholder status={imageState.status} alt={image.name} style={{ height: '8rem' }} />}
      <p>{image.name}</p>
    </div>
  );
}

export default ImageCollectionItem;
