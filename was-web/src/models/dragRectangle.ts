import { GridCoord } from '../data/coord';
import { IGridGeometry } from './gridGeometry';
import { IDragRectangle, IOutlinedRectangle } from './interfaces';
import { TestVertexCollection, RectangleOcclusion } from './occlusion';

import * as THREE from 'three';
import fluent from 'fluent-iterable';

const zAxis = new THREE.Vector3(0, 0, 1);

// Encapsulates the drag rectangle that is shown while Shift-dragging
// in some circumstances.
export class DragRectangle implements IDragRectangle {
  private readonly _outlined: IOutlinedRectangle;
  private readonly _getGridCoordAt: (cp: THREE.Vector3) => GridCoord | undefined;
  private readonly _getClientToWorld: (target: THREE.Matrix4) => THREE.Matrix4;

  private readonly _testVertexCollection: TestVertexCollection;

  // The client position where the rectangle begins, if we're enabled.
  private _start: THREE.Vector3 | undefined;

  constructor(
    outlined: IOutlinedRectangle,
    geometry: IGridGeometry,
    getGridCoordAt: (cp: THREE.Vector3) => GridCoord | undefined,
    getClientToWorld: (target: THREE.Matrix4) => THREE.Matrix4
  ) {
    this._outlined = outlined;
    this._getGridCoordAt = getGridCoordAt;
    this._getClientToWorld = getClientToWorld;

    // We pre-build the test vertex collection for detecting selections
    this._testVertexCollection = new TestVertexCollection(geometry, 0, 1);
  }

  private *enumerateCanvasDragRectanglePoints(scratch: THREE.Vector3) {
    yield this._outlined.position.clone();

    scratch.set(this._outlined.scale.x, 0, 0);
    yield this._outlined.position.clone().add(scratch);

    scratch.set(this._outlined.scale.x, this._outlined.scale.y, 0);
    yield this._outlined.position.clone().add(scratch);

    scratch.set(0, this._outlined.scale.y, 0);
    yield this._outlined.position.clone().add(scratch);
  }

  private *enumerateCoordsInDragRectangle(scratch: THREE.Vector3) {
    const coordMin = { x: Number.MAX_SAFE_INTEGER, y: Number.MAX_SAFE_INTEGER };
    const coordMax = { x: Number.MIN_SAFE_INTEGER, y: Number.MIN_SAFE_INTEGER };
    for (const p of this.enumerateCanvasDragRectanglePoints(scratch)) {
      const coord = this._getGridCoordAt(p);
      if (coord === undefined) {
        continue;
      }
      coordMin.x = Math.min(coordMin.x, coord.x);
      coordMin.y = Math.min(coordMin.y, coord.y);
      coordMax.x = Math.max(coordMax.x, coord.x);
      coordMax.y = Math.max(coordMax.y, coord.y);
    }

    for (let y = coordMin.y; y <= coordMax.y; ++y) {
      for (let x = coordMin.x; x <= coordMax.x; ++x) {
        yield { x: x, y: y };
      }
    }
  }

  createFilter() {
    if (this._start === undefined || this._outlined.scale.x < 1 || this._outlined.scale.y < 1) {
      // There definitely isn't anything to select
      return (_c: GridCoord) => false;
    }

    // To achieve this, I need to get the drag rectangle into world co-ordinates,
    // which are centred at (0, 0).
    const clientToWorld = this._getClientToWorld(new THREE.Matrix4());
    const rectanglePoints =
      [...this.enumerateCanvasDragRectanglePoints(new THREE.Vector3())]
        .map(p => p.applyMatrix4(clientToWorld));

    // For efficiency, we create the test vertices once and then transform them
    // as required
    const rectangleOcclusion = new RectangleOcclusion(0, [...rectanglePoints]);
    return (c: GridCoord) => {
      for (const v of this._testVertexCollection.enumerate(c)) {
        if (rectangleOcclusion.test(v) === true) {
          return true;
        }
      }

      return false;
    };
  }

  enumerateCoords() {
    const inRectangle = this.createFilter();
    return fluent(this.enumerateCoordsInDragRectangle(new THREE.Vector3()))
      .filter(inRectangle);
  }

  isEnabled() {
    return this._start !== undefined;
  }

  moveTo(cp: THREE.Vector3) {
    if (this._start === undefined) {
      return false;
    }

    const start = this._start;
    this._outlined.visible = true;
    return this._outlined.alter(o => {
      // Create the translation
      o.position.copy(start).min(cp);

      // Create the scaling (remembering to scale by 1 in z always...)
      o.scale.copy(start).max(cp).sub(o.position).add(zAxis);
      o.updateMatrix();
      o.updateMatrixWorld();
      return true;
    });
  }

  reset() {
    this._start = undefined;
    this._outlined.visible = false;
  }

  start(cp: THREE.Vector3) {
    this._start = cp;

    // We don't show the drag rectangle until we receive a move -- it's not
    // interesting to show a zero-size rectangle :)
  }

  // Translates the whole selection box -- as oppoed to `moveTo`, which moves
  // only the current drag point.  Call this when the view is panned.
  translate(cp: THREE.Vector3) {
    if (this._start === undefined) {
      return false;
    }

    this._start.add(cp);
    return this._outlined.alter(o => {
      o.position.add(cp);
      return true;
    });
  }
}