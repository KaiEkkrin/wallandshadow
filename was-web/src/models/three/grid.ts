import { GridCoord, coordString, GridVertex, vertexString } from '../../data/coord';
import { IFeature, FeatureDictionary } from '../../data/feature';
import { createAreaGeometry, Areas, createAreas } from './areas';
import { Drawn } from '../drawn';
import { IGridGeometry } from '../gridGeometry';
import { InstancedFeatureObject } from './instancedFeatureObject';
import { IGridBounds } from '../interfaces';
import { RedrawFlag } from '../redrawFlag';
import { createVertexGeometry, Vertices, createVertices } from './vertices';

import * as THREE from 'three';
import fluent from 'fluent-iterable';

// This shading provides the colouring for the coord and vertex colour textures, which
// aren't shown to the user (they look rainbow...) but let us look up a client position
// and get grid co-ordinates.
// Each instance is a whole tile (otherwise we would have to prepare too many vertices...)
// The code in the vertex shader should create the same format as `toPackedXYAbs` and
// `toPackedXYEdge` in GridGeometry.
const epsilon = "epsilon";
const maxEdge = "maxEdge";
const tileDim = "tileDim";
const tileOrigin = "tileOrigin";
const token = "token";
const gridColouredShader = {
  uniforms: {
    epsilon: { value: null as number | null },
    maxEdge: { value: null as number | null },
    tileDim: { value: null as number | null },
    tileOrigin: { value: null as THREE.Vector2 | null },
    token: { value: null as number | null },
  },
  vertexShader: [
    "uniform float epsilon;",
    "uniform float maxEdge;",
    "uniform float tileDim;",
    "uniform vec2 tileOrigin;",
    "uniform float token;", // 1 to set the token flag, else 0
    "attribute vec3 face;", // per-vertex; z is the edge or vertex number
    "attribute vec2 tile;", // per-instance
    "varying vec3 vertexColour;", // packed colour

    "float packXYAbs(const in vec2 c) {",
    "  return epsilon + (abs(c.y) * tileDim + abs(c.x)) / (tileDim * tileDim);",
    "}",

    "float packXYSignAndEdge(const in vec2 c, const in float edge) {",
    "  float packedValue = (",
    "    (c.x < 0.0 ? 1.0 : 0.0) +",
    "    (c.y < 0.0 ? 2.0 : 0.0) +",
    "    4.0 * token +",
    "    8.0 * edge +",
    "    8.0 * maxEdge",
    "  );",
    "  return epsilon + packedValue / (16.0 * maxEdge);",
    "}",

    "void main() {",
    "  vertexColour = vec3(",
    "    packXYAbs(tile - tileOrigin),",
    "    packXYSignAndEdge(tile - tileOrigin, face.z),",
    "    packXYAbs(face.xy)",
    "  );",
    "  gl_Position = projectionMatrix * viewMatrix * instanceMatrix * vec4(position, 1.0);",
    "}"
  ].join("\n"),
  fragmentShader: [
    "varying vec3 vertexColour;",
    "void main() {",
    "  gl_FragColor = vec4(vertexColour, 1.0);",
    "}"
  ].join("\n")
};

class GridColouredFeatureObject<K extends GridCoord, F extends IFeature<K>> extends InstancedFeatureObject<K, F> {
  private readonly _gridGeometry: IGridGeometry;
  private readonly _geometry: THREE.InstancedBufferGeometry;
  private readonly _tileAttr: THREE.InstancedBufferAttribute;
  private readonly _instanceTiles: Float32Array;
  private readonly _tileOrigin: THREE.Vector2;
  private readonly _isToken: boolean;

  private _uniforms: Record<string, THREE.IUniform> | null = null;
  private _material: THREE.ShaderMaterial | undefined; // created when required

  constructor(
    toIndex: (k: K) => string,
    transformTo: (m: THREE.Matrix4, position: K) => THREE.Matrix4,
    gridGeometry: IGridGeometry,
    maxInstances: number,
    createGeometry: () => THREE.InstancedBufferGeometry,
    tileOrigin: THREE.Vector2,
    isToken: boolean
  ) {
    super(toIndex, transformTo, maxInstances);
    this._gridGeometry = gridGeometry;
    this._geometry = createGeometry();
    this._tileOrigin = tileOrigin;
    this._isToken = isToken;

    this._instanceTiles = new Float32Array(maxInstances * 2);
    this._tileAttr = new THREE.InstancedBufferAttribute(this._instanceTiles, 2);
    this._tileAttr.setUsage(THREE.DynamicDrawUsage);
    this._geometry.setAttribute('tile', this._tileAttr);
  }

  protected get gridGeometry() { return this._gridGeometry; }
  protected get geometry() { return this._geometry; }

  protected get material(): THREE.ShaderMaterial {
    if (this._material === undefined) {
      const [material, uniforms] = this.createMaterial();
      this._material = material;
      this._uniforms = uniforms;
      return material;
    }

    return this._material;
  }

  protected get uniforms() {
    if (this._uniforms === null) {
      [this._material, this._uniforms] = this.createMaterial();
    }

    return this._uniforms;
  }

  protected createMaterial(): [THREE.ShaderMaterial, Record<string, THREE.IUniform>] {
    const uniforms = THREE.UniformsUtils.clone(gridColouredShader.uniforms);
    uniforms[epsilon].value = this._gridGeometry.epsilon;
    uniforms[maxEdge].value = this._gridGeometry.maxEdge;
    uniforms[tileDim].value = this._gridGeometry.tileDim;
    uniforms[tileOrigin].value = this._tileOrigin;
    uniforms[token].value = this._isToken ? 1.0 : 0.0;

    const material = new THREE.ShaderMaterial({
      uniforms: uniforms,
      vertexShader: gridColouredShader.vertexShader,
      fragmentShader: gridColouredShader.fragmentShader
    });

    return [material, uniforms];
  }

  protected createMesh(maxInstances: number) {
    return new THREE.InstancedMesh(this._geometry, this.material, maxInstances);
  }

  protected addFeature(f: F) {
    const instanceIndex = super.addFeature(f);
    if (instanceIndex === undefined) {
      return undefined;
    }

    // The positions are in grid coords, of course, not tile coords -- convert them here
    this._instanceTiles[2 * instanceIndex] = Math.floor(f.position.x / this.gridGeometry.tileDim);
    this._instanceTiles[2 * instanceIndex + 1] = Math.floor(f.position.y / this.gridGeometry.tileDim);
    this._tileAttr.needsUpdate = true;
    return instanceIndex;
  }

  dispose() {
    super.dispose();
    this._geometry.dispose();
    this._material?.dispose();
  }
}

function createGridAreaGeometry(gridGeometry: IGridGeometry, alpha: number, z: number) {
  const createGeometry = createAreaGeometry(gridGeometry, alpha, z);
  const faceAttrs = gridGeometry.createFaceAttributes();
  return () => {
    const geometry = createGeometry();
    geometry.setAttribute('face', new THREE.BufferAttribute(faceAttrs, 3));
    return geometry;
  }
}

function createGridVertexGeometry(gridGeometry: IGridGeometry, alpha: number, z: number) {
  const createGeometry = createVertexGeometry(gridGeometry, alpha, z);
  const vertexAttrs = gridGeometry.createVertexAttributes();
  return () => {
    const geometry = createGeometry();
    geometry.setAttribute('face', new THREE.BufferAttribute(vertexAttrs, 3));
    return geometry;
  }
}

function createGridColouredAreaObject(
  gridGeometry: IGridGeometry,
  alpha: number,
  z: number,
  tileOrigin: THREE.Vector2,
  isToken: boolean
) {
  return (maxInstances: number) => new GridColouredFeatureObject<GridCoord, IFeature<GridCoord>>(
    coordString,
    (o, p) => gridGeometry.transformToCoord(o, p),
    gridGeometry,
    maxInstances,
    createGridAreaGeometry(gridGeometry, alpha, z),
    tileOrigin,
    isToken
  );
}

function createGridColouredVertexObject(gridGeometry: IGridGeometry, alpha: number, z: number, tileOrigin: THREE.Vector2) {
  return (maxInstances: number) => new GridColouredFeatureObject<GridVertex, IFeature<GridVertex>>(
    vertexString,
    (o, p) => gridGeometry.transformToVertex(o, p),
    gridGeometry,
    maxInstances,
    createGridVertexGeometry(gridGeometry, alpha, z),
    tileOrigin,
    false
  );
}

export class Grid extends Drawn {
  private readonly _textureClearColour = new THREE.Color(0, 0, 0);

  private readonly _faces: Areas;
  private readonly _tokenFaces: Areas;
  private readonly _vertices: Vertices;

  private readonly _tileOrigin = new THREE.Vector2(0, 0);

  private readonly _faceCoordScene: THREE.Scene;
  private readonly _vertexCoordScene: THREE.Scene;

  private readonly _faceCoordRenderTarget: THREE.WebGLRenderTarget;
  private readonly _vertexCoordRenderTarget: THREE.WebGLRenderTarget;

  private readonly _texelReadBuf = new Uint8Array(4);

  private readonly _temp: FeatureDictionary<GridCoord, IFeature<GridCoord>>;

  private _isDisposed = false;

  constructor(
    geometry: IGridGeometry,
    redrawFlag: RedrawFlag,
    gridZ: number,
    losZ: number,
    tokenAlpha: number,
    vertexAlpha: number,
    renderWidth: number,
    renderHeight: number
  ) {
    super(geometry, redrawFlag);

    this._faceCoordScene = new THREE.Scene();
    this._faceCoordRenderTarget = new THREE.WebGLRenderTarget(renderWidth, renderHeight, {
      depthBuffer: false,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping
    });

    // Texture of vertex co-ordinates within the tile.
    this._vertexCoordScene = new THREE.Scene();
    this._vertexCoordRenderTarget = new THREE.WebGLRenderTarget(renderWidth, renderHeight, {
      depthBuffer: false,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping
    });

    this._faces = createAreas(
      geometry,
      redrawFlag,
      createGridColouredAreaObject(geometry, 1.0, gridZ, this._tileOrigin, false),
      100
    );
    this._faces.addToScene(this._faceCoordScene);

    this._tokenFaces = createAreas(
      geometry,
      redrawFlag,
      createGridColouredAreaObject(geometry, tokenAlpha, gridZ + 0.01, this._tileOrigin, true),
      100
    );
    this._tokenFaces.addToScene(this._faceCoordScene);

    this._vertices = createVertices(
      geometry,
      redrawFlag,
      createGridColouredVertexObject(geometry, vertexAlpha, gridZ, this._tileOrigin),
      100
    );
    this._vertices.addToScene(this._vertexCoordScene);

    this._temp = new FeatureDictionary<GridCoord, IFeature<GridCoord>>(coordString);

    // We always start up with the middle of the grid by default:
    this.extendAcrossRange({ minS: -1, minT: -1, maxS: 1, maxT: 1 });
  }

  // We need to access this to feed it to the grid and LoS filters
  get faceCoordRenderTarget() { return this._faceCoordRenderTarget; }
  get vertexCoordRenderTarget() { return this._vertexCoordRenderTarget; }
  get tileOrigin() { return this._tileOrigin; }

  // Extends the grid across the given range of tiles.
  // Returns the number of new tiles added.
  private extendAcrossRange(bounds: IGridBounds) {
    let count = 0;
    for (let t = bounds.minT; t <= bounds.maxT; ++t) {
      for (let s = bounds.minS; s <= bounds.maxS; ++s) {
        const position = { x: s * this.geometry.tileDim, y: t * this.geometry.tileDim };
        if (this._faces.get(position) === undefined) {
          this._faces.add({ position: position, colour: 0 });
          ++count;
        }

        if (this._tokenFaces.get(position) === undefined) {
          this._tokenFaces.add({ position: position, colour: 0 });
        }

        const vertexPosition = { x: position.x, y: position.y, vertex: 0 };
        if (this._vertices.get(vertexPosition) === undefined) {
          this._vertices.add({ position: vertexPosition, colour: 0 });
        }
      }
    }

    // if (count > 0) {
    //   console.debug(`extended grid to ${this._faces.size} tiles at bounds ${JSON.stringify(bounds)}`);
    // }

    return count;
  }

  private extendGridAround(s: number, t: number) {
    // We extend the grid around the given tile until we added something,
    // effectively making it at most 1 tile bigger than it previously was.
    let countAdded = 0;
    for (let expand = 1; countAdded === 0; ++expand) {
      countAdded = this.extendAcrossRange({
        minS: s - expand,
        minT: t - expand,
        maxS: s + expand,
        maxT: t + expand
      });
    }

    return countAdded;
  }

  private *getGridSamples(renderer: THREE.WebGLRenderer, width: number, height: number) {
    const cp = new THREE.Vector3(Math.floor(width * 0.5), Math.floor(height * 0.5), 0);
    yield this.getGridCoordAt(renderer, cp);

    cp.set(0, 0, 0);
    yield this.getGridCoordAt(renderer, cp);

    cp.set(width - 1, 0, 0);
    yield this.getGridCoordAt(renderer, cp);

    cp.set(width - 1, height - 1, 0);
    yield this.getGridCoordAt(renderer, cp);

    cp.set(0, height - 1, 0);
    yield this.getGridCoordAt(renderer, cp);
  }

  // Makes sure this range is filled and removes all tiles outside it.
  private shrinkToRange(bounds: IGridBounds) {
    const added = this.extendAcrossRange(bounds);

    // Fill the temp dictionary with entries for every tile we want to keep
    this._temp.clear();
    for (let t = bounds.minT; t <= bounds.maxT; ++t) {
      for (let s = bounds.minS; s <= bounds.maxS; ++s) {
        const position = { x: s * this.geometry.tileDim, y: t * this.geometry.tileDim };
        this._temp.add({ position: position, colour: 0 });
      }
    }

    // Remove everything outside the range.  Assume the faces and vertices are matching
    // (they should be!)
    const toDelete: GridCoord[] = [];
    for (const face of this._faces) {
      if (this._temp.get(face.position) === undefined) {
        toDelete.push(face.position);
      }
    }

    toDelete.forEach(face => {
      this._faces.remove(face);
      this._tokenFaces.remove(face);
      this._vertices.remove({ x: face.x, y: face.y, vertex: 0 });
      this.setNeedsRedraw();
    });

    // if (added !== 0 || toDelete.length !== 0) {
    //    console.debug(`shrank grid to ${this._faces.size} tiles at bounds ${JSON.stringify(bounds)}`);
    // }

    return added + toDelete.length;
  }

  private updateTileOrigin() {
    // We pick a tile origin in the middle of the tiles we're rendering to
    // maximise the limited amount of precision available to us in the
    // texture colours:
    let [tileCount, tileXSum, tileYSum] = [0, 0, 0];
    for (const t of this._faces) {
      ++tileCount;
      tileXSum += Math.floor(t.position.x / this.geometry.tileDim);
      tileYSum += Math.floor(t.position.y / this.geometry.tileDim);
    }

    if (tileCount !== 0) {
      this._tileOrigin.set(Math.round(tileXSum / tileCount), Math.round(tileYSum / tileCount));
      // console.debug("Set tile origin to " + this._tileOrigin.toArray());
    }
  }

  fitGridToFrame(renderer: THREE.WebGLRenderer) {
    const width = this._faceCoordRenderTarget.width;
    const height = this._faceCoordRenderTarget.height;

    // Take our control samples, which will be in grid coords, and map them
    // back into tile coords
    const samples = [...fluent(this.getGridSamples(renderer, width, height)).map(c => c === undefined ? undefined : {
      x: Math.floor(c.x / this.geometry.tileDim),
      y: Math.floor(c.y / this.geometry.tileDim)
    })];

    const undefinedCount = fluent(samples).count(s => s === undefined);
    let countChanged = 0;
    if (undefinedCount === samples.length) {
      // This shouldn't happen unless we only just loaded the map.  Extend the grid around the origin.
      countChanged = this.extendGridAround(0, 0);
    } else if (undefinedCount > 0) {
      // console.debug(`extending grid around samples: ${JSON.stringify(samples)}`);

      // We're missing grid in part of the view.  Extend the grid by one around the first
      // tile that we found in view -- this should, over the course of a couple of frames,
      // fill the whole view
      const coreTile = samples.find(s => s !== undefined);
      if (coreTile !== undefined) { // clearly :)
        countChanged = this.extendGridAround(coreTile.x, coreTile.y);
      }
    } else {
      // Reduce the amount of stuff we need to consider by removing any tiles outside this range.
      // (The 0 fallbacks here will never be used because of the if clause, and are here to
      // appease TypeScript)
      countChanged = this.shrinkToRange({
        minS: Math.min(...samples.map(s => s?.x ?? 0)),
        minT: Math.min(...samples.map(s => s?.y ?? 0)),
        maxS: Math.max(...samples.map(s => s?.x ?? 0)),
        maxT: Math.max(...samples.map(s => s?.y ?? 0))
      });
    }

    if (countChanged !== 0) {
      this.updateTileOrigin();
    }
  }

  getGridCoordAt(renderer: THREE.WebGLRenderer, cp: THREE.Vector3): GridCoord & { isTokenFace: boolean } | undefined {
    const x = Math.floor(cp.x);
    const y = Math.floor(cp.y);
    if (x < 0 || y < 0 || x >= this._faceCoordRenderTarget.width || y >= this._faceCoordRenderTarget.height) {
      return undefined;
    }

    renderer.readRenderTargetPixels(this._faceCoordRenderTarget, x, y, 1, 1, this._texelReadBuf);
    return this.geometry.decodeCoordSample(this._texelReadBuf, 0, this._tileOrigin);
  }

  getGridVertexAt(renderer: THREE.WebGLRenderer, cp: THREE.Vector3): GridVertex | undefined {
    const x = Math.floor(cp.x);
    const y = Math.floor(cp.y);
    if (x < 0 || y < 0 || x >= this._vertexCoordRenderTarget.width || y >= this._vertexCoordRenderTarget.height) {
      return undefined;
    }

    renderer.readRenderTargetPixels(this._vertexCoordRenderTarget, x, y, 1, 1, this._texelReadBuf);
    return this.geometry.decodeVertexSample(this._texelReadBuf, 0, this._tileOrigin);
  }

  // Renders the face and vertex coords to their respective targets.
  render(renderer: THREE.WebGLRenderer, camera: THREE.Camera) {
    renderer.setRenderTarget(this._faceCoordRenderTarget);
    renderer.setClearColor(this._textureClearColour);
    renderer.clear();
    renderer.render(this._faceCoordScene, camera);

    renderer.setRenderTarget(this._vertexCoordRenderTarget);
    renderer.clear();
    renderer.render(this._vertexCoordScene, camera);

    renderer.setRenderTarget(null);
  }

  resize(width: number, height: number) {
    this._faceCoordRenderTarget.setSize(width, height);
    this._vertexCoordRenderTarget.setSize(width, height);
  }

  dispose() {
    if (this._isDisposed === false) {
      this._faceCoordRenderTarget.dispose();
      this._vertexCoordRenderTarget.dispose();

      this._faces.dispose();
      this._tokenFaces.dispose();
      this._vertices.dispose();
      this._isDisposed = true;
    }
  }
}