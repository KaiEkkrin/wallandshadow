import { useContext, useEffect, useState, useMemo } from 'react';
import * as React from 'react';

import { UserContext } from './UserContext';

import Card from 'react-bootstrap/Card';
import { from } from 'rxjs';

import { logError } from '../services/consoleLogger';

// Draws a card, with an image if one is available at the given path.

interface IImageCardProps {
  altName: string | undefined;
  imagePath: string | undefined;
  children?: React.ReactNode | undefined;
}

function ImageCardContent({ altName, imagePath, children }: IImageCardProps) {
  const { resolveImageUrl } = useContext(UserContext);
  const [url, setUrl] = useState<string | undefined>(undefined);

  // Resolve the image URL, if any
  useEffect(() => {
    if (!resolveImageUrl || !imagePath || imagePath.length === 0) {
      setUrl(undefined);
      return;
    }

    const sub = from(resolveImageUrl(imagePath)).subscribe(
      u => {
        console.debug(`got download URL for image ${imagePath} : ${u}`);
        setUrl(String(u));
      },
      e => logError("Failed to get download URL for image " + imagePath, e)
    );
    return () => sub.unsubscribe();
  }, [imagePath, setUrl, resolveImageUrl]);

  const contents = useMemo(
    () => (url) ? (<React.Fragment>
      <Card.Img src={url} alt={altName} style={{ maxHeight: '400px', objectFit: 'contain' }} />
      <Card.ImgOverlay style={{ textShadow: '2px 2px #000000' }}>
        {children}
      </Card.ImgOverlay>
    </React.Fragment>) : (
      <Card.Body>
        {children}
      </Card.Body>
    ),
    [altName, children, url]
  );

  return (
    <React.Fragment>
      {contents}
    </React.Fragment>
  );
}

export default ImageCardContent;