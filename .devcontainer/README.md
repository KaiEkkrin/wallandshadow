# Wall & Shadow Dev Container

Complete development environment for Wall & Shadow with Node.js 22, PostgreSQL 17, MinIO, and optional GPU support for Playwright/WebGL tests. Also includes a full terminal toolchain: neovim (LazyVim), zellij, ripgrep, fd, fzf, lazygit, Rust, and tree-sitter. Editor config is synced from [KaiEkkrin/dot-config](https://github.com/KaiEkkrin/dot-config) on first launch.

PostgreSQL and MinIO start automatically when the container starts — no external Compose setup needed.

## Prerequisites

1. **Podman** (rootless, version 4.0+)

   - Fedora/RHEL: `sudo dnf install podman`
   - Other Linux: see [Podman installation](https://podman.io/docs/installation)
   - Verify rootless mode: `podman info | grep rootless` (should show `true`)

2. **One of**:
   - **VS Code** with the [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers) — for a GUI workflow
   - **`devcontainer` CLI** — for a terminal-only workflow (already installed on the host)

3. **Configure Podman as the container runtime** (required for both VS Code and the CLI)

   VS Code settings (`Ctrl+,`):
   ```json
   { "dev.containers.dockerPath": "podman" }
   ```

   Or export in your shell profile so the CLI picks it up:
   ```bash
   export DOCKER_HOST=unix:///run/user/$(id -u)/podman/podman.sock
   ```

## Terminal Development (devcontainer CLI)

Use this workflow when you don't want VS Code — e.g. developing over SSH, or in a tmux/zellij session on the host.

### Build the container image

From the repository root (takes ~15–20 min first time; brew and rustup are installed during the build):

```bash
devcontainer build --workspace-folder .
```

### Start the container

```bash
devcontainer up --workspace-folder .
```

On first launch this runs the post-create script: installs yarn dependencies, initialises PostgreSQL, clones dot-config into `~/.config`, etc. PostgreSQL and MinIO start automatically on every subsequent launch.

### Connect a terminal

```bash
# Open zellij (recommended — gives you panes and tabs)
devcontainer exec --workspace-folder . zellij

# Or drop straight into bash
devcontainer exec --workspace-folder . bash
```

### Port access from the host

The devcontainer CLI does not implement `forwardPorts` ([open issue](https://github.com/devcontainers/cli/issues/22)), so the following ports are published via explicit `-p` flags in `runArgs` and are directly accessible on the host as soon as the container is running:

| Port | Service |
| ---- | ------- |
| 3000 | Hono API server |
| 5000 | Vite dev server |
| 9001 | MinIO Console |
| 9323 | Playwright Report |

Database ports (5432, 9000) are intentionally not published to avoid conflicts with host services.

### Rebuild after Dockerfile changes

```bash
devcontainer up --workspace-folder . --remove-existing-container
```

This recreates the container from the updated image. PostgreSQL data, MinIO data, dot-config, and all other content in `.devcontainer/` persist because they live in the bind-mounted workspace.

If the container looks wrong after a rebuild (e.g. a tool is missing that the Dockerfile installs), the CLI may have reused a cached image layer. Force a full image rebuild with:

```bash
devcontainer build --no-cache --workspace-folder .
devcontainer up --workspace-folder . --remove-existing-container
```

VS Code equivalent: **F1 → "Dev Containers: Rebuild Container Without Cache"**.

### dot-config sync

`~/.config` inside the container is a clone of [KaiEkkrin/dot-config](https://github.com/KaiEkkrin/dot-config). It is:

- **Cloned** (HTTPS) the first time `devcontainer up` runs.
- **Pulled** (`--ff-only`) on every subsequent container start.

To push changes back to the repo, do so from the **host** — the workspace is bind-mounted so `git push` works there without needing SSH keys inside the container. If you later want to push from inside the container, switch the remote:

```bash
git -C ~/.config remote set-url origin git@github.com:KaiEkkrin/dot-config.git
```

### Available tools

| Tool | How installed | Update |
| --- | --- | --- |
| `nvim` (neovim) | Homebrew | `brew upgrade neovim` |
| `zellij` | Homebrew | `brew upgrade zellij` |
| `rg` (ripgrep) | Homebrew | `brew upgrade ripgrep` |
| `fd` | Homebrew | `brew upgrade fd` |
| `fzf` | Homebrew | `brew upgrade fzf` |
| `lazygit` | Homebrew | `brew upgrade lazygit` |
| `tree-sitter` | npm (global) | `npm update -g tree-sitter-cli` |
| `cargo` / `rustup` | rustup | `rustup update` |
| `brew` itself | — | `brew update && brew upgrade` |

Neovim opens with LazyVim (from dot-config). Mason installs LSPs on first use — neovim will prompt on first open.

---

## Quick Start (VS Code)

**Step 1: Clone the repository**

```bash
cd ~
git clone https://github.com/KaiEkkrin/wallandshadow.git
cd wallandshadow
code .
```

When VS Code opens, you'll see a popup: **"Reopen in Container"** — click it.

Alternatively, press `F1` and select **"Dev Containers: Reopen in Container"**.

The first build takes 5–10 minutes (downloads base image, installs dependencies, initialises PostgreSQL and MinIO). Subsequent starts are much faster.

**Step 2: Start developing**

PostgreSQL and MinIO start automatically. No setup needed.

```bash
cd was-web

# Terminal 1: Start the Hono API server
cd server && yarn dev

# Terminal 2: Start the Vite dev server
yarn dev:vite
```

Open **http://localhost:5000** — the Vite dev server proxies `/api/*` and `/ws` to the Hono server at `localhost:3000`.

---

## GPU Configuration (Optional)

GPU support enables hardware-accelerated WebGL rendering for Playwright tests. **This is optional** — the dev container works fine without GPU support (only the WebGL-specific Playwright test will fail).

### Quick Setup

The repository includes three dev container configurations. VS Code will present a picker when you have multiple configurations available. Press `F1` → **"Dev Containers: Open Folder in Container"** to choose:

| Configuration | File | When to use |
| --- | --- | --- |
| Wall & Shadow Development | `.devcontainer/devcontainer.json` | Default — no GPU |
| Wall & Shadow Development (NVIDIA GPU) | `.devcontainer/nvidia/devcontainer.json` | NVIDIA GPU with CDI |
| Wall & Shadow Development (AMD GPU) | `.devcontainer/amd/devcontainer.json` | AMD GPU with ROCm |

After switching configuration, rebuild the container: `F1` → **"Dev Containers: Rebuild Container"**

### Requirements by GPU Type

**NVIDIA (Linux with Podman):**

- NVIDIA GPU
- NVIDIA driver installed on the host
- NVIDIA Container Toolkit installed: [installation guide](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html)
- CDI configured (run once after toolkit install):
  ```bash
  sudo nvidia-ctk cdi generate --output=/etc/cdi/nvidia.yaml
  ```
- Verify: `nvidia-ctk cdi list` should show `nvidia.com/gpu=0` (or similar)

**AMD (Native Linux with ROCm):**

- AMD GPU with ROCm support
- ROCm drivers installed on Linux host ([installation guide](https://rocm.docs.amd.com/projects/install-on-linux/en/latest/))
- Host user in `video` and `render` groups:
  ```bash
  sudo usermod -aG video,render $USER
  # Log out and back in for group membership to take effect
  ```
- Verify GPU access: `ls -la /dev/dri /dev/kfd`

### Verifying GPU Access

**NVIDIA:**

```bash
nvidia-smi
```

**AMD:**

```bash
ls -la /dev/dri /dev/kfd
groups   # should include video and render
```

---

## Service Endpoints

| Service           | URL / Address                  | Credentials                                          |
| ----------------- | ------------------------------ | ---------------------------------------------------- |
| **Hono API**      | http://localhost:3000          | start manually: `cd was-web/server && yarn dev`      |
| **Vite dev**      | http://localhost:5000          | start manually: `cd was-web && yarn dev:vite`        |
| **PostgreSQL**    | localhost:5432                 | user: `was`, pass: `wasdev`, db: `wallandshadow`     |
| **MinIO Console** | http://localhost:9001          | `wasdev` / `wasdevpass`                              |
| **MinIO API**     | http://127.0.0.1:9000          | —                                                    |

The `DATABASE_URL`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, and `S3_SECRET_KEY`
environment variables are pre-set in the container.

Connect to PostgreSQL directly:

```bash
psql -h localhost -U was wallandshadow
# or:
psql "$DATABASE_URL"
```

---

## Development Workflows

### Running Tests

```bash
cd was-web

# Unit tests (watch mode)
yarn test:unit

# Server integration tests (uses wallandshadow_test database)
yarn test:server

# E2E tests (requires Hono + Vite dev servers running)
yarn test:e2e
```

After changing the database schema (`was-web/server/src/db/schema.ts`), push to both databases:

```bash
cd was-web/server
yarn db:push            # dev database
yarn db:push:test       # test database
```

### Building for Production

```bash
cd was-web
yarn build
```

Creates an optimised production build in `was-web/build/`.

### Debugging

#### React App

1. Start both servers (terminal 1: `cd was-web/server && yarn dev`, terminal 2: `cd was-web && yarn dev:vite`)
2. Press `F5` in VS Code → select **"Launch Chrome"**
3. Set breakpoints in `was-web/src/`

---

## Architecture

### Container

The dev container is a single Podman container built from `.devcontainer/Dockerfile`. It runs as the `node` user (rootless, with UID remapped to match the host user).

The repository is mounted as a bind mount at `/workspaces/wallandshadow`. Cache and config directories are stored within the repository via symlinks:

- `~/.config` → `.devcontainer/.config`
- `~/.claude` → `.devcontainer/.claude`
- `~/.cache/ms-playwright` → `.devcontainer/.cache/ms-playwright`
- `~/.local/share/nvim` → `.devcontainer/.local/share/nvim` (lazy.nvim plugins, Mason LSPs, treesitter parsers)
- `~/.local/state/nvim` → `.devcontainer/.local/state/nvim` (undo, shada, lazy readme cache)

This keeps cache/config persistent across container rebuilds. The nvim symlinks in particular avoid a ~1 GB re-download (plugins + Mason packages + parser rebuilds) on every recreate.

### Environment Variables

Pre-configured in the container:

- `IS_LOCAL_DEV=true` — enables dev-only features (e.g. email/password login on the login page)
- `FORCE_COLOR=true` — colourised terminal output
- `PGDATA` / `DATABASE_URL` — PostgreSQL connection
- `S3_ENDPOINT` / `S3_BUCKET` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` — MinIO connection

---

## Troubleshooting

### Test Database Missing

If your dev container was created before the test database was added to `post-create.sh`,
create it manually (one-time):

```bash
psql -h localhost -U postgres -c "CREATE DATABASE wallandshadow_test OWNER was;"
cd was-web/server
yarn db:push:test
```

### Bind Mount Permission Errors

**Symptom**: Cannot write to files in `/workspaces/wallandshadow` inside the container.

**Cause**: Podman rootless user namespace mismatch.

**Solution**: The `devcontainer.json` uses `--userns=keep-id`. If you still see issues:

```bash
# On the host, check your UID
id -u
# Inside the container, verify it matches
id
```

If they don't match, rebuild the container: `F1` → **"Dev Containers: Rebuild Container"**

### SELinux Permission Errors

**Symptom**: Permission denied errors accessing the workspace on Fedora/RHEL.

**Cause**: SELinux label mismatch on the bind mount.

**Solution**: The `devcontainer.json` uses the `,Z` mount option to relabel files automatically. If issues persist:

```bash
sudo ausearch -m AVC -ts recent
```

### Module Not Found

```bash
cd was-web
rm -rf node_modules
yarn install
```

### GPU Not Detected

**NVIDIA**:

- Verify driver: `nvidia-smi`
- Verify CDI: `nvidia-ctk cdi list`
- If CDI not configured: `sudo nvidia-ctk cdi generate --output=/etc/cdi/nvidia.yaml`
- Make sure you selected the **NVIDIA GPU** configuration; rebuild after switching

**AMD**:

- Verify ROCm: `rocm-smi` on the host
- Verify devices: `ls -la /dev/dri /dev/kfd`
- Ensure your host user is in `video` and `render` groups
- Make sure you selected the **AMD GPU** configuration; rebuild after switching

### Changes Not Reflecting in Browser

1. Hard refresh: `Ctrl+Shift+R` (Windows/Linux) or `Cmd+Shift+R` (Mac)
2. Check terminals for compilation errors
3. Restart the dev server

### Container Build Fails

1. **Podman out of space**: `podman system prune -a`
2. **Network issues**: retry
3. **Invalid configuration**: `python3 -m json.tool .devcontainer/devcontainer.json`
4. **Podman socket not running**: `systemctl --user start podman.socket`

---

## Reconnecting After Closing VS Code

1. Open VS Code → press `F1` → **"File: Open Recent"** → select the Wall & Shadow container workspace

OR via Remote Explorer:

1. Open Remote Explorer in VS Code sidebar
2. Select "Dev Containers" from dropdown
3. Find the Wall & Shadow container → click to connect

---

## Resources

- [VS Code Dev Containers Documentation](https://code.visualstudio.com/docs/devcontainers/containers)
- [Podman Documentation](https://docs.podman.io/)
- [Podman Rootless Tutorial](https://github.com/containers/podman/blob/main/docs/tutorials/rootless_tutorial.md)
- [Node.js 22 Documentation](https://nodejs.org/docs/latest-v22.x/api/)
- [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html)
- [AMD ROCm on Linux](https://rocm.docs.amd.com/projects/install-on-linux/en/latest/)
