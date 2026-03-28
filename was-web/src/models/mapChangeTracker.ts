import { MapColouring } from "./colouring";
import { IAnnotation } from "../data/annotation";
import { SimpleChangeTracker } from "../data/changeTracking";
import { GridCoord, GridEdge } from "../data/coord";
import { IFeatureDictionary, IFeature, IToken, ITokenDictionary, IAreaDictionary } from "../data/feature";
import { IIdDictionary } from "../data/identified";
import { IMapImage } from "../data/image";
import { IMap } from "../data/map";
import { IUserPolicy } from "../data/policy";

// This change tracker supports all our map features.
// The handleChangesApplied function receives true if there were any token changes
// or false if not -- to help expose the current token list to the React UI.
export class MapChangeTracker extends SimpleChangeTracker {
  private readonly _colouring: MapColouring | undefined;
  private readonly _handleChangesApplied: ((haveTokensChanged: boolean, objectCount: number) => void) | undefined;
  private readonly _handleChangesAborted: (() => void) | undefined;

  private _haveTokensChanged = false;

  constructor(
    areas: IAreaDictionary,
    playerAreas: IAreaDictionary,
    tokens: ITokenDictionary,
    outlineTokens: ITokenDictionary,
    walls: IFeatureDictionary<GridEdge, IFeature<GridEdge>>,
    notes: IFeatureDictionary<GridCoord, IAnnotation>,
    images: IIdDictionary<IMapImage>,
    userPolicy: IUserPolicy | undefined,
    colouring?: MapColouring | undefined,
    handleChangesApplied?: ((haveTokensChanged: boolean, objectCount: number) => void) | undefined,
    handleChangesAborted?: (() => void) | undefined
  ) {
    super(areas, playerAreas, tokens, outlineTokens, walls, notes, images, userPolicy);
    this._colouring = colouring;
    this._handleChangesApplied = handleChangesApplied;
    this._handleChangesAborted = handleChangesAborted;
  }

  clear() {
    super.clear();
    this._colouring?.clear();
  }

  tokenAdd(map: IMap, user: string, feature: IToken, oldPosition: GridCoord | undefined) {
    // If this is a move, `oldPosition` will be set.
    // In non-FFA mode, non-owners can only move a token within its bounded
    // map area (the map colour of the old position must be the same as the
    // map colour of the new)
    if (
      map.ffa === false && user !== map.owner && oldPosition !== undefined &&
      this._colouring?.colourOf(feature.position) !== this._colouring?.colourOf(oldPosition)
    ) {
      return false;
    }

    if (super.tokenAdd(map, user, feature, oldPosition) === false) {
      return false;
    }

    this._haveTokensChanged = true;
    return true;
  }

  tokenRemove(map: IMap, user: string, position: GridCoord, tokenId: string | undefined) {
    const removed = super.tokenRemove(map, user, position, tokenId);
    if (removed !== undefined) {
      this._haveTokensChanged = true;
    }

    return removed;
  }

  wallAdd(feature: IFeature<GridEdge>) {
    const added = super.wallAdd(feature);
    if (added) {
      this._colouring?.setWall(feature.position, true);
    }

    return added;
  }

  wallRemove(position: GridEdge) {
    const removed = super.wallRemove(position);
    if (removed !== undefined) {
      this._colouring?.setWall(position, false);
    }

    return removed;
  }

  changesApplied() {
    super.changesApplied();
    this._colouring?.recalculate();
    this._handleChangesApplied?.(this._haveTokensChanged, this.objectCount);
    this._haveTokensChanged = false;
  }

  changesAborted() {
    super.changesAborted();
    this._handleChangesAborted?.();
    this._haveTokensChanged = false;
  }
}