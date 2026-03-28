import { GridVertex, vertexString } from '../../data/coord';
import { FeatureDictionary, IFeatureDictionary, ITokenText } from '../../data/feature';

import { Drawn } from '../drawn';
import { IGridGeometry } from '../gridGeometry';
import { RedrawFlag } from '../redrawFlag';
import textCreator from './textCreator';

import * as THREE from 'three';
import fluent from 'fluent-iterable';

interface ITokenTextWithMesh extends ITokenText {
  mesh: THREE.Mesh;
}

const offsetMultiplicand = new THREE.Vector3(-0.5, 0.5, 0.0);

// The token texts are drawn into their own buffer which is then rendered to the screen
// via the text filter.  So, they maintain their own scene, and need to be kept apprised
// of the screen size via resize().
export class TokenTexts extends Drawn implements IFeatureDictionary<GridVertex, ITokenText> {
  private readonly _dict = new FeatureDictionary<GridVertex, ITokenTextWithMesh>(vertexString);

  // We cache text geometries here to avoid repeated re-creation
  private readonly _geometries = new Map<string, THREE.ShapeGeometry>();

  private readonly _material: THREE.MeshBasicMaterial; // we don't own this
  private readonly _z: number;

  // excessive allocation of these is expensive
  private readonly _scratchMatrix1 = new THREE.Matrix4();
  private readonly _scratchMatrix2 = new THREE.Matrix4();
  private readonly _scratchVector1 = new THREE.Vector3();
  private readonly _scratchVector2 = new THREE.Vector3();
  private readonly _targetPosition = new THREE.Vector3();
  private readonly _transform = new THREE.Matrix4();

  private _scene: THREE.Scene | undefined = undefined;

  constructor(
    gridGeometry: IGridGeometry,
    redrawFlag: RedrawFlag,
    material: THREE.MeshBasicMaterial,
    z: number
  ) {
    super(gridGeometry, redrawFlag);
    this._material = material;
    this._z = z;
  }

  private createMesh(f: ITokenText, geometry: THREE.ShapeGeometry, bb: THREE.Box3) {
    const mesh = new THREE.Mesh(geometry, this._material);

    const thisOffsetMul = this._scratchVector2.copy(offsetMultiplicand);
    thisOffsetMul.y += f.yOffset;
    const offset = this._scratchVector1.copy(bb.max).sub(bb.min).multiply(thisOffsetMul);
    const targetPosition = (f.atVertex ? this.geometry.createVertexCentre(
      this._targetPosition, f.position, this._z
    ) : this.geometry.createCoordCentre(
      this._targetPosition, f.position, this._z
    ));

    const targetSize = 0.15 * Math.pow(f.size, 0.5);
    const transform = this._transform.makeTranslation(targetPosition.x, targetPosition.y, targetPosition.z)
      .multiply(this._scratchMatrix1.makeScale(targetSize, targetSize, 1))
      .multiply(this._scratchMatrix2.makeTranslation(offset.x, offset.y, 0));
    mesh.applyMatrix4(transform);
    return mesh;
  }

  private getGeometry(text: string): THREE.ShapeGeometry | undefined {
    let geometry = this._geometries.get(text);
    if (geometry !== undefined) {
      return geometry;
    }

    geometry = textCreator.create(text, this.geometry.faceSize);
    if (geometry !== undefined) {
      this._geometries.set(text, geometry);
    }

    return geometry;
  }

  addToScene(scene: THREE.Scene) {
    if (this._scene !== undefined) {
      return;
    }

    this._scene = scene;
    this._dict.forEach(f => scene.add(f.mesh));
  }

  removeFromScene(scene: THREE.Scene) {
    if (this._scene === undefined) {
      return;
    }

    this._dict.forEach(f => scene.remove(f.mesh));
    this._scene = undefined;
  }

  // DICTIONARY IMPLEMENTATION

  [Symbol.iterator](): Iterator<ITokenText> {
    return this.iterate();
  }

  get size(): number {
    return this._dict.size;
  }

  add(f: ITokenText): boolean {
    const geometry = this.getGeometry(f.text);
    if (geometry === undefined || geometry.boundingBox === null) {
      return false;
    }

    const mesh = this.createMesh(f, geometry, geometry.boundingBox);
    if (this._dict.add({ ...f, mesh: mesh }) === false) {
      return false;
    }

    this._scene?.add(mesh);
    this.setNeedsRedraw();
    return true;
  }

  clear() {
    const toRemove = [...fluent(this._dict.iterate())];
    toRemove.forEach(f => this.remove(f.position));
  }

  clone() {
    // This gets you an incomplete clone, good for testing possible changes, but not for display
    return this._dict.clone();
  }

  forEach(fn: (f: ITokenText) => void) {
    this._dict.forEach(fn);
  }

  get(position: GridVertex): ITokenText | undefined {
    return this._dict.get(position);
  }

  iterate() {
    return this._dict.iterate();
  }

  remove(oldPosition: GridVertex): ITokenText | undefined {
    const removed = this._dict.remove(oldPosition);
    if (removed === undefined) {
      return undefined;
    }

    this._scene?.remove(removed.mesh);
    this.setNeedsRedraw();
    return removed;
  }

  dispose() {
    this.clear();
  }
}