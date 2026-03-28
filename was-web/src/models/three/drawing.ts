import { DrawingOrtho } from "./drawingOrtho";
import { IGridGeometry } from "../gridGeometry";
import { IDrawing } from "../interfaces";
import { FeatureColour } from "../featureColour";
import { ITokenGeometry } from "../../data/tokenGeometry";
import { ISpriteManager } from "../../services/interfaces";

import * as THREE from 'three';

// Implementation choice and testability adapter -- mock this to replace
// the Three.js drawing implementations.
// Also wraps our WebGL renderer, which needs to be a singleton to avoid
// leaking resources.

let renderer: THREE.WebGLRenderer | undefined = undefined;

function getRenderer() {
  // Create the singleton renderer lazily
  // Three.js r163+ requires WebGL 2.0 (instancing support is implicit)
  if (renderer === undefined) {
    renderer = new THREE.WebGLRenderer({ alpha: true });
    console.info('WebGL renderer initialized (WebGL 2.0 required)');
  }

  return renderer;
}

export function createDrawing(
  gridGeometry: IGridGeometry,
  tokenGeometry: ITokenGeometry,
  colours: FeatureColour[],
  seeEverything: boolean,
  logError: (message: string, e: unknown) => void,
  spriteManager: ISpriteManager,
  resolveImageUrl: (path: string) => Promise<string>
): IDrawing {
  return new DrawingOrtho(
    getRenderer(), gridGeometry, tokenGeometry, colours, seeEverything, logError, spriteManager, resolveImageUrl
  );
}