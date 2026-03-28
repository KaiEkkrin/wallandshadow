import { IMapSummary } from '../data/adventure';
import { maxProfileEntries } from '../data/policy';
import { IAdventureSummary } from '../data/profile';

// Extension helper functions shared between the web application and the Firebase Functions.

export function updateProfileAdventures(adventures: IAdventureSummary[] | undefined, changed: IAdventureSummary): IAdventureSummary[] | undefined {
  const existingIndex = adventures?.findIndex(a => a.id === changed.id) ?? -1;
  if (adventures !== undefined && existingIndex >= 0) {
    const existing = adventures[existingIndex];
    if (
      existing.name === changed.name &&
      existing.description === changed.description &&
      existing.ownerName === changed.ownerName &&
      existing.imagePath === changed.imagePath
    ) {
      // No change to make
      return undefined;
    }

    const updated = [...adventures];
    updated[existingIndex].name = changed.name;
    updated[existingIndex].description = changed.description;
    updated[existingIndex].ownerName = changed.ownerName;
    updated[existingIndex].imagePath = changed.imagePath;
    return updated;
  } else {
    const created = [changed];
    if (adventures !== undefined) {
      created.push(...adventures.slice(0, maxProfileEntries - 1));
    }

    return created;
  }
}

export function updateAdventureMaps(maps: IMapSummary[], changed: IMapSummary): IMapSummary[] {
  const existingIndex = maps?.findIndex(m => m.id === changed.id) ?? -1;
  const updated = [...maps];
  if (existingIndex >= 0) {
    updated[existingIndex].name = changed.name;
    updated[existingIndex].description = changed.description;
    updated[existingIndex].imagePath = changed.imagePath;
  } else {
    updated.push(changed);
    updated.sort((a, b) => a.name.localeCompare(b.name));
  }

  return updated;
}

export function updateProfileMaps(maps: IMapSummary[] | undefined, changed: IMapSummary): IMapSummary[] | undefined {
  const existingIndex = maps?.findIndex(m => m.id === changed.id) ?? -1;
  if (maps !== undefined && existingIndex >= 0) {
    if (
      changed.name === maps[existingIndex].name &&
      changed.description === maps[existingIndex].description &&
      changed.imagePath === maps[existingIndex].imagePath
    ) {
      // No change to make
      return undefined;
    }

    const updated = [...maps];
    updated[existingIndex].name = changed.name;
    updated[existingIndex].description = changed.description;
    updated[existingIndex].imagePath = changed.imagePath;
    return updated;
  } else {
    const created = [changed];
    if (maps !== undefined) {
      created.push(...maps.slice(0, maxProfileEntries - 1));
    }

    return created;
  }
}