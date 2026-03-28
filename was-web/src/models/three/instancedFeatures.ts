import { GridCoord } from '../../data/coord';
import { FeatureDictionary, IFeature, IFeatureDictionary } from '../../data/feature';
import { Drawn } from '../drawn';
import { IGridGeometry } from "../gridGeometry";
import { IInstancedFeatureObject } from './instancedFeatureObject';
import { RedrawFlag } from '../redrawFlag';

import * as THREE from 'three';

// A helpful base class for instanced features such as areas and walls.
// This class manages the underlying meshes and instances as instanced feature
// objects, creating more as required.
// (Argh, more inheritance!  I don't like it, but in this case as with the geometry
// it seems to fit the problem at hand...)
export class InstancedFeatures<K extends GridCoord, F extends IFeature<K>> extends Drawn implements IFeatureDictionary<K, F> {
  private readonly _maxInstances: number;
  private readonly _features: FeatureDictionary<K, F>;

  private readonly _createFeatureObject: (maxInstances: number) => IInstancedFeatureObject<K, F>;
  private readonly _featureObjects: IInstancedFeatureObject<K, F>[] = [];

  // We keep hold of the scene so that things can be added and removed later:
  private _scene: THREE.Scene | undefined;

  constructor(
    geometry: IGridGeometry,
    redrawFlag: RedrawFlag,
    toIndex: (k: K) => string,
    createFeatureObject: (maxInstances: number) => IInstancedFeatureObject<K, F>,
    maxInstances?: number | undefined
  ) {
    super(geometry, redrawFlag);
    this._maxInstances = maxInstances ?? 1000;
    this._features = new FeatureDictionary<K, F>(toIndex);
    this._createFeatureObject = createFeatureObject;
    this.pushFeatureObject();
  }

  private pushFeatureObject() {
    const c = this._createFeatureObject(this._maxInstances);
    this._featureObjects.push(c);

    if (this._scene !== undefined) {
      c.addToScene(this._scene);
    }

    return c;
  }

  protected get featureObjects() { return this._featureObjects; }
  protected get scene(): THREE.Scene | undefined { return this._scene; }

  addToScene(scene: THREE.Scene): boolean {
    if (this._scene !== undefined) {
      return false;
    }

    this._featureObjects.forEach(c => c.addToScene(scene));
    this._scene = scene;
    this.setNeedsRedraw();
    return true;
  }

  removeFromScene() {
    if (this._scene !== undefined) {
      const scene = this._scene;
      this._featureObjects.forEach(c => c.removeFromScene(scene));
      this._scene = undefined;
      this.setNeedsRedraw();
    }
  }

  [Symbol.iterator](): Iterator<F> {
    return this.iterate();
  }

  get size(): number {
    return this._features.size;
  }

  add(f: F): boolean {
    const done = this._features.add(f);
    if (done === false) {
      // This position is already occupied.
      return false;
    }

    // Use the first mesh collection with a free space, or add a new one if we've
    // run out entirely
    let usedExistingCollection = false;
    for (const c of this._featureObjects) {
      if (c.add(f)) {
        usedExistingCollection = true;
        break;
      }
    }

    if (usedExistingCollection === false) {
      this.pushFeatureObject().add(f);
    }

    this.setNeedsRedraw();
    return true;
  }

  clear() {
    this._features.clear();
    this._featureObjects.forEach(c => c.clear());
    this.setNeedsRedraw();
  }

  clone() {
    // Cloning an InstancedFeatures gets you just a clone of the feature dictionary, no more
    return this._features.clone();
  }

  forEach(fn: (f: F) => void) {
    this._features.forEach(fn);
  }

  get(position: K): F | undefined {
    return this._features.get(position);
  }

  iterate() {
    return this._features.iterate();
  }

  remove(oldPosition: K): F | undefined {
    const feature = this._features.remove(oldPosition);
    if (feature === undefined) {
      return undefined;
    }

    for (const c of this._featureObjects) {
      if (c.remove(feature)) {
        break;
      }
    }

    this.setNeedsRedraw();
    return feature;
  }

  dispose() {
    // Not strictly necessary, but would stop us from accidentally trying to
    // render with disposed resources.
    this.removeFromScene();

    // Clean up those feature objects
    this._featureObjects.forEach(c => c.dispose());
  }
}