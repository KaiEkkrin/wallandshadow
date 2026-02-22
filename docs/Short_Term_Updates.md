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

## Playwright 1.40 → 1.58.2 ✅ COMPLETED

**Previous:** @playwright/test ^1.40.1
**Current:** @playwright/test ^1.58.2
**Status:** Completed February 2026

### Changes Made

1. Updated `was-web/package.json`:
   ```json
   "@playwright/test": "^1.58.2"
   ```

2. Added Playwright browser cache symlink to `.devcontainer/scripts/post-create.sh`:
   - `~/.cache/ms-playwright` → `.devcontainer/.cache/ms-playwright`
   - Consistent with existing firebase/config/claude caching pattern
   - Browsers persist across container rebuilds (no re-download on `devcontainer rebuild`)

3. Ran `yarn install` to update `yarn.lock`

4. Ran `npx playwright install` — downloaded new browser versions:
   - Chrome for Testing 145.0.7632.6 (switch from Chromium, new in 1.57)
   - Firefox 146.0.1
   - WebKit 26.0

### Notes

- Targeted 1.58.2 (latest stable) rather than 1.57 as originally specified
- Microsoft's Playwright Docker images (`mcr.microsoft.com/playwright`) were evaluated as a devcontainer base to avoid browser re-downloads, but are Node.js 20 only — incompatible with our Node.js 22 requirement for Firebase Functions. The symlink caching approach achieves the same goal.
- All non-WebGL E2E tests pass; WebGL tests fail as expected in this dev container (no GPU)

### References

- [Playwright Releases](https://github.com/microsoft/playwright/releases)
- [Playwright Release Notes](https://playwright.dev/docs/release-notes)

---

## Vitest 3.2 → 4.x ✅ COMPLETED

**Previous:** vitest ^3.2.0
**Current:** vitest ^4.0.0
**Status:** Completed February 2026

### Changes Made

1. Updated `was-web/package.json`:
   ```json
   "vitest": "^4.0.0"
   ```

2. Ran `yarn install` to update `yarn.lock`

3. Ran `yarn test` — all 97 unit tests pass with no changes required

### Notes

- No configuration changes were needed — `unit/vitest.config.ts` uses no custom reporters, so the breaking reporter API changes in Vitest 4 did not affect this project
- The Firebase CJS/ESM alias workaround in `vitest.config.ts` continues to work unchanged

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
- [x] Playwright 1.40 → 1.57+
- [x] Vitest 3.2 → 4.x
- [ ] Three.js version synchronisation
- [ ] Full test suite passes
- [ ] Deploy to test environment
- [ ] Deploy to production
