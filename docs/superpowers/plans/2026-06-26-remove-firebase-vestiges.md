# Remove Firebase Vestiges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every remaining trace of the retired Firebase deployment from `main` — the Firebase GitHub Actions workflows and their setup doc, the legacy deployment guide — and scrub all documentation so it describes only the current Hono + PostgreSQL + Hetzner architecture, with no mention of Firebase or the `legacy-firebase` branch.

**Architecture:** This is a deletion-and-edit task, not a code task. We delete four workflow files and two docs, rename the architecture doc, and rewrite the handful of inbound references and stray Firebase comments. "Tests" here are `ripgrep` sweeps that prove no Firebase/`legacy-firebase`/`replatform` references survive and no markdown links dangle.

**Tech Stack:** Markdown docs, GitHub Actions YAML, a TypeScript comment, a `robots.txt` asset. Verification via `rg` (ripgrep) and `yarn lint`.

**Decisions locked in (from brainstorming):**
- **Scrub everything** — remove *all* mentions of Firebase and the `legacy-firebase` branch from docs (no breadcrumb pointer retained).
- **Rename** `docs/REPLATFORM.md` → `docs/ARCHITECTURE.md` and fix every inbound reference.

**Ordering note:** Tasks 1–3 delete/rename files, so between Task 1 and Task 8 there is a transient window where some markdown links point at moved/deleted files. This is expected and acceptable with per-task commits; the final verification sweep in Task 8 is the gate that proves no dangling reference survives. Execute tasks in order.

---

## File-by-File Map

**Delete (Firebase workflows):**
- `.github/workflows/deploy-firebase.yml` — reusable Firebase deploy workflow
- `.github/workflows/deploy-test.yml` — Firebase test-deploy caller (triggers on `legacy-firebase`)
- `.github/workflows/deploy-production.yml` — Firebase prod-deploy caller
- `.github/workflows/ENVIRONMENTS-SETUP.md` — Firebase service-account / GitHub Environments setup guide

**Delete (docs):**
- `docs/LEGACY_FIREBASE_DEPLOY.md` — retired Firebase deployment guide

**Rename:**
- `docs/REPLATFORM.md` → `docs/ARCHITECTURE.md` (also strip its one Firebase/legacy paragraph)

**Edit (scrub Firebase + fix `REPLATFORM.md` → `ARCHITECTURE.md` links):**
- `README.md`
- `CLAUDE.md`
- `docs/DEVELOPMENT.md`
- `docs/EPHEMERAL_WS.md`
- `docs/INFRASTRUCTURE_BOOTSTRAP.md`
- `docs/architecture/README.md`
- `docs/ANALYTICS.md`

**Edit (stray Firebase references in non-doc files):**
- `was-web/public/robots.test.txt` — comment references `firebase.test.json`
- `was-web/packages/shared/src/data/types.ts` — comment references the "Firestore era"

**Housekeeping (untracked):**
- `was-web/functions/` — empty but for `node_modules` (not git-tracked); delete from disk

---

### Task 1: Delete the Firebase GitHub Actions workflows

These four files are the Firebase deployment pipeline and its setup guide. `deploy-test.yml` and `deploy-production.yml` both call the reusable `deploy-firebase.yml`; `ENVIRONMENTS-SETUP.md` documents the Firebase service-account secrets they need. Nothing in the surviving Hetzner workflows (`ci.yml`, `ci-server.yml`, `deploy-server-test.yml`, `deploy-server-production.yml`, `provision.yml`) references any of them.

**Files:**
- Delete: `.github/workflows/deploy-firebase.yml`
- Delete: `.github/workflows/deploy-test.yml`
- Delete: `.github/workflows/deploy-production.yml`
- Delete: `.github/workflows/ENVIRONMENTS-SETUP.md`

- [ ] **Step 1: Confirm no surviving workflow or doc (other than the files being deleted and `LEGACY_FIREBASE_DEPLOY.md`) references these files**

Run:
```bash
cd /workspaces/wallandshadow
rg -n 'deploy-firebase|deploy-test\.yml|deploy-production\.yml|ENVIRONMENTS-SETUP' \
  --glob '!.git/**' --glob '!node_modules/**' \
  --glob '!.github/workflows/deploy-test.yml' \
  --glob '!.github/workflows/deploy-production.yml' \
  --glob '!.github/workflows/deploy-firebase.yml'
```
Expected: only matches inside `docs/LEGACY_FIREBASE_DEPLOY.md` (which Task 2 deletes). No other file. If anything else matches, stop and reassess.

- [ ] **Step 2: Delete the four files**

Run:
```bash
cd /workspaces/wallandshadow
git rm .github/workflows/deploy-firebase.yml \
       .github/workflows/deploy-test.yml \
       .github/workflows/deploy-production.yml \
       .github/workflows/ENVIRONMENTS-SETUP.md
```
Expected: `rm '.github/workflows/...'` printed for all four.

- [ ] **Step 3: Verify the workflows directory now contains only the Hetzner/CI workflows**

Run: `ls .github/workflows/`
Expected output (exactly these five files, in some order):
```
ci-server.yml
ci.yml
deploy-server-production.yml
deploy-server-test.yml
provision.yml
```
If `deploy-firebase.yml`, `deploy-test.yml`, `deploy-production.yml`, or `ENVIRONMENTS-SETUP.md` still appear, the delete failed.

- [ ] **Step 4: Commit**

```bash
cd /workspaces/wallandshadow
git add -A .github/workflows/
git commit -m "ci: remove retired Firebase deployment workflows"
```

---

### Task 2: Delete the legacy Firebase deployment guide

`docs/LEGACY_FIREBASE_DEPLOY.md` documents the retired Firebase deploy process. The only inbound links to it are in `README.md` and `CLAUDE.md`, which are scrubbed in Tasks 4 and 5.

**Files:**
- Delete: `docs/LEGACY_FIREBASE_DEPLOY.md`

- [ ] **Step 1: Delete the file**

Run:
```bash
cd /workspaces/wallandshadow
git rm docs/LEGACY_FIREBASE_DEPLOY.md
```
Expected: `rm 'docs/LEGACY_FIREBASE_DEPLOY.md'`.

- [ ] **Step 2: Verify it is gone**

Run: `ls docs/`
Expected: `LEGACY_FIREBASE_DEPLOY.md` is absent. Remaining docs: `ANALYTICS.md`, `DEVELOPMENT.md`, `EPHEMERAL_WS.md`, `INFRASTRUCTURE_BOOTSTRAP.md`, `Medium_Term_Updates.md`, `PR-353-FOLLOWUP.md`, `REPLATFORM.md`, `ZITADEL_OIDC_SETUP.md`, `architecture/` (`REPLATFORM.md` is renamed in Task 3).

- [ ] **Step 3: Commit**

```bash
cd /workspaces/wallandshadow
git commit -m "docs: delete retired Firebase deployment guide"
```

---

### Task 3: Rename `REPLATFORM.md` to `ARCHITECTURE.md` and strip its Firebase paragraph

The architecture doc is currently named for the replatforming effort. Rename it to reflect that it now describes only the current architecture, and remove the one paragraph that points at the legacy Firebase code. Inbound link fixes happen in Tasks 4–7.

**Files:**
- Rename: `docs/REPLATFORM.md` → `docs/ARCHITECTURE.md`
- Modify: `docs/ARCHITECTURE.md` (remove the Firebase/legacy paragraph near the top)

- [ ] **Step 1: Rename the file with git**

Run:
```bash
cd /workspaces/wallandshadow
git mv docs/REPLATFORM.md docs/ARCHITECTURE.md
```
Expected: no output (success).

- [ ] **Step 2: Remove the Firebase/legacy paragraph**

In `docs/ARCHITECTURE.md`, near the top (just after the `**Stack**:` line), delete this two-line paragraph in full:

```markdown
The original Firebase codebase lives on the `legacy-firebase` branch and is not described
here. See `docs/LEGACY_FIREBASE_DEPLOY.md` for its deployment guide.
```

Remove the paragraph and the now-redundant blank line so the `**Stack**:` line is followed by the existing `---` separator with a single blank line between them. Use the Edit tool: match the `**Stack**:` line plus the blank line plus the two-line paragraph, and replace with just the `**Stack**:` line.

- [ ] **Step 3: Verify no Firebase or `LEGACY_FIREBASE_DEPLOY` reference remains in the renamed doc**

Run:
```bash
cd /workspaces/wallandshadow
rg -in 'firebase|firestore|legacy_firebase|legacy-firebase' docs/ARCHITECTURE.md
```
Expected: no output (exit code 1).

- [ ] **Step 4: Verify the old filename is gone and the new one exists**

Run: `ls docs/ARCHITECTURE.md docs/REPLATFORM.md 2>&1`
Expected: `docs/ARCHITECTURE.md` exists; `docs/REPLATFORM.md` reports "No such file or directory".

- [ ] **Step 5: Commit**

```bash
cd /workspaces/wallandshadow
git add -A docs/
git commit -m "docs: rename REPLATFORM.md to ARCHITECTURE.md and drop Firebase pointer"
```

---

### Task 4: Scrub Firebase from `README.md` and fix architecture links

`README.md` has three Firebase/legacy references plus three links to `REPLATFORM.md`.

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Remove the Firebase legacy-stack sentence from the Tech Stack section**

Delete this line in full (it is the last line of the "## Tech Stack" section):

```markdown
The original Firebase stack (Firestore, Cloud Functions, Firebase Auth, Firebase Hosting, Firebase Storage) lives on the `legacy-firebase` branch. See [docs/REPLATFORM.md](docs/REPLATFORM.md) for the migration story.
```

Also remove the now-empty trailing blank line it leaves behind, so the Tech Stack bullet list is followed directly by the next `## Getting started` heading (with one blank line of separation).

- [ ] **Step 2: Update the `REPLATFORM.md` row in the Documentation table**

Replace:
```markdown
| [docs/REPLATFORM.md](docs/REPLATFORM.md) | Current architecture and the Firebase → Hetzner migration |
```
with:
```markdown
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Current architecture and deployment |
```

- [ ] **Step 3: Remove the `LEGACY_FIREBASE_DEPLOY.md` row from the Documentation table**

Delete this table row in full:
```markdown
| [docs/LEGACY_FIREBASE_DEPLOY.md](docs/LEGACY_FIREBASE_DEPLOY.md) | Retired Firebase deployment (`legacy-firebase` branch only) |
```

- [ ] **Step 4: Fix the architecture link in the Deployment section**

Replace:
```markdown
See [docs/REPLATFORM.md](docs/REPLATFORM.md) for the deployment architecture and [docs/INFRASTRUCTURE_BOOTSTRAP.md](docs/INFRASTRUCTURE_BOOTSTRAP.md) for first-time VPS bootstrap.
```
with:
```markdown
See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the deployment architecture and [docs/INFRASTRUCTURE_BOOTSTRAP.md](docs/INFRASTRUCTURE_BOOTSTRAP.md) for first-time VPS bootstrap.
```

- [ ] **Step 5: Verify `README.md` is clean**

Run:
```bash
cd /workspaces/wallandshadow
rg -in 'firebase|firestore|replatform|legacy-firebase' README.md
```
Expected: no output (exit code 1).

- [ ] **Step 6: Commit**

```bash
cd /workspaces/wallandshadow
git add README.md
git commit -m "docs: scrub Firebase references from README"
```

---

### Task 5: Scrub Firebase from `CLAUDE.md` and fix architecture links

`CLAUDE.md` (project instructions) has the "Firebase-free" line, two `REPLATFORM.md` references, and the `LEGACY_FIREBASE_DEPLOY.md` bullet.

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Fix the architecture link in the Project Overview Stack line**

Replace `See @docs/REPLATFORM.md for architecture details.` with `See @docs/ARCHITECTURE.md for architecture details.` (in the `**Stack**:` paragraph under "## Project Overview").

- [ ] **Step 2: Remove the Firebase-branch line**

Delete this line in full (it follows the Stack paragraph in "## Project Overview"):
```markdown
The Firebase codebase lives on the `legacy-firebase` branch. `main` is Firebase-free.
```
Remove the surrounding blank line too so the Stack paragraph flows into "## Directory Structure" with single-blank-line separation.

- [ ] **Step 3: Fix the `REPLATFORM.md` bullet in the Additional Documentation section**

Replace:
```markdown
- @docs/REPLATFORM.md — current architecture and deployment details
```
with:
```markdown
- @docs/ARCHITECTURE.md — current architecture and deployment details
```

- [ ] **Step 4: Remove the legacy Firebase doc bullet**

Delete this bullet in full from the Additional Documentation section:
```markdown
- @docs/LEGACY_FIREBASE_DEPLOY.md — applies only to the `legacy-firebase` branch
```

- [ ] **Step 5: Verify `CLAUDE.md` is clean**

Run:
```bash
cd /workspaces/wallandshadow
rg -in 'firebase|firestore|replatform|legacy-firebase' CLAUDE.md
```
Expected: no output (exit code 1).

- [ ] **Step 6: Commit**

```bash
cd /workspaces/wallandshadow
git add CLAUDE.md
git commit -m "docs: scrub Firebase references from CLAUDE.md"
```

---

### Task 6: Fix remaining `REPLATFORM.md` references and `replatform` framing in other docs

Five docs still reference the renamed file or use replatforming/migration framing: `docs/DEVELOPMENT.md`, `docs/EPHEMERAL_WS.md`, `docs/INFRASTRUCTURE_BOOTSTRAP.md`, `docs/architecture/README.md`, and `docs/ANALYTICS.md`.

**Files:**
- Modify: `docs/DEVELOPMENT.md`
- Modify: `docs/EPHEMERAL_WS.md`
- Modify: `docs/INFRASTRUCTURE_BOOTSTRAP.md`
- Modify: `docs/architecture/README.md`
- Modify: `docs/ANALYTICS.md`

- [ ] **Step 1: `docs/DEVELOPMENT.md` — fix the architecture link**

Replace:
```markdown
[README](../README.md) and [REPLATFORM.md](REPLATFORM.md). For first-time setup
```
with:
```markdown
[README](../README.md) and [ARCHITECTURE.md](ARCHITECTURE.md). For first-time setup
```

- [ ] **Step 2: `docs/EPHEMERAL_WS.md` — reword the opening line to drop migration framing and fix the path**

Replace:
```markdown
Broken out of @docs/REPLATFORM.md during Phase 4. The original replatforming plan
anticipated bidirectional ephemeral messages on the map WebSocket for live collaboration
cues. Those messages were never implemented and nothing currently depends on them. This
document captures the motivation and the shape of the work so we can decide later whether
to build it.
```
with:
```markdown
Broken out of @docs/ARCHITECTURE.md. The architecture anticipated bidirectional ephemeral
messages on the map WebSocket for live collaboration cues. Those messages were never
implemented and nothing currently depends on them. This document captures the motivation
and the shape of the work so we can decide later whether to build it.
```

- [ ] **Step 3: `docs/EPHEMERAL_WS.md` — fix the second `REPLATFORM.md` reference**

Replace:
```markdown
frames (see @docs/REPLATFORM.md "WebSocket Room Model"), but no *ephemeral* message
```
with:
```markdown
frames (see @docs/ARCHITECTURE.md "WebSocket Room Model"), but no *ephemeral* message
```

- [ ] **Step 4: `docs/INFRASTRUCTURE_BOOTSTRAP.md` — fix the architecture link**

Replace:
```markdown
We do not send email from the application today (password reset is admin-only — see @docs/REPLATFORM.md), so MX is omitted.
```
with:
```markdown
We do not send email from the application today (password reset is admin-only — see @docs/ARCHITECTURE.md), so MX is omitted.
```

- [ ] **Step 5: `docs/architecture/README.md` — fix the architecture link**

Replace `docs/REPLATFORM.md` with `docs/ARCHITECTURE.md` in the line:
```markdown
See also `docs/REPLATFORM.md` for the overall stack and deployment
```

- [ ] **Step 6: `docs/ANALYTICS.md` — reword the `replatform` reference**

Replace:
```markdown
1. **Self-hosted and EU-resident.** Same rationale as the rest of the replatform: no
```
with:
```markdown
1. **Self-hosted and EU-resident.** Same rationale as the rest of the self-hosted stack: no
```

- [ ] **Step 7: Verify all five docs are clean of `replatform`/Firebase and dangling `REPLATFORM.md` links**

Run:
```bash
cd /workspaces/wallandshadow
rg -in 'firebase|firestore|replatform' docs/DEVELOPMENT.md docs/EPHEMERAL_WS.md docs/INFRASTRUCTURE_BOOTSTRAP.md docs/architecture/README.md docs/ANALYTICS.md
```
Expected: no output (exit code 1).

- [ ] **Step 8: Commit**

```bash
cd /workspaces/wallandshadow
git add docs/DEVELOPMENT.md docs/EPHEMERAL_WS.md docs/INFRASTRUCTURE_BOOTSTRAP.md docs/architecture/README.md docs/ANALYTICS.md
git commit -m "docs: retarget architecture links to ARCHITECTURE.md and drop replatform framing"
```

---

### Task 7: Scrub stray Firebase references in non-doc files

Two non-doc files still name Firebase: a comment in the test `robots.txt` and a comment in shared TypeScript. Also remove the orphaned `was-web/functions/` directory (untracked; holds only `node_modules`).

**Files:**
- Modify: `was-web/public/robots.test.txt`
- Modify: `was-web/packages/shared/src/data/types.ts`
- Delete (untracked, disk only): `was-web/functions/`

- [ ] **Step 1: `was-web/public/robots.test.txt` — drop the `firebase.test.json` reference**

Replace:
```
# 1. X-Robots-Tag HTTP header (set in firebase.test.json)
```
with:
```
# 1. X-Robots-Tag HTTP header (set by the web server)
```

- [ ] **Step 2: `was-web/packages/shared/src/data/types.ts` — reword the Firestore-era comment**

Replace:
```typescript
// Legacy abstract timestamp type carried over from the Firestore era. Records
// read from PostgreSQL use numeric milliseconds; the object union branch is
// retained for schema rows that still carry an opaque server-side timestamp.
```
with:
```typescript
// Abstract timestamp type. Records read from PostgreSQL use numeric
// milliseconds; the object union branch is retained for schema rows that still
// carry an opaque server-side timestamp.
```

- [ ] **Step 3: Remove the orphaned `functions/` directory from disk**

This directory is not git-tracked (it contains only an ignored `node_modules`), so this is a local-disk cleanup, not a git change.

Run:
```bash
cd /workspaces/wallandshadow
rm -rf was-web/functions
ls was-web/functions 2>&1 || echo "removed"
```
Expected: `removed` (directory gone). `git status` will not show this — that is correct.

- [ ] **Step 4: Verify both edited files are clean**

Run:
```bash
cd /workspaces/wallandshadow
rg -in 'firebase|firestore' was-web/public/robots.test.txt was-web/packages/shared/src/data/types.ts
```
Expected: no output (exit code 1).

- [ ] **Step 5: Lint the shared package to confirm the comment edit didn't break anything**

Run:
```bash
cd /workspaces/wallandshadow/was-web && yarn lint
```
Expected: lint passes (no errors). A comment-only change cannot introduce a type/lint error; this is a sanity gate.

- [ ] **Step 6: Commit**

```bash
cd /workspaces/wallandshadow
git add was-web/public/robots.test.txt was-web/packages/shared/src/data/types.ts
git commit -m "chore: remove stray Firebase references from assets and shared types"
```

---

### Task 8: Final verification sweep

Prove the whole repository is free of Firebase, `legacy-firebase`, and `replatform` references, and that no markdown link points at a deleted/renamed file.

**Files:** none (verification only)

- [ ] **Step 1: Repo-wide sweep for Firebase / Firestore / replatform / REPLATFORM**

Run:
```bash
cd /workspaces/wallandshadow
rg -in 'firebase|firestore|replatform' --glob '!.git/**' --glob '!node_modules/**' --glob '!docs/superpowers/**'
```
Expected: no output (exit code 1). The `docs/superpowers/**` exclusion skips this plan document itself (which legitimately contains the words). If anything else matches, scrub it before proceeding.

- [ ] **Step 2: Confirm no dangling links to deleted/renamed files**

Run:
```bash
cd /workspaces/wallandshadow
rg -n 'REPLATFORM\.md|LEGACY_FIREBASE_DEPLOY|ENVIRONMENTS-SETUP|deploy-firebase|deploy-test\.yml|deploy-production\.yml' \
  --glob '!.git/**' --glob '!node_modules/**' --glob '!docs/superpowers/**'
```
Expected: no output (exit code 1).

- [ ] **Step 3: Confirm the renamed doc exists and the workflows directory is clean**

Run:
```bash
cd /workspaces/wallandshadow
test -f docs/ARCHITECTURE.md && echo "ARCHITECTURE.md: OK"
test ! -f docs/REPLATFORM.md && echo "REPLATFORM.md: gone"
ls .github/workflows/
```
Expected: `ARCHITECTURE.md: OK`, `REPLATFORM.md: gone`, and the workflows listing shows only `ci.yml`, `ci-server.yml`, `deploy-server-production.yml`, `deploy-server-test.yml`, `provision.yml`.

- [ ] **Step 4: Confirm the working tree is committed**

Run: `cd /workspaces/wallandshadow && git status --short`
Expected: empty output (all changes committed; the untracked `functions/` removal leaves nothing behind).

- [ ] **Step 5: Review the full diff against `main`**

Run: `cd /workspaces/wallandshadow && git log --oneline main..HEAD && git diff --stat main..HEAD`
Expected: the commit series from Tasks 1–7, and a diff stat showing the deleted workflows, deleted/renamed docs, and edited reference files — and nothing unexpected.
