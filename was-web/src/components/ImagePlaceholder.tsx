import * as React from 'react';

// Stands in for an image that hasn't loaded yet, or is failing to load and
// being retried, so that it reads as "on its way" rather than missing. Matches
// the map's image placeholders: grey stripes while loading, amber on failure.

interface IImagePlaceholderProps {
  status: 'loading' | 'failed';
  alt: string | undefined;
  className?: string | undefined;
  style?: React.CSSProperties | undefined;
}

function ImagePlaceholder({ status, alt, className, style }: IImagePlaceholderProps) {
  const classes = [
    'App-image-placeholder',
    status === 'failed' ? 'App-image-placeholder-failed' : undefined,
    className
  ].filter(c => c !== undefined).join(' ');

  return (
    <div
      className={classes}
      style={style}
      role="img"
      aria-label={alt}
      title={status === 'failed' ? 'This image is having trouble loading. Retrying automatically.' : undefined}
    />
  );
}

export default ImagePlaceholder;
