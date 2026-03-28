import { Drawn } from '../drawn';
import { IGridGeometry } from '../gridGeometry';
import { IOutlinedRectangle } from '../interfaces';
import { RedrawFlag } from '../redrawFlag';

import * as THREE from 'three';

const solidZ = 0.7;
const outlineZ = 0.8;

// This draws a simple outlined rectangle.
export class OutlinedRectangle extends Drawn implements IOutlinedRectangle {
  private readonly _solidVertexGeometry: THREE.BufferGeometry;
  private readonly _outlineVertexGeometry: THREE.BufferGeometry;

  private readonly _solidMaterial: THREE.MeshBasicMaterial;
  private readonly _outlineMaterial: THREE.LineBasicMaterial;

  private readonly _object: THREE.Group;

  private _scene: THREE.Scene | undefined;
  private _isVisible = false;
  private _isDisposed = false;

  constructor(geometry: IGridGeometry, redrawFlag: RedrawFlag) {
    super(geometry, redrawFlag);

    // We'll define a unit rectangle and transform it into the expected place:
    this._solidVertexGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, solidZ),
      new THREE.Vector3(1, 0, solidZ),
      new THREE.Vector3(0, 1, solidZ),
      new THREE.Vector3(1, 1, solidZ),
      new THREE.Vector3(0, 1, solidZ),
      new THREE.Vector3(1, 0, solidZ)
    ]);

    this._outlineVertexGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, outlineZ),
      new THREE.Vector3(0, 1, outlineZ),
      new THREE.Vector3(1, 1, outlineZ),
      new THREE.Vector3(1, 0, outlineZ),
      new THREE.Vector3(0, 0, outlineZ),
    ]);

    this._solidMaterial = new THREE.MeshBasicMaterial({
      blending: THREE.AdditiveBlending,
      color: 0x404040
    });

    this._outlineMaterial = new THREE.LineBasicMaterial({
      blending: THREE.AdditiveBlending,
      color: 0x606060
    });

    this._object = new THREE.Group().add(
      new THREE.Mesh(this._solidVertexGeometry, this._solidMaterial),
      new THREE.Line(this._outlineVertexGeometry, this._outlineMaterial)
    );
  }

  get position() { return this._object.position; }
  get scale() { return this._object.scale; }
  get visible() { return this._isVisible; }

  set visible(visible: boolean) {
    if (visible === this._isVisible) {
      return;
    }

    if (visible === true) {
      this._scene?.add(this._object);
    } else {
      this._scene?.remove(this._object);
    }

    this._isVisible = visible;
    this.setNeedsRedraw();
  }

  addToScene(scene: THREE.Scene): boolean {
    if (this._scene !== undefined) {
      return false;
    }

    if (this._isVisible) {
      scene.add(this._object);
    }

    this._scene = scene;
    this.setNeedsRedraw();
    return true;
  }

  removeFromScene() {
    if (this._isVisible) {
      this._scene?.remove(this._object);
    }

    this._scene = undefined;
    this.setNeedsRedraw();
  }
  
  alter(fn: (o: THREE.Object3D) => boolean) {
    if (fn(this._object)) {
      this.setNeedsRedraw();
      return true;
    }

    return false;
  }

  dispose() {
    if (this._isDisposed === true) {
      return;
    }

    this.removeFromScene();
    this._solidVertexGeometry.dispose();
    this._outlineVertexGeometry.dispose();
    this._solidMaterial.dispose();
    this._outlineMaterial.dispose();
    this._isDisposed = true;
  }
}