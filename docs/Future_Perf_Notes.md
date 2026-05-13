# Future performance notes

Items deferred from review of branch `gh-136-etc-rollup-improvements`.

## `deleteUser` runs a JSONB containment query per image

`was-web/server/src/services/extensions.ts` `deleteUser` walks `imagePaths`
and, for each path, runs

```ts
tx.select(...)
  .from(spritesheets)
  .where(sql`${spritesheets.sprites}::jsonb @> ${JSON.stringify([path])}::jsonb`)
```

For a user with N images this is N spritesheet scans inside the same
transaction (which holds row locks for the duration).

### Sketch fix

Batch the lookup into one query that surfaces both the row and the path
that matched, e.g.:

```sql
WITH paths AS (SELECT unnest($1::text[]) AS path)
SELECT s.id, s.adventure_id, s.sprites, s.free_spaces, p.path AS matched_path
FROM spritesheets s
JOIN paths p ON s.sprites::jsonb @> jsonb_build_array(p.path)
```

Then group rows by `s.id` in TypeScript and apply all the matched paths in
one `UPDATE` per sheet rather than per `(sheet, path)`. Net effect: O(1)
round-trips instead of O(N images).

### Why deferred

Functionally correct today. Hits hard only for users with many uploaded
images and many spritesheets — uncommon at current scale and easy to spot
in slow-query logs.
