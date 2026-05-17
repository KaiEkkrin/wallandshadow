// This helper provides a string -> string cache where entries expire after
// the return of the expiry function.
// The default expiry is 1 second if none is supplied.
export class ExpiringStringCache {
  private readonly _cache = new Map<string, Promise<string>>();
  private readonly _waitExpire: () => Promise<void>;

  constructor(expiryMillis?: number | undefined) {
    this._waitExpire = (() => new Promise((resolve) => setTimeout(resolve, expiryMillis ?? 1000)));
  }

  async resolve(id: string, fetch: (id: string) => Promise<string>) {
    const entry = this._cache.get(id);
    if (entry !== undefined) {
      return entry;
    }

    const newEntry = fetch(id);
    this._cache.set(id, newEntry);
    // On success, evict after the expiry delay. On failure, evict immediately
    // (the `.catch`) so a rejected fetch is never pinned for the full expiry —
    // the next caller re-fetches rather than inheriting a stale rejection.
    newEntry.then(() => this._waitExpire()).then(() => this._cache.delete(id))
      .catch(() => this._cache.delete(id));
    return newEntry;
  }
}