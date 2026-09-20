import * as THREE from 'three';
import {
  ScribbleSegment,
  SCRIBBLE_FADE_HOLD_MS,
  SCRIBBLE_FADE_MS,
  SCRIBBLE_HALF_WIDTH_PX,
} from '../scribbleTypes';

// Large finite relative time used for still-active strokes, so the shader sees
// a hugely negative age (full alpha) without ever uploading Infinity to the GPU.
const ACTIVE_REL = 1e9;

const scribbleVertexShader = `
  attribute vec2 aStart;
  attribute vec2 aEnd;
  attribute vec3 aColour;
  attribute float aReleaseTime;

  uniform float uNow;          // ms relative to the drawing's t0
  uniform vec2 uViewport;      // CSS pixels (window inner size)
  uniform float uHalfWidthPx;
  uniform float uHoldMs;
  uniform float uFadeMs;
  uniform float uZ;

  varying vec3 vColour;
  varying float vAlpha;

  void main() {
    // Endpoints are world coords; project with the camera (model is identity).
    vec4 clipStart = projectionMatrix * modelViewMatrix * vec4(aStart, uZ, 1.0);
    vec4 clipEnd   = projectionMatrix * modelViewMatrix * vec4(aEnd, uZ, 1.0);

    vec2 ndcStart = clipStart.xy / clipStart.w;
    vec2 ndcEnd   = clipEnd.xy / clipEnd.w;
    vec2 pxStart = ndcStart * 0.5 * uViewport;
    vec2 pxEnd   = ndcEnd * 0.5 * uViewport;

    vec2 delta = pxEnd - pxStart;
    float len = length(delta);
    vec2 unit = len > 0.0001 ? delta / len : vec2(1.0, 0.0);
    vec2 perp = vec2(-unit.y, unit.x);

    // position.x in {0,1} picks start/end; position.y in {-1,+1} picks the side.
    vec2 basePx = mix(pxStart, pxEnd, position.x) + perp * (position.y * uHalfWidthPx);
    vec2 ndc = basePx / (0.5 * uViewport);
    // Screen-space overlay: fixed depth, drawn last with depthTest off.
    gl_Position = vec4(ndc, 0.0, 1.0);

    vColour = aColour;

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
  void main() {
    if (vAlpha <= 0.0) discard;
    gl_FragColor = vec4(vColour, vAlpha);
  }
`;

// A single instanced draw call rendering every live scribble segment as a
// constant-pixel-width quad that fades per stroke. Endpoints are world coords
// so strokes track pan/zoom; the width is expanded in screen space.
export class ScribbleDrawing {
  private readonly _maxSegments: number;
  private readonly _t0 = Date.now();

  private readonly _aStart: Float32Array;
  private readonly _aEnd: Float32Array;
  private readonly _aColour: Float32Array;
  private readonly _aReleaseTime: Float32Array;

  private readonly _aStartAttr: THREE.InstancedBufferAttribute;
  private readonly _aEndAttr: THREE.InstancedBufferAttribute;
  private readonly _aColourAttr: THREE.InstancedBufferAttribute;
  private readonly _aReleaseAttr: THREE.InstancedBufferAttribute;

  private readonly _geometry: THREE.InstancedBufferGeometry;
  private readonly _material: THREE.ShaderMaterial;
  private readonly _mesh: THREE.Mesh;
  private readonly _scene: THREE.Scene;

  private _count = 0;

  get geometry() { return this._geometry; }
  get segmentCount() { return this._count; }
  get hasContent() { return this._count > 0; }

  constructor(maxSegments: number, z: number) {
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

    this._aStart = new Float32Array(maxSegments * 2);
    this._aEnd = new Float32Array(maxSegments * 2);
    this._aColour = new Float32Array(maxSegments * 3);
    this._aReleaseTime = new Float32Array(maxSegments);

    this._aStartAttr = new THREE.InstancedBufferAttribute(this._aStart, 2);
    this._aEndAttr = new THREE.InstancedBufferAttribute(this._aEnd, 2);
    this._aColourAttr = new THREE.InstancedBufferAttribute(this._aColour, 3);
    this._aReleaseAttr = new THREE.InstancedBufferAttribute(this._aReleaseTime, 1);
    for (const a of [this._aStartAttr, this._aEndAttr, this._aColourAttr, this._aReleaseAttr]) {
      a.setUsage(THREE.DynamicDrawUsage);
    }
    this._geometry.setAttribute('aStart', this._aStartAttr);
    this._geometry.setAttribute('aEnd', this._aEndAttr);
    this._geometry.setAttribute('aColour', this._aColourAttr);
    this._geometry.setAttribute('aReleaseTime', this._aReleaseAttr);
    this._geometry.instanceCount = 0;

    this._material = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
      vertexShader: scribbleVertexShader,
      fragmentShader: scribbleFragmentShader,
      uniforms: {
        uNow: { value: 0 },
        uViewport: { value: new THREE.Vector2(1, 1) },
        uHalfWidthPx: { value: SCRIBBLE_HALF_WIDTH_PX },
        uHoldMs: { value: SCRIBBLE_FADE_HOLD_MS },
        uFadeMs: { value: SCRIBBLE_FADE_MS },
        uZ: { value: z },
      },
    });

    this._mesh = new THREE.Mesh(this._geometry, this._material);
    this._mesh.frustumCulled = false;

    this._scene = new THREE.Scene();
    this._scene.add(this._mesh);
  }

  setSegments(segments: ScribbleSegment[]) {
    const n = Math.min(segments.length, this._maxSegments);
    for (let i = 0; i < n; ++i) {
      const s = segments[i];
      this._aStart[i * 2] = s.startX;
      this._aStart[i * 2 + 1] = s.startY;
      this._aEnd[i * 2] = s.endX;
      this._aEnd[i * 2 + 1] = s.endY;
      this._aColour[i * 3] = s.colour.r;
      this._aColour[i * 3 + 1] = s.colour.g;
      this._aColour[i * 3 + 2] = s.colour.b;
      this._aReleaseTime[i] = Number.isFinite(s.releaseTime)
        ? s.releaseTime - this._t0
        : ACTIVE_REL;
    }
    if (n > 0) {
      this._aStartAttr.needsUpdate = true;
      this._aEndAttr.needsUpdate = true;
      this._aColourAttr.needsUpdate = true;
      this._aReleaseAttr.needsUpdate = true;
    }
    this._geometry.instanceCount = n;
    this._count = n;
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
    renderer.render(this._scene, camera);
  }

  dispose() {
    this._geometry.dispose();
    this._material.dispose();
  }
}
