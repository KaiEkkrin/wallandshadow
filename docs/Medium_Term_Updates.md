# Medium-Term Dependency Updates

Upgrades we are holding back or have to plan by hand, and the reasons a lockfile
can't record. This document deliberately lists no current versions: the source of
truth is `was-web/package-lock.json`, the manifests, and the files named under
[Pins no bot tracks](#pins-no-bot-tracks). To see where things stand:

```bash
cd was-web
npm outdated     # direct dependencies behind their latest release
npm audit        # advisories, dev tooling included
```

`npm audit`'s suggested fix for a transitive advisory can be a downgrade of an
unrelated package. Read it before taking it; an [override](#overrides) is usually
the real way out.

---

## Held back

### TypeScript's next major

Blocked on typescript-eslint, whose `typescript` peer range excludes it; its tracking
issue (typescript-eslint#12518) was closed as not planned. Dependabot ignores the major
in `.github/dependabot.yml`. Revisit when typescript-eslint's peer range admits it.

Minor updates are routine: bump `was-web/package.json` and
`was-web/server/package.json`, then run `npm run build` and
`npm -w @wallandshadow/server run typecheck`.

### drizzle-kit + drizzle-orm stable 1.0

A paired upgrade, waiting for both packages to publish a stable 1.0 on npm's `latest`
tag. The 1.0 pre-releases drop the archived `@esbuild-kit/*` chain, but an early release
candidate had a data-safety regression: `db:push` dropped tables without confirmation and
`strict: true` was silently ignored. Check that this is gone before upgrading.

When stable ships:

1. Update both packages in `was-web/server/package.json`.
2. Review the [drizzle v1 upgrade guide](https://orm.drizzle.team/docs/upgrade-v1) for
   schema API changes.
3. Run `npm run db:push` and `npm run db:push:test` to verify the schema commands.
4. Run `npm run test:server`.
5. Remove the `@esbuild-kit/core-utils` [override](#overrides).

### React Compiler lint rules

`eslint-plugin-react-hooks` folds the React Compiler rules into `recommended`. Most pass
and are enabled. `react-hooks/set-state-in-effect`,
`react-hooks/preserve-manual-memoization`, `react-hooks/refs` and `react-hooks/purity` are
turned off in `was-web/eslint.config.js` because of pre-existing violations.

Nearly all are effects that call `setState` to derive state from props, the pattern
[You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect)
describes. Fixing them is a real refactor across context providers, modals and the map
annotations layer, and changing effect semantics near the real-time sync paths carries
risk, so it shouldn't be folded into a dependency upgrade. Re-enable one rule at a time.

### tsup

`was-web/server/` builds with tsup (`tsup.config.ts`). tsup's own README flags the
project as unmaintained, but it is a thin wrapper around esbuild and still works. The
server's build is small, so swap it for a plain esbuild script when convenient, or for
tsdown once that reaches a stable 1.0.

---

## Overrides

`overrides` in `was-web/package.json` forces versions that a package's own dependency
ranges would refuse. Each entry is temporary:

| Override | Why | Remove when |
| --- | --- | --- |
| `@esbuild-kit/core-utils` → `esbuild` | The archived chain under drizzle-kit pins an esbuild with a dev-server CORS advisory ([GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99)). That pin also made Dependabot's security job fail with `security_update_not_possible`, because Dependabot treats esbuild as one dependency across the tree. | drizzle-kit drops the chain (see above) |
| `minimatch` | [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) (DoS) is only fixed in a major that eslint, typescript-eslint and the npm libraries under license-checker don't accept yet. | Those parents' ranges admit the fixed major |
| `glob` | [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) is only fixed in a major that the npm libraries under license-checker don't accept yet. | Those parents' ranges admit the fixed major |

All of these reach dev tooling only; none ships in the server image or the bundle.

**Before overriding across a major**, check that the new version keeps the export shape
callers expect. brace-expansion is the cautionary case: a major changed its export from a
bare function to `{ expand }`, so forcing it would have broken its callers at runtime.
Then confirm that lint still covers the same files and that the build's third-party
notices still generate.

**Changing overrides needs a regenerated lockfile.** npm does not re-resolve an existing
lockfile when only `overrides` change, so an incremental `npm install` silently keeps the
old tree. Regenerating also sweeps every other dependency to its in-range version, so
expect churn well beyond the package you meant to change:

```bash
cd was-web
rm -rf node_modules server/node_modules packages/shared/node_modules package-lock.json
npm install
npm audit
```

---

## Upgrade notes

### Vite: `legacy.inconsistentCjsInterop`

`was-web/vite.config.ts` sets `legacy: { inconsistentCjsInterop: true }`. Without it the
app renders a blank page, in dev and in a production build, with
`TypeError: fluent is not a function` from the first `fluent(...)` call it reaches.

Rolldown resolves the default import of a CommonJS dependency differently from esbuild
when that dependency sets `__esModule`. `fluent-iterable` is compiled CJS that does the
correct thing, `__esModule: true` plus an `exports.default` that is the function, and
Rolldown hands back the namespace object instead of `.default`. This is a known Rolldown
interop bug class (rolldown#10308, #10519, #10800), not intended behaviour: Vite's own docs
for the flag say it aligns interop *to* esbuild.

The obvious guess is the wrong way round: the cruder CJS dependencies are fine. `dayjs` and
`blueimp-md5` are bare `module.exports = fn` with no `__esModule`, so Rolldown's interop
assigns `default = module.exports`. Only the well-formed package breaks.

**Remove the flag** when the Rolldown bug is fixed, or when `fluent-iterable` leaves the
tree; that is tracked in [#401](https://github.com/KaiEkkrin/wallandshadow/issues/401).

**To re-test**, remove the flag, clear `node_modules/.vite`, restart the Vite dev server
and load **`/app`**, checking for an empty `#root` and that error on the console. Then
confirm with the e2e suite. Two traps: a unit-test or `vite build` pass proves nothing,
because the failure is a runtime interop error that compiles happily, and neither does
loading the wrong route, because `/login` and `/about` render fine without the flag. Always
re-run the same check with the flag restored, so a pass means "the bug is gone" rather than
"the check missed it".

### Vite's config loader

Vite's bundling config loader warns about features its native loader won't support, so
keep `was-web/vite.config.ts` plain ESM: JSON imports use `with { type: 'json' }`, local
imports carry their `.ts` extension, and paths use `import.meta.dirname` rather than
`__dirname`.

### Three.js

Three.js has no formal deprecation schedule, but tends to deprecate in one release and
remove about ten later, so update incrementally every few months.

1. Read the [releases](https://github.com/mrdoob/three.js/releases) and the
   [migration guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide).
2. Update `three` and `@types/three` in `was-web/package.json`.
3. Test rendering thoroughly: grids (hex and square), token placement and movement, walls,
   line of sight, and image and sprite rendering.
4. Run the e2e suite, including its visual snapshots.

### RxJS

No action needed. RxJS's next major is on hold while Observable is being standardised for
the web platform ([roadmap](https://github.com/ReactiveX/rxjs/issues/6367)). `toPromise()`
is deprecated; use `firstValueFrom()` or `lastValueFrom()`.

---

## How updates reach us

**Dependabot version updates** (`.github/dependabot.yml`) run monthly with a cooldown,
across `github-actions` (repo root), `docker` (`/was-web` and `/.devcontainer`), `opentofu`
(`/infra`) and `npm` (`/was-web`, the workspace root, which covers `server` and
`packages/shared` too). Minor and patch updates are grouped into one PR per ecosystem;
majors open individually, since they need their own review.

**Security updates** are a separate repository setting, unaffected by the schedule or
cooldown: they open as soon as an advisory is published. They can also *fail* rather than
open a PR, when a transitive pin elsewhere in the tree blocks the fixed version: Dependabot
reports `security_update_not_possible` and the job goes red on `main`. An
[override](#overrides) is usually the way out.

**The early-warning workflow** (`.github/workflows/early-warning.yml`) runs the whole of CI
weekly and builds the dev container image. `npm ci` installs the lockfile exactly, so it
doesn't test new package releases. It catches what floats: base images, the unpinned
`pip install ansible ansible-lint`, the runner image, and the dev container's `curl | bash`,
`brew`, `playwright install-deps` and `gh extension` installs. Alongside it, **the
image-scan workflow** (`.github/workflows/image-scan.yml`) runs a weekly Grype scan of the
production image, reporting fixable HIGH and CRITICAL vulnerabilities to the Security tab.

### Pins no bot tracks

These live in plain text, not a manifest a dependency bot resolves against. Check them by
hand whenever touching the file that holds them, and against upstream's security
advisories now and then:

| Pin | Where |
| --- | --- |
| `tofu_version` | `.github/workflows/ci.yml`, `.github/workflows/provision.yml` |
| Node major | `was-web/Dockerfile`, `.devcontainer/Dockerfile`, `node-version` in `.github/workflows/ci.yml` and `.github/workflows/early-warning.yml`, `target` in `was-web/server/tsup.config.ts`, `@types/node` in `was-web/package.json`. Move all of them together, before the current major leaves [support](https://nodejs.org/en/about/previous-releases). Dependabot ignores Node majors. |
| `@devcontainers/cli` version | `.github/workflows/early-warning.yml` |
| actionlint image | `.github/workflows/ci.yml` |
| RustFS | `ARG RUSTFS_VERSION` in `.devcontainer/Dockerfile` and the image tag in `.github/workflows/ci.yml`. Move both together. Dev and CI only. |
| PostgreSQL major in CI | The service image in `.github/workflows/ci.yml` |
| `caddy_series` | `ansible/vars/main.yml`; see [SERVER_OPERATIONS.md](SERVER_OPERATIONS.md#moving-caddy-to-a-new-minor-series) |
| `server_image` | `infra/terraform.tfvars`; see [SERVER_OPERATIONS.md](SERVER_OPERATIONS.md#rebuilding) |

Unpinned on purpose: `pip install ansible ansible-lint` in `.github/workflows/ci.yml` and
`npx playwright install-deps` in `.devcontainer/Dockerfile` take the latest release on
every run. Server apt packages install themselves daily; see
[SERVER_OPERATIONS.md](SERVER_OPERATIONS.md#package-updates).
