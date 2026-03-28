import { GridVertex, vertexString } from '../../data/coord';
import { IFeature, ITokenProperties } from '../../data/feature';
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

export function createTokenFillVertexGeometry(gridGeometry: IGridGeometry, alpha: number, z: number) {
  const vertices = [...gridGeometry.createTokenFillVertexVertices(alpha, z)];
  const indices = gridGeometry.createTokenFillVertexIndices();
  return () => {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setFromPoints(vertices);
    geometry.setIndex(indices);
    return geometry;
  };
}

export function createVertexGeometry(gridGeometry: IGridGeometry, alpha: number, z: number, maxVertex?: number | undefined) {
  const vertices = [...gridGeometry.createSolidVertexVertices(new THREE.Vector2(0, 0), alpha, z, maxVertex)];
  const indices = [...gridGeometry.createSolidVertexIndices(maxVertex)];
  return () => {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setFromPoints(vertices);
    geometry.setIndex(indices);
    return geometry;
  };
}

export function createSingleVertexGeometry(gridGeometry: IGridGeometry, alpha: number, z: number) {
  return createVertexGeometry(gridGeometry.toSingle(), alpha, z, 1);
}

export function createPaletteColouredVertexObject(createGeometry: () => THREE.InstancedBufferGeometry, gridGeometry: IGridGeometry, colourParameters: IColourParameters) {
  return (maxInstances: number) => new PaletteColouredFeatureObject(
    vertexString,
    (o, p) => gridGeometry.transformToVertex(o, p),
    maxInstances,
    createGeometry,
    colourParameters
  );
}

export function createSelectionColouredVertexObject(createGeometry: () => THREE.InstancedBufferGeometry, gridGeometry: IGridGeometry) {
  return (maxInstances: number) => new MultipleFeatureObject<GridVertex, IFeature<GridVertex>>(
    (i: string, maxInstances: number) => new PaletteColouredFeatureObject(
      vertexString,
      (o, p) => gridGeometry.transformToVertex(o, p),
      maxInstances,
      createGeometry,
      createSelectionColourParameters(i)
    ),
    f => `${f.colour}`,
    maxInstances
  );
}

export function createSpriteVertexObject(
  gridGeometry: IGridGeometry,
  redrawFlag: RedrawFlag,
  textureCache: TextureCache,
  uvTransform: ITokenUvTransform,
  alpha: number,
  z: number
) {
  const vertexGeometry = createTokenFillVertexGeometry(gridGeometry, alpha, z);
  return (maxInstances: number) => new MultipleFeatureObject<GridVertex, IFeature<GridVertex> & ITokenProperties & ISpriteProperties>(
    (url: string, maxInstances: number) => new SpriteFeatureObject(
      redrawFlag,
      textureCache,
      vertexString,
      (o, p) => gridGeometry.transformToVertex(o, p),
      maxInstances,
      vertexGeometry,
      f => uvTransform.getFillVertexTransform(f),
      url
    ),
    f => f.sheetEntry.url,
    maxInstances
  );
}

export function createVertices(
  gridGeometry: IGridGeometry,
  needsRedraw: RedrawFlag,
  createFeatureObject: (maxInstances: number) => IInstancedFeatureObject<GridVertex, IFeature<GridVertex>>,
  maxInstances?: number | undefined
) {
  return new InstancedFeatures<GridVertex, IFeature<GridVertex>>(
    gridGeometry, needsRedraw, vertexString, createFeatureObject, maxInstances
  );
}

export type Vertices = InstancedFeatures<GridVertex, IFeature<GridVertex>>;