import { GridCoord } from '../../data/coord';
import { IFeature } from '../../data/feature';
import { IInstancedFeatureObject } from './instancedFeatureObject';

import * as THREE from 'three';

// An instanced feature object that wraps several, complete with a selector.
export class MultipleFeatureObject<K extends GridCoord, F extends IFeature<K>> implements IInstancedFeatureObject<K, F> {
  private readonly _createFeatureObj: (index: string, maxInstances: number) => IInstancedFeatureObject<K, F>;
  private readonly _getIndex: (f: F) => string | undefined;
  private readonly _featureObjs = new Map<string, IInstancedFeatureObject<K, F>>();
  private readonly _maxInstances: number;

  private _scene: THREE.Scene | undefined;

  constructor(
    createFeatureObj: (index: string, maxInstances: number) => IInstancedFeatureObject<K, F>,
    getIndex: (f: F) => string | undefined,
    maxInstances: number
  ) {
    this._createFeatureObj = createFeatureObj;
    this._getIndex = getIndex;
    this._maxInstances = maxInstances;
  }

  private getFeatureObj(index: string) {
    const obj = this._featureObjs.get(index);
    if (obj !== undefined) {
      return obj;
    }

    // When we create a new feature object, we should immediately add it to the
    // scene if we have one:
    const newFeatureObj = this._createFeatureObj(index, this._maxInstances);
    this._featureObjs.set(index, newFeatureObj);
    if (this._scene !== undefined) {
      newFeatureObj.addToScene(this._scene);
    }

    return newFeatureObj;
  }

  addToScene(scene: THREE.Scene) {
    // We'll only support one scene here
    if (this._scene !== undefined) {
      throw Error("Already have a scene");
    }

    this._scene = scene;
    this._featureObjs.forEach(o => o.addToScene(scene));
  }

  removeFromScene(scene: THREE.Scene) {
    if (this._scene !== scene) {
      throw Error("Not in this scene");
    }

    this._scene = undefined;
    this._featureObjs.forEach(o => o.removeFromScene(scene));
  }

  add(f: F) {
    const index = this._getIndex(f);
    if (index === undefined) {
      // This feature is not drawn.
      return false;
    }

    return this.getFeatureObj(index).add(f);
  }

  clear() {
    this._featureObjs.forEach(o => o.clear());
  }

  remove(f: F) {
    const index = this._getIndex(f);
    if (index === undefined) {
      return false;
    }

    return this.getFeatureObj(index).remove(f);
  }

  dispose() {
    this._featureObjs.forEach(o => o.dispose());
    this._featureObjs.clear();
  }
}