-- Replaces incremental BOOLEAN with seq BIGINT IDENTITY + is_base BOOLEAN +
-- nullable idempotency_key UUID. Safe on populated tables: existing rows keep
-- their per-map ordering (seq backfilled from created_at), and is_base is set
-- from the old incremental column before the column is dropped.

-- Step 1: add seq as a nullable bigint and backfill in created_at order so
-- per-map ordering survives the migration. id (uuidv7) is a strict tiebreaker.
ALTER TABLE "map_changes" ADD COLUMN "seq" bigint;--> statement-breakpoint
UPDATE "map_changes" SET "seq" = sub.rn
  FROM (
    SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS rn
    FROM "map_changes"
  ) AS sub
  WHERE "map_changes".id = sub.id;--> statement-breakpoint

-- Step 2: promote seq to NOT NULL identity, then advance the implicit
-- sequence past the backfilled max so future inserts get strictly greater
-- values. Postgres auto-names the sequence map_changes_seq_seq, which matches
-- the snapshot drizzle-kit recorded for this migration.
ALTER TABLE "map_changes" ALTER COLUMN "seq" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "map_changes" ALTER COLUMN "seq" ADD GENERATED ALWAYS AS IDENTITY (sequence name "map_changes_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1);--> statement-breakpoint
SELECT setval(
  pg_get_serial_sequence('map_changes', 'seq'),
  COALESCE((SELECT MAX(seq) FROM "map_changes"), 1),
  (SELECT MAX(seq) IS NOT NULL FROM "map_changes")
);--> statement-breakpoint

-- Step 3: add is_base (default false), backfill from incremental, then drop
-- the now-redundant incremental column. The lookup index referenced
-- incremental, so it must go first.
ALTER TABLE "map_changes" ADD COLUMN "is_base" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "map_changes" SET "is_base" = true WHERE "incremental" = false;--> statement-breakpoint
DROP INDEX "map_changes_lookup_idx";--> statement-breakpoint
ALTER TABLE "map_changes" DROP COLUMN "incremental";--> statement-breakpoint

-- Step 4: idempotency key (no backfill — only new inserts populate it).
ALTER TABLE "map_changes" ADD COLUMN "idempotency_key" uuid;--> statement-breakpoint

-- Step 5: new partial indexes and the resync CHECK. The CHECK is added after
-- the is_base backfill so pre-existing (incremental=false, resync=true) rows
-- — which are now (is_base=true, resync=true) — satisfy it.
CREATE INDEX "map_changes_map_seq_idx" ON "map_changes" USING btree ("map_id","seq") WHERE is_base = false;--> statement-breakpoint
CREATE UNIQUE INDEX "map_changes_base_idx" ON "map_changes" USING btree ("map_id") WHERE is_base = true;--> statement-breakpoint
CREATE UNIQUE INDEX "map_changes_idempotency_key_idx" ON "map_changes" USING btree ("idempotency_key") WHERE idempotency_key IS NOT NULL;--> statement-breakpoint
ALTER TABLE "map_changes" ADD CONSTRAINT "map_changes_resync_check" CHECK (resync = false OR is_base = true);
