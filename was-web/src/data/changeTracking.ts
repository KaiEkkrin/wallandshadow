import { IAnnotation } from "./annotation";
import { Change, ChangeCategory, ChangeType, AreaAdd, AreaRemove, PlayerAreaAdd, PlayerAreaRemove, TokenAdd, WallAdd, WallRemove, TokenRemove, TokenMove, NoteAdd, NoteRemove, createAreaAdd, createWallAdd, createNoteAdd, createTokenAdd, ImageAdd, ImageRemove, createImageAdd, createPlayerAreaAdd } from "./change";
import { GridCoord, GridEdge } from "./coord";
import { IFeature, IToken, IFeatureDictionary, ITokenDictionary, IAreaDictionary, StripedArea } from "./feature";
import { IMapImage } from "./image";
import { IMap } from "./map";
import { IUserPolicy } from "./policy";

import { v7 as uuidv7 } from 'uuid';
import fluent from "fluent-iterable";
import { IIdDictionary } from "./identified";

export interface IChangeTracker {
  objectCount: number;

  areaAdd: (feature: StripedArea) => boolean;
  areaRemove: (position: GridCoord) => StripedArea | undefined;
  playerAreaAdd: (feature: StripedArea) => boolean;
  playerAreaRemove: (position: GridCoord) => StripedArea | undefined;
  tokenAdd: (map: IMap, user: string, feature: IToken, oldPosition: GridCoord | undefined) => boolean;
  tokenRemove: (map: IMap, user: string, position: GridCoord, tokenId: string | undefined) => IToken | undefined;
  wallAdd: (feature: IFeature<GridEdge>) => boolean;
  wallRemove: (position: GridEdge) => IFeature<GridEdge> | undefined;
  noteAdd: (feature: IAnnotation) => boolean;
  noteRemove: (position: GridCoord) => IAnnotation | undefined;
  imageAdd: (image: IMapImage) => boolean;
  imageRemove: (id: string) => IMapImage | undefined;

  // Called after a batch of changes has been completed, before any redraw.
  changesApplied(): void;

  // Called after a batch of changes is aborted
  changesAborted(): void;

  // Gets a minimal collection of changes to add everything in this tracker.
  getConsolidated: () => Change[];
}

// A simple implementation for testing, etc.
export class SimpleChangeTracker implements IChangeTracker {
  private readonly _areas: IAreaDictionary;
  private readonly _playerAreas: IAreaDictionary;
  private readonly _tokens: ITokenDictionary;
  private readonly _outlineTokens: ITokenDictionary;
  private readonly _walls: IFeatureDictionary<GridEdge, IFeature<GridEdge>>;
  private readonly _notes: IFeatureDictionary<GridCoord, IAnnotation>;
  private readonly _images: IIdDictionary<IMapImage>;
  private readonly _userPolicy: IUserPolicy | undefined;

  private _objectCount = 0;

  constructor(
    areas: IAreaDictionary,
    playerAreas: IAreaDictionary,
    tokens: ITokenDictionary,
    outlineTokens: ITokenDictionary,
    walls: IFeatureDictionary<GridEdge, IFeature<GridEdge>>,
    notes: IFeatureDictionary<GridCoord, IAnnotation>,
    images: IIdDictionary<IMapImage>,
    userPolicy: IUserPolicy | undefined
  ) {
    this._areas = areas;
    this._playerAreas = playerAreas;
    this._tokens = tokens;
    this._outlineTokens = outlineTokens;
    this._walls = walls;
    this._notes = notes;
    this._images = images;
    this._userPolicy = userPolicy;
  }

  private policyAdd<F>(
    doAdd: () => boolean,
    doRemove: () => F | undefined
  ): boolean {
    const added = doAdd();
    if (added) {
      ++this._objectCount;
      if (this._userPolicy !== undefined && this._objectCount > this._userPolicy.objects) {
        // Oops
        this.policyRemove(doRemove);
        return false;
      }
    }

    return added;
  }

  private policyRemove<F>(doRemove: () => F | undefined) {
    const removed = doRemove();
    if (removed !== undefined) {
      --this._objectCount;
    }

    return removed;
  }

  get objectCount() { return this._objectCount; }

  areaAdd(feature: StripedArea) {
    return this.policyAdd(() => this._areas.add(feature), () => this._areas.remove(feature.position));
  }

  areaRemove(position: GridCoord) {
    return this.policyRemove(() => this._areas.remove(position));
  }

  clear() {
    this._areas.clear();
    this._playerAreas.clear();
    this._tokens.clear();
    this._outlineTokens.clear();
    this._walls.clear();
    this._notes.clear();
    this._images.clear();
    this._objectCount = 0;
  }

  playerAreaAdd(feature: StripedArea) {
    return this.policyAdd(() => this._playerAreas.add(feature), () => this._playerAreas.remove(feature.position));
  }

  playerAreaRemove(position: GridCoord) {
    return this.policyRemove(() => this._playerAreas.remove(position));
  }

  tokenAdd(_map: IMap, _user: string, feature: IToken, _oldPosition: GridCoord | undefined) {
    // Identify the right dictionary
    const dict = feature.outline ? this._outlineTokens : this._tokens;

    // Check for conflicts with walls
    for (const edge of dict.enumerateFillEdgePositions(feature)) {
      if (this._walls.get(edge) !== undefined) {
        return false;
      }
    }

    return this.policyAdd(() => dict.add(feature), () => dict.remove(feature.position));
  }

  tokenRemove(map: IMap, user: string, position: GridCoord, tokenId: string | undefined) {
    // We'll remove either the matching regular token or the matching outline token.
    // We require only one token to be removed this way, and complain if two were
    // (shouldn't happen, because only old software didn't fill out the token id?)
    const doRemove = (dict: ITokenDictionary) => {
      const removed = this.policyRemove(() => dict.remove(position));
      if (removed !== undefined && removed.id !== tokenId) {
        // Oops, ID mismatch, put it back!
        this.policyAdd(() => dict.add(removed), () => dict.remove(position));
        return undefined;
      }

      return removed;
    };

    const tokenRemoved = doRemove(this._tokens);
    const outlineTokenRemoved = doRemove(this._outlineTokens);
    if (tokenRemoved !== undefined && outlineTokenRemoved !== undefined) {
      // Confusion -- put them both back and complain
      this.policyAdd(() => this._tokens.add(tokenRemoved), () => this._tokens.remove(position));
      this.policyAdd(() => this._outlineTokens.add(outlineTokenRemoved), () => this._outlineTokens.remove(position));
      return undefined;
    }

    return tokenRemoved ?? outlineTokenRemoved;
  }

  wallAdd(feature: IFeature<GridEdge>) {
    // Stop us from overwriting a token with a wall
    if (this._tokens.hasFillEdge(feature.position) || this._outlineTokens.hasFillEdge(feature.position)) {
      return false;
    }

    return this.policyAdd(() => this._walls.add(feature), () => this._walls.remove(feature.position));
  }

  wallRemove(position: GridEdge) {
    return this.policyRemove(() => this._walls.remove(position));
  }

  noteAdd(feature: IAnnotation) {
    return this.policyAdd(() => this._notes.add(feature), () => this._notes.remove(feature.position));
  }

  noteRemove(position: GridCoord) {
    return this.policyRemove(() => this._notes.remove(position));
  }

  imageAdd(image: IMapImage) {
    return this.policyAdd(() => this._images.add(image), () => this._images.remove(image.id));
  }

  imageRemove(id: string) {
    return this.policyRemove(() => this._images.remove(id));
  }

  changesApplied() {
    return;
  }

  changesAborted() {
    return;
  }

  getConsolidated(): Change[] {
    const all: Change[] = [];
    const pushTokenAdd = (f: IToken) => {
      // `undefined` isn't supported in Firestore, so correct any token without
      // an id now
      if (f.id === undefined) {
        f.id = uuidv7();
      }

      return all.push(createTokenAdd(f));
    };

    this._areas.forEach(f => all.push(createAreaAdd(f)));
    this._playerAreas.forEach(f => all.push(createPlayerAreaAdd(f)));
    this._tokens.forEach(pushTokenAdd);
    this._outlineTokens.forEach(pushTokenAdd);
    this._walls.forEach(f => all.push(createWallAdd(f)));
    this._notes.forEach(f => all.push(createNoteAdd(f)));
    this._images.forEach(f => all.push(createImageAdd(f)));
    return all;
  }
}

// Helps work out the theoretical change in object count from a list of changes
export function netObjectCount(chs: Iterable<Change>) {
  return fluent(chs).map(ch => {
    switch (ch.ty) {
      case ChangeType.Add: return 1;
      case ChangeType.Remove: return -1;
      default: return 0;
    }
  }).sum();
}

// Handles a whole collection of (ordered) changes in one go, either applying or rejecting all.
export function trackChanges(map: IMap, tracker: IChangeTracker, chs: Iterable<Change>, user: string): boolean {
  // Begin applying each change (in practice, this does all the removes.)
  const applications: (IChangeApplication[]) = [];
  for (const c of chs) {
    const a = trackChange(map, tracker, c, user);
    if (a === undefined) {
      // Changes failed -- revert any previously applied and return with an error
      revertChanges(applications);
      tracker.changesAborted();
      return false;
    }

    applications.push(a);
  }

  // Complete applying all the changes
  if (continueApplications(applications) === true) {
    tracker.changesApplied();
    return true;
  }

  // If we got here, that failed and has been rolled back, but we still need to roll back
  // the first pass:
  revertChanges(applications);
  tracker.changesAborted();
  return false;
}

function continueApplications(applications: IChangeApplication[]): boolean {
  const revertFunctions: IRevert[] = [];
  for (const a of applications) {
    const revert = a.continue();
    if (revert === undefined) {
      // Changes failed -- revert any previously applied
      revertChanges(revertFunctions);
      return false;
    }

    revertFunctions.push(revert);
  }

  return true;
}

function revertChanges(revertFunctions: IRevert[]) {
  while (revertFunctions.length > 0) {
    const r = revertFunctions.pop();
    r?.revert();
  }
}

// Change tracking is a two-step process that can be reverted if any change fails at either step
// of the process.  This interface declares a change that has been accepted and that can be completed
// (returning a revert method) or reverted directly:
interface IChangeApplication extends IRevert {
  continue(): IRevert | undefined;
}

interface IRevert {
  revert(): void;
}

const doNothing: IRevert = {
  revert: () => undefined
}

// True for the map owner, or if the map is in free-for-all mode
function canDoAnything(map: IMap, user: string) {
  return map.ffa === true || user === map.owner;
}

// Interprets a change and issues the right command.  Returns a restore function in case
// we want to roll back to the previous state, or undefined if this change couldn't be applied.
// (For now, I'm going to be quite pedantic and reject even things like remove-twice, because
// I want to quickly detect any out-of-sync situations...)
function trackChange(map: IMap, tracker: IChangeTracker, ch: Change, user: string): IChangeApplication | undefined {
  switch (ch.cat) {
    case ChangeCategory.Area: return canDoAnything(map, user) ? trackAreaChange(map, tracker, ch, user) : undefined;
    case ChangeCategory.PlayerArea: return trackPlayerAreaChange(map, tracker, ch, user);
    case ChangeCategory.Token: return trackTokenChange(map, tracker, ch, user);
    case ChangeCategory.Wall: return canDoAnything(map, user) ? trackWallChange(tracker, ch) : undefined;
    case ChangeCategory.Note: return canDoAnything(map, user) ? trackNoteChange(tracker, ch) : undefined;
    case ChangeCategory.Image: return canDoAnything(map, user) ? trackImageChange(tracker, ch) : undefined;
    default: return undefined;
  }
}

function trackAreaChange(_map: IMap, tracker: IChangeTracker, ch: AreaAdd | AreaRemove, _user: string): IChangeApplication | undefined {
  switch (ch.ty) {
    case ChangeType.Add:
      return {
        revert: () => undefined,
        continue: function () {
          const added = tracker.areaAdd(ch.feature);
          return added ? {
            revert: function () {
              tracker.areaRemove(ch.feature.position);
            }
          } : undefined;
        }
      };

    case ChangeType.Remove: {
      const removed = tracker.areaRemove(ch.position);
      return removed === undefined ? undefined : {
        revert: function () {
          if (removed !== undefined) { tracker.areaAdd(removed); }
        },
        continue: function () { return doNothing; }
      };
    }

    default: return undefined;
  }
}

function trackPlayerAreaChange(_map: IMap, tracker: IChangeTracker, ch: PlayerAreaAdd | PlayerAreaRemove, _user: string): IChangeApplication | undefined {
  switch (ch.ty) {
    case ChangeType.Add:
      return {
        revert: () => undefined,
        continue: function () {
          const added = tracker.playerAreaAdd(ch.feature);
          return added ? {
            revert: function () {
              tracker.playerAreaRemove(ch.feature.position);
            }
          } : undefined;
        }
      };

    case ChangeType.Remove: {
      const removed = tracker.playerAreaRemove(ch.position);
      return removed === undefined ? undefined : {
        revert: function () {
          if (removed !== undefined) { tracker.playerAreaAdd(removed); }
        },
        continue: function () { return doNothing; }
      };
    }

    default: return undefined;
  }
}

function trackTokenChange(map: IMap, tracker: IChangeTracker, ch: TokenAdd | TokenMove | TokenRemove, user: string): IChangeApplication | undefined {
  switch (ch.ty) {
    case ChangeType.Add:
      return canDoAnything(map, user) ? {
        revert: () => undefined,
        continue: function () {
          const added = tracker.tokenAdd(map, user, ch.feature, undefined);
          return added ? {
            revert: function () {
              tracker.tokenRemove(map, user, ch.feature.position, ch.feature.id);
            }
          } : undefined;
        }
      } : undefined;

    case ChangeType.Remove: {
      if (!canDoAnything(map, user)) {
        return undefined;
      }
      const removed = tracker.tokenRemove(map, user, ch.position, ch.tokenId);
      return removed === undefined ? undefined : {
        revert: function () {
          if (removed !== undefined) { tracker.tokenAdd(map, user, removed, undefined); }
        },
        continue: function () { return doNothing; }
      }
    }

    case ChangeType.Move: {
      const moved = tracker.tokenRemove(map, user, ch.oldPosition, ch.tokenId);
      return moved === undefined ? undefined : {
        revert: function () {
          if (moved !== undefined) { tracker.tokenAdd(map, user, moved, undefined); }
        },
        continue: function () {
          // Check whether this user is allowed to move this token
          if (!canDoAnything(map, user) && moved?.players.find(p => p === user) === undefined) {
            return undefined;
          }

          const toAdd = { ...moved, position: ch.newPosition };
          const added = tracker.tokenAdd(map, user, toAdd, ch.oldPosition);
          return added ? {
            revert: function revert() {
              tracker.tokenRemove(map, user, ch.newPosition, ch.tokenId);
            }
          } : undefined;
        }
      };
    }

    default: return undefined;
  }
}

function trackWallChange(tracker: IChangeTracker, ch: WallAdd | WallRemove): IChangeApplication | undefined {
  switch (ch.ty) {
    case ChangeType.Add:
      return {
        revert: () => undefined,
        continue: function () {
          const added = tracker.wallAdd(ch.feature);
          return added ? {
            revert: function () {
              tracker.wallRemove(ch.feature.position);
            }
          } : undefined;
        }
      }

    case ChangeType.Remove: {
      const removed = tracker.wallRemove(ch.position);
      return removed === undefined ? undefined : {
        revert: function () {
          if (removed !== undefined) { tracker.wallAdd(removed); }
        },
        continue: function () { return doNothing; }
      }
    }

    default: return undefined;
  }
}

function trackNoteChange(tracker: IChangeTracker, ch: NoteAdd | NoteRemove): IChangeApplication | undefined {
  switch (ch.ty) {
    case ChangeType.Add:
      return {
        revert: () => undefined,
        continue: function () {
          const added = tracker.noteAdd(ch.feature);
          return added ? {
            revert: function () {
              tracker.noteRemove(ch.feature.position);
            }
          } : undefined;
        }
      }

    case ChangeType.Remove: {
      const removed = tracker.noteRemove(ch.position);
      return removed === undefined ? undefined : {
        revert: function () {
          if (removed !== undefined) { tracker.noteAdd(removed); }
        },
        continue: function () { return doNothing; }
      };
    }

    default: return undefined;
  }
}

function trackImageChange(tracker: IChangeTracker, ch: ImageAdd | ImageRemove): IChangeApplication | undefined {
  switch (ch.ty) {
    case ChangeType.Add:
      return {
        revert: () => undefined,
        continue: function() {
          const added = tracker.imageAdd(ch.feature);
          return added ? {
            revert: function() {
              tracker.imageRemove(ch.feature.id);
            }
          } : undefined;
        }
      }

    case ChangeType.Remove: {
      const removed = tracker.imageRemove(ch.id);
      return removed === undefined ? undefined : {
        revert: function() {
          if (removed !== undefined) { tracker.imageAdd(removed); }
        },
        continue: function() { return doNothing; }
      };
    }

    default: return undefined;
  }
}