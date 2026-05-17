import { useContext, useEffect, useState } from 'react';
import * as React from 'react';

import { UserContext } from './UserContext';

import { IImage } from '@wallandshadow/shared';

import { from } from 'rxjs';

import { logError } from '../services/consoleLogger';

interface IImageCollectionItemProps {
  image: IImage;
  style?: React.CSSProperties | undefined;
}

function ImageCollectionItem({ image, style }: IImageCollectionItemProps) {
  const { resolveImageUrl } = useContext(UserContext);
  const [url, setUrl] = useState("");

  useEffect(() => {
    if (!resolveImageUrl) {
      return;
    }

    const sub = from(resolveImageUrl(image.path)).subscribe(
      u => setUrl(String(u)),
      e => logError("Failed to get download URL for image " + image.path, e)
    );
    return () => sub.unsubscribe();
  }, [resolveImageUrl, image, setUrl]);

  return (
    <div style={style}>
      {url && <img crossOrigin="anonymous" className="App-image-collection-image" src={url} alt={image.name} />}
      <p>{image.name}</p>
    </div>
  );
}

export default ImageCollectionItem;