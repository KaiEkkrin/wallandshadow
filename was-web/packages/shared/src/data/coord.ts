import { modFloor } from './extraMath';
import * as THREE from 'three';

// This is the co-ordinate of a face (hex or square) inside the grid.
export type GridCoord = {
  x: number;
  y: number;
};

// This default should end up unseen -- for converters.
export const defaultGridCoord: GridCoord = { x: -10000, y: -10000 };

export function getTile(coord: GridCoord, tileDim: number): THREE.Vector2 {
  return new THREE.Vector2(Math.floor(coord.x / tileDim), Math.floor(coord.y / tileDim));
}

export function getFace(coord: GridCoord, tileDim: number): THREE.Vector2 {
  return new THREE.Vector2(modFloor(coord.x, tileDim), modFloor(coord.y, tileDim));
}

export function coordAdd(a: GridCoord, b: GridCoord): GridCoord {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function coordsEqual(a: GridCoord, b: GridCoord | undefined): boolean {
  return (b === undefined) ? false : (a.x === b.x && a.y === b.y);
}

export function coordMultiplyScalar(a: GridCoord, b: number): GridCoord {
  return { x: a.x * b, y: a.y * b };
}

export function coordString(coord: GridCoord) {
  return "x=" + coord.x + " y=" + coord.y;
}

export function coordSub(a: GridCoord, b: GridCoord): GridCoord {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function createGridCoord(tile: THREE.Vector2, face: THREE.Vector2, tileDim: number): GridCoord {
  return { x: tile.x * tileDim + face.x, y: tile.y * tileDim + face.y };
}

// This is the co-ordinate of an edge.  Each face "owns" some number
// of the edges around it, which are identified by the `edge` number here.
export type GridEdge = GridCoord & {
  edge: number;
};

// This default should end up unseen -- for converters.
export const defaultGridEdge: GridEdge = { x: -10000, y: -10000, edge: 0 };

export function edgesEqual(a: GridEdge, b: GridEdge | undefined): boolean {
  return (b === undefined) ? false : (coordsEqual(a, b) && a.edge === b.edge);
}

export function edgeString(edge: GridEdge) {
  return coordString(edge) + " e=" + edge.edge;
}

export function createGridEdge(tile: THREE.Vector2, face: THREE.Vector2, tileDim: number, edge: number): GridEdge {
  return { x: tile.x * tileDim + face.x, y: tile.y * tileDim + face.y, edge: edge };
}

// This is the co-ordinate of a vertex, which works a bit like an edge.
export type GridVertex = GridCoord & {
  vertex: number;
};

// This default should end up unseen -- for converters.
export const defaultGridVertex: GridVertex = { x: -10000, y: -10000, vertex: 0 };

export function verticesEqual(a: GridVertex, b: GridVertex | undefined): boolean {
  return (b === undefined) ? false : (coordsEqual(a, b) && a.vertex === b.vertex);
}

export function vertexAdd(a: GridVertex, b: GridCoord): GridVertex {
  return { ...coordAdd(a, b), vertex: a.vertex };
}

export function vertexString(vertex: GridVertex) {
  return coordString(vertex) + " v=" + vertex.vertex;
}

export function createGridVertex(tile: THREE.Vector2, face: THREE.Vector2, tileDim: number, vertex: number): GridVertex {
  return { x: tile.x * tileDim + face.x, y: tile.y * tileDim + face.y, vertex: vertex };
}