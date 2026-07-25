# Unified CI Gate + Deployment Static Validation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse `ci.yml` and `ci-server.yml` into one CI workflow that runs on every PR to `main` and ends in a single always-reported gate job that can be made a required status check, and extend it with statically-validated deployment checks (Dockerfile, GitHub Actions workflows, Ansible, OpenTofu).

**Architecture:** One workflow, `.github/workflows/ci.yml`, with no `paths:` filter on its `pull_request` trigger so it always runs. A leading `changes` job uses `dorny/paths-filter@v3` to emit one boolean output per area of the repository. Every verification job declares `needs: changes` and an `if:` guard on the matching output, so unaffected jobs are *skipped* rather than not-run. A terminal `ci-gate` job with `if: always()` depends on all of them and fails only when some job's result is `failure` or `cancelled` — `skipped` counts as a pass. That gate job is the single check name to require in branch protection. The workflow keeps a `workflow_call` trigger with a `force_all` boolean input so `deploy-server-test.yml` can demand every verification before deploying.

**Tech Stack:** GitHub Actions · `dorny/paths-filter@v3` · hadolint 2.14.0 · BuildKit build checks (`docker/build-push-action@v6` with `call: check`) · actionlint 1.7.7 · ShellCheck 0.10.0 · ansible-lint · OpenTofu 1.9

---

## Global Constraints

- Branch for this work: `ci-single-gate-workflow-20260725` (already created from up-to-date `main`).
- `permissions:` stays least-privilege — `contents: read` on `ci.yml`. Never widen it.
- No verification job may require a secret. Every check in this plan runs on a fork PR with no credentials. `tofu init` uses `-backend=false` precisely for this reason.
- No job builds or pushes a container image. The Dockerfile job is static-only, per the decision recorded on 2026-07-25.
- Action references use floating major tags (`@v4`, `@v6`), matching existing house style in this repo. The two exceptions are pinned because they are the tools themselves: `hadolint/hadolint-action@v3.1.0` and `docker://rhysd/actionlint:1.7.7`.
- Node version stays `22`. Yarn install stays `--frozen-lockfile`.
- All commands below assume repo root `/workspaces/wallandshadow` unless a `cd` is shown.
- Work as sequential commits on the current branch (not a stack of PR branches). Push and open **one** PR after Task 1 so that Tasks 2–6 can be observed running in real CI on that same PR.

---

## Verified Findings (established before writing this plan — do not re-derive)

These were produced by running the real tools against the current tree on 2026-07-25. They are the concrete failures each new job will surface on its first run, and each task below fixes them.

| Tool | Target | Result |
| --- | --- | --- |
| `hadolint 2.14.0` | `was-web/Dockerfile` | **exit 1.** `DL3060 info` at line 41 (`yarn cache clean` missing after `yarn install`); `DL3003 warning` at line 72 (`RUN cd server && yarn build` — use WORKDIR) |
| `actionlint 1.7.7` (no shellcheck) | `.github/workflows/` | exit 0 — clean |
| `actionlint 1.7.7` + ShellCheck | `.github/workflows/` | **exit 1.** `provision.yml:93` SC2129 style — consecutive `>> "$GITHUB_OUTPUT"` redirects |
| `shellcheck 0.10.0` | `was-web/server/docker-entrypoint.sh` | exit 0 — clean |
| `shellcheck 0.10.0` | `ansible/rotate_secrets.sh` | **exit 1.** SC2046 warning at line 24 — unquoted `$(date +%s)` |
| `tofu 1.9.1 fmt -check -recursive` | `infra/` | **exit 3.** `infra/terraform.tfvars` misaligned (`server_image` breaks the `=` alignment) |
| `tofu 1.9.1 validate` (after `init -backend=false`) | `infra/` | exit 0 — valid, with one non-fatal warning: `network.tf:9` `assignee_type` is now optional |
| `actionlint 1.7.7` | the drafted new `ci.yml` + patched `deploy-server-test.yml` + patched `provision.yml` | exit 0 — **the workflow YAML in this plan is already actionlint-clean**, including the `workflow_call` input contract (verified by a negative test: a typo'd input name is correctly rejected) |

**Two checks could not be run locally** (no Docker daemon, no pip/venv in this devcontainer) and therefore have explicit triage steps in their tasks:

- `docker buildx build --call=check` on `was-web/Dockerfile`
- `ansible-lint` on `ansible/playbook.yml`

For ansible-lint, a static scan of `playbook.yml` predicts a *small* finding set — 2 tasks using `ansible.builtin.command` without `changed_when` ("Install AWS CLI v2", "Copy PostgreSQL data to volume") and 2 file-touching tasks without `mode:` ("Clean up AWS CLI installer", "Set volume data directory ownership"). Longest line is 114 chars, under yamllint's 160 default. Expect a handful of findings, not a wall.

### Getting the tools locally

Every task verifies locally before pushing. These downloads were confirmed working from this devcontainer:

```bash
mkdir -p /tmp/ci-tools && cd /tmp/ci-tools

curl -sSfL -o hadolint https://github.com/hadolint/hadolint/releases/latest/download/hadolint-Linux-x86_64
chmod +x hadolint

curl -sSfL -o actionlint.tgz https://github.com/rhysd/actionlint/releases/download/v1.7.7/actionlint_1.7.7_linux_amd64.tar.gz
tar xzf actionlint.tgz actionlint

curl -sSfL -o sc.tar.xz https://github.com/koalaman/shellcheck/releases/download/v0.10.0/shellcheck-v0.10.0.linux.x86_64.tar.xz
tar xJf sc.tar.xz --strip-components=1 shellcheck-v0.10.0/shellcheck

curl -sSfL -o tofu.tgz https://github.com/opentofu/opentofu/releases/download/v1.9.1/tofu_1.9.1_linux_amd64.tar.gz
tar xzf tofu.tgz tofu

export PATH="/tmp/ci-tools:$PATH"
```

`actionlint` shells out to `shellcheck` if it is on `PATH` — always export the PATH above before running it, otherwise you get a false pass on inline `run:` blocks.

---

## File Structure

**Created:**

| Path | Responsibility |
| --- | --- |
| `.github/workflows/ci.yml` (rewritten) | The one always-running workflow: change detection, all verification jobs, terminal gate |
| `.hadolint.yaml` | Repo-root hadolint config; suppresses DL3060 with a stated reason |
| `.ansible-lint` | Repo-root ansible-lint config; sets the playbook path and holds any justified skips |

**Deleted:**

| Path | Reason |
| --- | --- |
| `.github/workflows/ci-server.yml` | Its job moves verbatim into `ci.yml` as the `server` job |
| `run_docker.sh` (Task 6, optional) | Dead: drives a `docker-compose.yml` that no longer exists and a `hexland_hexland_1` container from the pre-replatform era |

**Modified:**

| Path | Change |
| --- | --- |
| `.github/workflows/deploy-server-test.yml:41-49` | Two `uses:` jobs collapse to one call of `ci.yml` with `force_all: true` |
| `.github/workflows/provision.yml:93-96` | Group `$GITHUB_OUTPUT` redirects (SC2129) |
| `was-web/Dockerfile:72` | `RUN cd server && yarn build` → `WORKDIR /app/server` + `RUN yarn build` (DL3003) |
| `ansible/rotate_secrets.sh:24` | Quote the backup path (SC2046) |
| `ansible/playbook.yml` | ansible-lint fixes (triaged in Task 4) |
| `infra/terraform.tfvars` | `tofu fmt` alignment |
| `docs/REPLATFORM.md:213-221` | CI Pipeline section rewritten to describe the new shape |
| `CONTRIBUTING.md:11-14` | Mention the required gate check |

---

## Task 1: Unify the two CI workflows behind a single gate job

The load-bearing task. Everything after it adds jobs to the structure this establishes.

**Files:**
- Rewrite: `.github/workflows/ci.yml`
- Delete: `.github/workflows/ci-server.yml`
- Modify: `.github/workflows/deploy-server-test.yml:41-49`

**Interfaces:**
- Produces: a reusable workflow `./.github/workflows/ci.yml` accepting one input, `force_all` (boolean, optional, default `false`).
- Produces: job id `changes` with outputs `web`, `server`, `dockerfile`, `workflows`, `ansible`, `infra` — each the string `'true'` or `'false'`. Later tasks add jobs guarded by `dockerfile`, `workflows`, `ansible`, `infra`; those outputs are declared here even though nothing consumes them yet, so that Tasks 2–5 only append a job.
- Produces: terminal job id `ci-gate`, display name `CI gate` — the status check name to require in branch protection.

- [ ] **Step 1: Write the new `.github/workflows/ci.yml`**

Replace the file entirely with:

```yaml
# =============================================================================
# CI — the single required status check for pull requests into main
# =============================================================================
# This workflow always runs on every PR to main so that it can be configured as
# a required status check in branch protection. Which *verifications* run is
# decided per-job by the `changes` job below, which diffs the PR against its
# merge base. Jobs whose files did not change are skipped, and the terminal
# `ci-gate` job treats "skipped" as a pass.
#
# Deploy workflows call this workflow with `force_all: true` so that every
# verification runs regardless of the diff.
# =============================================================================

name: CI

on:
  pull_request:
    branches: [main]
  workflow_call:
    inputs:
      force_all:
        description: "Run every verification regardless of which files changed"
        required: false
        default: false
        type: boolean

# Least-privilege permissions: only read access to repository contents
# See: https://docs.github.com/en/actions/security-guides/automatic-token-authentication
permissions:
  contents: read

jobs:
  # ── Which areas of the repository changed? ──────────────────────────────────
  changes:
    name: Detect changed areas
    runs-on: ubuntu-latest
    outputs:
      web: ${{ inputs.force_all && 'true' || steps.filter.outputs.web }}
      server: ${{ inputs.force_all && 'true' || steps.filter.outputs.server }}
      dockerfile: ${{ inputs.force_all && 'true' || steps.filter.outputs.dockerfile }}
      workflows: ${{ inputs.force_all && 'true' || steps.filter.outputs.workflows }}
      ansible: ${{ inputs.force_all && 'true' || steps.filter.outputs.ansible }}
      infra: ${{ inputs.force_all && 'true' || steps.filter.outputs.infra }}

    steps:
      - uses: actions/checkout@v4

      - name: Filter changed paths
        id: filter
        if: ${{ !inputs.force_all }}
        uses: dorny/paths-filter@v3
        with:
          filters: |
            web:
              - 'was-web/**'
              - '!was-web/server/**'
              - '!was-web/Dockerfile'
              - '!was-web/.dockerignore'
              - '.github/workflows/ci.yml'
            server:
              - 'was-web/server/**'
              - 'was-web/packages/shared/**'
              - 'was-web/package.json'
              - 'was-web/yarn.lock'
              - '.github/workflows/ci.yml'
            dockerfile:
              - 'was-web/Dockerfile'
              - 'was-web/.dockerignore'
              - 'was-web/server/docker-entrypoint.sh'
              - '.hadolint.yaml'
              - '.github/workflows/ci.yml'
            workflows:
              - '.github/workflows/**'
            ansible:
              - 'ansible/**'
              - '.github/workflows/ci.yml'
            infra:
              - 'infra/**'
              - '.github/workflows/ci.yml'

  # ── Web client: build, lint, unit tests ─────────────────────────────────────
  web:
    name: Web build / lint / test
    needs: changes
    if: ${{ needs.changes.outputs.web == 'true' }}
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: "yarn"
          cache-dependency-path: was-web/yarn.lock

      - name: Install dependencies
        working-directory: was-web
        run: yarn install --frozen-lockfile

      - name: Build web
        working-directory: was-web
        run: yarn build

      - name: Lint web
        working-directory: was-web
        run: yarn lint

      - name: Unit tests
        working-directory: was-web
        run: yarn test

      - name: Shared unit tests
        working-directory: was-web
        run: yarn test:shared

  # ── Hono server: type-check, lint, integration tests ────────────────────────
  server:
    name: Server type-check / lint / test
    needs: changes
    if: ${{ needs.changes.outputs.server == 'true' }}
    runs-on: ubuntu-latest

    env:
      DATABASE_URL: postgresql://was:wasdev@localhost:5432/wallandshadow
      S3_ENDPOINT: http://127.0.0.1:9000
      S3_REGION: us-east-1
      S3_ACCESS_KEY: wasdev
      S3_SECRET_KEY: wasdevpass
      S3_BUCKET: wallandshadow

    services:
      postgres:
        image: postgres:17
        env:
          POSTGRES_USER: was
          POSTGRES_PASSWORD: wasdev
          POSTGRES_DB: wallandshadow
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v4

      - name: Start MinIO
        run: |
          docker run -d --name minio \
            -p 9000:9000 \
            -e MINIO_ROOT_USER=wasdev \
            -e MINIO_ROOT_PASSWORD=wasdevpass \
            minio/minio:latest server /data
          # Wait for MinIO to be ready
          for i in $(seq 1 30); do
            if curl -sf http://127.0.0.1:9000/minio/health/live; then
              echo "MinIO is ready"
              break
            fi
            echo "Waiting for MinIO... ($i)"
            sleep 1
          done

      - name: Create MinIO buckets
        run: |
          docker run --rm --network host \
            -e MC_HOST_local=http://wasdev:wasdevpass@127.0.0.1:9000 \
            minio/mc:latest mb local/wallandshadow local/wallandshadow-test --ignore-existing

      - name: Install ImageMagick
        run: sudo apt-get install -y imagemagick

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: "yarn"
          cache-dependency-path: was-web/yarn.lock

      - name: Install dependencies
        working-directory: was-web
        run: yarn install --frozen-lockfile

      - name: Create test database
        run: psql -h localhost -U was -d wallandshadow -c "CREATE DATABASE wallandshadow_test OWNER was;"
        env:
          PGPASSWORD: wasdev

      - name: Type-check
        working-directory: was-web/server
        run: yarn tsc --noEmit

      - name: Lint
        working-directory: was-web/server
        run: yarn lint

      - name: Apply database schema (test database)
        working-directory: was-web/server
        run: yarn drizzle-kit push
        env:
          DATABASE_URL: postgresql://was:wasdev@localhost:5432/wallandshadow_test

      - name: Run tests
        working-directory: was-web/server
        run: yarn test

  # ── Terminal gate: the single required status check ─────────────────────────
  # Set branch protection on main to require "CI gate". It succeeds when every
  # job above either succeeded or was skipped, and fails otherwise.
  ci-gate:
    name: CI gate
    needs: [changes, web, server]
    if: always()
    runs-on: ubuntu-latest

    steps:
      - name: Fail if any job failed or was cancelled
        if: ${{ contains(needs.*.result, 'failure') || contains(needs.*.result, 'cancelled') }}
        run: |
          echo "::error::One or more CI jobs failed or were cancelled."
          exit 1

      - name: Report success
        run: echo "All CI jobs succeeded or were skipped."
```

Note the `needs:` list on `ci-gate` contains only the three jobs that exist right now. Tasks 2–5 each append their job id to it.

- [ ] **Step 2: Delete the old server workflow**

```bash
git rm .github/workflows/ci-server.yml
```

- [ ] **Step 3: Point `deploy-server-test.yml` at the unified workflow**

In `.github/workflows/deploy-server-test.yml`, replace:

```yaml
jobs:
  ci-web:
    uses: ./.github/workflows/ci.yml

  ci-server:
    uses: ./.github/workflows/ci-server.yml

  build-and-deploy:
    needs: [ci-web, ci-server]
```

with:

```yaml
jobs:
  ci:
    uses: ./.github/workflows/ci.yml
    with:
      force_all: true

  build-and-deploy:
    needs: [ci]
```

- [ ] **Step 4: Verify locally with actionlint**

```bash
export PATH="/tmp/ci-tools:$PATH"
actionlint -color=false; echo "exit=$?"
```

Expected: the only remaining finding is the pre-existing `provision.yml:93` SC2129, which Task 2 fixes. Nothing may be reported against `ci.yml` or `deploy-server-test.yml`. If actionlint reports anything in those two files, fix it before continuing.

- [ ] **Step 5: Sanity-check that the reusable-workflow contract is being validated**

Temporarily break it, confirm actionlint notices, then restore. This proves your local actionlint is actually checking the caller/callee contract rather than silently passing.

```bash
sed -i 's/force_all: true/force_alll: true/' .github/workflows/deploy-server-test.yml
actionlint -color=false 2>&1 | head -4
sed -i 's/force_alll: true/force_all: true/' .github/workflows/deploy-server-test.yml
```

Expected from the middle command:
```
.github/workflows/deploy-server-test.yml:45:7: input "force_alll" is not defined in "./.github/workflows/ci.yml" reusable workflow. defined input is "force_all" [workflow-call]
```

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/ci.yml .github/workflows/deploy-server-test.yml
git commit -m "ci: unify web and server CI into a single gated workflow

ci.yml now runs on every PR to main with no paths filter, so it can be
made a required status check. Path filtering moves to a leading changes
job; each verification job is skipped when its files are untouched, and
the terminal ci-gate job treats skipped as a pass.

deploy-server-test calls the unified workflow with force_all: true so a
deploy still runs every verification.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 7: Push and open the PR that will carry the rest of this work**

```bash
git push -u origin ci-single-gate-workflow-20260725
gh pr create --base main \
  --title "ci: unified CI gate + deployment static validation" \
  --body "$(cat <<'EOF'
Collapses `ci.yml` and `ci-server.yml` into one always-running workflow ending in a `CI gate` job, then adds static validation for the deployment-contributing assets (Dockerfile, workflows, Ansible, OpenTofu).

Once merged, set branch protection on `main` to require the **CI gate** check.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 8: Observe the first real run**

```bash
gh pr checks --watch
```

Expected: `Detect changed areas`, `Web build / lint / test`, `Server type-check / lint / test`, and `CI gate` all run and pass. Because this PR touches `.github/workflows/ci.yml`, which appears in both the `web` and `server` filters, both verification jobs run — that is the intended self-test.

---

## Task 2: Workflow lint job (actionlint)

Second, so that every workflow edit made by Tasks 3–5 is guarded by actionlint in CI.

**Files:**
- Modify: `.github/workflows/ci.yml` (append a `workflows` job; add `workflows` to `ci-gate`'s `needs`)
- Modify: `.github/workflows/provision.yml:93-96`

**Interfaces:**
- Consumes: `needs.changes.outputs.workflows` from Task 1.
- Produces: job id `workflows`, display name `Workflow lint`.

- [ ] **Step 1: Reproduce the failure locally**

```bash
export PATH="/tmp/ci-tools:$PATH"
actionlint -color=false; echo "exit=$?"
```

Expected: FAIL, exit 1, with:
```
.github/workflows/provision.yml:93:9: shellcheck reported issue in this script: SC2129:style:1:1: Consider using { cmd1; cmd2; } >> file instead of individual redirects [shellcheck]
```

If you get exit 0, `shellcheck` is not on `PATH` — actionlint silently skips inline-script linting. Fix the PATH and re-run.

- [ ] **Step 2: Fix `provision.yml`**

In the "Capture outputs" step, replace:

```yaml
        run: |
          echo "vps_ip=$(tofu output -raw vps_ip)" >> "$GITHUB_OUTPUT"
          echo "vps_ipv6=$(tofu output -raw vps_ipv6)" >> "$GITHUB_OUTPUT"
          echo "volume_id=$(tofu output -raw volume_id)" >> "$GITHUB_OUTPUT"
```

with:

```yaml
        run: |
          {
            echo "vps_ip=$(tofu output -raw vps_ip)"
            echo "vps_ipv6=$(tofu output -raw vps_ipv6)"
            echo "volume_id=$(tofu output -raw volume_id)"
          } >> "$GITHUB_OUTPUT"
```

- [ ] **Step 3: Verify the fix**

```bash
actionlint -color=false; echo "exit=$?"
```

Expected: PASS, exit 0, no output.

- [ ] **Step 4: Add the `workflows` job to `ci.yml`**

Insert immediately before the `ci-gate` job:

```yaml
  # ── GitHub Actions workflow definitions ─────────────────────────────────────
  workflows:
    name: Workflow lint
    needs: changes
    if: ${{ needs.changes.outputs.workflows == 'true' }}
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      # Run via `docker run` rather than `uses: docker://…`. This repo restricts
      # Actions to an allowlist (Settings → Actions → Allow select actions), and
      # that policy governs `uses:` references — including docker:// ones, whose
      # pattern syntax is awkward at best. A shell command is outside the policy
      # entirely, so this needs no allowlist entry and pins the image explicitly.
      #
      # The actionlint image bundles shellcheck and pyflakes, so inline `run:`
      # scripts are linted too — which a bare actionlint binary would skip.
      - name: Run actionlint
        run: |
          docker run --rm -v "$PWD:/repo" -w /repo \
            rhysd/actionlint:1.7.7 -color
```

- [ ] **Step 5: Add it to the gate**

Change `ci-gate`'s `needs:` line to:

```yaml
    needs: [changes, web, server, workflows]
```

- [ ] **Step 6: Verify the workflow file is still clean**

```bash
actionlint -color=false; echo "exit=$?"
```

Expected: PASS, exit 0.

- [ ] **Step 7: Commit and observe**

```bash
git add .github/workflows/ci.yml .github/workflows/provision.yml
git commit -m "ci: lint workflow definitions with actionlint

Adds a workflows job gated on .github/workflows/** changes. actionlint's
container image bundles shellcheck, so inline run: blocks are linted too;
that immediately flagged SC2129 in provision.yml's output capture, fixed
here.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push
gh pr checks --watch
```

Expected: `Workflow lint` runs (this commit touches `.github/workflows/**`) and passes; `CI gate` passes.

---

## Task 3: Dockerfile checks job

**Files:**
- Create: `.hadolint.yaml`
- Modify: `was-web/Dockerfile:65-72`
- Modify: `.github/workflows/ci.yml` (append a `dockerfile` job; add `dockerfile` to `ci-gate`'s `needs`)

**Interfaces:**
- Consumes: `needs.changes.outputs.dockerfile` from Task 1. That filter already lists `.hadolint.yaml`, so config changes re-trigger the job.
- Produces: job id `dockerfile`, display name `Dockerfile checks`.

- [ ] **Step 1: Reproduce the failure locally**

```bash
export PATH="/tmp/ci-tools:$PATH"
hadolint was-web/Dockerfile; echo "exit=$?"
```

Expected: FAIL, exit 1, exactly:
```
was-web/Dockerfile:41 DL3060 info: `yarn cache clean` missing after `yarn install` was run.
was-web/Dockerfile:72 DL3003 warning: Use WORKDIR to switch to a directory
```

- [ ] **Step 2: Fix DL3003 in the Dockerfile**

In stage 3 (`build-server`), replace:

```dockerfile
COPY server/src/ server/src/
COPY server/tsconfig.json server/tsup.config.ts server/
COPY packages/shared/src/ packages/shared/src/

RUN cd server && yarn build
```

with:

```dockerfile
COPY server/src/ server/src/
COPY server/tsconfig.json server/tsup.config.ts server/
COPY packages/shared/src/ packages/shared/src/

WORKDIR /app/server

RUN yarn build
```

The `COPY` lines must stay above the `WORKDIR` change — they are relative to `/app`, inherited from the `deps` stage. Stage 4 (`production`) sets its own `WORKDIR /app`, and stage 4's `COPY --from=build-server /app/server/dist/` uses an absolute path, so nothing downstream is affected.

- [ ] **Step 3: Create `.hadolint.yaml` at the repo root**

```yaml
# hadolint configuration — see https://github.com/hadolint/hadolint
#
# DL3060 (`yarn cache clean` missing after `yarn install`) fires on the deps
# stage, whose filesystem never reaches the shipped image: the production stage
# runs its own `yarn install --frozen-lockfile --production && yarn cache clean`.
# Cleaning the cache in a build-only stage would just slow the build down.
ignored:
  - DL3060
```

- [ ] **Step 4: Verify hadolint passes**

```bash
hadolint --config .hadolint.yaml was-web/Dockerfile; echo "exit=$?"
```

Expected: PASS, exit 0, no output. (This exact combination was confirmed to produce exit 0 while writing this plan.)

- [ ] **Step 5: Verify the entrypoint is ShellCheck-clean**

```bash
shellcheck was-web/server/docker-entrypoint.sh; echo "exit=$?"
```

Expected: PASS, exit 0, no output. Nothing to fix — this step exists so you know the CI step will pass and can tell a regression from a pre-existing problem.

- [ ] **Step 6: Add the `dockerfile` job to `ci.yml`**

Insert immediately before the `workflows` job:

```yaml
  # ── Container image definition: static checks only, no image build ──────────
  dockerfile:
    name: Dockerfile checks
    needs: changes
    if: ${{ needs.changes.outputs.dockerfile == 'true' }}
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Lint Dockerfile (hadolint)
        uses: hadolint/hadolint-action@v3.1.0
        with:
          dockerfile: was-web/Dockerfile
          config: .hadolint.yaml

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      # `call: check` runs BuildKit's own Dockerfile checks and resolves the
      # build graph without executing any stage — no image is built or pushed.
      # The build-arg values are placeholders: they only need to be non-empty
      # for ARG resolution, and nothing is compiled with them.
      - name: BuildKit build checks
        uses: docker/build-push-action@v6
        with:
          context: was-web/
          call: check
          build-args: |
            VITE_DEPLOY_ENV=test
            VITE_OIDC_ISSUER=https://oidc.invalid
            VITE_OIDC_CLIENT_ID=ci-static-check
            GIT_COMMIT=${{ github.sha }}

      - name: ShellCheck the container entrypoint
        run: shellcheck was-web/server/docker-entrypoint.sh
```

ShellCheck is pre-installed on `ubuntu-latest` runners, so the last step needs no setup action.

- [ ] **Step 7: Add it to the gate**

Change `ci-gate`'s `needs:` line to:

```yaml
    needs: [changes, web, server, dockerfile, workflows]
```

- [ ] **Step 8: Verify the workflow file, then commit**

```bash
actionlint -color=false; echo "exit=$?"    # expect exit 0
git add .hadolint.yaml was-web/Dockerfile .github/workflows/ci.yml
git commit -m "ci: statically validate the production Dockerfile

Adds a dockerfile job running hadolint, BuildKit's own build checks
(call: check — resolves the build graph without executing any stage), and
shellcheck on the container entrypoint. No image is built or pushed.

hadolint's DL3003 was a real finding: the build-server stage used
'RUN cd server && ...' instead of WORKDIR. DL3060 is suppressed in
.hadolint.yaml with the reason recorded there.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push
gh pr checks --watch
```

- [ ] **Step 9: Triage the BuildKit check step**

This is the one step whose outcome could not be predicted locally (no Docker daemon in the devcontainer). Read the `BuildKit build checks` step output in the run.

- If it passed: nothing to do.
- If it reported rule warnings (`JSONArgsRecommended` on the shell-form `HEALTHCHECK CMD` is the most likely candidate, since that command needs `|| exit 1`): decide per rule.
  - Genuine problem → fix the Dockerfile.
  - Deliberate, as with the `HEALTHCHECK` → add a skip directive as the **very first line** of `was-web/Dockerfile`, above the comment banner, with a comment above it explaining why:

    ```dockerfile
    # check=skip=JSONArgsRecommended
    ```

    Multiple rules are comma-separated: `# check=skip=RuleOne,RuleTwo`.
- If the `call:` input is rejected outright (it requires `docker/build-push-action` ≥ v6.6.0; `@v6` should resolve above that), replace that whole step with a direct invocation:

  ```yaml
      - name: BuildKit build checks
        working-directory: was-web
        run: |
          docker buildx build --check \
            --build-arg VITE_DEPLOY_ENV=test \
            --build-arg VITE_OIDC_ISSUER=https://oidc.invalid \
            --build-arg VITE_OIDC_CLIENT_ID=ci-static-check \
            --build-arg GIT_COMMIT="${{ github.sha }}" \
            .
  ```

- [ ] **Step 10: Commit any triage outcome**

Only if Step 9 required a change:

```bash
git add was-web/Dockerfile .github/workflows/ci.yml
git commit -m "ci: reconcile the Dockerfile with BuildKit build checks

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push
gh pr checks --watch
```

Expected: `Dockerfile checks` passes.

---

## Task 4: Ansible checks job

The one task with a genuinely open-ended failure set, because `ansible-lint` has never been run against this playbook and could not be installed in the devcontainer (no `pip`, no `python3-venv`).

**Files:**
- Create: `.ansible-lint`
- Modify: `ansible/rotate_secrets.sh:24`
- Modify: `ansible/playbook.yml` (findings-driven — see Step 5)
- Modify: `.github/workflows/ci.yml` (append an `ansible` job; add `ansible` to `ci-gate`'s `needs`)

**Interfaces:**
- Consumes: `needs.changes.outputs.ansible` from Task 1.
- Produces: job id `ansible`, display name `Ansible checks`.

- [ ] **Step 1: Reproduce the ShellCheck failure locally**

```bash
export PATH="/tmp/ci-tools:$PATH"
shellcheck ansible/*.sh; echo "exit=$?"
```

Expected: FAIL, exit 1, with:
```
In ansible/rotate_secrets.sh line 24:
cp /etc/wallandshadow/secrets /etc/wallandshadow/secrets.bak.$(date +%s)
                                                             ^---------^ SC2046 (warning): Quote this to prevent word splitting.
```

- [ ] **Step 2: Fix `ansible/rotate_secrets.sh`**

Replace line 24:

```bash
cp /etc/wallandshadow/secrets /etc/wallandshadow/secrets.bak.$(date +%s)
```

with:

```bash
cp /etc/wallandshadow/secrets "/etc/wallandshadow/secrets.bak.$(date +%s)"
```

- [ ] **Step 3: Verify**

```bash
shellcheck ansible/*.sh; echo "exit=$?"
```

Expected: PASS, exit 0, no output. (Confirmed while writing this plan.)

- [ ] **Step 4: Create `.ansible-lint` at the repo root**

Start with no skips. Skips get added in Step 5 only where justified, each with a reason.

```yaml
# ansible-lint configuration — see https://ansible.readthedocs.io/projects/lint/
#
# Only the VPS provisioning playbook is linted. Templates under
# ansible/templates/ are Jinja2 and are checked as part of the playbook that
# renders them, not standalone.
exclude_paths:
  - .github/
  - docs/
  - was-web/

# Rules deliberately not enforced. Add entries here only with a reason.
skip_list: []
```

- [ ] **Step 5: Run ansible-lint and triage**

There is no `pip` in this devcontainer, so run it in a throwaway container:

```bash
docker run --rm -v "$PWD:/w" -w /w python:3.12-slim bash -c \
  "pip install -q ansible ansible-lint && cd ansible && \
   ansible-playbook playbook.yml -i inventory.yml --syntax-check && \
   ansible-lint"; echo "exit=$?"
```

If no Docker daemon is reachable either, skip to Step 6, push, and read the failures from the CI run instead — the triage rules below are identical.

Expected findings, based on a static scan of `playbook.yml`:

| Likely rule | Where | Fix |
| --- | --- | --- |
| `no-changed-when` | tasks "Install AWS CLI v2" and "Copy PostgreSQL data to volume" (`ansible.builtin.command`) | Add an explicit `changed_when:` — these are one-shot install/copy steps, so `changed_when: true` is honest, or gate on the `creates:`/`stat` result already used nearby |
| `risky-file-permissions` | tasks "Clean up AWS CLI installer" and "Set volume data directory ownership" | Add an explicit `mode:` |
| `package-latest`, `jinja[spacing]`, `yaml[truthy]` | possible, playbook-wide | Fix in place; they are mechanical |

Triage rule: **fix the finding rather than skip it**, unless the fix would change what the playbook actually does on the VPS. This playbook provisions a live production host — a "fix" that alters file permissions or package versions for the sake of a linter is worse than a documented skip. When you skip, add the rule id to `skip_list` in `.ansible-lint` with a comment stating why, e.g.:

```yaml
skip_list:
  # The PostgreSQL data directory's ownership is set by the postgres packages
  # themselves; pinning a mode here would fight the package manager.
  - risky-file-permissions
```

Do not add a blanket skip list to make the job green. If more than about six distinct rules fire, stop and report back rather than suppressing them wholesale — that would mean this check is not earning its place and the scope decision should be revisited.

- [ ] **Step 6: Add the `ansible` job to `ci.yml`**

Insert immediately before the `ci-gate` job:

```yaml
  # ── Ansible provisioning ────────────────────────────────────────────────────
  ansible:
    name: Ansible checks
    needs: changes
    if: ${{ needs.changes.outputs.ansible == 'true' }}
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: "3.12"

      # The full `ansible` distribution, not `ansible-core`: the playbook uses
      # modules from ansible.posix, community.general and community.postgresql,
      # which --syntax-check needs to be able to resolve.
      - name: Install Ansible and ansible-lint
        run: pip install --disable-pip-version-check ansible ansible-lint

      - name: Playbook syntax check
        working-directory: ansible
        run: ansible-playbook playbook.yml -i inventory.yml --syntax-check

      - name: Lint playbook
        working-directory: ansible
        run: ansible-lint

      - name: ShellCheck ansible scripts
        run: shellcheck ansible/*.sh
```

`--syntax-check` parses and resolves the playbook without connecting to any host, so the `CONFIGURE_VPS_IP` placeholder in `inventory.yml` is harmless and no SSH key is needed.

- [ ] **Step 7: Add it to the gate**

Change `ci-gate`'s `needs:` line to:

```yaml
    needs: [changes, web, server, dockerfile, workflows, ansible]
```

- [ ] **Step 8: Verify the workflow file, then commit and observe**

```bash
actionlint -color=false; echo "exit=$?"    # expect exit 0
git add .ansible-lint ansible/ .github/workflows/ci.yml
git commit -m "ci: statically validate the Ansible provisioning playbook

Adds an ansible job running ansible-playbook --syntax-check, ansible-lint,
and shellcheck over ansible/*.sh. No host is contacted and no credentials
are needed.

shellcheck flagged SC2046 in rotate_secrets.sh (unquoted command
substitution in the backup path), fixed here.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push
gh pr checks --watch
```

Expected: `Ansible checks` passes. If ansible-lint fails in CI with findings you did not see locally, return to Step 5's triage rules, fix, and commit again.

---

## Task 5: OpenTofu checks job

**Files:**
- Modify: `infra/terraform.tfvars`
- Modify: `.github/workflows/ci.yml` (append an `infra` job; add `infra` to `ci-gate`'s `needs`)

**Interfaces:**
- Consumes: `needs.changes.outputs.infra` from Task 1.
- Produces: job id `infra`, display name `OpenTofu checks`.

- [ ] **Step 1: Reproduce the failure locally**

```bash
export PATH="/tmp/ci-tools:$PATH"
cd infra
tofu fmt -check -recursive -diff; echo "exit=$?"
```

Expected: FAIL, exit 3, with:
```
terraform.tfvars
--- old/terraform.tfvars
+++ new/terraform.tfvars
@@ -7,7 +7,7 @@
-location    = "hel1"
-server_type = "cx23"
+location     = "hel1"
+server_type  = "cx23"
 server_image = "ubuntu-24.04"
-volume_size = 10
+volume_size  = 10
```

- [ ] **Step 2: Fix the formatting**

```bash
tofu fmt -recursive
```

- [ ] **Step 3: Verify formatting and validity**

```bash
tofu fmt -check -recursive -diff; echo "fmt exit=$?"
tofu init -backend=false -input=false
tofu validate -no-color; echo "validate exit=$?"
```

Expected: `fmt exit=0` with no output. `validate exit=0` with `Success! The configuration is valid, but there were some validation warnings as shown above.` — the warning is `network.tf:9` reporting that `assignee_type` is now optional. **Leave it.** It is a warning, not an error; `validate` still exits 0; and removing an attribute from a live resource definition is an infrastructure change, not a CI change. It is recorded in the Follow-ups section below.

- [ ] **Step 4: Clean up the local init artifacts**

`tofu init` writes `.terraform/` and `.terraform.lock.hcl` into `infra/`. `.terraform/` is gitignored; the lock file is **not**, and is not currently committed. Do not commit it as a side effect of this task (see Follow-ups).

```bash
rm -rf .terraform .terraform.lock.hcl
cd ..
git status --short   # expect only infra/terraform.tfvars modified
```

- [ ] **Step 5: Add the `infra` job to `ci.yml`**

Insert immediately before the `ci-gate` job:

```yaml
  # ── OpenTofu infrastructure definitions ─────────────────────────────────────
  infra:
    name: OpenTofu checks
    needs: changes
    if: ${{ needs.changes.outputs.infra == 'true' }}
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Install OpenTofu
        uses: opentofu/setup-opentofu@v1
        with:
          tofu_version: "1.9"
          tofu_wrapper: false

      - name: Check formatting
        working-directory: infra
        run: tofu fmt -check -recursive -diff

      # -backend=false skips the S3 state backend entirely, so no Hetzner
      # Object Storage credentials are needed and no state is ever read or
      # written. Providers are still installed, which is what `validate` needs.
      - name: Initialise without backend
        working-directory: infra
        run: tofu init -backend=false -input=false

      - name: Validate configuration
        working-directory: infra
        run: tofu validate -no-color
```

If `tofu_wrapper` is rejected as an unknown input, simply delete that line — the wrapper only mirrors stdout into step outputs and does not mask exit codes.

- [ ] **Step 6: Add it to the gate**

Change `ci-gate`'s `needs:` line to its final form:

```yaml
    needs: [changes, web, server, dockerfile, workflows, ansible, infra]
```

- [ ] **Step 7: Verify the workflow file, then commit and observe**

```bash
actionlint -color=false; echo "exit=$?"    # expect exit 0
git add infra/terraform.tfvars .github/workflows/ci.yml
git commit -m "ci: statically validate the OpenTofu configuration

Adds an infra job running tofu fmt -check and tofu validate. init uses
-backend=false so the S3 state backend is never contacted and no Hetzner
credentials are required.

tofu fmt flagged misaligned assignments in terraform.tfvars, fixed here.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push
gh pr checks --watch
```

Expected: `OpenTofu checks` passes.

---

## Task 6 (optional): Remove the dead `run_docker.sh`

Adjacent to the goal rather than part of it — include it or drop it as you prefer. It is *not* covered by any job added above (the ShellCheck steps are scoped to `was-web/server/docker-entrypoint.sh` and `ansible/*.sh`), so nothing in CI depends on this.

The rationale: `run_docker.sh` runs `docker-compose up` against a `docker-compose.yml` that does not exist anywhere in the repo, and attaches to a container named `hexland_hexland_1` from before the project was renamed. It also contains a real bug (`SC2145`: `RUN_TEST_ARGS=${@:2}` mixes a string and an array), which is moot because the script cannot run. CLAUDE.md's "No dead code" standard applies.

**Files:**
- Delete: `run_docker.sh`

- [ ] **Step 1: Confirm it is genuinely dead**

```bash
ls docker-compose.yml was-web/docker-compose.yml 2>&1
grep -rn "run_docker" --include='*.md' --include='*.json' --include='*.yml' . | grep -v node_modules
```

Expected: no compose file exists, and no documentation or tooling references the script. If either turns up a reference, stop and skip this task.

- [ ] **Step 2: Delete and commit**

```bash
git rm run_docker.sh
git commit -m "chore: remove dead run_docker.sh

Drives a docker-compose.yml that no longer exists and attaches to a
hexland_hexland_1 container from before the project rename. Superseded by
the devcontainer.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push
```

---

## Task 7: Documentation and enabling the required check

**Files:**
- Modify: `docs/REPLATFORM.md:213-221`
- Modify: `CONTRIBUTING.md:11-14`

- [ ] **Step 1: Rewrite the CI Pipeline section of `docs/REPLATFORM.md`**

Replace the section that currently reads:

````markdown
### CI Pipeline

```
on: push to main / pull_request

jobs:
  ci:           lint · test:unit · test:server (against real PostgreSQL + MinIO)
  ci-server:    server lint · tsc · test
  build:        multi-arch image (amd64 + arm64) → ghcr.io/OWNER/wallandshadow:SHA
  deploy:       SSH → flip image tag → systemctl restart  (push to main only)
```
````

with:

````markdown
### CI Pipeline

`.github/workflows/ci.yml` is the single CI workflow. It runs on **every** pull
request into `main` with no `paths:` filter, so it always reports — which is what
lets `CI gate` be a required status check in branch protection.

Path filtering happens *inside* the workflow. A leading `changes` job
(`dorny/paths-filter`) emits one boolean per area; each verification job is
skipped when its files are untouched. The terminal `ci-gate` job depends on all
of them with `if: always()` and fails only on `failure` or `cancelled` — a
skipped job counts as a pass.

```
on: pull_request → main   (always runs)
    workflow_call         (force_all: true — used by the deploy workflows)

jobs:
  changes      always      →  web / server / dockerfile / workflows / ansible / infra booleans
  web          if web      →  yarn build · yarn lint · yarn test · yarn test:shared
  server       if server   →  tsc --noEmit · lint · drizzle-kit push · test
                              (against real PostgreSQL 17 + MinIO service containers)
  dockerfile   if docker   →  hadolint · BuildKit build checks · shellcheck entrypoint
  workflows    if wf       →  actionlint (with shellcheck on inline run: blocks)
  ansible      if ansible  →  ansible-playbook --syntax-check · ansible-lint · shellcheck
  infra        if infra    →  tofu fmt -check · tofu validate (-backend=false)
  ci-gate      always      →  REQUIRED CHECK — fails if any job above failed
```

The deployment jobs are statically validated only: **no image is built or pushed
by CI**, and no job requires a secret, so the whole workflow runs on fork pull
requests. `tofu init -backend=false` is what keeps the OpenTofu check free of
Hetzner credentials.

Deploys are separate workflows. `deploy-server-test.yml` (push to `main`) and
`deploy-server-production.yml` (manual) build the multi-arch image, push it to
`ghcr.io/OWNER/wallandshadow:SHA`, and SSH to the VPS to flip the image tag and
restart the systemd unit. The test deploy calls `ci.yml` with `force_all: true`
first, so every verification runs before anything ships.
````

- [ ] **Step 2: Update `CONTRIBUTING.md`**

In the "Before opening a pull request" section, after the existing sentence about running `yarn lint`, `yarn build`, and the test suites, add:

```markdown
Every pull request into `main` runs the `CI` workflow, which must report a
passing **CI gate** check before the PR can be merged. CI skips the checks whose
files you did not touch, so a docs-only PR will show most jobs as skipped — that
is expected, and the gate still passes.
```

- [ ] **Step 3: Commit**

```bash
git add docs/REPLATFORM.md CONTRIBUTING.md
git commit -m "docs: describe the unified CI workflow and required gate

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push
gh pr checks --watch
```

Expected: only `Detect changed areas` and `CI gate` run — a docs-only commit matches no filter. This is the end-to-end proof that skip-as-pass works.

### Steps 4 and 5 are the repo owner's to run — not an implementer's

Execution of this plan stops after Step 3. Merging to `main` and editing branch
protection are hard to reverse on a live repository, so they are handed back
rather than automated. **An implementer subagent must not run `gh pr merge`, must
not call the branch-protection API, and must not open the smoke-test PR.** The
remaining steps are written for the repo owner.

- [ ] **Step 4 (owner): Merge, then enable the required check**

Branch protection can only require a check name GitHub has already observed, so this must happen **after** the PR merges and `ci.yml` exists on `main`.

```bash
gh pr merge --squash
```

Then, in the repository settings:

`main` **already has a protection rule** with `CodeQL` as a required status check
and `strict: true`. You are adding to that list, not replacing it.

1. **Settings → Branches → Branch protection rules →** edit the existing rule for `main`.
2. Under **Require status checks to pass before merging**, leave `CodeQL` selected.
3. In the search box, type `CI gate` and add it. Add *only* the gate — the
   individual CI jobs must not be required, because a legitimately skipped job
   would then block the merge forever.
4. Save.

The UI is the reliable route here. If you prefer the CLI, note that the
sub-resource takes `PATCH` (not `PUT`), that the payload has to be real JSON —
so pipe it in rather than trying to express nested objects with `-f`/`-F` — and
above all that **`checks` replaces the whole list**. Enumerate the existing
checks alongside the new one or you will silently drop CodeQL:

```bash
# Confirm what is currently required before changing anything.
gh api repos/KaiEkkrin/wallandshadow/branches/main/protection/required_status_checks \
  --jq '{strict, checks}'

echo '{"strict": true, "checks": [{"context": "CodeQL"}, {"context": "CI gate"}]}' | \
  gh api -X PATCH \
    repos/KaiEkkrin/wallandshadow/branches/main/protection/required_status_checks \
    --input -
```

Note that CodeQL is configured through GitHub's default setup rather than a
workflow file in `.github/workflows/`, which is why it does not appear in this
plan's file inventory. It is unaffected by everything else here.

- [ ] **Step 5 (owner): Verify the gate actually gates**

Open a throwaway PR that deliberately fails one job and confirm merge is blocked, then close it.

```bash
git checkout -b ci-gate-smoke-test main
# Missing spaces around `=` — tofu fmt -check rejects it. Nothing reads this
# variable, so `tofu validate` is unaffected and only the fmt step fails.
printf '\n# smoke test\nsmoke_test_value=99\n' >> infra/terraform.tfvars
git commit -am "test: deliberately break tofu fmt (do not merge)"
git push -u origin ci-gate-smoke-test
gh pr create --base main --title "DO NOT MERGE: CI gate smoke test" --body "Verifying the required check blocks merges. Close without merging."
gh pr checks --watch
```

Expected: `OpenTofu checks` fails, `CI gate` fails, and the PR shows "Required statuses must pass before merging". Then:

```bash
gh pr close ci-gate-smoke-test --delete-branch
git checkout main
```

---

## Follow-ups (deliberately not done here)

Recorded because they were noticed while establishing the findings above, but each is a decision outside this plan's scope. Raise them with the repo owner rather than folding them in.

- **`infra/.terraform.lock.hcl` is not committed**, although `infra/versions.tf` says "`.terraform.lock.hcl` is committed to the repo (like a lockfile)". It is not gitignored either — it simply was never added. Consequence for CI: `tofu init` in the `infra` job resolves the newest provider matching `~> 1.49` on every run, so a new `hetznercloud/hcloud` release could fail an unrelated PR. Committing the lock file would fix that, but it also pins what `provision.yml` applies to real infrastructure, so it is the owner's call.
- **`network.tf:9` `assignee_type = "server"`** is reported by `tofu validate` as a no-longer-required attribute. Non-fatal (validate exits 0). Removing it edits a live resource definition and belongs in an infrastructure change, not a CI change.
- **End-to-end Playwright tests never run in CI.** `yarn test:e2e` exists and needs both dev servers running. Adding it would materially change CI runtime and was not requested.
- **No image build in CI.** Per the 2026-07-25 decision, PR CI validates the Dockerfile statically only. A Dockerfile can therefore pass every check here and still fail to build; that is first discovered by the test deploy. If that bites, the cheapest upgrade is a single-arch `linux/amd64` build with `push: false` reusing the existing `type=gha` cache.

---

## Appendix: why the gate job rather than requiring each job

GitHub's branch protection matches required checks by name. If the six verification jobs were each required, a PR that touches only `ansible/` would leave `Web build / lint / test` skipped — and a check that never reports cannot satisfy a requirement, so the PR would sit unmergeable forever. The `ci-gate` job sidesteps this by always running (`if: always()`) and reading `needs.*.result`, where the possible values are `success`, `failure`, `cancelled`, and `skipped`. Only the middle two fail the gate. `changes` is included in the gate's `needs` so that a broken change-detection job cannot silently let a PR through with every verification skipped.
