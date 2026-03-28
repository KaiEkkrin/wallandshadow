import { IAdventure } from '../data/adventure';
import { IImage, IImages } from '../data/image';
import { IMap } from '../data/map';
import { getUserPolicy } from '../data/policy';
import { IProfile } from '../data/profile';
import { IAdminDataService, ICollectionGroupQueryResult } from './extraInterfaces';
import { IDataService, IDataReference, IDataView, ILogger, IStorage, IDataAndReference } from './interfaces';

import fluent from 'fluent-iterable';

// For HttpsError.  It's a bit abstraction-breaking, but very convenient...
import * as functions from 'firebase-functions/v1';

function getImageUid(path: string): string | undefined {
  // Extract the uid from the path.  We rely on the Storage security rules to have
  // enforced that uid
  // The leading / character is optional
  const result = /^\/?images\/([^\/]+)\/([^\/]+)/.exec(path);
  return result ? result[1] : undefined;
}

async function addImageTransaction(
  view: IDataView,
  name: string,
  path: string,
  imagesRef: IDataReference<IImages>,
  profileRef: IDataReference<IProfile>
): Promise<boolean> {
  // Fetch the current images record
  const images = await view.get(imagesRef);
  const imageCount = images?.images.length ?? 0;

  async function completeWithError(error: string) {
    if (images !== undefined) {
      await view.update(imagesRef, { lastError: error });
    } else {
      const newImages: IImages = {
        images: [],
        lastError: error
      };
      await view.set(imagesRef, newImages);
    }

    return false;
  }

  // Fetch the user's profile, to check whether they can add any more images
  const profile = await view.get(profileRef);
  if (profile === undefined) {
    return await completeWithError("No profile found");
  }

  const userPolicy = getUserPolicy(profile.level);
  if (imageCount >= userPolicy.images) {
    return await completeWithError("You have too many images; delete one to upload another.");
  }

  // Add the new image to the front of the list
  const newImage: IImage = { name: name, path: path };
  if (images !== undefined) {
    await view.update(imagesRef, { images: [newImage, ...images.images], lastError: "" });
  } else {
    const newImages: IImages = { images: [newImage], lastError: "" };
    await view.set(imagesRef, newImages);
  }

  return true;
}

// Adds an image.
// If we return false, the add wasn't successful -- delete the uploaded image.
export async function addImage(
  dataService: IDataService,
  storage: IStorage,
  logger: ILogger,
  name: string,
  path: string
): Promise<boolean> {
  const uid = getImageUid(path);
  if (!uid) {
    logger.logWarning("Found image with unrecognised path: " + path);
    return false;
  }

  const imagesRef = dataService.getImagesRef(uid);
  const profileRef = dataService.getProfileRef(uid);
  try {
    const ok = await dataService.runTransaction(tr => addImageTransaction(tr, name, path, imagesRef, profileRef));
    if (!ok) {
      logger.logInfo(`Add ${path} reported an error -- deleting`);
      await storage.ref(path).delete();
    }
    return ok;
  } catch (e) {
    logger.logWarning(`Error on add ${path} -- deleting`, e);
    await storage.ref(path).delete();
    return false;
  }
}

function *enumerateMapAdventureRefs(
  mapRefs: ICollectionGroupQueryResult<IMap, IAdventure>[],
  except: IDataAndReference<IAdventure>[]
) {
  for (const m of mapRefs) {
    const a = m.getParent();
    if (!a) {
      continue;
    }

    if (except.find(a2 => a2.isEqual(a))) {
      continue;
    }

    yield a;
  }
}

async function deleteImageTransaction(
  view: IDataView,
  imagesRef: IDataReference<IImages>,
  adventureRefs: IDataAndReference<IAdventure>[],
  mapRefs: ICollectionGroupQueryResult<IMap, IAdventure>[],
  path: string
) {
  // Fetch all those adventures and maps again to make sure we're not trampling on a
  // subsequent map assignment
  const adventures = await Promise.all(adventureRefs.map(async a => {
    const adventure = await view.get(a);
    return { r: a, record: adventure };
  }));

  const maps = await Promise.all(mapRefs.map(async m => {
    const map = await view.get(m);
    return { r: m, record: map };
  }));

  // For each map, we need to fetch its matching adventure record, if we didn't already
  const mapAdventures = await Promise.all(
    fluent(enumerateMapAdventureRefs(mapRefs, adventureRefs)).map(async a => {
      const adventure = await view.get(a);
      return { r: a, record: adventure };
    })
  );

  // Remove this image from the images list
  const images = await view.get(imagesRef);
  if (images !== undefined) {
    const updatedImages = images.images.filter(i => i.path !== path);
    await view.update(imagesRef, { images: updatedImages });
  }

  // For each adventure, remove this image from its own image path, and remove it from
  // any maps that have it
  await Promise.all(adventures.map(async a => {
    if (!a.record) {
      return;
    }

    const updatedMaps = a.record.maps.map(m => m.imagePath === path ? { ...m, imagePath: "" } : m);
    await view.update(a.r, {
      maps: updatedMaps,
      imagePath: a.record.imagePath === path ? "" : path
    });
  }));

  // For each map record, remove this image
  await Promise.all(maps.map(async m => {
    if (m.record?.imagePath === path) {
      await view.update(m.r, { imagePath: "" });
    }
  }));

  // For each of the map adventure records that didn't appear in our main list of
  // adventure hits, remove this image from any maps
  await Promise.all(mapAdventures.map(async a => {
    if (!a.record) {
      return;
    }

    const updatedMaps = a.record.maps.map(m => m.imagePath === path ? { ...m, imagePath: "" } : m);
    await view.update(a.r, { maps: updatedMaps });
  }));
}

// Deletes an image.
export async function deleteImage(
  dataService: IAdminDataService,
  storage: IStorage,
  logger: ILogger,
  uid: string,
  path: string
): Promise<void> {
  const pathUid = getImageUid(path);
  if (!pathUid || pathUid !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'This image path corresponds to a different user id');
  }

  // We don't bother with profile and players here, because they will be naturally updated
  // by their user while navigating the UI.  I can add the functionality if it turns out
  // that the image being suddenly absent is a really bad experience.
  const images = dataService.getImagesRef(uid);
  const adventures = await dataService.getAdventureRefsByImagePath(path);
  const maps = await dataService.getMapRefsByImagePath(path);

  await dataService.runTransaction(
    tr => deleteImageTransaction(tr, images, adventures, maps, path)
  );

  // Remove this image from any spritesheets that have it, leaving a gap that could be
  // re-used by something else.
  // These can be done as separate transactions, which should reduce the database load
  const ss = await dataService.getAllSpritesheetsBySource(path);
  await Promise.all(ss.map(r => dataService.runTransaction(async tr => {
    const ss2 = await tr.get(r);
    if (ss2 !== undefined) {
      await tr.update(r, { sprites: ss2.sprites.map(s => s === path ? "" : s) });
    }
  })));

  await storage.ref(path).delete();
}