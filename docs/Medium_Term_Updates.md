# Medium-Term Dependency Updates

(AI generated)

This document tracks dependency updates to plan for 2026 and beyond. These are not urgent but should be scheduled to avoid falling behind.

## React Router 6 → 7

**Current:** react-router-dom ^6.28.0
**Target:** react-router ^7.x
**Timeline:** Plan for Q2 2026

React Router 7 consolidates packages—`react-router-dom` is replaced by `react-router` with subpath imports for DOM-specific features.

### Key Changes

- Uninstall `react-router-dom`, install `react-router`
- Update imports from `"react-router-dom"` to `"react-router"`
- DOM-specific imports (like `RouterProvider`) use `"react-router/dom"`
- `react-router-bootstrap` will need updating or replacement

### Steps

1. Update `was-web/package.json`:
   ```json
   // Remove:
   "react-router-dom": "^6.28.0",
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

4. Address `react-router-bootstrap` usage:
   - Check if v7-compatible version exists
   - Or migrate to standard React Router `Link` components with Bootstrap classes

5. Test all routing thoroughly

### References

- [React Router v6 to v7 Migration](https://reactrouter.com/upgrading/v6)
- [React Router Documentation](https://reactrouter.com/)

---

## ESLint 9 → 10

**Current:** eslint ^9.39.2
**Target:** eslint ^10.0.0
**Timeline:** When ESLint 10 stabilises (expected early 2026)

ESLint 10 removes eslintrc completely. You're already on ESLint 9, which uses flat config by default.

### Key Changes

- `.eslintrc.*` files no longer supported
- `.eslintignore` no longer supported
- `ESLINT_USE_FLAT_CONFIG` env var no longer honoured
- Deprecated context members removed from rule API

### Pre-Migration Checklist

Before ESLint 10:

1. Ensure you're using flat config (`eslint.config.js` or `eslint.config.mjs`)
2. Remove any `.eslintrc.*` files
3. Remove `.eslintignore` (use `ignores` in flat config instead)
4. Update any custom rules that use deprecated context members

### Steps

1. Verify current config is flat config format

2. Update `was-web/package.json`:
   ```json
   "eslint": "^10.0.0"
   ```

3. Update ESLint plugins to v10-compatible versions:
   ```json
   "typescript-eslint": "^9.0.0",  // Check for v10 compatibility
   "eslint-plugin-react-hooks": "^6.0.0",  // Check version
   "eslint-plugin-react-refresh": "^1.0.0"  // Check version
   ```

4. Run linting and fix any new errors:
   ```bash
   yarn lint
   ```

### References

- [ESLint Version Support](https://eslint.org/version-support/)
- [ESLint v10 Preview](https://eslint.org/blog/2025/10/whats-coming-in-eslint-10.0.0/)
- [ESLint Flat Config Migration](https://eslint.org/docs/latest/use/configure/migration-guide)

---

## Firebase SDK 11 → 12

**Current:** firebase ^11.0.0
**Target:** firebase ^12.0.0
**Timeline:** When convenient, no urgency

Firebase 12 is available. Firebase provides at least 12 months notice before deprecating features.

### Steps

1. Review [Firebase JavaScript SDK Release Notes](https://firebase.google.com/support/release-notes/js) for breaking changes

2. Update `was-web/package.json`:
   ```json
   "firebase": "^12.0.0"
   ```

3. Update `@firebase/rules-unit-testing` if needed

4. Test authentication flows

5. Test Firestore operations

6. Test Storage operations

7. Test Cloud Functions calls

8. Run full E2E test suite

### References

- [Firebase Release Notes](https://firebase.google.com/support/releases)
- [Firebase JavaScript SDK Release Notes](https://firebase.google.com/support/release-notes/js)
- [Firebase Deprecation Policies](https://firebase.google.com/policies/changes-to-firebase/introducing-and-communicating-changes)

---

## Three.js Continuous Updates

**Current:** ^0.182.0
**Approach:** Incremental updates every 3-6 months

Three.js has no formal deprecation schedule but follows a pattern of deprecating in version X and removing in X+10. Regular updates prevent large migration efforts.

### Update Process

1. Check current version vs latest on [Three.js Releases](https://github.com/mrdoob/three.js/releases)

2. Review [Migration Guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide) for breaking changes

3. Update both packages:
   - `was-web/package.json`
   - `was-web/functions/package.json`

4. Update type definitions to match

5. Test rendering thoroughly:
   - Grid rendering (hex and square)
   - Token placement and movement
   - Wall rendering
   - Line of sight calculations
   - Image/sprite rendering

6. Run visual regression tests (E2E snapshots)

### Known Deprecations to Watch

- `PCFSoftShadowMap` deprecated (use `PCFShadowMap`)
- Various loaders deprecated (USDZLoader, LottieLoader)
- WebGPU becoming primary focus—consider future WebGPU migration

### References

- [Three.js Releases](https://github.com/mrdoob/three.js/releases)
- [Three.js Migration Guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide)

---

## TypeScript Updates

**Current:** ^5.7.0
**Approach:** Update with each minor release

TypeScript has no formal EOL policy. Keep reasonably current to benefit from type improvements and language features.

### Upcoming Changes

- TypeScript 6.0 will be a "bridge" release to TypeScript 7.0
- TypeScript 6.0 will deprecate features that 7.0 removes
- Plan to be on TypeScript 6.x when it releases, then migrate to 7.0

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
| 1 | React Router | 7.x | Q2 2026 |
| 2 | ESLint | 10.x | When stable (mid-2026) |
| 3 | Firebase SDK | 12.x | When convenient |
| 4 | Three.js | Latest | Ongoing (every 3-6 months) |
| 5 | TypeScript | Latest 5.x/6.x | Ongoing |

---

## Monitoring Recommendations

1. **Subscribe to release notifications:**
   - [Firebase Blog](https://firebase.blog/)
   - [React Blog](https://react.dev/blog)
   - [Vite Releases](https://github.com/vitejs/vite/releases)

2. **Periodic checks:**
   - Monthly: Check for security advisories (`yarn audit`)
   - Quarterly: Review major dependency versions
   - Annually: Full dependency audit and update cycle

3. **Use dependabot or similar:**
   - Consider enabling GitHub Dependabot for automated PRs
   - Or use `yarn upgrade-interactive` for manual reviews
