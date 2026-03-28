import { GridCoord, GridEdge, coordAdd, GridVertex } from '../data/coord';
import { EdgeOcclusion } from './occlusion';
import { BaseGeometry, IGridGeometry, EdgeGeometry } from './gridGeometry';
import * as THREE from 'three';

export class SquareGridGeometry extends BaseGeometry implements IGridGeometry {
  private readonly _squareSize: number;
  private readonly _off: number;

  private readonly _scratchMatrix = new THREE.Matrix4();

  constructor(squareSize: number, tileDim: number) {
    super(tileDim, 2, 1);
    this._squareSize = squareSize;
    this._off = squareSize * 0.5;
  }

  get faceSize() { return this._squareSize; }
  get xStep() { return this._squareSize; }
  get yStep() { return this._squareSize; }
  get losCircleSamples() { return 4; }

  protected get faceVertexCount() { return 4; }

  protected createCentre(target: THREE.Vector3, x: number, y: number, z: number): THREE.Vector3 {
    return target.set(x * this._squareSize, y * this._squareSize, z);
  }

  private createTopLeft(target: THREE.Vector3, c: THREE.Vector3): THREE.Vector3 {
    return target.set(c.x - this._off, c.y - this._off, c.z);
  }

  private createTopRight(target: THREE.Vector3, c: THREE.Vector3): THREE.Vector3 {
    return target.set(c.x + this._off, c.y - this._off, c.z);
  }

  private createBottomLeft(target: THREE.Vector3, c: THREE.Vector3): THREE.Vector3 {
    return target.set(c.x - this._off, c.y + this._off, c.z);
  }

  private createBottomRight(target: THREE.Vector3, c: THREE.Vector3): THREE.Vector3 {
    return target.set(c.x + this._off, c.y + this._off, c.z);
  }

  createAnnotationPosition(target: THREE.Vector3, scratch1: THREE.Vector3, scratch2: THREE.Vector3, coord: GridCoord, z: number, alpha: number): THREE.Vector3 {
    this.createCoordCentre(target, coord, z);
    this.createBottomLeft(scratch1, target);
    this.createTopLeft(scratch2, target);
    scratch1.lerp(scratch2, 0.5);
    return target.lerp(scratch1, alpha);
  }

  createTokenAnnotationPosition(target: THREE.Vector3, scratch1: THREE.Vector3, scratch2: THREE.Vector3, coord: GridCoord, z: number, alpha: number): THREE.Vector3 {
    this.createCoordCentre(target, coord, z);
    this.createBottomLeft(scratch1, target);
    return target.lerp(scratch1, alpha);
  }

  protected createEdgeVertices(target1: THREE.Vector3, target2: THREE.Vector3, centre: THREE.Vector3, edge: number) {
    switch (edge) {
      case 0:
        this.createBottomLeft(target1, centre);
        this.createTopLeft(target2, centre);
        break;

      case 1:
        this.createTopLeft(target1, centre);
        this.createTopRight(target2, centre);
        break;
    }
  }

  protected createEdgeGeometry(coord: GridEdge, alpha: number, z: number): EdgeGeometry {
    const centre = this.createCoordCentre(new THREE.Vector3(), coord, z);
    const otherCentre = this.createCoordCentre(
      new THREE.Vector3(),
      coord.edge === 0 ? coordAdd(coord, { x: -1, y: 0 }) :
      coordAdd(coord, { x: 0, y: -1 }),
      z
    );

    const [tip1, tip2] = [new THREE.Vector3(), new THREE.Vector3()];
    this.createEdgeVertices(tip1, tip2, centre, coord.edge);
    return new EdgeGeometry(tip1, tip2, centre, otherCentre, alpha);
  }

  createVertexCentre(target: THREE.Vector3, vertex: GridVertex, z: number) {
    // In the square grid, each face owns only one vertex (the top left) and we can
    // actually ignore the vertex number.
    this.createCoordCentre(target, vertex, z);
    return this.createTopLeft(target, target);
  }

  getVertexRadius(alpha: number) {
    return this._squareSize * alpha;
  }

  private *getSquareIndices(baseIndex: number) {
    yield baseIndex;
    yield baseIndex + 1;
    yield baseIndex + 2;

    yield baseIndex + 1;
    yield baseIndex + 3;
    yield baseIndex + 2;
  }

  createEdgeOcclusion(coord: GridCoord, edge: GridEdge, z: number): EdgeOcclusion {
    const [edgeA, edgeB] = [new THREE.Vector3(), new THREE.Vector3()];

    const centre = this.createCentre(new THREE.Vector3(), edge.x, edge.y, z);
    this.createEdgeVertices(edgeA, edgeB, centre, edge.edge);

    this.createCoordCentre(centre, coord, z);
    return new EdgeOcclusion(centre, edgeA, edgeB, this._squareSize * 0.01);
  }

  *createOcclusionTestVertices(coord: GridCoord, z: number, alpha: number): Iterable<THREE.Vector3> {
    const centre = new THREE.Vector3();
    yield this.createCoordCentre(centre, coord, z);

    const invAlpha = 1 - alpha;
    yield this.createTopLeft(new THREE.Vector3(), centre).lerp(centre, invAlpha);
    yield this.createBottomLeft(new THREE.Vector3(), centre).lerp(centre, invAlpha);
    yield this.createTopRight(new THREE.Vector3(), centre).lerp(centre, invAlpha);
    yield this.createBottomRight(new THREE.Vector3(), centre).lerp(centre, invAlpha);
  }

  *createSolidVertices(tile: THREE.Vector2, alpha: number, z: number): Iterable<THREE.Vector3> {
    const centre = new THREE.Vector3();
    const invAlpha = 1 - alpha;
    for (let y = 0; y < this.tileDim; ++y) {
      for (let x = 0; x < this.tileDim; ++x) {
        this.createCentre(centre, tile.x * this.tileDim + x, tile.y * this.tileDim + y, z);
        yield this.createTopLeft(new THREE.Vector3(), centre).lerp(centre, invAlpha);
        yield this.createBottomLeft(new THREE.Vector3(), centre).lerp(centre, invAlpha);
        yield this.createTopRight(new THREE.Vector3(), centre).lerp(centre, invAlpha);
        yield this.createBottomRight(new THREE.Vector3(), centre).lerp(centre, invAlpha);
      }
    }
  }

  // Creates a buffer of indices into the output of `createSolidVertices`
  // suitable for drawing a solid mesh of the grid.
  *createSolidMeshIndices() {
    for (let y = 0; y < this.tileDim; ++y) {
      for (let x = 0; x < this.tileDim; ++x) {
        // For some reason Three.js uses triangles rather than triangle strips, grr
        const baseIndex = y * this.tileDim * 4 + x * 4;
        yield* this.getSquareIndices(baseIndex);
      }
    }
  }

  *createTokenFillEdgeVertices(alpha: number, z: number): Iterable<THREE.Vector3> {
    // Our edge 0 fills the space between
    // - face (-1, 0) (top right and bottom right), and
    // - face (0, 0) (top left and bottom left)
    const invAlpha = 1 - alpha;
    const centreLeft = this.createCentre(new THREE.Vector3(), -1, 0, z);
    const centreRight = this.createCentre(new THREE.Vector3(), 0, 0, z);
    yield this.createTopRight(new THREE.Vector3(), centreLeft).lerp(centreLeft, invAlpha);
    yield this.createBottomRight(new THREE.Vector3(), centreLeft).lerp(centreLeft, invAlpha);
    yield this.createTopLeft(new THREE.Vector3(), centreRight).lerp(centreRight, invAlpha);
    yield this.createBottomLeft(new THREE.Vector3(), centreRight).lerp(centreRight, invAlpha);
  }

  createTokenFillEdgeIndices(): number[] {
    return [ 0, 1, 2, 1, 3, 2 ];
  }

  *createTokenFillVertexVertices(alpha: number, z: number): Iterable<THREE.Vector3> {
    // Our vertex 0 fills the space between
    // - face (-1, -1) (bottom right),
    // - face (-1, 0) (top right),
    // - face (0, -1) (bottom left), and
    // - face (0, 0) (top left)
    const invAlpha = 1 - alpha;
    const centreTopLeft = this.createCentre(new THREE.Vector3(), -1, -1, z);
    const centreBottomLeft = this.createCentre(new THREE.Vector3(), -1, 0, z);
    const centreTopRight = this.createCentre(new THREE.Vector3(), 0, -1, z);
    const centreBottomRight = this.createCentre(new THREE.Vector3(), 0, 0, z);
    yield this.createBottomRight(new THREE.Vector3(), centreTopLeft).lerp(centreTopLeft, invAlpha);
    yield this.createTopRight(new THREE.Vector3(), centreBottomLeft).lerp(centreBottomLeft, invAlpha);
    yield this.createBottomLeft(new THREE.Vector3(), centreTopRight).lerp(centreTopRight, invAlpha);
    yield this.createTopLeft(new THREE.Vector3(), centreBottomRight).lerp(centreBottomRight, invAlpha);
  }

  createTokenFillVertexIndices(): number[] {
    return [ 0, 1, 2, 1, 3, 2 ];
  }

  forEachAdjacentFace(coord: GridCoord, fn: (face: GridCoord, edge: GridEdge) => void) {
    // Left
    fn(
      { x: coord.x - 1, y: coord.y },
      { x: coord.x, y: coord.y, edge: 0 }
    );

    // Top
    fn(
      { x: coord.x, y: coord.y - 1 },
      { x: coord.x, y: coord.y, edge: 1 }
    );

    // Right
    fn(
      { x: coord.x + 1, y: coord.y },
      { x: coord.x + 1, y: coord.y, edge: 0 }
    );

    // Bottom
    fn(
      { x: coord.x, y: coord.y + 1 },
      { x: coord.x, y: coord.y + 1, edge: 1 }
    );
  }

  getEdgeFaceAdjacency(edge: GridEdge): GridCoord[] {
    switch (edge.edge) {
      case 0: // left
        return [{ x: edge.x - 1, y: edge.y }, { x: edge.x, y: edge.y }];

      default: // top
        return [{ x: edge.x, y: edge.y - 1 }, { x: edge.x, y: edge.y }];
    }
  }

  getEdgeVertexAdjacency(edge: GridEdge): GridVertex[] {
    switch (edge.edge) {
      case 0:
        return [{ x: edge.x, y: edge.y + 1, vertex: 0 }, { x: edge.x, y: edge.y, vertex: 0 }];

      default: // 1
        return [{ x: edge.x, y: edge.y, vertex: 0 }, { x: edge.x + 1, y: edge.y, vertex: 0 }];
    }
  }

  getVertexEdgeAdjacency(vertex: GridVertex): GridEdge[] {
    return [
      { x: vertex.x, y: vertex.y, edge: 0 },
      { x: vertex.x, y: vertex.y, edge: 1 },
      { x: vertex.x, y: vertex.y - 1, edge: 0 },
      { x: vertex.x - 1, y: vertex.y, edge: 1 }
    ];
  }

  toSingle(): IGridGeometry {
    return new SquareGridGeometry(this._squareSize, 1);
  }

  transformToEdge(m: THREE.Matrix4, coord: GridEdge): THREE.Matrix4 {
    const centre = this.createCoordCentre(new THREE.Vector3(), coord, 0);
    m.makeTranslation(centre.x, centre.y, 0);
    return coord.edge === 1 ? m.multiply(
      this._scratchMatrix.makeRotationZ(Math.PI * 0.5)
    ) : m;
  }

  transformToVertex(m: THREE.Matrix4, coord: GridVertex): THREE.Matrix4 {
    const centre = this.createCoordCentre(new THREE.Vector3(), coord, 0);
    return m.makeTranslation(centre.x, centre.y, 0);
  }

  createShaderDeclarations() {
    return [
      ...super.createShaderDeclarations(),
      "uniform float squareSize;"
    ];
  }

  createShaderSnippet() {
    return [
      ...super.createShaderSnippet(),
      "vec2 createCoordCentre(const in vec2 coord) {",
      "  return vec2(coord.x * squareSize, coord.y * squareSize);",
      "}"
    ];
  }

  createShaderUniforms() {
    return {
      ...super.createShaderUniforms(),
      squareSize: { type: 'f', value: null }
    };
  }

  populateShaderUniforms(
    uniforms: Record<string, THREE.IUniform>, faceTex?: THREE.WebGLRenderTarget | undefined, tileOrigin?: THREE.Vector2 | undefined
  ) {
    super.populateShaderUniforms(uniforms, faceTex, tileOrigin);
    uniforms['squareSize'].value = this._squareSize;
  }
}