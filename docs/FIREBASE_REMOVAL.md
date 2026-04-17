# Firebase & Google Analytics Removal from `main`

Phase 5 of the replatform (see @docs/REPLATFORM.md). The Firebase codebase has been
forked to the `legacy-firebase` branch and still deploys from there. `main` should now
drop Firebase and Google Analytics entirely so we can shrink dependencies, kill the
forced peer-resolution pile in `package.json`, and simplify the client.

**Goal**: after this work, `grep -ri firebase was-web/src was-web/packages` returns
nothing; `firebase`, `firebase-admin`, and `@firebase/rules-unit-testing` are out of
all `package.json` files in `main`; `VITE_BACKEND` and `VITE_AUTH_MODE` are gone; the
`Consent` banner and `AnalyticsContextProvider` are deleted.

**Non-goal**: changing anything on the `legacy-firebase` branch. That branch keeps
working as-is.

---

## What stays on `main`

GitHub Actions only surfaces `workflow_dispatch` triggers if the workflow file exists
on the default branch. Deleting the Firebase deploy workflows from `main` would hide
them from the Actions UI even for the `legacy-firebase` branch. Keep the YAMLs; they
will fail if run from `main` (no `firebase.json`, no `functions/`), and that's fine.

Keep:

- `.github/workflows/deploy-firebase.yml`
- `.github/workflows/deploy-production.yml`
- `.github/workflows/deploy-test.yml`

Everything else goes.

---

## Delete outright

### Firebase Functions source

- `was-web/functions/` — entire directory (Cloud Functions sources, build config,
  Firebase Admin scripts). Server-side logic has already been ported to
  `was-web/server/`.

### Client Firebase service layer

- `was-web/src/services/auth.ts` — Firebase Auth wrapper. `honoAuth.ts` is the replacement.
- `was-web/src/services/storage.ts` — Firebase Storage wrapper. `honoStorage.ts` replaces it.
- `was-web/src/services/functions.ts` — Firebase Functions callable wrapper. `honoFunctions.ts`
  replaces it.
- `was-web/src/services/dataService.ts` — Firestore data service. `honoDataService.ts` replaces it.
- `was-web/src/services/extensions.ts` — Firebase-specific extension helpers (the
  web-side delete/update paths that wrote directly to Firestore). Server-side
  equivalents live in `was-web/server/src/services/extensions.ts`.
- `was-web/src/services/resolveImageUrl.ts` — Firebase Storage URL resolver (check for
  Hono replacement; may already exist in `honoStorage.ts`).
- `was-web/src/services/converter.ts` — Firestore converters. Check whether anything
  still imports this; if not, delete. Shared converter logic lives in
  `packages/shared/src/services/converter.ts`.

### Client Firebase context providers

- `was-web/src/components/FirebaseContext.ts`
- `was-web/src/components/FirebaseContextProvider.tsx`
- `was-web/src/components/UserContextProvider.tsx` — Firebase-Auth-specific user wiring.
  `HonoContextProvider` handles the equivalent for the Hono stack.
- `was-web/src/components/BackendProvider.tsx` — chooser between Firebase and Hono.
  With only one backend left, this collapses — `App.tsx` wires `HonoContextProvider`
  directly.

### Google Analytics

- `was-web/src/components/AnalyticsContext.ts`
- `was-web/src/components/AnalyticsContextProvider.tsx`
- `was-web/src/components/Consent.tsx` — cookie consent banner for GA. With GA gone
  and no cookie-based replacement chosen (see @docs/ANALYTICS.md), no banner is needed.
- All callers of `AnalyticsContext` / `logEvent` / `logError` — drop the calls. These
  are scattered across components; audit with:
  `grep -rn "AnalyticsContext\|logEvent\|logError" was-web/src/`
- `createAnalytics` hook on `FirebaseContext` (goes away with `FirebaseContext`).

### Firebase config files at `was-web/`

- `firebase.json`
- `firebase.test.json`
- `.firebaserc`
- `firestore.rules`
- `firestore.indexes.json`
- `storage.rules`
- `cors.json`
- `cors_production.json`
- `firebase-admin-credentials.json` (gitignored, but remove from local working copies)
- `firebase-debug.log`, `firestore-debug.log` (should already be gitignored)
- `was-web/public/firebase-admin-credentials.json` symlink

---

## Edit in place

### `was-web/package.json`

Remove:

- `dependencies`: `"firebase": "^12.0.0"`
- `devDependencies`: `"@firebase/rules-unit-testing": "^5.0.0"`, `"firebase-admin": "^13.7.0"`
- `scripts.start`: change from `run-p --race dev:firebase dev:vite` to just `vite --host`
  (or delete `start` and tell everyone to use `dev:vite`)
- `scripts.dev:firebase`: delete entirely
- `scripts.lint`: no change, still lints `src` and `packages/shared/src`

After this, the `resolutions` block can likely be slimmed — many entries exist to pin
Firebase transitive deps. Audit once Firebase is out: `yarn install` and see which
resolutions are still doing work.

### `was-web/Dockerfile`

- Drop the `ARG VITE_BACKEND=hono` / `ENV VITE_BACKEND` pair.
- Drop the `ARG VITE_AUTH_MODE=oidc` / `ENV VITE_AUTH_MODE` pair.
- Drop the header comment block that documents those args.

### `was-web/vite.config.ts`

- Delete the `process.env.VITE_BACKEND === 'hono'` branches. The Hono-flavoured
  proxies and dev-server config become unconditional.

### `was-web/src/vite-env.d.ts`

- Remove `VITE_BACKEND` and `VITE_AUTH_MODE` type declarations.

### `was-web/src/App.tsx`

- Replace the `BackendProvider` wrapper with a direct `HonoContextProvider`.
- Drop any `FirebaseContextProvider` / `UserContextProvider` / `AnalyticsContextProvider`
  / `Consent` uses.

### `was-web/src/Login.tsx`

- `const oidcOnly = import.meta.env.VITE_AUTH_MODE === 'oidc';` becomes unconditional
  OIDC. Delete the legacy email/password branch and its controls.

### `was-web/src/components/Navigation.tsx`

- Audit for Firebase/analytics imports; rewrite against `HonoContext` equivalents.

### `was-web/src/components/interfaces.ts`

- Strip `IAnalyticsProps` and any Firebase-specific context props. The "abstracts the
  Firebase authentication stuff" comments survive only if the interface shape is still
  relevant under Hono.

### `was-web/src/data/types.ts`

- Remove Firestore `FieldValue` references in comments and (if present) type aliases.

### `was-web/src/**/*.tsx` (sweeping)

Components that currently import Firebase-flavoured hooks (`useContext(FirebaseContext)`,
`useContext(AnalyticsContext)`, Firebase Storage helpers, etc.) need to be redirected to
their Hono equivalents. Incomplete list — audit with grep:

- `Adventure.tsx`, `Map.tsx`, `Invite.tsx`, `All.tsx`, `Home.tsx`, `Shared.tsx`
- `components/AdventureCollection.tsx`, `AdventureContextProvider.tsx`,
  `MapContextProvider.tsx`, `MapCollection.tsx`, `MapCloneModal.tsx`
- `components/TokenImageEditor.tsx`, `SpriteImage.tsx`, `ImagePickerModal.tsx`,
  `ImageCollectionItem.tsx`, `ImageCardContent.tsx`, `ProfileContextProvider.tsx`

Many of these may already import `HonoContext` when `VITE_BACKEND=hono` is set; the
work is collapsing the dual-mode paths.

### `was-web/packages/shared/`

Not Firebase-specific in behaviour, but has stale Firebase references in comments:

- `src/services/interfaces.ts` — comments referring to "Firebase authentication",
  "Firebase Functions", "Firebase Storage". Rewrite without the Firebase names; the
  interfaces themselves are still correct.
- `src/services/helpers.ts` — "shared between the web application and the Firebase
  Functions" → shared between web and Hono server.
- `src/data/types.ts` — `FieldValue` comment.
- `src/data/profile.ts` — "Firebase rules stop us from" comment.

### Tests

- `was-web/unit/services/functions.test.ts` — integration tests against Firebase
  emulators. Delete; server-side `was-web/server/src/__tests__/server.test.ts` already
  provides equivalent coverage.
- `was-web/unit/services/extensions.test.ts` — audit; if Firebase-dependent, delete;
  if web-only logic, rewrite to not need Firebase setup.
- `was-web/unit/vitest.config.ts` — drop any Firebase emulator env setup.
- `was-web/e2e/util.ts`, `e2e/oob.ts` — currently bootstrap tests via Firebase
  emulators. Rewrite to use the Hono API (create test user via the local-JWT
  dev endpoint, or via an OIDC test flow).
- `was-web/playwright.config.ts` — remove any Firebase emulator wait/setup.

### Devcontainer

- `.devcontainer/Dockerfile` — remove Firebase CLI install, Java install (only needed
  for the Firestore emulator), and any `firebase-tools` layer.
- `.devcontainer/scripts/post-create.sh` — remove Firebase steps (`firebase setup:emulators`,
  credential symlink creation, etc.).
- `.devcontainer/devcontainer.json` (and `amd/`, `nvidia/` variants) — drop Firebase-port
  forwards (3400, 4000, 5001, 8080 for Firestore, 9099, 9199) if they're listed.
- `.devcontainer/README.md` — prune the Firebase emulator sections. The self-hosted
  stack (PostgreSQL + MinIO + Hono) is now the only path.

### Documentation

- `CLAUDE.md` — large Firebase-centric sections (collections, security rules, change
  tracking through Firestore, Firebase Admin credentials, emulator ports). Rewrite
  around the Hono stack or trim.
- `DEPLOY.md` — currently the Firebase deploy guide. Either retitle and move to
  `docs/LEGACY_FIREBASE_DEPLOY.md` with a note that it only applies to the
  `legacy-firebase` branch, or delete from `main` (content still exists on the
  `legacy-firebase` branch). Replace with a pointer to whatever the Hono deploy
  story becomes.
- `docs/ARCHITECTURE.md` — heavily Firebase-centric; rewrite or replace with a Hono
  stack doc.
- `docs/DEVELOPER_GUIDE.md` — Firebase workflows; rewrite for the Hono stack.
- `docs/GOTCHAS.md` — Firebase-specific gotchas (admin credentials, emulator config,
  CORS, change tracking rules). Many of these don't apply any more.
- `docs/REPLATFORM.md` — already updated to reflect current state.
- Any `TODO Phase N` comments in-code should be re-evaluated: most of them referred to
  interim workarounds that are now permanent under this simpler world.

### CI workflows

- `.github/workflows/ci.yml` — if it runs Firebase emulator tests (`test:unit` with
  `dev:firebase`), drop those jobs. `ci-server.yml` already covers server integration.
- `.github/workflows/provision.yml` — check whether this is Firebase or Hetzner
  provisioning.

---

## Staging order

Roughly in order of least risk first:

1. **Docs + comments** pass: update `CLAUDE.md`, `docs/ARCHITECTURE.md`,
   `docs/DEVELOPER_GUIDE.md`, `docs/GOTCHAS.md`, and the stale Firebase comments in
   `packages/shared/`. No behaviour change. Easy to review.
2. **Delete `was-web/functions/`** and the Firebase config files at `was-web/`.
   The server already runs without these.
3. **Delete Google Analytics**: `AnalyticsContext`, `AnalyticsContextProvider`,
   `Consent`, and all callers. Drop the GA bits from `FirebaseContext` too.
4. **Collapse the backend flag**: delete `BackendProvider`, `FirebaseContextProvider`,
   `UserContextProvider`; wire `HonoContextProvider` directly. Drop `VITE_BACKEND`
   from Dockerfile / vite.config.ts / vite-env.d.ts.
5. **Collapse the auth-mode flag**: delete the `VITE_AUTH_MODE` branches from `Login.tsx`
   and anywhere else. OIDC becomes the only path.
6. **Delete Firebase client services** (`auth.ts`, `storage.ts`, `functions.ts`,
   `dataService.ts`, `extensions.ts`, `converter.ts` if unused, `resolveImageUrl.ts`).
7. **Delete Firebase tests**: unit tests that depend on emulators, emulator bootstrapping
   in e2e. Rewrite e2e bootstrap against the Hono API.
8. **Drop Firebase from `package.json`** and run `yarn install`. Audit the `resolutions`
   block.
9. **Strip Firebase from the devcontainer**: Dockerfile, post-create script, README.
10. **Verify**: `yarn lint`, `yarn build`, `yarn test:unit`, `yarn test:server`,
    `yarn test:e2e`. Smoke-test the test server deploy.

Each step can be its own PR. Steps 1–3 are entirely safe; steps 4–6 are where review
should focus.

---

## Verification checklist

After the dust settles:

- [ ] `grep -rIn firebase was-web/src was-web/packages was-web/server 2>/dev/null` — no matches
- [ ] `grep -rIn "VITE_BACKEND\|VITE_AUTH_MODE" was-web/` — no matches
- [ ] `grep -rIn "AnalyticsContext\|Consent\|logEvent" was-web/src` — no matches
- [ ] `cat was-web/package.json | grep -i firebase` — no matches
- [ ] `yarn install` in `was-web/` produces no forced-resolution warnings tied to
      Firebase transitive deps
- [ ] `yarn build`, `yarn test:unit`, `yarn test:server`, `yarn test:e2e` all pass
- [ ] Test server deploy via `deploy-server-test.yml` still succeeds
- [ ] `legacy-firebase` branch still deploys via `deploy-firebase.yml`
- [ ] `workflow_dispatch` for the Firebase deploy workflows still shows up in the
      GitHub Actions UI when viewing the `legacy-firebase` branch
