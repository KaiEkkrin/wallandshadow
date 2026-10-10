import { useContext, useEffect, useState } from 'react';

import { UserContext } from '../components/UserContext';
import consoleLogger from '../services/consoleLogger';
import { LoadState, loadWithRetry } from '../services/loadWithRetry';

// Loads the image in the background, so that the <img> rendered once it has
// loaded is served from the browser's cache. crossOrigin must match that
// <img>'s, or the browser won't reuse the response.
function preloadImage(url: string, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const onAbort = () => {
      img.removeAttribute('src');
      reject(new DOMException('Image load aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    img.onload = () => {
      signal.removeEventListener('abort', onAbort);
      resolve(url);
    };
    img.onerror = () => {
      signal.removeEventListener('abort', onAbort);
      reject(new Error('The image failed to load'));
    };
    img.crossOrigin = 'anonymous';
    img.src = url;
  });
}

// Resolves an image path to a download URL that has been shown to load,
// retrying indefinitely (as map textures do) while it can't be. Returns
// undefined when there is no path, or no signed-in user to resolve it.
export function useRetryingImageUrl(path: string | undefined): LoadState<string> | undefined {
  const { resolveImageUrl } = useContext(UserContext);
  const [state, setState] = useState<LoadState<string> | undefined>(undefined);

  useEffect(() => {
    if (resolveImageUrl === undefined || path === undefined || path.length === 0) {
      setState(undefined);
      return undefined;
    }

    const sub = loadWithRetry(
      signal => resolveImageUrl(path).then(url => preloadImage(url, signal)),
      { description: `image ${path}`, logger: consoleLogger }
    ).subscribe(setState);
    return () => sub.unsubscribe();
  }, [path, resolveImageUrl]);

  return state;
}
