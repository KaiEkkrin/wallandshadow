# Wall & Shadow Dev Container

Complete development environment for Wall & Shadow with Node.js 22, PostgreSQL 17, MinIO, Firebase Emulator Suite, and optional GPU support for Playwright/WebGL tests.

Both the existing Firebase stack and the new self-hosted stack (PostgreSQL + Hono API + MinIO) run inside the same container — no external Compose setup needed.

## Prerequisites

1. **Podman** (rootless, version 4.0+)

   - Fedora/RHEL: `sudo dnf install podman`
   - Other Linux: see [Podman installation](https://podman.io/docs/installation)
   - Verify rootless mode: `podman info | grep rootless` (should show `true`)

2. **Visual Studio Code** with **Dev Containers** extension

   - Install VS Code: https://code.visualstudio.com/
   - Install extension: `ms-vscode-remote.remote-containers`

3. **Configure VS Code to use Podman**

   Open VS Code settings (`Ctrl+,`) and add:

   ```json
   {
     "dev.containers.dockerPath": "podman"
   }
   ```

   Or set the Podman socket in your shell profile:

   ```bash
   export DOCKER_HOST=unix:///run/user/$(id -u)/podman/podman.sock
   ```

## Quick Start

### Initial Setup

**Step 1: Clone the repository**

```bash
cd ~
git clone https://github.com/KaiEkkrin/wallandshadow.git
cd wallandshadow
code .
```

When VS Code opens, you'll see a popup: **"Reopen in Container"** - click it.

Alternatively, press `F1` and select **"Dev Containers: Reopen in Container"**.

The first build takes 5-10 minutes (downloads base image, installs dependencies, sets up Firebase emulators). Subsequent starts are much faster.

**Step 2: Set up Firebase Admin credentials** (Required for Firebase Functions)

Once the container is ready:

1. Open [Firebase Console](https://console.firebase.google.com/)
2. Select or create your Firebase project
3. Go to **Project Settings** > **Service Accounts**
4. Click **"Generate new private key"**
5. Save the downloaded JSON file as:
   ```
   was-web/firebase-admin-credentials.json
   ```

⚠️ **Important**: This file is required for Firebase Functions to work properly (including creating adventures, maps, etc.). Without it, you'll get CORS errors and "internal" errors when calling Functions.

This file is in `.gitignore` and will never be committed. A symlink at `public/firebase-admin-credentials.json` is already in the repository so the dev server can serve it to the browser.

**Step 3: Build Firebase Functions**

Before starting the dev server, you must build the Firebase Functions:

```bash
cd was-web/functions
yarn build
cd ..
```

This compiles the TypeScript Functions to JavaScript. The emulator cannot run without this build step.

### Start Developing

**PostgreSQL and MinIO start automatically** when the container starts. No setup needed.

#### New stack (Hono API server)

Once `was-web/server/` exists:

```bash
cd was-web/server
yarn tsx watch src/index.ts   # hot reload on port 3000
```

Environment variables (`DATABASE_URL`, `S3_ENDPOINT`, etc.) are pre-configured.

#### Existing Firebase stack

```bash
cd was-web

# Terminal 1: Start Firebase emulators
yarn dev:firebase

# Terminal 2: Start Vite dev server
yarn dev:vite
```

Running these separately is recommended - you can restart the app without restarting the emulators.

- **Firebase Hosting emulator: http://localhost:3400** (recommended - includes static landing page and routing)
- Vite dev server: http://localhost:5000 (for development with hot reload)
- Firebase Emulator UI: http://localhost:4000

**Note**: To test the static landing page and Firebase Hosting rewrites, use port 3400 after running `yarn build`. The Vite dev server (port 5000) is for active development with hot module reloading.

Alternative: `yarn start` runs both in parallel (less flexible).

**Note**: If you make changes to Firebase Functions code, you need to rebuild them (`cd functions && yarn build`) and restart the emulator.

## GPU Configuration (Optional)

GPU support enables hardware-accelerated WebGL rendering for Playwright tests. **This is optional** - the dev container works fine without GPU support (only the WebGL-specific Playwright test will fail).

### Quick Setup

The repository includes three dev container configurations. VS Code will present a picker when you have multiple configurations available. Press `F1` → **"Dev Containers: Open Folder in Container"** to choose:

| Configuration | File | When to use |
| --- | --- | --- |
| Wall & Shadow Development | `.devcontainer/devcontainer.json` | Default — no GPU |
| Wall & Shadow Development (NVIDIA GPU) | `.devcontainer/nvidia/devcontainer.json` | NVIDIA GPU with ROCm CDI |
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

Inside the container, check for GPU devices:

**NVIDIA:**

```bash
# Should show your GPU
nvidia-smi
```

**AMD:**

```bash
# Should list GPU devices
ls -la /dev/dri /dev/kfd

# Should include video and render
groups
```

## Service Endpoints

### New Stack (auto-started on container launch)

| Service              | URL                        | Credentials          |
| -------------------- | -------------------------- | -------------------- |
| **Hono API Server**  | http://localhost:3000      | start manually (see below) |
| **PostgreSQL**       | localhost:5432             | user: `was`, pass: `wasdev`, dbs: `wallandshadow` (dev), `wallandshadow_test` (tests) |
| **MinIO API**        | http://localhost:9000      | — |
| **MinIO Console**    | http://localhost:9001      | `wasdev` / `wasdevpass` |

The `DATABASE_URL`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, and `S3_SECRET_KEY` environment variables are pre-set in the container for use by the new server.

Connect to PostgreSQL directly:

```bash
psql -h localhost -U was wallandshadow
# or using the env var:
psql "$DATABASE_URL"
```

Run the Hono API server (once `was-web/server/` exists):

```bash
cd was-web/server
yarn tsx watch src/index.ts
```

### Firebase Stack (start manually)

| Service         | URL                   | Description                                                    |
| --------------- | --------------------- | -------------------------------------------------------------- |
| **React App**   | http://localhost:3400 | Main web application (Firebase Hosting emulator - recommended) |
| **Dev Server**  | http://localhost:5000 | Vite dev server (for development with hot reload)              |
| **Emulator UI** | http://localhost:4000 | Firebase emulator dashboard                                    |
| **Hosting**     | http://localhost:3400 | Firebase hosting emulator (same as React App)                  |
| **Functions**   | http://localhost:5001 | Firebase Functions endpoint                                    |
| **Storage**     | localhost:9199        | Firebase Storage emulator                                      |
| **Firestore**   | localhost:8080        | Firestore emulator                                             |
| **Auth**        | localhost:9099        | Authentication emulator                                        |
| **Node Debug**  | localhost:9229        | Node.js debugging port                                         |

## Development Workflows

### Running Tests

```bash
cd was-web

# Unit tests (watch mode)
yarn test:unit

# Server integration tests (uses wallandshadow_test database)
yarn test:server

# E2E tests (requires dev server running in another terminal)
yarn test:e2e

# All tests
yarn test
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

Creates optimized production build in `was-web/build/` directory.

### Debugging

#### React App Debugging

1. Start dev server: `yarn dev:firebase` (terminal 1) and `yarn dev:vite` (terminal 2)
2. Press `F5` in VS Code or go to Run & Debug
3. Select **"Launch Chrome"**
4. Set breakpoints in your React code

#### Firebase Functions Debugging

1. Start emulators: `yarn dev:firebase`
2. Go to Run & Debug in VS Code
3. Select **"Debug Firebase Functions"**
4. Set breakpoints in `was-web/functions/src/**/*.ts`
5. Trigger the function from your app or Emulator UI

## Architecture

### Container

The dev container is a single Podman container built from `.devcontainer/Dockerfile`. It runs as the `node` user (rootless, with UID remapped to match the host user via `updateRemoteUserUID`).

The repository is mounted as a bind mount at `/workspaces/wallandshadow`. Cache and config directories are stored within the repository via symlinks:

- `~/.cache/firebase` → `.devcontainer/.cache/firebase`
- `~/.config` → `.devcontainer/.config`
- `~/.claude` → `.devcontainer/.claude`

This keeps cache/config persistent across container rebuilds while maintaining good performance on Linux.

### Environment Variables

Automatically configured in the container:

- `IS_LOCAL_DEV=true` - Enables emulator-only features
- `FORCE_COLOR=true` - Colorized terminal output
- `GOOGLE_APPLICATION_CREDENTIALS` - Path to Firebase admin credentials

## Troubleshooting

### CORS Errors or "internal" Errors When Creating Adventures/Maps

**Symptom**: Browser console shows CORS errors like "No 'Access-Control-Allow-Origin' header" or "Error: internal" when trying to create adventures or maps

**Root cause**: Firebase Functions not built, admin credentials missing, or credentials symlink not created

**Solution**:

```bash
# 1. Build Firebase Functions
cd was-web/functions
yarn build

# 2. Ensure firebase-admin-credentials.json exists and symlink is present
ls -la ../firebase-admin-credentials.json
ls -la ../public/firebase-admin-credentials.json

# If symlink is missing (shouldn't happen unless you deleted it), recreate it:
# cd .. && ln -s ../firebase-admin-credentials.json public/firebase-admin-credentials.json

# 3. Restart the dev server (if it's running)
# Stop yarn start (Ctrl+C) and restart
yarn start

# 4. Hard refresh your browser to clear cached requests
# Ctrl+Shift+R (Windows/Linux) or Cmd+Shift+R (Mac)
```

If `firebase-admin-credentials.json` is missing, follow Step 2 in the Quick Start section above.

### Test Database Missing (existing dev containers)

If your dev container was created before the test database was added to `post-create.sh`,
create it manually (one-time):

```bash
psql -h localhost -U postgres -c "CREATE DATABASE wallandshadow_test OWNER was;"
cd was-web/server
yarn db:push:test
```

### Firebase Emulators Won't Start

**Possible causes:**

1. **Functions not built**: Run `cd was-web/functions && yarn build`
2. **Java not found**: Run `java --version` (should show OpenJDK 21)
3. **Port conflicts**: Check if ports 3400, 4000, 5000, 5001, 8080, 9099 are already in use on your host
4. **Missing credentials**: Ensure `was-web/firebase-admin-credentials.json` exists (see Quick Start Step 2)

### Bind Mount Permission Errors

**Symptom**: Cannot write to files in `/workspaces/wallandshadow` inside the container.

**Cause**: Podman rootless user namespace mismatch.

**Solution**: The `devcontainer.json` uses `--userns=keep-id` and `updateRemoteUserUID: true` to handle this automatically. If you still see issues:

```bash
# On the host, check your UID
id -u

# Inside the container, verify the node user UID matches
id
```

If they don't match, rebuild the container: `F1` → **"Dev Containers: Rebuild Container"**

### SELinux Permission Errors

**Symptom**: Permission denied errors accessing the workspace on Fedora/RHEL.

**Cause**: SELinux label mismatch on the bind mount.

**Solution**: The `devcontainer.json` uses the `,Z` mount option to relabel files automatically. If issues persist:

```bash
# Check SELinux denials
sudo ausearch -m AVC -ts recent
```

### Module Not Found

**Symptom**: `Cannot find module` errors

**Solution**: Reinstall dependencies

```bash
cd was-web
rm -rf node_modules
yarn install

cd functions
rm -rf node_modules
yarn install
```

### GPU Not Detected

**NVIDIA**:

- Verify NVIDIA driver on host: `nvidia-smi`
- Verify CDI is configured: `nvidia-ctk cdi list`
- If CDI not configured: `sudo nvidia-ctk cdi generate --output=/etc/cdi/nvidia.yaml`
- Make sure you selected the **NVIDIA GPU** configuration when opening the container
- Rebuild the container after switching configuration

**AMD**:

- Verify ROCm drivers: `rocm-smi` on host Linux
- Verify devices exist: `ls -la /dev/dri /dev/kfd`
- Ensure your user is in `video` and `render` groups on the host: `groups`
- Make sure you selected the **AMD GPU** configuration when opening the container
- Rebuild the container after switching configuration

### Changes Not Reflecting in Browser

**Solutions:**

1. Hard refresh: `Ctrl+Shift+R` (Windows/Linux) or `Cmd+Shift+R` (Mac)
2. Check terminal for compilation messages
3. Restart dev server: `Ctrl+C`, then `yarn start`
4. Verify file is in `was-web/src/` and not excluded by `.gitignore`

### Container Build Fails

**Common causes:**

1. **Podman out of space**: Run `podman system prune -a`
2. **Network issues**: Retry the build
3. **Invalid configuration**: Check `.devcontainer/devcontainer.json` syntax with `python3 -m json.tool .devcontainer/devcontainer.json`
4. **Podman socket not running**: `systemctl --user start podman.socket`

## Reconnecting After Closing VS Code

1. Open VS Code
2. Press `F1`
3. Type **"File: Open Recent"**
4. Select your Wall & Shadow container workspace

OR use the Remote Explorer:

1. Open Remote Explorer in VS Code sidebar
2. Select "Dev Containers" from dropdown
3. Find your Wall & Shadow container
4. Click to connect

## Resources

- [VS Code Dev Containers Documentation](https://code.visualstudio.com/docs/devcontainers/containers)
- [Podman Documentation](https://docs.podman.io/)
- [Podman Rootless Tutorial](https://github.com/containers/podman/blob/main/docs/tutorials/rootless_tutorial.md)
- [Firebase Emulator Suite](https://firebase.google.com/docs/emulator-suite)
- [Node.js 22 Documentation](https://nodejs.org/docs/latest-v22.x/api/)
- [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html)
- [AMD ROCm on Linux](https://rocm.docs.amd.com/projects/install-on-linux/en/latest/)
