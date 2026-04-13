import { IShader, ShaderFilter } from "./shaderFilter";

import * as THREE from 'three';

// Simplified LoS filter that samples the shadow texture directly at screen position
// and blends between fullyHidden and fullyVisible values.
function createLoSFilterShader() {
  return {
    uniforms: {
      "fullyHidden": { type: 'f', value: null },
      "fullyVisible": { type: 'f', value: null },
      "losTex": { value: null }
    },
    vertexShader: [
      "varying vec2 texUv;",
      "void main() {",
      "  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
      "  texUv = position.xy * 0.5 + 0.5;",
      "}"
    ].join("\n"),
    fragmentShader: [
      "uniform float fullyHidden;",
      "uniform float fullyVisible;",
      "uniform sampler2D losTex;",
      "varying vec2 texUv;",
      "void main() {",
      "  float shadow = texture2D(losTex, texUv).x;",  // 0 = visible, 1 = shadowed
      "  float result = mix(fullyVisible, fullyHidden, shadow);",
      "  gl_FragColor = vec4(result, result, result, 1.0);",
      "}"
    ].join("\n")
  };
}

// Before drawing the scene these have been added to, call preRender() to fill in the uniforms.
export interface ILoSPreRenderParameters {
  fullyHidden: number;
  fullyVisible: number;
  losTarget: THREE.WebGLRenderTarget;
}

export class LoSFilter extends ShaderFilter {
  constructor(z: number, shader: IShader) {
    super(z, {
      blending: THREE.MultiplyBlending,
      // Three.js r178+ requires premultipliedAlpha for MultiplyBlending
      premultipliedAlpha: true,
      side: THREE.DoubleSide,
      transparent: true,
      uniforms: shader.uniforms,
      vertexShader: shader.vertexShader,
      fragmentShader: shader.fragmentShader
    });
  }

  preRender(params: ILoSPreRenderParameters) {
    this.uniforms['fullyHidden'].value = params.fullyHidden;
    this.uniforms['fullyVisible'].value = params.fullyVisible;
    this.uniforms['losTex'].value = params.losTarget.texture;
  }
}

export function createLoSFilter(z: number) {
  const shader = createLoSFilterShader();
  return new LoSFilter(z, shader);
}
