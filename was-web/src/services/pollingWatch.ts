/**
 * Polls a fetch function at a fixed interval and calls onNext only when the
 * returned data changes (compared via JSON serialization).
 *
 * Used by HonoDataService watch methods to provide near-real-time updates
 * for non-map data (adventures, players, spritesheets, etc.) that changes
 * infrequently and doesn't warrant a dedicated WebSocket channel.
 */
export class PollingWatch<T> {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastJson: string | null = null;
  private stopped = false;

  constructor(
    private readonly fetchFn: () => Promise<T>,
    private readonly onNext: (data: T) => void,
    private readonly onError?: (error: Error) => void,
    private readonly intervalMs: number = 5000,
  ) {
    this.poll(true);
  }

  /** Fetch, compare, notify, then schedule the next poll via setTimeout. */
  private async poll(isFirst: boolean): Promise<void> {
    try {
      const data = await this.fetchFn();
      const json = JSON.stringify(data);
      if (isFirst || json !== this.lastJson) {
        this.lastJson = json;
        if (!this.stopped) {
          this.onNext(data);
        }
      }
    } catch (e) {
      // Report errors on initial fetch so callers see startup failures.
      // On subsequent polls, stale data is better than an error state.
      if (isFirst && !this.stopped) {
        this.onError?.(e instanceof Error ? e : new Error(String(e)));
      }
    }
    if (!this.stopped) {
      this.timer = setTimeout(() => this.poll(false), this.intervalMs);
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
