DROP INDEX "adventures_owner_id_idx";--> statement-breakpoint
DROP INDEX "images_user_id_idx";--> statement-breakpoint
DROP INDEX "maps_adventure_id_idx";--> statement-breakpoint
ALTER TABLE "adventures" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "images" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "maps" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "banned_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "adventures_owner_id_idx" ON "adventures" USING btree ("owner_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "images_user_id_idx" ON "images" USING btree ("user_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "maps_adventure_id_idx" ON "maps" USING btree ("adventure_id") WHERE deleted_at IS NULL;