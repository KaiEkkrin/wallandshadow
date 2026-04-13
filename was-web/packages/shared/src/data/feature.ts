import { GridCoord, defaultGridCoord, GridEdge, GridVertex, defaultGridEdge } from './coord';
import { ISprite } from './sprite';
import { v7 as uuidv7 } from 'uuid';

// Describes an instanced feature:
// (Must be possible to copy this with Object.assign)
export interface IFeature<K> {
  position: K;
  colour: number;
}

// Some features have a string id
export interface IIdFeature<K> extends IFeature<K> {
  id: string;
}

// Features with stripes (used for distinguishing player areas) will include this too
export type Striped = {
  stripe: number;
};

export type StripedArea = IFeature<GridCoord> & Striped;
export type IAreaDictionary = IFeatureDictionary<GridCoord, StripedArea>

// A token has some extra properties:
// (Remember to keep `parseTokenSize` below in sync with this definition if it changes)
export type TokenSize = "1" | "2" | "2 (left)" | "2 (right)" | "3" | "4" | "4 (left)" | "4 (right)";
export interface ITokenProperties {
  id: string; // a UUID for this token, that follows it around
  colour: number;
  players: string[]; // the uids of the players that can move this token
  size: TokenSize;
  text: string; // maximum of three characters
  note: string; // shown in the annotations UI
  noteVisibleToPlayers: boolean; // as you'd expect
  characterId: string; // empty if this isn't a character token
  sprites: ISprite[]; // should be only 0 or 1, but this format makes it easy for Firestore
  outline: boolean;
}

export const defaultTokenProperties: ITokenProperties = {
  colour: 0,
  id: uuidv7(),
  players: [],
  size: "1",
  text: "",
  note: "",
  noteVisibleToPlayers: false,
  characterId: "",
  sprites: [],
  outline: false
};

export function flipToken(token: ITokenProperties): ITokenProperties | undefined {
  if (token.size === '2 (left)') {
    return { ...token, size: '2 (right)' };
  } else if (token.size === '2 (right)') {
    return { ...token, size: '2 (left)' };
  } else if (token.size === '4 (left)') {
    return { ...token, size: '4 (right)' };
  } else if (token.size === '4 (right)') {
    return { ...token, size: '4 (left)' };
  } else {
    return undefined;
  }
}

export function parseTokenSize(s: string): TokenSize {
  if (/^[1-4]$/.test(s) || /^[24] \((left|right)\)$/.test(s)) {
    return s as TokenSize;
  } else {
    // fall back to the default value
    return "1";
  }
}

export interface IToken extends IIdFeature<GridCoord>, ITokenProperties {}

export const defaultStripedArea: StripedArea = {
  position: defaultGridCoord,
  colour: 0,
  stripe: 0
};

export const defaultToken: IToken = {
  position: defaultGridCoord,
  ...defaultTokenProperties
};

export const defaultWall: IFeature<GridEdge> = {
  position: defaultGridEdge,
  colour: 0
};

// Token text is positioned either at a coord or a vertex.  We can cheat slightly
// and use the vertex structure for the coord too, complete with the `atVertex` flag.
// This one is used only internally, derived from the token, and never added as part
// of a change.
export interface ITokenText extends IFeature<GridVertex> {
  atVertex: boolean,
  colour: number,
  size: number,
  yOffset: number, // in multiples of the bounding box
  text: string,
}

// The interface of a dictionary of these
export interface IFeatureDictionary<K extends GridCoord, F extends IFeature<K>> extends Iterable<F> {
  // The number of elements in the dictionary.
  size: number;

  // Returns true if the feature wasn't already present (we added it), else false
  // (we didn't replace it.)
  add(f: F): boolean;

  // Removes everything
  clear(): void;

  // Returns a shallow copy of this dictionary
  clone(): IFeatureDictionary<K, F>;

  // Iterates over everything
  forEach(fn: (f: F) => void): void;

  // Gets an entry by coord or undefined if it wasn't there
  get(k: K): F | undefined;

  // Iterates over the contents.
  iterate(): Iterable<F>;

  // Removes an entry, returning what it was or undefined if there wasn't one
  remove(k: K): F | undefined;
}

// A basic feature dictionary that can be re-used or extended
export class FeatureDictionary<K extends GridCoord, F extends IFeature<K>> implements IFeatureDictionary<K, F> {
  private readonly _toIndex: (coord: K) => string;
  private readonly _values: Map<string, F>;

  // This constructor copies the given values if defined.
  constructor(toIndex: (coord: K) => string, values?: Map<string, F> | undefined) {
    this._toIndex = toIndex;
    this._values = values !== undefined ? new Map<string, F>(values) : new Map<string, F>();
  }

  protected get values() { return this._values; }

  [Symbol.iterator](): Iterator<F> {
    return this.iterate();
  }

  get size(): number {
    return this._values.size;
  }

  add(f: F) {
    const i = this._toIndex(f.position);
    if (this._values.has(i)) {
      return false;
    }

    this._values.set(i, f);
    return true;
  }

  clear() {
    this._values.clear();
  }

  clone(): IFeatureDictionary<K, F> {
    return new FeatureDictionary<K, F>(this._toIndex, this._values);
  }

  forEach(fn: (f: F) => void) {
    this._values.forEach(fn);
  }

  get(k: K): F | undefined {
    const i = this._toIndex(k);
    return this._values.get(i);
  }

  *iterate() {
    for (const v of this._values) {
      yield v[1];
    }
  }

  remove(k: K): F | undefined {
    const i = this._toIndex(k);
    const value = this._values.get(i);
    if (value !== undefined) {
      this._values.delete(i);
      return value;
    }

    return undefined;
  }

  // This is deliberately not in the interface, because implementations that do other
  // things e.g. track drawn objects would need to do an add/remove operation to
  // update themselves
  set(f: F) {
    const i = this._toIndex(f.position);
    this._values.set(i, f);
  }
}

// #119: A token dictionary provides a distinction between:
// - The coords that tokens are homed at, and
// - The coords that are *occupied* by tokens, which is more in the case of larger tokens.
// Here we provide the latter in the form of the `at` method.  We also make it possible to
// look up tokens by id, which allows us to decouple a lot of the UI from token positioning.
export interface ITokenDictionary extends IFeatureDictionary<GridCoord, IToken> {
  // Returns the token that occupies this grid face, or undefined if none.
  // (Distinct from `get` which will only return a token if its native
  // position is the given one.)
  at(face: GridCoord): IToken | undefined;

  // The clone should produce a token dictionary
  clone(): ITokenDictionary;

  // Returns all the face positions of a given token.
  enumerateFacePositions(token: IToken): Iterable<GridCoord>;

  // Returns all the fill edge positions of a given token.
  // (Probably won't need calling externally.)
  enumerateFillEdgePositions(token: IToken): Iterable<GridEdge>;

  // Returns true if we have a fill edge here, else false.  (For checking for
  // conflicts with walls.)
  hasFillEdge(edge: GridEdge): boolean;

  // Returns the token with the given id, or undefined for none.
  ofId(id: string): IToken | undefined;
}