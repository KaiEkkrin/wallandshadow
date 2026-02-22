# /tmp Permission Failure in Podman Dev Container

## Symptom

Every attempt to start the dev container fails during VS Code's post-build setup step with:

```
mkdir: cannot create directory '/tmp/.X11-unix': Permission denied
```

VS Code's Remote Containers extension tries to create `/tmp/.X11-unix` for X11 socket
forwarding. The `node` user inside the container cannot write to `/tmp`.

## Environment

- Host OS: Fedora 43 (Linux 6.18, SELinux enforcing)
- Container runtime: Podman (rootless)
- Base image: `mcr.microsoft.com/devcontainers/typescript-node:20-trixie` (Debian trixie)
- devcontainer features: `ghcr.io/devcontainers/features/git:1`, `ghcr.io/devcontainers/features/github-cli:1`

## What Was Tried (and Failed)

### Attempt 1 — Replace `--ipc=host` with `--shm-size=2g`

**Hypothesis**: `--ipc=host` in Podman rootless causes `/tmp` to be unwritable due to an
SELinux + IPC namespace interaction.

**Result**: No change. Identical error on the next container start.

### Attempt 2 — Set `updateRemoteUserUID: false`

**Hypothesis**: With `--userns=keep-id`, setting `updateRemoteUserUID: true` causes VS Code
to run `usermod` as the container's effective root. Under Podman's rootless user namespace
this produces a broken UID mapping that makes `/tmp` unwritable.

Evidence came from a working project (ThirteenIsh) that uses `updateRemoteUserUID: false`,
`--userns=keep-id`, and an Ubuntu base image — and has no `/tmp` issues.

**Result**: No change. Identical error.

## Root Cause

The true root cause is a **crun >= 1.11 regression** tracked in:

- [containers/crun#1240](https://github.com/containers/crun/issues/1240)
- [containers/podman#20754](https://github.com/containers/podman/issues/20754)
- [devcontainers/features#755](https://github.com/devcontainers/features/issues/755)

### Mechanism

When devcontainer features (`git:1`, `github-cli:1`) are installed, the devcontainer CLI
uses **buildah** + **crun** to run the feature install scripts in a series of intermediate
containers, each producing a new overlay filesystem layer written into the final image.

The feature install scripts run as **root** with default `umask 022`. When crun writes
directory entries into a new overlay layer, the regression causes it to **inherit
permissions from the underlying directory** rather than preserving the mode of the
directory being written.

`/tmp` in the Debian base image is `drwxrwxrwt` (mode `1777`, sticky bit). The feature
build writes a new overlay layer that includes `/tmp`. With the regression, the new layer
records `/tmp` as `drwxr-xr-x` (mode `0755`, root-owned) — the sticky+world-write bits
are stripped by the umask.

**Result**: the final built image has `/tmp` at mode `0755`. Only the `root` user (UID 0)
can create files in it. The `node` user cannot, so VS Code's `mkdir /tmp/.X11-unix` fails.

### Why ThirteenIsh Is Not Affected

The working project uses:
- `mcr.microsoft.com/devcontainers/base:ubuntu` — Ubuntu 24.04 base
- No Java, no large feature installs that touch `/tmp` in a new layer

Its feature build either does not write a new `/tmp` entry into an overlay layer, or the
layer write does not exhibit the regression for that image combination. The Debian trixie
base with the Java + ImageMagick layers in this project's `Dockerfile` creates conditions
where the regression is triggered.

### Why Earlier Fixes Had No Effect

- Replacing `--ipc=host` with `--shm-size=2g`: correct for shared memory, but unrelated
  to the `/tmp` mode problem.
- Setting `updateRemoteUserUID: false`: correct for Podman rootless UID mapping, but
  does not change the broken `/tmp` mode baked into the image.

Both changes were correct and necessary but neither addressed the root cause.

## Fix Applied

Added `--tmpfs=/tmp:rw,exec,mode=1777` to `runArgs` in all three `devcontainer.json`
files (base, nvidia, amd).

```json
"runArgs": [
  "--shm-size=2g",
  "--userns=keep-id",
  "--tmpfs=/tmp:rw,exec,mode=1777"
]
```

**How it works**: At container startup, Podman mounts a fresh in-memory `tmpfs` filesystem
over `/tmp` with the correct `mode=1777` (world-writable + sticky). This completely
replaces the corrupted `/tmp` from the image layer. The `node` user can now create files
and directories in `/tmp` as expected.

**Trade-offs**:
- `/tmp` contents are not persisted across container restarts (same as any tmpfs `/tmp`)
- Slight RAM usage for the tmpfs (bounded by kernel swap, negligible in practice)
- No change to the image itself; the workaround is purely at runtime

## Alternative Approaches Considered

### Remove the devcontainer features

Removing `git:1` and `github-cli:1` from `features` would avoid the feature build
entirely, preventing the overlay layer from being written with wrong permissions.

**Rejected**: git and the GitHub CLI are valuable in the container; removing them requires
manually installing them in the Dockerfile (more maintenance burden).

### Add `RUN chmod 1777 /tmp` to the Dockerfile

This would restore `/tmp` to the correct mode in the main image build.

**Rejected**: The feature install runs *after* the main Dockerfile build in a separate
buildah stage. Any `chmod` applied in the Dockerfile gets overwritten by the feature
build's overlay layer.

### Pin crun to a version before the regression

**Rejected**: Not practical — crun is managed by the host OS (Fedora), not by the
container definition. Pinning would require host-level intervention outside the repo.

## References

- [containers/crun#1240](https://github.com/containers/crun/issues/1240) — crun regression report
- [containers/podman#20754](https://github.com/containers/podman/issues/20754) — Podman issue tracker
- [devcontainers/features#755](https://github.com/devcontainers/features/issues/755) — devcontainer features issue
- [Podman rootless tutorial](https://github.com/containers/podman/blob/main/docs/tutorials/rootless_tutorial.md)
