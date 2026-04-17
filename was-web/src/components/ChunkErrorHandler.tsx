import { useEffect } from 'react';

// Session storage key to track last reload time
const CHUNK_ERROR_RELOAD_KEY = 'chunk_error_reload_time';

// Minimum interval between reloads to prevent loops (10 seconds)
const MIN_RELOAD_INTERVAL_MS = 10_000;

/**
 * Checks if an error is a chunk loading error.
 * These occur when Vite/Rollup code-split chunks are deleted after a new deployment.
 */
function isChunkError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const errorObj = error as { name?: string; message?: string };
  const name = errorObj.name || '';
  const message = errorObj.message || '';

  return (
    name === 'ChunkLoadError' ||
    message.includes('Failed to fetch dynamically imported module') ||
    message.includes('Loading chunk') ||
    message.includes('Loading CSS chunk')
  );
}

/**
 * Defense-in-depth handler for ChunkLoadError.
 *
 * This component:
 * 1. Listens for global error and unhandledrejection events
 * 2. Detects ChunkLoadError patterns from Vite/Rollup code splitting
 * 3. Triggers reload with sessionStorage-based loop prevention
 *
 * This catches cases where:
 * - The version listener hasn't connected yet
 * - The user is unauthenticated
 * - A new deployment happened mid-navigation to a lazy-loaded route
 *
 * The component renders nothing - it's purely for side effects.
 */
function ChunkErrorHandler() {
  useEffect(() => {
    const handleChunkError = (error: unknown) => {
      if (!isChunkError(error)) {
        return;
      }

      console.warn('[ChunkErrorHandler] Chunk load error detected:', error);

      // Check for reload loop
      const lastReloadTime = parseInt(
        sessionStorage.getItem(CHUNK_ERROR_RELOAD_KEY) || '0',
        10
      );
      const now = Date.now();

      if (now - lastReloadTime < MIN_RELOAD_INTERVAL_MS) {
        console.warn(
          '[ChunkErrorHandler] Reload attempted within',
          MIN_RELOAD_INTERVAL_MS,
          'ms - skipping to prevent loop'
        );
        return;
      }

      console.info('[ChunkErrorHandler] Reloading to fetch updated chunks');
      sessionStorage.setItem(CHUNK_ERROR_RELOAD_KEY, String(now));
      window.location.reload();
    };

    const handleError = (event: ErrorEvent) => {
      handleChunkError(event.error);
    };

    const handleRejection = (event: PromiseRejectionEvent) => {
      handleChunkError(event.reason);
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, []);

  // This component renders nothing
  return null;
}

export default ChunkErrorHandler;
