ALTER TABLE "users" DROP CONSTRAINT "users_provider_sub_unique";--> statement-breakpoint
DROP INDEX "users_email_idx";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "provider_sub" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "adventures_image_path_idx" ON "adventures" USING btree ("image_path") WHERE image_path != '';--> statement-breakpoint
CREATE INDEX "maps_image_path_idx" ON "maps" USING btree ("image_path") WHERE image_path != '';--> statement-breakpoint
CREATE INDEX "spritesheets_sprites_gin_idx" ON "spritesheets" USING gin ("sprites");--> statement-breakpoint
CREATE UNIQUE INDEX "users_provider_sub_idx" ON "users" USING btree ("provider_sub") WHERE provider_sub IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email") WHERE email IS NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_identity_check" CHECK (provider_sub IS NOT NULL OR email IS NOT NULL);