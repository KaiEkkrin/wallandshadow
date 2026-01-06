# Wall & Shadow Dev Container

Complete development environment for Wall & Shadow with Node.js 22, Firebase Emulator Suite, and optional GPU support for Playwright/WebGL tests.

## Prerequisites

1. **Docker Desktop** (or Docker Engine + Docker Compose on Linux)

   - [Download Docker Desktop](https://www.docker.com/products/docker-desktop)

2. **Visual Studio Code** with **Dev Containers** extension

   - Install VS Code: https://code.visualstudio.com/
   - Install extension: `ms-vscode-remote.remote-containers`

3. **Windows Users: Use WSL2**
   - ⚠️ **IMPORTANT**: On Windows, you MUST use WSL2 for good performance
   - Clone and work with this repository inside WSL2, not directly on Windows (C: drive)
   - Docker Desktop must be configured to use the WSL2 backend
   - Setup guide: https://learn.microsoft.com/en-us/windows/wsl/install

## Quick Start

### Initial Setup

**Step 1: Clone the repository**

**On Windows (WSL2):**

```bash
# Inside WSL2 (Ubuntu or other Linux distribution)
cd ~
git clone https://github.com/KaiEkkrin/wallandshadow.git
cd wallandshadow
code .
```

**On Linux:**

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

Once setup is complete:

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

Copy the appropriate sample `.env` file for your system into `.devcontainer/.env`:

**For NVIDIA GPU (WSL2 + Docker Desktop):**

```bash
cd .devcontainer
cp .env.nvidia .env
```

**For AMD GPU (Native Linux with ROCm):**

```bash
cd .devcontainer
cp .env.amd .env
```

**For No GPU (default):**

```bash
# Don't create a .env file - default configuration is used automatically
```

After creating the `.env` file, rebuild the container: `F1` → **"Dev Containers: Rebuild Container"**

### Requirements by GPU Type

**NVIDIA (WSL2 + Docker Desktop):**

- NVIDIA GPU
- NVIDIA driver installed on Windows host
- Docker Desktop with WSL2 backend (includes NVIDIA Container Toolkit automatically)
- **Important**: Do NOT install any NVIDIA driver inside WSL2 - the Windows driver is automatically made available

**AMD (Native Linux):**

- AMD GPU with ROCm support
- ROCm drivers installed on Linux host ([installation guide](https://rocm.docs.amd.com/projects/install-on-linux/en/latest/))
- Verify GPU access: `ls -la /dev/dri /dev/kfd`
- Ensure your user is in `video` and `render` groups on the host

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
```

## Service Endpoints

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

# E2E tests (requires dev server running in another terminal)
yarn test:e2e

# All tests
yarn test
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

### Services

The dev container runs a single Docker service:

1. **hexland-dev** - Main development environment with Node.js, Firebase tools, and all dependencies

The Firebase Storage emulator is included with the other Firebase emulators.

### Storage

The repository is mounted as a bind mount at `/workspaces/hexland`. Cache and config directories are stored within the repository via symlinks:

- `~/.cache/firebase` → `.devcontainer/.cache/firebase`
- `~/.config` → `.devcontainer/.config`
- `~/.claude` → `.devcontainer/.claude`

This keeps cache/config persistent across container rebuilds while maintaining good performance on Linux/WSL2.

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

### Firebase Emulators Won't Start

**Possible causes:**

1. **Functions not built**: Run `cd was-web/functions && yarn build`
2. **Java not found**: Run `java --version` (should show OpenJDK 21)
3. **Port conflicts**: Check if ports 3400, 4000, 5000, 5001, 8080, 9099 are already in use on your host
4. **Missing credentials**: Ensure `was-web/firebase-admin-credentials.json` exists (see Quick Start Step 2)

### Slow Performance on Windows

**Symptom**: Slow file operations, long build times

**Solution**: Ensure you're working in WSL2, NOT directly on Windows:

- ✅ Repository should be in WSL2 filesystem: `/home/username/hexland`
- ❌ NOT on Windows filesystem: `/mnt/c/Users/username/hexland`

Verify Docker Desktop is using WSL2 backend: Settings → General → Use WSL 2 based engine

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

- Verify NVIDIA driver on Windows: Open PowerShell, run `nvidia-smi`
- Verify Docker Desktop has WSL2 backend enabled
- Check `.devcontainer/.env` file exists and contains `COMPOSE_PROFILES=nvidia`
- Rebuild the container after creating/modifying `.env` file

**AMD**:

- Verify ROCm drivers: `rocm-smi` on host Linux
- Verify devices exist: `ls -la /dev/dri /dev/kfd`
- Check `.devcontainer/.env` file exists and contains `COMPOSE_PROFILES=amd`
- Rebuild the container after creating/modifying `.env` file
- Ensure your user is in `video` and `render` groups on the host

### Changes Not Reflecting in Browser

**Solutions:**

1. Hard refresh: `Ctrl+Shift+R` (Windows/Linux) or `Cmd+Shift+R` (Mac)
2. Check terminal for compilation messages
3. Restart dev server: `Ctrl+C`, then `yarn start`
4. Verify file is in `was-web/src/` and not excluded by `.gitignore`

### Container Build Fails

**Common causes:**

1. **Docker out of space**: Run `docker system prune -a`
2. **Network issues**: Retry the build
3. **Invalid configuration**: Check `.devcontainer/devcontainer.json` syntax

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
- [Firebase Emulator Suite](https://firebase.google.com/docs/emulator-suite)
- [Node.js 22 Documentation](https://nodejs.org/docs/latest-v22.x/api/)
- [Docker Compose Profiles](https://docs.docker.com/compose/how-tos/profiles/)
- [WSL2 Setup Guide](https://learn.microsoft.com/en-us/windows/wsl/install)
- [NVIDIA GPU on WSL2](https://docs.nvidia.com/cuda/wsl-user-guide/index.html)
- [AMD ROCm on Linux](https://rocm.docs.amd.com/projects/install-on-linux/en/latest/)
