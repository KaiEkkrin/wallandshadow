import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';

// Shorthand: timestamp with time zone
const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  providerSub: text('provider_sub').unique().notNull(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  level: text('level').notNull().default('standard'),
  // Temporary Phase 1 auth — replaced by OIDC in Phase 2
  passwordHash: text('password_hash'),
  createdAt: tstz('created_at').notNull().defaultNow(),
}, (t) => [
  index('users_email_idx').on(t.email),
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
