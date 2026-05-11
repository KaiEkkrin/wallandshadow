import { BehaviorSubject, Observable } from 'rxjs';
import type { IMapSummary } from '@wallandshadow/shared';
import { maxProfileEntries } from '@wallandshadow/shared';

// Recently-loaded maps live in localStorage, scoped per uid + per device.
// In-tab subscribers see updates immediately via the per-uid BehaviorSubject.

function storageKey(uid: string): string {
  return `was_hono_latest_maps_${uid}`;
}

function readFromStorage(uid: string): IMapSummary[] {
  try {
    const raw = localStorage.getItem(storageKey(uid));
    return raw ? (JSON.parse(raw) as IMapSummary[]) : [];
  } catch {
    return [];
  }
}

function writeToStorage(uid: string, maps: IMapSummary[]): void {
  localStorage.setItem(storageKey(uid), JSON.stringify(maps.slice(0, maxProfileEntries)));
}

const subjects = new Map<string, BehaviorSubject<IMapSummary[]>>();

function subjectFor(uid: string): BehaviorSubject<IMapSummary[]> {
  let subject = subjects.get(uid);
  if (!subject) {
    subject = new BehaviorSubject<IMapSummary[]>(readFromStorage(uid));
    subjects.set(uid, subject);
  }
  return subject;
}

function update(uid: string, fn: (current: IMapSummary[]) => IMapSummary[]): void {
  const subject = subjectFor(uid);
  const next = fn(subject.value).slice(0, maxProfileEntries);
  writeToStorage(uid, next);
  subject.next(next);
}

export function readRecentMaps(uid: string): IMapSummary[] {
  return subjectFor(uid).value;
}

export function recentMaps$(uid: string): Observable<IMapSummary[]> {
  return subjectFor(uid).asObservable();
}

export function markMapRecent(uid: string, summary: IMapSummary): void {
  update(uid, (current) => {
    const existingIndex = current.findIndex(m => m.id === summary.id);
    if (existingIndex >= 0) {
      const unchanged =
        current[existingIndex].name === summary.name &&
        current[existingIndex].description === summary.description &&
        current[existingIndex].imagePath === summary.imagePath;
      if (unchanged) return current;
      const updated = [...current];
      updated[existingIndex] = { ...updated[existingIndex], ...summary };
      return updated;
    }
    return [summary, ...current];
  });
}

export function forgetMap(uid: string, mapId: string): void {
  update(uid, (current) => {
    const next = current.filter(m => m.id !== mapId);
    return next.length === current.length ? current : next;
  });
}
