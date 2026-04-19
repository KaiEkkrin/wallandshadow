-- Replaces incremental BOOLEAN with is_base BOOLEAN + seq BIGINT IDENTITY + idempotency_key UUID.
-- Adds advisory-lock-compatible partial indexes and a resync CHECK constraint.

ALTER TABLE "map_changes" ADD COLUMN "seq" bigint GENERATED ALWAYS AS IDENTITY NOT NULL;
--> statement-breakpoint
ALTER TABLE "map_changes" ADD COLUMN "is_base" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "map_changes" ADD COLUMN "idempotency_key" uuid;
--> statement-breakpoint

-- Backfill: mark existing base rows before dropping the incremental column.
UPDATE "map_changes" SET "is_base" = true WHERE "incremental" = false;
--> statement-breakpoint

DROP INDEX IF EXISTS "map_changes_lookup_idx";
--> statement-breakpoint
ALTER TABLE "map_changes" DROP COLUMN "incremental";
--> statement-breakpoint

-- Incremental catch-up: efficient ordered scan for a specific map.
CREATE INDEX "map_changes_map_seq_idx" ON "map_changes" ("map_id", "seq") WHERE is_base = false;
--> statement-breakpoint

-- Exactly one base change per map.
CREATE UNIQUE INDEX "map_changes_base_idx" ON "map_changes" ("map_id") WHERE is_base = true;
--> statement-breakpoint

-- Idempotent inserts: INSERT … ON CONFLICT (idempotency_key) DO NOTHING.
CREATE UNIQUE INDEX "map_changes_idempotency_key_idx" ON "map_changes" ("idempotency_key") WHERE idempotency_key IS NOT NULL;
--> statement-breakpoint

-- resync is only meaningful on the base row.
ALTER TABLE "map_changes" ADD CONSTRAINT "map_changes_resync_check" CHECK (resync = false OR is_base = true);
