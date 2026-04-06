import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// Shorthand: timestamp with time zone
const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  providerSub: text('provider_sub'),                       // OIDC 'sub' claim — NULL for local users
  email: text('email'),                                     // Required for local users, cached for OIDC
  name: text('name').notNull(),
  level: text('level').notNull().default('standard'),
  passwordHash: text('password_hash'),                      // Local auth only — NULL for OIDC users
  createdAt: tstz('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('users_provider_sub_idx').on(t.providerSub).where(sql`provider_sub IS NOT NULL`),
  uniqueIndex('users_email_idx').on(t.email).where(sql`email IS NOT NULL`),
  check('users_identity_check', sql`provider_sub IS NOT NULL OR email IS NOT NULL`),
]);

export const adventures = pgTable('adventures', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  ownerId: uuid('owner_id').notNull().references(() => users.id),
  imagePath: text('image_path').notNull().default(''),
  createdAt: tstz('created_at').notNull().defaultNow(),
}, (t) => [
  index('adventures_owner_id_idx').on(t.ownerId),
  index('adventures_image_path_idx').on(t.imagePath).where(sql`image_path != ''`),
]);

export const adventurePlayers = pgTable('adventure_players', {
  adventureId: uuid('adventure_id').notNull().references(() => adventures.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id),
  playerName: text('player_name').notNull(),
  allowed: boolean('allowed').notNull().default(true),
  characters: jsonb('characters').notNull().default([]),
  joinedAt: tstz('joined_at').notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.adventureId, t.userId] }),
]);

export const maps = pgTable('maps', {
  id: uuid('id').primaryKey(),
  adventureId: uuid('adventure_id').notNull().references(() => adventures.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  ty: text('ty').notNull(),
  ffa: boolean('ffa').notNull().default(false),
  imagePath: text('image_path').notNull().default(''),
  createdAt: tstz('created_at').notNull().defaultNow(),
}, (t) => [
  index('maps_adventure_id_idx').on(t.adventureId),
  index('maps_image_path_idx').on(t.imagePath).where(sql`image_path != ''`),
]);

export const mapChanges = pgTable('map_changes', {
  id: uuid('id').primaryKey(),
  mapId: uuid('map_id').notNull().references(() => maps.id, { onDelete: 'cascade' }),
  changes: jsonb('changes').notNull(),
  incremental: boolean('incremental').notNull(),
  resync: boolean('resync').notNull().default(false),
  userId: uuid('user_id').references(() => users.id),
  createdAt: tstz('created_at').notNull().defaultNow(),
}, (t) => [
  index('map_changes_lookup_idx').on(t.mapId, t.incremental, t.createdAt),
]);

export const images = pgTable('images', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  path: text('path').notNull(),
  createdAt: tstz('created_at').notNull().defaultNow(),
}, (t) => [
  index('images_user_id_idx').on(t.userId),
]);

export const spritesheets = pgTable('spritesheets', {
  id: uuid('id').primaryKey(),
  adventureId: uuid('adventure_id').notNull().references(() => adventures.id, { onDelete: 'cascade' }),
  sprites: jsonb('sprites').notNull(),
  geometry: text('geometry').notNull(),
  freeSpaces: integer('free_spaces').notNull(),
  // Self-reference: nullable uuid (no .references() to avoid circular constraint issues with drizzle)
  supersededBy: uuid('superseded_by'),
  refs: integer('refs').notNull().default(0),
  createdAt: tstz('created_at').notNull().defaultNow(),
}, (t) => [
  index('spritesheets_adventure_geometry_idx').on(t.adventureId, t.geometry),
  index('spritesheets_sprites_gin_idx').using('gin', t.sprites),
]);

export const invites = pgTable('invites', {
  id: uuid('id').primaryKey(),
  adventureId: uuid('adventure_id').notNull().references(() => adventures.id, { onDelete: 'cascade' }),
  ownerId: uuid('owner_id').notNull().references(() => users.id),
  expiresAt: tstz('expires_at').notNull(),
  deleteAt: tstz('delete_at').notNull(),
  createdAt: tstz('created_at').notNull().defaultNow(),
});

export const appConfig = pgTable('app_config', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
});
