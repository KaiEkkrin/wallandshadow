# Medium-Term Dependency Updates

(AI generated)

This document tracks dependency updates to plan for 2026 and beyond. These are not urgent but should be scheduled to avoid falling behind.

## React Router 6 → 8 — ✅ done (2026-07-25)

**Current:** react-router ^8.3.0

Done as part of the dependency security audit: react-router-dom 6.x carried three
advisories (open redirect leading to XSS, open redirect via backslash in `<Link>` /
`useNavigate`, and arbitrary constructor injection via `deserializeErrors()`) with no
fix available on the 6.x line.

The recorded blocker — `react-router-bootstrap` having no v7 release and looking
unmaintained — turned out to be small: it was used only for `LinkContainer`, in three
files and nine call sites. It was removed rather than waited on. `Nav.Link` items became
`<Nav.Link as={NavLink} ... end>` (LinkContainer resolved its active state with
`useMatch(path)`, an exact match, so `end` preserves the old highlighting), and
`Card.Link` / `Navbar.Brand` became plain `as={Link}`.

`react-router-dom` was replaced by `react-router` (v7 consolidated the packages), then
taken to v8 because 7.x is itself flagged for an RSC-mode CSRF bypass. This app is a
declarative SPA — `BrowserRouter` plus `<Routes>`, no RSC, actions or SSR — so it was not
exposed, but 8.3 is a clean move for the API surface in use. React Router 8 requires
React >= 19.2.7; react/react-dom were refreshed to 19.2.8 within the existing `^19.0.0`
range.

`@types/react-router-bootstrap` was dropped too. The bundle shrank ~54 kB.

### References

- [React Router Documentation](https://reactrouter.com/)

---

## ESLint 9 → 10 — ✅ done (2026-07-25)

**Current:** eslint ^10.8.0, @eslint/js ^10.0.1, eslint-plugin-react-hooks ^7.1.1,
eslint-plugin-react-refresh ^0.5.3

Done as part of the dependency security audit — it is what clears the `brace-expansion`
DoS advisory (CVE-2026-14257) on the eslint side, because eslint 10 depends on
minimatch ^10, which uses brace-expansion ^5. Pinning brace-expansion 5 by resolution
instead is **not** viable: 5.x changed its export shape from a bare function to
`{ expand }`, so minimatch 3.x and 9.x would break at runtime.

The recorded blocker (`eslint-plugin-import`) left with the Firebase `functions/`
directory and no longer exists in this repo.

### ⬜ Follow-up: the React Compiler rules

`eslint-plugin-react-hooks` 7 folds the React Compiler rules into `recommended`. Most
pass and are enabled. Four are turned off in `was-web/eslint.config.js` because they
report **33 pre-existing violations across 24 files**:

| Rule | Count |
| --- | --- |
| `react-hooks/set-state-in-effect` | 29 |
| `react-hooks/preserve-manual-memoization` | 2 |
| `react-hooks/refs` | 1 |
| `react-hooks/purity` | 1 |

Nearly all are effects that call `setState` to derive state from props — the pattern
[You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect)
describes. Fixing them is a real refactor across context providers, modals and the map
annotations layer, and changing effect semantics near the real-time sync paths carries
risk, so it was deliberately not folded into a dependency upgrade. Re-enable one rule at
a time when someone takes this on.

### References

- [ESLint Version Support](https://eslint.org/version-support/)
- [React Compiler ESLint rules](https://react.dev/reference/eslint-plugin-react-hooks)

---

## Three.js Continuous Updates

**Current:** ^0.183.0 (updated 2026-03-01 from 0.182)
**Approach:** Incremental updates every 3-6 months

Three.js has no formal deprecation schedule but follows a pattern of deprecating in version X and removing in X+10. Regular updates prevent large migration efforts.

### Update Process

1. Check current version vs latest on [Three.js Releases](https://github.com/mrdoob/three.js/releases)

2. Review [Migration Guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide) for breaking changes

3. Update `was-web/package.json`

4. Update type definitions to match

5. Test rendering thoroughly:
   - Grid rendering (hex and square)
   - Token placement and movement
   - Wall rendering
   - Line of sight calculations
   - Image/sprite rendering

6. Run visual regression tests (E2E snapshots)

### Known Deprecations to Watch (0.183)

- `Clock` deprecated (use `Timer` instead)
- `PostProcessing` renamed to `RenderPipeline` (backwards-compatible for now)
- WebGPU now production-ready on all major browsers including Safari iOS
- `PCFSoftShadowMap` deprecated (use `PCFShadowMap`)
- Various loaders deprecated (USDZLoader, LottieLoader)

### References

- [Three.js Releases](https://github.com/mrdoob/three.js/releases)
- [Three.js Migration Guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide)

---

## TypeScript Updates

**Current:** ^5.7.0
**Approach:** Update with each minor release

TypeScript has no formal EOL policy. Keep reasonably current to benefit from type improvements and language features.

### Upcoming Changes

- TypeScript 6.0 Beta announced February 11, 2026 — stable expected imminently
- TypeScript 6.0 will be a "bridge" release to TypeScript 7.0
- TypeScript 6.0 will deprecate features that 7.0 removes
- Plan to be on TypeScript 6.x when it releases, then migrate to 7.0
- Note: TypeScript 7 will use a Go-based compiler ("Project Corsa")

### Update Process

1. Update `was-web/package.json` and `was-web/functions/package.json`

2. Run type checking:
   ```bash
   yarn typecheck
   ```

3. Fix any new type errors

4. Update `typescript-eslint` to compatible version

### References

- [TypeScript Releases](https://devblogs.microsoft.com/typescript/)
- [TypeScript 7 Progress](https://devblogs.microsoft.com/typescript/progress-on-typescript-7-december-2025/)

---

## RxJS 7 (No Action Required)

**Current:** ^7.8.0
**Status:** Stable, RxJS 8 on hold

RxJS 8 is on hold while Observable is being standardised for the web platform. No migration needed.

### Notes

- `toPromise()` is deprecated—use `firstValueFrom()` or `lastValueFrom()` instead
- Review codebase for `toPromise()` usage and migrate when convenient

### References

- [RxJS 8 Roadmap](https://github.com/ReactiveX/rxjs/issues/6367)

---

## Update Priority Summary

| Priority | Package | Target | Timeline |
|----------|---------|--------|----------|
| 1 | React Compiler lint rules | 4 rules re-enabled | ⬜ 33 violations across 24 files — see the ESLint section |
| 2 | license-checker-rseidelsohn | 5.x | ⛔ Blocked — requires Node >= 24; see below |
| 3 | Three.js | Latest | ✅ Done to 0.183 (2026-03-01); check again in ~3 months |
| 4 | TypeScript | 6.x | Wait for stable release (beta as of 2026-03-01) |
| 5 | drizzle-kit + drizzle-orm | 1.0.0 stable | ⛔ Blocked — see security note below |
| — | React Router | 8.x | ✅ Done 2026-07-25 |
| — | ESLint | 10.x | ✅ Done 2026-07-25 |

---

## license-checker-rseidelsohn 4 → 5

**Current:** ^4.4.2
**Target:** ^5.0.1
**Timeline:** Blocked on a Node 22 → 24 upgrade

This is the last outstanding `yarn audit` finding: 4.x reaches
`brace-expansion` 2.1.2 through `read-installed-packages > read-package-json > glob >
minimatch`, and only brace-expansion >= 5.0.8 is considered patched for CVE-2026-14257
(unbounded expansion → OOM). 5.0.1 drops that whole chain in favour of
`@npmcli/arborist`, which would clear the advisory.

**⛔ Blocker:** `license-checker-rseidelsohn@5` declares `engines: { node: ">=24", npm:
">=11" }`. This project is on Node 22 everywhere — the devcontainer, `node-version: 22`
in `.github/workflows/ci.yml`, and `node:22-slim` in `was-web/Dockerfile` — so the
install fails outright. There is no 5.x release that supports Node 22.

**Exposure:** low. The package is a devDependency used only by the build-time licence
scan in `was-web/vite-plugins/third-party-notices.ts`, over the repo's own dependency
tree. The DoS needs an attacker-supplied glob pattern, which never occurs here.

When the project moves to Node 24 (devcontainer, CI and Dockerfile together), bump this
to ^5.0.1, then run `yarn build` — the plugin fails the build loudly if the scan breaks,
so a successful build is the verification.

---

---

## drizzle-kit + drizzle-orm 1.0.0

**Current:** drizzle-kit `^0.31.0` (resolved 0.31.10), drizzle-orm `^0.45.2`
**Target:** drizzle-kit `1.0.0` stable + drizzle-orm `1.0.0` stable (paired upgrade)
**Timeline:** Wait for both packages to reach stable 1.0.0

### Security context: GHSA-67mh-4wv8-2f99

esbuild 0.18.20 is still in the tree as a transitive dependency of drizzle-kit. As of
the 2026-07-25 audit `yarn audit` no longer reports it (GHSA-67mh-4wv8-2f99 — CORS
vulnerability in esbuild's dev server, fixed in 0.25.0), but the old version is still
there, so the upgrade below remains worth doing on its own merits:

```
drizzle-kit@0.31.10
  └── @esbuild-kit/esm-loader@2.6.5   (archived — merged into tsx)
      └── @esbuild-kit/core-utils@3.3.2 (archived)
          └── esbuild@~0.18.20
```

**Why this is safe to defer**: the vulnerability requires esbuild's `--serve` HTTP server to be running. `@esbuild-kit/core-utils` only uses esbuild as a code transformer — it never starts a dev server. There is no live attack surface in this project.

**Why the proper fix must wait**: drizzle-kit 1.0.0-rc.1 (published 2026-04-30) drops `@esbuild-kit/*` entirely, but requires a paired upgrade to drizzle-orm 1.0.0-beta (also pre-release). As of May 2026, the RC is three days old and has a known data-safety regression (`db:push` drops tables without confirmation; `strict: true` is silently ignored). Both packages need to reach stable 1.0.0 before this upgrade is sensible.

### When drizzle-kit and drizzle-orm 1.0.0 stable ship

1. Update `was-web/server/package.json`:
   ```json
   "drizzle-kit": "^1.0.0",
   "drizzle-orm": "^1.0.0"
   ```
2. Run `yarn install`
3. Review the [drizzle v1 upgrade guide](https://orm.drizzle.team/docs/upgrade-v1) for any schema API changes
4. Run `yarn db:push` and `yarn db:push:test` to verify schema commands work
5. Run `yarn test:server` to confirm integration tests pass
6. Verify `yarn audit` no longer reports the esbuild vulnerability

---

## Monitoring Recommendations

1. **Subscribe to release notifications:**
   - [React Blog](https://react.dev/blog)
   - [Vite Releases](https://github.com/vitejs/vite/releases)

2. **Periodic checks:**
   - Monthly: Check for security advisories (`yarn audit`)
   - Quarterly: Review major dependency versions
   - Annually: Full dependency audit and update cycle

3. **Use dependabot or similar:**
   - Consider enabling GitHub Dependabot for automated PRs
   - Or use `yarn upgrade-interactive` for manual reviews
