import { ICacheLease } from './interfaces';
import { ReplaySubject, firstValueFrom } from 'rxjs';
import { v7 as uuidv7 } from 'uuid';

export interface ICacheItem<T> {
  value: T;
  cleanup: () => void;
}

interface ICacheEntry<T> {
  entryId: string; // to distinguish multiple fetches of the same thing
  error?: { message: string, e: unknown } | undefined; // if undefined, we failed to fetch this
  obj?: ICacheItem<T> | undefined; // if undefined, wait for the subject
  subj: ReplaySubject<ICacheItem<T>>;
  refCount: number;
}

// TODO #149 unit test this carefully :) and then rewrite the download cache and texture cache
// in function of it (I guess simply merging those two into a single fetch function for this)
// The object cache caches a string-identified, asynchronously fetched object with disposal,
// trying to minimise the number of fetches.
export class ObjectCache<T> {
  private readonly _cache = new Map<string, ICacheEntry<T>>();
  private readonly _logError: (message: string, e: unknown) => void;

  constructor(logError: (message: string, e: unknown) => void) {
    this._logError = logError;
  }

  private async acquireEntry(id: string, entry: ICacheEntry<T>): Promise<ICacheLease<T>> {
    if (entry.error !== undefined) {
      throw Error(entry.error.message);
    }

    // console.debug(`acquire ${id}: refCount = ${entry.refCount}`);
    ++entry.refCount;
    if (entry.obj !== undefined) {
      return { value: entry.obj.value, release: this.createRelease(id, entry) };
    }

    const obj = await firstValueFrom(entry.subj);
    return { value: obj.value, release: this.createRelease(id, entry) };
  }

  private createRelease(id: string, entry: ICacheEntry<T>) {
    // We want a release function that only does it once to avoid messes with
    // accidental multi-release
    let done = false;
    return async () => {
      // console.debug(`releasing ${id}`);
      if (done) {
        return;
      }

      done = true;
      // console.debug(`release ${id}: refCount = ${entry.refCount}`);
      if (--entry.refCount === 0) {
        this.removeEntry(id, entry);
        try {
          (await firstValueFrom(entry.subj)).cleanup();
        } catch (e) {
          this._logError(`Error cleaning up ${id}`, e);
        }
      }
    };
  }

  private removeEntry(id: string, entry: ICacheEntry<T>) {
    const found = this._cache.get(id);
    if (found?.entryId !== entry.entryId) {
      return;
    }

    this._cache.delete(id);
  }

  get(id: string): ICacheLease<T> | undefined {
    const entry = this._cache.get(id);
    if (entry === undefined) {
      return undefined;
    }

    if (entry.error !== undefined) {
      throw Error(entry.error.message);
    }

    if (entry.obj === undefined) {
      return undefined;
    }

    // console.debug(`get: refCount = ${entry.refCount}`);
    ++entry.refCount;
    return { value: entry.obj.value, release: this.createRelease(id, entry) };
  }

  async resolve(id: string, fetch: (id: string) => Promise<ICacheItem<T>>): Promise<ICacheLease<T>> {
    // Try to fetch an existing entry:
    let entry = this._cache.get(id);
    while (entry !== undefined) {
      try {
        return await this.acquireEntry(id, entry);
      } catch (_e) {
        // Remove invalid entries so we can try again
        this.removeEntry(id, entry);

        // Because a different entry might have popped up during the async step,
        // we should re-fetch and have another go just in case
        entry = this._cache.get(id);
      }
    }

    // If we don't have an entry, fetch a new one:
    const newEntry: ICacheEntry<T> = {
      entryId: uuidv7(),
      subj: new ReplaySubject<ICacheItem<T>>(1),
      refCount: 0
    };
    this._cache.set(id, newEntry);
    fetch(id)
      .then(e => {
        newEntry.obj = e;
        newEntry.subj.next(e);
      })
      .catch(ex => {
        newEntry.error = { message: `Failed to fetch ${id}`, e: ex };
        newEntry.subj.error(newEntry.error);
      });

    // ...and wait
    try {
      return await this.acquireEntry(id, newEntry);
    } catch (e) {
      // Oh dear.  The opportunity to retry will be given, but not now
      this.removeEntry(id, newEntry);
      throw e;
    }
  }

  dispose() {
    const toDispose = [...this._cache];
    this._cache.clear();
    for (const [id, entry] of toDispose) {
      // It should be okay to start this dispose and let it go:
      if (entry.refCount > 0) {
        firstValueFrom(entry.subj)
          .then(o => o.cleanup())
          .then(() => console.debug(`disposed ${id}`))
          .catch(e => this._logError(`Error disposing ${id}`, e));
      }
    }
  }
}