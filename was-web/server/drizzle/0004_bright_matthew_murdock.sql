CREATE TABLE "map_images" (
	"map_id" uuid NOT NULL,
	"path" text NOT NULL,
	CONSTRAINT "map_images_map_id_path_pk" PRIMARY KEY("map_id","path")
);
--> statement-breakpoint
ALTER TABLE "map_images" ADD CONSTRAINT "map_images_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "map_images_path_idx" ON "map_images" USING btree ("path");--> statement-breakpoint
-- Backfill map_images from existing map_changes JSONB.
-- Magic numbers match packages/shared/src/data/change.ts:
--   ChangeCategory.Image = 5, ChangeType.Add = 1
INSERT INTO "map_images" ("map_id", "path")
SELECT DISTINCT mc."map_id", ch->'feature'->'image'->>'path' AS path
FROM "map_changes" mc,
     jsonb_array_elements(mc."changes"->'chs') AS ch
WHERE (ch->>'cat')::int = 5
  AND (ch->>'ty')::int = 1
  AND ch->'feature'->'image'->>'path' IS NOT NULL
  AND ch->'feature'->'image'->>'path' <> ''
ON CONFLICT DO NOTHING;