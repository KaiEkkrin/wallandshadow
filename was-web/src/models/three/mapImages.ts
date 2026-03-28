import { vertexString } from "../../data/coord";
import { IdDictionary, IIdDictionary } from "../../data/identified";
import { Anchor, IMapControlPoint, IMapControlPointDictionary, IMapControlPointIdentifier, IMapImage } from "../../data/image";
import { ICacheLease } from "../../services/interfaces";
import { Drawn } from "../drawn";
import { IGridGeometry } from "../gridGeometry";
import { InstanceCountedMesh } from "./instancedFeatureObject";
import { RedrawFlag } from "../redrawFlag";
import { IShader } from "./shaderFilter";
import { TextureCache } from "./textureCache";

import { Subscription } from 'rxjs';
import * as THREE from 'three';

// Internally, we file these objects, additionally containing the material
// and mesh so that we can manage cleanup
type MapImage = IMapImage & {
  sub: Subscription; // Subscription to the async operation of resolving and adding the texture
};

type MeshRecord = {
  material: THREE.ShaderMaterial;
  mesh: THREE.Mesh;
  lease: ICacheLease<THREE.Texture>;
};

// This shader allows us to paint map images with a tint defined by a transform and scale,
// allowing us to blend a selection image over the top of the drawn ones.  This should help the user
// align grids in the images with ours
const mapImageShader: IShader = {
  uniforms: {
    "colourScale": { value: null },
    "colourTrans": { value: null },
    "imageTex": { value: null }
  },
  vertexShader: /* uses the Three.js built-in `uv` attribute */ `
    varying vec2 texUv;
    void main() {
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      texUv = uv;
    }
  `,
  fragmentShader: `
    uniform vec4 colourScale;
    uniform vec4 colourTrans;
    uniform sampler2D imageTex;
    varying vec2 texUv;
    void main() {
      vec4 texSample = texture2D(imageTex, texUv);
      gl_FragColor = texSample * colourScale + colourTrans;
    }
  `
};

const mapImageColourScale = new THREE.Vector4(1, 1, 1, 1);
const mapImageColourTrans = new THREE.Vector4(0, 0, 0, 0);
const selectionColourScale = new THREE.Vector4(0.8, 0.8, 0.8, 0.1);
const selectionColourTrans = new THREE.Vector4(0.2, 0.2, 0.2, 0.5);
const zAxis = new THREE.Vector3(0, 0, 1);

function createMapImageMaterial(isSelection: boolean, texture: THREE.Texture) {
  const uniforms = THREE.UniformsUtils.clone(mapImageShader.uniforms);
  uniforms['colourScale'].value = isSelection ? selectionColourScale : mapImageColourScale;
  uniforms['colourTrans'].value = isSelection ? selectionColourTrans : mapImageColourTrans;
  uniforms['imageTex'].value = texture;

  return new THREE.ShaderMaterial({
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
    transparent: true,
    ...mapImageShader,
    uniforms: uniforms
  });
}

function createHighlightMaterial() {
  return new THREE.MeshBasicMaterial({
    blending: THREE.AdditiveBlending,
    color: 0x606060,
    side: THREE.DoubleSide,
    transparent: true
  });
}

function createInvalidHighlightMaterial() {
  return new THREE.MeshBasicMaterial({
    blending: THREE.AdditiveBlending,
    color: 0x600000,
    side: THREE.DoubleSide,
    transparent: true
  });
}

function createSquareBufferGeometry(z: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, z),
    new THREE.Vector3(1, 0, z),
    new THREE.Vector3(1, 1, z),
    new THREE.Vector3(0, 1, z),
  ]);
  g.setIndex([
    0, 1, 3, 1, 3, 2
  ]);
  return g;
}

function positionMesh(gridGeometry: IGridGeometry, mesh: THREE.Mesh, image: IMapImage) {
  const start = gridGeometry.createAnchorPosition(mesh.position, image.start);
  gridGeometry.createAnchorPosition(mesh.scale, image.end).sub(start).add(zAxis);
  mesh.updateMatrix();
  mesh.updateMatrixWorld();
}

// The map images can draw into the main canvas, but because the objects are
// dynamic (there's one draw call per image), they need to be in a separate
// scene that is rendered before the objects (so that area alpha blending
// applies correctly, etc.)
export class MapImages extends Drawn implements IIdDictionary<IMapImage> {
  // For now, we support 4 different angles (0, 90, 180, 270) and implement the rotation
  // by pre-building a different buffer geometry with different UVs for each one.
  private readonly _bufferGeometry: THREE.BufferGeometry[];
  private readonly _scene: THREE.Scene; // we don't own this
  private readonly _values = new Map<string, MapImage>();
  private readonly _meshes = new Map<string, MeshRecord>(); // id -> mesh added to scene
  private readonly _isSelection: boolean;

  private _textureCache: TextureCache; // we don't own this either

  constructor(
    geometry: IGridGeometry,
    redrawFlag: RedrawFlag,
    scene: THREE.Scene,
    textureCache: TextureCache,
    z: number,
    isSelection: boolean
  ) {
    super(geometry, redrawFlag);

    // This is a simple square at [0..1]
    this._bufferGeometry = [0, 1, 2, 3].map(_i => createSquareBufferGeometry(z));

    // ...with the UVs inverted in Y, since we draw with 0 at the top
    this._bufferGeometry[0].setAttribute('uv', new THREE.BufferAttribute(new Float32Array([
      0, 1, 1, 1, 1, 0, 0, 0
    ]), 2));

    this._bufferGeometry[1].setAttribute('uv', new THREE.BufferAttribute(new Float32Array([
      0, 0, 0, 1, 1, 1, 1, 0
    ]), 2));

    this._bufferGeometry[2].setAttribute('uv', new THREE.BufferAttribute(new Float32Array([
      1, 0, 0, 0, 0, 1, 1, 1
    ]), 2));

    this._bufferGeometry[3].setAttribute('uv', new THREE.BufferAttribute(new Float32Array([
      1, 1, 1, 0, 0, 0, 0, 1
    ]), 2));

    this._scene = scene;
    this._isSelection = isSelection;
    this._textureCache = textureCache;
  }

  private addMesh(f: IMapImage, lease: ICacheLease<THREE.Texture>) {
    if (this._meshes.get(f.id) !== undefined) {
      lease.release();
      return;
    }

    const material = createMapImageMaterial(this._isSelection, lease.value);
    const geomIndex = f.rotation === '90' ? 1 : f.rotation === '180' ? 2 : f.rotation === '270' ? 3 : 0;
    const mesh = new THREE.Mesh(this._bufferGeometry[geomIndex], material);
    positionMesh(this.geometry, mesh, f);

    this._scene.add(mesh);
    this._meshes.set(f.id, { lease: lease, material: material, mesh: mesh });
    this.setNeedsRedraw();
  }

  [Symbol.iterator](): Iterator<IMapImage> {
    return this.iterate();
  }

  add(f: IMapImage) {
    if (this._values.has(f.id)) {
      return false;
    }

    // Resolve the texture.  When we have, add the relevant mesh:
    const sub = this._textureCache.resolveImage(f.image).subscribe(
      l => this.addMesh(f, l)
    );
    this._values.set(f.id, { ...f, sub: sub });
    return true;
  }

  clear() {
    // Removing everything individually lets us also remove objects from the scene
    const toRemove = [...this.iterate()];
    toRemove.forEach(f => this.remove(f.id));
  }

  clone(): IIdDictionary<IMapImage> {
    return new IdDictionary<IMapImage>(this._values);
  }

  forEach(fn: (f: IMapImage) => void) {
    this._values.forEach(fn);
  }

  get(k: string): IMapImage | undefined {
    return this._values.get(k);
  }

  *iterate() {
    for (const v of this._values) {
      yield v[1];
    }
  }

  remove(k: string): IMapImage | undefined {
    const value = this._values.get(k);
    if (value !== undefined) {
      // If we're still waiting for a texture, stop that
      value.sub.unsubscribe();

      // Remove and clean up any texture we did receive
      const r = this._meshes.get(value.id);
      if (r !== undefined) {
        this._scene.remove(r.mesh);
        r.material.dispose();
        r.lease.release().then(() => { /* should be okay to let go */ });
        this._meshes.delete(value.id);
        this.setNeedsRedraw();
      }

      this._values.delete(k);
      return value;
    }

    return undefined;
  }

  setTextureCache(textureCache: TextureCache) {
    // Changing this invalidates anything we currently have
    this.clear();
    this._textureCache = textureCache;
  }

  dispose() {
    this.clear(); // will also cleanup leases, materials etc.
    this._bufferGeometry.map(g => g.dispose());
  }
}

// The image control points are drawn like selected vertices at the "start" and "end" positions.
// Because the geometry is instanced, we implement something similar to the InstancedFeatureObject;
// for now, we don't support expand beyond the initial maxInstances, because it's super unlikely
// to end up with many of these (multi-resize doesn't make sense...)
export class MapControlPoints extends Drawn implements IMapControlPointDictionary {
  private readonly _bufferGeometry: THREE.BufferGeometry;
  private readonly _material: THREE.Material;
  private readonly _invalidMaterial: THREE.Material;
  private readonly _mesh: InstanceCountedMesh;
  private readonly _invalidMesh: InstanceCountedMesh;
  private readonly _scene: THREE.Scene; // we don't own this
  private readonly _values = new Map<string, IMapControlPoint & { index: number }>();

  private readonly _zeroCentre: THREE.Vector3;

  constructor(
    gridGeometry: IGridGeometry, redrawFlag: RedrawFlag,
    scene: THREE.Scene,
    alpha: number, z: number, maxInstances?: number | undefined
  ) {
    super(gridGeometry, redrawFlag);

    const single = gridGeometry.toSingle();
    const vertices = [...single.createSolidVertexVertices(new THREE.Vector2(0, 0), alpha, z, 1)];
    const indices = [...single.createSolidVertexIndices(1)];
    this._bufferGeometry = new THREE.BufferGeometry();
    this._bufferGeometry.setFromPoints(vertices);
    this._bufferGeometry.setIndex(indices);

    this._material = createHighlightMaterial();
    this._invalidMaterial = createInvalidHighlightMaterial();
    // Disable frustum culling: instances are scattered across the map, so the
    // bounding sphere would encompass the entire visible area anyway.
    this._mesh = new InstanceCountedMesh(
      maxInstances ?? 100,
      maxInstances => {
        const mesh = new THREE.InstancedMesh(this._bufferGeometry, this._material, maxInstances);
        mesh.frustumCulled = false;
        return mesh;
      }
    );
    this._invalidMesh = new InstanceCountedMesh(
      maxInstances ?? 100,
      maxInstances => {
        const mesh = new THREE.InstancedMesh(this._bufferGeometry, this._invalidMaterial, maxInstances);
        mesh.frustumCulled = false;
        return mesh;
      }
    );

    this._scene = scene;
    scene.add(this._mesh.mesh);
    scene.add(this._invalidMesh.mesh);

    this._zeroCentre = gridGeometry.createVertexCentre(
      new THREE.Vector3(), { x: 0, y: 0, vertex: 0 }, 0
    );
  }

  private toKey(id: IMapControlPointIdentifier) {
    return `${id.id} ${id.which}`;
  }

  private transformToAnchor(m: THREE.Matrix4, a: Anchor): THREE.Matrix4 {
    switch (a.anchorType) {
      case 'vertex':
        console.debug(`drawing control point at ${vertexString(a.position)}`);
        return this.geometry.transformToVertex(m, a.position);

      case 'pixel':
        m.makeTranslation(a.x - this._zeroCentre.x, a.y - this._zeroCentre.y, 0);
        return m;

      default:
        throw Error(`Unsupported anchor type: ${a.anchorType}`);
    }
  }

  [Symbol.iterator]() {
    return this.iterate();
  }

  add(f: IMapControlPoint) {
    const key = this.toKey(f);
    if (this._values.get(key) !== undefined) {
      return false;
    }

    const m = this.transformToAnchor(new THREE.Matrix4(), f.anchor);
    const target = f.invalid === true ? this._invalidMesh : this._mesh;
    const instanceIndex = target.addInstance(m);
    if (instanceIndex === undefined) {
      return false;
    }

    this.setNeedsRedraw();
    this._values.set(key, { ...f, index: instanceIndex });
    return true;
  }

  clear() {
    this._values.clear();
    this._mesh.clear();
    this._invalidMesh.clear();
  }

  forEach(fn: (f: IMapControlPoint) => void) {
    this._values.forEach(fn);
  }

  get(id: IMapControlPointIdentifier) {
    return this._values.get(this.toKey(id));
  }

  *iterate() {
    for (const v of this._values) {
      yield v[1];
    }
  }

  remove(id: IMapControlPointIdentifier) {
    const key = this.toKey(id);
    const value = this._values.get(key);
    if (value === undefined) {
      return undefined;
    }

    (value.invalid === true ? this._invalidMesh : this._mesh).removeInstance(value.index);
    this.setNeedsRedraw();
    this._values.delete(key);
    return value;
  }

  dispose() {
    this._scene.remove(this._mesh.mesh);
    this._scene.remove(this._invalidMesh.mesh);
    this._bufferGeometry.dispose();
    this._material.dispose();
    this._invalidMaterial.dispose();
  }
}