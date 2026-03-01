import { IAnnotation } from "./annotation";
import { GridCoord, GridEdge } from "./coord";
import { IFeature, IToken, StripedArea } from "./feature";
import { IMapImage } from "./image";
import { Timestamp } from './types';

// This represents a collection of changes all made to the map at once.
export type Changes = {
  chs: Change[];
  timestamp: Timestamp | number; // initialise this to `serverTimestamp`;
                                 // use the number instead for testing only
  incremental: boolean;
  resync: boolean; // true if the recipient of this change should do a resync
                   // (only if incremental === false)
  user: string; // the uid that made these changes.
};

// This represents any change made to the map.
export type Change =
  AreaAdd | AreaRemove | PlayerAreaAdd | PlayerAreaRemove | TokenAdd | TokenMove | TokenRemove |
  WallAdd | WallRemove | NoteAdd | NoteRemove | ImageAdd | ImageRemove | NoChange;

export enum ChangeType {
  Add = 1,
  Move = 2, // only applies to tokens
  Remove = 3
}

export enum ChangeCategory {
  Undefined = 0, // included so we can provide a default change that does nothing
  Area = 1,
  Token = 2,
  Wall = 3,
  Note = 4,
  Image = 5,
  PlayerArea = 6
}

export type AreaAdd = {
  ty: ChangeType.Add;
  cat: ChangeCategory.Area;
  feature: StripedArea;
};

export type AreaRemove = {
  ty: ChangeType.Remove;
  cat: ChangeCategory.Area;
  position: GridCoord;
};

export type PlayerAreaAdd = {
  ty: ChangeType.Add;
  cat: ChangeCategory.PlayerArea;
  feature: StripedArea;
};

export type PlayerAreaRemove = {
  ty: ChangeType.Remove;
  cat: ChangeCategory.PlayerArea;
  position: GridCoord;
};

export type TokenAdd = {
  ty: ChangeType.Add;
  cat: ChangeCategory.Token;
  feature: IToken;
};

export type TokenMove = {
  ty: ChangeType.Move;
  cat: ChangeCategory.Token;
  newPosition: GridCoord;
  oldPosition: GridCoord;
  tokenId: string; // must match what's currently there
};

export type TokenRemove = {
  ty: ChangeType.Remove;
  cat: ChangeCategory.Token;
  position: GridCoord;
  tokenId: string; // must match what's currently there
};

export type WallAdd = {
  ty: ChangeType.Add;
  cat: ChangeCategory.Wall;
  feature: IFeature<GridEdge>;
};

export type WallRemove = {
  ty: ChangeType.Remove;
  cat: ChangeCategory.Wall;
  position: GridEdge;
};

export type NoteAdd = {
  ty: ChangeType.Add;
  cat: ChangeCategory.Note;
  feature: IAnnotation;
};

export type NoteRemove = {
  ty: ChangeType.Remove;
  cat: ChangeCategory.Note;
  position: GridCoord;
};

export type ImageAdd = {
  ty: ChangeType.Add;
  cat: ChangeCategory.Image;
  feature: IMapImage;
};

export type ImageRemove = {
  ty: ChangeType.Remove;
  cat: ChangeCategory.Image;
  id: string;
};

export type NoChange = {
  ty: ChangeType.Add;
  cat: ChangeCategory.Undefined;
};

export const defaultChange: NoChange = { ty: ChangeType.Add, cat: ChangeCategory.Undefined };

export function createAreaAdd(feature: StripedArea): AreaAdd {
  return {
    ty: ChangeType.Add,
    cat: ChangeCategory.Area,
    feature: feature
  };
}

export function createAreaRemove(position: GridCoord): AreaRemove {
  return {
    ty: ChangeType.Remove,
    cat: ChangeCategory.Area,
    position: position
  };
}

export function createPlayerAreaAdd(feature: StripedArea): PlayerAreaAdd {
  return {
    ty: ChangeType.Add,
    cat: ChangeCategory.PlayerArea,
    feature: feature
  };
}

export function createPlayerAreaRemove(position: GridCoord): PlayerAreaRemove {
  return {
    ty: ChangeType.Remove,
    cat: ChangeCategory.PlayerArea,
    position: position
  };
}

export function createTokenAdd(feature: IToken): TokenAdd {
  return {
    ty: ChangeType.Add,
    cat: ChangeCategory.Token,
    feature: feature
  };
}

export function createTokenMove(oldPosition: GridCoord, newPosition: GridCoord, tokenId: string): TokenMove {
  return {
    ty: ChangeType.Move,
    cat: ChangeCategory.Token,
    oldPosition: oldPosition,
    newPosition: newPosition,
    tokenId: tokenId
  };
}

export function createTokenRemove(position: GridCoord, tokenId: string): TokenRemove {
  return {
    ty: ChangeType.Remove,
    cat: ChangeCategory.Token,
    position: position,
    tokenId: tokenId
  };
}

export function createWallAdd(feature: IFeature<GridEdge>): WallAdd {
  return {
    ty: ChangeType.Add,
    cat: ChangeCategory.Wall,
    feature: feature
  };
}

export function createWallRemove(position: GridEdge): WallRemove {
  return {
    ty: ChangeType.Remove,
    cat: ChangeCategory.Wall,
    position: position
  };
}

export function createNoteAdd(feature: IAnnotation): NoteAdd {
  return {
    ty: ChangeType.Add,
    cat: ChangeCategory.Note,
    feature: feature
  };
}

export function createNoteRemove(position: GridCoord): NoteRemove {
  return {
    ty: ChangeType.Remove,
    cat: ChangeCategory.Note,
    position: position
  };
}

export function createImageAdd(feature: IMapImage): ImageAdd {
  return {
    ty: ChangeType.Add,
    cat: ChangeCategory.Image,
    feature: feature
  };
}

export function createImageRemove(imageId: string): ImageRemove {
  return {
    ty: ChangeType.Remove,
    cat: ChangeCategory.Image,
    id: imageId
  };
}