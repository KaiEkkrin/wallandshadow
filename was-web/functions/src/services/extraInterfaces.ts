import { IAdventure, IPlayer } from '../data/adventure';
import { IInvite } from '../data/invite';
import { IMap } from '../data/map';
import { ISpritesheet } from '../data/sprite';
import { IDataAndReference, IDataReference, IDataService, IDataView } from './interfaces';

// We extend the data service with a few things that we're only going to need
// from the Functions

export interface ICollectionGroupQueryResult<T, U> extends IDataAndReference<T> {
  getParent(): IDataReference<U> | undefined;
}

// An extension of IDataView that supports collection reads within a transaction.
// Only available when using the Admin SDK (server-side), which supports transactional
// collection queries via transaction.get(query). The web SDK does not support this.
export interface IAdminDataView extends IDataView {
  getMyAdventures(uid: string): Promise<IDataAndReference<IAdventure>[]>;
  getPlayerRefs(adventureId: string): Promise<IDataAndReference<IPlayer>[]>;
}

export interface IAdminDataService extends IDataService {
  // Runs a transaction where the view also supports collection reads (admin SDK only).
  runAdminTransaction<T>(fn: (dataView: IAdminDataView) => Promise<T>): Promise<T>;
  // Gets all the adventures with a particular image path.
  getAdventureRefsByImagePath(path: string): Promise<IDataAndReference<IAdventure>[]>;

  // Gets all spritesheets (across all maps) containing the supplied image.  (For deletion.)
  getAllSpritesheetsBySource(source: string): Promise<IDataAndReference<ISpritesheet>[]>;

  // Gets the latest invite ref for an adventure.
  getLatestInviteRef(adventureId: string): Promise<IDataAndReference<IInvite> | undefined>;

  // Gets all the maps with a particular image path.
  getMapRefsByImagePath(path: string): Promise<ICollectionGroupQueryResult<IMap, IAdventure>[]>;

  // Gets the first spritesheet that isn't full up.
  getSpritesheetsByFreeSpace(adventureId: string, geometry: string): Promise<IDataAndReference<ISpritesheet>[]>;

  // Gets a spritesheet reference.
  getSpritesheetRef(adventureId: string, id: string): IDataReference<ISpritesheet>;
}