import { GridVertex, vertexString, verticesEqual } from "./coord";
import { IId } from "./identified";

// Describes the images that a user has uploaded.

export interface IImage {
  // The user's name for the image.
  name: string;

  // The path in Cloud Storage where the image can be found.
  path: string;
}

// We'll have one of these for each user.
export interface IImages {
  images: IImage[];

  // The upload trigger will fill this out if something goes wrong so
  // we can show it to the user.
  lastError: string;
}

// How to position images on the map.
export type Anchor = VertexAnchor | PixelAnchor | NoAnchor;

export type VertexAnchor = {
  anchorType: 'vertex';
  position: GridVertex;
}

export type PixelAnchor = {
  anchorType: 'pixel';
  x: number;
  y: number;
}

export type NoAnchor = {
  anchorType: 'none';
};

export const defaultAnchor: NoAnchor = { anchorType: 'none' };

export type MapImageRotation = "0" | "90" | "180" | "270"

// This *is* an image positioned on the map.
export interface IMapImageProperties extends IId {
  image: IImage;
  rotation: MapImageRotation;
}

export interface IMapImage extends IMapImageProperties {
  start: Anchor;
  end: Anchor;
}

export const defaultMapImage: IMapImage = {
  id: "",
  image: { name: "", path: "" },
  rotation: "0",
  start: defaultAnchor,
  end: defaultAnchor
};

export function anchorsEqual(a: Anchor, b: Anchor | undefined) {
  if (b === undefined) {
    return false;
  } else if (a.anchorType === 'vertex' && b.anchorType === 'vertex') {
    return verticesEqual(a.position, b.position);
  } else if (a.anchorType === 'pixel' && b.anchorType === 'pixel') {
    return a.x === b.x && a.y === b.y;
  } else {
    return false;
  }
}

export function anchorString(a: Anchor | undefined) {
  if (a === undefined) {
    return 'undefined';
  } else if (a.anchorType === 'vertex') {
    return 'vertex ' + vertexString(a.position);
  } else if (a.anchorType === 'pixel') {
    return `pixel x=${a.x} y=${a.y}`;
  } else {
    return `${a.anchorType}`;
  }
}

export function createVertexAnchor(x: number, y: number, vertex: number): VertexAnchor {
  return {
    anchorType: 'vertex',
    position: { x: x, y: y, vertex: vertex }
  };
}

export function createPixelAnchor(x: number, y: number): PixelAnchor {
  return {
    anchorType: 'pixel',
    x: x,
    y: y
  };
}

export interface IMapControlPointIdentifier {
  id: string;
  which: 'start' | 'end';
}

export interface IMapControlPoint extends IMapControlPointIdentifier {
  anchor: Anchor;
  invalid?: boolean | undefined; // for highlights -- set to true to show in red or what have you
}

// Presents a feature dictionary-like interface for the map control points.
export interface IMapControlPointDictionary extends Iterable<IMapControlPoint> {
  add(f: IMapControlPoint): boolean;
  clear(): void;
  forEach(fn: (f: IMapControlPoint) => void): void;
  get(id: IMapControlPointIdentifier): IMapControlPoint | undefined;
  iterate(): Iterable<IMapControlPoint>;
  remove(id: IMapControlPointIdentifier): IMapControlPoint | undefined;
}