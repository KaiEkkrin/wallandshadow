import { GridCoord } from '../../data/coord';
import { FeatureDictionary, IFeature } from '../../data/feature';

import * as THREE from 'three';

// A helper class for counting which instances are free and used in an instanced mesh.
export class InstanceCountedMesh {
  private readonly _maxInstances: number;
  private readonly _mesh: THREE.InstancedMesh;

  // This is a set of indices that are currently drawing an off-screen
  // instance and could be re-used.
  private _clearIndices: number[] = [];

  constructor(maxInstances: number, createMesh: (maxInstances: number) => THREE.InstancedMesh) {
    this._maxInstances = maxInstances;
    this._mesh = createMesh(maxInstances);
    this._mesh.count = 0;
    this._mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Always disable frustum culling - we use small base geometry at origin with large transforms
    // in instance data, so the bounding sphere is wrong for frustum culling purposes
    this._mesh.frustumCulled = false;
  }

  get mesh() { return this._mesh; }

  // Assigns an index and the given transform to a new instance.
  addInstance(transform: THREE.Matrix4): number | undefined {
    const instanceIndex = this.assignIndex();
    if (instanceIndex === undefined) {
      return undefined;
    }

    this._mesh.setMatrixAt(instanceIndex, transform);
    this._mesh.instanceMatrix.needsUpdate = true;
    return instanceIndex;
  }

  // Returns an unused index, or undefined if we've run out of them.
  assignIndex(): number | undefined {
    const instanceIndex = this._clearIndices.pop();
    if (instanceIndex !== undefined) {
      return instanceIndex;
    }

    if (this.mesh.count === this._maxInstances) {
      // We've run out.
      return undefined;
    }

    return this.mesh.count++;
  }

  clear() {
    this._clearIndices = [];
    this._mesh.count = 0;
  }

  releaseIndex(instanceIndex: number) {
    this._clearIndices.push(instanceIndex);
  }

  removeInstance(instanceIndex: number) {
    // We find the position of its matrix transform in the instance array.
    // Rather than trying to erase it (awkward), we instead set it to a matrix
    // that will make it appear off-screen, and add the index to the re-use list.
    const o = new THREE.Object3D();
    o.translateZ(-1000);
    o.updateMatrix();
    this.mesh.setMatrixAt(instanceIndex, o.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.releaseIndex(instanceIndex);
  }
}

// The interface of the instanced feature object, which describes a collection
// of features all drawn using the same instanced mesh added to a scene.
export interface IInstancedFeatureObject<K extends GridCoord, F extends IFeature<K>> {
  addToScene(scene: THREE.Scene): void;
  removeFromScene(scene: THREE.Scene): void;

  add(f: F): boolean;
  clear(): void;
  remove(f: F): boolean;

  dispose(): void;
}

// A base class that manages a collection of features all drawn using the
// same instanced mesh added to a scene.
export abstract class InstancedFeatureObject<K extends GridCoord, F extends IFeature<K>> implements IInstancedFeatureObject<K, F> {
  private readonly _toIndex: (k: K) => string;
  private readonly _transformTo: (m: THREE.Matrix4, position: K) => THREE.Matrix4;
  private readonly _maxInstances: number;

  private readonly _indexes: FeatureDictionary<K, IFeature<K>>; // colour as instance index number
  private _mesh: InstanceCountedMesh | undefined; // created when required

  constructor(
    toIndex: (k: K) => string,
    transformTo: (m: THREE.Matrix4, position: K) => THREE.Matrix4,
    maxInstances: number
  ) {
    this._toIndex = toIndex;
    this._transformTo = transformTo;
    this._maxInstances = maxInstances;
    this._indexes = new FeatureDictionary<K, IFeature<K>>(toIndex);
  }

  protected get mesh(): InstanceCountedMesh {
    if (this._mesh === undefined) {
      this._mesh = new InstanceCountedMesh(this._maxInstances, maxInstances => this.createMesh(maxInstances));
    }

    return this._mesh;
  }

  protected get toIndex() { return this._toIndex; }

  // Override this to describe how to create the mesh.
  protected abstract createMesh(maxInstances: number): THREE.InstancedMesh;

  // Override this to do the other things necessary when adding a feature, e.g.
  // filling in other instanced attributes, but call super() first and check
  // a valid instance index was received!
  protected addFeature(f: F): number | undefined {
    const o = new THREE.Object3D();
    this._transformTo(o.matrix, f.position);
    return this.mesh.addInstance(o.matrix);
  }

  // You probably won't need to change how removals work.
  protected removeFeature(f: F, instanceIndex: number) {
    this.mesh.removeInstance(instanceIndex);
  }

  addToScene(scene: THREE.Scene) {
    scene.add(this.mesh.mesh);
  }

  removeFromScene(scene: THREE.Scene) {
    scene.remove(this.mesh.mesh);
  }

  add(f: F) {
    const instanceIndex = this.addFeature(f);
    if (instanceIndex === undefined) {
      return false;
    }

    this._indexes.add({ position: f.position, colour: instanceIndex });
    return true;
  }

  clear() {
    this.mesh.clear();
    this._indexes.clear();
  }

  remove(f: F) {
    const instanceIndex = this._indexes.remove(f.position);
    if (instanceIndex === undefined) {
      return false;
    }

    this.removeFeature(f, instanceIndex.colour);
    return true;
  }

  dispose() {
  }
}