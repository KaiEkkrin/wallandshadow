# Follow-up: tighten the Caddy CSP after the font self-host ships

**Status:** pending — must be done as a **separate PR**, after the font self-host
change has been merged, verified on `test.wallandshadow.com`, and deployed to
production. **Do not bundle this with the self-host PR.**

## Why this is deferred

The compliance PR ("automated third-party notices + self-hosted Princess Sofia
font") stops loading the *Princess Sofia* font from Google Fonts and self-hosts
it instead. That makes the Google Fonts hosts in the Content-Security-Policy
redundant.

But the CSP is **not** deployed with the application. It lives in
`ansible/templates/Caddyfile.j2` and only reaches the VPS when the
`provision.yml` workflow runs — a path completely separate from the app deploy
workflows.

If the CSP were tightened in the same change, re-running `provision.yml` would
remove the Google Fonts hosts from the live policy *while production is still
serving the old app build that loads the font from Google* — the browser would
block the font and the brand logo would fall back to `cursive`. The CSP can only
be tightened once **production** is already serving the self-hosted font.

## Required change

Edit the `csp_policy` block in `ansible/templates/Caddyfile.j2`:

```diff
-style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
-font-src 'self' https://fonts.gstatic.com data:;
+style-src 'self' 'unsafe-inline';
+font-src 'self' data:;
```

- `https://fonts.googleapis.com` is dropped from `style-src` — it was only there
  for the Google Fonts stylesheet `<link>`, which has been removed from
  `index.html`, `app.html` and `landing-index.html`.
- `https://fonts.gstatic.com` is dropped from `font-src` — it was only there for
  the woff2 files Google served. The font now loads from `'self'`.
- `'unsafe-inline'` stays in `style-src` (Bootstrap / react-bootstrap inject
  inline styles; the landing page has an inline `<style>` block).
- `data:` is kept in `font-src` as a low-risk allowance; remove it too if a
  check confirms nothing loads a `data:` font.

## How to apply

1. Confirm production (`wallandshadow.com`) is serving the build with the
   self-hosted font — the brand logo renders correctly and DevTools shows **no**
   requests to `fonts.googleapis.com` / `fonts.gstatic.com`.
2. Make the diff above in a new PR and merge it.
3. Re-run the **Provision Infrastructure** (`provision.yml`) workflow so Caddy
   picks up the new policy (Caddy reload is graceful — no downtime).
4. Verify: load `wallandshadow.com` and `test.wallandshadow.com`, check the
   browser console for CSP violations, and confirm the logo font still renders.

## Verification that the hosts are unused

Before the compliance PR there were three `<link rel="stylesheet">` tags to
`fonts.googleapis.com` (`index.html`, `app.html`, `landing-index.html`) — all
removed. The app now loads the font via the `@fontsource/princess-sofia` npm
package (bundled, same-origin); the landing page loads it via a self-hosted
`@font-face` pointing at `/fonts/princess-sofia-latin-400.woff2`. Nothing else
in the codebase references either Google host.
