import { coordString, GridCoord } from '../../data/coord';
import { IFeature, IIdFeature, IToken } from '../../data/feature';
import { IGridGeometry } from "../gridGeometry";
import { IInstancedFeatureObject } from './instancedFeatureObject';
import { InstancedFeatures } from './instancedFeatures';
import { MultipleFeatureObject } from './multipleFeatureObject';
import { PaletteColouredFeatureObject, IColourParameters, createSelectionColourParameters } from './paletteColouredFeatureObject';
import { RedrawFlag } from '../redrawFlag';
import { ISpriteProperties, SpriteFeatureObject } from './spriteFeatureObject';
import { TextureCache } from './textureCache';
import { ITokenUvTransform } from './uv';

import * as THREE from 'three';

export function createAreaGeometry(gridGeometry: IGridGeometry, alpha: number, z: number) {
  const vertices = [...gridGeometry.createSolidVertices(new THREE.Vector2(0, 0), alpha, z)];
  const indices = [...gridGeometry.createSolidMeshIndices()];
  return () => {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setFromPoints(vertices);
    geometry.setIndex(indices);
    return geometry;
  };
}

function createSingleAreaGeometry(gridGeometry: IGridGeometry, alpha: number, z: number) {
  return createAreaGeometry(gridGeometry.toSingle(), alpha, z);
}

export function createPaletteColouredAreaObject(gridGeometry: IGridGeometry, alpha: number, areaZ: number, colourParameters: IColourParameters) {
  return (maxInstances: number) => new PaletteColouredFeatureObject(
    coordString,
    (o, p) => gridGeometry.transformToCoord(o, p),
    maxInstances,
    createSingleAreaGeometry(gridGeometry, alpha, areaZ),
    colourParameters
  );
}

export function createSelectionColouredAreaObject(
  gridGeometry: IGridGeometry, alpha: number, areaZ: number
) {
  const areaGeometry = createSingleAreaGeometry(gridGeometry, alpha, areaZ);
  return (maxInstances: number) => new MultipleFeatureObject(
    (i: string, maxInstances: number) => new PaletteColouredFeatureObject(
      coordString,
      (o, p) => gridGeometry.transformToCoord(o, p),
      maxInstances,
      areaGeometry,
      createSelectionColourParameters(i)
    ),
    f => `${f.colour}`,
    maxInstances
  );
}

export function createSpriteAreaObject(
  gridGeometry: IGridGeometry,
  redrawFlag: RedrawFlag,
  textureCache: TextureCache,
  uvTransform: ITokenUvTransform,
  alpha: number,
  areaZ: number
) {
  const areaGeometry = createSingleAreaGeometry(gridGeometry, alpha, areaZ);
  return (maxInstances: number) => new MultipleFeatureObject<GridCoord, IToken & ISpriteProperties>(
    (url: string, maxInstances: number) => new SpriteFeatureObject(
      redrawFlag,
      textureCache,
      coordString,
      (o, p) => gridGeometry.transformToCoord(o, p),
      maxInstances,
      areaGeometry,
      f => uvTransform.getFaceTransform(f),
      url
    ),
    f => f.sheetEntry.url,
    maxInstances
  );
}

export function createAreas(
  gridGeometry: IGridGeometry,
  needsRedraw: RedrawFlag,
  createFeatureObject: (maxInstances: number) => IInstancedFeatureObject<GridCoord, IFeature<GridCoord>>,
  maxInstances?: number | undefined
) {
  return new InstancedFeatures<GridCoord, IFeature<GridCoord>>(
    gridGeometry, needsRedraw, coordString, createFeatureObject, maxInstances
  );
}

export function createSelectedAreas<F extends IFeature<GridCoord>>(
  gridGeometry: IGridGeometry,
  needsRedraw: RedrawFlag,
  createFeatureObject: (maxInstances: number) => IInstancedFeatureObject<GridCoord, F>,
  maxInstances?: number | undefined
) {
  return new InstancedFeatures<GridCoord, F>(
    gridGeometry, needsRedraw, coordString, createFeatureObject, maxInstances
  );
}

export type Areas = InstancedFeatures<GridCoord, IFeature<GridCoord>>;
export type SelectedAreas = InstancedFeatures<GridCoord, IIdFeature<GridCoord>>; // so we can look up which token was selected