import * as THREE from 'three';
import { IGridGeometry } from './gridGeometry';
import { GridCoord } from '../data/coord';

// Describes how to test for occlusion behind an edge as seen from a coord.
export class EdgeOcclusion {
  private readonly _front: PlanarOcclusion;
  private readonly _sideA: PlanarOcclusion;
  private readonly _sideB: PlanarOcclusion;

  private readonly _seenInlineWithEdge: boolean;

  constructor(seenFrom: THREE.Vector3, edgeA: THREE.Vector3, edgeB: THREE.Vector3, epsilon: number) {
    // Find out which way round this thing is
    const chirality = Math.sign(edgeA.clone().sub(seenFrom).cross(edgeB.clone().sub(seenFrom)).z);

    // `edgeNorm` needs to be perpendicular to `edgeA->edgeB` and facing away from `seenFrom`
    const edgeCentre = edgeA.clone().lerp(edgeB, 0.5);
    const edgeNorm = edgeA.clone().sub(edgeB.clone())
      .applyAxisAngle(new THREE.Vector3(0, 0, chirality), Math.PI * 0.5).normalize();
    this._front = new PlanarOcclusion(edgeNorm, edgeCentre, epsilon);

    // `edgeANorm` needs to be turning from `seenFrom->edgeA` to `seenFrom->edgeB`
    const edgeANorm = edgeA.clone().sub(seenFrom)
      .applyAxisAngle(new THREE.Vector3(0, 0, chirality), Math.PI * 0.5).normalize();
    this._sideA = new PlanarOcclusion(edgeANorm, edgeA, epsilon);

    // Similarly, `edgeBNorm` needs to be turning from `seenFrom->edgeB` to `seenFrom->edgeA`
    const edgeBNorm = edgeB.clone().sub(seenFrom)
      .applyAxisAngle(new THREE.Vector3(0, 0, chirality), Math.PI * 1.5).normalize();
    this._sideB = new PlanarOcclusion(edgeBNorm, edgeB, epsilon);

    // If we're seeing this edge in-line, don't apply it at all -- it'll only cause
    // visual artifacts
    this._seenInlineWithEdge = edgeNorm.dot(edgeANorm) > 0.999 || edgeNorm.dot(edgeBNorm) > 0.999;

    // TODO remove all debug
    // console.debug("***");
    // console.debug("seenFrom = " + seenFrom.toArray());
    // console.debug("edgeCentre = " + edgeCentre.toArray());
    // console.debug("chirality = " + chirality);
    // console.debug("edgeNorm = " + edgeNorm.toArray());
    // console.debug("edgeA = " + edgeA.toArray());
    // console.debug("edgeANorm = " + edgeANorm.toArray());
    // console.debug("edgeB = " + edgeB.toArray());
    // console.debug("edgeBNorm = " + edgeBNorm.toArray());
    // console.debug("epsilon = " + epsilon);
  }

  test(point: THREE.Vector3) {
    if (this._seenInlineWithEdge) {
      return false;
    }

    return this._front.test(point) && this._sideA.test(point) && this._sideB.test(point);
  }
}

// Describes how to test for being within an any-angle rectangle.
export class RectangleOcclusion {
  private readonly _planes: PlanarOcclusion[];

  // Construct it with the four points of a rectangle, winding around it.
  // (If you use a number of points other than four it will do weird stuff...)
  constructor(epsilon: number, points: THREE.Vector3[]) {
    this._planes = points.map((p, i) => {
      const next = points[(i + 1) % points.length];
      return new PlanarOcclusion(
        next.clone().sub(p).normalize(),
        p,
        epsilon
      );
    });
  }

  test(point: THREE.Vector3) {
    for (const p of this._planes) {
      if (!p.test(point)) {
        return false;
      }
    }

    return true;
  }
}

class PlanarOcclusion {
  private readonly _norm: THREE.Vector3;
  private readonly _min: number;

  constructor(norm: THREE.Vector3, point: THREE.Vector3, epsilon: number) {
    this._norm = norm;
    this._min = norm.dot(point) - epsilon;
  }

  test(point: THREE.Vector3) {
    const dot = this._norm.dot(point);
    //console.debug("dot = " + dot + "; min = " + this._min);
    return dot >= this._min;
  }
}

// This helper wraps a set of occlusion test vertices and lets you
// transform them around.
export class TestVertexCollection {
  private readonly _geometry: IGridGeometry;
  private readonly _z: number;
  
  // We use this as scratch
  private readonly _vertices: THREE.Vector3[] = [];
  private readonly _scratch = new THREE.Vector3();

  // We never modify this
  private readonly _atZero: THREE.Vector3[] = [];
  private readonly _atOrigin: THREE.Vector3;

  constructor(geometry: IGridGeometry, z: number, alpha: number) {
    this._geometry = geometry;
    this._z = z;

    for (const v of geometry.createOcclusionTestVertices(
      { x: 0, y: 0 }, z, alpha
    )) {
      this._atZero.push(v);
      this._vertices.push(v.clone());
    }

    this._atOrigin = this._atZero[0]; // a bit cheating, assuming this is the middle :)
  }

  get count() { return this._vertices.length; }

  // Enumerates all the vertices at the given coord.
  // The memory yielded will be valid until another enumeration is done.
  *enumerate(coord: GridCoord) {
    this._geometry.createCoordCentre(this._scratch, coord, this._z * 2).sub(this._atOrigin);
    for (let i = 0; i < this._vertices.length; ++i) {
      this._vertices[i].copy(this._atZero[i]).add(this._scratch);
      yield this._vertices[i];
    }
  }
}