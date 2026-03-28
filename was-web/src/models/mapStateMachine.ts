import { MapColouring } from './colouring';
import { FaceHighlighter, PlayerFaceHighlighter } from './dragHighlighter';
import { DragRectangle } from './dragRectangle';
import { getClientToWorld, getWorldToClient } from './extensions';
import { FeatureColour } from './featureColour';
import { IGridGeometry } from './gridGeometry';
import { IDrawing, IDragRectangle, Layer } from './interfaces';
import { ImageResizer } from './imageResizer';
import { MapChangeTracker } from './mapChangeTracker';
import { RedrawFlag } from './redrawFlag';
import { WallHighlighter, WallRectangleHighlighter, RoomHighlighter } from './wallHighlighter';

import { IAnnotation, IPositionedAnnotation } from '../data/annotation';
import { Change, createTokenRemove, createTokenAdd, createNoteRemove, createNoteAdd, createTokenMove, createImageAdd, createImageRemove } from '../data/change';
import { netObjectCount, trackChanges } from '../data/changeTracking';
import { GridCoord, coordString, coordsEqual, coordSub, coordAdd, GridVertex, vertexAdd } from '../data/coord';
import { FeatureDictionary, flipToken, IToken, ITokenDictionary, ITokenProperties, TokenSize, defaultToken } from '../data/feature';
import { IAdventureIdentified } from '../data/identified';
import { Anchor, anchorsEqual, anchorString, IMapImage, IMapImageProperties } from '../data/image';
import { LoSPosition } from '../data/losPosition';
import { IMap } from '../data/map';
import { IUserPolicy } from '../data/policy';
import { getTokenLoSPosition, ITokenGeometry } from '../data/tokenGeometry';
import { Tokens } from '../data/tokens';
import { TokensWithObservableText } from '../data/tokenTexts';

import { IDataService, ISpriteManager } from '../services/interfaces';
import { createDrawing } from './three/drawing';
import { DrawingOrtho } from './three/drawingOrtho';

import fluent from 'fluent-iterable';
import { Observable, ReplaySubject } from 'rxjs';
import * as THREE from 'three';

const noteAlpha = 0.9;
const tokenNoteAlpha = 0.6;

const panMargin = 100;
const panStep = 0.2; // per millisecond.  Try proportion of screen size instead?
const zoomStep = 1.001;
export const zoomMin = 1;
const zoomDefault = 2;
export const zoomMax = 4;

const panningPosition = new THREE.Vector3(panMargin, panMargin, 0);
const zAxis = new THREE.Vector3(0, 0, 1);

// Describes the map state as managed by the state machine below and echoed
// to the Map component.
export type MapState = {
  isOwner: boolean;
  seeEverything: boolean;
  annotations: IPositionedAnnotation[];
  tokens: (ITokenProperties & ISelectable)[];
  objectCount?: number | undefined; // undefined for irrelevant (no policy)
  zoom: number;
};

export interface ISelectable {
  selectable: boolean;
}

export function createDefaultState(): MapState {
  return {
    isOwner: true,
    seeEverything: true,
    annotations: [],
    tokens: [],
    objectCount: undefined,
    zoom: zoomDefault
  };
}

// Manages the mutable state associated with a map, so that it can be
// hidden from the React component, Map.tsx.  Create a new one on reload.
// (Creating new instances of everything whenever a change happens would
// be far too slow, or very complicated.)
// In cases where the React component needs to know about the live state
// of an aspect of the map, the MapState shall be the source of truth and
// echo it to the React component on change.  The React component needs to
// call into this in order to make changes.
// Any other mutable fields in here are state that the owning component should
// never find out about.
export class MapStateMachine {
  private readonly _dataService: IDataService;
  private readonly _uid: string;

  private readonly _drawing: IDrawing;
  private readonly _gridGeometry: IGridGeometry;
  private readonly _mapColouring: MapColouring;
  private readonly _notes: FeatureDictionary<GridCoord, IAnnotation>;
  private readonly _notesNeedUpdate = new RedrawFlag();
  private readonly _tokenGeometry: ITokenGeometry;

  private readonly _selection: ITokenDictionary;
  private readonly _selectionDrag: ITokenDictionary;
  private readonly _selectionDragRed: ITokenDictionary;
  private readonly _outlineSelection: ITokenDictionary;
  private readonly _outlineSelectionDrag: ITokenDictionary;
  private readonly _outlineSelectionDragRed: ITokenDictionary;

  private readonly _tokens: TokensWithObservableText;
  private readonly _outlineTokens: TokensWithObservableText;

  private readonly _dragRectangle: IDragRectangle;
  private readonly _faceHighlighter: FaceHighlighter;
  private readonly _playerFaceHighlighter: PlayerFaceHighlighter;
  private readonly _wallHighlighter: WallHighlighter;
  private readonly _wallRectangleHighlighter: WallRectangleHighlighter;
  private readonly _roomHighlighter: RoomHighlighter;
  private readonly _imageResizer: ImageResizer;

  private readonly _cameraTranslation = new THREE.Vector3();
  private readonly _cameraRotation = new THREE.Quaternion();
  private readonly _cameraScaling = new THREE.Vector3(zoomDefault, zoomDefault, 1);

  private readonly _defaultRotation = new THREE.Quaternion();
  private readonly _scratchRotation = new THREE.Quaternion();
  private readonly _scratchTranslation = new THREE.Vector3();

  private readonly _scratchMatrix1 = new THREE.Matrix4();
  private readonly _scratchMatrix2 = new THREE.Matrix4();

  private readonly _scratchVector1 = new THREE.Vector3();
  private readonly _scratchVector2 = new THREE.Vector3();
  private readonly _scratchVector3 = new THREE.Vector3();

  private readonly _stateSubj = new ReplaySubject<MapState>(1);

  private _map: IAdventureIdentified<IMap>;
  private _state: MapState;
  private _userPolicy: IUserPolicy | undefined;

  private _changeTracker: MapChangeTracker;

  private _lastAnimationTime: number | undefined;

  private _panningX = 0; // -1, 0 or 1 for which direction we're panning in
  private _panningY = 0; // likewise

  private _marginPanningX = 0; // the same, but when dragging to the margin rather than using keys
  private _marginPanningY = 0;

  private _isRotating = false;
  private _panLast: THREE.Vector3 | undefined;

  private _tokenMoveDragStart: GridCoord | undefined;
  private _tokenMoveJog: GridCoord | undefined;
  private _tokenMoveDragSelectionPosition: GridCoord | undefined;

  private _imageMoveDragStart = new THREE.Vector3(); // a client position
  private _imageMoveDragMode: 'vertex' | 'pixel' = 'vertex';
  private _inImageMoveDrag = false;

  private _isDisposed = false;

  constructor(
    dataService: IDataService,
    map: IAdventureIdentified<IMap>,
    uid: string,
    gridGeometry: IGridGeometry,
    tokenGeometry: ITokenGeometry,
    colours: FeatureColour[],
    userPolicy: IUserPolicy | undefined,
    logError: (message: string, e: unknown) => void,
    spriteManager: ISpriteManager,
    resolveImageUrl: (path: string) => Promise<string>
  ) {
    this._dataService = dataService;
    this._map = map;
    this._uid = uid;
    this._userPolicy = userPolicy;

    this._state = {
      isOwner: this.isOwner,
      seeEverything: this.seeEverything,
      annotations: [],
      tokens: [],
      objectCount: undefined,
      zoom: zoomDefault
    };
    this._stateSubj.next(this._state);

    this._gridGeometry = gridGeometry;
    this._tokenGeometry = tokenGeometry;
    this._drawing = createDrawing(
      this._gridGeometry, this._tokenGeometry, colours, this.seeEverything, logError, spriteManager,
      resolveImageUrl
    );

    this._mapColouring = new MapColouring(this._gridGeometry);

    this._dragRectangle = new DragRectangle(
      this._drawing.outlinedRectangle, this._gridGeometry,
      cp => this._drawing.getGridCoordAt(cp),
      t => getClientToWorld(t, this._drawing)
    );

    // The notes are rendered with React, not with Three.js
    this._notes = new FeatureDictionary<GridCoord, IAnnotation>(coordString);

    // Here is our higher-level token tracking:
    this._selection = new Tokens(tokenGeometry, this._drawing.selection);
    this._selectionDrag = new Tokens(tokenGeometry, this._drawing.selectionDrag);
    this._selectionDragRed = new Tokens(tokenGeometry, this._drawing.selectionDragRed);
    this._outlineSelection = new Tokens(tokenGeometry, this._drawing.outlineSelection);
    this._outlineSelectionDrag = new Tokens(tokenGeometry, this._drawing.outlineSelectionDrag);
    this._outlineSelectionDragRed = new Tokens(tokenGeometry, this._drawing.outlineSelectionDragRed);
    this._tokens = new TokensWithObservableText(
      tokenGeometry, this._drawing.tokens, this._drawing.tokenTexts,
      t => spriteManager.lookupCharacter(t)
      // TODO #119 Provide a way to separately mark which face gets the text written on...?
    );

    this._outlineTokens = new TokensWithObservableText(
      tokenGeometry, this._drawing.outlineTokens, this._drawing.outlineTokenTexts,
      t => spriteManager.lookupCharacter(t)
    );

    this._faceHighlighter = new FaceHighlighter(
      this._drawing.areas, this._drawing.highlightedAreas, this._dragRectangle
    );

    // This shares the highlighted areas with the other face highlighter; we assume
    // they won't both be active at once...
    this._playerFaceHighlighter = new PlayerFaceHighlighter(
      this._drawing.playerAreas, this._drawing.highlightedAreas, this._dragRectangle
    );

    this.validateWallChanges = this.validateWallChanges.bind(this);
    this._wallHighlighter = new WallHighlighter(
      this._gridGeometry,
      this._drawing.walls,
      this._drawing.highlightedWalls,
      this._drawing.highlightedVertices,
      this.validateWallChanges
    );

    this._wallRectangleHighlighter = new WallRectangleHighlighter(
      this._gridGeometry, this._drawing.areas, this._drawing.walls, this._drawing.highlightedWalls,
      this._drawing.highlightedAreas, this.validateWallChanges, this._dragRectangle
    );

    this._roomHighlighter = new RoomHighlighter(
      this._gridGeometry, this._mapColouring, this._drawing.areas, this._drawing.walls, this._drawing.highlightedWalls,
      this._drawing.highlightedAreas, this.validateWallChanges, this._dragRectangle
    );

    this._imageResizer = new ImageResizer(
      this._gridGeometry, this._drawing.images,
      this._drawing.imageSelectionDrag,
      this._drawing.imageControlPointSelection,
      this._drawing.imageControlPointHighlights
    );

    this._changeTracker = this.createChangeTracker();
    this.resize();

    this.onPostAnimate = this.onPostAnimate.bind(this);
    this.onPreAnimate = this.onPreAnimate.bind(this);
    this._drawing.animate(this.onPreAnimate, this.onPostAnimate);
    console.debug(`created new map state for ${map.adventureId}/${map.id}`);
  }

  private get isOwner() { return this._uid === this._map.record.owner; }
  private get seeEverything() { return this._uid === this._map.record.owner || this._map.record.ffa === true; }

  private addTokenWithProperties(target: GridCoord, properties: ITokenProperties): Change[] {
    // Work out a place around this target where the token will fit
    const newPosition = this.canResizeToken({ ...properties, position: target }, properties.size);
    if (newPosition === undefined) {
      throw Error("No space available to add this token");
    }

    return [createTokenAdd({ ...properties, position: newPosition })];
  }

  private buildLoS() {
    this._drawing.setLoSPositions(this.getLoSPositions(), this.seeEverything);

    // Building the LoS implies that we will need to update annotations
    // (in the post-animate callback)
    this._notesNeedUpdate.setNeedsRedraw();
  }

  private canDropSelectionAt(position: GridCoord) {
    const delta = this.getTokenMoveDelta(position);
    if (delta === undefined) {
      return false;
    }

    // #27: As a non-enforced improvement (just like LoS as a whole), we stop non-owners from
    // dropping tokens outside of the current LoS.
    const worldToLoSViewport = this._drawing.getWorldToLoSViewport(this._scratchMatrix1);
    if (this.seeEverything === false) {
      // We draw the LoS from the point of view of all selected faces, so that a large token
      // gets to see around small things
      const withinLoS = fluent(this._drawing.selection.faces).map(f => {
        this._gridGeometry.createCoordCentre(this._scratchVector1, coordAdd(f.position, delta), 0);
        this._scratchVector1.applyMatrix4(worldToLoSViewport);
        return this._drawing.checkLoS(this._scratchVector1);
      }).reduce((a, b) => a && b, true);

      if (withinLoS === false) {
        return false;
      }
    }

    // We want to answer false to this query if actually moving the tokens here would
    // be rejected by the change tracker, and so we create our own change tracker to do this.
    // It's safe for us to use our current areas, walls and map colouring because those won't
    // change, but we need to clone our tokens into a scratch dictionary.
    const changes: Change[] = [];
    const pushTokenMoves = (tokens: ITokenDictionary, selection: ITokenDictionary) => {
      for (const s of selection) {
        const tokenHere = tokens.get(s.position);
        if (tokenHere === undefined) {
          continue;
        }

        changes.push(createTokenMove(s.position, coordAdd(s.position, delta), tokenHere.id));
      }
    }

    pushTokenMoves(this._tokens, this._selection);
    pushTokenMoves(this._outlineTokens, this._outlineSelection);

    const changeTracker = new MapChangeTracker(
      this._drawing.areas, this._drawing.playerAreas, this._tokens.clone(),
      this._outlineTokens.clone(), this._drawing.walls,
      this._notes, this._drawing.images, this._userPolicy, this._mapColouring
    );
    return trackChanges(this._map.record, changeTracker, changes, this._uid);
  }

  private canResizeToken(token: IToken, newSize: TokenSize): GridCoord | undefined {
    // Checks whether we can resize this token to the given new size, returning the new position
    // that it would adopts, or, if the token doesn't exist already, whether we can place a new
    // token of the given size.
    // We'll try all possible positions that would retain some of the old token's position.
    const existingToken = this.findToken(token.position, token.id);
    if (newSize === existingToken?.size) {
      return token.position;
    }

    // I only need to clone the tokens for this experimental change tracker because the other
    // things definitely won't change
    const changeTracker = new MapChangeTracker(
      this._drawing.areas, this._drawing.playerAreas, this._tokens.clone(),
      this._outlineTokens.clone(), this._drawing.walls,
      this._notes, this._drawing.images, this._userPolicy, this._mapColouring
    );

    const removeToken = existingToken === undefined ? [] : [createTokenRemove(token.position, token.id)];
    for (const face of this._tokenGeometry.enumerateFacePositions({ ...token, size: newSize })) {
      const addToken = createTokenAdd({ ...token, size: newSize, position: face });
      if (trackChanges(this._map.record, changeTracker, [...removeToken, addToken], this._uid) === true) {
        return face;
      }
    }

    return undefined;
  }

  private canSelectToken(t: ITokenProperties) {
    return this.seeEverything || t.players.find(p => this._uid === p) !== undefined;
  }

  private cleanUpSelection() {
    // This function makes sure that the selection doesn't contain anything we
    // couldn't have selected -- call this after changes are applied.
    const doCleanup = (tokens: ITokenDictionary, selection: ITokenDictionary) => {
      const selectedTokenIds = [...fluent(selection).map(s => s.id)];
      selection.clear();
      for (const id of selectedTokenIds) {
        const token = tokens.ofId(id);
        if (token !== undefined) {
          selection.add(token);
        }
      }
    };

    doCleanup(this._tokens, this._selection);
    doCleanup(this._outlineTokens, this._outlineSelection);
  }

  private createChangeTracker(): MapChangeTracker {
    return new MapChangeTracker(
      this._drawing.areas,
      this._drawing.playerAreas,
      this._tokens,
      this._outlineTokens,
      this._drawing.walls,
      this._notes,
      this._drawing.images,
      this._userPolicy,
      this._mapColouring,
      (haveTokensChanged: boolean, objectCount: number) => {
        this.withStateChange(state => {
          if (haveTokensChanged) {
            this.cleanUpSelection();
          }

          this.buildLoS();
          this._drawing.handleChangesApplied(this._mapColouring);
          return {
            ...(haveTokensChanged ? this.updateTokens(state) : state),
            objectCount: this._userPolicy === undefined ? undefined : objectCount 
          };
        });
      }
    );
  }

  private *enumerateAnnotations() {
    // Here we enumerate all the relevant annotations that could be displayed --
    // which means both the map notes, and the token-attached notes.
    for (const n of this._notes) {
      yield n;
    }

    // TODO #118 different annotation positions for outline tokens maybe?
    for (const t of fluent(this._tokens).concat(this._outlineTokens)) {
      if (t.note?.length > 0) {
        yield {
          id: "Token " + t.text + " " + coordString(t.position),
          position: t.position,
          colour: 1, // TODO I'm being weird with note colouring, maybe do something about it
          text: t.note,
          visibleToPlayers: t.noteVisibleToPlayers === true
        };
      }
    }
  }

  private findToken(position: GridCoord, id: string | undefined): IToken | undefined {
    for (const dict of [this._tokens, this._outlineTokens]) {
      const token = dict.get(position);
      if (id === undefined && token !== undefined) {
        return token;
      } else if (token?.id === id) {
        return token;
      }
    }

    return undefined;
  }

  private getAnchor(cp: THREE.Vector3, mode: 'vertex' | 'pixel'): Anchor | undefined {
    if (mode === 'vertex') {
      const vertex = this._drawing.getGridVertexAt(cp);
      return vertex ? { anchorType: 'vertex', position: vertex } : undefined;
    } else {
      const clientToWorld = getClientToWorld(this._scratchMatrix1, this._drawing);
      const position = this._scratchVector1.copy(cp).applyMatrix4(clientToWorld);
      return { anchorType: 'pixel', x: position.x, y: position.y };
    }
  }

  private getClosestVertexPosition(cp: THREE.Vector3): GridVertex | undefined {
    const vertexPosition = this._drawing.getGridVertexAt(cp);
    if (vertexPosition !== undefined) {
      return vertexPosition;
    }

    const coordPosition = this._drawing.getGridCoordAt(cp);
    if (coordPosition !== undefined) {
      return { ...coordPosition, vertex: 0 };
    }

    return undefined;
  }

  private getImageControlPointHitTest(cp: THREE.Vector3): (anchor: Anchor) => boolean {
    const vertex = this._drawing.getGridVertexAt(cp);
    const clientToWorld = getClientToWorld(this._scratchMatrix1, this._drawing);
    const worldPosition = this._scratchVector1.copy(cp).applyMatrix4(clientToWorld);
    const hitDistanceSq = Math.pow(this._drawing.vertexHitDistance, 2);
    return (anchor: Anchor) => {
      console.debug(`testing anchor: ${anchorString(anchor)}`);

      // Test for direct vertex match
      if (vertex !== undefined && anchorsEqual(anchor, {
        anchorType: 'vertex', position: vertex
      })) {
        return true;
      }

      // Test for a co-ordinate close to the world position
      if (
        anchor.anchorType === 'pixel' &&
        this._scratchVector2.set(anchor.x, anchor.y, 0).distanceToSquared(worldPosition) <= hitDistanceSq
      ) {
        return true;
      }

      return false;
    };
  }

  private getLoSPositions(): LoSPosition[] | undefined {
    // These are the positions we should be projecting line-of-sight from.
    // Get all token faces (including multi-tile token faces)
    const myTokenFaces = Array.from(fluent(this._drawing.tokens.faces).concat(this._drawing.outlineTokens.faces))
      .filter(t => this.canSelectToken(t));

    // Deduplicate by token ID to get unique tokens
    const tokenMap = new Map<string, IToken>();
    for (const face of myTokenFaces) {
      if (!tokenMap.has(face.id)) {
        tokenMap.set(face.id, face);
      }
    }
    const myTokens = Array.from(tokenMap.values());

    // Filter to selected tokens
    const selectedTokens = myTokens.filter(t =>
      (t.outline ? this._drawing.outlineSelection : this._drawing.selection).faces.get(t.position) !== undefined);

    if (selectedTokens.length === 0) {
      if (this.seeEverything) {
        // Render no LoS at all
        return undefined;
      } else {
        // Show the LoS of all my tokens - calculate center and radius for each
        return myTokens.map(t =>
          getTokenLoSPosition(t, this._tokenGeometry, this._gridGeometry.faceSize)
        );
      }
    } else {
      // Show the LoS of only the selected tokens - calculate center and radius for each
      return selectedTokens.map(t =>
        getTokenLoSPosition(t, this._tokenGeometry, this._gridGeometry.faceSize)
      );
    }
  }

  private getTokenAtPosition(position?: GridCoord & { isTokenFace: boolean }) {
    if (!position) {
      return { token: undefined, position };
    }

    // Try to be helpful towards players aiming at tokens.
    // If there isn't the other kind present, return a regular token when aiming
    // at an outline, and vice versa
    const tokenHere = this._tokens.at(position);
    const outlineTokenHere = this._outlineTokens.at(position);
    const token = position.isTokenFace ?
      (tokenHere ?? outlineTokenHere) :
      (outlineTokenHere ?? tokenHere);

    // We may have changed our minds about whether we're aiming at a token face,
    // so return an updated position too
    return { token, chosenPosition: {
      ...position,
      isTokenFace: token === undefined ? position.isTokenFace : !token.outline
    } };
  }

  private getTokenMoveDelta(position: GridCoord) {
    if (this._tokenMoveDragStart === undefined || this._tokenMoveJog === undefined) {
      return undefined;
    }

    // #60: Having the jog in here as well allows us to apply an extra movement by arrow keys
    // without perturbing the overall drag process
    return coordAdd(this._tokenMoveJog, coordSub(position, this._tokenMoveDragStart));
  }

  private imageMoveDragEnd(cp: THREE.Vector3, chs: Change[]) {
    // Figure out what has moved
    const movedImages: IMapImage[] = [];
    for (const i of this._drawing.imageSelection) {
      const moved = this._drawing.imageSelectionDrag.get(i.id);
      if (moved !== undefined && !(anchorsEqual(moved.start, i.start) && anchorsEqual(moved.end, i.end))) {
        movedImages.push({ // re-create the record to avoid including meshes and things
          id: moved.id,
          image: moved.image,
          rotation: moved.rotation,
          start: moved.start,
          end: moved.end
        });
      }
    }

    // Move the selection to those positions, and push the relevant changes
    for (const i of movedImages) {
      this.setSelectedImage(i);
      chs.push(createImageRemove(i.id), createImageAdd(i));
    }

    this._drawing.imageSelectionDrag.clear();
    this._inImageMoveDrag = false;
  }

  private imageMoveDragStart(cp: THREE.Vector3, shiftKey: boolean) {
    this._imageMoveDragStart.copy(cp);
    this._imageMoveDragMode = shiftKey ? 'pixel' : 'vertex';
    this._inImageMoveDrag = true;
    this._drawing.imageSelectionDrag.clear();
    this._drawing.imageSelection.forEach(i => this._drawing.imageSelectionDrag.add(i));
  }

  private imageMoveDragTo(cp: THREE.Vector3) {
    if (!this._inImageMoveDrag) {
      return;
    }

    const moveAnchor = (() => {
      if (this._imageMoveDragMode === 'vertex') {
        // To avoid craziness, we only let you switch vertex indices if all the selected images
        // are at the same index
        const startVertex = this.getClosestVertexPosition(this._imageMoveDragStart);
        const targetVertex = this.getClosestVertexPosition(cp);
        if (!startVertex || !targetVertex || coordsEqual(startVertex, targetVertex)) {
          return (_anchor: Anchor) => undefined;
        }

        const baseVertex = startVertex.vertex;
        const allowVertexSwitching = fluent(this._drawing.imageSelection).reduce(
          (ok, i) => ok && i.start.anchorType === 'vertex' && i.start.position.vertex === baseVertex, true
        );
        const vertexDelta = coordSub(targetVertex, startVertex);

        // To move pixel anchors, we need a pixel delta too
        const startPosition = this._gridGeometry.createVertexCentre(this._scratchVector1, startVertex, 0);
        const pixelDelta = this._gridGeometry.createVertexCentre(this._scratchVector2, targetVertex, 0)
          .sub(startPosition);

        return (anchor: Anchor) => {
          let moved: Anchor | undefined = undefined;
          switch (anchor.anchorType) {
            case 'vertex':
              moved = {
                anchorType: 'vertex',
                position: {
                  ...coordAdd(anchor.position, vertexDelta),
                  vertex: allowVertexSwitching ? (targetVertex?.vertex ?? anchor.position.vertex) :
                    anchor.position.vertex
                }
              };
              break;

            case 'pixel':
              moved = { anchorType: 'pixel', x: anchor.x + pixelDelta.x, y: anchor.y + pixelDelta.y };
              break;
          }
          return moved;
        };
      } else { // pixel drag
        const clientToWorld = getClientToWorld(this._scratchMatrix1, this._drawing);
        const startPosition = this._scratchVector1.copy(this._imageMoveDragStart).applyMatrix4(clientToWorld);
        const pixelDelta = this._scratchVector2.copy(cp).applyMatrix4(clientToWorld).sub(startPosition);

        // This one will convert any vertex anchors to pixel ones
        return (anchor: Anchor) => {
          let moved: Anchor | undefined = undefined;
          switch (anchor.anchorType) {
            case 'vertex': {
              const newPosition =
                this._gridGeometry.createVertexCentre(this._scratchVector1, anchor.position, 0)
                .add(pixelDelta);
              moved = { anchorType: 'pixel', x: newPosition.x, y: newPosition.y };
              break;
            }

            case 'pixel':
              moved = { anchorType: 'pixel', x: anchor.x + pixelDelta.x, y: anchor.y + pixelDelta.y };
              break;
          }
          return moved;
        };
      }
    })();

    this._drawing.imageSelectionDrag.clear();
    for (const i of this._drawing.imageSelection) {
      const newStart = moveAnchor(i.start);
      const newEnd = moveAnchor(i.end);
      if (newStart !== undefined && newEnd !== undefined) {
        this._drawing.imageSelectionDrag.add({ ...i, start: newStart, end: newEnd });
      } else {
        this._drawing.imageSelectionDrag.add(i);
      }
    }
  }

  private onPostAnimate() {
    // We update annotations after the render because they are dependent on the LoS
    if (this._notesNeedUpdate.needsRedraw()) {
      this.withStateChange(state => this.updateAnnotations(state));
    }
  }

  private onPreAnimate() {
    const now = window.performance.now();

    // Do the drag-pan if applicable
    const panningX = this._panningX !== 0 ? this._panningX : this._marginPanningX;
    const panningY = this._panningY !== 0 ? this._panningY : this._marginPanningY;
    if ((panningX !== 0 || panningY !== 0) && this._lastAnimationTime !== undefined) {
      this._cameraTranslation.add(
        this._scratchTranslation.set(
          (now - this._lastAnimationTime) * panningX * panStep,
          (now - this._lastAnimationTime) * panningY * panStep,
          0
        )
      );

      // To correctly move the drag rectangle, we need to take into account it having
      // different ideas about what "top" and "bottom" are
      this._scratchTranslation.x = -this._scratchTranslation.x;
      this._dragRectangle.translate(this._scratchTranslation.multiply(this._cameraScaling).multiplyScalar(0.5));
      this.resize();
    }

    // If we have tokens or images selected, doing this will pan them along with the view
    // (we must make sure this is done only with deliberate panning and not with
    // margin panning, which can be triggered by the token move itself)
    if (this._panningX !== 0 || this._panningY !== 0) {
      this.moveSelectionTo(panningPosition);
    }

    this._lastAnimationTime = now;
  }

  private onPanningChange() {
    if (this._panningX === 0 && this._panningY === 0) {
      return this.onPanningEnded();
    } else {
      return this.onPanningStarted();
    }
  }

  private onPanningEnded() {
    const chs: Change[] = [];
    if (fluent(this._selection).concat(this._outlineSelection).any()) {
      const position = this._drawing.getGridCoordAt(panningPosition);
      if (position !== undefined) {
        this.tokenMoveDragEnd(position, chs);
      }
    }

    return chs;
  }

  private onPanningStarted() {
    if (this._tokenMoveDragStart !== undefined) {
      // We've configured the token move already
      return undefined;
    }

    if (fluent(this._selection).concat(this._outlineSelection).any()) {
      // Start moving this selection along with the panning:
      const position = this._drawing.getGridCoordAt(panningPosition);
      if (position !== undefined) {
        this.tokenMoveDragStart(position);
      }
    }

    return undefined;
  }

  private panIfWithinMargin(cp: THREE.Vector3) {
    if (cp.x < panMargin) {
      this._marginPanningX = -1;
    } else if (cp.x < (window.innerWidth - panMargin)) {
      this._marginPanningX = 0;
    } else {
      this._marginPanningX = 1;
    }

    if (cp.y < panMargin) {
      this._marginPanningY = 1;
    } else if (cp.y < (window.innerHeight - panMargin)) {
      this._marginPanningY = 0;
    } else {
      this._marginPanningY = -1;
    }
  }

  private selectTokensInDragRectangle() {
    const inDragRectangle = this._dragRectangle.createFilter();
    const doSelectTokens = (tokens: ITokenDictionary, selection: ITokenDictionary) => {
      selection.clear();
      for (const token of tokens) {
        if (this.canSelectToken(token) === false) {
          continue;
        }

        // TODO Possible optimisation here rejecting tokens that are definitely too far away
        for (const facePosition of this._tokenGeometry.enumerateFacePositions(token)) {
          if (inDragRectangle(facePosition)) {
            selection.add({ ...token, position: token.position });
          }
        }
      }
    };

    doSelectTokens(this._tokens, this._selection);
    doSelectTokens(this._outlineTokens, this._outlineSelection);
  }

  private setSelectedImage(image: IMapImage | undefined) {
    if (image === undefined) {
      this._drawing.imageSelection.clear();
    } else {
      this._drawing.imageSelection.remove(image.id);
      this._drawing.imageSelection.add(image);
    }

    this._imageResizer.setSelectedImage(image);
  }

  private setTokenProperties(token: IToken, properties: ITokenProperties): Change[] {
    if (properties.id !== token.id) {
      throw RangeError("Cannot change a token's id after creation");
    }

    const newPosition = properties.size === token.size ? token.position :
      this.canResizeToken(token, properties.size);
    if (newPosition === undefined) {
      throw Error("No space available for this change");
    }

    return [
      createTokenRemove(token.position, token.id),
      createTokenAdd({ ...properties, position: newPosition })
    ];
  }

  private tokenMoveDragEnd(position: GridCoord, chs: Change[]) {
    const delta = this.getTokenMoveDelta(position);
    const doMoveDragEnd = (selection: ITokenDictionary, selectionDrag: ITokenDictionary, selectionDragRed: ITokenDictionary) => {
      selectionDrag.clear();
      selectionDragRed.clear();
      if (delta !== undefined && this.canDropSelectionAt(position)) {
        // Create commands that move all the tokens.
        if (!coordsEqual(delta, { x: 0, y: 0 })) {
          for (const token of selection) {
            chs.push(createTokenMove(token.position, coordAdd(token.position, delta), token.id));
          }
        }

        // Move the selection to the target positions.  (Even if they haven't moved, we need
        // to do this in order to activate the correct LoS for these tokens if different ones
        // were previously selected.)
        // Careful, we need to remove all old positions before adding the new ones, otherwise
        // we can end up not re-selecting some of the tokens
        const removed = [...fluent(selection).map(t => selection.remove(t.position))];
        removed.forEach(f => {
          if (f !== undefined) {
            selection.add({ ...f, position: coordAdd(f.position, delta) });
          }
        });
      }
    };

    doMoveDragEnd(this._selection, this._selectionDrag, this._selectionDragRed);
    doMoveDragEnd(this._outlineSelection, this._outlineSelectionDrag, this._outlineSelectionDragRed);

    this._tokenMoveDragStart = undefined;
    this._tokenMoveJog = undefined;
    this._tokenMoveDragSelectionPosition = undefined;
  }

  private tokenMoveDragStart(position: GridCoord) {
    this._tokenMoveDragStart = position;
    this._tokenMoveJog = { x: 0, y: 0 };
    this._tokenMoveDragSelectionPosition = position;

    this._selectionDrag.clear();
    this._selectionDragRed.clear();
    this._selection.forEach(f => this._selectionDrag.add(f));

    this._outlineSelectionDrag.clear();
    this._outlineSelectionDragRed.clear();
    this._outlineSelection.forEach(f => this._outlineSelectionDrag.add(f));
  }

  private tokenMoveDragTo(position: GridCoord | undefined) {
    if (position === undefined) {
      return;
    }

    const delta = this.getTokenMoveDelta(position);
    if (
      this._tokenMoveDragStart === undefined ||
      this._tokenMoveDragSelectionPosition === undefined ||
      delta === undefined
    ) {
      return;
    }

    const target = coordAdd(this._tokenMoveDragStart, delta);
    if (coordsEqual(target, this._tokenMoveDragSelectionPosition)) {
      return;
    }

    const doMoveDragTo = (selection: ITokenDictionary, selectionDrag: ITokenDictionary, selectionDragRed: ITokenDictionary) => {
      const drag = this.canDropSelectionAt(position) ? selectionDrag : selectionDragRed;
      selectionDrag.clear();
      selectionDragRed.clear();
      selection.forEach(f => {
        const dragged = { ...f, position: coordAdd(f.position, delta) };
        // console.debug(coordString(f.position) + " -> " + coordString(dragged.position));
        drag.add(dragged);
      });
    };

    doMoveDragTo(this._selection, this._selectionDrag, this._selectionDragRed);
    doMoveDragTo(this._outlineSelection, this._outlineSelectionDrag, this._outlineSelectionDragRed);

    this._tokenMoveDragSelectionPosition = position;
  }

  private updateAnnotations(state: MapState): MapState {
    const positioned: IPositionedAnnotation[] = [];
    const [target, scratch1, scratch2] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const worldToLoSViewport = this._drawing.getWorldToLoSViewport(this._scratchMatrix2);
    const worldToViewport = this._drawing.getWorldToViewport(this._scratchMatrix1);
    for (const n of this.enumerateAnnotations()) {
      // Skip notes not marked as player-visible
      if (!this.seeEverything && n.visibleToPlayers === false) {
        continue;
      }

      // Skip notes outside of the current LoS
      this._gridGeometry.createCoordCentre(target, n.position, 0);
      target.applyMatrix4(worldToLoSViewport);
      if (!this.seeEverything && !this._drawing.checkLoS(target)) {
        continue;
      }

      if (n.id.startsWith("Token")) {
        this._gridGeometry.createTokenAnnotationPosition(target, scratch1, scratch2, n.position, 0, tokenNoteAlpha);
      } else {
        this._gridGeometry.createAnnotationPosition(target, scratch1, scratch2, n.position, 0, noteAlpha);
      }
      target.applyMatrix4(worldToViewport);
      positioned.push({ clientX: target.x, clientY: target.y, ...n });
    }

    return { ...state, annotations: positioned };
  }

  private updateTokens(state: MapState): MapState {
    return {
      ...state,
      tokens: [...fluent(this._tokens).concat(this._outlineTokens).map(t => ({
        ...t, selectable: this.canSelectToken(t)
      }))]
    };
  }

  private validateWallChanges(changes: Change[]): boolean {
    // I need to clone the walls for this one.  The map colouring won't be relevant.
    const changeTracker = new MapChangeTracker(
      this._drawing.areas, this._drawing.playerAreas, this._tokens, this._outlineTokens,
      this._drawing.walls.clone(), this._notes, this._drawing.images, this._userPolicy, undefined
    );
    return trackChanges(this._map.record, changeTracker, changes, this._uid);
  }

  // Helps create a new map state that might be a combination of more than
  // one change, and publish it once when we're done.  The callback function should
  // return the new state if applicable (copied, not mutated!), or undefined to
  // keep the existing state.
  private withStateChange(
    fn: (state: MapState) => MapState | undefined
  ) {
    const newState = fn(this._state);
    if (newState !== undefined) {
      this._state = newState;
      this._stateSubj.next(newState);
    }
  }

  get changeTracker() { return this._changeTracker; }
  get map() { return this._map; }
  get objectCount() { return this._state.objectCount; }
  get panningX() { return this._panningX; }
  get panningY() { return this._panningY; }
  get state(): Observable<MapState> { return this._stateSubj; }

  async addChanges(changes: Change[] | undefined, complain: (id: string, title: string, message: string) => void) {
    if (changes === undefined || changes.length === 0) {
      return;
    }

    if (this._state.objectCount !== undefined && this._userPolicy !== undefined) {
      const expectedCount = this._state.objectCount + netObjectCount(changes);
      if (expectedCount > this._userPolicy.objects) {
        // Refuse to attempt these changes -- this would cause the map to be pruned on
        // consolidate, with consequent desyncs
        complain(
          this._map.id + "_hard_object_cap",
          "Too many objects",
          "You have reached the object limit for this map."
        );
        return;
      } else if (expectedCount > this._userPolicy.objectsWarning) {
        // Still attempt these changes, but show the soft-cap warning.
        complain(
          this._map.id + "_soft_object_cap",
          "Too many objects",
          'You are approaching the object limit for this map.  Consider clearing some unused areas or moving to a new map.'
        );
      }
    }

    await this._dataService.addChanges(this._map.adventureId, this._uid, this._map.id, changes);
  }

  canSetToken(cp: THREE.Vector3, properties: ITokenProperties | undefined) {
    try {
      const changes = this.setToken(cp, properties);
      if (changes.length === 0) {
        return true;
      }

      // We know these changes will only affect tokens so we don't need to clone the rest
      const changeTracker = new MapChangeTracker(
        this._drawing.areas, this._drawing.playerAreas, this._tokens.clone(), this._outlineTokens.clone(),
        this._drawing.walls, this._notes, this._drawing.images, this._userPolicy, this._mapColouring
      );
      return trackChanges(this._map.record, changeTracker, changes, this._uid);
    } catch {
      return false;
    }
  }

  clearHighlights(colour: number) {
    this._faceHighlighter.dragCancel(undefined, { colour });
    this._playerFaceHighlighter.dragCancel(undefined, { colour });
    this._wallHighlighter.dragCancel(undefined, { colour });
    this._wallRectangleHighlighter.dragCancel(undefined, { colour });
    this._roomHighlighter.dragCancel(undefined, { colour });
    this._faceHighlighter.clear();
    this._playerFaceHighlighter.clear();
    this._wallHighlighter.clear();
    this._wallRectangleHighlighter.clear();
    this._roomHighlighter.clear();
    this._dragRectangle.reset();
    this._imageResizer.dragCancel();
    this._selectionDrag.clear();
    this._selectionDragRed.clear();
  }

  clearSelection() {
    const wasAnyTokenSelected = fluent(this._selection).concat(this._outlineSelection).any();
    this._selection.clear();
    this._selectionDrag.clear();
    this._selectionDragRed.clear();
    this._outlineSelection.clear();
    this._outlineSelectionDrag.clear();
    this._outlineSelectionDragRed.clear();
    this._dragRectangle.reset();
    this.setSelectedImage(undefined);

    this._tokenMoveDragStart = undefined;
    this._tokenMoveJog = undefined;
    this._tokenMoveDragSelectionPosition = undefined;
    this._inImageMoveDrag = false;

    // The LoS may change as a result of no longer having a specific
    // token selected
    if (wasAnyTokenSelected) {
      this.buildLoS();
    }
  }

  configure(
    map: IAdventureIdentified<IMap>,
    spriteManager: ISpriteManager,
    userPolicy: IUserPolicy | undefined
  ) {
    if (map.record.ty !== this._map.record.ty) {
      throw RangeError(`Incompatible map types: ${map.record.ty} and ${this._map.record.ty}`);
    }

    // Make sure changes are loaded *after* we do this, otherwise an empty map
    // will be shown!
    this._faceHighlighter.clear();
    this._playerFaceHighlighter.clear();
    this._wallHighlighter.clear();
    this._wallRectangleHighlighter.clear();
    this._roomHighlighter.clear();
    this._dragRectangle.reset();

    this.clearSelection();

    this._drawing.areas.clear();
    this._drawing.playerAreas.clear();
    this._tokens.clear();
    this._outlineTokens.clear();
    this._drawing.walls.clear();
    this._notes.clear();
    this._notesNeedUpdate.setNeedsRedraw();
    this._drawing.images.clear();
    this._mapColouring.clear();

    // Switch ourselves to the new map
    this._map = map;
    this._userPolicy = userPolicy;
    this._changeTracker = this.createChangeTracker();
    this._tokens.setObserveCharacter(t => spriteManager.lookupCharacter(t));
    this._drawing.setSpriteManager(spriteManager);
    this.resetView(undefined, {
      isOwner: this.isOwner,
      seeEverything: this.seeEverything,
      annotations: [],
      tokens: [],
      objectCount: undefined,
      zoom: zoomDefault
    }); // provides a state update
  }

  faceDragEnd(cp: THREE.Vector3, colour: number, stripe: number, isPlayerArea: boolean): Change[] {
    this.panMarginReset();
    const result = isPlayerArea ?
      this._playerFaceHighlighter.dragEnd(this._drawing.getGridCoordAt(cp), { colour, stripe }) :
      this._faceHighlighter.dragEnd(this._drawing.getGridCoordAt(cp), { colour, stripe });
    this._dragRectangle.reset();
    return result;
  }

  faceDragStart(cp: THREE.Vector3, shiftKey: boolean, colour: number, stripe: number, isPlayerArea: boolean) {
    if (shiftKey) {
      this._dragRectangle.start(cp);
    }
    if (isPlayerArea) {
      this._playerFaceHighlighter.dragStart(this._drawing.getGridCoordAt(cp), { colour, stripe });
    } else {
      this._faceHighlighter.dragStart(this._drawing.getGridCoordAt(cp), { colour, stripe });
    }
  }

  flipToken(token: ITokenProperties): Change[] | undefined {
    const flipped = flipToken(token);
    if (flipped !== undefined) {
      return this.setTokenById(token.id, flipped);
    } else {
      return undefined;
    }
  }

  getImage(cp: THREE.Vector3): IMapImage | undefined {
    const position = this._drawing.getGridCoordAt(cp);
    if (position === undefined) {
      return undefined;
    }

    const clientToWorld = getClientToWorld(this._scratchMatrix1, this._drawing);
    const worldPosition = this._scratchVector1.copy(cp).applyMatrix4(clientToWorld);
    for (const i of this._drawing.images) {
      const startPosition = this._gridGeometry.createAnchorPosition(this._scratchVector2, i.start);
      const endPosition = this._gridGeometry.createAnchorPosition(this._scratchVector3, i.end);
      if (
        worldPosition.x >= Math.min(startPosition.x, endPosition.x) &&
        worldPosition.y >= Math.min(startPosition.y, endPosition.y) &&
        worldPosition.x < Math.max(startPosition.x, endPosition.x) &&
        worldPosition.y < Math.max(startPosition.y, endPosition.y)
      ) {
        return i;
      }
    }

    return undefined;
  }

  // For editing
  getNote(cp: THREE.Vector3): IAnnotation | undefined {
    const position = this._drawing.getGridCoordAt(cp);
    if (position === undefined) {
      return undefined;
    }

    return this._notes.get(position);
  }

  *getSelectedTokens(): Iterable<ITokenProperties> {
    for (const s of fluent(this._selection).concat(this._outlineSelection)) {
      yield s;
    }
  }

  getToken(cp: THREE.Vector3 | string): ITokenProperties | undefined {
    if (cp instanceof THREE.Vector3) {
      const position = this._drawing.getGridCoordAt(cp);
      return this.getTokenAtPosition(position).token;
    }

    return this._tokens.ofId(cp) ?? this._outlineTokens.ofId(cp);
  }

  *getTokens(cp: THREE.Vector3): Iterable<ITokenProperties> {
    const position = this._drawing.getGridCoordAt(cp);
    if (position !== undefined) {
      const regularToken = this._tokens.at(position);
      if (regularToken !== undefined) {
        yield regularToken;
      }

      const outlineToken = this._outlineTokens.at(position);
      if (outlineToken !== undefined) {
        yield outlineToken;
      }
    }
  }

  // Designed to work in tandem with the panning commands, if we have tokens selected,
  // we want to jog on a first press and pan on a repeat.
  // Thus, `jogSelection` starts a token move if we don't have one already, and returns
  // true if it started one, else false.
  jogSelection(delta: GridCoord) {
    this.onPanningStarted();
    if (this._tokenMoveJog === undefined) {
      return false;
    }

    this._tokenMoveJog = coordAdd(this._tokenMoveJog, delta);
    return true;
  }

  moveFaceHighlightTo(cp: THREE.Vector3, colour: number, stripe: number, isPlayerArea: boolean) {
    const highlighter = isPlayerArea ? this._playerFaceHighlighter : this._faceHighlighter;
    if (highlighter.inDrag) {
      this.panIfWithinMargin(cp);
    }

    this._dragRectangle.moveTo(cp);
    highlighter.moveHighlight(this._drawing.getGridCoordAt(cp), { colour, stripe });
  }

  moveSelectionTo(cp: THREE.Vector3) {
    this._dragRectangle.moveTo(cp);
    if (this._imageResizer.inDrag === true) {
      this.panIfWithinMargin(cp);
      this._imageResizer.moveHighlight(mode => this.getAnchor(cp, mode));
    } else if (this._inImageMoveDrag === true) {
      this.panIfWithinMargin(cp);
      this.imageMoveDragTo(cp);
    } else if (this._tokenMoveDragStart !== undefined && this._tokenMoveDragSelectionPosition !== undefined) {
      this.panIfWithinMargin(cp);
      const position = this._drawing.getGridCoordAt(cp);
      this.tokenMoveDragTo(position);
    } else if (this._dragRectangle.isEnabled()) {
      this.panIfWithinMargin(cp);
      this.selectTokensInDragRectangle();
    }
  }

  moveTokenHighlightTo(cp: THREE.Vector3) {
    const position = this._drawing.getGridCoordAt(cp);
    this._selectionDrag.clear();
    if (position !== undefined) {
      // Create a minimal size-1 token highlight at this position
      this._selectionDrag.add({
        ...defaultToken,
        position: position,
        colour: 0,  // green highlight color
      });
    }
  }

  moveRoomHighlightTo(cp: THREE.Vector3, shiftKey: boolean, colour: number) {
    if (this._roomHighlighter.inDrag) {
      this.panIfWithinMargin(cp);
    }

    this._dragRectangle.moveTo(cp);
    this._roomHighlighter.difference = shiftKey;
    this._roomHighlighter.moveHighlight(this._drawing.getGridCoordAt(cp), { colour });
  }

  moveWallHighlightTo(cp: THREE.Vector3, shiftKey: boolean, colour: number) {
    if (this._wallHighlighter.inDrag || this._wallRectangleHighlighter.inDrag) {
      this.panIfWithinMargin(cp);
    }

    if (this._dragRectangle.isEnabled() || shiftKey) {
      // We're in rectangle highlight mode.
      if (this._dragRectangle.isEnabled()) {
        this._dragRectangle.moveTo(cp);
      }

      if (!this._wallRectangleHighlighter.inDrag) {
        this._wallHighlighter.clear();
      }

      this._wallRectangleHighlighter.moveHighlight(this._drawing.getGridCoordAt(cp), { colour });
    } else {
      this._wallHighlighter.moveHighlight(this._drawing.getGridVertexAt(cp), { colour });
      if (!this._wallHighlighter.inDrag) {
        this._wallRectangleHighlighter.clear();
      }
    }
  }

  panEnd() {
    this._panLast = undefined;
  }

  panMarginReset() {
    this._marginPanningX = 0;
    this._marginPanningY = 0;
  }

  panStart(cp: THREE.Vector3, rotate: boolean) {
    this._panLast = cp;
    this._isRotating = rotate;
  }

  panTo(cp: THREE.Vector3) {
    if (this._panLast === undefined) {
      return;
    }

    if (this._isRotating) {
      // We rotate by the angle around the current centre point
      this._scratchVector3.set(window.innerWidth / 2, window.innerHeight / 2, 0);
      this._scratchVector1.set(this._panLast.x, this._panLast.y, 0)
        .sub(this._scratchVector3);
      this._scratchVector2.set(cp.x, cp.y, 0).sub(this._scratchVector3);

      let angle = this._scratchVector1.angleTo(this._scratchVector2);

      // deal with THREE being weird about angle direction :/
      if (this._scratchVector1.cross(this._scratchVector2).z < 0) {
        angle = -angle;
      }

      this._cameraRotation.multiply(
        this._scratchRotation.setFromAxisAngle(zAxis, angle)
      );

      // We want to effectively rotate around the centre of the window, which means
      // we also need to rotate our camera translation point to match
      this._cameraTranslation.applyQuaternion(this._scratchRotation.invert());
    } else {
      // Because of the way round that the camera transform is applied, we need to
      // apply the current scaling to our translation delta
      this._cameraTranslation.add(
        this._scratchTranslation.set(
          zoomDefault * (this._panLast.x - cp.x),
          zoomDefault * (cp.y - this._panLast.y),
          0
        ).divide(this._cameraScaling)
      );
    }

    this.resize();
    this._panLast = cp;
  }

  // Resets the view, centreing on a token with the given id.
  resetView(tokenId?: string | undefined, newMapState?: MapState | undefined) {
    this._cameraTranslation.set(0, 0, 0);
    this._cameraRotation.copy(this._defaultRotation);
    this._cameraScaling.set(zoomDefault, zoomDefault, 1);
    this._drawing.resize(this._cameraTranslation, this._cameraRotation, this._cameraScaling);

    let centreOn = tokenId === undefined ? undefined :
      this._tokens.ofId(tokenId)?.position ?? this._outlineTokens.ofId(tokenId)?.position;

    // If we have LoS positions, it would be more helpful to centre on the first of
    // those than on the grid origin:
    if (centreOn === undefined) {
      const losPositions = this.getLoSPositions();
      if (losPositions !== undefined && losPositions.length > 0) {
        centreOn = losPositions[0];
      }
    }

    if (centreOn !== undefined) {
      console.debug("resetView: centre on " + centreOn.x + ", " + centreOn.y);
      const worldToClient = getWorldToClient(this._scratchMatrix1, this._drawing);
      const zeroCentre = this._gridGeometry.createCoordCentre(this._scratchVector2, { x: 0, y: 0 }, 0)
        .applyMatrix4(worldToClient);
      const delta = this._gridGeometry.createCoordCentre(this._scratchVector3, centreOn, 0)
        .applyMatrix4(worldToClient).sub(zeroCentre);
      this._cameraTranslation.set(delta.x, -delta.y, 0);
    }

    // The zoom is echoed to the map state so remember to update that
    this.withStateChange(state => ({ ...(newMapState ?? state), zoom: zoomDefault }));
    this.resize();
  }

  resize() {
    this._drawing.resize(this._cameraTranslation, this._cameraRotation, this._cameraScaling);

    // Some annotations that were off-screen may now be visible, or vice versa
    this._notesNeedUpdate.setNeedsRedraw();
  }

  roomDragEnd(cp: THREE.Vector3, shiftKey: boolean, colour: number): Change[] {
    this.panMarginReset();
    this._roomHighlighter.difference = shiftKey;
    const result = this._roomHighlighter.dragEnd(this._drawing.getGridCoordAt(cp), { colour });
    this._dragRectangle.reset();
    return result;
  }

  roomDragStart(cp: THREE.Vector3, shiftKey: boolean, colour: number) {
    this._dragRectangle.start(cp);
    this._roomHighlighter.difference = shiftKey;
    this._roomHighlighter.dragStart(this._drawing.getGridCoordAt(cp), { colour });
  }

  // Selects the token or image at the client position, if there is one,
  // and begins a drag move for it.
  // Returns true if it selected something, else false.
  selectTokenOrImage(cp: THREE.Vector3, shiftKey: boolean, layer: Layer) {
    const position = this._drawing.getGridCoordAt(cp);
    if (position === undefined) {
      return undefined;
    }

    if (layer === Layer.Image) {
      if (this._imageResizer.dragStart(this.getImageControlPointHitTest(cp), shiftKey)) {
        return true;
      }

      const image = this.getImage(cp);
      if (image === undefined) {
        return false;
      }

      const selected = this._drawing.imageSelection.get(image.id);
      if (selected === undefined) {
        this.clearSelection();
        this.setSelectedImage(image);
      }

      this.imageMoveDragStart(cp, shiftKey);
      return true;
    } else { // object layer
      const { token, chosenPosition } = this.getTokenAtPosition(position);
      if (token === undefined || chosenPosition === undefined || !this.canSelectToken(token)) {
        return false;
      }

      const selection = token.outline ? this._outlineSelection : this._selection;
      const selected = selection.at(chosenPosition);
      if (selected === undefined) {
        this.clearSelection();
        selection.add(token);
        this.buildLoS();
      }

      this.tokenMoveDragStart(chosenPosition);
      return true;
    }
  }

  selectionDragEnd(cp: THREE.Vector3, layer: Layer): Change[] {
    this.panMarginReset();
    const position = this._drawing.getGridCoordAt(cp);
    const chs: Change[] = [];
    if (position) {
      if (this._tokenMoveDragStart !== undefined) {
        this.tokenMoveDragEnd(position, chs);
      } else if (this._inImageMoveDrag === true) {
        this.imageMoveDragEnd(cp, chs);
      } else if (layer === Layer.Image) {
        let image: IMapImage | undefined = undefined;
        if (this._imageResizer.inDrag) {
          // Complete the image resize operation
          image = this._imageResizer.dragEnd(mode => this.getAnchor(cp, mode), chs);
        } else {
          // Add the image at this position
          // TODO #135 Support multi-selecting images?  (maybe defer to another ticket)
          image = this.getImage(cp);
        }
        this.setSelectedImage(image);
      } else { // object layer
        // Always add the token at this position
        // (This is needed if the drag rectangle is very small)
        const { token } = this.getTokenAtPosition(position);
        if (token !== undefined && this.canSelectToken(token)) {
          (token.outline ? this._outlineSelection : this._selection).add(token);
        }
      }

      // If there were no changes, we won't be prodded into rebuilding the LoS
      // when they come back via the watcher, and so we should do so now.
      // (Not always, because that can cause LoS flicker)
      if (chs.length === 0) {
        this.buildLoS();
      }
    }

    this._dragRectangle.reset();
    return chs;
  }

  selectionDragStart(cp: THREE.Vector3, shiftKey: boolean, layer: Layer) {
    if (layer === Layer.Image) {
      // If this starts a control point drag, go with that.
      // Otherwise, start an image move drag instead.
      if (this._imageResizer.dragStart(this.getImageControlPointHitTest(cp), shiftKey) === true) {
        return;
      }

      const image = this.getImage(cp);
      if (image !== undefined) {
        this.imageMoveDragStart(cp, shiftKey);
        return;
      }
    } else {
      const position = this._drawing.getGridCoordAt(cp);
      if (
        position !== undefined &&
        (position.isTokenFace ? this._selection : this._outlineSelection).at(position) !== undefined
      ) {
        this.tokenMoveDragStart(position);
        return;
      }
    }

    // If we got here, we've hit the background
    this.clearSelection();
    if (layer === Layer.Object) {
      this._dragRectangle.start(cp);
    }
  }

  setMapImage(cp: THREE.Vector3, properties: IMapImageProperties): Change[] {
    const mapImage = this._drawing.images.get(properties.id);
    if (mapImage === undefined) {
      // This is a new map image.  We'll start it at the given client position.
      const vertexPosition = this.getClosestVertexPosition(cp);
      if (vertexPosition === undefined) {
        return [];
      }

      return [createImageAdd({
        ...properties,
        start: { anchorType: 'vertex', position: vertexPosition },
        end: { anchorType: 'vertex', position: vertexAdd(vertexPosition, { x: 1, y: 1 }) }
      })];
    } else {
      // We'll remove and re-add this image in the same place
      return [
        createImageRemove(properties.id),
        createImageAdd({
          ...properties,
          start: mapImage.start,
          end: mapImage.end
        })
      ];
    }
  }

  setMount(mount: HTMLDivElement | undefined) {
    this._drawing.setMount(mount);
  }

  setNote(cp: THREE.Vector3, id: string, colour: number, text: string, visibleToPlayers: boolean): Change[] {
    const position = this._drawing.getGridCoordAt(cp);
    const chs: Change[] = [];
    if (position !== undefined) {
      if (this._notes.get(position) !== undefined) {
        // Replace the existing note
        chs.push(createNoteRemove(position));
      }

      if (id.length > 0 && colour >= 0 && text.length > 0) {
        chs.push(createNoteAdd({
          position: position,
          colour: colour,
          id: id,
          text: text,
          visibleToPlayers: visibleToPlayers
        }));
      }
    }

    return chs;
  }

  setPanningX(value: number) {
    this._panningX = value;
    return this.onPanningChange();
  }

  setPanningY(value: number) {
    this._panningY = value;
    return this.onPanningChange();
  }

  setShowMapColourVisualisation(show: boolean) {
    this._drawing.setShowMapColourVisualisation(show, this._mapColouring);
  }

  // Debug methods for visualizing coordinate textures
  toggleDebugShowFaceCoord() {
    if (this._drawing instanceof DrawingOrtho) {
      this._drawing.toggleDebugShowFaceCoord();
    }
  }

  toggleDebugShowVertexCoord() {
    if (this._drawing instanceof DrawingOrtho) {
      this._drawing.toggleDebugShowVertexCoord();
    }
  }

  setToken(cp: THREE.Vector3, properties: ITokenProperties | undefined) {
    const position = this._drawing.getGridCoordAt(cp);
    if (position !== undefined) {
      const token = properties === undefined ? this.findToken(position, undefined) :
        this._tokens.ofId(properties.id) ?? this._outlineTokens.ofId(properties.id);
      if (token !== undefined && properties !== undefined) {
        return this.setTokenProperties(token, properties);
      } else if (token !== undefined) {
        return [createTokenRemove(token.position, token.id)];
      } else if (properties !== undefined) {
        return this.addTokenWithProperties(position, properties);
      }
    }

    return [];
  }

  setTokenById(tokenId: string, properties: ITokenProperties | undefined) {
    const token = this._tokens.ofId(tokenId) ?? this._outlineTokens.ofId(tokenId);
    if (token !== undefined && properties !== undefined) {
      return this.setTokenProperties(token, properties);
    } else if (token !== undefined) {
      return [createTokenRemove(token.position, token.id)];
    } else {
      return [];
    }
  }

  wallDragEnd(cp: THREE.Vector3, colour: number): Change[] {
    this.panMarginReset();
    const result = this._dragRectangle.isEnabled() ?
      this._wallRectangleHighlighter.dragEnd(this._drawing.getGridCoordAt(cp), { colour }) :
      this._wallHighlighter.dragEnd(this._drawing.getGridVertexAt(cp), { colour });
    this._dragRectangle.reset();
    return result;
  }

  wallDragStart(cp: THREE.Vector3, shiftKey: boolean, colour: number) {
    if (shiftKey) {
      this._dragRectangle.start(cp);
      this._wallRectangleHighlighter.dragStart(this._drawing.getGridCoordAt(cp), { colour });
    } else {
      this._wallHighlighter.dragStart(this._drawing.getGridVertexAt(cp), { colour });
    }
  }

  zoomBy(amount: number, step?: number | undefined) {
    this.withStateChange(state => {
      const newZoom = Math.min(zoomMax, Math.max(zoomMin, state.zoom * Math.pow(step ?? zoomStep, -amount)));
      this._cameraScaling.set(newZoom, newZoom, 1);
      return { ...state, zoom: newZoom };
    });
    this.resize();
  }

  dispose() {
    if (this._isDisposed === false) {
      console.debug("disposing map state machine");
      this._stateSubj.complete();
      this._drawing.dispose();
      this._isDisposed = true;
    }
  }
}