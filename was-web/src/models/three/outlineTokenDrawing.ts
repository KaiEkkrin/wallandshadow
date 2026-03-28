import { coordString, edgeString, GridCoord, GridEdge, GridVertex, vertexString } from "../../data/coord";
import { IFeature, IToken } from "../../data/feature";
import { BaseTokenDrawing, ITokenFace, ITokenFillEdge, ITokenFillVertex } from "../../data/tokens";
import { IGridGeometry } from "../gridGeometry";
import { IInstancedFeatureObject } from "./instancedFeatureObject";
import { InstancedFeatures } from "./instancedFeatures";
import { RedrawFlag } from "../redrawFlag";
import { IShader, ShaderFilter } from "./shaderFilter";
import { TokenTexts } from "./tokenTexts";

import fluent from "fluent-iterable";
import * as THREE from 'three';
import { BaseTokenDrawingWithText } from "../../data/tokenTexts";

// #118: This module provides functionality for drawing outline tokens.
// To do this, we paint the token areas into their own token texture, and then
// use edge detection (with the selection taking priority over the regular tokens)
// to draw onto the canvas.

// This is a simple extension of the instanced features with a callback when its empty/not-empty
// state changes so that I can draw or not draw it as required.
class OutlineFeatures<K extends GridCoord, F extends IFeature<K>> extends InstancedFeatures<K, F> {
  private readonly _onFirstAdd: () => void;
  private readonly _onLastRemove: () => void;

  constructor(
    geometry: IGridGeometry,
    redrawFlag: RedrawFlag,
    toIndex: (k: K) => string,
    createFeatureObject: (maxInstances: number) => IInstancedFeatureObject<K, F>,
    onFirstAdd: () => void,
    onLastRemove: () => void,
    maxInstances?: number | undefined
  ) {
    super(geometry, redrawFlag, toIndex, createFeatureObject, maxInstances);
    this._onFirstAdd = onFirstAdd;
    this._onLastRemove = onLastRemove;
  }

  add(f: F) {
    const wasEmpty = fluent(this.iterate()).any() === false;
    if (super.add(f) === false) {
      return false;
    }

    if (wasEmpty) {
      this._onFirstAdd();
    }

    return true;
  }

  clear() {
    const wasFull = fluent(this.iterate()).any();
    super.clear();
    if (wasFull) {
      this._onLastRemove();
    }
  }

  remove(oldPosition: K) {
    const removed = super.remove(oldPosition);
    if (removed === undefined) {
      return undefined;
    }

    if (fluent(this.iterate()).any() === false) {
      this._onLastRemove();
    }

    return removed;
  }
}

// This filter does the edge detection and draws the outlines to the canvas.
// We pass through the solid-black colour directly -- this is the colour of token text;
// we want to make sure the exact font render appears in black so that the text is readable.
// It will be outlined by the token colour, because the text is drawn on top of the (filled) token in
// the outline texture -- this should make it readable against other backgrounds.
// TODO #118 Here is the place to put a thing that makes the lines dashed, if I decide I want
// to have that :)
const outlineFilterShader: IShader = {
  uniforms: {
    "step": { value: null },
    "tex": { value: null }
  },
  vertexShader: `
    uniform vec2 step;
    varying vec2 texUv;
    void main() {
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      texUv = position.xy * 0.5 + 0.5 + 0.25 * step;
    }
  `,
  fragmentShader: `
    uniform vec2 step;
    uniform sampler2D tex;
    varying vec2 texUv;

    vec4 contribute(const in vec2 pos, inout vec4 minTally, inout vec4 maxTally) {
      vec4 texSample = texture2D(tex, pos);
      minTally = min(minTally, texSample);
      maxTally = max(maxTally, texSample);
      return texSample;
    }

    void main() {
      vec4 minTally = vec4(1.0, 1.0, 1.0, 1.0);
      vec4 maxTally = vec4(0.0, 0.0, 0.0, 0.0);

      contribute(texUv + vec2(-step.x, 0), minTally, maxTally);
      contribute(texUv + vec2(0, -step.y), minTally, maxTally);
      vec4 here = contribute(texUv, minTally, maxTally);
      contribute(texUv + vec2(0, step.y), minTally, maxTally);
      contribute(texUv + vec2(step.x, 0), minTally, maxTally);

      if (here == vec4(0.0, 0.0, 0.0, 1.0)) {
        gl_FragColor = here;
      } else if (minTally != maxTally) {
        gl_FragColor = maxTally;
      } else {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
      }
    }
  `
}

export class OutlineFilter extends ShaderFilter {
  private readonly _step = new THREE.Vector2();

  constructor(z: number, blending?: THREE.Blending | undefined) {
    super(z, {
      blending: blending ?? THREE.NormalBlending,
      side: THREE.DoubleSide,
      transparent: true,
      ...outlineFilterShader
    });
    this.uniforms['step'].value = this._step;
  }

  postRender() {
    this.uniforms['tex'].value = null;
  }

  preRender(target: THREE.WebGLRenderTarget) {
    this._step.set(1.0 / target.width, 1.0 / target.height);
    this.uniforms['tex'].value = target.texture;
  }
}

// Helps render into the outline token texture that will be sampled by the filter, above.
// TODO #118 Right now, I'm using four of these -- one for the native tokens and three for
// the selection, which means a lot of over-painting of the canvas with (mostly) transparent
// when I sample it with the outline filter (above).  Can I combine these textures somehow
// and still have the alpha-blending look good?  As it is I might be creating performance
// issues...
export class OutlineTokenTexture {
  private readonly _clearColour = new THREE.Color(0, 0, 0);
  private readonly _outlineScene: THREE.Scene;
  private readonly _outlineTarget: THREE.WebGLRenderTarget;
  private readonly _outlineFilter: OutlineFilter;

  private _doRender = false;

  constructor(
    renderWidth: number, renderHeight: number, scene: THREE.Scene, z: number,
    blending?: THREE.Blending | undefined
  ) {
    this._outlineScene = new THREE.Scene();
    this._outlineTarget = new THREE.WebGLRenderTarget(renderWidth, renderHeight, {
      depthBuffer: false,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping
    });

    // We don't add this to the scene until we have features
    this._outlineFilter = new OutlineFilter(z, blending);
    this._outlineFilter.addToScene(scene);
  }

  get doRender() { return this._doRender; }
  set doRender(value: boolean) { this._doRender = value; }

  get scene() { return this._outlineScene; }

  // Renders the outlines to the texture (if need be.)
  render(camera: THREE.Camera, renderer: THREE.WebGLRenderer) {
    this._outlineFilter.postRender();

    renderer.setRenderTarget(this._outlineTarget);
    renderer.setClearColor(this._clearColour, 0.0);
    renderer.clear();
    if (this.doRender) {
      renderer.render(this._outlineScene, camera);
    }

    renderer.setRenderTarget(null);
    this._outlineFilter.preRender(this._outlineTarget);
  }

  resize(width: number, height: number) {
    this._outlineTarget.setSize(width, height);
  }

  dispose() {
    this._outlineFilter.dispose();
    this._outlineTarget.dispose();
  }
}

// The outline token drawing will manage drawing its features to a texture and then drawing
// that texture into the final scene (only when there are any features to draw.)
export class OutlineTokenDrawing extends BaseTokenDrawingWithText<
  OutlineFeatures<GridCoord, ITokenFace>,
  InstancedFeatures<GridEdge, ITokenFillEdge>,
  InstancedFeatures<GridVertex, ITokenFillVertex>,
  TokenTexts
> {
  private readonly _outlineTexture: OutlineTokenTexture;

  constructor(
    gridGeometry: IGridGeometry,
    needsRedraw: RedrawFlag,
    createAreaObject: (maxInstances: number) => IInstancedFeatureObject<GridCoord, IFeature<GridCoord>>,
    createWallObject: (maxInstances: number) => IInstancedFeatureObject<GridEdge, IFeature<GridEdge>>,
    createVertexObject: (maxInstances: number) => IInstancedFeatureObject<GridVertex, IFeature<GridVertex>>,
    renderWidth: number,
    renderHeight: number,
    scene: THREE.Scene,
    textMaterial: THREE.MeshBasicMaterial,
    z: number,
    maxInstances?: number | undefined,
    blending?: THREE.Blending | undefined
  ) {
    super(
      new OutlineFeatures<GridCoord, ITokenFace>(
        gridGeometry, needsRedraw, coordString, createAreaObject,
        () => this.onFirstAdd(), () => this.onLastRemove(), maxInstances
      ),
      new InstancedFeatures<GridEdge, ITokenFillEdge>(
        gridGeometry, needsRedraw, edgeString, createWallObject, maxInstances
      ),
      new InstancedFeatures<GridVertex, ITokenFillVertex>(
        gridGeometry, needsRedraw, vertexString, createVertexObject, maxInstances
      ),
      new TokenTexts(gridGeometry, needsRedraw, textMaterial, z + 0.01)
    );

    this._outlineTexture = new OutlineTokenTexture(renderWidth, renderHeight, scene, z, blending);
    this.faces.addToScene(this._outlineTexture.scene);
    this.fillEdges.addToScene(this._outlineTexture.scene);
    this.fillVertices.addToScene(this._outlineTexture.scene);
    this.texts.addToScene(this._outlineTexture.scene);
  }

  private onFirstAdd() {
    this._outlineTexture.doRender = true;
  }

  private onLastRemove() {
    this._outlineTexture.doRender = false;
  }

  get doRender() { return this._outlineTexture.doRender; }

  render(camera: THREE.Camera, renderer: THREE.WebGLRenderer) {
    this._outlineTexture.render(camera, renderer);
  }

  resize(width: number, height: number) {
    this._outlineTexture.resize(width, height);
  }

  dispose() {
    super.dispose();
    this.faces.dispose();
    this.fillEdges.dispose();
    this.fillVertices.dispose();
    this.texts.dispose();
    this._outlineTexture.dispose();
  }
}

export class OutlineSelectionTokenDrawing extends BaseTokenDrawing<
  OutlineFeatures<GridCoord, ITokenFace>,
  InstancedFeatures<GridEdge, ITokenFillEdge>,
  InstancedFeatures<GridVertex, ITokenFillVertex>
> {
  private readonly _outlineTexture: OutlineTokenTexture;

  constructor(
    gridGeometry: IGridGeometry,
    needsRedraw: RedrawFlag,
    createAreaObject: (maxInstances: number) => IInstancedFeatureObject<GridCoord, IFeature<GridCoord>>,
    createWallObject: (maxInstances: number) => IInstancedFeatureObject<GridEdge, IFeature<GridEdge>>,
    createVertexObject: (maxInstances: number) => IInstancedFeatureObject<GridVertex, IFeature<GridVertex>>,
    renderWidth: number,
    renderHeight: number,
    scene: THREE.Scene,
    z: number,
    maxInstances?: number | undefined,
    blending?: THREE.Blending | undefined
  ) {
    super(
      new OutlineFeatures<GridCoord, ITokenFace>(
        gridGeometry, needsRedraw, coordString, createAreaObject,
        () => this.onFirstAdd(), () => this.onLastRemove(), maxInstances
      ),
      new InstancedFeatures<GridEdge, ITokenFillEdge>(
        gridGeometry, needsRedraw, edgeString, createWallObject, maxInstances
      ),
      new InstancedFeatures<GridVertex, ITokenFillVertex>(
        gridGeometry, needsRedraw, vertexString, createVertexObject, maxInstances
      )
    );

    this._outlineTexture = new OutlineTokenTexture(renderWidth, renderHeight, scene, z, blending);
    this.faces.addToScene(this._outlineTexture.scene);
    this.fillEdges.addToScene(this._outlineTexture.scene);
    this.fillVertices.addToScene(this._outlineTexture.scene);
  }

  private onFirstAdd() {
    this._outlineTexture.doRender = true;
  }

  private onLastRemove() {
    this._outlineTexture.doRender = false;
  }

  get doRender() { return this._outlineTexture.doRender; }

  // We need to squash the colour for this one; selections have their own meaning of colour
  createFace(token: IToken, position: GridCoord) {
    return { ...token, basePosition: token.position, position: position, colour: 0 };
  }

  createFillEdge(token: IToken, position: GridEdge) {
    return { ...token, basePosition: token.position, position: position, colour: 0 };
  }

  createFillVertex(token: IToken, position: GridVertex) {
    return { ...token, basePosition: token.position, position: position, colour: 0 };
  }

  render(camera: THREE.Camera, renderer: THREE.WebGLRenderer) {
    this._outlineTexture.render(camera, renderer);
  }

  resize(width: number, height: number) {
    this._outlineTexture.resize(width, height);
  }

  dispose() {
    super.dispose();
    this.faces.dispose();
    this.fillEdges.dispose();
    this.fillVertices.dispose();
    this._outlineTexture.dispose();
  }
}