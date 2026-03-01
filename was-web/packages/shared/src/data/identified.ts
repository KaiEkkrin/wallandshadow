// Trivially describes a record with an identifier.
export interface IId {
  id: string;
}

export interface IIdentified<T> extends IId {
  record: T;
}

export interface IAdventureIdentified<T> extends IIdentified<T> {
  adventureId: string;
}

// A dictionary interface and basic type, with similar semantics to FeatureDictionary,
// for dictionaries where the key is a string id (such as images.)  I'm going to make it
// less generalised than FeatureDictionary for now and assume the id can always be used
// directly as a dictionary key.
export interface IIdDictionary<F extends IId> extends Iterable<F> {
  // Returns true if the feature wasn't already present (we added it), else false
  // (we didn't replace it.)
  add(f: F): boolean;

  // Removes everything
  clear(): void;

  // Returns a shallow copy of this dictionary
  clone(): IIdDictionary<F>;

  // Iterates over everything
  forEach(fn: (f: F) => void): void;

  // Gets an entry by id or undefined if it wasn't there
  get(k: string): F | undefined;

  // Iterates over the contents.
  iterate(): Iterable<F>;

  // Removes an entry, returning what it was or undefined if there wasn't one
  remove(k: string): F | undefined;
}

export class IdDictionary<F extends IId> implements IIdDictionary<F> {
  private readonly _values: Map<string, F>;

  constructor(values?: Map<string, F> | undefined) {
    this._values = values !== undefined ? new Map<string, F>(values) : new Map<string, F>();
  }

  protected get values() { return this._values; }

  [Symbol.iterator](): Iterator<F> {
    return this.iterate();
  }

  add(f: F) {
    if (this._values.has(f.id)) {
      return false;
    }

    this._values.set(f.id, f);
    return true;
  }

  clear() {
    this._values.clear();
  }

  clone(): IIdDictionary<F> {
    return new IdDictionary<F>(this._values);
  }

  forEach(fn: (f: F) => void) {
    this._values.forEach(fn);
  }

  get(k: string): F | undefined {
    return this._values.get(k);
  }

  *iterate() {
    for (const v of this._values) {
      yield v[1];
    }
  }

  remove(k: string): F | undefined {
    const value = this._values.get(k);
    if (value !== undefined) {
      this._values.delete(k);
      return value;
    }

    return undefined;
  }
}