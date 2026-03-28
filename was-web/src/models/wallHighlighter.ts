import { Change } from "../data/change";
import { GridVertex, GridEdge, verticesEqual, GridCoord, coordsEqual, vertexString } from "../data/coord";
import { FeatureDictionary, IFeature, IFeatureDictionary } from "../data/feature";
import { MapColouring } from "./colouring";
import { DragProperties, EdgeHighlighter, FaceHighlighter, VertexHighlighter } from "./dragHighlighter";
import { IGridGeometry } from "./gridGeometry";
import { IDragRectangle } from "./interfaces";

import * as THREE from 'three';

// Given two vertices, plots a straight-line (more or less) wall between them including the
// intermediate vertices.
export function *drawWallBetween(geometry: IGridGeometry, a: GridVertex, b: GridVertex) {
  const bCentre = geometry.createVertexCentre(new THREE.Vector3(), b, 0);
  const [eCentre, vCentre, scratch1, scratch2] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  while (verticesEqual(a, b) === false) {
    // Out of all the adjacent edges, find the one closest to b, and yield it
    const closestEdge = geometry.getVertexEdgeAdjacency(a).map(e => {
      return { edge: e, dSq: geometry.createEdgeCentre(eCentre, scratch1, scratch2, e, 0).distanceToSquared(bCentre) };
    }).reduce((e, f) => {
      return e.dSq < f.dSq ? e : f;
    });

    yield closestEdge.edge;

    // Out of all the adjacent vertices, find the one closest to b and continue
    const closestVertex = geometry.getEdgeVertexAdjacency(closestEdge.edge).map(v => {
      return { vertex: v, dSq: geometry.createVertexCentre(vCentre, v, 0).distanceToSquared(bCentre) };
    }).reduce((v, w) => {
      return v.dSq < w.dSq ? v : w;
    });

    a = closestVertex.vertex;
  }
}

// Given a dictionary of faces, draws a wall around them by calling the function.
// (Duplicate calls may occur.)  This is the basic rectangular wall function.
// TODO #21 There's a potential optimisation here -- walk all around the edge of
// the shape rather than inspecting every face including the interior ones -- but it
// has subtleties (consider a 3-square thick L-shape in the square geometry)
export function drawWallAround(
  geometry: IGridGeometry,
  faceDictionary: IFeatureDictionary<GridCoord, IFeature<GridCoord>>,
  addWall: (position: GridEdge) => void
) {
  for (const f of faceDictionary) {
    geometry.forEachAdjacentFace(f.position, (adj, edge) => {
      if (faceDictionary.get(adj) === undefined) {
        // This is an exterior face -- add the wall
        addWall(edge);
      }
    });
  }
}

// As `drawWallAround`.  This function attempts to join together all the spaces
// defined in the map colouring except those with the outside colour, along with
// the faces in the face dictionary, adding and removing walls as appropriate.
export function drawWallUnion(
  geometry: IGridGeometry,
  colouring: MapColouring,
  outerColour: number,
  faceDictionary: IFeatureDictionary<GridCoord, IFeature<GridCoord>>,
  addWall: (position: GridEdge) => void,
  removeWall: (position: GridEdge) => void
) {
  for (const f of faceDictionary) {
    geometry.forEachAdjacentFace(f.position, (adj, edge) => {
      if (faceDictionary.get(adj) === undefined && colouring.colourOf(adj) === outerColour) {
        // This is an exterior face -- add the wall
        addWall(edge);
      } else if (colouring.getWall(edge) !== undefined) {
        // This is an interior wall -- remove it
        removeWall(edge);
      }
    });
  }
}

// As `drawWallAround`.  This function attempts to enlarge the space defined in the
// map colouring with colour `innerColour` through the inclusion of the faces in the
// face dictionary, adding and removing walls as appropriate.
export function drawWallDifference(
  geometry: IGridGeometry,
  colouring: MapColouring,
  innerColour: number,
  faceDictionary: IFeatureDictionary<GridCoord, IFeature<GridCoord>>,
  addWall: (position: GridEdge) => void,
  removeWall: (position: GridEdge) => void
) {
  let changeCount = 0;
  function handleAdjacentFace(adj: GridCoord, edge: GridEdge) {
    if (faceDictionary.get(adj) === undefined && colouring.colourOf(adj) !== innerColour) {
      // This is an exterior face -- add the wall
      addWall(edge);
      ++changeCount;
    } else if (colouring.getWall(edge) !== undefined) {
      // This is an interior wall -- remove it
      removeWall(edge);
      ++changeCount;
    }
  }

  for (const f of faceDictionary) {
    geometry.forEachAdjacentFace(f.position, handleAdjacentFace);
  }

  if (changeCount === 0) {
    drawWallAround(geometry, faceDictionary, addWall);
  }
}

// The wall highlighter highlights both the vertices dragged through and the edges
// between them, and commits changes to the edges on drag end.
export class WallHighlighter {
  private readonly _geometry: IGridGeometry;

  // We drive this edge highlighter to do that part of the work:
  private readonly _edgeHighlighter: EdgeHighlighter;
  private readonly _vertexHighlighter: VertexHighlighter;

  // How to check whether the wall changes we made are valid
  private readonly _validate: (changes: Change[]) => boolean;

  private _lastHoverPosition: GridVertex | undefined = undefined;

  constructor(
    geometry: IGridGeometry,
    walls: IFeatureDictionary<GridEdge, IFeature<GridEdge>>,
    wallHighlights: IFeatureDictionary<GridEdge, IFeature<GridEdge>>,
    vertexHighlights: IFeatureDictionary<GridVertex, IFeature<GridVertex>>,
    validate: (changes: Change[]) => boolean
  ) {
    this._geometry = geometry;
    this._edgeHighlighter = new EdgeHighlighter(walls, wallHighlights);
    this._vertexHighlighter = new VertexHighlighter(
      new FeatureDictionary<GridVertex, IFeature<GridVertex>>(vertexString),
      vertexHighlights
    );
    this._validate = validate;
  }

  get inDrag() { return this._edgeHighlighter.inDrag; }

  clear() {
    this._edgeHighlighter.clear();
    this._vertexHighlighter.clear();
  }
  
  dragCancel(position: GridVertex | undefined, props: DragProperties) {
    this._edgeHighlighter.dragCancel(undefined, props);
    this.moveHighlight(position, props);
  }

  dragStart(position: GridVertex | undefined, props: DragProperties) {
    this.moveHighlight(position, props);
    this._edgeHighlighter.dragStart(undefined, props);
  }

  dragEnd(position: GridVertex | undefined, props: DragProperties): Change[] {
    this.moveHighlight(position, props);
    if (this._edgeHighlighter.inDrag === false) {
      return [];
    }

    return this._edgeHighlighter.dragEnd(undefined, props);
  }

  moveHighlight(position: GridVertex | undefined, props: DragProperties) {
    this._vertexHighlighter.moveHighlight(position, props);
    if (position !== undefined) {
      if (
        this._edgeHighlighter.inDrag === true &&
        this._lastHoverPosition !== undefined &&
        !verticesEqual(position, this._lastHoverPosition)
      ) {
        for (const wall of drawWallBetween(this._geometry, this._lastHoverPosition, position)) {
          this._edgeHighlighter.moveHighlight(wall, props);
        }

        const valid = this._validate(this._edgeHighlighter.createChanges(props, false));
        this._edgeHighlighter.setHighlightValidity(valid);
      }

      this._lastHoverPosition = position;
    }
  }
}

// The wall rectangle highlighter highlights the faces being dragged through and
// the edges around them, and commits changes to the edges on drag end.
export class WallRectangleHighlighter {
  private readonly _geometry: IGridGeometry;
  private readonly _faceHighlights: IFeatureDictionary<GridCoord, IFeature<GridCoord>>;

  // We drive this edge highlighter to do that part of the work:
  private readonly _edgeHighlighter: EdgeHighlighter;

  // ...and this face highlighter to show the faces
  private readonly _faceHighlighter: FaceHighlighter;

  // How to check whether the wall changes we made are valid
  private readonly _validate: (changes: Change[]) => boolean;

  private _lastHoverPosition: GridCoord | undefined;

  constructor(
    geometry: IGridGeometry,
    faces: IFeatureDictionary<GridCoord, IFeature<GridCoord>>,
    walls: IFeatureDictionary<GridEdge, IFeature<GridEdge>>,
    wallHighlights: IFeatureDictionary<GridEdge, IFeature<GridEdge>>,
    faceHighlights: IFeatureDictionary<GridCoord, IFeature<GridCoord>>,
    validate: (changes: Change[]) => boolean,
    dragRectangle: IDragRectangle
  ) {
    this._geometry = geometry;
    this._faceHighlights = faceHighlights;
    this._edgeHighlighter = new EdgeHighlighter(walls, wallHighlights);
    this._faceHighlighter = new FaceHighlighter(faces, faceHighlights, dragRectangle);
    this._validate = validate;
  }

  protected get geometry() { return this._geometry; }
  protected get edgeHighlighter() { return this._edgeHighlighter; }
  protected get faceHighlighter() { return this._faceHighlighter; }
  protected get faceHighlights() { return this._faceHighlights; }

  protected drawWall(props: DragProperties) {
    drawWallAround(this._geometry, this._faceHighlights, e => this._edgeHighlighter.moveHighlight(e, props));
  }

  get inDrag() { return this._faceHighlighter.inDrag; }

  clear() {
    this._edgeHighlighter.clear();
    this._faceHighlighter.clear();
  }

  dragCancel(position: GridCoord | undefined, props: DragProperties) {
    this._edgeHighlighter.dragCancel(undefined, props);
    this._faceHighlighter.dragCancel(position, props);
  }

  dragEnd(position: GridCoord | undefined, props: DragProperties) {
    this.moveHighlight(position, props);
    this._faceHighlighter.dragCancel(position, props);
    return this._edgeHighlighter.dragEnd(undefined, props);
  }

  dragStart(position: GridCoord | undefined, props: DragProperties) {
    this._faceHighlighter.dragStart(position, props);
  }

  moveHighlight(position: GridCoord | undefined, props: DragProperties) {
    this._faceHighlighter.moveHighlight(position, props);
    if (
      this.inDrag && position !== undefined &&
      !coordsEqual(position, this._lastHoverPosition)
    ) {
      // We treat each change in the position as a fresh edge drag:
      this._edgeHighlighter.dragCancel(undefined, props);
      this._edgeHighlighter.clear();
      this._edgeHighlighter.dragStart(undefined, props);
      this.drawWall(props);

      const valid = this._validate(this._edgeHighlighter.createChanges(props, false));
      this._edgeHighlighter.setHighlightValidity(valid);
    }

    this._lastHoverPosition = position;
  }
}

// The room highlighter builds on the wall rectangle highlighter to create rectangular
// intersecting rooms.
// TODO Consider shapes other than rectangles, e.g. circles, standard splat shapes...?
export class RoomHighlighter extends WallRectangleHighlighter {
  private readonly _colouring: MapColouring;

  private _firstDragPosition: GridCoord | undefined;
  private _difference = false;

  constructor(
    geometry: IGridGeometry,
    colouring: MapColouring,
    faces: IFeatureDictionary<GridCoord, IFeature<GridCoord>>,
    walls: IFeatureDictionary<GridEdge, IFeature<GridEdge>>,
    wallHighlights: IFeatureDictionary<GridEdge, IFeature<GridEdge>>,
    faceHighlights: IFeatureDictionary<GridCoord, IFeature<GridCoord>>,
    validate: (changes: Change[]) => boolean,
    dragRectangle: IDragRectangle
  ) {
    super(geometry, faces, walls, wallHighlights, faceHighlights, validate, dragRectangle);
    this._colouring = colouring;
  }

  protected drawWall(props: DragProperties) {
    if (this._firstDragPosition === undefined) {
      return;
    }

    if (this.difference) {
      drawWallDifference(
        this.geometry,
        this._colouring,
        this._colouring.colourOf(this._firstDragPosition),
        this.faceHighlights,
        e => this.edgeHighlighter.moveHighlight(e, props),
        e => this.edgeHighlighter.moveHighlight(e, { colour: -1 })
      );
    } else {
      drawWallUnion(
        this.geometry,
        this._colouring,
        this._colouring.getOuterColour(),
        this.faceHighlights,
        e => this.edgeHighlighter.moveHighlight(e, props),
        e => this.edgeHighlighter.moveHighlight(e, { colour: -1 })
      );
    }
  }

  private updateFirstDragPosition(position: GridCoord | undefined) {
    if (this._firstDragPosition === undefined) {
      this._firstDragPosition = position;
    }
  }

  // Sets whether or not we're in difference mode.
  get difference() { return this._difference; }
  set difference(d: boolean) { this._difference = d; }

  dragCancel(position: GridCoord | undefined, props: DragProperties) {
    super.dragCancel(position, props);
    this._firstDragPosition = undefined;
  }

  dragEnd(position: GridCoord | undefined, props: DragProperties) {
    // In the room highlighter, we want to paint the room areas too
    this.moveHighlight(position, props);
    this._firstDragPosition = undefined;
    this.faceHighlighter.dragCancel(position, props);
    return this.edgeHighlighter.dragEnd(undefined, props);
  }

  dragStart(position: GridCoord | undefined, props: DragProperties) {
    super.dragStart(position, props);
    this.updateFirstDragPosition(position);
  }

  moveHighlight(position: GridCoord | undefined, props: DragProperties) {
    if (this.inDrag) {
      this.updateFirstDragPosition(position);
    }

    super.moveHighlight(position, props);
  }
}