import { GridCoord, GridEdge, createGridCoord, createGridEdge, createGridVertex, GridVertex } from '../data/coord';
import { Anchor } from '../data/image';
import { EdgeOcclusion } from './occlusion';
import * as THREE from 'three';

// A grid geometry describes a grid's layout (currently either squares
// or hexagons.)
export interface IGridGeometry {
  // The number of faces horizontally or vertically in each tile.
  tileDim: number;

  // A measure of the face size in this geometry.
  faceSize: number;

  // ...and the distances between faces, along the two axes.
  xStep: number;
  yStep: number;

  // Some more parameters:
  maxEdge: number;
  epsilon: number;

  // Number of points around the perimeter for multi-sample LoS rendering.
  // (Total samples = losCircleSamples + 1 for the centre point.)
  losCircleSamples: number;

  // Creates an anchor position in this geometry.
  createAnchorPosition(target: THREE.Vector3, anchor: Anchor): THREE.Vector3;

  // Creates the co-ordinates of the centre of this face.
  createCoordCentre(target: THREE.Vector3, coord: GridCoord, z: number): THREE.Vector3;

  // Creates the co-ordinates of a suitable position to put an annotation.
  // Invalidates the scratch vectors.
  createAnnotationPosition(target: THREE.Vector3, scratch1: THREE.Vector3, scratch2: THREE.Vector3, coord: GridCoord, z: number, alpha: number): THREE.Vector3;

  // The same, but for a token's annotation.
  // Invalidates the scratch vectors.
  createTokenAnnotationPosition(target: THREE.Vector3, scratch1: THREE.Vector3, scratch2: THREE.Vector3, coord: GridCoord, z: number, alpha: number): THREE.Vector3;

  // Creates the co-ordinates of the centre of this edge.  Invalidates the scratch vectors.
  createEdgeCentre(target: THREE.Vector3, scratch1: THREE.Vector3, scratch2: THREE.Vector3, edge: GridEdge, z: number): THREE.Vector3;

  // Creates the co-ordinates of the centre of this vertex.
  createVertexCentre(target: THREE.Vector3, vertex: GridVertex, z: number): THREE.Vector3;

  // Creates the edge occlusion tester for the edge when seen from the coord.
  createEdgeOcclusion(coord: GridCoord, edge: GridEdge, z: number): EdgeOcclusion;

  // Creates the 'face' attribute array that matches `createSolidVertices` when used
  // for the grid colours.
  createFaceAttributes(): Float32Array;

  // Creates the vertices used for the LoS mesh.  Like the wall vertices,
  // this will have only edge 0 and we will use the instance matrix to generate
  // the others.  See three/los.ts for explanation.
  createLoSVertices(z: number, q: number): Iterable<THREE.Vector3>;

  // Creates the indices that match that LoS mesh.
  createLoSIndices(): number[];

  // Creates the vertices to use for an occlusion test.
  createOcclusionTestVertices(coord: GridCoord, z: number, alpha: number): Iterable<THREE.Vector3>;

  // Creates the vertices involved in drawing the grid tile in solid.
  // The alpha number specifies how much of a face is covered.
  createSolidVertices(tile: THREE.Vector2, alpha: number, z: number): Iterable<THREE.Vector3>;

  // Creates a buffer of indices into the output of `createSolidVertices`
  // suitable for drawing a solid mesh of the grid.
  createSolidMeshIndices(): Iterable<number>;

  // Creates the vertices involved in drawing grid vertices in solid.
  // The alpha number specifies how thick the edge is drawn.
  createSolidVertexVertices(tile: THREE.Vector2, alpha: number, z: number, maxVertex?: number | undefined): THREE.Vector3[];

  // Creates a buffer of indices into the output of `createSolidVertexVertices`
  // suitable for drawing the vertex blobs onto the grid.
  createSolidVertexIndices(maxVertex?: number | undefined): Iterable<number>;

  // Creates the vertices for the token fill edge mesh.  This will only have edge 0,
  // just like the wall vertices.
  // We make only 1 (presuming tile 0 and tileDim 1).
  createTokenFillEdgeVertices(alpha: number, z: number): Iterable<THREE.Vector3>;

  // ...and the indices
  createTokenFillEdgeIndices(): number[];

  // Creates the vertices for the token fill vertex mesh.
  // We make only 1 (presuming tile 0 and tileDim 1).
  createTokenFillVertexVertices(alpha: number, z: number): Iterable<THREE.Vector3>;

  // ...and the indices
  createTokenFillVertexIndices(): number[];

  // Creates the 'face' attribute array that matches `createSolidVertexVertices` when used
  // for the grid colours.
  createVertexAttributes(maxVertex?: number | undefined): Float32Array;

  // Creates the vertices for the wall instanced mesh.  This will have only
  // edge 0 (we use the instance matrix to generate the others.)
  // TODO Prettier walls would have intersection pieces :)
  createWallVertices(alpha: number, z: number): THREE.Vector3[];

  // Decodes the given sample from a coord texture (these must be 4 values
  // starting from the offset) into a grid coord.
  decodeCoordSample(sample: Uint8Array, offset: number, tileOrigin: THREE.Vector2): GridCoord & { isTokenFace: boolean } | undefined;

  // Decodes the given sample from a vertex texture (these must be 4 values
  // starting from the offset) into a grid coord.
  decodeVertexSample(sample: Uint8Array, offset: number, tileOrigin: THREE.Vector2): GridVertex | undefined;

  // Evaluates the function for each face adjacent to the given one.
  forEachAdjacentFace(coord: GridCoord, fn: (face: GridCoord, edge: GridEdge) => void): void;

  // Gets the faces adjacent to the given edge. (TODO adjacent edges too?)
  getEdgeFaceAdjacency(edge: GridEdge): GridCoord[];

  // Gets the vertices adjacent to the given edge.
  getEdgeVertexAdjacency(edge: GridEdge): GridVertex[];

  // Gets the edges adjacent to the given vertex.
  getVertexEdgeAdjacency(vertex: GridVertex): GridEdge[];

  // Gets the radius of the vertex pseudo-circle (used to draw vertex highlights, for hit testing etc.)
  getVertexRadius(alpha: number): number;

  // Emits the same grid geometry but with a tileDim of 1; useful for initialising
  // instanced draws.
  toSingle(): IGridGeometry;

  // Creates a transform from the zero co-ordinate to the given one.
  transformToCoord(m: THREE.Matrix4, coord: GridCoord): THREE.Matrix4;
  transformToEdge(m: THREE.Matrix4, coord: GridEdge): THREE.Matrix4;
  transformToVertex(m: THREE.Matrix4, coord: GridVertex): THREE.Matrix4;

  // Emits the shader declarations required by `createShaderSnippet()` below.
  createShaderDeclarations(): string[];

  // Emits relevant shader functions for working with the grid in this geometry.
  createShaderSnippet(): string[];

  // Emits the uniform declarations required by the shader snippet.
  createShaderUniforms(): Record<string, THREE.IUniform>;

  // Populates the shader uniforms.
  populateShaderUniforms(
    uniforms: Record<string, THREE.IUniform>, faceTex?: THREE.WebGLRenderTarget | undefined, tileOrigin?: THREE.Vector2 | undefined
  ): void;

  // Clears any values from the shader uniforms that might be dangerous to keep around,
  // e.g. acquired textures.
  clearShaderUniforms(uniforms: Record<string, THREE.IUniform>): void;
}

export class EdgeGeometry { // to help me share the edge code
  readonly tip1: THREE.Vector3;
  readonly tip2: THREE.Vector3;
  readonly bevel1a: THREE.Vector3;
  readonly bevel2a: THREE.Vector3;
  readonly bevel1b: THREE.Vector3;
  readonly bevel2b: THREE.Vector3;

  constructor(tip1: THREE.Vector3, tip2: THREE.Vector3, centre: THREE.Vector3, otherCentre: THREE.Vector3, alpha: number) {
    this.tip1 = tip1;
    this.tip2 = tip2;
    this.bevel1a = tip1.clone().lerp(centre, alpha);
    this.bevel2a = tip2.clone().lerp(centre, alpha);
    this.bevel1b = tip1.clone().lerp(otherCentre, alpha);
    this.bevel2b = tip2.clone().lerp(otherCentre, alpha);
  }
}

const vertexRimCount = 12; // the number of vertices we draw around the rim of a vertex blob
                           // Higher number = more circular

export abstract class BaseGeometry {
  private readonly _tileDim: number;
  private readonly _maxEdge: number;
  private readonly _maxVertex: number;
  private readonly _epsilon: number;

  private readonly _faceStep = new THREE.Vector2();

  constructor(tileDim: number, maxEdge: number, maxVertex: number) {
    if (maxVertex > maxEdge) {
      throw new RangeError("maxVertex must not be greater than maxEdge");
    }

    this._tileDim = tileDim;
    this._maxEdge = maxEdge;
    this._maxVertex = maxVertex;
    this._epsilon = 1.0 / 255.0; // to avoid floor errors when decoding
                                 // TODO use an integer texture instead to avoid this yuck and handle bigger maps
                                 // (requires figuring out how to specify one, however!)
  }

  get tileDim() { return this._tileDim; }
  get maxEdge() { return this._maxEdge; }
  get maxVertex() { return this._maxVertex; }
  get epsilon() { return this._epsilon; }

  // This value must be the same as the number of vertices emitted for each face
  // by `createSolidVertices`.
  protected abstract get faceVertexCount(): number;

  protected abstract createCentre(target: THREE.Vector3, x: number, y: number, z: number): THREE.Vector3;

  createAnchorPosition(target: THREE.Vector3, anchor: Anchor): THREE.Vector3 {
    switch (anchor.anchorType) {
      case 'vertex':
        return this.createVertexCentre(target, anchor.position, 0);

      case 'pixel':
        target.set(anchor.x, anchor.y, 0);
        return target;

      default:
        target.set(0, 0, 0);
        return target;
    }
  }

  createCoordCentre(target: THREE.Vector3, coord: GridCoord, z: number): THREE.Vector3 {
    return this.createCentre(target, coord.x, coord.y, z);
  }

  protected abstract createEdgeGeometry(coord: GridEdge, alpha: number, z: number): EdgeGeometry;
  protected abstract createEdgeVertices(target1: THREE.Vector3, target2: THREE.Vector3, centre: THREE.Vector3, edge: number): void;

  createEdgeCentre(target: THREE.Vector3, scratch1: THREE.Vector3, scratch2: THREE.Vector3, edge: GridEdge, z: number): THREE.Vector3 {
    this.createCoordCentre(scratch2, edge, z);
    this.createEdgeVertices(target, scratch1, scratch2, edge.edge);
    return target.lerp(scratch1, 0.5);
  }

  abstract createVertexCentre(target: THREE.Vector3, vertex: GridVertex, z: number): THREE.Vector3;

  abstract getVertexRadius(alpha: number): number;

  private pushEdgeVertices(vertices: THREE.Vector3[], tile: THREE.Vector2, alpha: number, x: number, y: number, z: number, e: number) {
    const edge = createGridEdge(tile, new THREE.Vector2(x, y), this.tileDim, e);
    const eg = this.createEdgeGeometry(edge, alpha, z);

    vertices.push(eg.bevel1b);
    vertices.push(eg.tip1);
    vertices.push(eg.bevel2b);

    vertices.push(eg.bevel2b);
    vertices.push(eg.tip1);
    vertices.push(eg.tip2);

    vertices.push(eg.tip2);
    vertices.push(eg.tip1);
    vertices.push(eg.bevel1a);

    vertices.push(eg.tip2);
    vertices.push(eg.bevel1a);
    vertices.push(eg.bevel2a);
  }

  private pushVertexVertices(vertices: THREE.Vector3[], tile: THREE.Vector2, radius: number, x: number, y: number, z: number, v: number) {
    const iStart = vertices.length;

    // We push the centre, followed by the rim start point rotated `vertexRimCount`
    // times around the rim, doing everything at the origin to make the rotation
    // easier:
    const origin = new THREE.Vector3(0, 0, 0);
    vertices.push(origin);

    const rimStart = new THREE.Vector3(-radius, 0, 0);
    const axis = new THREE.Vector3(0, 0, 1);
    for (let r = 0; r < vertexRimCount; ++r) {
      vertices.push(rimStart.clone().applyAxisAngle(axis, r * 2.0 * Math.PI / vertexRimCount));
    }

    // Now we translate everything
    const vertex = createGridVertex(tile, new THREE.Vector2(x, y), this.tileDim, v);
    const centre = this.createVertexCentre(new THREE.Vector3(), vertex, z);
    for (let i = iStart; i < vertices.length; ++i) {
      vertices[i].add(centre);
    }
  }

  private fromPackedXYAbs(sample: Uint8Array, offset: number): THREE.Vector2 {
    const absValue = Math.floor(sample[offset] * this._tileDim * this._tileDim / 255.0);
    return new THREE.Vector2(absValue % this._tileDim, Math.floor(absValue / this._tileDim));
  }

  private fromPackedXYEdge(sample: Uint8Array, offset: number) {
    const unpacked = this.fromPackedXYAbs(sample, offset);
    const signAndEdgeValue = Math.floor(sample[offset + 1] * 16 * this._maxEdge / 255.0);
    if (signAndEdgeValue === 0) {
      return {};
    }

    if ((signAndEdgeValue % 2) === 1) {
      unpacked.x = -unpacked.x;
    }

    if ((Math.floor(signAndEdgeValue / 2) % 2) === 1) {
      unpacked.y = -unpacked.y;
    }

    const token = Math.floor((signAndEdgeValue / 4) % 2);
    const edge = Math.floor(signAndEdgeValue / 8) % this._maxEdge;
    return { unpacked: unpacked, token: token, edge: edge };
  }

  createFaceAttributes() {
    const faceVertexCount = this.faceVertexCount;
    const attrs = new Float32Array(this.tileDim * this.tileDim * faceVertexCount * 3);
    let offset = 0;
    for (let y = 0; y < this.tileDim; ++y) {
      for (let x = 0; x < this.tileDim; ++x) {
        for (let f = 0; f < faceVertexCount; ++f) {
          attrs[offset++] = x;
          attrs[offset++] = y;
          attrs[offset++] = 0;
        }
      }
    }

    return attrs;
  }

  *createLoSVertices(z: number, q: number) {
    const edgeA = new THREE.Vector3();
    const edgeB = new THREE.Vector3();

    const centre = this.createCentre(new THREE.Vector3(), 0, 0, z);
    this.createEdgeVertices(edgeA, edgeB, centre, 0);
    yield edgeA.clone();
    yield edgeB.clone();

    this.createCentre(centre, 0, 0, q);
    this.createEdgeVertices(edgeA, edgeB, centre, 0);
    yield edgeA;
    yield edgeB;
  }

  createLoSIndices() {
    // You need to disable back-face culling to use these :)
    return [
      0, 1, 2,
      1, 2, 3
    ];
  }
  
  abstract createSolidVertices(tile: THREE.Vector2, alpha: number, z: number): Iterable<THREE.Vector3>;

  createSolidVertexVertices(tile: THREE.Vector2, alpha: number, z: number, maxVertex?: number | undefined): THREE.Vector3[] {
    const radius = this.getVertexRadius(alpha);
    const vertices: THREE.Vector3[] = [];
    const effectiveMaxVertex = Math.min(maxVertex ?? this.maxVertex, this.maxVertex);
    for (let y = 0; y < this.tileDim; ++y) {
      for (let x = 0; x < this.tileDim; ++x) {
        for (let v = 0; v < effectiveMaxVertex; ++v) {
          this.pushVertexVertices(vertices, tile, radius, x, y, z, v);
        }
      }
    }

    return vertices;
  }

  *createSolidVertexIndices(maxVertex?: number | undefined) {
    let baseIndex = 0;
    const effectiveMaxVertex = Math.min(maxVertex ?? this.maxVertex, this.maxVertex);
    for (let y = 0; y < this.tileDim; ++y) {
      for (let x = 0; x < this.tileDim; ++x) {
        for (let v = 0; v < effectiveMaxVertex; ++v) {
          // We create one triangle for each vertex around the rim:
          for (let t = 0; t < vertexRimCount; ++t) {
            yield baseIndex;
            yield baseIndex + 1 + (t + 1) % vertexRimCount;
            yield baseIndex + 1 + t;
          }

          // There are (vertexRimCount + 1) vertices for each object --
          // one in the middle and the others around the rim
          baseIndex += vertexRimCount + 1;
        }
      }
    }
  }

  createShaderDeclarations() {
    return [
      "uniform vec2 faceStep;",
      "uniform sampler2D faceTex;",
      "uniform float maxEdge;",
      "uniform float tileDim;",
      "uniform vec2 tileOrigin;"
    ];
  }

  createShaderSnippet() {
    return [
      "vec2 fromPackedXYAbs(const in float s) {",
      "  float absValue = floor(s * tileDim * tileDim);",
      "  return vec2(mod(absValue, tileDim), floor(absValue / tileDim));",
      "}",

      // ignores the token and edge values packed along with the sign for now
      "bool fromPackedXYSign(const in vec2 s, out vec2 unpacked) {",
      "  unpacked = fromPackedXYAbs(s.x);",
      "  float signAndEdgeValue = floor(s.y * 16.0 * maxEdge);",
      "  if (signAndEdgeValue <= 0.0) {",
      "    return false;",
      "  }",
      "  if (mod(signAndEdgeValue, 2.0) == 1.0) {",
      "    unpacked.x = -unpacked.x;",
      "  }",
      "  if (mod(floor(signAndEdgeValue * 0.5), 2.0) == 1.0) {",
      "    unpacked.y = -unpacked.y;",
      "  }",
      "  return true;",
      "}",

      // Should do the same as the TypeScript function, `decodeCoordSample`,
      // but from a UV (0..1).
      "bool decodeCoordSample(const in vec2 uv, out vec2 coord) {",
      "  vec4 coordSample = texture2D(faceTex, uv + faceStep);",
      "  vec2 tile;",
      "  if (fromPackedXYSign(coordSample.xy, tile) == false) {",
      "    return false;",
      "  }",
      "  vec2 face = fromPackedXYAbs(coordSample.z);",
      "  coord = (tile + tileOrigin) * tileDim + face;",
      "  return true;",
      "}"
    ];
  }

  createShaderUniforms() {
    return {
      faceStep: { type: 'v2', value: null },
      faceTex: { value: null },
      maxEdge: { type: 'f', value: null },
      tileDim: { type: 'f', value: null },
      tileOrigin: { type: 'v2', value: null }
    };
  }

  createVertexAttributes(maxVertex?: number | undefined) {
    const effectiveMaxVertex = Math.min(maxVertex ?? this.maxVertex, this.maxVertex);
    const attrs = new Float32Array(this.tileDim * this.tileDim * effectiveMaxVertex * (vertexRimCount + 1) * 3);
    let offset = 0;
    for (let y = 0; y < this.tileDim; ++y) {
      for (let x = 0; x < this.tileDim; ++x) {
        for (let v = 0; v < effectiveMaxVertex; ++v) {
          for (let r = 0; r <= vertexRimCount; ++r) {
            attrs[offset++] = x;
            attrs[offset++] = y;
            attrs[offset++] = v;
          }
        }
      }
    }

    return attrs;
  }

  createWallVertices(alpha: number, z: number): THREE.Vector3[] {
    const vertices: THREE.Vector3[] = [];
    this.pushEdgeVertices(vertices, new THREE.Vector2(0, 0), alpha, 0, 0, z, 0);
    return vertices;
  }

  decodeCoordSample(sample: Uint8Array, offset: number, tileOrigin: THREE.Vector2): GridCoord & { isTokenFace: boolean } | undefined {
    const { unpacked, token } = this.fromPackedXYEdge(sample, offset);
    const face = this.fromPackedXYAbs(sample, offset + 2);
    return unpacked instanceof THREE.Vector2 && token !== undefined ? {
      ...createGridCoord(unpacked.add(tileOrigin), face, this.tileDim),
      isTokenFace: token > 0
    } : undefined;
  }

  decodeVertexSample(sample: Uint8Array, offset: number, tileOrigin: THREE.Vector2): GridVertex | undefined {
    const { unpacked, edge } = this.fromPackedXYEdge(sample, offset);
    const face = this.fromPackedXYAbs(sample, offset + 2);
    return unpacked instanceof THREE.Vector2 && edge !== undefined ?
      createGridVertex(unpacked.add(tileOrigin), face, this.tileDim, edge) :
      undefined;
  }

  populateShaderUniforms(
    uniforms: Record<string, THREE.IUniform>, faceTex?: THREE.WebGLRenderTarget | undefined, tileOrigin?: THREE.Vector2 | undefined
  ) {
    if (faceTex !== undefined) {
      this._faceStep.set(0.25 / faceTex.width, 0.25 / faceTex.height);
      uniforms['faceTex'].value = faceTex.texture;
    } else {
      this._faceStep.set(0, 0);
    }

    uniforms['faceStep'].value = this._faceStep;
    uniforms['maxEdge'].value = this.maxEdge;
    uniforms['tileDim'].value = this.tileDim;
    if (tileOrigin !== undefined) {
      uniforms['tileOrigin'].value = tileOrigin;
    }
  }

  clearShaderUniforms(uniforms: Record<string, THREE.IUniform>) {
    uniforms['faceTex'].value = undefined;
  }

  transformToCoord(m: THREE.Matrix4, coord: GridCoord): THREE.Matrix4 {
    const centre = this.createCoordCentre(new THREE.Vector3(), coord, 0);
    return m.makeTranslation(centre.x, centre.y, 0);
  }
}
