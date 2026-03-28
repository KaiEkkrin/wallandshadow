import {
  Firestore,
  DocumentReference,
  DocumentData,
  Transaction,
  FieldValue,
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit as limitFn,
  collectionGroup,
  onSnapshot,
  runTransaction,
  waitForPendingWrites
} from 'firebase/firestore';

import { v7 as uuidv7 } from 'uuid';

import * as Convert from '@wallandshadow/shared';
import { IDataService, IDataReference, IDataView, IDataAndReference, IChildDataReference, IAppVersion, IAdventure, IPlayer, Change, Changes, IIdentified, IImages, IInvite, IMap, IProfile, ISpritesheet } from '@wallandshadow/shared';

// Well-known collection names.
const profiles = "profiles";
const adventures = "adventures";
const images = "images";
const invites = "invites";
const maps = "maps";
const changes = "changes";
const baseChange = "base";
const players = "players";
const spritesheets = "spritesheets";

// A non-generic base data reference helps our isEqual implementation.

class DataReferenceBase {
  private readonly _dref: DocumentReference<DocumentData>;

  constructor(
    dref: DocumentReference<DocumentData>,
  ) {
    this._dref = dref;
  }

  get dref(): DocumentReference<DocumentData> {
    return this._dref;
  }

  get id(): string {
    return this._dref.id;
  }

  protected isEqualTo<T>(other: IDataReference<T>): boolean {
    // In Firebase v11, isEqual is removed - compare paths instead
    return (other instanceof DataReferenceBase) ? this._dref.path === other._dref.path : false;
  }
}

class DataReference<T> extends DataReferenceBase implements IDataReference<T> {
  private readonly _converter: Convert.IConverter<T>

  constructor(
    dref: DocumentReference<DocumentData>,
    converter: Convert.IConverter<T>
  ) {
    super(dref);
    this._converter = converter;
  }

  protected getParentDref<U>(converter: Convert.IConverter<U>): IDataReference<U> | undefined {
    const parent = this.dref.parent.parent;
    return parent ? new DataReference<U>(parent, converter) : undefined;
  }

  convert(rawData: Record<string, unknown>): T {
    return this._converter.convert(rawData);
  }

  isEqual(other: IDataReference<T>): boolean {
    return super.isEqualTo(other);
  }
}

class ChildDataReference<T, U> extends DataReference<T> implements IChildDataReference<T, U> {
  private readonly _parentConverter: Convert.IConverter<U>;

  constructor(
    dref: DocumentReference<DocumentData>,
    converter: Convert.IConverter<T>,
    parentConverter: Convert.IConverter<U>
  ) {
    super(dref, converter);
    this._parentConverter = parentConverter;
  }

  getParent(): IDataReference<U> | undefined {
    return this.getParentDref(this._parentConverter);
  }
}

// TODO #149 To avoid the nasty cobweb of inheritance, instead make DataAndReference a
// double return value (reference, data).
class DataAndReference<T> extends DataReference<T> implements IDataAndReference<T> {
  private readonly _data: DocumentData;

  constructor(
    dref: DocumentReference<DocumentData>,
    data: DocumentData,
    converter: Convert.IConverter<T>
  ) {
    super(dref, converter);
    this._data = data;
  }

  get data(): T {
    return this.convert(this._data);
  }
}

// This service is for datastore-related operations for the current user.
export class DataService implements IDataService {
  private readonly _db: Firestore;
  private readonly _timestampProvider: () => FieldValue;

  constructor(
    db: Firestore,
    timestampProvider: () => FieldValue
  ) {
    this._db = db;
    this._timestampProvider = timestampProvider;
  }

  // IDataView implementation

  delete<T>(r: IDataReference<T>): Promise<void> {
    const dref = (r as DataReference<T>).dref;
    return deleteDoc(dref);
  }

  async get<T>(r: IDataReference<T>): Promise<T | undefined> {
    const dref = (r as DataReference<T>).dref;
    const result = await getDoc(dref);
    return result.exists() ? r.convert(result.data()) : undefined;
  }

  set<T>(r: IDataReference<T>, value: T): Promise<void> {
    const dref = (r as DataReference<T>).dref;
    return setDoc(dref, value as DocumentData);
  }

  update<T>(r: IDataReference<T>, changes: Partial<T>): Promise<void> {
    const dref = (r as DataReference<T>).dref;
    return updateDoc(dref, changes as DocumentData);
  }

  // IDataService implementation

  async addChanges(adventureId: string, uid: string, mapId: string, chs: Change[]): Promise<void> {
    const changesCol = collection(this._db, adventures, adventureId, maps, mapId, changes);
    await setDoc(doc(changesCol, uuidv7()), {
      chs: chs,
      timestamp: this._timestampProvider(),
      incremental: true,
      user: uid
    });
  }

  async getAdventureMapRefs(adventureId: string): Promise<IDataAndReference<IMap>[]> {
    const mapsCol = collection(this._db, adventures, adventureId, maps);
    const m = await getDocs(mapsCol);
    return m.docs.map(d => new DataAndReference(
      d.ref, Convert.mapConverter.convert(d.data()), Convert.mapConverter
    ));
  }

  getAdventureRef(id: string): IDataReference<IAdventure> {
    const d = doc(this._db, adventures, id);
    return new DataReference<IAdventure>(d, Convert.adventureConverter);
  }

  getImagesRef(uid: string): IDataReference<IImages> {
    const d = doc(this._db, images, uid);
    return new DataReference<IImages>(d, Convert.imagesConverter);
  }

  getInviteRef(id: string): IDataReference<IInvite> {
    const d = doc(this._db, invites, id);
    return new DataReference<IInvite>(d, Convert.inviteConverter);
  }

  getMapRef(adventureId: string, id: string): IChildDataReference<IMap, IAdventure> {
    const d = doc(this._db, adventures, adventureId, maps, id);
    return new ChildDataReference<IMap, IAdventure>(d, Convert.mapConverter, Convert.adventureConverter);
  }

  getMapBaseChangeRef(adventureId: string, id: string, converter: Convert.IConverter<Changes>): IDataReference<Changes> {
    const d = doc(this._db, adventures, adventureId, maps, id, changes, baseChange);
    return new DataReference<Changes>(d, converter);
  }

  async getMapIncrementalChangesRefs(adventureId: string, id: string, limitCount: number, converter: Convert.IConverter<Changes>): Promise<IDataAndReference<Changes>[] | undefined> {
    const changesCol = collection(this._db, adventures, adventureId, maps, id, changes);
    const q = query(changesCol,
      where("incremental", "==", true),
      orderBy("timestamp"),
      limitFn(limitCount)
    );
    const s = await getDocs(q);
    return s.empty ? undefined : s.docs.map(d => new DataAndReference(d.ref, d.data(), converter));
  }

  async getMyAdventures(uid: string): Promise<IDataAndReference<IAdventure>[]> {
    const adventuresCol = collection(this._db, adventures);
    const q = query(adventuresCol, where("owner", "==", uid));
    const a = await getDocs(q);
    return a.docs.map(d => new DataAndReference(
      d.ref, Convert.adventureConverter.convert(d.data()), Convert.adventureConverter
    ));
  }

  async getMyPlayerRecords(uid: string): Promise<IDataAndReference<IPlayer>[]> {
    const playersGroup = collectionGroup(this._db, players);
    const q = query(playersGroup, where("playerId", "==", uid));
    const p = await getDocs(q);
    return p.docs.map(d => new DataAndReference(
      d.ref, Convert.playerConverter.convert(d.data()), Convert.playerConverter
    ));
  }

  getPlayerRef(adventureId: string, uid: string): IDataReference<IPlayer> {
    const d = doc(this._db, adventures, adventureId, players, uid);
    return new DataReference<IPlayer>(d, Convert.playerConverter);
  }

  async getPlayerRefs(adventureId: string): Promise<IDataAndReference<IPlayer>[]> {
    const playersCol = collection(this._db, adventures, adventureId, players);
    const s = await getDocs(playersCol);
    return s.docs.map(d => new DataAndReference(
      d.ref, Convert.playerConverter.convert(d.data()), Convert.playerConverter
    ));
  }

  getProfileRef(uid: string): IDataReference<IProfile> {
    const d = doc(this._db, profiles, uid);
    return new DataReference<IProfile>(d, Convert.profileConverter);
  }

  getVersionRef(): IDataReference<IAppVersion> {
    const d = doc(this._db, 'config', 'version');
    return new DataReference<IAppVersion>(d, Convert.appVersionConverter);
  }

  async getSpritesheetsBySource(adventureId: string, geometry: string, sources: string[]): Promise<IDataAndReference<ISpritesheet>[]> {
    const spritesheetsCol = collection(this._db, adventures, adventureId, spritesheets);
    const q = query(spritesheetsCol,
      where("geometry", "==", geometry),
      where("supersededBy", "==", ""),
      where("sprites", "array-contains-any", sources)
    );
    const s = await getDocs(q);
    return s.docs.map(d => new DataAndReference(
      d.ref, Convert.spritesheetConverter.convert(d.data()), Convert.spritesheetConverter
    ));
  }

  runTransaction<T>(fn: (dataView: IDataView) => Promise<T>): Promise<T> {
    return runTransaction(this._db, tr => {
      const tdv = new TransactionalDataView(tr);
      return fn(tdv);
    });
  }

  /**
   * Waits until all currently pending writes have been acknowledged by the backend.
   * Use this before calling Cloud Functions that need to see recent writes.
   *
   * Firestore provides strong consistency guarantees: once this Promise resolves,
   * all subsequent reads (including by Cloud Functions) will see the committed data.
   *
   * @returns Promise that resolves when all pending writes are acknowledged
   * @throws Error if user signs out during wait
   */
  waitForPendingWrites(): Promise<void> {
    return waitForPendingWrites(this._db);
  }

  watch<T>(
    d: IDataReference<T>,
    onNext: (r: T | undefined) => void,
    onError?: ((error: Error) => void) | undefined,
    onCompletion?: (() => void) | undefined
  ) {
    return onSnapshot((d as DataReference<T>).dref, s => {
      onNext(s.exists() ? d.convert(s.data()) : undefined);
    }, onError, onCompletion);
  }

  watchAdventures(
    uid: string,
    onNext: (adventuresList: IIdentified<IAdventure>[]) => void,
    onError?: ((error: Error) => void) | undefined,
    onCompletion?: (() => void) | undefined
  ) {
    const adventuresCol = collection(this._db, adventures);
    const q = query(adventuresCol, where("owner", "==", uid), orderBy("name"));
    return onSnapshot(q, s => {
      const adventuresList: IIdentified<IAdventure>[] = [];
      s.forEach((d) => {
        const data = d.data();
        if (data !== null) {
          const adventure = Convert.adventureConverter.convert(data);
          adventuresList.push({ id: d.id, record: adventure });
        }
      });
      onNext(adventuresList);
    }, onError, onCompletion);
  }

  watchChanges(
    adventureId: string,
    mapId: string,
    onNext: (chs: Changes) => void,
    onError?: ((error: Error) => void) | undefined,
    onCompletion?: (() => void) | undefined
  ) {
    const converter = Convert.createChangesConverter();
    const baseChangeRef = doc(this._db, adventures, adventureId, maps, mapId, changes, baseChange);
    const changesCol = collection(this._db, adventures, adventureId, maps, mapId, changes);
    const q = query(changesCol,
      orderBy("incremental"), // base change must always be first even if it has a later timestamp
      orderBy("timestamp")
    );
    return onSnapshot(q, s => {
      s.docChanges().forEach(d => {
        // We're interested in the following:
        // - newly added documents -- these are new changes for the map
        // - updates to the base change *only*, to act on a resync
        // In Firebase v11, isEqual is removed - compare paths instead
        if (d.doc.exists() && (d.doc.ref.path === baseChangeRef.path || d.oldIndex === -1)) {
          const chs = converter.convert(d.doc.data());
          onNext(chs);
        }
      });
    }, onError, onCompletion);
  }

  watchPlayers(
    adventureId: string,
    onNext: (playersList: IPlayer[]) => void,
    onError?: ((error: Error) => void) | undefined,
    onCompletion?: (() => void) | undefined
  ) {
    const playersCol = collection(this._db, adventures, adventureId, players);
    return onSnapshot(playersCol, s => {
      onNext(s.docs.map(d => Convert.playerConverter.convert(d.data())));
    }, onError, onCompletion);
  }

  watchSharedAdventures(
    uid: string,
    onNext: (adventuresList: IPlayer[]) => void,
    onError?: ((error: Error) => void) | undefined,
    onCompletion?: (() => void) | undefined
  ) {
    const playersGroup = collectionGroup(this._db, players);
    const q = query(playersGroup, where("playerId", "==", uid));
    return onSnapshot(q, s => {
      onNext(s.docs.map(d => Convert.playerConverter.convert(d.data())));
    }, onError, onCompletion);
  }

  watchSpritesheets(
    adventureId: string,
    onNext: (spritesheetsList: IDataAndReference<ISpritesheet>[]) => void,
    onError?: ((error: Error) => void) | undefined,
    onCompletion?: (() => void) | undefined
  ) {
    const spritesheetsCol = collection(this._db, adventures, adventureId, spritesheets);
    return onSnapshot(spritesheetsCol, s => {
      onNext(s.docs.map(d => new DataAndReference(
        d.ref, Convert.spritesheetConverter.convert(d.data()), Convert.spritesheetConverter
      )));
    }, onError, onCompletion);
  }
}

class TransactionalDataView implements IDataView {
  private _tr: Transaction;

  constructor(tr: Transaction) {
    this._tr = tr;
  }

  async delete<T>(r: IDataReference<T>): Promise<void> {
    const dref = (r as DataReference<T>).dref;
    this._tr = this._tr.delete(dref);
  }

  async get<T>(r: IDataReference<T>): Promise<T | undefined> {
    const dref = (r as DataReference<T>).dref;
    const result = await this._tr.get(dref);
    return result.exists() ? r.convert(result.data()) : undefined;
  }

  async set<T>(r: IDataReference<T>, value: T): Promise<void> {
    const dref = (r as DataReference<T>).dref;
    this._tr = this._tr.set(dref, value as DocumentData);
  }

  async update<T>(r: IDataReference<T>, changes: Partial<T>): Promise<void> {
    const dref = (r as DataReference<T>).dref;
    this._tr = this._tr.update(dref, changes as DocumentData);
  }
}