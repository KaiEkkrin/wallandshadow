import { IMapSummary } from "./adventure";
import { TokenSize } from "./feature";

export const MAP_CONTAINER_CLASS = "Map-container";

export enum MapType {
  Hex = "hex",
  Square = "square",
}

export function createTokenSizes(ty: MapType): TokenSize[] {
  return ty === MapType.Hex ? [
    '1',
    '2 (left)',
    '2 (right)',
    '3',
    '4 (left)',
    '4 (right)'
  ] : [
    '1',
    '2',
    '3',
    '4'
  ];
}

export interface IMap {
  adventureName: string;
  name: string;
  description: string;
  owner: string; // to check whether we can consolidate
  ty: MapType;
  ffa: boolean;
  imagePath: string;
}

export function summariseMap(adventureId: string, mapId: string, m: IMap): IMapSummary {
  return {
    adventureId: adventureId,
    id: mapId,
    name: m.name,
    description: m.description,
    ty: m.ty,
    imagePath: m.imagePath
  };
}