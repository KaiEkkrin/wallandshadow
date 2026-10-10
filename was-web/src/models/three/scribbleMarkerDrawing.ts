import * as THREE from 'three';
import { placeMarker, ScribbleMarkerTracker } from '../scribbleMarkers';
import {
  ScribbleMarker,
  SCRIBBLE_FILL_HALF_WIDTH_PX,
  SCRIBBLE_OUTLINE_HALF_WIDTH_PX,
  SCRIBBLE_MARKER_ARROW_HALF_WIDTH_PX,
  SCRIBBLE_MARKER_ARROW_LENGTH_PX,
  SCRIBBLE_MARKER_MAX,
  SCRIBBLE_MARKER_PULSE_DIM,
  SCRIBBLE_MARKER_PULSE_GROW,
  SCRIBBLE_MARKER_PULSE_MS,
  SCRIBBLE_MARKER_RING_RADIUS_PX,
} from '../scribbleTypes';

const MODE_RING = 0;
const MODE_ARROW = 1;

const markerVertexShader = `
  attribute vec2 aAnchor;    // CSS px from the screen centre, y up: ring centre or arrow tip
  attribute vec2 aDir;       // arrow direction (unit); unused for rings
  attribute float aMode;     // 0 ring, 1 arrow
  attribute vec3 aFill;
  attribute vec3 aOutline;
  attribute float aScale;    // the author's widthScale
  attribute float aAlpha;

  uniform vec2 uViewport;    // CSS pixels
  uniform float uPulse;      // 0..1, shared by every marker
  uniform float uGrow;
  uniform float uDim;
  uniform float uRingRadius;
  uniform float uArrowLength;
  uniform float uArrowHalfWidth;
  uniform float uFillHalf;
  uniform float uOutlineHalf;

  varying vec2 vLocal;       // px in the shape's own frame
  varying vec3 vShape;       // ring: (radius, fill half, outline half); arrow: (length, half-width, border)
  varying float vMode;
  varying vec3 vFill;
  varying vec3 vOutline;
  varying float vAlpha;

  void main() {
    float grow = 1.0 + uGrow * uPulse;
    vec2 px;
    if (aMode < 0.5) {
      float r = uRingRadius * grow;
      float extent = r + uOutlineHalf * aScale + 1.0;
      vLocal = position.xy * extent;
      px = aAnchor + vLocal;
      vShape = vec3(r, uFillHalf * aScale, uOutlineHalf * aScale);
    } else {
      // Tip at the origin pointing along +x, so growing about it keeps the tip on the edge.
      float len = uArrowLength * aScale * grow;
      float hw = uArrowHalfWidth * aScale * grow;
      vLocal = vec2(mix(-len - 1.0, 1.0, position.x * 0.5 + 0.5), position.y * (hw + 1.0));
      vec2 perp = vec2(-aDir.y, aDir.x);
      px = aAnchor + aDir * vLocal.x + perp * vLocal.y;
      vShape = vec3(len, hw, (uOutlineHalf - uFillHalf) * aScale);
    }
    gl_Position = vec4(px / (0.5 * uViewport), 0.0, 1.0);
    vMode = aMode;
    vFill = aFill;
    vOutline = aOutline;
    vAlpha = aAlpha * (1.0 - uDim * uPulse);
  }
`;

const markerFragmentShader = `
  precision mediump float;
  varying vec2 vLocal;
  varying vec3 vShape;
  varying float vMode;
  varying vec3 vFill;
  varying vec3 vOutline;
  varying float vAlpha;

  void main() {
    vec3 colour;
    if (vMode < 0.5) {
      // A hollow ring with the same fill-over-outline band as a stroke.
      float d = abs(length(vLocal) - vShape.x);
      if (d > vShape.z) discard;
      colour = d <= vShape.y ? vFill : vOutline;
    } else {
      // Triangle with its tip at the origin and its base at x = -length.
      // The maximum of the edge half-plane distances is exact inside a convex shape.
      vec2 n = normalize(vec2(vShape.y, vShape.x));
      float s = max(-vShape.x - vLocal.x, max(dot(vLocal, n), dot(vLocal, vec2(n.x, -n.y))));
      if (s > 0.0) discard;
      // The outline border sits inside the triangle, so the tip is not clipped at the edge.
      colour = s > -vShape.z ? vOutline : vFill;
    }
    gl_FragColor = vec4(colour, vAlpha);
  }
`;

// Draws the remote scribblers' hot-point markers: a pulsing ring over each one
// on screen, or a pulsing arrow at the screen edge pointing at it. Markers are
// projected and laid out on the CPU each frame (there are only a handful); the
// shader only draws the shape at the screen position it is given.
export class ScribbleMarkerDrawing {
  private readonly _tracker = new ScribbleMarkerTracker();
  private readonly _viewport = new THREE.Vector2(1, 1);
  private _topInset = 0;
  private readonly _scratch = new THREE.Vector3();

  private readonly _aAnchor = new Float32Array(SCRIBBLE_MARKER_MAX * 2);
  private readonly _aDir = new Float32Array(SCRIBBLE_MARKER_MAX * 2);
  private readonly _aMode = new Float32Array(SCRIBBLE_MARKER_MAX);
  private readonly _aFill = new Float32Array(SCRIBBLE_MARKER_MAX * 3);
  private readonly _aOutline = new Float32Array(SCRIBBLE_MARKER_MAX * 3);
  private readonly _aScale = new Float32Array(SCRIBBLE_MARKER_MAX);
  private readonly _aAlpha = new Float32Array(SCRIBBLE_MARKER_MAX);
  private readonly _attributes: THREE.InstancedBufferAttribute[];

  private readonly _geometry: THREE.InstancedBufferGeometry;
  private readonly _material: THREE.ShaderMaterial;
  private readonly _scene: THREE.Scene;

  get geometry() { return this._geometry; }
  get hasContent() { return this._tracker.hasContent; }

  constructor() {
    this._geometry = new THREE.InstancedBufferGeometry();
    this._geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      -1, -1, 0,
      1, -1, 0,
      1, 1, 0,
      -1, 1, 0,
    ]), 3));
    this._geometry.setIndex([0, 1, 2, 0, 2, 3]);

    const named: [string, Float32Array, number][] = [
      ['aAnchor', this._aAnchor, 2],
      ['aDir', this._aDir, 2],
      ['aMode', this._aMode, 1],
      ['aFill', this._aFill, 3],
      ['aOutline', this._aOutline, 3],
      ['aScale', this._aScale, 1],
      ['aAlpha', this._aAlpha, 1],
    ];
    this._attributes = named.map(([name, array, size]) => {
      const a = new THREE.InstancedBufferAttribute(array, size);
      a.setUsage(THREE.DynamicDrawUsage);
      this._geometry.setAttribute(name, a);
      return a;
    });
    this._geometry.instanceCount = 0;

    this._material = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
      vertexShader: markerVertexShader,
      fragmentShader: markerFragmentShader,
      uniforms: {
        uViewport: { value: this._viewport },
        uPulse: { value: 0 },
        uGrow: { value: SCRIBBLE_MARKER_PULSE_GROW },
        uDim: { value: SCRIBBLE_MARKER_PULSE_DIM },
        uRingRadius: { value: SCRIBBLE_MARKER_RING_RADIUS_PX },
        uArrowLength: { value: SCRIBBLE_MARKER_ARROW_LENGTH_PX },
        uArrowHalfWidth: { value: SCRIBBLE_MARKER_ARROW_HALF_WIDTH_PX },
        uFillHalf: { value: SCRIBBLE_FILL_HALF_WIDTH_PX },
        uOutlineHalf: { value: SCRIBBLE_OUTLINE_HALF_WIDTH_PX },
      },
    });

    const mesh = new THREE.Mesh(this._geometry, this._material);
    mesh.frustumCulled = false;
    this._scene = new THREE.Scene();
    this._scene.add(mesh);
  }

  setMarkers(markers: ScribbleMarker[], now: number) {
    this._tracker.setMarkers(markers, now);
  }

  setViewport(width: number, height: number) {
    this._viewport.set(Math.max(1, width), Math.max(1, height));
  }

  // How far the navbar covers the top of the screen, in CSS pixels. Arrows sit
  // below it, and a hot point hidden under it counts as off screen.
  setTopInset(px: number) {
    this._topInset = Math.max(0, px);
  }

  // Advances the markers to `now` and lays them out against the camera's
  // current view of the map.
  update(now: number, camera: THREE.Camera) {
    const frames = this._tracker.update(now);
    const halfW = this._viewport.x / 2;
    const halfH = this._viewport.y / 2;
    // The screen centre must stay inside the bounds, however tall the navbar.
    const bounds = { left: -halfW, right: halfW, bottom: -halfH, top: Math.max(1, halfH - this._topInset) };
    const count = Math.min(frames.length, SCRIBBLE_MARKER_MAX);
    for (let i = 0; i < count; ++i) {
      const { point, style, alpha } = frames[i];
      const ndc = this._scratch.set(point.x, point.y, 0).project(camera);
      const placement = placeMarker({ x: ndc.x * halfW, y: ndc.y * halfH }, bounds);
      const anchor = placement.kind === 'ring' ? placement.centre : placement.tip;
      const dir = placement.kind === 'ring' ? { x: 1, y: 0 } : placement.dir;
      this._aAnchor[i * 2] = anchor.x;
      this._aAnchor[i * 2 + 1] = anchor.y;
      this._aDir[i * 2] = dir.x;
      this._aDir[i * 2 + 1] = dir.y;
      this._aMode[i] = placement.kind === 'ring' ? MODE_RING : MODE_ARROW;
      this._aFill.set([style.fill.r, style.fill.g, style.fill.b], i * 3);
      this._aOutline.set([style.outline.r, style.outline.g, style.outline.b], i * 3);
      this._aScale[i] = style.widthScale;
      this._aAlpha[i] = alpha;
    }
    if (count > 0) {
      for (const a of this._attributes) {
        a.needsUpdate = true;
      }
    }
    this._geometry.instanceCount = count;
    this._material.uniforms.uPulse.value = 0.5 - 0.5 * Math.cos(2 * Math.PI * now / SCRIBBLE_MARKER_PULSE_MS);
  }

  // The shader maps pixels straight to clip space, so the camera is unused;
  // the renderer just needs one.
  render(renderer: THREE.WebGLRenderer, camera: THREE.Camera) {
    if (this._geometry.instanceCount > 0) {
      renderer.render(this._scene, camera);
    }
  }

  dispose() {
    this._geometry.dispose();
    this._material.dispose();
  }
}
