import { useContext, useEffect, useMemo, useState } from 'react';
import * as React from 'react';

import { AdventureContext } from './AdventureContext';

import { ITokenProperties, fromSpriteGeometryString, ISprite, ISpritesheetEntry } from '@wallandshadow/shared';
import { logError } from '../services/consoleLogger';

// A pretty display of the image in a sprite for use in choosers etc.

interface ISpriteImageProps {
  sprite?: ISprite | undefined;
  token?: ITokenProperties | undefined;
  altName: string;
  className?: string | undefined;
  size?: number | undefined;
  border?: string | undefined;
  borderColour?: string | undefined;
  onClick?: (() => void) | undefined;
}

// TODO #149 Fix the hardwiring of spritesheet dimensions here (when I need different ones...)
const sheetSize = 1024;

function SpriteImage(
  { sprite, token, altName, className, size, border, borderColour, onClick }: ISpriteImageProps
) {
  const { spriteManager } = useContext(AdventureContext);

  // Resolve the sprite to display
  const [entry, setEntry] = useState<ISpritesheetEntry | undefined>(undefined);
  const [entryAltText, setEntryAltText] = useState("");
  useEffect(() => {
    setEntry(undefined);
    if (spriteManager === undefined) {
      return undefined;
    }

    if (token !== undefined) {
      const sub = spriteManager.lookupToken(token).subscribe(
        e => {
          setEntry(e);
          setEntryAltText(e.character?.name ?? token.text);
        },
        e => logError(`Failed to lookup token sprite for ${token.id}`, e)
      );
      return () => sub.unsubscribe();
    }

    if (sprite !== undefined) {
      setEntryAltText("");
      const sub = spriteManager.lookupSprite(sprite).subscribe(
        setEntry,
        e => logError(`Failed to lookup sprite ${sprite.source}`, e)
      );
      return () => sub.unsubscribe();
    }

    return undefined;
  }, [setEntry, sprite, spriteManager, token]);

  const alt = useMemo(
    () => entryAltText ? `${entryAltText} (${altName})` : altName,
    [altName, entryAltText]
  );

  // <img crossOrigin> rather than CSS background-image so the sheet URL is
  // fetched in CORS mode, matching Three.js's later load of the same URL — see #325.
  const layout = useMemo(() => {
    if (entry === undefined) {
      return undefined;
    }
    const { columns } = fromSpriteGeometryString(entry.sheet.geometry);
    const nativeSpriteSize = sheetSize / columns; // `rows` won't be different
    const tileSize = size ?? nativeSpriteSize;
    const imgSize = (sheetSize * tileSize) / nativeSpriteSize;
    const x = entry.position % columns;
    const y = Math.floor(entry.position / columns);
    return {
      tileSize,
      imgSize,
      offsetX: -x * tileSize,
      offsetY: -y * tileSize,
    };
  }, [entry, size]);

  const wrapperStyle: React.CSSProperties = useMemo(() => ({
    width: layout ? `${layout.tileSize}px` : size !== undefined ? `${size}px` : undefined,
    height: layout ? `${layout.tileSize}px` : size !== undefined ? `${size}px` : undefined,
    overflow: 'hidden',
    position: 'relative',
    display: 'inline-block',
    border: border ?? '4px solid',
    borderColor: borderColour,
    borderRadius: '50%',
  }), [border, borderColour, layout, size]);

  return (
    <div className={className} style={wrapperStyle} onClick={onClick} title={alt}>
      {entry && layout && (
        <img
          crossOrigin="anonymous"
          src={entry.url}
          alt={alt}
          style={{
            position: 'absolute',
            width: `${layout.imgSize}px`,
            height: `${layout.imgSize}px`,
            left: `${layout.offsetX}px`,
            top: `${layout.offsetY}px`,
            maxWidth: 'none',
          }}
        />
      )}
    </div>
  );
}

export default SpriteImage;
