import { ILogger } from '@wallandshadow/shared';
import { EMPTY, filter, fromEvent, merge, Observable, Subscription } from 'rxjs';

// Loads something that can fail transiently (an image from object storage,
// typically) and keeps retrying forever, slowing down to one attempt every
// RETRY_MAX_DELAY_MS. A page left open through an object storage outage
// recovers on its own once the outage ends.

export type LoadState<T> =
  | { status: 'loading' }
  | { status: 'failed'; attempt: number; error: unknown }
  | { status: 'loaded'; value: T };

export const RETRY_BASE_DELAY_MS = 2000;
export const RETRY_MAX_DELAY_MS = 30 * 60 * 1000;
const RETRY_JITTER = 0.2;

// The delay before the retry that follows failed attempt number `attempt`
// (1-based): 2s, 4s, 8s ... capped at 30 minutes, each spread by up to ±20% so
// that clients that failed together don't retry together.
export function retryDelayMs(attempt: number, random: () => number = Math.random): number {
  const uncapped = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
  const delay = Math.min(uncapped, RETRY_MAX_DELAY_MS);
  return delay * (1 + RETRY_JITTER * (2 * random() - 1));
}

function reachesMaxDelay(attempt: number) {
  return RETRY_BASE_DELAY_MS * 2 ** (attempt - 1) >= RETRY_MAX_DELAY_MS;
}

// Emits when retrying straight away is worthwhile: the browser comes back
// online, or the tab becomes visible again after being left in the background.
export function createBrowserWake(): Observable<unknown> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return EMPTY;
  }

  return merge(
    fromEvent(window, 'online'),
    fromEvent(document, 'visibilitychange').pipe(filter(() => document.visibilityState === 'visible'))
  );
}

export interface ILoadWithRetryOptions<T> {
  // Names the thing being loaded in log messages.
  description: string;
  logger: Pick<ILogger, 'logWarning' | 'logError'>;
  // Called with a value that arrives after the subscriber has gone, so that
  // it can be released rather than leaked.
  discard?: ((value: T) => void) | undefined;
  wake?: Observable<unknown> | undefined;
  random?: (() => number) | undefined;
}

// Emits `loading`, then `failed` after each failed attempt, then `loaded` and
// completes. Never errors. Unsubscribing aborts the attempt in flight (via the
// signal passed to `attempt`) and cancels any pending retry.
export function loadWithRetry<T>(
  attempt: (signal: AbortSignal) => Promise<T>,
  options: ILoadWithRetryOptions<T>
): Observable<LoadState<T>> {
  const { description, logger, discard, random } = options;
  const wake = options.wake ?? createBrowserWake();

  return new Observable<LoadState<T>>(subscriber => {
    let closed = false;
    let failures = 0;
    let abort: AbortController | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let wakeSub: Subscription | undefined;

    const cancelPendingRetry = () => {
      clearTimeout(retryTimer);
      retryTimer = undefined;
      wakeSub?.unsubscribe();
      wakeSub = undefined;
    };

    const run = () => {
      cancelPendingRetry();
      const controller = new AbortController();
      abort = controller;
      Promise.resolve().then(() => attempt(controller.signal)).then(
        value => {
          if (closed) {
            discard?.(value);
            return;
          }

          subscriber.next({ status: 'loaded', value });
          subscriber.complete();
        },
        (error: unknown) => {
          if (closed) {
            return;
          }

          ++failures;
          const delay = retryDelayMs(failures, random);
          logger.logWarning(
            `Failed to load ${description} (attempt ${failures}); retrying in ${Math.round(delay / 1000)}s`,
            error
          );
          if (reachesMaxDelay(failures) && !reachesMaxDelay(failures - 1)) {
            logger.logError(
              `Still failing to load ${description} after ${failures} attempts; ` +
              `retrying every ${RETRY_MAX_DELAY_MS / 60000} minutes from now on`,
              error
            );
          }

          subscriber.next({ status: 'failed', attempt: failures, error });
          retryTimer = setTimeout(run, delay);
          wakeSub = wake.subscribe(run);
        }
      );
    };

    subscriber.next({ status: 'loading' });
    run();

    return () => {
      closed = true;
      cancelPendingRetry();
      abort?.abort();
    };
  });
}
