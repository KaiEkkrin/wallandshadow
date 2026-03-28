import { useContext, useEffect, useState } from 'react';
import * as React from 'react';

import { AnalyticsContext } from './AnalyticsContext';
import { UserContext } from './UserContext';

import { IImage } from '../data/image';

import { from } from 'rxjs';

interface IImageCollectionItemProps {
  image: IImage;
  style?: React.CSSProperties | undefined;
}

function ImageCollectionItem({ image, style }: IImageCollectionItemProps) {
  const { logError } = useContext(AnalyticsContext);
  const { storageService } = useContext(UserContext);
  const [url, setUrl] = useState("");

  useEffect(() => {
    if (!storageService) {
      return;
    }

    const sub = from(storageService.ref(image.path).getDownloadURL()).subscribe(
      u => setUrl(String(u)),
      e => logError("Failed to get download URL for image " + image.path, e)
    );
    return () => sub.unsubscribe();
  }, [logError, storageService, image, setUrl]);

  return (
    <div style={style}>
      <img className="App-image-collection-image" src={url} alt={image.name} />
      <p>{image.name}</p>
    </div>
  );
}

export default ImageCollectionItem;