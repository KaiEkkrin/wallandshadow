# Medium-Term Dependency Updates

(AI generated)

This document tracks dependency updates to plan for 2026 and beyond. These are not urgent but should be scheduled to avoid falling behind.

## React Router 6 → 7

**Current:** react-router-dom ^6.30.3
**Target:** react-router ^7.x
**Timeline:** Blocked — see below

React Router 7 is stable (7.13.1 as of March 2026). React Router 7 consolidates packages—`react-router-dom` is replaced by `react-router` with subpath imports for DOM-specific features.

**⛔ Blocker:** `react-router-bootstrap ^0.26.3` has no React Router 7 compatible release and the package appears unmaintained (last published 2 years ago, open issue #326). This package is used throughout the app for Bootstrap-styled navigation links. Options:
1. Wait for `react-router-bootstrap` to release v7 support (uncertain timeline)
2. Remove `react-router-bootstrap` dependency and implement Bootstrap link styling directly using standard React Router `Link` + Bootstrap CSS classes

### Key Changes (when unblocked)

- Uninstall `react-router-dom`, install `react-router`
- Update imports from `"react-router-dom"` to `"react-router"`
- DOM-specific imports (like `RouterProvider`) use `"react-router/dom"`
- Replace all `react-router-bootstrap` usage with plain Bootstrap + React Router `Link`

### Steps (when unblocked)

1. Update `was-web/package.json`:
   ```json
   // Remove:
   "react-router-dom": "^6.30.3",
   "react-router-bootstrap": "^0.26.3",
   "@types/react-router-bootstrap": "^0.26.8",

   // Add:
   "react-router": "^7.0.0"
   ```

2. Update imports throughout codebase:
   ```bash
   find ./src \( -name "*.tsx" -o -name "*.ts" \) -type f \
     -exec sed -i 's|from "react-router-dom"|from "react-router"|g' {} +
   ```

3. Update DOM-specific imports:
   ```typescript
   // Before
   import { RouterProvider } from "react-router-dom";

   // After
   import { RouterProvider } from "react-router/dom";
   ```

4. Replace all `react-router-bootstrap` `<LinkContainer>` components with plain Bootstrap `<Nav.Link as={Link}>` etc.

5. Test all routing thoroughly

### References

- [React Router v6 to v7 Migration](https://reactrouter.com/upgrading/v6)
- [React Router Documentation](https://reactrouter.com/)

---

## ESLint 9 → 10

**Current:** eslint ^9.39.2
**Target:** eslint ^10.0.0
**Timeline:** Blocked — see below

ESLint 10.0.2 is stable as of February 2026. Both ESLint configs already use flat config format (no legacy `.eslintrc`). However:

**⛔ Blocker:** `eslint-plugin-import ^2.32.0` (used in `was-web/functions`) is **not compatible** with ESLint 10 — it throws `TypeError: Cannot use 'in' operator to search for 'sourceType' in undefined` due to context API changes. See [import-js/eslint-plugin-import#3227](https://github.com/import-js/eslint-plugin-import/issues/3227). Wait until this plugin releases ESLint 10 support.

**Also needed when unblocked:**
- Functions lint script uses `--ext .ts` which is removed in ESLint 10; change to `eslint 'src/**/*.ts'`
- Verify `eslint-plugin-react-hooks` compatibility (currently doesn't declare ESLint 10 peer dep)
- `typescript-eslint ^8.x` already supports ESLint 10 — no upgrade needed

### Pre-Migration Checklist (for when unblocked)

1. ✅ Already using flat config in both `was-web/eslint.config.js` and `was-web/functions/eslint.config.js`
2. ✅ No `.eslintrc.*` files present
3. ✅ No custom rules using deprecated context members
4. ⬜ Wait for `eslint-plugin-import` to support ESLint 10
5. ⬜ Fix functions lint script: `"lint": "eslint 'src/**/*.ts'"` (remove `--ext`)

### Steps (when unblocked)

1. Update `was-web/package.json`:
   ```json
   "eslint": "^10.0.0"
   ```

2. Update `was-web/functions/package.json`:
   ```json
   "eslint": "^10.0.0"
   ```

3. Fix functions lint script in `was-web/functions/package.json`:
   ```json
   "lint": "eslint 'src/**/*.ts'"
   ```

4. Run linting in both locations and fix any new errors:
   ```bash
   yarn lint
   cd functions && yarn lint
   ```

### References

- [ESLint Version Support](https://eslint.org/version-support/)
- [ESLint v10 Preview](https://eslint.org/blog/2025/10/whats-coming-in-eslint-10.0.0/)
- [ESLint Flat Config Migration](https://eslint.org/docs/latest/use/configure/migration-guide)

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
| 1 | React Router | 7.x | ⛔ Blocked by react-router-bootstrap (no v7 support) |
| 2 | ESLint | 10.x | ⛔ Blocked by eslint-plugin-import (no ESLint 10 support) |
| 3 | Three.js | Latest | ✅ Done to 0.183 (2026-03-01); check again in ~3 months |
| 4 | TypeScript | 6.x | Wait for stable release (beta as of 2026-03-01) |

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
