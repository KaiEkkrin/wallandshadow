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

**Current:** ^0.186.0 (updated 2026-09-13 from 0.183)
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

### r184–r186 changes (0.183 → 0.186, checked 2026-09-13)

- `PCFSoftShadowMap` — the deprecation warning added in an earlier release was
  followed through: r186 removes the remaining `PCFSoftShadowMap` code
  entirely.
- `Matrix3.scale()`, `.rotate()`, `.translate()` deprecated (r185).
- `LottieLoader` and `TTFLoader` deprecated; both loaders' bundled decoder
  libraries were removed in favour of loading them from a CDN (r185).
- The CommonJS build is deprecated and minified builds were removed from the
  npm package (r186) — build-tooling changes, not an API surface change.
- `Object3D.dispose()` and `Object3D.intersectsFrustum()` added (r186); no
  action needed, just new API surface.

None of these affected us: the app doesn't call `PCFSoftShadowMap`,
`Matrix3.scale/rotate/translate`, `LottieLoader`, `TTFLoader`, `USDZLoader` or
`USDZExporter`, and Vite already consumes the ESM build.

### References

- [Three.js Releases](https://github.com/mrdoob/three.js/releases)
- [Three.js Migration Guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide)

---

## TypeScript Updates

**Current:** `~6.0.3` (done 2026-09-13)
**Approach:** Update with each minor release

TypeScript has no formal EOL policy. Keep reasonably current to benefit from type improvements and language features.

### Blocked on TypeScript 7

TypeScript 7.0.2 is npm's `latest`, but this repo is held at `~6.0.3`:
typescript-eslint 8.70 only supports TypeScript `<6.1.0`, and its tracking
issue for TS 7 support (typescript-eslint#12518) was closed as not planned —
there is no version of typescript-eslint to move to yet. Revisit once
typescript-eslint ships TS 7 support.

### TypeScript 6 changes that bit us

Moving 5.7 → 6.0 surfaced three behaviour changes, fixed as part of that
move:

- **Side-effect imports are now checked against `package.json` exports.**
  `import '@fontsource/princess-sofia'` stopped resolving because the
  package's `exports` map doesn't have a bare entry for a side-effect-only
  import; it became `import '@fontsource/princess-sofia/index.css'`, naming
  the actual CSS file.
- **`moduleResolution: "node"` is deprecated** in favour of `"bundler"` (or
  `"node16"`/`"nodenext"`); `was-web/unit/tsconfig.json` moved to `"bundler"`.
- **`types` now defaults to `[]`** instead of auto-including everything in
  `node_modules/@types`. The server's `tsconfig.json` compiled without
  Node's globals until it explicitly added `"types": ["node"]`.

### Update Process

1. Update `was-web/package.json` and `was-web/server/package.json` (this repo
   has no `functions/` workspace)

2. Run:
   ```bash
   npm run build
   npm -w @wallandshadow/server run typecheck
   ```

3. Fix any new type errors

4. Update `typescript-eslint` to a compatible version

### References

- [TypeScript Releases](https://devblogs.microsoft.com/typescript/)
- [TypeScript 7 Progress](https://devblogs.microsoft.com/typescript/progress-on-typescript-7-december-2025/)

---

## RxJS 7 (No Action Required)

**Current:** ^7.8.0
**Status:** Stable, RxJS 8 on hold

RxJS 8 is on hold while Observable is being standardised for the web platform. No migration needed.

### Notes

- `toPromise()` is deprecated—use `firstValueFrom()` or `lastValueFrom()` instead. No uses remain in this codebase.

### References

- [RxJS 8 Roadmap](https://github.com/ReactiveX/rxjs/issues/6367)

---

## Vite 8, Vitest 5 — ✅ done (2026-09-13)

**Current:** vite ^8.3.0, vitest ^5.0.0 (both workspaces), @vitejs/plugin-react ^6.1.1

Vite 8 replaces Rollup and esbuild with **Rolldown** (Rust-based bundler) and
**Oxc** (Rust-based transformer) as the default build pipeline — the
`rolldown-vite` variant that used to be opt-in is now plain `vite`. The
practical effect for this repo: the `vite > esbuild` override in
`was-web/package.json` had nothing left to pin (esbuild is now only an
optional peer dependency of Vite, `^0.27 || ^0.28`, which npm doesn't install
on Vite's behalf) and was deleted. `build.rollupOptions` was renamed to
`build.rolldownOptions` — same shape, new bundler underneath.

Rolldown also changed the build's shape, as measured at the upgrade: the
`vite build` step dropped from ~3.0s to ~1.0s, and the eager single-chunk
bundle Rollup produced split into a smaller entry chunk plus more granular
modulepreloaded chunks (17 JS chunks under Vite 7 → 27 under Vite 8);
total shipped bytes are essentially unchanged.

**The native config loader.** Vite 8 ships a `configLoader: 'native'` mode
(planned to become the default in a future major) that loads `vite.config.ts`
directly via Node's own module loader instead of bundling it first — faster
startup, but it only understands plain ESM/TS, not the bundler conveniences
Vite used to paper over. It isn't in use here: Vite 8.3 still defaults to
`configLoader: 'bundle'`. That default loader, though, warns about config
features the native loader won't support, and `was-web/vite.config.ts` needed
three fixes to silence those warnings:
`import packageJson from './package.json'` needed `with { type: 'json' }`
(import attributes are required for JSON imports under native ESM), the
`third-party-notices` import needed its explicit `.ts` extension, and every
`resolve(__dirname, …)` became `resolve(import.meta.dirname, …)` (`__dirname`
isn't defined in a native ESM config file; `import.meta.dirname` is the
direct replacement, added in Node 20.11 / 21.2).

**Why not defer.** Vite 7 goes security-fix-only once Vite 9 ships (Vite's
usual two-major support window), so taking 8 now rather than waiting avoids a
second migration stacked on top of whatever 9 changes next.

### References

- [Vite 8 announcement](https://vite.dev/blog/announcing-vite8)
- [Vite native config loader](https://vite.dev/guide/troubleshooting.html#vite-config-native-loader)
- [Vitest 5 migration guide](https://vitest.dev/guide/migration.html)

---

## Update Priority Summary

| Priority | Package | Target | Timeline |
|----------|---------|--------|----------|
| 1 | React Compiler lint rules | 4 rules re-enabled | ⬜ 33 violations across 24 files — see the ESLint section |
| — | license-checker-rseidelsohn | 5.x | ✅ Done 2026-09-13 (the Node 24 / npm migration) |
| — | Three.js | Latest | ✅ Done to 0.186 (2026-09-13); check again in ~3 months |
| — | TypeScript | 6.x | ✅ Done to 6.0 (2026-09-13); held there — see the TypeScript section |
| — | Vite / Vitest / plugin-react | 8.x / 5.x / 6.x | ✅ Done 2026-09-13 |
| 2 | drizzle-kit + drizzle-orm | 1.0.0 stable | ⛔ Blocked — see security note below |
| — | esbuild advisories | overrides | ✅ Done 2026-09-20 — see the esbuild section |
| — | React Router | 8.x | ✅ Done 2026-07-25 |
| — | ESLint | 10.x | ✅ Done 2026-07-25 |

---

## license-checker-rseidelsohn 4 → 5 — ✅ done (2026-09-13)

**Current:** ^5.0.1

Done as part of the Node 24 / npm migration: `license-checker-rseidelsohn@5` declares
`engines: { node: ">=24", npm: ">=11" }`, and the devcontainer, CI and
`was-web/Dockerfile` moved to Node 24 together, so the blocker that kept this on 4.x is
gone. 5.0.1 reads the dependency tree through `@npmcli/arborist` instead of the
`read-installed-packages > read-package-json > glob > minimatch` chain that reached
`brace-expansion` on 4.x — already not a security item since 2026-09-12, when
brace-expansion 2.1.4 backported the CVE-2026-14257 fix to the 2.x line the chain
resolved to. Both `npm audit --omit=dev` and a full `npm audit` are clean — the two
dev-only esbuild advisories that a full audit used to report are resolved by the
`overrides` described in the [esbuild section](#esbuild-overrides-dev-only) below.

---

## drizzle-kit + drizzle-orm 1.0.0

**Current:** drizzle-kit `^0.31.0` (resolved 0.31.10), drizzle-orm `^0.45.2`
**Target:** drizzle-kit `1.0.0` stable + drizzle-orm `1.0.0` stable (paired upgrade)
**Timeline:** Wait for both packages to reach stable 1.0.0

### Security context: GHSA-67mh-4wv8-2f99 — resolved by an override

drizzle-kit still carries the archived `@esbuild-kit` chain, which asks for
esbuild `~0.18.20`:

```
drizzle-kit@0.31.10
  └── @esbuild-kit/esm-loader@2.6.5   (archived — merged into tsx)
      └── @esbuild-kit/core-utils@3.3.2 (archived)
          └── esbuild@~0.18.20        ← overridden to ^0.28.2
```

That version is covered by GHSA-67mh-4wv8-2f99 (CORS vulnerability in esbuild's dev
server, fixed in 0.25.0). An `overrides` entry now forces it to the root esbuild —
see the [esbuild section](#esbuild-overrides-dev-only) — so it is out of the tree and
`npm audit` is clean. The chain itself only disappears with the upgrade below, which
remains worth doing on its own merits.

**Why the proper fix must wait**: drizzle-kit 1.0.0-rc.1 (published 2026-04-30) drops `@esbuild-kit/*` entirely, but requires a paired upgrade to drizzle-orm 1.0.0-beta (also pre-release). As of May 2026, the RC is three days old and has a known data-safety regression (`db:push` drops tables without confirmation; `strict: true` is silently ignored). Both packages need to reach stable 1.0.0 before this upgrade is sensible. As of 2026-09-13 both packages' `rc` dist-tag is `1.0.0-rc.4` — still pre-release, so this is still waiting.

### When drizzle-kit and drizzle-orm 1.0.0 stable ship

1. Update `was-web/server/package.json`:
   ```json
   "drizzle-kit": "^1.0.0",
   "drizzle-orm": "^1.0.0"
   ```
2. Run `npm install`
3. Review the [drizzle v1 upgrade guide](https://orm.drizzle.team/docs/upgrade-v1) for any schema API changes
4. Run `npm run db:push` and `npm run db:push:test` to verify schema commands work
5. Run `npm run test:server` to confirm integration tests pass
6. Drop the `@esbuild-kit/core-utils` entry from `overrides` in
   `was-web/package.json` — the chain it targets is gone — then regenerate the
   lockfile (see the esbuild section) and confirm `npm audit` is still clean

---

## tsup (server build)

`was-web/server/` builds with tsup (`tsup.config.ts`). tsup's own README flags
the project as unmaintained. It's kept for now: it's a thin wrapper around
esbuild and still works. Its declared `^0.27.0` esbuild range is now forced past
by an `overrides` entry (see the [esbuild section](#esbuild-overrides-dev-only)),
so it builds against the root esbuild rather than its own copy; the server build
and the full test suite pass that way. The candidate replacement, tsdown, is
still pre-1.0. Swap tsup for a plain esbuild build script when convenient —
the server's build is a single entry point, so the wrapper isn't buying much
— or revisit if tsdown reaches a stable 1.0 first.

---

## esbuild overrides (dev-only)

**Status:** ✅ in place (2026-09-20)

Two dev-only esbuild advisories reached the tree through tooling that pins an old
esbuild of its own:

| Advisory | Severity | Vulnerable | Reached via |
| --- | --- | --- | --- |
| [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) | moderate | `<= 0.24.2` | `drizzle-kit` → `@esbuild-kit/core-utils@3.3.2` → esbuild 0.18.20 |
| [GHSA-g7r4-m6w7-qqqr](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr) | low | `>= 0.27.3, < 0.28.1` | `tsup@8.5.1` → esbuild `^0.27.0` → esbuild 0.27.7 |

Neither had a live attack surface: both are bugs in esbuild's `--serve` development
server (the second is Windows-only), and tsup and `@esbuild-kit/core-utils` use
esbuild purely as a bundler/transformer — neither ever starts a server. But they made
**Dependabot's security-update job fail on `main`**, and would have gone on failing.
Dependabot reasons about "esbuild" as a single dependency across the whole tree, so its
attempt to reach 0.28.1 for the tsup alert collided with `@esbuild-kit`'s `~0.18.20`
pin and reported `security_update_not_possible` — "the latest possible version that
can be installed is 0.18.20". The unrelated drizzle-kit chain blocked the tsup fix.

Both are forced onto a single hoisted esbuild:

```json
"overrides": {
  "tsup": { "esbuild": "^0.28.2" },
  "@esbuild-kit/core-utils": { "esbuild": "^0.28.2" }
}
```

These two are what remains of the block after the Vite 8 upgrade above deleted its
`vite` entry — and they are also now the only reason a root esbuild is installed at
all, since Rolldown means Vite no longer pulls one in.

The tree holds exactly two esbuilds: `esbuild@0.28.2` hoisted to the root, and
drizzle-kit's own `esbuild@0.25.12` (not covered by either advisory). `npm audit` is
clean in full, not just under `--omit=dev`.

**Gotcha when changing these**: npm does **not** re-resolve an existing lockfile when
only `overrides` change — an incremental `npm install` silently keeps the old tree and
the overrides appear to do nothing. Regenerating is required:

```bash
cd was-web
rm -rf node_modules server/node_modules packages/shared/node_modules package-lock.json
npm install
node -e 'const l=require("./package-lock.json"); for (const [p,v] of Object.entries(l.packages)) if (/(^|\/)node_modules\/esbuild$/.test(p)) console.log(v.version, p);'
```

That regeneration also sweeps every other dependency to its in-range `Wanted`
version, so expect lockfile churn well beyond esbuild.

Both entries are temporary. Remove the `@esbuild-kit/core-utils` one when drizzle-kit
1.0 drops that chain, and the `tsup` one if tsup is replaced by a plain esbuild build
script — see the two sections above.

---

## Monitoring Recommendations

1. **Subscribe to release notifications:**
   - [React Blog](https://react.dev/blog)
   - [Vite Releases](https://github.com/vitejs/vite/releases)

2. **Periodic checks:**
   - Monthly: Check for security advisories (`npm audit`)
   - Quarterly: Review major dependency versions
   - Annually: Full dependency audit and update cycle

3. **Use dependabot or similar:**
   - Consider enabling GitHub Dependabot for automated PRs
   - Or use `npm outdated`, then `npm update`, for manual reviews
