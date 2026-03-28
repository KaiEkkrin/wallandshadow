import { fromSpriteGeometryString, getSpritePathFromId, ISprite, ISpritesheet } from "../data/sprite";
import { Timestamp } from "../data/types";
import { IAdminDataService } from "./extraInterfaces";
import { IDataAndReference, IDataReference, IDataService, IDataView, ILogger, IStorage, IStorageReference } from "./interfaces";

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

import { v7 as uuidv7 } from 'uuid';

const execFileAsync = promisify(execFile);

// For HttpsError.  It's a bit abstraction-breaking, but very convenient...
import * as functions from 'firebase-functions/v1';

async function createMontage(
  storage: IStorage,
  logger: ILogger,
  sources: string[],
  geometry: string,
  newSheetId: string,
  oldSheetId?: string | undefined
): Promise<IStorageReference> {
  // See https://firebase.google.com/docs/functions/gcp-storage-events for an example of the
  // kind of thing I am doing in this function.
  const tmp = os.tmpdir();
  const tmpPaths: string[] = [];
  try {
    // Download all the source files from Storage.  (This should preserve ordering)
    // TODO #46 To save bandwidth, I could try cutting out the existing images and only
    // downloading the new sprite.  This might be slower, and certainly more complicated...
    logger.logInfo("downloading: " + sources);
    const downloaded = await Promise.all(sources.map(async s => {
      if (s === "") {
        return "null:"; // the imagemagick marker for "no image here"
      }
      const tmpPath = path.join(tmp, uuidv7()); // TODO eurgh do I need file extensions?
      await storage.ref(s).download(tmpPath);
      return tmpPath;
    }));
    tmpPaths.push(...downloaded);

    // Do the montage
    const { columns, rows } = fromSpriteGeometryString(geometry);
    const tileWidth = Math.floor(1024 / columns);
    const tileHeight = Math.floor(1024 / rows);
    logger.logInfo("spawning montage");
    const tmpSheetPath = path.join(tmp, `${uuidv7()}.png`);
    await execFileAsync('montage', [
      '-geometry', `${tileWidth}x${tileHeight}`,
      '-tile', `${columns}x${rows}`,
      '-alpha', 'background',
      '-background', 'transparent',
      ...tmpPaths,
      `PNG32:${tmpSheetPath}`
    ]);
    tmpPaths.push(tmpSheetPath);

    // Upload that new spritesheet
    const spritePath = getSpritePathFromId(newSheetId);
    logger.logInfo(`uploading: ${spritePath}`);
    const sheetRef = storage.ref(spritePath);
    await sheetRef.upload(tmpSheetPath, { contentType: 'image/png' });
    return sheetRef;
  } finally {
    for (const p of tmpPaths) {
      if (p !== "null:") {
        fs.unlink(p, () => { /* nothing to do here */ });
      }
    }
  }
}

async function updateSpritesheetRefsTransaction(
  view: IDataView,
  refs: IDataReference<ISpritesheet>[],
  change: number
): Promise<void> {
  const sheets = await Promise.all(refs.map(async r => {
    const s = await view.get(r);
    return { ref: r, sheet: s };
  }));

  await Promise.all(sheets.map(async ({ ref, sheet }) => {
    if (sheet !== undefined) {
      await view.update(ref, { refs: sheet.refs + change });
    }
  }));
}

// Returns the list of old spritesheet image ids to delete.
async function completeSpritesheetsTransaction(
  view: IDataView,
  geometry: string,
  allocated: IAllocatedSprites[],
  timestampProvider: () => Timestamp | number
): Promise<string[]> {
  // Fetch all the old sheet records
  const oldSheets: { ref: IDataReference<ISpritesheet>, sheet: ISpritesheet, supersededBy: string }[] = [];
  await Promise.all(allocated.map(async a => {
    if (a.oldSheet !== undefined) {
      const oldSheet = await view.get(a.oldSheet);
      if (oldSheet !== undefined) {
        oldSheets.push({ ref: a.oldSheet, sheet: oldSheet, supersededBy: a.newSheet.id });
      }
    }
  }));

  // Add our new records
  const sg = fromSpriteGeometryString(geometry);
  await Promise.all(allocated.map(a => {
    const newSheet: ISpritesheet = {
      sprites: a.sources,
      geometry: geometry,
      freeSpaces: sg.columns * sg.rows - a.sources.length,
      date: timestampProvider(),
      supersededBy: "",
      refs: 0
    };
    return view.set(a.newSheet, newSheet);
  }));

  // Update or delete the old records as required
  const deleted: string[] = [];
  for (const { ref, sheet, supersededBy } of oldSheets) {
    const refsNow = sheet.refs - 1;
    if (refsNow === 0) {
      await view.delete(ref);
      deleted.push(ref.id);
    } else {
      await view.update(ref, { supersededBy: supersededBy, refs: refsNow });
    }
  }

  return deleted;
}

// Fetches existing spritesheets and returns (sprites we already have,
// sources not yet in a sheet.)
async function getExistingSprites(
  dataService: IAdminDataService,
  adventureId: string,
  geometry: string,
  sources: string[]
) {
  const already = await dataService.getSpritesheetsBySource(adventureId, geometry, sources);
  const found: ISprite[] = [];
  const missing: string[] = [];
  for (const s of sources) {
    const sheet = already.find(a => a.data.sprites.indexOf(s) >= 0);
    if (sheet !== undefined) {
      found.push({
        source: s,
        geometry: sheet.data.geometry
      });
    } else {
      missing.push(s);
    }
  }

  return { found: found, missing: missing };
}

interface IAllocatedSprites {
  sources: string[],
  oldSheet: IDataAndReference<ISpritesheet> | undefined,
  newSheet: IDataReference<ISpritesheet>
}

function *enumerateSheetRefs(allAllocated: IAllocatedSprites[]) {
  for (const a of allAllocated) {
    if (a.oldSheet !== undefined) {
      yield a.oldSheet;
    }
  }
}

// Allocates new sprite sources to spritesheets that can have another image
// edited into them -- or to a new spritesheet -- incrementing the refs field of
// existing sheets
async function allocateNewSpritesToSheets(
  dataService: IAdminDataService,
  logger: ILogger,
  adventureId: string,
  geometry: string,
  sources: string[]
): Promise<IAllocatedSprites[]> {
  const canExtend = await dataService.getSpritesheetsByFreeSpace(adventureId, geometry);
  logger.logInfo(`found ${canExtend.length} extendable sheets`);
  
  const toAllocate = [...sources];
  const allAllocated: IAllocatedSprites[] = [];
  for (const s of canExtend) {
    let freeSpaces = s.data.freeSpaces;
    logger.logInfo(`trying to extend ${s.id} (${freeSpaces} free)`);
    const allocated: IAllocatedSprites = {
      sources: [...s.data.sprites], oldSheet: s,
      newSheet: dataService.getSpritesheetRef(adventureId, uuidv7())
    };

    while (freeSpaces > 0) {
      const source = toAllocate.pop();
      if (source === undefined) {
        // finished :)
        break;
      }

      // Add this source to the next free space
      const gapIndex = allocated.sources.indexOf("");
      if (gapIndex >= 0) {
        allocated.sources[gapIndex] = source;
      } else {
        allocated.sources.push(source);
      }

      --freeSpaces;
    }

    allAllocated.push(allocated);
  }

  // Reference all those spritesheets so I know later whether I'm responsible for deleting them
  await dataService.runTransaction(
    tr => updateSpritesheetRefsTransaction(tr, [...enumerateSheetRefs(allAllocated)], 1)
  );

  // Allocate any remaining sprites to a new sheet
  if (toAllocate.length > 0) {
    allAllocated.push({
      sources: toAllocate, oldSheet: undefined,
      newSheet: dataService.getSpritesheetRef(adventureId, uuidv7())
    });
  }

  for (const a of allAllocated) {
    logger.logInfo(`allocated ${a.sources} to ${a.newSheet.id} (from ${a.oldSheet?.id})`);
  }

  return allAllocated;
}

// Writes our new spritesheets
async function writeNewSpritesheets(
  dataService: IDataService,
  storage: IStorage,
  logger: ILogger,
  allocated: IAllocatedSprites[],
  geometry: string,
  timestampProvider: () => Timestamp | number
): Promise<void> {
  try {
    // Create all the new montages
    await Promise.all(allocated.map(
      a => createMontage(storage, logger, a.sources, geometry, a.newSheet.id, a.oldSheet?.id)
    ));

    // Write the new records
    const toDelete = await dataService.runTransaction(
      tr => completeSpritesheetsTransaction(tr, geometry, allocated, timestampProvider)
    );

    // Delete any images we're done with
    await Promise.all(toDelete.map(i => storage.ref(getSpritePathFromId(i)).delete()));
  } catch (e) {
    // If we fail in here, we should make sure we put the refs back
    await dataService.runTransaction(
      tr => updateSpritesheetRefsTransaction(tr, [...enumerateSheetRefs(allocated)], -1)
    );
    throw e;
  }
}

async function addSpritesImpl(
  dataService: IAdminDataService,
  logger: ILogger,
  storage: IStorage,
  adventureId: string,
  geometry: string,
  sources: string[], // the image paths to make into sprites
  timestampProvider: () => Timestamp
): Promise<ISprite[]> {
  logger.logInfo(`looking for sprites: ${sources}`);
  const { found, missing } = await getExistingSprites(dataService, adventureId, geometry, sources);
  if (missing.length === 0) {
    return found;
  }

  logger.logInfo(`found ${found.length}, missing ${missing.length}`);
  const allocated = await allocateNewSpritesToSheets(dataService, logger, adventureId, geometry, missing);
  await writeNewSpritesheets(dataService, storage, logger, allocated, geometry, timestampProvider);
  for (const a of allocated) {
    found.push(...a.sources.map((s, i) => ({
      source: s,
      id: a.newSheet.id,
      geometry: geometry,
      position: i
    })));
  }

  return found;
}

// Helper functions for image manipulation, here for easy unit testing purposes.
export async function addSprites(
  dataService: IAdminDataService,
  logger: ILogger,
  storage: IStorage,
  uid: string,
  adventureId: string,
  geometry: string,
  sources: string[], // the image paths to make into sprites
  timestampProvider: () => Timestamp
): Promise<ISprite[]> {
  // Do a bit of authorization
  const adventure = await dataService.get(dataService.getAdventureRef(adventureId));
  if (adventure === undefined) {
    throw new functions.https.HttpsError('not-found', 'No such adventure');
  }

  if (adventure.owner !== uid) {
    const players = await dataService.getPlayerRefs(adventureId);
    const thisPlayer = players.find(p => p.data.playerId === uid);
    if (thisPlayer === undefined || thisPlayer.data.allowed === false) {
      throw new functions.https.HttpsError('permission-denied', 'You are not in this adventure.');
    }
  }

  if (sources.length > 10) {
    throw new functions.https.HttpsError('invalid-argument', 'Not more than 10 sources');
  }

  try {
    return await addSpritesImpl(
      dataService, logger, storage, adventureId, geometry, sources, timestampProvider
    );
  } catch (e) {
    logger.logError(`failed to add sprites ${sources}`, e);
    throw e;
  }
}