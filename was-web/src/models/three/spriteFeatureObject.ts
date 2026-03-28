import { GridCoord } from '../../data/coord';
import { IFeature, ITokenProperties } from '../../data/feature';
import { fromSpriteGeometryString } from '../../data/sprite';
import { ICacheLease, ISpritesheetEntry } from '../../services/interfaces';

import { InstancedFeatureObject } from './instancedFeatureObject';
import { fromMatrix4Columns, InstanceMatrix3Column } from './instanceMatrix';
import { RedrawFlag } from '../redrawFlag';
import { TextureCache } from './textureCache';

import { Subscription } from 'rxjs';
import * as THREE from 'three';

const spriteShader = {
  uniforms: {
    "spriteTex": { value: null }
  },
  vertexShader: [
    "attribute vec3 instanceUv0;",
    "attribute vec3 instanceUv1;",
    "attribute vec3 instanceUv2;",
    "varying vec2 myUv;", // calculated UV

    "void main() {",
    "  gl_Position = projectionMatrix * viewMatrix * instanceMatrix * vec4(position, 1.0);",
    "  mat3 uvTransform = mat3(instanceUv0, instanceUv1, instanceUv2);",
    "  myUv = (uvTransform * vec3(position.xy, 1.0)).xy;",
    "}"
  ].join("\n"),
  fragmentShader: [
    "uniform sampler2D spriteTex;",
    "varying vec2 myUv;",
    "void main() {",
    "  gl_FragColor = texture2D(spriteTex, myUv);",
    "}"
  ].join("\n")
};

export interface ISpriteProperties {
  basePosition: GridCoord;
  sheetEntry: ISpritesheetEntry;
}

export class SpriteFeatureObject<
  K extends GridCoord,
  F extends (IFeature<K> & ITokenProperties & ISpriteProperties)
> extends InstancedFeatureObject<K, F> {
  private readonly _geometry: THREE.InstancedBufferGeometry;
  private readonly _getUvTransform: (feature: F) => THREE.Matrix4 | undefined;

  private readonly _instanceUvColumns: InstanceMatrix3Column[] = [];

  private readonly _sub: Subscription;
  private readonly _material: THREE.ShaderMaterial;
  private readonly _uniforms: Record<string, THREE.IUniform>;

  private readonly _scratchMatrix1 = new THREE.Matrix4();
  private readonly _scratchMatrix2 = new THREE.Matrix4();

  private _texture: ICacheLease<THREE.Texture> | undefined;

  constructor(
    redrawFlag: RedrawFlag,
    textureCache: TextureCache,
    toIndex: (k: K) => string,
    transformTo: (m: THREE.Matrix4, position: K) => THREE.Matrix4,
    maxInstances: number,
    createGeometry: () => THREE.InstancedBufferGeometry,
    getUvTransform: (feature: F) => THREE.Matrix4 | undefined,
    url: string
  ) {
    super(toIndex, transformTo, maxInstances);
    this._geometry = createGeometry();
    this._getUvTransform = getUvTransform;

    for (let i = 0; i < 3; ++i) {
      const col = new InstanceMatrix3Column(maxInstances);
      this._geometry.setAttribute(`instanceUv${i}`, col.attr);
      this._instanceUvColumns.push(col);
    }

    this._uniforms = THREE.UniformsUtils.clone(spriteShader.uniforms);
    this._material = new THREE.ShaderMaterial({
      blending: THREE.NormalBlending,
      transparent: true,
      uniforms: this._uniforms,
      vertexShader: spriteShader.vertexShader,
      fragmentShader: spriteShader.fragmentShader
    });

    // The texture is loaded lazily.  Flag ourselves for a redraw when it arrives.
    this._sub = textureCache.resolveUrl(url).subscribe(t => {
      if (this._texture !== undefined) {
        this._texture.release().then(() => { /* nothing to do here */ });
      }

      this._texture = t;
      console.debug(`received texture ${this._texture?.value} for url ${url}`);
      this._uniforms['spriteTex'].value = t.value;
      redrawFlag.setNeedsRedraw();
    });
  }

  protected createMesh(maxInstances: number): THREE.InstancedMesh {
    // Disable frustum culling: instances are scattered across the map, so the
    // bounding sphere would encompass the entire visible area anyway. The real
    // optimization is the instanced rendering itself, not culling the mesh.
    const mesh = new THREE.InstancedMesh(this._geometry, this._material, maxInstances);
    mesh.frustumCulled = false;
    return mesh;
  }

  protected addFeature(f: F) {
    const instanceIndex = super.addFeature(f);
    if (instanceIndex === undefined) {
      return undefined;
    }

    const { columns, rows } = fromSpriteGeometryString(f.sheetEntry.sheet.geometry);
    const scaleX = 1.0 / columns;
    const scaleY = 1.0 / rows;

    const x = (f.sheetEntry.position % columns);
    const y = Math.floor(f.sheetEntry.position / columns);

    // console.debug(`adding sprite feature ${this.toIndex(f.position)} from ${coordString(f.basePosition)}`);
    const baseTransform = this._getUvTransform(f);
    if (baseTransform === undefined) {
      return;
    }

    const translation = this._scratchMatrix1.makeTranslation(
      x * scaleX, 1 - (y * scaleY), 0
    );
    const scaling = this._scratchMatrix2.makeScale(scaleX, -scaleY, 1);
    const transform = translation.multiply(scaling).multiply(baseTransform);
    fromMatrix4Columns(this._instanceUvColumns, transform, instanceIndex);

      // const uvScaleX = scaleX * baseTransform.scale;
      // const uvScaleY = -scaleY * baseTransform.scale;
      // const uvTranslateX = x * scaleX + baseTransform.offset.x * scaleX;
      // const uvTranslateY = 1 - (y * scaleY + baseTransform.offset.y * scaleY);

      // baseTransform.testVertices?.forEach((v, i) => {
      //   if (baseTransform.testTransform === undefined || baseTransform.testBuvs === undefined) {
      //     return;
      //   }

      //   const xy = v.clone().applyMatrix4(baseTransform.testTransform);
      //   const uv = v.clone().applyMatrix4(transform);
      //   console.debug(`sprite mat: ${xy.toArray()} -> ${uv.toArray()}`);

      //   const sc = new THREE.Vector2(baseTransform.testBuvs[2 * i], baseTransform.testBuvs[2 * i + 1])
      //     .multiply(new THREE.Vector2(
      //       uvScaleX,
      //       uvScaleY
      //     )).add(new THREE.Vector2(
      //       uvTranslateX,
      //       uvTranslateY
      //     ));
      //   console.debug(`sprite sc : ${xy.toArray()} -> ${sc.toArray()}`);
      // });
    return instanceIndex;
  }

  dispose() {
    super.dispose();
    this._geometry.dispose();
    this._material.dispose();
    this._sub.unsubscribe();
    if (this._texture) {
      this._texture.release().then(() => { /* done :) */ });
    }
  }
}