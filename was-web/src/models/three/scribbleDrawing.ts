import * as THREE from 'three';
import {
  Rgb,
  ScribbleStroke,
  SCRIBBLE_FADE_HOLD_MS,
  SCRIBBLE_FADE_MS,
  SCRIBBLE_FILL_HALF_WIDTH_PX,
  SCRIBBLE_OUTLINE_HALF_WIDTH_PX,
} from '../scribbleTypes';

// Large finite relative time used for still-active strokes, so the shader sees
// a hugely negative age (full alpha) without ever uploading Infinity to the GPU.
const ACTIVE_REL = 1e9;

const scribbleVertexShader = `
  attribute vec2 aStart;
  attribute vec2 aEnd;
  attribute vec3 aColour;
  attribute float aHalfWidth;  // CSS pixels
  attribute float aDepth;      // NDC depth, shared by both passes of a stroke
  attribute float aReleaseTime;

  uniform float uNow;          // ms relative to the drawing's t0
  uniform vec2 uViewport;      // CSS pixels (window inner size)
  uniform float uHoldMs;
  uniform float uFadeMs;

  varying vec3 vColour;
  varying float vAlpha;
  varying vec2 vLocal;         // px: x along the segment from its start, y across it
  varying float vLen;
  varying float vHalfWidth;

  void main() {
    // Endpoints are world coords; project with the camera (model is identity).
    vec4 clipStart = projectionMatrix * modelViewMatrix * vec4(aStart, 0.0, 1.0);
    vec4 clipEnd   = projectionMatrix * modelViewMatrix * vec4(aEnd, 0.0, 1.0);

    vec2 ndcStart = clipStart.xy / clipStart.w;
    vec2 ndcEnd   = clipEnd.xy / clipEnd.w;
    vec2 pxStart = ndcStart * 0.5 * uViewport;
    vec2 pxEnd   = ndcEnd * 0.5 * uViewport;

    vec2 delta = pxEnd - pxStart;
    float len = length(delta);
    vec2 unit = len > 0.0001 ? delta / len : vec2(1.0, 0.0);
    vec2 perp = vec2(-unit.y, unit.x);

    // position.x in {0,1} picks start/end; position.y in {-1,+1} picks the side.
    // Extend by the half-width past each end so the round caps fit.
    float along = mix(-aHalfWidth, len + aHalfWidth, position.x);
    float across = position.y * aHalfWidth;
    vec2 basePx = pxStart + unit * along + perp * across;
    gl_Position = vec4(basePx / (0.5 * uViewport), aDepth, 1.0);

    vColour = aColour;
    vLocal = vec2(along, across);
    vLen = len;
    vHalfWidth = aHalfWidth;

    float age = uNow - aReleaseTime; // negative while active or pre-hold
    float a = 1.0;
    if (age > uHoldMs) {
      a = 1.0 - clamp((age - uHoldMs) / uFadeMs, 0.0, 1.0);
    }
    vAlpha = a;
  }
`;

const scribbleFragmentShader = `
  precision mediump float;
  varying vec3 vColour;
  varying float vAlpha;
  varying vec2 vLocal;
  varying float vLen;
  varying float vHalfWidth;
  void main() {
    // Discard (rather than output alpha 0) so these fragments never write depth.
    if (vAlpha <= 0.0) discard;
    // Capsule: keep fragments within the half-width of the segment, which
    // rounds the ends so consecutive segments join without notches.
    float t = clamp(vLocal.x, 0.0, vLen);
    if (length(vec2(vLocal.x - t, vLocal.y)) > vHalfWidth) discard;
    gl_FragColor = vec4(vColour, vAlpha);
  }
`;

// A single instanced draw call rendering every live scribble stroke as
// constant-pixel-width capsules that fade per stroke. Endpoints are world
// coords so strokes track pan/zoom; the width is expanded in screen space.
//
// Each stroke is drawn as a fill over a wider outline, and must cover each
// pixel at most once or translucent strokes would show their outline through
// their fill, and darken where they cross themselves. The depth buffer
// enforces that: every stroke gets its own depth (newer strokes nearer), its
// fill instances come before its outline instances, and the depth test is
// LESS -- so the outline only lands outside the fill, a stroke never redraws
// its own pixels, and a newer stroke still draws over an older one.
export class ScribbleDrawing {
  private readonly _maxSegments: number;
  private readonly _t0 = Date.now();

  private readonly _aStart: Float32Array;
  private readonly _aEnd: Float32Array;
  private readonly _aColour: Float32Array;
  private readonly _aHalfWidth: Float32Array;
  private readonly _aDepth: Float32Array;
  private readonly _aReleaseTime: Float32Array;

  private readonly _aStartAttr: THREE.InstancedBufferAttribute;
  private readonly _aEndAttr: THREE.InstancedBufferAttribute;
  private readonly _aColourAttr: THREE.InstancedBufferAttribute;
  private readonly _aHalfWidthAttr: THREE.InstancedBufferAttribute;
  private readonly _aDepthAttr: THREE.InstancedBufferAttribute;
  private readonly _aReleaseAttr: THREE.InstancedBufferAttribute;

  private readonly _geometry: THREE.InstancedBufferGeometry;
  private readonly _material: THREE.ShaderMaterial;
  private readonly _mesh: THREE.Mesh;
  private readonly _scene: THREE.Scene;

  // Polyline segments drawn; each is two instances (fill and outline).
  private _count = 0;

  get geometry() { return this._geometry; }
  get segmentCount() { return this._count; }
  get hasContent() { return this._count > 0; }

  constructor(maxSegments: number) {
    this._maxSegments = maxSegments;

    this._geometry = new THREE.InstancedBufferGeometry();
    const positions = new Float32Array([
      0, -1, 0,
      1, -1, 0,
      1,  1, 0,
      0,  1, 0,
    ]);
    this._geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this._geometry.setIndex([0, 1, 2, 0, 2, 3]);

    const maxInstances = maxSegments * 2;
    this._aStart = new Float32Array(maxInstances * 2);
    this._aEnd = new Float32Array(maxInstances * 2);
    this._aColour = new Float32Array(maxInstances * 3);
    this._aHalfWidth = new Float32Array(maxInstances);
    this._aDepth = new Float32Array(maxInstances);
    this._aReleaseTime = new Float32Array(maxInstances);

    this._aStartAttr = new THREE.InstancedBufferAttribute(this._aStart, 2);
    this._aEndAttr = new THREE.InstancedBufferAttribute(this._aEnd, 2);
    this._aColourAttr = new THREE.InstancedBufferAttribute(this._aColour, 3);
    this._aHalfWidthAttr = new THREE.InstancedBufferAttribute(this._aHalfWidth, 1);
    this._aDepthAttr = new THREE.InstancedBufferAttribute(this._aDepth, 1);
    this._aReleaseAttr = new THREE.InstancedBufferAttribute(this._aReleaseTime, 1);
    for (const a of this.attributes()) {
      a.setUsage(THREE.DynamicDrawUsage);
    }
    this._geometry.setAttribute('aStart', this._aStartAttr);
    this._geometry.setAttribute('aEnd', this._aEndAttr);
    this._geometry.setAttribute('aColour', this._aColourAttr);
    this._geometry.setAttribute('aHalfWidth', this._aHalfWidthAttr);
    this._geometry.setAttribute('aDepth', this._aDepthAttr);
    this._geometry.setAttribute('aReleaseTime', this._aReleaseAttr);
    this._geometry.instanceCount = 0;

    this._material = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: true,
      depthWrite: true,
      depthFunc: THREE.LessDepth,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
      vertexShader: scribbleVertexShader,
      fragmentShader: scribbleFragmentShader,
      uniforms: {
        uNow: { value: 0 },
        uViewport: { value: new THREE.Vector2(1, 1) },
        uHoldMs: { value: SCRIBBLE_FADE_HOLD_MS },
        uFadeMs: { value: SCRIBBLE_FADE_MS },
      },
    });

    this._mesh = new THREE.Mesh(this._geometry, this._material);
    this._mesh.frustumCulled = false;

    this._scene = new THREE.Scene();
    this._scene.add(this._mesh);
  }

  // Draws the given strokes, oldest first (later strokes draw on top).
  // Clamps to the segment budget; a truncated stroke loses its tail.
  setStrokes(strokes: ScribbleStroke[]) {
    let instance = 0;
    let segments = 0;
    const drawn = strokes.filter(s => s.points.length >= 2);
    for (let k = 0; k < drawn.length && segments < this._maxSegments; ++k) {
      const stroke = drawn[k];
      const n = Math.min(stroke.points.length - 1, this._maxSegments - segments);
      // Newer strokes nearer, strictly inside the (-1, 1) clip range.
      const depth = 0.9 - 1.8 * (k + 1) / (drawn.length + 1);
      const release = Number.isFinite(stroke.releaseTime)
        ? stroke.releaseTime - this._t0
        : ACTIVE_REL;
      const { fill, outline, widthScale } = stroke.style;
      // Fill first, then outline: see the class comment.
      for (const [colour, halfWidth] of [
        [fill, SCRIBBLE_FILL_HALF_WIDTH_PX * widthScale],
        [outline, SCRIBBLE_OUTLINE_HALF_WIDTH_PX * widthScale],
      ] as const) {
        for (let i = 0; i < n; ++i) {
          this.writeInstance(instance++, stroke.points[i], stroke.points[i + 1], colour, halfWidth, depth, release);
        }
      }
      segments += n;
    }
    if (instance > 0) {
      for (const a of this.attributes()) {
        a.needsUpdate = true;
      }
    }
    this._geometry.instanceCount = instance;
    this._count = segments;
  }

  setViewport(width: number, height: number) {
    (this._material.uniforms.uViewport.value as THREE.Vector2).set(
      Math.max(1, width), Math.max(1, height)
    );
  }

  updateNow(nowMs: number) {
    this._material.uniforms.uNow.value = nowMs - this._t0;
  }

  render(renderer: THREE.WebGLRenderer, camera: THREE.Camera) {
    // Scribbles render last and own the depth buffer for their pass.
    renderer.clearDepth();
    renderer.render(this._scene, camera);
  }

  private attributes() {
    return [
      this._aStartAttr, this._aEndAttr, this._aColourAttr,
      this._aHalfWidthAttr, this._aDepthAttr, this._aReleaseAttr,
    ];
  }

  private writeInstance(
    i: number, start: { x: number; y: number }, end: { x: number; y: number },
    colour: Rgb, halfWidth: number, depth: number, release: number
  ) {
    this._aStart[i * 2] = start.x;
    this._aStart[i * 2 + 1] = start.y;
    this._aEnd[i * 2] = end.x;
    this._aEnd[i * 2 + 1] = end.y;
    this._aColour[i * 3] = colour.r;
    this._aColour[i * 3 + 1] = colour.g;
    this._aColour[i * 3 + 2] = colour.b;
    this._aHalfWidth[i] = halfWidth;
    this._aDepth[i] = depth;
    this._aReleaseTime[i] = release;
  }

  dispose() {
    this._geometry.dispose();
    this._material.dispose();
  }
}
