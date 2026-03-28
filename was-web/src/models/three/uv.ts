import { coordString, coordSub, edgeString, GridCoord, GridEdge, GridVertex, vertexString } from '../../data/coord';
import { defaultToken, FeatureDictionary, IFeature, IToken, TokenSize } from '../../data/feature';
import { ITokenGeometry } from '../../data/tokenGeometry';
import { IGridGeometry } from '../gridGeometry';

import * as THREE from 'three';

function createUvBounds(vertices: Iterable<THREE.Vector3>) {
  const min = new THREE.Vector3(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  const max = new THREE.Vector3(Number.MIN_SAFE_INTEGER, Number.MIN_SAFE_INTEGER, Number.MIN_SAFE_INTEGER);
  for (const v of vertices) {
    min.min(v);
    max.max(v);
  }

  return {
    min: min, max: max,
    offset: new THREE.Vector2(min.x, min.y),
    scale1: Math.max(max.x - min.x, max.y - min.y),
    scale2: Math.min(max.x - min.x, max.y - min.y)
  };
}

export interface ITokenUvTransform {
  getFaceTransform(token: IToken & { basePosition: GridCoord }): THREE.Matrix4 | undefined;
  getFillEdgeTransform(edge: IFeature<GridEdge> & { basePosition: GridCoord, size: TokenSize }): THREE.Matrix4 | undefined;
  getFillVertexTransform(vertex: IFeature<GridVertex> & { basePosition: GridCoord, size: TokenSize }): THREE.Matrix4 | undefined;
}

interface IUvTransformFeature<K extends GridCoord> extends IFeature<K> {
  transform: THREE.Matrix4;
}

// function debugMatrix(m: THREE.Matrix4): string {
//   function extractCol(c: number) {
//     const col = m.elements.slice(4 * c, 4 * (c + 1));
//     col.splice(2, 1);
//     return `${col}`;
//   }

//   return [extractCol(0), extractCol(1), extractCol(3)].join("\n");
// }

function createTokenUvTransform(
  gridGeometry: IGridGeometry,
  tokenGeometry: ITokenGeometry,
  alpha: number,
  tokenSize: TokenSize
): ITokenUvTransform {
  // We assume that the base UVs fill the [0..1] square (assuming aspect ratio is preserved that's correct)
  // and create the UVs for the whole token, then work out what we need to do to cram them into that square
  const single = gridGeometry.toSingle();
  const baseToken = { ...defaultToken, position: { x: 0, y: 0 }, size: tokenSize };
  const facePositions = [...tokenGeometry.enumerateFacePositions(baseToken)];
  const faceVertices = [...single.createSolidVertices(new THREE.Vector2(0, 0), alpha, 0)];

  const scratchVertices = [...faceVertices.map(v => v.clone())];
  const uvFaces = new FeatureDictionary<GridCoord, IUvTransformFeature<GridCoord>>(coordString);
  const boundsMin = new THREE.Vector2(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  const boundsMax = new THREE.Vector2(Number.MIN_SAFE_INTEGER, Number.MIN_SAFE_INTEGER);
  for (const c of facePositions) {
    // Transform the vertices of the zero face to this position, and work out its UV bounds
    const relCoord = coordSub(c, facePositions[0]);
    const transform = gridGeometry.transformToCoord(new THREE.Matrix4(), relCoord);
    scratchVertices.forEach(v => v.applyMatrix4(transform));
    const { offset, scale1 } = createUvBounds(scratchVertices);

    // Contribute that to my overall bounds for the token
    uvFaces.set({ position: relCoord, colour: 0, transform: transform });
    boundsMin.min(offset);
    boundsMax.max(offset.clone().addScalar(scale1));

    // Reset those scratch vertices for the next pass
    scratchVertices.forEach((v, i) => v.copy(faceVertices[i]));
  }

  // Now we can work out a scale for the composite token based on those bounds and 
  // correct aspect ratio.
  const boundsWidth = boundsMax.x - boundsMin.x;
  const boundsHeight = boundsMax.y - boundsMin.y;
  // console.debug(`found boundsWidth ${boundsWidth} (${boundsMin.x}..${boundsMax.x}), boundsHeight ${boundsHeight} (${boundsMin.y}..${boundsMax.y})`);
  if (boundsWidth < boundsHeight) {
    boundsMin.x -= 0.5 * (boundsHeight - boundsWidth);
  } else {
    boundsMin.y -= 0.5 * (boundsWidth - boundsHeight);
  }

  const boundsSize = Math.max(boundsWidth, boundsHeight);

  // Splice in the overall scale
  const scalingTransform = new THREE.Matrix4().makeScale(1.0 / boundsSize, 1.0 / boundsSize, 1);
  const translationTransform = new THREE.Matrix4().makeTranslation(-boundsMin.x, -boundsMin.y, 0);
  const scratchMatrix1 = new THREE.Matrix4();
  for (const f of uvFaces) {
    const baseTransform = scratchMatrix1.copy(f.transform);
    // console.debug(`face ${coordString(f.position)}: base transform\n` +
    //   debugMatrix(baseTransform)
    // );

    const fScaling = f.transform.copy(scalingTransform);
    // console.debug(`face ${coordString(f.position)}: face scaling\n` +
    //   debugMatrix(fScaling)
    // );

    // correct for off-centre (very, very confusing)
    // console.debug(`face ${coordString(f.position)}: face translation\n` +
    //   debugMatrix(translationTransform)
    // );

    f.transform = fScaling.multiply(translationTransform).multiply(baseTransform);
    // console.debug(`face ${coordString(f.position)}: offset ${f.offset.toArray()}, scale ${f.scale}, transform\n` +
    //   debugMatrix(f.transform)
    // );
  }

  // Using the same boundary and transformations, I can now create the fill edge and
  // vertex records:
  const uvFillEdges = new FeatureDictionary<GridEdge, IUvTransformFeature<GridEdge>>(edgeString);
  for (const e of tokenGeometry.enumerateFillEdgePositions(baseToken)) {
    const relEdge = { ...coordSub(e, facePositions[0]), edge: e.edge };
    const transform = scalingTransform.clone().multiply(translationTransform)
      .multiply(gridGeometry.transformToEdge(scratchMatrix1, relEdge));
    uvFillEdges.add({ position: e, colour: 0, transform: transform });
  }

  const uvFillVertices = new FeatureDictionary<GridVertex, IUvTransformFeature<GridVertex>>(vertexString);
  for (const v of tokenGeometry.enumerateFillVertexPositions(baseToken)) {
    const relVertex = { ...coordSub(v, facePositions[0]), vertex: v.vertex };
    const transform = scalingTransform.clone().multiply(translationTransform)
      .multiply(gridGeometry.transformToVertex(scratchMatrix1, relVertex));
    uvFillVertices.add({ position: v, colour: 0, transform: transform });
  }

  return {
    getFaceTransform: token => {
      const relCoord = coordSub(token.position, token.basePosition);
      const f2 = uvFaces.get(relCoord);
      return f2 === undefined ? undefined : f2.transform;
    },

    getFillEdgeTransform: edge => {
      const relEdge = { ...coordSub(edge.position, edge.basePosition), edge: edge.position.edge };
      const f2 = uvFillEdges.get(relEdge);
      return f2 === undefined ? undefined : f2.transform;
    },

    getFillVertexTransform: vertex => {
      const relVertex = { ...coordSub(vertex.position, vertex.basePosition), vertex: vertex.position.vertex };
      const f2 = uvFillVertices.get(relVertex);
      return f2 === undefined ? undefined : f2.transform;
    }
  };
}

export function createLargeTokenUvTransform(
  gridGeometry: IGridGeometry,
  tokenGeometry: ITokenGeometry,
  alpha: number
): ITokenUvTransform {
  const bySize = new Map<TokenSize, ITokenUvTransform>();
  for (const size of tokenGeometry.getTokenSizes()) {
    bySize.set(size, createTokenUvTransform(gridGeometry, tokenGeometry, alpha, size));
  }

  return {
    getFaceTransform: token => bySize.get(token.size)?.getFaceTransform(token),
    getFillEdgeTransform: edge => bySize.get(edge.size)?.getFillEdgeTransform(edge),
    getFillVertexTransform: vertex => bySize.get(vertex.size)?.getFillVertexTransform(vertex)
  };
}