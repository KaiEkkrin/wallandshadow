import { GridEdge, edgeString } from "../../data/coord";
import { IFeature } from "../../data/feature";
import { LoSPosition, losPositionsEqual } from "../../data/losPosition";
import { Drawn } from "../drawn";
import { IGridGeometry } from "../gridGeometry";
import { InstancedFeatureObject } from "./instancedFeatureObject";
import { InstancedFeatures } from "./instancedFeatures";
import { RedrawFlag } from "../redrawFlag";

import * as THREE from "three";

// Shader-based LoS.
// Careful with this!  In order for it to work correctly, we need to not use the built-in
// attributes `modelMatrix` or `modelViewMatrix`, because they are not instanced.  Instead
// we refer to the built-in attribute `instanceMatrix` in place of `modelMatrix`.  `viewMatrix`
// is not instanced anyway and can be used as expected.
// To do this, I will supply a pair of triangles (forming a rectangle) for each wall
// to the shader, where the vertices are at (edgeA, z); (edgeB, z); (edgeA, q); (edgeB; q)
// The vertices at z=q will be transformed by the vertex shader to be at the point where the
// line from the token centre to the vertex intersects the closest one of the four bounds.
// (which can be fixed at the size 2 cube centred on 0, because we can do this stuff post-
// orthographic projection.)
// This will render the LoS from a single token; to compose multiple tokens together,
// repeat in batches (size 4?) and run a "merge" shader that adds together all the textures in the batches.
// When we've got a final LoS render, we can overlay it onto the screen one by multiply to create
// the drawn LoS layer, and also sample it for allowed/disallowed move purposes.
// We're going to need uniforms:
// - tokenCentre (vec3)
// - zValue (float) (for determining which edges to project; *not* q)
// - shadowIntensity (float) (fraction of shadow per sample, 1/totalSamples)
const tokenCentre = "tokenCentre";
const zValue = "zValue";
const shadowIntensity = "shadowIntensity";

const featureShader = {
  uniforms: {
    tokenCentre: { type: "v3", value: null },
    zValue: { type: "f", value: null },
    shadowIntensity: { type: "f", value: null },
  },
  vertexShader: `
    uniform vec3 tokenCentre;
    uniform float zValue;

    const float near = -10.0;
    const float far = 10.0;
    const float epsilon = 0.00001;

    vec3 intersectHorizontalBounds(const in vec3 origin, const in vec3 dir) {
      return dir.y > 0.0 ?
        vec3(origin.x + (far - origin.y) * dir.x / dir.y, far, origin.z) :
        vec3(origin.x + (near - origin.y) * dir.x / dir.y, near, origin.z);
    }

    vec3 intersectVerticalBounds(const in vec3 origin, const in vec3 dir) {
      return dir.x > 0.0 ?
        vec3(far, origin.y + (far - origin.x) * dir.y / dir.x, origin.z) :
        vec3(near, origin.y + (near - origin.x) * dir.y / dir.x, origin.z);
    }

    vec4 project() {
      if (abs(position.z - zValue) < epsilon) {
        return projectionMatrix * viewMatrix * instanceMatrix * vec4(position, 1.0);
      }
      vec3 projected = (projectionMatrix * viewMatrix * instanceMatrix * vec4(position.xy, zValue, 1.0)).xyz;
      vec3 token = (projectionMatrix * viewMatrix * vec4(tokenCentre, 1.0)).xyz;
      vec3 dir = normalize(projected - token);
      vec3 iHoriz = intersectHorizontalBounds(projected, dir);
      vec3 iVert = intersectVerticalBounds(projected, dir);
      vec3 intersection = abs(dir.x) < epsilon ? iHoriz : abs(dir.y) < epsilon ? iVert :
        dot(iHoriz - projected, dir) < dot(iVert - projected, dir) ? iHoriz : iVert;
      return vec4(intersection, 1.0);
    }

    void main() {
      gl_Position = project();
    }
  `,
  fragmentShader: `
    uniform float shadowIntensity;

    void main() {
      gl_FragColor = vec4(shadowIntensity, shadowIntensity, shadowIntensity, 1.0);
    }
  `,
};

// This feature object draws the shadows cast by the walls using the above shader.
// (It doesn't own the material.)
// Edit the material before rendering this to draw LoS for different tokens
class LoSFeatureObject extends InstancedFeatureObject<
  GridEdge,
  IFeature<GridEdge>
> {
  private readonly _geometry: THREE.InstancedBufferGeometry;
  private readonly _material: THREE.ShaderMaterial;

  constructor(
    gridGeometry: IGridGeometry,
    z: number,
    q: number,
    material: THREE.ShaderMaterial,
    maxInstances: number
  ) {
    super(
      edgeString,
      (o, p) => gridGeometry.transformToEdge(o, p),
      maxInstances
    );
    const single = gridGeometry.toSingle();
    const vertices = [...single.createLoSVertices(z, q)];

    this._geometry = new THREE.InstancedBufferGeometry();
    this._geometry.setFromPoints(vertices);
    this._geometry.setIndex(gridGeometry.createLoSIndices());

    this._material = material;
  }

  protected createMesh(maxInstances: number) {
    return new THREE.InstancedMesh(
      this._geometry,
      this._material,
      maxInstances
    );
  }

  dispose() {
    super.dispose();
    this._geometry.dispose();
  }
}

class LoSFeatures extends InstancedFeatures<GridEdge, IFeature<GridEdge>> {
  constructor(
    geometry: IGridGeometry,
    redrawFlag: RedrawFlag,
    z: number,
    q: number,
    material: THREE.ShaderMaterial,
    maxInstances?: number | undefined
  ) {
    super(
      geometry,
      redrawFlag,
      edgeString,
      (maxInstances) => {
        return new LoSFeatureObject(geometry, z, q, material, maxInstances);
      },
      maxInstances
    );
  }
}

// This class encapsulates the LoS drawing along with its intermediate surfaces.
const maxComposeCount = 8;
const losResolutionDivisor = 2; // Render LoS at 1/2 resolution in each dimension

export class LoS extends Drawn {
  private readonly _featureClearColour: THREE.Color;
  private readonly _features: LoSFeatures;

  private readonly _featureMaterial: THREE.ShaderMaterial;
  private readonly _featureRenderTargets: THREE.WebGLRenderTarget[];
  private readonly _featureScene: THREE.Scene;
  private readonly _featureUniforms: Record<string, THREE.IUniform>;

  private readonly _composeClearColour: THREE.Color;

  // Render targets for ADD-composing sample points within each token (one per token in batch)
  private readonly _tokenComposeTargets: THREE.WebGLRenderTarget[];
  private readonly _tokenComposeClearColour: THREE.Color;

  private readonly _composeGeometry: THREE.BufferGeometry;
  private readonly _composeRenderTarget: THREE.WebGLRenderTarget;
  private readonly _composeScene: THREE.Scene;

  private readonly _losTexelReadBuf = new Uint8Array(36); // 3x3 pixels × 4 bytes

  private _tokenPositions: LoSPosition[] = [];

  // Track both full viewport and reduced LoS render target dimensions
  private _losWidth: number;
  private _losHeight: number;

  // Pooled materials and meshes for compose operations (avoid per-frame allocation)
  private readonly _composeMaterials: THREE.MeshBasicMaterial[];
  private readonly _composeMeshes: THREE.Mesh[];
  private readonly _tokenComposeMaterials: THREE.MeshBasicMaterial[];
  private readonly _tokenComposeMeshes: THREE.Mesh[];

  private _isDisposed = false;

  constructor(
    geometry: IGridGeometry,
    redrawFlag: RedrawFlag,
    z: number,
    q: number,
    renderWidth: number,
    renderHeight: number,
    maxInstances?: number | undefined
  ) {
    super(geometry, redrawFlag);

    // Calculate reduced LoS render target dimensions (1/4 in each dimension)
    this._losWidth = Math.max(
      1,
      Math.floor(renderWidth / losResolutionDivisor)
    );
    this._losHeight = Math.max(
      1,
      Math.floor(renderHeight / losResolutionDivisor)
    );

    this._featureClearColour = new THREE.Color(0, 0, 0); // visible (black) by default; we draw shadows as white

    this._featureUniforms = THREE.UniformsUtils.clone(featureShader.uniforms);
    this._featureUniforms[tokenCentre].value = new THREE.Vector3();
    this._featureUniforms[zValue].value = z;
    // shadowIntensity will be set in render() based on geometry.losCircleSamples
    this._featureUniforms[shadowIntensity].value = 1.0;
    this._featureMaterial = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms: this._featureUniforms,
      vertexShader: featureShader.vertexShader,
      fragmentShader: featureShader.fragmentShader,
      // Use MAX blending to retain the maximum (brightest/shadow) color value when
      // multiple shadow fragments overlap the same pixel (white = shadow)
      blending: THREE.CustomBlending,
      blendEquation: THREE.MaxEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
    });

    this._features = new LoSFeatures(
      geometry,
      redrawFlag,
      z,
      q,
      this._featureMaterial,
      maxInstances
    );
    this._featureRenderTargets = [];
    for (let i = 0; i < maxComposeCount; ++i) {
      this._featureRenderTargets.push(
        this.createRenderTarget(this._losWidth, this._losHeight)
      );
    }

    this._featureScene = new THREE.Scene();
    this._features.addToScene(this._featureScene);

    // Token compose targets for ADD-composing sample points within each token (one per token in batch)
    this._tokenComposeTargets = [];
    for (let i = 0; i < maxComposeCount; ++i) {
      this._tokenComposeTargets.push(
        this.createRenderTarget(this._losWidth, this._losHeight)
      );
    }
    this._tokenComposeClearColour = new THREE.Color(0, 0, 0); // visible (no shadow) by default

    this._composeClearColour = new THREE.Color(1, 1, 1); // shadowed (white) unless seen by something
    this._composeRenderTarget = this.createRenderTarget(
      this._losWidth,
      this._losHeight
    );
    this._composeScene = new THREE.Scene();

    // Create the geometry we use to compose the LoS together
    this._composeGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-1, -1, 0),
      new THREE.Vector3(1, -1, 0),
      new THREE.Vector3(-1, 1, 0),
      new THREE.Vector3(1, 1, 0),
    ]);
    this._composeGeometry.setIndex([0, 1, 2, 1, 2, 3]);

    // Yes, having the UVs specified is mandatory :P
    this._composeGeometry.setAttribute(
      "uv",
      new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), 2)
    );

    // Pre-create materials for MIN-compose (token → final)
    this._composeMaterials = [];
    this._composeMeshes = [];
    for (let i = 0; i < maxComposeCount; ++i) {
      const material = new THREE.MeshBasicMaterial({
        blending: THREE.CustomBlending,
        blendEquation: THREE.MinEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneFactor,
        side: THREE.DoubleSide,
        transparent: true,
      });
      this._composeMaterials.push(material);
      this._composeMeshes.push(new THREE.Mesh(this._composeGeometry, material));
    }

    // Pre-create materials for ADD-compose (samples → token)
    this._tokenComposeMaterials = [];
    this._tokenComposeMeshes = [];
    for (let i = 0; i < maxComposeCount; ++i) {
      const material = new THREE.MeshBasicMaterial({
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneFactor,
        side: THREE.DoubleSide,
        transparent: true,
      });
      this._tokenComposeMaterials.push(material);
      this._tokenComposeMeshes.push(new THREE.Mesh(this._composeGeometry, material));
    }
  }

  // MIN-composes token compose targets to produce final LoS (any token seeing a pixel makes it visible)
  private compose(
    camera: THREE.Camera,
    renderer: THREE.WebGLRenderer,
    count: number
  ) {
    // TODO #52 To successfully down-scale the LoS, this here needs its own camera
    renderer.setRenderTarget(this._composeRenderTarget);

    for (let i = 0; i < count; ++i) {
      // Update texture reference on pooled material (avoids per-frame material allocation)
      this._composeMaterials[i].map = this._tokenComposeTargets[i].texture;
      this._composeMaterials[i].needsUpdate = true;
      this._composeScene.add(this._composeMeshes[i]);
    }

    renderer.render(this._composeScene, camera);

    // Remove meshes from scene (but don't dispose - they're pooled)
    for (let i = 0; i < count; ++i) {
      this._composeScene.remove(this._composeMeshes[i]);
    }
  }

  // Generates sample points for multi-sample LoS rendering: centre + perimeter points
  private generateSamplePoints(pos: LoSPosition, z: number): THREE.Vector3[] {
    const points: THREE.Vector3[] = [];
    const centre = this.geometry.createCoordCentre(new THREE.Vector3(), pos, z);
    points.push(centre);

    const perimeterSamples = this.geometry.losCircleSamples;
    const radius = pos.radius * 0.9; // Shrink slightly to avoid wall-intersection edge cases

    for (let i = 0; i < perimeterSamples; i++) {
      const angle = (i / perimeterSamples) * 2 * Math.PI; // Start from 0 (right)
      points.push(
        new THREE.Vector3(
          centre.x + Math.cos(angle) * radius,
          centre.y + Math.sin(angle) * radius,
          z
        )
      );
    }
    return points;
  }

  // ADD-composes sample point renders into specified token compose target (does not clear - caller must clear when starting new token)
  private composeTokenSamples(
    camera: THREE.Camera,
    renderer: THREE.WebGLRenderer,
    tokenIndex: number,
    count: number
  ) {
    renderer.setRenderTarget(this._tokenComposeTargets[tokenIndex]);

    for (let i = 0; i < count; ++i) {
      // Update texture reference on pooled material (avoids per-frame material allocation)
      this._tokenComposeMaterials[i].map = this._featureRenderTargets[i].texture;
      this._tokenComposeMaterials[i].needsUpdate = true;
      this._composeScene.add(this._tokenComposeMeshes[i]);
    }

    renderer.render(this._composeScene, camera);

    // Remove meshes from scene (but don't dispose - they're pooled)
    for (let i = 0; i < count; ++i) {
      this._composeScene.remove(this._tokenComposeMeshes[i]);
    }
  }

  private createRenderTarget(renderWidth: number, renderHeight: number) {
    return new THREE.WebGLRenderTarget(renderWidth, renderHeight, {
      depthBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
    });
  }

  // Accesses the LoS features themselves -- these should be sync'd with the walls,
  // but with only colour 0.
  get features() {
    return this._features;
  }

  // Accesses the composed LoS render target so that we can use it to draw.
  get target() {
    return this._composeRenderTarget;
  }

  // Checks the LoS for the given client position and returns true if the position
  // is visible, else false.
  checkLoS(renderer: THREE.WebGLRenderer, cp: THREE.Vector3) {
    // Use the tracked LoS dimensions (reduced resolution)
    const cx = Math.floor((cp.x + 1) * 0.5 * this._losWidth);
    const cy = Math.floor((cp.y + 1) * 0.5 * this._losHeight);

    // Calculate clipped 3x3 region (handle edges)
    const x0 = Math.max(0, cx - 1);
    const y0 = Math.max(0, cy - 1);
    const x1 = Math.min(this._losWidth, cx + 2); // exclusive
    const y1 = Math.min(this._losHeight, cy + 2); // exclusive
    const w = x1 - x0;
    const h = y1 - y0;

    if (w <= 0 || h <= 0) {
      return false; // Completely out of bounds
    }

    // Read the clipped region
    renderer.readRenderTargetPixels(
      this._composeRenderTarget,
      x0,
      y0,
      w,
      h,
      this._losTexelReadBuf
    );

    // Sample the 5 positions (center + 4 corners) that fall within the read region
    // Positions relative to read origin (x0, y0)
    const positions = [
      [cx - x0, cy - y0], // center
      [cx - 1 - x0, cy - 1 - y0], // top-left
      [cx + 1 - x0, cy - 1 - y0], // top-right
      [cx - 1 - x0, cy + 1 - y0], // bottom-left
      [cx + 1 - x0, cy + 1 - y0], // bottom-right
    ];

    let visibleCount = 0;
    for (const [px, py] of positions) {
      if (px < 0 || py < 0 || px >= w || py >= h) {
        continue; // This sample is outside the clipped region
      }
      const offset = (py * w + px) * 4;
      visibleCount += 255 - (this._losTexelReadBuf[offset] ?? 255);
    }

    return visibleCount > 0.1;
  }

  // Renders the LoS frames using multi-sample approach.
  // For each token, renders LoS from multiple sample points (centre + perimeter),
  // ADD-composes them, then MIN-composes across tokens.
  render(
    camera: THREE.Camera,
    fixedCamera: THREE.Camera,
    renderer: THREE.WebGLRenderer
  ) {
    // Always clear the composed target to begin with (otherwise, with 0 token positions to
    // render, we'll end up returning the old composed target!)
    renderer.setRenderTarget(this._composeRenderTarget);
    renderer.setClearColor(this._composeClearColour);
    renderer.clear();

    const z = this._featureUniforms[zValue].value as number;
    const totalSamples = this.geometry.losCircleSamples + 1; // perimeter + centre

    // TODO BUG? If I don't apply an excess of shadow intensity here I get
    // occasional light bleed into closed areas that the token shouldn't be able
    // to see into...
    //this._featureUniforms[shadowIntensity].value = 1.0 / totalSamples;
    this._featureUniforms[shadowIntensity].value = 1.5 / totalSamples;

    let tokenResultCount = 0;

    for (const pos of this._tokenPositions) {
      const tokenIndex = tokenResultCount % maxComposeCount;

      // Generate sample points for this token (centre + perimeter)
      const samples = this.generateSamplePoints(pos, z);

      // Clear this token's compose target (black = no shadow)
      renderer.setRenderTarget(this._tokenComposeTargets[tokenIndex]);
      renderer.setClearColor(this._tokenComposeClearColour);
      renderer.clear();

      // Render each sample point
      for (let s = 0; s < samples.length; s++) {
        const featureTargetIndex = s % maxComposeCount;
        this._featureUniforms[tokenCentre].value.copy(samples[s]);

        renderer.setRenderTarget(
          this._featureRenderTargets[featureTargetIndex]
        );
        renderer.setClearColor(this._featureClearColour);
        renderer.clear();
        renderer.render(this._featureScene, camera);

        if (featureTargetIndex === maxComposeCount - 1) {
          // We've filled all feature render targets; ADD-compose to this token's target
          this.composeTokenSamples(
            fixedCamera,
            renderer,
            tokenIndex,
            maxComposeCount
          );
        }
      }

      // ADD-compose any remaining samples for this token
      const remaining = samples.length % maxComposeCount;
      if (remaining > 0) {
        this.composeTokenSamples(fixedCamera, renderer, tokenIndex, remaining);
      }

      // This token's compose target now has its full LoS
      tokenResultCount++;

      if (tokenResultCount % maxComposeCount === 0) {
        // We've filled all token compose targets; MIN-compose them
        this.compose(fixedCamera, renderer, maxComposeCount);
      }
    }

    // Final MIN-compose for any remaining token results
    const remainingTokens = tokenResultCount % maxComposeCount;
    if (remainingTokens > 0) {
      this.compose(fixedCamera, renderer, remainingTokens);
    }

    renderer.setRenderTarget(null);
  }

  resize(width: number, height: number) {
    // Calculate reduced LoS render target dimensions (1/2 in each dimension)
    this._losWidth = Math.max(1, Math.floor(width / losResolutionDivisor));
    this._losHeight = Math.max(1, Math.floor(height / losResolutionDivisor));
    this._featureRenderTargets.forEach((t) =>
      t.setSize(this._losWidth, this._losHeight)
    );
    this._tokenComposeTargets.forEach((t) =>
      t.setSize(this._losWidth, this._losHeight)
    );
    this._composeRenderTarget.setSize(this._losWidth, this._losHeight);
  }

  // Assigns the positions of the tokens to draw LoS for.
  setTokenPositions(positions: LoSPosition[]) {
    // If these are the same, we don't need to do anything:
    if (losPositionsEqual(positions, this._tokenPositions)) {
      return;
    }

    this._tokenPositions = [...positions];
    this.setNeedsRedraw();
  }

  dispose() {
    if (this._isDisposed === false) {
      this._features.dispose();
      this._featureMaterial.dispose();
      this._featureRenderTargets.forEach((t) => t.dispose());

      this._tokenComposeTargets.forEach((t) => t.dispose());
      this._composeGeometry.dispose();
      this._composeRenderTarget.dispose();

      // Dispose pooled materials
      this._composeMaterials.forEach((m) => m.dispose());
      this._tokenComposeMaterials.forEach((m) => m.dispose());

      this._isDisposed = true;
    }
  }
}
