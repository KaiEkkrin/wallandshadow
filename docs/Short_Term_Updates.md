# Short-Term Dependency Updates

(AI generated)

This document tracks dependency updates that should be addressed in the near term (Q1 2026).

## React 18 → 19 ✅ COMPLETED

**Previous:** React 18.3.1
**Current:** React 19.0.0
**Status:** Completed January 2026

### Changes Made

1. Updated core React packages in `was-web/package.json`:
   ```json
   "react": "^19.0.0",
   "react-dom": "^19.0.0",
   "react-bootstrap": "^2.10.10"
   ```

2. Updated type definitions:
   ```json
   "@types/react": "^19.0.0",
   "@types/react-dom": "^19.0.0"
   ```

3. Updated resolutions section to match

4. Updated test files to use idiomatic `assert.fail()` from Vitest instead of Jest's `fail()` global

5. Kept `@testing-library/react` at v14.x for test stability
   - v16.x caused significant test flakiness
   - v14.x works with React 19 despite peer dependency warnings

### Notes

- No code changes required - codebase already used modern React patterns
- `forwardRef` components in `MapAnnotations.tsx` work unchanged (deprecated but not removed in React 19)
- All `useRef` calls already had initial arguments

### References

- [React Versions](https://react.dev/versions)
- [React 19 Upgrade Guide](https://react.dev/blog/2024/04/25/react-19-upgrade-guide)

---

## Playwright 1.40 → 1.57+

**Current:** @playwright/test ^1.40.1
**Target:** ^1.57.0 (or latest)
**Priority:** High (17 minor versions behind)

Playwright follows a rolling release model. Version 1.57 switches from Chromium to Chrome for Testing builds and has deprecated Node.js 18 support.

### Steps

1. Update `was-web/package.json`:
   ```json
   "@playwright/test": "^1.57.0"
   ```

2. Run `yarn install`

3. Update browsers:
   ```bash
   npx playwright install
   ```

4. Run E2E tests and check for failures:
   ```bash
   yarn test:e2e
   ```

5. Update any snapshots if needed:
   ```bash
   yarn test:e2e --update-snapshots
   ```

6. Review Playwright changelog for breaking changes between 1.40 and 1.57

### References

- [Playwright Releases](https://github.com/microsoft/playwright/releases)
- [Playwright Release Notes](https://playwright.dev/docs/release-notes)

---

## Vitest 3.2 → 4.x

**Current:** vitest ^3.2.0
**Target:** ^4.0.0 (latest is 4.0.16)

Vitest 4 has breaking changes to the reporter API. IDE integrations have been updated for the new API.

### Steps

1. Update `was-web/package.json`:
   ```json
   "vitest": "^4.0.0"
   ```

2. Run `yarn install`

3. Run unit tests:
   ```bash
   yarn test:unit
   ```

4. Check for any custom reporter configurations that may need updating

5. Update VS Code Vitest extension if using one

### References

- [Vitest Releases](https://github.com/vitest-dev/vitest/releases)
- [Vitest Blog](https://vitest.dev/blog/vitest-3)

---

## Synchronise Three.js Versions

**Current:**
- `was-web/package.json`: three ^0.182.0, @types/three ^0.182.0
- `was-web/functions/package.json`: three ^0.163.0, @types/three ^0.163.0

**Target:** Align both to ^0.182.0

The functions package shares code with the web app via symlinks, so versions should be aligned.

### Steps

1. Update `was-web/functions/package.json`:
   ```json
   "dependencies": {
     "three": "^0.182.0"
   },
   "devDependencies": {
     "@types/three": "^0.182.0"
   }
   ```

2. Run `yarn install` in functions directory

3. Rebuild functions:
   ```bash
   cd was-web/functions
   yarn build
   ```

4. Test with emulators to verify no regressions

5. Review [Three.js Migration Guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide) for changes between r163 and r182

### References

- [Three.js Releases](https://github.com/mrdoob/three.js/releases)
- [Three.js Migration Guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide)

---

## Update Checklist

- [x] React 18 → 19
- [ ] Playwright 1.40 → 1.57+
- [ ] Vitest 3.2 → 4.x
- [ ] Three.js version synchronisation
- [ ] Full test suite passes
- [ ] Deploy to test environment
- [ ] Deploy to production
