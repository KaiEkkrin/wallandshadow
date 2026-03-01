import { MapType } from "../data/map";
import { IInviteExpiryPolicy } from "../data/policy";

// Request format for Functions calls.
export type FunctionRequest =
  CreateAdventureRequest |
  CreateMapRequest |
  CloneMapRequest |
  ConsolidateMapChangesRequest |
  InviteToAdventureRequest |
  JoinAdventureRequest |
  DeleteImageRequest |
  DeleteMapRequest |
  DeleteAdventureRequest;

export type CreateAdventureRequest = {
  verb?: 'createAdventure';
  name?: string;
  description?: string;
};

export type CreateMapRequest = {
  verb?: 'createMap';
  adventureId?: string;
  name?: string;
  description?: string;
  ty?: MapType;
  ffa?: boolean;
};

export type CloneMapRequest = {
  verb?: 'cloneMap';
  adventureId?: string;
  mapId?: string;
  name?: string;
  description?: string;
};

export type ConsolidateMapChangesRequest = {
  verb?: 'consolidateMapChanges';
  adventureId?: string;
  mapId?: string;
  resync?: boolean;
};

export type InviteToAdventureRequest = {
  verb?: 'inviteToAdventure';
  adventureId?: string;
  policy?: IInviteExpiryPolicy;
};

export type JoinAdventureRequest = {
  verb?: 'joinAdventure';
  inviteId?: string;
  policy?: IInviteExpiryPolicy;
};

export type InviteExpiry = {
  timeUnit?: string;
  recreate?: string;
  expiry?: string;
  deletion?: string;
};

export type DeleteImageRequest = {
  verb?: 'deleteImage';
  path?: string;
};

export type DeleteMapRequest = {
  verb?: 'deleteMap';
  adventureId?: string;
  mapId?: string;
};

export type DeleteAdventureRequest = {
  verb?: 'deleteAdventure';
  adventureId?: string;
};

export type AddSpritesRequest = {
  verb?: 'addSprites';
  adventureId?: string;
  geometry?: string;
  sources?: string[];
};

