CREATE INDEX "adventures_owner_id_idx" ON "adventures" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "images_user_id_idx" ON "images" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "maps_adventure_id_idx" ON "maps" USING btree ("adventure_id");--> statement-breakpoint
CREATE INDEX "spritesheets_adventure_geometry_idx" ON "spritesheets" USING btree ("adventure_id","geometry");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");