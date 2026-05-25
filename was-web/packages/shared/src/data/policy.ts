export interface IInviteExpiryPolicy {
  timeUnit: 'second' | 'day'; // a dayjs time unit, see https://day.js.org/docs/en/display/difference
  recreate: number;
  expiry: number;
  deletion: number; 
}

export const defaultInviteExpiryPolicy: IInviteExpiryPolicy = {
  timeUnit: 'day',
  recreate: 1,
  expiry: 3,
  deletion: 4
};

// Equivalent to the legacy regex /^[^\s@]+@[^\s@]+\.[^\s@]+$/ but expressed as
// bounded-time string operations so static analysis can't flag it as a polynomial
// ReDOS (CodeQL js/redos): the original regex's `[^\s@]` class accepts `.`, which
// makes the dot separator and the surrounding segments overlap and backtrack.
export function emailIsValid(email: string): boolean {
  if (/\s/.test(email)) return false;
  const parts = email.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  // Domain must contain a '.' that is neither the first nor the last character,
  // matching the [^\s@]+\.[^\s@]+ requirement (each side of the dot ≥ 1 char).
  return local.length > 0 && domain.length >= 3 && domain.slice(1, -1).includes('.');
}

export function passwordIsValid(password: string) {
  return password.length >= 8 && /[a-z]/i.test(password) && /[0-9]/.test(password);
}

// The maximum number of entries to display on the home page for each type
// (map, adventure).
export const maxProfileEntries = 7;

// Describes what permissions, caps different kinds of user have.
export enum UserLevel {
  Basic = "basic",
  Higher = "higher",
  Admin = "admin"
}

export interface IUserPolicy { // one per user level
  adventures: number, // cap on adventures created
  images: number, // cap on total number of images uploaded
  maps: number, // cap on maps per adventure
  players: number, // cap on players per adventure
  objects: number, // cap on objects per map
  objectsWarning: number, // soft-cap on objects per map
}

// The Basic tier has the lowest entity and object limits and cannot upload
// images at all (images: 0). New accounts start here; an admin promotes them.
export const basicUser: IUserPolicy = {
  adventures: 2,
  images: 0,
  maps: 6,
  players: 6,
  objects: 4000,
  objectsWarning: 3600
};

export const higherUser: IUserPolicy = {
  adventures: 8,
  images: 200,
  maps: 24,
  players: 12,
  objects: 10000,
  objectsWarning: 9000
};

export const adminUser: IUserPolicy = {
  adventures: 50,
  images: 2000,
  maps: 100,
  players: 24,
  objects: 10000,
  objectsWarning: 9000
};

export function getUserPolicy(level: UserLevel): IUserPolicy {
  switch (level) {
    case UserLevel.Higher: return higherUser;
    case UserLevel.Admin: return adminUser;
    case UserLevel.Basic: return basicUser;
    // An unrecognised level (e.g. a legacy DB value) degrades to least-privilege.
    default: return basicUser;
  }
}

// True if the user's tier permits uploading images at all.
export function canUploadImages(level: UserLevel): boolean {
  return getUserPolicy(level).images > 0;
}

// True if the user is an administrator.
export function isAdmin(level: UserLevel): boolean {
  return level === UserLevel.Admin;
}