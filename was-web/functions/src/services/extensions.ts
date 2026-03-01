import {
  IAdventure,
  IPlayer,
  summariseAdventure,
  IAnnotation,
  Change,
  Changes,
  SimpleChangeTracker,
  trackChanges,
  GridCoord,
  GridEdge,
  coordString,
  edgeString,
  FeatureDictionary,
  IFeature,
  ITokenDictionary,
  StripedArea,
  IdDictionary,
  IMapImage,
  IInvite,
  IMap,
  MapType,
  summariseMap,
  getUserPolicy,
  IInviteExpiryPolicy,
  IAdventureSummary,
  IProfile,
  getTokenGeometry,
  Tokens,
  SimpleTokenDrawing,
  IDataService,
  IDataView,
  IDataReference,
  IDataAndReference,
  ILogger,
  createChangesConverter,
  updateProfileAdventures,
  updateProfileMaps,
  updateAdventureMaps
} from '@wallandshadow/shared';
import { IAdminDataService, IAdminDataView } from './extraInterfaces';

import * as dayjs from 'dayjs';
import { v7 as uuidv7 } from 'uuid';

// For HttpsError.  It's a bit abstraction-breaking, but very convenient...
import * as functions from 'firebase-functions/v1';

async function createAdventureTransaction(
  view: IAdminDataView,
  profileRef: IDataReference<IProfile>,
  name: string,
  description: string,
  newAdventureRef: IDataReference<IAdventure>,
  newPlayerRef: IDataReference<IPlayer>
): Promise<void> {
  // Get this user's level from their profile
  const profile = await view.get(profileRef);
  if (profile === undefined) {
    throw new functions.https.HttpsError('permission-denied', 'No profile available');
  }

  // Fetch the current adventure count inside the transaction so the policy check
  // is atomic with the creation write (prevents concurrent calls bypassing the cap).
  const currentAdventures = await view.getMyAdventures(profileRef.id);
  const policy = getUserPolicy(profile.level);
  if (currentAdventures.length >= policy.adventures) {
    throw new functions.https.HttpsError('permission-denied', 'You already have the maximum number of adventures.');
  }

  // OK, we're good -- go about doing the creation
  const record: IAdventure = {
    name: name,
    description: description,
    owner: profileRef.id,
    ownerName: profile.name,
    maps: [],
    imagePath: ""
  };

  await view.set(newAdventureRef, record);
  await view.set(newPlayerRef, {
    ...record,
    id: newAdventureRef.id,
    playerId: profileRef.id,
    playerName: profile.name,
    allowed: true,
    characters: []
  });

  // Add it to the user's profile as a recent adventure
  const adventures = updateProfileAdventures(profile.adventures, summariseAdventure(newAdventureRef.id, record));
  if (adventures !== undefined) {
    await view.update(profileRef, { adventures: adventures });
  }
}

export async function createAdventure(dataService: IAdminDataService, uid: string, name: string, description: string): Promise<string> {
  // Refs for the new adventure and the owner's player record.
  // The adventure count check and creation happen atomically inside the transaction.
  const profileRef = dataService.getProfileRef(uid);
  const id = uuidv7();
  const newAdventureRef = dataService.getAdventureRef(id);
  const newPlayerRef = dataService.getPlayerRef(id, uid);
  await dataService.runAdminTransaction(tr => createAdventureTransaction(
    tr, profileRef, name, description, newAdventureRef, newPlayerRef
  ));

  return id;
}

async function createMapTransaction(
  view: IDataView,
  profileRef: IDataReference<IProfile>,
  adventureRef: IDataReference<IAdventure>,
  newMapRef: IDataReference<IMap>,
  newMapRecord: IMap,
  newBaseChangeRef?: IDataReference<Changes> | undefined,
  changes?: Changes | undefined
): Promise<void> {
  // Fetch things
  const profile = await view.get(profileRef);
  if (profile === undefined) {
    throw new functions.https.HttpsError('permission-denied', 'No profile available');
  }

  const adventure = await view.get(adventureRef);
  if (adventure === undefined) {
    throw new functions.https.HttpsError('invalid-argument', 'No such adventure');
  }

  // Check the caller owns this adventure
  if (profileRef.id !== adventure.owner) {
    throw new functions.https.HttpsError('permission-denied', 'You do not own this adventure');
  }

  // Check they haven't exceeded their map quota in this adventure
  const policy = getUserPolicy(profile.level);
  if (adventure.maps.length >= policy.maps) {
    throw new functions.https.HttpsError('permission-denied', 'You already have the maximum number of maps in this adventure.');
  }

  // If we reach here we can safely create that map:
  const record: IMap = {
    ...newMapRecord,
    adventureName: adventure.name,
    owner: profileRef.id
  };
  await view.set(newMapRef, record);

  // Update the adventure record to include this map
  const summary = summariseMap(adventureRef.id, newMapRef.id, record);
  const allMaps = updateAdventureMaps(adventure.maps, summary);
  await view.update(adventureRef, { maps: allMaps });

  // Update the profile to include this map
  const latestMaps = updateProfileMaps(profile.latestMaps, summary);
  if (latestMaps !== undefined) {
    await view.update(profileRef, { latestMaps: latestMaps });
  }

  // If an initial base change was supplied, add it now
  if (newBaseChangeRef !== undefined && changes !== undefined) {
    await view.set(newBaseChangeRef, changes);
  }
}

export async function createMap(
  dataService: IDataService,
  uid: string,
  adventureId: string,
  name: string,
  description: string,
  ty: MapType,
  ffa: boolean
): Promise<string> {
  // I'll need to edit the user's profile and the adventure record as well as
  // create the map itself:
  const profileRef = dataService.getProfileRef(uid);
  const adventureRef = dataService.getAdventureRef(adventureId);

  const id = uuidv7();
  const newMapRef = dataService.getMapRef(adventureId, id);
  await dataService.runTransaction(tr => createMapTransaction(
    tr, profileRef, adventureRef, newMapRef, {
      adventureName: "", // to be replaced by the transaction
      owner: uid,
      name: name,
      description: description,
      ty: ty,
      ffa: ffa,
      imagePath: ""
    }
  ));

  return id;
}

// Clones a map as a new map (by the same user, in the same adventure, for now.)
export async function cloneMap(
  dataService: IDataService,
  logger: ILogger,
  timestampProvider: () => FirebaseFirestore.FieldValue,
  uid: string,
  adventureId: string,
  mapId: string,
  name: string,
  description: string
): Promise<string> {
  // I'll need to edit the user's profile and the adventure record as well as
  // create the map itself:
  const profileRef = dataService.getProfileRef(uid);
  const adventureRef = dataService.getAdventureRef(adventureId);
  const existingMapRef = dataService.getMapRef(adventureId, mapId);

  const id = uuidv7();
  const newMapRef = dataService.getMapRef(adventureId, id);

  const existingMap = await dataService.get(existingMapRef);
  if (existingMap === undefined) {
    throw new functions.https.HttpsError('not-found', 'Existing map not found.');
  }

  // We're going to need the consolidated base change from the existing map:
  const baseChange = await consolidateMapChanges(
    dataService, logger, timestampProvider, adventureId, mapId, existingMap, false
  );

  // Now we can create the new map:
  const converter = createChangesConverter();
  const baseChangeRef = dataService.getMapBaseChangeRef(adventureId, id, converter);
  await dataService.runTransaction(
    tr => createMapTransaction(tr, profileRef, adventureRef, newMapRef, {
      ...existingMap,
      name: name,
      description: description
    }, baseChangeRef, baseChange)
  );

  return id;
}

interface IConsolidateMapChangesResult {
  baseChange: Changes | undefined,
  isNew: boolean // true if we wrote something, false if we just returned what was already there
}

async function consolidateMapChangesTransaction(
  view: IDataView,
  logger: ILogger,
  timestampProvider: () => FirebaseFirestore.FieldValue | number,
  baseChange: Changes | undefined,
  baseChangeRef: IDataReference<Changes>,
  incrementalChanges: IDataAndReference<Changes>[],
  consolidated: Change[],
  uid: string,
  resync: boolean
): Promise<IConsolidateMapChangesResult> {
  // Check that the base change hasn't changed since we did the query.
  // If it has, we'll simply abort -- someone else has done this recently
  const latestBaseChange = await view.get(baseChangeRef);
  if (baseChange !== undefined && latestBaseChange !== undefined) {
    if (
      typeof(latestBaseChange.timestamp) !== 'number' ||
      typeof(baseChange.timestamp) !== 'number'
    ) {
      // This should be fine, because they shouldn't be mixed within one application;
      // real application always uses the firestore field value, tests always use number
      const latestTimestamp = latestBaseChange.timestamp as FirebaseFirestore.FieldValue;
      const baseTimestamp = baseChange.timestamp as FirebaseFirestore.FieldValue;
      if (!latestTimestamp.isEqual(baseTimestamp)) {
        logger.logWarning("Map changes for " + baseChangeRef.id + " have already been consolidated");
        return { baseChange: latestBaseChange, isNew: false };
      }
    } else {
      if (latestBaseChange.timestamp !== baseChange.timestamp) {
        logger.logWarning("Map changes for " + baseChangeRef.id + " have already been consolidated");
        return { baseChange: latestBaseChange, isNew: false };
      }
    }
  }

  // Update the base change
  const newBaseChange = {
    chs: consolidated,
    timestamp: timestampProvider(),
    incremental: false,
    user: uid,
    resync: resync
  };
  await view.set<Changes>(baseChangeRef, newBaseChange);

  // Delete all the others
  await Promise.all(incrementalChanges.map(c => view.delete(c)));
  return { baseChange: newBaseChange, isNew: true };
}

// If the `isNew` field of the return value is false, we've finished -- otherwise, there is more
// to be done.
async function tryConsolidateMapChanges(
  dataService: IDataService,
  logger: ILogger,
  timestampProvider: () => FirebaseFirestore.FieldValue | number,
  adventureId: string,
  mapId: string,
  m: IMap,
  resync: boolean,
  syncChanges?: (tokenDict: ITokenDictionary) => void
): Promise<IConsolidateMapChangesResult> {
  // Fetch all the current changes for this map, along with their refs.
  // It's important to use the same converter for the base and incremental changes so that any
  // legacy maps with the same kinds of context-dependent things needing converting in both get
  // rolled through properly.
  const converter = createChangesConverter();
  const baseChangeRef = await dataService.getMapBaseChangeRef(adventureId, mapId, converter);
  const baseChange = await dataService.get(baseChangeRef); // undefined in case of the first consolidate
  const incrementalChanges = await dataService.getMapIncrementalChangesRefs(adventureId, mapId, 499, converter);
  if (incrementalChanges === undefined || incrementalChanges.length === 0) {
    // No changes to consolidate
    return { baseChange: baseChange, isNew: false };
  }

  // Fetch the map owner's profile so I can figure out their user policy
  const ownerProfile = await dataService.get(dataService.getProfileRef(m.owner));
  if (ownerProfile === undefined) {
    throw new functions.https.HttpsError('invalid-argument', 'No profile found for map owner');
  }

  // Consolidate all of that.
  // #64: I'm no longer including a map colouring here.  It's a bit unsafe (a player could
  // technically cheat and non-owners would believe them), but it will save huge amounts of
  // CPU time (especially valuable if this is going to be called in a Firebase Function.)
  const ownerPolicy = getUserPolicy(ownerProfile.level);
  const tokenDict = new Tokens(getTokenGeometry(m.ty), new SimpleTokenDrawing());
  const outlineTokenDict = new Tokens(getTokenGeometry(m.ty), new SimpleTokenDrawing());
  const tracker = new SimpleChangeTracker(
    new FeatureDictionary<GridCoord, StripedArea>(coordString),
    new FeatureDictionary<GridCoord, StripedArea>(coordString),
    tokenDict,
    outlineTokenDict,
    new FeatureDictionary<GridEdge, IFeature<GridEdge>>(edgeString),
    new FeatureDictionary<GridCoord, IAnnotation>(coordString),
    new IdDictionary<IMapImage>(),
    ownerPolicy
    // new MapColouring(m.ty === MapType.Hex ? new HexGridGeometry(1, 1) : new SquareGridGeometry(1, 1))
  );
  if (baseChange !== undefined) {
    trackChanges(m, tracker, baseChange.chs, baseChange.user);
  }

  // If any of the incremental changes fail we should mark this as a resync, because our
  // clients might be confused
  let isResync = resync;
  incrementalChanges.forEach(c => {
    const success = trackChanges(m, tracker, c.data.chs, c.data.user)
    if (success === false) {
      isResync = true;
    }
  });

  // Make any synchronous changes at this point
  syncChanges?.(tokenDict);
  const consolidated = tracker.getConsolidated();

  // Apply it
  return await dataService.runTransaction(view =>
    consolidateMapChangesTransaction(
      view, logger, timestampProvider, baseChange, baseChangeRef, incrementalChanges ?? [], consolidated, m.owner, isResync
    )
  );
}

export async function consolidateMapChanges(
  dataService: IDataService,
  logger: ILogger,
  timestampProvider: () => FirebaseFirestore.FieldValue,
  adventureId: string,
  mapId: string,
  m: IMap,
  resync: boolean,
  syncChanges?: (tokenDict: ITokenDictionary) => void
): Promise<Changes | undefined> {
  // Because we can consolidate at most 499 changes in one go due to the write limit,
  // we do this in a loop until we can't find any more.
  // The guard prevents an infinite loop if the transaction never converges.
  const maxIterations = 20;
  for (let i = 0; i < maxIterations; ++i) {
    const result = await tryConsolidateMapChanges(
      dataService, logger, timestampProvider, adventureId, mapId, m, resync, syncChanges
    );
    if (result.isNew === false) {
      return result.baseChange;
    }
  }
  throw new functions.https.HttpsError(
    'resource-exhausted',
    `Map ${mapId} consolidation did not converge after ${maxIterations} iterations`
  );
}

// Checks whether this invite is still in date; deletes super-out-of-date ones.
async function isValidInvite(
  dataService: IDataService,
  invite: IDataAndReference<IInvite>,
  policy: IInviteExpiryPolicy
): Promise<boolean> {
  if (typeof(invite.data.timestamp) === 'number') {
    return true;
  }

  const inviteDate = dayjs.default((invite.data.timestamp as FirebaseFirestore.Timestamp).toDate());
  const age = dayjs.default().diff(inviteDate, policy.timeUnit);
  if (age >= policy.deletion) {
    try {
      await dataService.delete(invite);
    } catch (e) {
      // It's going to be really hard to diagnose this one...
      functions.logger.error("Failed to delete expired invite " + invite.id, e);
    }
  }

  // We check for the recreate date not the actual expiry, checked by `joinAdventure`.
  // This is because we want to create new invites a bit before then to avoid expired
  // ones knocking around too much!
  return age <= policy.recreate;
}

// Either creates an invite record for an adventure and returns it, or returns
// the existing one if it's still valid.  Returns the invite ID.
export async function inviteToAdventure(
  dataService: IAdminDataService,
  timestampProvider: () => FirebaseFirestore.FieldValue,
  adventure: IAdventureSummary,
  policy: IInviteExpiryPolicy
): Promise<string | undefined> {
  // Fetch any current invite
  const latestInvite = await dataService.getLatestInviteRef(adventure.id);
  if (latestInvite !== undefined && (await isValidInvite(dataService, latestInvite, policy)) === true) {
    return latestInvite.id;
  }

  // If we couldn't, make a new one and return that
  const id = uuidv7();
  const inviteRef = dataService.getInviteRef(id);
  await dataService.set(inviteRef, {
    adventureId: adventure.id,
    adventureName: adventure.name,
    owner: adventure.owner,
    ownerName: adventure.ownerName,
    timestamp: timestampProvider()
  });

  return id;
}

async function joinAdventureTransaction(
  view: IAdminDataView,
  adventureRef: IDataReference<IAdventure>,
  playerRef: IDataReference<IPlayer>,
  profileRef: IDataReference<IProfile>,
  ownerProfileRef: IDataReference<IProfile>
): Promise<string> {
  const ownerProfile = await view.get(ownerProfileRef);
  if (ownerProfile === undefined) {
    throw new functions.https.HttpsError('not-found', 'No profile for the adventure owner');
  }

  // Fetch current players inside the transaction so the cap check is atomic with
  // the player creation write (prevents concurrent joins from bypassing the limit).
  const otherPlayers = await view.getPlayerRefs(adventureRef.id);

  // When counting joined players, blocked ones don't count.
  const ownerPolicy = getUserPolicy(ownerProfile.level);
  if (otherPlayers.filter(p => p.data.allowed !== false).length >= ownerPolicy.players) {
    throw new functions.https.HttpsError('permission-denied', 'This adventure already has the maximum number of players');
  }

  const adventure = await view.get(adventureRef);
  if (adventure === undefined) {
    throw new functions.https.HttpsError('not-found', 'No such adventure');
  }

  const profile = await view.get(profileRef);
  if (profile === undefined) {
    throw new functions.https.HttpsError('not-found', 'No profile for this user');
  }

  // Create or update the player record, and return that
  const player = await view.get(playerRef);
  if (player === undefined) {
    // remember this is an adventure summary plus player details
    const newPlayer: IPlayer = {
      ...summariseAdventure(adventureRef.id, adventure),
      playerId: playerRef.id,
      playerName: profile.name,
      allowed: true,
      characters: []
    };
    await view.set<IPlayer>(playerRef, newPlayer);
  } else {
    // Update that record in case there are changes
    if (
      player.name !== adventure.name ||
      player.description !== adventure.description ||
      player.ownerName !== adventure.ownerName ||
      player.imagePath !== adventure.imagePath ||
      player.playerName !== profile.name
    ) {
      player.name = adventure.name;
      player.description = adventure.description;
      player.ownerName = adventure.ownerName;
      player.imagePath = adventure.imagePath;
      player.playerName = profile.name;
      await view.update(playerRef, {
        name: adventure.name,
        description: adventure.description,
        ownerName: adventure.ownerName,
        imagePath: adventure.imagePath,
        playerName: profile.name
      });
    }
  }

  // Make this a recent adventure in the user's profile
  const adventures = updateProfileAdventures(profile.adventures, summariseAdventure(adventureRef.id, adventure));
  if (adventures !== undefined) {
    await view.update(profileRef, { adventures: adventures });
  }

  return adventureRef.id;
}

async function deleteMapTransaction(
  view: IAdminDataView,
  profileRef: IDataReference<IProfile>,
  adventureRef: IDataReference<IAdventure>,
  mapRef: IDataReference<IMap>,
  mapId: string
): Promise<void> {
  const adventure = await view.get(adventureRef);
  if (adventure === undefined) {
    throw new functions.https.HttpsError('not-found', 'Adventure not found');
  }

  if (adventure.owner !== profileRef.id) {
    throw new functions.https.HttpsError('permission-denied', 'Only the adventure owner can delete maps');
  }

  const profile = await view.get(profileRef);

  // Update the profile to omit this map
  if (profile?.latestMaps?.find(m => m.id === mapId) !== undefined) {
    await view.update(profileRef, { latestMaps: profile.latestMaps.filter(m => m.id !== mapId) });
  }

  // Update the adventure record to omit this map
  await view.update(adventureRef, { maps: adventure.maps.filter(m => m.id !== mapId) });

  // Delete the map document itself
  await view.delete(mapRef);
}

export async function deleteMap(
  dataService: IAdminDataService,
  uid: string,
  adventureId: string,
  mapId: string
): Promise<void> {
  const profileRef = dataService.getProfileRef(uid);
  const adventureRef = dataService.getAdventureRef(adventureId);
  const mapRef = dataService.getMapRef(adventureId, mapId);

  // Atomically remove from profile/adventure and delete the map document
  await dataService.runAdminTransaction(view =>
    deleteMapTransaction(view, profileRef, adventureRef, mapRef, mapId)
  );

  // Clean up the changes subcollection (cannot be done in a transaction)
  await dataService.recursiveDeleteMap(adventureId, mapId);
}

async function deleteAdventureTransaction(
  view: IAdminDataView,
  profileRef: IDataReference<IProfile>,
  adventureRef: IDataReference<IAdventure>,
  mapIds: string[]
): Promise<void> {
  const adventure = await view.get(adventureRef);
  if (adventure === undefined) {
    // Already deleted — nothing to do
    return;
  }

  if (adventure.owner !== profileRef.id) {
    throw new functions.https.HttpsError('permission-denied', 'Only the owner can delete this adventure');
  }

  const profile = await view.get(profileRef);
  if (profile !== undefined) {
    const mapIdSet = new Set(mapIds);
    const updatedAdventures = (profile.adventures ?? []).filter(a => a.id !== adventureRef.id);
    const updatedMaps = (profile.latestMaps ?? []).filter(m => !mapIdSet.has(m.id));
    await view.update(profileRef, { adventures: updatedAdventures, latestMaps: updatedMaps });
  }
}

export async function deleteAdventure(
  dataService: IAdminDataService,
  uid: string,
  adventureId: string
): Promise<void> {
  const adventureRef = dataService.getAdventureRef(adventureId);

  // Read adventure outside transaction to get map IDs and verify ownership
  const adventure = await dataService.get(adventureRef);
  if (adventure === undefined) {
    throw new functions.https.HttpsError('not-found', 'Adventure not found');
  }

  if (adventure.owner !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'Only the owner can delete this adventure');
  }

  const mapIds = adventure.maps.map(m => m.id);
  const profileRef = dataService.getProfileRef(uid);

  // Atomically remove adventure and all its maps from the owner's profile
  await dataService.runAdminTransaction(view =>
    deleteAdventureTransaction(view, profileRef, adventureRef, mapIds)
  );

  // Delete the adventure document and all subcollections (maps, changes, players, spritesheets)
  await dataService.recursiveDeleteAdventure(adventureId);
}

export async function joinAdventure(
  dataService: IAdminDataService,
  uid: string,
  inviteId: string,
  policy: IInviteExpiryPolicy
): Promise<string> {
  const inviteRef = dataService.getInviteRef(inviteId);
  const profileRef = dataService.getProfileRef(uid);

  // We need to fetch and verify the invite so that we can get the adventure id.
  // These reads are outside the transaction because they don't conflict with any
  // writes (the invite is not modified by joining) and their freshness is not critical.
  const invite = await dataService.get(inviteRef);
  if (invite === undefined) {
    throw new functions.https.HttpsError('not-found', 'No such invite');
  }

  if (typeof(invite.timestamp) !== 'number') {
    const inviteDate = dayjs.default((invite.timestamp as FirebaseFirestore.Timestamp).toDate());
    const age = dayjs.default().diff(inviteDate, policy.timeUnit);
    if (age >= policy.expiry) {
      throw new functions.https.HttpsError('deadline-exceeded', 'Invite has expired');
    }
  }

  const adventureRef = dataService.getAdventureRef(invite.adventureId);
  const playerRef = dataService.getPlayerRef(invite.adventureId, uid);

  const adventure = await dataService.get(adventureRef);
  if (adventure === undefined) {
    throw new functions.https.HttpsError('not-found', 'No such adventure');
  }

  const ownerProfileRef = dataService.getProfileRef(adventure.owner);

  // The player count check and the player creation write both happen inside the
  // transaction, so the cap cannot be bypassed by concurrent joins.
  return await dataService.runAdminTransaction(tr => joinAdventureTransaction(
    tr, adventureRef, playerRef, profileRef, ownerProfileRef
  ));
}