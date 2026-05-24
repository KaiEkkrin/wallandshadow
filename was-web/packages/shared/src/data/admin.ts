import { MapType } from './map';
import { UserLevel } from './policy';

// Admin-only views of a user account, returned by the /api/admin/* routes and
// consumed by the admin search + account-info pages. All timestamps are ISO 8601
// strings: these types cross the JSON boundary and are display-only.

// One-line summary of an account, returned by the admin user search.
export interface IAdminUserSummary {
  id: string;
  email: string | null;     // null for an OIDC account Zitadel supplied no email for
  name: string;
  level: UserLevel;
  createdAt: string;        // ISO 8601
  emailVerified: boolean;
  externalId: string | null; // OIDC provider id (Zitadel sub); null for a local account
  bannedAt: string | null;  // ISO 8601 when banned; null for active accounts
}

// One adventure owned by the account.
export interface IAdminAdventureRow {
  id: string;
  name: string;
  createdAt: string;        // ISO 8601
  mapCount: number;
}

// One map inside an adventure the account owns.
export interface IAdminMapRow {
  id: string;
  name: string;
  adventureName: string;
  ty: MapType;
}

// One image owned by the account.
export interface IAdminImageRow {
  id: string;
  name: string;
  path: string;
  createdAt: string;        // ISO 8601
}

// Full admin account-info view: summary plus the three owned-content tables.
export interface IAdminUserDetail {
  summary: IAdminUserSummary;
  adventures: IAdminAdventureRow[];
  maps: IAdminMapRow[];
  images: IAdminImageRow[];
}
