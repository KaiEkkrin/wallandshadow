import * as THREE from 'three';

import { MapColouring } from "./colouring";
import { GridCoord, GridEdge, GridVertex } from "../data/coord";
import { IFeature, IFeatureDictionary, IAreaDictionary } from "../data/feature";
import { IIdDictionary } from "../data/identified";
import { IMapControlPointDictionary, IMapImage } from "../data/image";
import { LoSPosition } from "../data/losPosition";
import { ITokenDrawing } from "../data/tokens";
import { ITokenTextDrawing } from "../data/tokenTexts";
import { ISpriteManager } from "../services/interfaces";

// Describes the interface to our drawing subsystem,
// which could be substituted out, won't exist in auto tests, etc.
// The drawing interface exposes instanced features dictionaries directly --
// editing these should update the drawing upon the next animation frame.
export interface IDrawing {
  // The WebGL renderer used by this drawing.
  renderer: THREE.WebGLRenderer;

  areas: IAreaDictionary;
  playerAreas: IAreaDictionary;
  tokens: ITokenDrawing;
  tokenTexts: ITokenTextDrawing;
  outlineTokens: ITokenDrawing;
  outlineTokenTexts: ITokenTextDrawing;
  walls: IFeatureDictionary<GridEdge, IFeature<GridEdge>>;
  images: IIdDictionary<IMapImage>;

  highlightedAreas: IFeatureDictionary<GridCoord, IFeature<GridCoord>>;
  highlightedVertices: IFeatureDictionary<GridVertex, IFeature<GridVertex>>;
  highlightedWalls: IFeatureDictionary<GridEdge, IFeature<GridEdge>>;
  imageControlPointHighlights: IMapControlPointDictionary;

  selection: ITokenDrawing;
  selectionDrag: ITokenDrawing;
  selectionDragRed: ITokenDrawing;

  outlineSelection: ITokenDrawing;
  outlineSelectionDrag: ITokenDrawing;
  outlineSelectionDragRed: ITokenDrawing;

  imageSelection: IIdDictionary<IMapImage>;
  imageSelectionDrag: IIdDictionary<IMapImage>;
  imageControlPointSelection: IMapControlPointDictionary;

  // A drawing always exposes a single outlined rectangle that can be used
  // for drag-boxes etc.  This object will be drawn separately and will not
  // be subject to the world transform applied to everything else.
  outlinedRectangle: IOutlinedRectangle;

  // The maximum distance from a pixel anchor that you can be in order to hit it,
  // in world space.
  vertexHitDistance: number;

  // Draws if need be, and requests the next animation frame.
  // The callbacks are called at the start and end of every animate() call
  // respectively.
  animate(onPreAnimate?: (() => void) | undefined, onPostAnimate?: (() => void) | undefined): void;

  // Checks whether the given LoS viewport position (-1..1) is within the current LoS.
  checkLoS(cp: THREE.Vector3): boolean;

  // These functions turn viewport co-ordinates (0..windowWidth, 0..windowHeight)
  // into face, edge or vertex coords
  getGridCoordAt(cp: THREE.Vector3): GridCoord & { isTokenFace: boolean } | undefined;
  getGridVertexAt(cp: THREE.Vector3): GridVertex | undefined;

  // Gets a viewport-to-world transfomation matrix, where the viewport visible
  // range is (-1..1).
  getViewportToWorld(target: THREE.Matrix4): THREE.Matrix4;

  // Gets a world-to-LoS-viewport transformation matrix, where the viewport visible
  // range is (-1..1).  Use this to create the vectors required for the `checkLoS` method.
  getWorldToLoSViewport(target: THREE.Matrix4): THREE.Matrix4;

  // Gets a world-to-viewport transformation matrix, where the viewport visible
  // range is (-1..1).
  getWorldToViewport(target: THREE.Matrix4): THREE.Matrix4;

  // Handles the completion of a set of changes by the change tracker.
  handleChangesApplied(mapColouring: MapColouring): void;

  // Alters the view.
  resize(translation: THREE.Vector3, rotation: THREE.Quaternion, scaling: THREE.Vector3): void;

  // Sets the token positions whose LoS we should draw, or undefined to show everything.
  setLoSPositions(positions: LoSPosition[] | undefined, seeEverything: boolean): void;

  // Sets the mount point of the rendered drawing.
  setMount(mount: HTMLDivElement | undefined): void;

  // Sets whether or not to show the map colour visualisation.
  setShowMapColourVisualisation(show: boolean, mapColouring: MapColouring): void;

  // Swaps to a different sprite manager.
  setSpriteManager(spriteManager: ISpriteManager): void;

  // Cleans up and releases all resources.
  dispose(): void;
}

// Describes if and where the user has dragged out a rectangle (whose drawing is
// implemented by an IOutlinedRectangle, below.)
export interface IDragRectangle {
  // Creates a filter function admitting features within the current drag rectangle.
  createFilter(): (c: GridCoord) => boolean;

  // Enumerates all the grid coords within the current drag rectangle.
  enumerateCoords(): Iterable<GridCoord>;

  // True if the drag rectangle is enabled and visible, else false.
  isEnabled(): boolean;

  // Moves a point of the drag rectangle to the target in client co-ordinates,
  // returning true if we have a drag rectangle visible, else false.
  moveTo(cp: THREE.Vector3): boolean;

  // Resets the drag rectangle and disables it until `start` is called again.
  reset(): void;

  // Starts a drag rectangle from the given target in client co-ordinates.
  start(cp: THREE.Vector3): void;

  // Moves the whole drag rectangle by some amount in client co-ordinates,
  // returning true if we have a drag rectangle visible, else false.
  translate(cp: THREE.Vector3): boolean;
}

// Describes the bounds of the grid, in tiles.
export interface IGridBounds {
  minS: number,
  minT: number,
  maxS: number,
  maxT: number
};

// Describes an outlined rectangle that can be used as a selection box.
export interface IOutlinedRectangle {
  // This object's position and scale.
  position: THREE.Vector3;
  scale: THREE.Vector3;

  // This object's visibility.
  visible: boolean;

  // Alters the drawn object, e.g. changing its transform.
  // The function should return true if a redraw is required, else false.
  alter(fn: (o: THREE.Object3D) => boolean): boolean;
}

// Distinguishes the different layers for editing a map.
export enum Layer {
  Image = 'image',
  Object = 'object'
}