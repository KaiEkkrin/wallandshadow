import { GridCoord, GridEdge, GridVertex, coordAdd } from '../data/coord';
import { EdgeOcclusion } from './occlusion';
import { BaseGeometry, IGridGeometry, EdgeGeometry } from './gridGeometry';
import * as THREE from 'three';

// A tile of hexes.
export class HexGridGeometry extends BaseGeometry implements IGridGeometry {
  private readonly _hexSize: number;

  private readonly _xStep: number;
  private readonly _yStep: number;
  private readonly _xOffLeft: number;
  private readonly _xOffTop: number;
  private readonly _yOffTop: number;
  
  private readonly _scratchMatrix = new THREE.Matrix4();

  constructor(hexSize: number, tileDim: number) {
    super(tileDim, 3, 2);
    this._hexSize = hexSize;

    this._xStep = this._hexSize * Math.sin(Math.PI / 3.0);
    this._yStep = this._hexSize / 2.0; // * Math.sin(Math.PI / 6.0)
    this._xOffLeft = this._xStep * 2.0 / 3.0;
    this._xOffTop = this._xStep / 3.0;
    this._yOffTop = this._hexSize * 0.5;
  }

  get faceSize() { return this._hexSize; }
  get xStep() { return this._xStep; }
  get yStep() { return this._hexSize; }
  get losCircleSamples() { return 6; }

  protected get faceVertexCount() { return 7; }

  protected createCentre(target: THREE.Vector3, x: number, y: number, z: number): THREE.Vector3 {
    return target.set(x * this._xStep, x * this._yStep + y * this._hexSize, z);
  }

  private createLeft(target: THREE.Vector3, c: THREE.Vector3) {
    return target.set(c.x - this._xOffLeft, c.y, c.z);
  }

  private createTopLeft(target: THREE.Vector3, c: THREE.Vector3) {
    return target.set(c.x - this._xOffTop, c.y - this._yOffTop, c.z);
  }

  private createTopRight(target: THREE.Vector3, c: THREE.Vector3) {
    return target.set(c.x + this._xOffTop, c.y - this._yOffTop, c.z);
  }

  private createRight(target: THREE.Vector3, c: THREE.Vector3) {
    return target.set(c.x + this._xOffLeft, c.y, c.z);
  }

  private createBottomLeft(target: THREE.Vector3, c: THREE.Vector3) {
    return target.set(c.x - this._xOffTop, c.y + this._yOffTop, c.z);
  }

  private createBottomRight(target: THREE.Vector3, c: THREE.Vector3) {
    return target.set(c.x + this._xOffTop, c.y + this._yOffTop, c.z);
  }

  createAnnotationPosition(target: THREE.Vector3, scratch1: THREE.Vector3, scratch2: THREE.Vector3, coord: GridCoord, z: number, alpha: number): THREE.Vector3 {
    this.createCoordCentre(target, coord, z);
    this.createLeft(scratch1, target);
    return target.lerp(scratch1, alpha);
  }

  createTokenAnnotationPosition(target: THREE.Vector3, scratch1: THREE.Vector3, scratch2: THREE.Vector3, coord: GridCoord, z: number, alpha: number): THREE.Vector3 {
    this.createCoordCentre(target, coord, z);
    this.createBottomLeft(scratch1, target);
    return target.lerp(scratch1, alpha);
  }

  createEdgeVertices(target1: THREE.Vector3, target2: THREE.Vector3, centre: THREE.Vector3, edge: number) {
    switch (edge) {
      case 0:
        this.createLeft(target1, centre);
        this.createTopLeft(target2, centre);
        break;

      case 1:
        this.createTopLeft(target1, centre);
        this.createTopRight(target2, centre);
        break;

      default:
        this.createTopRight(target1, centre);
        this.createRight(target2, centre);
        break;
    }
  }

  protected createEdgeGeometry(coord: GridEdge, alpha: number, z: number): EdgeGeometry {
    const centre = this.createCoordCentre(new THREE.Vector3(), coord, z);
    const otherCentre = this.createCoordCentre(
      new THREE.Vector3(),
      coord.edge === 0 ? coordAdd(coord, { x: -1, y: 0 }) :
      coord.edge === 1 ? coordAdd(coord, { x: 0, y: -1 }) :
      coordAdd(coord, { x: 1, y: -1 }),
      z
    );

    const [tip1, tip2] = [new THREE.Vector3(), new THREE.Vector3()];
    this.createEdgeVertices(tip1, tip2, centre, coord.edge);
    return new EdgeGeometry(tip1, tip2, centre, otherCentre, alpha);
  }

  createVertexCentre(target: THREE.Vector3, vertex: GridVertex, z: number): THREE.Vector3 {
    // Vertex 0 is the left, vertex 1 the top left
    this.createCoordCentre(target, vertex, z);
    return vertex.vertex === 0 ? this.createLeft(target, target) : this.createTopLeft(target, target);
  }

  getVertexRadius(alpha: number) {
    return this._xOffLeft * alpha;
  }

  private *getHexIndices(offset: number) {
    yield offset;
    yield offset + 2;
    yield offset + 1;

    yield offset;
    yield offset + 3;
    yield offset + 2;

    yield offset;
    yield offset + 4;
    yield offset + 3;

    yield offset;
    yield offset + 5;
    yield offset + 4;

    yield offset;
    yield offset + 6;
    yield offset + 5;

    yield offset;
    yield offset + 1;
    yield offset + 6;
  }

  createEdgeOcclusion(coord: GridCoord, edge: GridEdge, z: number): EdgeOcclusion {
    const [edgeA, edgeB] = [new THREE.Vector3(), new THREE.Vector3()];

    const centre = this.createCentre(new THREE.Vector3(), edge.x, edge.y, z);
    this.createEdgeVertices(edgeA, edgeB, centre, edge.edge);

    this.createCoordCentre(centre, coord, z);
    return new EdgeOcclusion(centre, edgeA, edgeB, this._hexSize * 0.01);
  }

  *createOcclusionTestVertices(coord: GridCoord, z: number, alpha: number): Iterable<THREE.Vector3> {
    const centre = new THREE.Vector3();
    yield this.createCoordCentre(centre, coord, z);

    const invAlpha = 1 - alpha * 0.5;
    yield this.createLeft(new THREE.Vector3(), centre).lerp(centre, invAlpha);
    yield this.createTopLeft(new THREE.Vector3(), centre).lerp(centre, invAlpha);
    yield this.createTopRight(new THREE.Vector3(), centre).lerp(centre, invAlpha);
    yield this.createRight(new THREE.Vector3(), centre).lerp(centre, invAlpha);
    yield this.createBottomRight(new THREE.Vector3(), centre).lerp(centre, invAlpha);
    yield this.createBottomLeft(new THREE.Vector3(), centre).lerp(centre, invAlpha);
  }

  *createSolidVertices(tile: THREE.Vector2, alpha: number, z: number): Iterable<THREE.Vector3> {
    const invAlpha = 1 - alpha;
    for (let y = 0; y < this.tileDim; ++y) {
      for (let x = 0; x < this.tileDim; ++x) {
        const centre = new THREE.Vector3();
        yield this.createCentre(centre, tile.x * this.tileDim + x, tile.y * this.tileDim + y, z);
        yield this.createLeft(new THREE.Vector3(), centre).lerp(centre, invAlpha);
        yield this.createTopLeft(new THREE.Vector3(), centre).lerp(centre, invAlpha);
        yield this.createTopRight(new THREE.Vector3(), centre).lerp(centre, invAlpha);
        yield this.createRight(new THREE.Vector3(), centre).lerp(centre, invAlpha);
        yield this.createBottomRight(new THREE.Vector3(), centre).lerp(centre, invAlpha);
        yield this.createBottomLeft(new THREE.Vector3(), centre).lerp(centre, invAlpha);
      }
    }
  }

  *createSolidMeshIndices() {
    for (let y = 0; y < this.tileDim; ++y) {
      for (let x = 0; x < this.tileDim; ++x) {
        const baseIndex = y * this.tileDim * 7 + x * 7;
        yield* this.getHexIndices(baseIndex);
      }
    }
  }

  *createTokenFillEdgeVertices(alpha: number, z: number): Iterable<THREE.Vector3> {
    // Our edge 0 fills the space between
    // - face (-1, 0) (right and bottom right), and
    // - face (0, 0) (top left and left)
    const invAlpha = 1 - alpha;
    const centre10 = this.createCentre(new THREE.Vector3(), -1, 0, z);
    const centre00 = this.createCentre(new THREE.Vector3(), 0, 0, z);
    yield this.createRight(new THREE.Vector3(), centre10).lerp(centre10, invAlpha);
    yield this.createBottomRight(new THREE.Vector3(), centre10).lerp(centre10, invAlpha);
    yield this.createTopLeft(new THREE.Vector3(), centre00).lerp(centre00, invAlpha);
    yield this.createLeft(new THREE.Vector3(), centre00).lerp(centre00, invAlpha);
  }

  createTokenFillEdgeIndices(): number[] {
    return [ 0, 1, 2, 1, 3, 2 ];
  }

  *createTokenFillVertexVertices(alpha: number, z: number): Iterable<THREE.Vector3> {
    // Our vertex 0 fills the space between
    // - face (-1, 0) (bottom right),
    // - face (-1, 1) (top right), and
    // - face (0, 0) (left)
    const invAlpha = 1 - alpha;
    const centre10 = this.createCentre(new THREE.Vector3(), -1, 0, z);
    const centre11 = this.createCentre(new THREE.Vector3(), -1, 1, z);
    const centre00 = this.createCentre(new THREE.Vector3(), 0, 0, z);
    yield this.createBottomRight(new THREE.Vector3(), centre10).lerp(centre10, invAlpha);
    yield this.createTopRight(new THREE.Vector3(), centre11).lerp(centre11, invAlpha);
    yield this.createLeft(new THREE.Vector3(), centre00).lerp(centre00, invAlpha);
  }

  createTokenFillVertexIndices(): number[] {
    return [ 0, 1, 2 ];
  }

  forEachAdjacentFace(coord: GridCoord, fn: (face: GridCoord, edge: GridEdge) => void) {
    // Top left
    fn(
      { x: coord.x - 1, y: coord.y },
      { x: coord.x, y: coord.y, edge: 0 }
    );

    // Top
    fn(
      { x: coord.x, y: coord.y - 1 },
      { x: coord.x, y: coord.y, edge: 1 }
    );

    // Top right
    fn(
      { x: coord.x + 1, y: coord.y - 1 },
      { x: coord.x, y: coord.y, edge: 2 }
    )

    // Bottom right
    fn(
      { x: coord.x + 1, y: coord.y },
      { x: coord.x + 1, y: coord.y, edge: 0 }
    );

    // Bottom
    fn(
      { x: coord.x, y: coord.y + 1 },
      { x: coord.x, y: coord.y + 1, edge: 1 }
    );

    // Bottom left
    fn(
      { x: coord.x - 1, y: coord.y + 1 },
      { x: coord.x - 1, y: coord.y + 1, edge: 2 }
    );
  }

  getEdgeFaceAdjacency(edge: GridEdge): GridCoord[] {
    switch (edge.edge) {
      case 0: // left
        return [{ x: edge.x - 1, y: edge.y }, { x: edge.x, y: edge.y }];

      case 1: // top left
        return [{ x: edge.x, y: edge.y - 1 }, { x: edge.x, y: edge.y }];

      default: // top right
        return [{ x: edge.x + 1, y: edge.y - 1 }, { x: edge.x, y: edge.y }];
    }
  }

  getEdgeVertexAdjacency(edge: GridEdge): GridVertex[] {
    switch (edge.edge) {
      case 0:
        return [{ x: edge.x, y: edge.y, vertex: 0 }, { x: edge.x, y: edge.y, vertex: 1 }];

      case 1:
        return [{ x: edge.x, y: edge.y, vertex: 1 }, { x: edge.x + 1, y: edge.y - 1, vertex: 0 }];

      default: // 2
        return [{ x: edge.x + 1, y: edge.y - 1, vertex: 0 }, { x: edge.x + 1, y: edge.y, vertex: 1 }];
    }
  }

  getVertexEdgeAdjacency(vertex: GridVertex): GridEdge[] {
    switch (vertex.vertex) {
      case 0:
        return [
          { x: vertex.x, y: vertex.y, edge: 0 },
          { x: vertex.x - 1, y: vertex.y + 1, edge: 2 },
          { x: vertex.x - 1, y: vertex.y + 1, edge: 1 }
        ];

      default: // 1
        return [
          { x: vertex.x, y: vertex.y, edge: 0 },
          { x: vertex.x, y: vertex.y, edge: 1 },
          { x: vertex.x - 1, y: vertex.y, edge: 2 }
        ];
    }
  }

  toSingle(): IGridGeometry {
    return new HexGridGeometry(this._hexSize, 1);
  }

  transformToEdge(m: THREE.Matrix4, coord: GridEdge): THREE.Matrix4 {
    const centre = this.createCoordCentre(new THREE.Vector3(), coord, 0);
    m.makeTranslation(centre.x, centre.y, 0);
    return coord.edge === 2 ? m.multiply(
      this._scratchMatrix.makeRotationZ(Math.PI * 2.0 / 3.0)
    ) : coord.edge === 1 ? m.multiply(
      this._scratchMatrix.makeRotationZ(Math.PI / 3.0)
    ) : m;
  }

  transformToVertex(m: THREE.Matrix4, coord: GridVertex): THREE.Matrix4 {
    const centre = this.createCoordCentre(new THREE.Vector3(), coord, 0);
    m.makeTranslation(centre.x, centre.y, 0);
    return coord.vertex === 1 ? m.multiply(
      this._scratchMatrix.makeRotationZ(Math.PI / 3.0)
    ) : m;
  }

  createShaderDeclarations() {
    return [
      ...super.createShaderDeclarations(),
      "uniform vec2 hexStep;",
      "uniform float hexSize;"
    ];
  }

  createShaderSnippet() {
    return [
      ...super.createShaderSnippet(),
      "vec2 createCoordCentre(const in vec2 coord) {",
      "  return vec2(coord.x * hexStep.x, coord.x * hexStep.y + coord.y * hexSize);",
      "}"
    ];
  }

  createShaderUniforms() {
    return {
      ...super.createShaderUniforms(),
      hexStep: { type: 'v2', value: null },
      hexSize: { type: 'f', value: null }
    };
  }

  populateShaderUniforms(
    uniforms: Record<string, THREE.IUniform>, faceTex?: THREE.WebGLRenderTarget | undefined, tileOrigin?: THREE.Vector2 | undefined
  ) {
    super.populateShaderUniforms(uniforms, faceTex, tileOrigin);
    uniforms['hexStep'].value = new THREE.Vector2(this._xStep, this._yStep);
    uniforms['hexSize'].value = this._hexSize;
  }
}