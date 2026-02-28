# Audit Remediation Plan — Dev Tooling Vulnerabilities

Created: 2026-02-28

## Status

Deferred. The production-relevant vulnerability (fast-xml-parser) has been fixed by upgrading firebase-admin to 13.7.0. The remaining vulnerabilities below affect only dev/build tooling and are not exploitable in production.

## Remaining Vulnerabilities

All of these are transitive dependencies of dev-only packages (eslint, vite, vitest, npm-run-all2, typescript-eslint).

| Package | Installed | Fix | Severity | Consumer(s) |
|---|---|---|---|---|
| minimatch | 3.1.2 | >=3.1.5 | High (ReDoS) | eslint ^3.1.2, @eslint/config-array ^3.1.2 |
| ajv | 6.12.6 | >=6.14.0 | Moderate (ReDoS) | eslint ^6.12.4 |
| brace-expansion | 1.1.11 | >=1.1.12 | Low (ReDoS) | minimatch 3.x ^1.1.7 |
| rollup | 4.53.5 | >=4.59.0 | High (path traversal) | vite ^4.43.0 |
| minimatch | 9.0.5 | >=9.0.9 | High (ReDoS) | npm-run-all2 ^9.0.0, firebase-admin → gaxios → rimraf → glob |

### Why these can't be fixed by simple upgrades today

- **eslint 10.x** would fix minimatch 3.x, ajv, and brace-expansion (uses minimatch ^10.2.1, ajv ^6.14.0). However, **eslint-plugin-react-hooks** (all stable versions through 7.0.1) and **eslint-plugin-import** only support eslint up to v9. Blocked until these plugins add eslint 10 support.
- **vite 8.x** replaces rollup with rolldown, but is still in beta. Blocked until stable release.
- **npm-run-all2 8.x** drops minimatch entirely (uses picomatch), but is a major version bump.

## Remediation Plan

When the blocking conditions are cleared, apply these changes:

### Phase 1: typescript-eslint upgrade (low risk, do anytime)

Upgrade `typescript-eslint` (was-web) and `@typescript-eslint/*` (functions) from 8.50 to 8.56+. This is a minor version bump that moves their minimatch dependency from ^9.0.5 to ^10.2.2, resolving the minimatch 9.x vulnerability in both directories.

**was-web/package.json:**
```diff
- "typescript-eslint": "^8.50.0",
+ "typescript-eslint": "^8.56.0",
```

**was-web/functions/package.json:**
```diff
- "@typescript-eslint/eslint-plugin": "^8.50.0",
- "@typescript-eslint/parser": "^8.50.0",
+ "@typescript-eslint/eslint-plugin": "^8.56.0",
+ "@typescript-eslint/parser": "^8.56.0",
```

### Phase 2: npm-run-all2 upgrade (moderate risk)

Upgrade npm-run-all2 from 7.x to 8.x. This drops minimatch entirely (switched to picomatch).

**was-web/package.json:**
```diff
- "npm-run-all2": "^7.0.0",
+ "npm-run-all2": "^8.0.0",
```

Test that `yarn start` (which uses `run-p`) still works correctly.

### Phase 3: eslint 10 upgrade (when plugins support it)

**Prerequisite:** Both `eslint-plugin-react-hooks` and `eslint-plugin-import` must release versions supporting eslint 10.

Track these issues:
- eslint-plugin-react-hooks: Check for eslint 10 in peerDependencies
- eslint-plugin-import: Check for eslint 10 in peerDependencies (or switch to eslint-plugin-import-x which may support it sooner)

When ready:

**was-web/package.json:**
```diff
- "eslint": "^9.39.2",
- "@eslint/js": "^9.39.2",
+ "eslint": "^10.0.0",
+ "@eslint/js": "^10.0.0",
```

**was-web/functions/package.json:**
```diff
- "eslint": "^9.39.2",
+ "eslint": "^10.0.0",
```

This fixes: minimatch 3.x, ajv, brace-expansion.

### Phase 4: vite 8 upgrade (when stable)

**Prerequisite:** vite 8.x reaches stable release.

This replaces rollup with rolldown, eliminating the rollup vulnerability entirely. Will require testing the build pipeline.

### Interim: resolution pins (if needed before phases 3-4)

If audit compliance is required before eslint 10 and vite 8 are available, add these resolution pins:

**was-web/package.json:**
```json
"resolutions": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "ajv": "^6.14.0",
    "rollup": "^4.59.0",
    "eslint/minimatch": "3.1.5",
    "@eslint/config-array/minimatch": "3.1.5",
    "npm-run-all2/minimatch": "9.0.9"
}
```

**was-web/functions/package.json:**
```json
"resolutions": {
    "ajv": "^6.14.0",
    "eslint/minimatch": "3.1.5",
    "@eslint/config-array/minimatch": "3.1.5"
}
```

These use yarn v1 path-scoped resolutions to avoid conflicts between minimatch 3.x (eslint) and 9.x/10.x (other packages).

Remove each pin as its corresponding phase is completed.
