import { coordString, edgeString, GridCoord, GridEdge, GridVertex, vertexString } from "./coord";
import { FeatureDictionary, IFeature, IFeatureDictionary, IToken, ITokenDictionary, ITokenProperties } from "./feature";
import { ITokenGeometry } from "./tokenGeometry";

export interface ITokenFace extends IToken {
  basePosition: GridCoord;
}

export interface ITokenFillEdge extends IFeature<GridEdge>, ITokenProperties {
  basePosition: GridCoord;
}

export interface ITokenFillVertex extends IFeature<GridVertex>, ITokenProperties {
  basePosition: GridCoord;
}

// Describes how to draw a collection of tokens, complete with fill-in edges and vertices
// for larger ones, and text positioning.
export interface ITokenDrawing {
  faces: IFeatureDictionary<GridCoord, ITokenFace>;
  fillEdges: IFeatureDictionary<GridEdge, ITokenFillEdge>;
  fillVertices: IFeatureDictionary<GridVertex, ITokenFillVertex>;

  // Clears all of this object.
  clear(): void;

  // Makes a clone of this object.
  clone(): ITokenDrawing;

  // How to create suitable features.
  // TODO #46 Is it worth becoming sprite-aware at this level?
  createFace(token: IToken, position: GridCoord): ITokenFace;
  createFillEdge(token: IToken, position: GridEdge): ITokenFillEdge;
  createFillVertex(token: IToken, position: GridVertex): ITokenFillVertex;

  // Cleans up (may be unnecessary.)
  dispose(): void;
}

// A super basic one for non-displayed use
export class BaseTokenDrawing<
  TFacesDict extends IFeatureDictionary<GridCoord, ITokenFace>,
  TFillEdgesDict extends IFeatureDictionary<GridEdge, ITokenFillEdge>,
  TFillVerticesDict extends IFeatureDictionary<GridVertex, ITokenFillVertex>
> implements ITokenDrawing {
  private readonly _faces: TFacesDict;
  private readonly _fillEdges: TFillEdgesDict;
  private readonly _fillVertices: TFillVerticesDict;

  constructor(
    faces: TFacesDict,
    fillEdges: TFillEdgesDict,
    fillVertices: TFillVerticesDict
  ) {
    this._faces = faces;
    this._fillEdges = fillEdges;
    this._fillVertices = fillVertices;
  }

  get faces() { return this._faces; }
  get fillEdges() { return this._fillEdges; }
  get fillVertices() { return this._fillVertices; }

  clear() {
    this._faces.clear();
    this._fillEdges.clear();
    this._fillVertices.clear();
  }

  clone() {
    return new BaseTokenDrawing(
      this.faces.clone(), this.fillEdges.clone(), this.fillVertices.clone()
    );
  }

  createFace(token: IToken, position: GridCoord) {
    return { ...token, basePosition: token.position, position: position };
  }

  createFillEdge(token: IToken, position: GridEdge) {
    return { ...token, basePosition: token.position, position: position };
  }

  createFillVertex(token: IToken, position: GridVertex) {
    return { ...token, basePosition: token.position, position: position };
  }

  dispose() {
    // nothing to do by default
  }
}

export class SimpleTokenDrawing extends BaseTokenDrawing<
  IFeatureDictionary<GridCoord, ITokenFace>,
  IFeatureDictionary<GridEdge, ITokenFillEdge>,
  IFeatureDictionary<GridVertex, ITokenFillVertex>
> {
  constructor(
    faces?: IFeatureDictionary<GridCoord, ITokenFace> | undefined,
    fillEdges?: IFeatureDictionary<GridEdge, ITokenFillEdge> | undefined,
    fillVertices?: IFeatureDictionary<GridVertex, ITokenFillVertex> | undefined
  ) {
    super(
      faces ?? new FeatureDictionary<GridCoord, ITokenFace>(coordString),
      fillEdges ?? new FeatureDictionary<GridEdge, ITokenFillEdge>(edgeString),
      fillVertices ?? new FeatureDictionary<GridVertex, ITokenFillVertex>(vertexString)
    );
  }
}

// A utility for the below
function removeAll<K extends GridCoord, F extends IFeature<K>>(
  dict: IFeatureDictionary<K, F>,
  list: K[]
) {
  while (true) {
    const toRemove = list.pop();
    if (toRemove === undefined) {
      return;
    }
    dict.remove(toRemove);
  }
}

// Implements the tokens dictionary, using one or more token faces to
// draw each token.
// Note that cloning this creates an internal clone of the faces dictionary too,
// which won't be attached to anything else.  (Concrete subclasses must override
// the `clone` method.)
export class Tokens extends FeatureDictionary<GridCoord, IToken> implements ITokenDictionary {
  private readonly _tokenGeometry: ITokenGeometry;
  private readonly _drawing: ITokenDrawing;
  private readonly _byId: Map<string, IToken>;

  constructor(
    tokenGeometry: ITokenGeometry,
    drawing: ITokenDrawing,
    values?: Map<string, IToken> | undefined,
    byId?: Map<string, IToken> | undefined
  ) {
    super(coordString, values);
    this._tokenGeometry = tokenGeometry;
    this._drawing = drawing;
    this._byId = byId !== undefined ? new Map<string, IToken>(byId) : new Map<string, IToken>();
  }

  protected get tokenGeometry() { return this._tokenGeometry; }
  protected get drawing() { return this._drawing; }
  protected get byId() { return this._byId; }

  private revertAdd(
    token: IToken,
    addedFaces: GridCoord[],
    addedEdges: GridEdge[],
    addedVertices: GridVertex[]
  ) {
    removeAll(this._drawing.fillVertices, addedVertices);
    removeAll(this._drawing.fillEdges, addedEdges);
    removeAll(this._drawing.faces, addedFaces);
    this._byId.delete(token.id);
    super.remove(token.position);
  }

  add(token: IToken) {
    if (super.add(token) === true) {
      const addedFaces: GridCoord[] = [];
      const addedEdges: GridEdge[] = [];
      const addedVertices: GridVertex[] = [];

      try { // paranoia ;) I'm not going to use exception driven logic on purpose, hopefully this won't cost
        // Make sure the token's id isn't already in use
        if (this._byId.has(token.id)) {
          this.revertAdd(token, addedFaces, addedEdges, addedVertices);
          return false;
        }
        this._byId.set(token.id, token);

        // Add the token's faces
        for (const face of this._tokenGeometry.enumerateFacePositions(token)) {
          const faceToken = this._drawing.createFace(token, face);
          if (this._drawing.faces.add(faceToken) === false) {
            // This token doesn't fit here.  Roll back any changes we've already
            // made:
            this.revertAdd(token, addedFaces, addedEdges, addedVertices);
            return false;
          } else {
            // This token fits here -- note that we added this face and continue
            addedFaces.push(face);
          }
        }

        // Add the token's edges
        for (const edge of this._tokenGeometry.enumerateFillEdgePositions(token)) {
          const edgeToken = this._drawing.createFillEdge(token, edge);
          if (this._drawing.fillEdges.add(edgeToken) === false) {
            // This token doesn't fit here.  Roll back any changes we've already
            // made:
            this.revertAdd(token, addedFaces, addedEdges, addedVertices);
            return false;
          } else {
            addedEdges.push(edge);
          }
        }

        // Add the token's vertices
        for (const vertex of this._tokenGeometry.enumerateFillVertexPositions(token)) {
          const vertexToken = this._drawing.createFillVertex(token, vertex);
          if (this._drawing.fillVertices.add(vertexToken) === false) {
            // This token doesn't fit here.  Roll back any changes we've already
            // made:
            this.revertAdd(token, addedFaces, addedEdges, addedVertices);
            return false;
          } else {
            addedVertices.push(vertex);
          }
        }

        return true;
      } catch (e) {
        this.revertAdd(token, addedFaces, addedEdges, addedVertices);
        throw e;
      }
    } else {
      return false;
    }
  }

  at(face: GridCoord) {
    const faceToken = this._drawing.faces.get(face);
    return faceToken !== undefined ? this._byId.get(faceToken.id) : undefined;
  }

  clear() {
    // We can't naively clear our token faces here -- because it might be in use
    // by more than one token dictionary.  Instead, we need to carefully remove
    // each one we're responsible for.
    // Don't worry, I doubt this method will ever be performance-critical...
    const toRemove = [...this.iterate()];
    toRemove.forEach(t => this.remove(t.position));

    // Now we're safe to call the base clear
    super.clear();
    this._byId.clear();
  }

  clone(): ITokenDictionary {
    return new Tokens(this._tokenGeometry, this._drawing.clone(), this.values, this.byId);
  }

  enumerateFacePositions(token: IToken): Iterable<GridCoord> {
    return this._tokenGeometry.enumerateFacePositions(token);
  }

  enumerateFillEdgePositions(token: IToken): Iterable<GridEdge> {
    return this._tokenGeometry.enumerateFillEdgePositions(token);
  }

  hasFillEdge(edge: GridEdge) {
    return this._drawing.fillEdges.get(edge) !== undefined;
  }

  ofId(id: string) {
    return this._byId.get(id);
  }

  remove(k: GridCoord): (IToken) | undefined {
    const removed = super.remove(k);
    if (removed !== undefined) {
      for (const vertex of this._tokenGeometry.enumerateFillVertexPositions(removed)) {
        this._drawing.fillVertices.remove(vertex);
      }

      for (const edge of this._tokenGeometry.enumerateFillEdgePositions(removed)) {
        this._drawing.fillEdges.remove(edge);
      }

      for (const face of this._tokenGeometry.enumerateFacePositions(removed)) {
        this._drawing.faces.remove(face);
      }

      this._byId.delete(removed.id);
    }

    return removed;
  }
}