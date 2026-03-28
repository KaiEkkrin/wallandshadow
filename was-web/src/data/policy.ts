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

// This email address validation from https://ui.dev/validate-email-address-javascript/
export function emailIsValid(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export function passwordIsValid(password: string) {
  return password.length >= 8 && /[a-z]/i.test(password) && /[0-9]/.test(password);
}

// The maximum number of entries to display on the home page for each type
// (map, adventure).
export const maxProfileEntries = 7;

// Describes what permissions, caps different kinds of user have.
export enum UserLevel {
  Standard = "standard",
  Gold = "gold"
}

export interface IUserPolicy { // one per user level
  adventures: number, // cap on adventures created
  images: number, // cap on total number of images uploaded
  maps: number, // cap on maps per adventure
  players: number, // cap on players per adventure
  objects: number, // cap on objects per map
  objectsWarning: number, // soft-cap on objects per map
}

export const standardUser: IUserPolicy = {
  adventures: 3,
  images: 50,
  maps: 12,
  players: 8,
  objects: 10000,
  objectsWarning: 9000
};

export const goldUser: IUserPolicy = {
  adventures: 15,
  images: 500,
  maps: 100,
  players: 16,
  objects: 10000,
  objectsWarning: 9000
};

export function getUserPolicy(level: UserLevel): IUserPolicy {
  switch (level) {
    case UserLevel.Gold: return goldUser;
    default: return standardUser;
  }
}