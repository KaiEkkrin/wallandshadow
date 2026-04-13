import { IAdventure, IMapSummary, IPlayer } from '../data/adventure';
import { IAnnotation, defaultAnnotation } from '../data/annotation';
import { Change, Changes, ChangeType, ChangeCategory, TokenAdd, TokenMove, TokenRemove, AreaAdd, AreaRemove, NoteAdd, NoteRemove, WallAdd, WallRemove, ImageAdd, ImageRemove, defaultChange, PlayerAreaAdd, PlayerAreaRemove } from '../data/change';
import { ICharacter, maxCharacters } from '../data/character';
import { GridCoord, defaultGridCoord, GridEdge, defaultGridEdge, coordString, defaultGridVertex } from '../data/coord';
import { IToken, defaultToken, IFeature, defaultStripedArea, defaultWall, IFeatureDictionary, IIdFeature, FeatureDictionary, parseTokenSize, StripedArea } from '../data/feature';
import { Anchor, defaultAnchor, defaultMapImage, IImage, IImages, IMapImage, NoAnchor, PixelAnchor, VertexAnchor } from '../data/image';
import { IInvite } from '../data/invite';
import { IMap, MapType } from '../data/map';
import { IAdventureSummary, IProfile } from '../data/profile';
import { UserLevel } from '../data/policy';
import { defaultSpriteGeometry, ISprite, ISpritesheet, toSpriteGeometryString } from '../data/sprite';

import { v7 as uuidv7 } from 'uuid';

// Converts raw data from Firestore to data matching the given interface,
// filling in the missing properties with default values.
export interface IConverter<T> {
  convert(rawData: Record<string, unknown>): T;
}

// This is the simplest possible shallow conversion.
// Use this when we don't have any structure data that needs to be recursed
// into, or where we just don't care because the data format has never changed
class ShallowConverter<T> implements IConverter<T> {
  private readonly _defaultValue: T;

  constructor(defaultValue: T) {
    this._defaultValue = defaultValue;
  }

  convert(rawData: Record<string, unknown>): T {
    return { ...this._defaultValue, ...rawData } as T;
  }
}

// The recursing converter helps provide special-case conversion for named fields.
class RecursingConverter<T> extends ShallowConverter<T> {
  private readonly _specialCases: { [name: string]: (converted: T, raw: Record<string, unknown>) => T };

  constructor(defaultValue: T, specialCases: { [name: string]: (converted: T, raw: Record<string, unknown>) => T }) {
    super(defaultValue);
    this._specialCases = specialCases;
  }

  convert(rawData: Record<string, unknown>): T {
    let converted = super.convert(rawData);
    for (const c in this._specialCases) {
      const raw = c in rawData ? (rawData[c] as Record<string, unknown>) : {};
      converted = this._specialCases[c](converted, raw);
    }

    return converted;
  }
}

// We provide some special conversion for raw data that lacks token ids, which attempts
// to assign unique ids to them based on position tracking:
class AddTokenFeatureConverter extends RecursingConverter<IToken> {
  private readonly _newTokenDict: IFeatureDictionary<GridCoord, IIdFeature<GridCoord>>;

  constructor(newTokenDict: IFeatureDictionary<GridCoord, IIdFeature<GridCoord>>) {
    super(defaultToken, {
      "position": (conv, raw) => {
        conv.position = gridCoordConverter.convert(raw);
        return conv;
      },
      "size": (conv, raw) => {
        // raw comes from rawData["size"] which should be a string, but is typed as Record<string, unknown>
        // We need to handle both cases: when it's actually a string and when it's an empty object (default)
        const sizeValue = typeof raw === 'string' ? raw : (raw as unknown as string);
        conv.size = parseTokenSize(sizeValue ?? "1");
        return conv;
      },
      "sprites": (conv, raw) => {
        conv.sprites = Array.isArray(raw) ? raw.map(r => spriteConverter.convert(r)) : [];
        return conv;
      }
    });
    this._newTokenDict = newTokenDict;
  }

  convert(rawData: Record<string, unknown>): IToken {
    const feature = super.convert(rawData);
    if (feature.id === defaultToken.id) {
      // This is an add; we generate a new id and add it to the dictionary.
      feature.id = uuidv7();
      this._newTokenDict.add(feature);
    }

    return feature;
  }
}

class TokenMoveConverter extends RecursingConverter<TokenMove> {
  private readonly _newTokenDict: IFeatureDictionary<GridCoord, IIdFeature<GridCoord>>;

  constructor(newTokenDict: IFeatureDictionary<GridCoord, IIdFeature<GridCoord>>) {
    super({
      ty: ChangeType.Move,
      cat: ChangeCategory.Token,
      newPosition: defaultGridCoord,
      oldPosition: defaultGridCoord,
      tokenId: ""
    }, {
      "newPosition": (conv, raw) => {
        conv.newPosition = gridCoordConverter.convert(raw);
        return conv;
      },
      "oldPosition": (conv, raw) => {
        conv.oldPosition = gridCoordConverter.convert(raw);
        return conv;
      }
    });
    this._newTokenDict = newTokenDict;
  }

  convert(rawData: Record<string, unknown>): TokenMove {
    const move = super.convert(rawData);
    if (move.tokenId === "") {
      // We should be able to find a token id for the old position in the new
      // token dictionary.  We'll move it to the new position:
      const newToken = this._newTokenDict.remove(move.oldPosition);
      if (newToken !== undefined) {
        move.tokenId = newToken.id;
        this._newTokenDict.add({ ...newToken, position: move.newPosition });
      }
    }

    return move;
  }
}

class TokenRemoveConverter extends RecursingConverter<TokenRemove> {
  private readonly _newTokenDict: IFeatureDictionary<GridCoord, IIdFeature<GridCoord>>;

  constructor(newTokenDict: IFeatureDictionary<GridCoord, IIdFeature<GridCoord>>) {
    super({
      ty: ChangeType.Remove,
      cat: ChangeCategory.Token,
      position: defaultGridCoord,
      tokenId: ""
    }, {
      "position": (conv, raw) => {
        conv.position = gridCoordConverter.convert(raw);
        return conv;
      }
    });
    this._newTokenDict = newTokenDict;
  }

  convert(rawData: Record<string, unknown>): TokenRemove {
    const remove = super.convert(rawData);
    if (remove.tokenId === "") {
      // We should be able to find a token id for this position in the new
      // token dictionary.  We remove it, so that any other token added or moved
      // there later gets its own new id
      const newToken = this._newTokenDict.remove(remove.position);
      if (newToken !== undefined) {
        remove.tokenId = newToken.id;
      }
    }

    return remove;
  }
}

// The change converter does different things depending on the flags.
// I've been super pedantic here, which I don't technically need to be right now
// (except for the token id), but it will prove helpful later on if I alter
// more things (and should also be good for security, because it will make a
// well-behaving client less inclined to believe a malicious one.)
class ChangeConverter extends ShallowConverter<Change> {
  private readonly _tokenAddConverter: IConverter<TokenAdd>;
  private readonly _tokenMoveConverter: IConverter<TokenMove>;
  private readonly _tokenRemoveConverter: IConverter<TokenRemove>;

  constructor(newTokenDict: IFeatureDictionary<GridCoord, IIdFeature<GridCoord>>) {
    super(defaultChange);
    this._tokenAddConverter = createTokenAddConverter(newTokenDict);
    this._tokenMoveConverter = new TokenMoveConverter(newTokenDict);
    this._tokenRemoveConverter = new TokenRemoveConverter(newTokenDict);
  }

  private convertArea(converted: Change, rawData: Record<string, unknown>): Change {
    switch (converted.ty) {
      case ChangeType.Add: return areaAddConverter.convert(rawData);
      case ChangeType.Remove: return areaRemoveConverter.convert(rawData);
      default: return defaultChange;
    }
  }

  private convertPlayerArea(converted: Change, rawData: Record<string, unknown>): Change {
    switch (converted.ty) {
      case ChangeType.Add: return playerAreaAddConverter.convert(rawData);
      case ChangeType.Remove: return playerAreaRemoveConverter.convert(rawData);
      default: return defaultChange;
    }
  }

  private convertImage(converted: Change, rawData: Record<string, unknown>): Change {
    switch (converted.ty) {
      case ChangeType.Add: return imageAddConverter.convert(rawData);
      case ChangeType.Remove: return imageRemoveConverter.convert(rawData);
      default: return defaultChange;
    }
  }

  private convertNote(converted: Change, rawData: Record<string, unknown>): Change {
    switch (converted.ty) {
      case ChangeType.Add: return noteAddConverter.convert(rawData);
      case ChangeType.Remove: return noteRemoveConverter.convert(rawData);
      default: return defaultChange;
    }
  }

  private convertToken(converted: Change, rawData: Record<string, unknown>): Change {
    switch (converted.ty) {
      case ChangeType.Add: return this._tokenAddConverter.convert(rawData);
      case ChangeType.Move: return this._tokenMoveConverter.convert(rawData);
      case ChangeType.Remove: return this._tokenRemoveConverter.convert(rawData);
      default: return defaultChange;
    }
  }

  private convertWall(converted: Change, rawData: Record<string, unknown>): Change {
    switch (converted.ty) {
      case ChangeType.Add: return wallAddConverter.convert(rawData);
      case ChangeType.Remove: return wallRemoveConverter.convert(rawData);
      default: return defaultChange;
    }
  }

  convert(rawData: Record<string, unknown>): Change {
    const converted = super.convert(rawData);
    switch (converted.cat) {
      case ChangeCategory.Area: return this.convertArea(converted, rawData);
      case ChangeCategory.PlayerArea: return this.convertPlayerArea(converted, rawData);
      case ChangeCategory.Image: return this.convertImage(converted, rawData);
      case ChangeCategory.Note: return this.convertNote(converted, rawData);
      case ChangeCategory.Token: return this.convertToken(converted, rawData);
      case ChangeCategory.Wall: return this.convertWall(converted, rawData);
      default: return defaultChange;
    }
  }
}

const areaAddConverter = new RecursingConverter<AreaAdd>({
  ty: ChangeType.Add,
  cat: ChangeCategory.Area,
  feature: defaultStripedArea
}, {
  "feature": (conv, raw) => {
    conv.feature = areaConverter.convert(raw);
    return conv;
  }
});

const areaRemoveConverter = new RecursingConverter<AreaRemove>({
  ty: ChangeType.Remove,
  cat: ChangeCategory.Area,
  position: defaultGridCoord
}, {
  "position": (conv, raw) => {
    conv.position = gridCoordConverter.convert(raw);
    return conv;
  }
});

const playerAreaAddConverter = new RecursingConverter<PlayerAreaAdd>({
  ty: ChangeType.Add,
  cat: ChangeCategory.PlayerArea,
  feature: defaultStripedArea
}, {
  "feature": (conv, raw) => {
    conv.feature = areaConverter.convert(raw);
    return conv;
  }
});

const playerAreaRemoveConverter = new RecursingConverter<PlayerAreaRemove>({
  ty: ChangeType.Remove,
  cat: ChangeCategory.PlayerArea,
  position: defaultGridCoord
}, {
  "position": (conv, raw) => {
    conv.position = gridCoordConverter.convert(raw);
    return conv;
  }
});

const noteAddConverter = new RecursingConverter<NoteAdd>({
  ty: ChangeType.Add,
  cat: ChangeCategory.Note,
  feature: defaultAnnotation
}, {
  "feature": (conv, raw) => {
    conv.feature = annotationConverter.convert(raw);
    return conv;
  }
});

const noteRemoveConverter = new RecursingConverter<NoteRemove>({
  ty: ChangeType.Remove,
  cat: ChangeCategory.Note,
  position: defaultGridCoord
}, {
  "position": (conv, raw) => {
    conv.position = gridCoordConverter.convert(raw);
    return conv;
  }
});

const imageAddConverter = new RecursingConverter<ImageAdd>({
  ty: ChangeType.Add,
  cat: ChangeCategory.Image,
  feature: defaultMapImage
}, {
  "feature": (conv, raw) => {
    conv.feature = mapImageConverter.convert(raw);
    return conv;
  }
});

const imageRemoveConverter = new ShallowConverter<ImageRemove>({
  ty: ChangeType.Remove,
  cat: ChangeCategory.Image,
  id: ""
});

function createTokenAddConverter(newTokenDict: IFeatureDictionary<GridCoord, IIdFeature<GridCoord>>) {
  const featureConverter = new AddTokenFeatureConverter(newTokenDict);
  return new RecursingConverter<TokenAdd>({
    ty: ChangeType.Add,
    cat: ChangeCategory.Token,
    feature: defaultToken
  }, {
    "feature": (conv, raw) => {
      conv.feature = featureConverter.convert(raw);
      return conv;
    }
  });
}

const wallAddConverter = new RecursingConverter<WallAdd>({
  ty: ChangeType.Add,
  cat: ChangeCategory.Wall,
  feature: defaultWall
}, {
  "feature": (conv, raw) => {
    conv.feature = wallConverter.convert(raw);
    return conv;
  }
});

const wallRemoveConverter = new RecursingConverter<WallRemove>({
  ty: ChangeType.Remove,
  cat: ChangeCategory.Wall,
  position: defaultGridEdge
}, {
  "position": (conv, raw) => {
    conv.position = gridEdgeConverter.convert(raw);
    return conv;
  }
});

const annotationConverter = new RecursingConverter<IAnnotation>(defaultAnnotation, {
  "position": (conv, raw) => {
    conv.position = gridCoordConverter.convert(raw);
    return conv;
  }
});

const areaConverter = new RecursingConverter<StripedArea>(defaultStripedArea, {
  "position": (conv, raw) => {
    conv.position = gridCoordConverter.convert(raw);
    return conv;
  }
});

const wallConverter = new RecursingConverter<IFeature<GridEdge>>(defaultWall, {
  "position": (conv, raw) => {
    conv.position = gridEdgeConverter.convert(raw);
    return conv;
  }
});

class AnchorConverter extends ShallowConverter<Anchor> {
  convert(rawData: Record<string, unknown>): Anchor {
    const converted = super.convert(rawData);
    switch (converted.anchorType) {
      case 'vertex': return vertexAnchorConverter.convert(rawData);
      case 'pixel': return pixelAnchorConverter.convert(rawData);
      default: return noAnchorConverter.convert(rawData);
    }
  }
}

const anchorConverter = new AnchorConverter(defaultAnchor);

const vertexAnchorConverter = new ShallowConverter<VertexAnchor>({ anchorType: 'vertex', position: defaultGridVertex });
const pixelAnchorConverter = new ShallowConverter<PixelAnchor>({ anchorType: 'pixel', x: 0, y: 0 });
const noAnchorConverter = new ShallowConverter<NoAnchor>(defaultAnchor);

const gridCoordConverter = new ShallowConverter<GridCoord>(defaultGridCoord);
const gridEdgeConverter = new ShallowConverter<GridEdge>(defaultGridEdge);

// *** EXPORTS ***

export const adventureSummaryConverter = new ShallowConverter<IAdventureSummary>({
  id: "",
  name: "",
  description: "",
  owner: "",
  ownerName: "",
  imagePath: ""
});

export const mapSummaryConverter = new ShallowConverter<IMapSummary>({
  id: "",
  adventureId: "",
  name: "",
  description: "",
  ty: MapType.Square,
  imagePath: ""
});

export const adventureConverter = new RecursingConverter<IAdventure>({
  name: "",
  description: "",
  owner: "",
  ownerName: "",
  maps: [],
  imagePath: ""
}, {
  "maps": (conv, raw) => {
    conv.maps = Array.isArray(raw) ? raw.map(r => mapSummaryConverter.convert(r)) : [];
    return conv;
  }
});

export const characterConverter = new RecursingConverter<ICharacter>({
  id: "",
  name: "",
  text: "",
  sprites: []
}, {
  "sprites": (conv, raw) => {
    conv.sprites = Array.isArray(raw) ? raw.map(r => spriteConverter.convert(r)) : [];
    return conv;
  }
});

export const inviteConverter = new ShallowConverter<IInvite>({
  adventureName: "",
  adventureId: "",
  owner: "",
  ownerName: "",
  timestamp: 0
});

export const imageConverter = new ShallowConverter<IImage>({
  name: "",
  path: ""
});

export const imagesConverter = new RecursingConverter<IImages>({
  images: [],
  lastError: ""
}, {
  "images": (conv, raw) => {
    conv.images = Array.isArray(raw) ? raw.map(r => imageConverter.convert(r)) : [];
    return conv;
  }
});

export const mapImageConverter = new RecursingConverter<IMapImage>({
  id: "",
  image: { name: "", path: "" },
  rotation: "0",
  start: defaultAnchor,
  end: defaultAnchor
}, {
  "image": (conv, raw) => {
    conv.image = imageConverter.convert(raw);
    return conv;
  },
  "start": (conv, raw) => {
    conv.start = anchorConverter.convert(raw);
    return conv;
  },
  "end": (conv, raw) => {
    conv.end = anchorConverter.convert(raw);
    return conv;
  }
});

export const mapConverter = new ShallowConverter<IMap>({
  adventureName: "",
  name: "",
  description: "",
  owner: "",
  ty: MapType.Square,
  ffa: false,
  imagePath: ""
});

export const playerConverter = new RecursingConverter<IPlayer>({
  id: "",
  name: "",
  description: "",
  owner: "",
  ownerName: "",
  playerId: "",
  playerName: "",
  allowed: true,
  imagePath: "",
  characters: []
}, {
  "characters": (conv, raw) => {
    const cs = Array.isArray(raw) ? raw.map(r => characterConverter.convert(r)) : [];

    // We enforce the maximum character count here
    conv.characters = cs.slice(0, Math.min(maxCharacters, cs.length));
    return conv;
  }
});

export const profileConverter = new RecursingConverter<IProfile>({
  name: "",
  email: "",
  level: UserLevel.Standard,
  adventures: [],
  latestMaps: []
}, {
  "adventures": (conv, raw) => {
    conv.adventures = Array.isArray(raw) ? raw.map(r => adventureSummaryConverter.convert(r)) : [];
    return conv;
  },
  "latestMaps": (conv, raw) => {
    conv.latestMaps = Array.isArray(raw) ? raw.map(r => mapSummaryConverter.convert(r)) : [];
    return conv;
  }
});

export function createChangesConverter() {
  const newTokenDict = new FeatureDictionary<GridCoord, IIdFeature<GridCoord>>(coordString);
  const changeConverter = new ChangeConverter(newTokenDict);
  return new RecursingConverter<Changes>({
    chs: [],
    timestamp: 0,
    incremental: true,
    resync: false,
    user: ""
  }, {
    "chs": (conv, raw) => {
      conv.chs = Array.isArray(raw) ? raw.map(r => changeConverter.convert(r)) : [];
      return conv;
    }
  });
}

export const spriteConverter = new ShallowConverter<ISprite>({
  source: "",
  geometry: toSpriteGeometryString(defaultSpriteGeometry)
});

export const spritesheetConverter = new ShallowConverter<ISpritesheet>({
  sprites: [],
  geometry: toSpriteGeometryString(defaultSpriteGeometry),
  freeSpaces: defaultSpriteGeometry.columns * defaultSpriteGeometry.rows,
  date: 0,
  supersededBy: "",
  refs: 0
});

// App version converter for version checking
export const appVersionConverter = new ShallowConverter<{ commit: string; version?: string }>({
  commit: "",
  version: ""
});