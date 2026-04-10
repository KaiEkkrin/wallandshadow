DROP INDEX "users_email_idx";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_local_idx" ON "users" USING btree ("email") WHERE email IS NOT NULL AND provider_sub IS NULL;