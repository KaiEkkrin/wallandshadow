import { GridCoord, GridVertex } from '../../data/coord';
import { LoSPosition } from '../../data/losPosition';
import { ITokenGeometry } from '../../data/tokenGeometry';
import { ITokenDrawing } from '../../data/tokens';
import { MapColouring } from '../colouring';
import { FeatureColour } from '../featureColour';
import { IGridGeometry } from '../gridGeometry';
import { IDrawing } from '../interfaces';
import { RedrawFlag } from '../redrawFlag';
import { ISpriteManager } from '../../services/interfaces';

import { Areas, createPaletteColouredAreaObject, createAreas, createSelectionColouredAreaObject } from './areas';
import { Grid } from './grid';
import { GridFilter } from './gridFilter';
import { LoS } from './los';
import { createLoSFilter, ILoSPreRenderParameters, LoSFilter } from './losFilter';
import { MapColourVisualisation } from './mapColourVisualisation';
import { MapControlPoints, MapImages } from './mapImages';
import { OutlineSelectionTokenDrawing, OutlineTokenDrawing } from './outlineTokenDrawing';
import { OutlinedRectangle } from './overlayRectangle';
import { StripedAreas } from './paletteStripedFeatureObject';
import { TextFilter } from './textFilter';
import { TextureCache } from './textureCache';
import { SelectionDrawing, TokenDrawing } from './tokenDrawingOrtho';
import { createLargeTokenUvTransform } from './uv';
import { Vertices, createVertices, createSelectionColouredVertexObject, createSingleVertexGeometry, createTokenFillVertexGeometry, createPaletteColouredVertexObject } from './vertices';
import { Walls, createPaletteColouredWallObject, createSelectionColouredWallObject, createWallGeometry, createTokenFillEdgeGeometry } from './walls';

import * as THREE from 'three';

// Our Z values are in the range -1..1 so that they're the same in the shaders
const imageZ = -0.9;
const areaZ = -0.5;
const playerAreaZ = -0.49;
const tokenZ = -0.3;
const wallZ = -0.45;
const tokenSpriteZ = -0.25;
const gridZ = -0.4;
const losZ = -0.2;
const losQ = 0.2;
const selectionZ = 0.05;
const highlightZ = 0.1;
const vertexHighlightZ = 0.2;
const textZ = -0.23; // in front of the token sprite but below the LoS
const invalidSelectionZ = 0.6;
const outlineTokenZ = -0.24; // needs to be above regular token sprites to be clearly visible
const outlineZOffset = 0.01;

const wallAlpha = 0.15;
const edgeAlpha = 0.5;
const vertexAlpha = 0.5;
const tokenAlpha = 0.7;
const tokenSpriteAlpha = 0.6;
const outlineTokenAlpha = 0.8;
const selectionAlpha = 0.8;
const areaAlpha = 1.0;
const vertexHighlightAlpha = 0.35;
const imageControlPointAlpha = 0.175; // Half of vertexHighlightAlpha for smaller image control points

// An orthographic implementation of IDrawing using THREE.js.
export class DrawingOrtho implements IDrawing {
  private readonly _gridGeometry: IGridGeometry;
  private readonly _logError: (message: string, e: unknown) => void;
  private readonly _resolveImageUrl: (path: string) => Promise<string>;

  private readonly _camera: THREE.OrthographicCamera;
  private readonly _fixedCamera: THREE.OrthographicCamera;
  private readonly _overlayCamera: THREE.OrthographicCamera;
  private readonly _renderer: THREE.WebGLRenderer; // this is a singleton, we don't own it
  private readonly _canvasClearColour: THREE.Color;

  private readonly _textMaterial: THREE.MeshBasicMaterial;

  private readonly _imageScene: THREE.Scene;
  private readonly _mapScene: THREE.Scene;
  private readonly _fixedFilterScene: THREE.Scene;
  private readonly _filterScene: THREE.Scene;
  private readonly _fixedHighlightScene: THREE.Scene;
  private readonly _overlayScene: THREE.Scene;

  private readonly _grid: Grid; // TODO #160 remove the LoS part of this, replaced with LoSFilter.
  private readonly _gridFilter: GridFilter;
  private readonly _losFilter: LoSFilter;
  private readonly _textFilter: TextFilter;
  private readonly _areas: StripedAreas;
  private readonly _playerAreas: StripedAreas;
  private readonly _highlightedAreas: Areas;
  private readonly _highlightedVertices: Vertices;
  private readonly _highlightedWalls: Walls;
  private readonly _imageControlPointHighlights: MapControlPoints;
  private readonly _los: LoS;
  private readonly _losParameters: ILoSPreRenderParameters;
  private readonly _selection: ITokenDrawing;
  private readonly _selectionDrag: ITokenDrawing; // a copy of the selection shown only while dragging it
  private readonly _selectionDragRed: ITokenDrawing; // likewise, but shown if the selection couldn't be dropped there
  private readonly _tokens: TokenDrawing;
  private readonly _outlineSelection: OutlineSelectionTokenDrawing;
  private readonly _outlineSelectionDrag: OutlineSelectionTokenDrawing;
  private readonly _outlineSelectionDragRed: OutlineSelectionTokenDrawing;
  private readonly _outlineTokens: OutlineTokenDrawing;
  private readonly _walls: Walls;
  private readonly _images: MapImages;
  private readonly _imageSelection: MapImages;
  private readonly _imageSelectionDrag: MapImages;
  private readonly _imageControlPointSelection: MapControlPoints;
  private readonly _mapColourVisualisation: MapColourVisualisation;

  private readonly _outlinedRectangle: OutlinedRectangle;

  private readonly _gridNeedsRedraw: RedrawFlag;
  private readonly _needsRedraw: RedrawFlag;

  private readonly _scratchMatrix1 = new THREE.Matrix4();
  private readonly _scratchQuaternion = new THREE.Quaternion();

  private _spriteManager: ISpriteManager;
  private _textureCache: TextureCache;

  private _mount: HTMLDivElement | undefined = undefined;
  private _showLoS = false;
  private _showMapColourVisualisation = false;
  private _disposed = false;

  // Debug texture visualization
  private _debugShowFaceCoord = false;
  private _debugShowVertexCoord = false;
  private _debugScene: THREE.Scene | undefined;
  private _debugMaterial: THREE.MeshBasicMaterial | undefined;
  private _debugMesh: THREE.Mesh | undefined;

  constructor(
    renderer: THREE.WebGLRenderer,
    gridGeometry: IGridGeometry,
    tokenGeometry: ITokenGeometry,
    colours: FeatureColour[],
    seeEverything: boolean,
    logError: (message: string, e: unknown) => void,
    spriteManager: ISpriteManager,
    resolveImageUrl: (path: string) => Promise<string>
  ) {
    this._renderer = renderer;
    this._gridGeometry = gridGeometry;
    this._logError = logError;
    this._resolveImageUrl = resolveImageUrl;

    // We need these to initialise things, but they'll be updated dynamically
    const renderWidth = Math.max(1, Math.floor(window.innerWidth));
    const renderHeight = Math.max(1, Math.floor(window.innerHeight));

    this._camera = new THREE.OrthographicCamera(0, renderWidth, renderHeight, 0, -1, 1);
    this._camera.position.z = 0;

    this._fixedCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
    this._fixedCamera.position.z = 0;

    this._overlayCamera = new THREE.OrthographicCamera(0, renderWidth, renderHeight, 0, -1, 1);
    this._overlayCamera.position.z = 0;

    this._gridNeedsRedraw = new RedrawFlag();
    this._needsRedraw = new RedrawFlag();

    // These scenes need to be drawn in sequence to get the blending right and allow us
    // to draw the map itself, then overlay fixed features (the grid), then tokens, then overlay LoS
    // to allow it to hide the grid, and overlay the UI overlay (drag rectangle).
    this._imageScene = new THREE.Scene();
    this._mapScene = new THREE.Scene();
    this._fixedFilterScene = new THREE.Scene();
    this._filterScene = new THREE.Scene();
    this._fixedHighlightScene = new THREE.Scene();
    this._overlayScene = new THREE.Scene();

    this._canvasClearColour = new THREE.Color(0.01, 0.01, 0.01);
    this._renderer.autoClear = false;
    this._textMaterial = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide });

    const darkColourParameters = { palette: colours.map(c => c.dark) };
    const lightColourParameters = { palette: colours.map(c => c.light) };

    const invalidSelectionColourParameters = {
      palette: [new THREE.Color(0xa00000)]
    };

    // So that the alpha blending works correctly, we add things to the fixed filter
    // in back-to-front order.
    // Because the LoS can be added or removed after the fact it should always be the
    // top thing in the fixed filter.  Therefore the correct order currently is
    // - areas
    // - player areas
    // - grid
    // - LoS
    this._areas = new StripedAreas(
      this._gridGeometry, this._needsRedraw, renderWidth, renderHeight,
      { ...darkColourParameters, alpha: 0.5, patternSize: 10, z: areaZ }
    );
    this._areas.addToScene(this._fixedFilterScene);

    this._playerAreas = new StripedAreas(
      this._gridGeometry, this._needsRedraw, renderWidth, renderHeight,
      { ...darkColourParameters, alpha: 0.5, patternSize: 10, z: playerAreaZ }
    );
    this._playerAreas.addToScene(this._fixedFilterScene); // TODO #197 Fix the interaction with the map colour visualisation

    // Texture of face co-ordinates within the tile.
    this._grid = new Grid(
      this._gridGeometry,
      this._gridNeedsRedraw,
      gridZ,
      losZ,
      tokenAlpha,
      vertexAlpha,
      renderWidth,
      renderHeight
    );

    this._gridFilter = new GridFilter(this._grid.faceCoordRenderTarget.texture, gridZ);
    this._gridFilter.addToScene(this._fixedFilterScene);

    // The LoS
    this._los = new LoS(
      this._gridGeometry, this._needsRedraw, losZ, losQ, renderWidth, renderHeight
    );

    this._losParameters = {
      fullyHidden: 0.0, // increased if `seeEverything`
      fullyVisible: 1.0,
      losTarget: this._los.target
    };

    // The highlighted areas
    // (TODO does this need to be a different feature set from the selection?)
    this._highlightedAreas = createAreas(
      this._gridGeometry, this._needsRedraw,
      createSelectionColouredAreaObject(this._gridGeometry, areaAlpha, highlightZ),
      100
    );
    this._highlightedAreas.addToScene(this._filterScene);

    // The highlighted vertices
    const highlightedVertexGeometry = createSingleVertexGeometry(this._gridGeometry, vertexHighlightAlpha, vertexHighlightZ);
    this._highlightedVertices = createVertices(
      this._gridGeometry, this._needsRedraw,
      createSelectionColouredVertexObject(highlightedVertexGeometry, this._gridGeometry),
      100
    );
    this._highlightedVertices.addToScene(this._filterScene);

    // The highlighted walls
    const highlightedWallGeometry = createWallGeometry(this._gridGeometry, edgeAlpha, highlightZ);
    this._highlightedWalls = new Walls(
      this._gridGeometry, this._needsRedraw,
      createSelectionColouredWallObject(highlightedWallGeometry, this._gridGeometry),
      undefined, 100
    );
    this._highlightedWalls.addToScene(this._filterScene);

    // The map image highlights
    this._imageControlPointHighlights = new MapControlPoints(
      this._gridGeometry, this._needsRedraw, this._filterScene, imageControlPointAlpha, vertexHighlightZ
    );

    // The selection
    const tokenFillEdgeGeometry = createTokenFillEdgeGeometry(gridGeometry, selectionAlpha, selectionZ);
    const tokenFillVertexGeometry = createTokenFillVertexGeometry(gridGeometry, selectionAlpha, selectionZ);
    const createSelectedAreaObject = createSelectionColouredAreaObject(gridGeometry, selectionAlpha, selectionZ);
    const createSelectedWallObject = createSelectionColouredWallObject(tokenFillEdgeGeometry, gridGeometry);
    const createSelectedVertexObject = createSelectionColouredVertexObject(tokenFillVertexGeometry, gridGeometry);
    this._selection = new SelectionDrawing(
      gridGeometry, this._needsRedraw, createSelectedAreaObject, createSelectedWallObject, createSelectedVertexObject, this._filterScene
    );
    this._selectionDrag = new SelectionDrawing(
      gridGeometry, this._needsRedraw, createSelectedAreaObject, createSelectedWallObject, createSelectedVertexObject, this._filterScene
    );

    const createSelectedRedAreaObject = createPaletteColouredAreaObject(
      gridGeometry, selectionAlpha, invalidSelectionZ, invalidSelectionColourParameters
    );
    const createSelectedRedWallObject = createPaletteColouredWallObject(
      tokenFillEdgeGeometry, gridGeometry, invalidSelectionColourParameters
    );
    const createSelectedRedVertexObject = createPaletteColouredVertexObject(
      tokenFillVertexGeometry, gridGeometry, invalidSelectionColourParameters
    );
    this._selectionDragRed = new SelectionDrawing(
      gridGeometry, this._needsRedraw, createSelectedRedAreaObject, createSelectedRedWallObject, createSelectedRedVertexObject, this._filterScene
    );

    // The tokens
    this._spriteManager = spriteManager;
    this._textureCache = new TextureCache(spriteManager, resolveImageUrl, logError);
    const uvTransform = createLargeTokenUvTransform(gridGeometry, tokenGeometry, tokenSpriteAlpha);
    this._tokens = new TokenDrawing(
      gridGeometry, this._textureCache, uvTransform, this._needsRedraw, this._textMaterial, {
        alpha: tokenAlpha,
        spriteAlpha: tokenSpriteAlpha,
        z: tokenZ,
        spriteZ: tokenSpriteZ,
        textZ: textZ
      }, lightColourParameters, this._mapScene, renderWidth, renderHeight
    );

    this._outlineTokens = new OutlineTokenDrawing(
      gridGeometry, this._needsRedraw,
      createPaletteColouredAreaObject(gridGeometry, outlineTokenAlpha, outlineTokenZ, lightColourParameters),
      createPaletteColouredWallObject(
        createTokenFillEdgeGeometry(gridGeometry, outlineTokenAlpha, outlineTokenZ),
        gridGeometry, lightColourParameters
      ),
      createPaletteColouredVertexObject(
        createTokenFillVertexGeometry(gridGeometry, outlineTokenAlpha, outlineTokenZ),
        gridGeometry, lightColourParameters
      ),
      renderWidth, renderHeight, this._fixedFilterScene, this._textMaterial,
      outlineTokenZ
    )

    // The outline selection
    this._outlineSelection = new OutlineSelectionTokenDrawing(
      gridGeometry, this._needsRedraw, createSelectedAreaObject, createSelectedWallObject, createSelectedVertexObject,
      renderWidth, renderHeight, this._fixedHighlightScene, selectionZ + outlineZOffset, 100, THREE.AdditiveBlending
    );

    this._outlineSelectionDrag = new OutlineSelectionTokenDrawing(
      gridGeometry, this._needsRedraw, createSelectedAreaObject, createSelectedWallObject, createSelectedVertexObject,
      renderWidth, renderHeight, this._fixedHighlightScene, selectionZ + outlineZOffset, 100, THREE.AdditiveBlending
    );

    this._outlineSelectionDragRed = new OutlineSelectionTokenDrawing(
      gridGeometry, this._needsRedraw, createSelectedRedAreaObject, createSelectedRedWallObject, createSelectedRedVertexObject,
      renderWidth, renderHeight, this._fixedHighlightScene, selectionZ + outlineZOffset, 100
    );

    // The walls
    const wallGeometry = createWallGeometry(this._gridGeometry, wallAlpha, wallZ);
    this._walls = new Walls(
      this._gridGeometry, this._needsRedraw,
      createPaletteColouredWallObject(wallGeometry, this._gridGeometry, lightColourParameters),
      this._los.features
    );
    this._walls.addToScene(this._mapScene);

    // The underlay images.
    this._images = new MapImages(
      this._gridGeometry, this._needsRedraw, this._imageScene, this._textureCache, imageZ, false
    );

    this._imageSelection = new MapImages(
      this._gridGeometry, this._needsRedraw, this._filterScene, this._textureCache, selectionZ, true
    );

    this._imageSelectionDrag = new MapImages(
      this._gridGeometry, this._needsRedraw, this._filterScene, this._textureCache, highlightZ, true
    );

    this._imageControlPointSelection = new MapControlPoints(
      this._gridGeometry, this._needsRedraw, this._filterScene, imageControlPointAlpha, highlightZ
    );

    // The rest of the fixed filter (added after the outline tokens, which are also rendered here)
    this._textFilter = new TextFilter(textZ, new THREE.Vector4(1, 1, 1, 1));
    this._textFilter.addToScene(this._fixedFilterScene);

    this._losFilter = createLoSFilter(losZ);

    // Don't start with LoS if we should see everything.
    // The state machine will call showLoSPositions() to update this after changes come in.
    if (!seeEverything) {
      this._losFilter.addToScene(this._fixedFilterScene);
    }

    // The map colour visualisation (added on request instead of the areas)
    this._mapColourVisualisation = new MapColourVisualisation(
      this._gridGeometry, this._needsRedraw, areaAlpha, areaZ
    );

    // The outlined rectangle
    this._outlinedRectangle = new OutlinedRectangle(gridGeometry, this._needsRedraw);
    this._outlinedRectangle.addToScene(this._overlayScene);
  }

  get renderer() { return this._renderer; }

  get areas() { return this._areas; }
  get playerAreas() { return this._playerAreas; }
  get tokens() { return this._tokens; }
  get tokenTexts() { return this._tokens; }
  get outlineTokens() { return this._outlineTokens; }
  get outlineTokenTexts() { return this._outlineTokens; }
  get walls() { return this._walls; }
  get images() { return this._images; }

  get highlightedAreas() { return this._highlightedAreas; }
  get highlightedVertices() { return this._highlightedVertices; }
  get highlightedWalls() { return this._highlightedWalls; }
  get imageControlPointHighlights() { return this._imageControlPointHighlights; }

  get selection() { return this._selection; }
  get selectionDrag() { return this._selectionDrag; }
  get selectionDragRed() { return this._selectionDragRed; }

  get outlineSelection() { return this._outlineSelection; }
  get outlineSelectionDrag() { return this._outlineSelectionDrag; }
  get outlineSelectionDragRed() { return this._outlineSelectionDragRed; }

  get imageSelection() { return this._imageSelection; }
  get imageSelectionDrag() { return this._imageSelectionDrag; }
  get imageControlPointSelection() { return this._imageControlPointSelection; }

  get los() { return this._los; }

  get outlinedRectangle() { return this._outlinedRectangle; }
  get vertexHitDistance() { return this._gridGeometry.getVertexRadius(vertexHighlightAlpha); }

  animate(preAnimate?: (() => void) | undefined, postAnimate?: (() => void) | undefined) {
    if (this._disposed) {
      return;
    }

    requestAnimationFrame(() => this.animate(preAnimate, postAnimate));
    preAnimate?.();

    // Check that we have enough grid.
    // If we don't, we'll fill it in on the next frame:
    this._grid.fitGridToFrame(this._renderer);

    // Don't re-render the visible scene unless something changed:
    // (Careful -- don't chain these method calls up with ||, it's important
    // I actually call each one and don't skip later ones if an early one returned
    // true)
    const needsRedraw = this._needsRedraw.needsRedraw();
    const gridNeedsRedraw = this._gridNeedsRedraw.needsRedraw();
    if (gridNeedsRedraw) {
      this._grid.render(this._renderer, this._camera);
    }

    if (gridNeedsRedraw || needsRedraw) {
      // In debug mode, just render the debug texture fullscreen
      if (this._debugShowFaceCoord || this._debugShowVertexCoord) {
        this._renderer.setRenderTarget(null);
        this._renderer.setClearColor(this._canvasClearColour);
        this._renderer.clear();
        if (this._debugScene !== undefined) {
          this._renderer.render(this._debugScene, this._fixedCamera);
        }
      } else {
        // Normal rendering
        if (this._showLoS === true) {
          this._los.render(this._camera, this._fixedCamera, this._renderer);
          this._losFilter.preRender(this._losParameters);
        }

        this._areas.render(this._camera, this._renderer);
        this._playerAreas.render(this._camera, this._renderer);
        this._tokens.render(this._renderer, this._camera);
        this._textFilter.preRender(this._tokens.textTarget);

        this._outlineTokens.render(this._camera, this._renderer);
        this._outlineSelection.render(this._camera, this._renderer);
        this._outlineSelectionDrag.render(this._camera, this._renderer);
        this._outlineSelectionDragRed.render(this._camera, this._renderer);

        this._renderer.setRenderTarget(null);
        this._renderer.setClearColor(this._canvasClearColour);
        this._renderer.clear();

        // TODO #197 I think the player areas are going to end up shading the tokens at this point.
        // I should try to rationalise what gets rendered where -- perhaps going so far as to render
        // everything into back buffers and only compose them together with filters to create the
        // main result (?)
        this._renderer.render(this._imageScene, this._camera);
        this._renderer.render(this._mapScene, this._camera);
        this._renderer.render(this._fixedFilterScene, this._fixedCamera);
        this._renderer.render(this._filterScene, this._camera);
        if (
          this._outlineSelection.doRender ||
          this._outlineSelectionDrag.doRender ||
          this._outlineSelectionDragRed.doRender
        ) {
          this._renderer.render(this._fixedHighlightScene, this._fixedCamera);
        }
        this._renderer.render(this._overlayScene, this._overlayCamera);
      }
    }

    postAnimate?.();
  }

  checkLoS(cp: THREE.Vector3) {
    return this._showLoS ? (this._los.checkLoS(this._renderer, cp) ?? false) : true;
  }

  getGridCoordAt(cp: THREE.Vector3): GridCoord & { isTokenFace: boolean } | undefined {
    return this._grid.getGridCoordAt(this._renderer, cp);
  }

  getGridVertexAt(cp: THREE.Vector3): GridVertex | undefined {
    return this._grid.getGridVertexAt(this._renderer, cp);
  }

  getViewportToWorld(target: THREE.Matrix4): THREE.Matrix4 {
    // For some reason, the camera's projection matrix doesn't include
    // the rotation!
    const rotationMatrix = this._scratchMatrix1.makeRotationFromQuaternion(
      this._scratchQuaternion.setFromEuler(this._camera.rotation)
    );
    return target.multiplyMatrices(
      rotationMatrix,
      this._camera.projectionMatrixInverse
    );
  }

  getWorldToLoSViewport(target: THREE.Matrix4): THREE.Matrix4 {
    // Now uses the same camera as the main viewport
    const rotationMatrix = this._scratchMatrix1.makeRotationFromQuaternion(
      this._scratchQuaternion.setFromEuler(this._camera.rotation).invert()
    );
    return target.multiplyMatrices(
      this._camera.projectionMatrix,
      rotationMatrix
    );
  }

  getWorldToViewport(target: THREE.Matrix4): THREE.Matrix4 {
    // For some reason, the camera's projection matrix doesn't include
    // the rotation!
    const rotationMatrix = this._scratchMatrix1.makeRotationFromQuaternion(
      this._scratchQuaternion.setFromEuler(this._camera.rotation).invert()
    );
    return target.multiplyMatrices(
      this._camera.projectionMatrix,
      rotationMatrix
    );
  }

  handleChangesApplied(mapColouring: MapColouring) {
    if (this._showMapColourVisualisation === true) {
      this._mapColourVisualisation.clear(); // TODO try to do it incrementally? (requires checking for colour count changes...)
      this._mapColourVisualisation.visualise(this._mapScene, mapColouring);
    }
  }

  resize(translation: THREE.Vector3, rotation: THREE.Quaternion, scaling: THREE.Vector3) {
    const width = Math.max(1, Math.floor(window.innerWidth));
    const height = Math.max(1, Math.floor(window.innerHeight));

    this._renderer.setSize(width, height, false);
    this._grid.resize(width, height);
    this._areas.resize(width, height);
    this._playerAreas.resize(width, height);
    this._tokens.resize(width, height);
    this._outlineTokens.resize(width, height);
    this._outlineSelection.resize(width, height);
    this._outlineSelectionDrag.resize(width, height);
    this._outlineSelectionDragRed.resize(width, height);

    this._camera.left = translation.x + width / -scaling.x;
    this._camera.right = translation.x + width / scaling.x;
    this._camera.top = translation.y + height / -scaling.y;
    this._camera.bottom = translation.y + height / scaling.y;
    this._camera.setRotationFromQuaternion(rotation);
    this._camera.updateProjectionMatrix();

    // LoS now uses the same dimensions as the main viewport
    this._los.resize(width, height);

    this._overlayCamera.left = 0;
    this._overlayCamera.right = width;
    this._overlayCamera.top = height;
    this._overlayCamera.bottom = 0;
    this._overlayCamera.updateProjectionMatrix();

    this._gridFilter.resize(width, height);

    this._needsRedraw.setNeedsRedraw();
    this._gridNeedsRedraw.setNeedsRedraw();
  }

  setLoSPositions(positions: LoSPosition[] | undefined, seeEverything: boolean) {
    const nowShowLoS = positions !== undefined;
    if (nowShowLoS) {
      this._losFilter.addToScene(this._fixedFilterScene);
    } else {
      this._losFilter.removeFromScene(this._fixedFilterScene);
    }

    if (positions !== undefined) {
      this._los.setTokenPositions(positions);
    }

    this._showLoS = nowShowLoS;

    // Doing this makes fully-hidden areas show up a bit if we can notionally
    // see everything -- for the map owner / FFA mode.
    this._losParameters.fullyHidden = seeEverything ? 0.25 : 0.0;
  }

  setMount(newMount: HTMLDivElement | undefined) {
    if (this._mount !== undefined) {
      try {
        this._mount.removeChild(this._renderer.domElement);
      } catch (_e) {
        console.warn("failed to unmount renderer dom element");
      }
    }

    if (newMount !== undefined) {
      newMount.appendChild(this._renderer.domElement);
    }

    this._mount = newMount;
  }

  setShowMapColourVisualisation(show: boolean, mapColouring: MapColouring) {
    if (show === this._showMapColourVisualisation) {
      return;
    }

    this._showMapColourVisualisation = show;
    if (show === true) {
      // Remove the area visualisation:
      this._areas.removeFromScene();

      // Add the map colour visualisation based on the current map colours:
      this._mapColourVisualisation.visualise(this._mapScene, mapColouring);
    } else {
      // Remove any map colour visualisation and put the area visualisation back
      this._mapColourVisualisation.removeFromScene();
      this._areas.addToScene(this._fixedFilterScene);
    }
  }

  setSpriteManager(spriteManager: ISpriteManager) {
    if (spriteManager === this._spriteManager) {
      // Nothing to do
      return;
    }

    const oldTextureCache = this._textureCache;
    this._spriteManager = spriteManager;
    this._textureCache = new TextureCache(spriteManager, this._resolveImageUrl, this._logError);
    this._tokens.setTextureCache(this._textureCache);
    this._images.setTextureCache(this._textureCache);
    oldTextureCache.dispose();
  }

  worldToViewport(target: THREE.Vector3) {
    return target.applyEuler(this._camera.rotation) // for some reason this isn't in the projection matrix!
      .applyMatrix4(this._camera.projectionMatrix);
  }

  // Debug methods for visualizing the coordinate textures
  private ensureDebugResources() {
    if (this._debugScene === undefined) {
      this._debugScene = new THREE.Scene();
      // Create a fullscreen quad that fills the -1..1 range of the fixed camera
      const geometry = new THREE.PlaneGeometry(2, 2);
      this._debugMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
      this._debugMesh = new THREE.Mesh(geometry, this._debugMaterial);
      this._debugMesh.position.z = 0;
      this._debugScene.add(this._debugMesh);
    }
  }

  toggleDebugShowFaceCoord() {
    if (this._debugShowFaceCoord) {
      // Turn off
      this._debugShowFaceCoord = false;
    } else {
      // Turn on (and turn off the other debug view)
      this.ensureDebugResources();
      this._debugShowFaceCoord = true;
      this._debugShowVertexCoord = false;
      this._debugMaterial!.map = this._grid.faceCoordRenderTarget.texture;
      this._debugMaterial!.needsUpdate = true;
    }
    this._needsRedraw.setNeedsRedraw();
  }

  toggleDebugShowVertexCoord() {
    if (this._debugShowVertexCoord) {
      // Turn off
      this._debugShowVertexCoord = false;
    } else {
      // Turn on (and turn off the other debug view)
      this.ensureDebugResources();
      this._debugShowVertexCoord = true;
      this._debugShowFaceCoord = false;
      this._debugMaterial!.map = this._grid.vertexCoordRenderTarget.texture;
      this._debugMaterial!.needsUpdate = true;
    }
    this._needsRedraw.setNeedsRedraw();
  }

  get isDebugMode() {
    return this._debugShowFaceCoord || this._debugShowVertexCoord;
  }

  dispose() {
    if (this._disposed === true) {
      return;
    }

    this.setMount(undefined);

    this._grid.dispose();
    this._gridFilter.dispose();
    this._losFilter.dispose();
    this._textFilter.dispose();
    this._areas.dispose();
    this._playerAreas.dispose();
    this._walls.dispose();
    this._images.dispose();
    this._imageSelection.dispose();
    this._imageSelectionDrag.dispose();
    this._highlightedAreas.dispose();
    this._highlightedWalls.dispose();
    this._imageControlPointHighlights.dispose();
    this._selection.dispose();
    this._selectionDrag.dispose();
    this._selectionDragRed.dispose();
    this._imageControlPointSelection.dispose();
    this._tokens.dispose();
    this._outlineSelection.dispose();
    this._outlineSelectionDrag.dispose();
    this._outlineSelectionDragRed.dispose();
    this._outlineTokens.dispose();
    this._walls.dispose();
    this._los.dispose();
    this._mapColourVisualisation.dispose();

    this._outlinedRectangle.dispose();

    this._textureCache.dispose();
    this._textMaterial.dispose();

    // Dispose debug resources if created
    this._debugMaterial?.dispose();
    this._debugMesh?.geometry.dispose();

    // do *not* dispose the renderer, it'll be re-used for the next drawing context

    this._disposed = true;
  }
}