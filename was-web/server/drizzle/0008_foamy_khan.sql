-- Migrate every existing user to the Basic tier. This MUST run before the
-- CHECK constraint below: pre-existing rows hold legacy 'standard'/'gold'
-- values that would otherwise violate level IN ('basic','higher','admin').
-- Bootstrapping an admin account is a documented one-off operator step
-- (see docs/DEVELOPMENT.md) — intentionally not part of this migration.
UPDATE "users" SET "level" = 'basic';--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "level" SET DEFAULT 'basic';--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_level_check" CHECK (level IN ('basic', 'higher', 'admin'));