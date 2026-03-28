import { IAdventureIdentified } from "../data/identified";
import { IMap, MapType } from "../data/map";
import { getUserPolicy } from "../data/policy";
import { IProfile } from "../data/profile";
import { getTokenGeometry } from "../data/tokenGeometry";
import { IDataService, IFunctionsService, ISpriteManager } from "../services/interfaces";

import { standardColours } from "./featureColour";
import { HexGridGeometry } from "./hexGridGeometry";
import { MapStateMachine } from './mapStateMachine';
import { SquareGridGeometry } from "./squareGridGeometry";

const spacing = 75.0;
const tileDim = 12;

const hexGridGeometry = new HexGridGeometry(spacing, tileDim);
const squareGridGeometry = new SquareGridGeometry(spacing, tileDim);

const hexTokenGeometry = getTokenGeometry(MapType.Hex);
const squareTokenGeometry = getTokenGeometry(MapType.Square);

// Helps us avoid re-creating expensive resources (WebGL etc) as we navigate
// around maps, switch users etc.
export class MapLifecycleManager {
  private readonly _dataService: IDataService;
  private readonly _functionsService: IFunctionsService;
  private readonly _logError: (message: string, e: unknown) => void;
  private readonly _resolveImageUrl: (path: string) => Promise<string>;
  private readonly _uid: string;

  // We maintain a map state machine for each geometry:
  private readonly _stateMachines = new Map<MapType, MapStateMachine>();

  constructor(
    dataService: IDataService,
    functionsService: IFunctionsService,
    logError: (message: string, e: unknown) => void,
    resolveImageUrl: (path: string) => Promise<string>,
    uid: string
  ) {
    this._dataService = dataService;
    this._functionsService = functionsService;
    this._logError = logError;
    this._resolveImageUrl = resolveImageUrl;
    this._uid = uid;
  }

  get dataService() { return this._dataService; }
  get functionsService() { return this._functionsService; }
  get resolveImageUrl() { return this._resolveImageUrl; }
  get uid() { return this._uid; }

  // Gets a map state machine
  getStateMachine(
    map: IAdventureIdentified<IMap>,
    profile: IProfile,
    spriteManager: ISpriteManager
  ): MapStateMachine {
    const userPolicy = map.record.owner === this._uid ? getUserPolicy(profile.level) : undefined;
    const already = this._stateMachines.get(map.record.ty);
    if (already !== undefined) {
      already.configure(map, spriteManager, userPolicy);
      return already;
    }

    const newStateMachine = new MapStateMachine(
      this._dataService,
      map,
      this._uid,
      map.record.ty === MapType.Hex ? hexGridGeometry : squareGridGeometry,
      map.record.ty === MapType.Hex ? hexTokenGeometry : squareTokenGeometry,
      standardColours,
      userPolicy,
      this._logError,
      spriteManager,
      this._resolveImageUrl
    );
    this._stateMachines.set(map.record.ty, newStateMachine);
    return newStateMachine;
  }

  // Cleans up (call when re-creating)
  dispose() {
    this._stateMachines.forEach(sm => sm.dispose());
    this._stateMachines.clear();
  }
}