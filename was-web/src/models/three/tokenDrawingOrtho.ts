import { coordString, edgeString, GridCoord, GridEdge, GridVertex, vertexString } from "../../data/coord";
import { IFeature, IToken, ITokenProperties } from "../../data/feature";
import { BaseTokenDrawing, ITokenFace, ITokenFillEdge, ITokenFillVertex } from "../../data/tokens";
import { BaseTokenDrawingWithText } from "../../data/tokenTexts";
import { ICacheLease } from "../../services/interfaces";

import { IGridGeometry } from "../gridGeometry";
import { RedrawFlag } from "../redrawFlag";

import { createPaletteColouredAreaObject, createSelectedAreas, createSpriteAreaObject } from "./areas";
import { IInstancedFeatureObject } from "./instancedFeatureObject";
import { InstancedFeatures } from "./instancedFeatures";
import { IColourParameters } from "./paletteColouredFeatureObject";
import { ISpriteProperties } from "./spriteFeatureObject";
import { TextureCache } from "./textureCache";
import { TokenTexts } from "./tokenTexts";
import { ITokenUvTransform } from "./uv";
import { createPaletteColouredVertexObject, createSpriteVertexObject, createTokenFillVertexGeometry } from "./vertices";
import { createPaletteColouredWallObject, createSpriteEdgeObject, createTokenFillEdgeGeometry } from "./walls";

import fluent from "fluent-iterable";
import { Subscription } from 'rxjs';
import * as THREE from 'three';

export interface ITokenDrawingParameters {
  alpha: number;
  spriteAlpha: number;
  z: number;
  spriteZ: number;
  textZ: number;
}

interface ITokenSpriteProperties extends ITokenProperties, ISpriteProperties {
  texture: ICacheLease<THREE.Texture>;
}

// This middle dictionary helps us create the palette-coloured token features immediately,
// and the sprite ones (if applicable) once we get a download URL.  So that we can cancel
// resolving the sprite, we include a subscription in the base dictionary.
class TokenFeatures<K extends GridCoord, F extends (IFeature<K> & ITokenProperties & { basePosition: GridCoord })>
  extends InstancedFeatures<K, F & { sub?: Subscription | undefined }>
{
  private readonly _spriteFeatures: InstancedFeatures<K, F & ITokenSpriteProperties>;
  private _textureCache: TextureCache;

  constructor(
    gridGeometry: IGridGeometry,
    needsRedraw: RedrawFlag,
    toIndex: (k: K) => string,
    createPaletteColouredObject: (maxInstances: number) => IInstancedFeatureObject<K, F>,
    createSpriteObject: (maxInstances: number) => IInstancedFeatureObject<K, F>,
    textureCache: TextureCache
  ) {
    super(gridGeometry, needsRedraw, toIndex, createPaletteColouredObject);
    this._textureCache = textureCache;
    this._spriteFeatures = new InstancedFeatures<K, F & ITokenSpriteProperties>(
      gridGeometry, needsRedraw, toIndex, createSpriteObject
    );
  }

  addToScene(scene: THREE.Scene) {
    if (super.addToScene(scene) === false) {
      return false;
    }

    this._spriteFeatures.addToScene(scene);
    return true;
  }

  removeFromScene() {
    super.removeFromScene();
    this._spriteFeatures.removeFromScene();
  }

  add(f: F) {
    if (f.characterId.length === 0 && f.sprites.length === 0) {
      // There's clearly no sprite to add for this one, just add the palette feature
      return super.add(f);
    }

    // Lookup the sprite, adding the sprite feature when we've got it:
    const sub = this._textureCache.resolve(f).subscribe(e => {
      const removed = this._spriteFeatures.remove(f.position); // just in case
      if (removed !== undefined) {
        removed.texture.release().then(() => { /* nothing to do here */ });
      }

      if (this._spriteFeatures.add({ ...f, sheetEntry: e, texture: e.texture }) === false) {
        console.warn(`failed to add sprite feature with texture ${e.url}`);
      }
    });

    // Add the palette feature now:
    const added = super.add({ ...f, sub: sub });
    if (added === false) {
      // If we're not going to add the palette feature, we need to cancel the
      // sprite feature too :)
      sub.unsubscribe();
      const removed = this._spriteFeatures.remove(f.position);
      if (removed !== undefined) {
        removed.texture.release().then(() => { /* done */ });
      }

      return false;
    }

    return true;
  }

  clear() {
    // Unsubscribe first so no more pending sprite features will go in
    this.forEach(f => f.sub?.unsubscribe());
    super.clear();

    // Remember to release all the sprite resources before emptying the dictionary!
    const toRelease = [...fluent(this._spriteFeatures)];
    Promise.all(toRelease.map(f => f.texture.release()))
      .then(done => console.debug(`${done.length} sprite features released`));
    this._spriteFeatures.clear();
  }

  remove(oldPosition: K) {
    const removed = super.remove(oldPosition);
    if (removed === undefined) {
      return undefined;
    }

    removed.sub?.unsubscribe();
    const removedSprite = this._spriteFeatures.remove(oldPosition);
    if (removedSprite !== undefined) {
      removedSprite.texture.release().then(() => { /* done */ });
    }

    return removed;
  }

  setTextureCache(textureCache: TextureCache) {
    // Changing the texture cache invalidates what we currently have,
    // so we do a clear first
    this.clear();
    this._textureCache = textureCache;
  }

  dispose() {
    this.clear(); // to ensure sprite resources are released
    super.dispose();
    this._spriteFeatures.dispose();
  }
}

// A handy wrapper for the various thingies that go into token drawing.
// Includes managing a texture that we render the token texts into, to allow us
// to use the text filter to apply it to the screen.
export class TokenDrawing extends BaseTokenDrawingWithText<
  TokenFeatures<GridCoord, ITokenFace>,
  TokenFeatures<GridEdge, ITokenFillEdge>,
  TokenFeatures<GridVertex, ITokenFillVertex>,
  TokenTexts
> {
  private readonly _textScene: THREE.Scene;
  private readonly _textTarget: THREE.WebGLRenderTarget;

  constructor(
    gridGeometry: IGridGeometry,
    textureCache: TextureCache,
    uvTransform: ITokenUvTransform,
    needsRedraw: RedrawFlag,
    textMaterial: THREE.MeshBasicMaterial,
    drawingParameters: ITokenDrawingParameters,
    colourParameters: IColourParameters,
    scene: THREE.Scene,
    width: number,
    height: number
  ) {
    super(
      new TokenFeatures(
        gridGeometry, needsRedraw, coordString,
        createPaletteColouredAreaObject(gridGeometry, drawingParameters.alpha, drawingParameters.z, colourParameters),
        createSpriteAreaObject(gridGeometry, needsRedraw, textureCache, uvTransform, drawingParameters.spriteAlpha, drawingParameters.spriteZ),
        textureCache
      ),
      new TokenFeatures(
        gridGeometry, needsRedraw, edgeString,
        createPaletteColouredWallObject(
          createTokenFillEdgeGeometry(gridGeometry, drawingParameters.alpha, drawingParameters.z), gridGeometry, colourParameters
        ),
        createSpriteEdgeObject(gridGeometry, needsRedraw, textureCache, uvTransform, drawingParameters.spriteAlpha, drawingParameters.spriteZ),
        textureCache
      ),
      new TokenFeatures(
        gridGeometry, needsRedraw, vertexString,
        createPaletteColouredVertexObject(
          createTokenFillVertexGeometry(gridGeometry, drawingParameters.alpha, drawingParameters.z), gridGeometry, colourParameters
        ),
        createSpriteVertexObject(gridGeometry, needsRedraw, textureCache, uvTransform, drawingParameters.spriteAlpha, drawingParameters.spriteZ),
        textureCache
      ),
      new TokenTexts(gridGeometry, needsRedraw, textMaterial, drawingParameters.textZ)
    );

    this.faces.addToScene(scene);
    this.fillEdges.addToScene(scene);
    this.fillVertices.addToScene(scene);

    this._textScene = new THREE.Scene();
    this._textTarget = new THREE.WebGLRenderTarget(width, height, {
      depthBuffer: false,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping
    });
    this.texts.addToScene(this._textScene);
  }

  get textTarget() { return this._textTarget; }

  render(renderer: THREE.WebGLRenderer, camera: THREE.Camera) {
    renderer.setRenderTarget(this._textTarget);
    renderer.setClearColor(0xffffff, 0); // clear to transparent
    renderer.clear();
    renderer.render(this._textScene, camera);
    renderer.setRenderTarget(null);
  }

  resize(width: number, height: number) {
    this._textTarget.setSize(width, height);
  }

  setTextureCache(textureCache: TextureCache) {
    this.faces.setTextureCache(textureCache);
    this.fillEdges.setTextureCache(textureCache);
    this.fillVertices.setTextureCache(textureCache);
  }

  dispose() {
    super.dispose();
    this.faces.dispose();
    this.fillEdges.dispose();
    this.fillVertices.dispose();
    this.texts.dispose();

    this._textTarget.dispose();
  }
}

export class SelectionDrawing extends BaseTokenDrawing<
  InstancedFeatures<GridCoord, ITokenFace>,
  InstancedFeatures<GridEdge, ITokenFillEdge>,
  InstancedFeatures<GridVertex, ITokenFillVertex>
> {
  constructor(
    gridGeometry: IGridGeometry,
    needsRedraw: RedrawFlag,
    createAreaObject: (maxInstances: number) => IInstancedFeatureObject<GridCoord, IFeature<GridCoord>>,
    createWallObject: (maxInstances: number) => IInstancedFeatureObject<GridEdge, IFeature<GridEdge>>,
    createVertexObject: (maxInstances: number) => IInstancedFeatureObject<GridVertex, IFeature<GridVertex>>,
    scene: THREE.Scene
  ) {
    super(
      createSelectedAreas<ITokenFace>(gridGeometry, needsRedraw, createAreaObject, 100),
      new InstancedFeatures<GridEdge, ITokenFillEdge>(
        gridGeometry, needsRedraw, edgeString, createWallObject, 100
      ),
      new InstancedFeatures<GridVertex, ITokenFillVertex>(
        gridGeometry, needsRedraw, vertexString, createVertexObject, 100
      )
    );

    this.faces.addToScene(scene);
    this.fillEdges.addToScene(scene);
    this.fillVertices.addToScene(scene);
  }

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

  dispose() {
    super.dispose();
    this.faces.dispose();
    this.fillEdges.dispose();
    this.fillVertices.dispose();
  }
}