DROP INDEX "adventures_owner_id_idx";--> statement-breakpoint
DROP INDEX "images_user_id_idx";--> statement-breakpoint
DROP INDEX "maps_adventure_id_idx";--> statement-breakpoint
CREATE INDEX "adventures_owner_id_idx" ON "adventures" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "images_user_id_idx" ON "images" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "maps_adventure_id_idx" ON "maps" USING btree ("adventure_id");