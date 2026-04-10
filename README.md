# Wall & Shadow

This project contains the source code for [Wall & Shadow](https://wallandshadow.web.app). It is available under the terms of the [Apache License, version 2.0](http://www.apache.org/licenses/LICENSE-2.0) -- see the LICENSE file.

Wall & Shadow is a lightweight VTT (virtual tabletop) focused on providing a fast, on-the-fly battle map creation experience. It's aimed at groups who might:

- run homebrew campaigns;
- have unruly players who do unexpected things;
- run sandbox adventures in which anything could happen.

I originally built it in 2020 while I was unemployed. Since then the VTT space has become a lot more crowded, but most offerings focus on providing a polished experience given pre-built assets or lots of preparation, not the fast improvisation that I want :).

Wall & Shadow is a map tool only and doesn't attempt to provide dice rolling, player character tracking etc. I use Discord bots for that -- Avrae for D&D, [ThirteenIsh](https://github.com/KaiEkkrin/ThirteenIsh) for other systems.

## Requirements

Wall & Shadow should work well in any modern browser that supports [WebGL 2](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API#webgl_2). I don't have access to a Mac, so it may or may not work properly on Safari.

For contributing to development I would strongly recommend Linux, either natively or through WSL.

## Tech Stack

**Current (Firebase):**

- **React 18** + TypeScript + Vite
- **Firebase v11** (Firestore, Functions, Auth, Hosting, Storage)
- **Three.js** for 3D map rendering
- **Bootstrap 5** with react-bootstrap

**New self-hosted stack (in progress):**

- **Hono** + TypeScript API server (`was-web/server/`)
- **PostgreSQL 17** + Drizzle ORM
- **MinIO** for object storage

## Development with VS Code Dev Container (Recommended)

The easiest way to get started is with the VS Code dev container:

### Prerequisites

1. [Docker Desktop](https://www.docker.com/products/docker-desktop) installed and running
2. [Visual Studio Code](https://code.visualstudio.com/) with the [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)

### Quick Start

1. Open this repository in VS Code
2. Press `F1` and select **"Dev Containers: Reopen in Container"**
3. Wait for the container to build (5-10 minutes first time)
4. Set up Firebase credentials (see [`.devcontainer/README.md`](.devcontainer/README.md))
5. Build Firebase Functions:
   ```bash
   cd was-web/functions
   yarn build
   ```
6. Start developing:

   ```bash
   cd was-web

   # Terminal 1: Start Firebase emulators
   yarn dev:firebase

   # Terminal 2: Start Vite dev server
   yarn dev:vite
   ```

7. Open http://localhost:3400 in your browser (Firebase Hosting emulator)
   - For development with hot reload, use http://localhost:5000 (Vite dev server)

Running emulators and dev server separately is recommended - you can restart the app without restarting the emulators.

See [`.devcontainer/README.md`](.devcontainer/README.md) for comprehensive documentation.

## Hono API Server

PostgreSQL and MinIO start automatically when the dev container starts.

```bash
cd was-web/server

# Apply schema to local database (first time, or after schema changes)
yarn drizzle-kit push

# Start the server with hot reload
yarn dev
```

The server runs on **http://localhost:3000**.

### Running the client against the Hono server

The React client can run against the Hono server instead of Firebase by setting the `VITE_BACKEND` environment variable:

```bash
cd was-web

# Terminal 1: Start the Hono server
cd server && yarn dev

# Terminal 2: Start Vite with Hono backend
VITE_BACKEND=hono yarn dev:vite
```

Open **http://localhost:5000** and register a new account. The Hono backend supports local email/password auth (for dev/test) and Zitadel OIDC (for production). See [Zitadel OIDC Setup](#zitadel-oidc-setup) below.

The Firebase emulators do not need to be running when using the Hono backend.

**What works:** Sign up, log in, create/edit/delete adventures, invite/join, player management, create/edit/delete maps (metadata only), WebSocket live editing, image/spritesheet upload, OIDC sign-in via Zitadel.

### Zitadel OIDC Setup

Wall & Shadow uses [Zitadel](https://zitadel.com/) as its external OIDC authentication provider. In production, all authentication goes through Zitadel; in dev/test, local email/password auth is also available so that e2e tests can create users without hitting Zitadel.

#### 1. Create a Zitadel Instance

Sign up at [zitadel.cloud](https://zitadel.cloud/) (free tier available) or self-host. Note your instance URL (e.g. `https://your-instance.eu1.zitadel.cloud`).

#### 2. Create a Project

In the Zitadel console, create a **Project** (e.g. "Wall & Shadow").

**Project settings** — under the project's General tab:

- **Assert Roles on Authentication**: leave off (not needed)

**Token settings** — under the project's General tab, scroll to Token or find it in settings:

- **Access Token Type**: set to **JWT**. This is critical — the default is opaque tokens, which the Wall & Shadow server cannot verify. The server validates access tokens against Zitadel's JWKS endpoint and needs them to be JWTs.

#### 3. Create an Application

Inside the project, create a new **Application**:

- **Application type**: User Agent
- **Authentication method**: PKCE (selected by default for User Agent apps)

**OIDC Settings** (on the application's configuration page):

| Setting              | Value              |
| -------------------- | ------------------ |
| **Response Type**    | Code               |
| **Grant Type**       | Authorization Code |
| **Application Type** | User Agent         |
| **Auth Method**      | None (PKCE)        |

**Redirect URIs** — add all origins where the app runs:

| Environment               | URI                                     |
| ------------------------- | --------------------------------------- |
| Vite dev server           | `http://localhost:5000/auth/callback`   |
| Firebase Hosting emulator | `http://localhost:3400/auth/callback`   |
| Production                | `https://your-domain.com/auth/callback` |

**Post Logout Redirect URIs** — same origins, pointing to the login page:

| Environment               | URI                             |
| ------------------------- | ------------------------------- |
| Vite dev server           | `http://localhost:5000/login`   |
| Firebase Hosting emulator | `http://localhost:3400/login`   |
| Production                | `https://your-domain.com/login` |

Note the **Client ID** from the application page — you'll need it for the environment variables below.

#### 4. Configure Identity Providers (Social Login)

Identity providers are configured in Zitadel, not in the Wall & Shadow codebase. Once configured, they automatically appear on Zitadel's hosted login page.

**Google:**

1. Create an OAuth 2.0 Client ID at [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials) (type: Web application)
2. Set the **Authorized redirect URI** to: `https://your-instance.zitadel.cloud/ui/login/login/externalidp/callback`
3. In Zitadel: **Settings** > **Identity Providers** > **New** > **Google**
4. Paste the Google Client ID and Client Secret
5. Enable **Auto creation** (create Zitadel user on first Google login) and **Auto update** (sync profile changes)
6. Activate the provider

**GitHub:**

1. Create an OAuth App at [github.com/settings/developers](https://github.com/settings/developers) > **OAuth Apps** > **New OAuth App**
2. Set the **Authorization callback URL** to: `https://your-instance.zitadel.cloud/ui/login/login/externalidp/callback`
3. In Zitadel: **Settings** > **Identity Providers** > **New** > **GitHub**
4. Paste the GitHub Client ID and Client Secret
5. Enable auto-creation and auto-update, then activate

#### 5. Enable Self-Registration

To allow users to create accounts with email/password on Zitadel's hosted login page:

1. Go to **Settings** > **Login Behavior and Access**
2. Enable **Register allowed**

#### 6. Create a Test User (for OIDC e2e tests)

Create a user in Zitadel with a known email and password for the automated OIDC e2e test:

1. Go to **Users** > **Create User**
2. Set an email and password
3. Add these credentials to your `.devcontainer/.env` as `ZITADEL_TEST_EMAIL` and `ZITADEL_TEST_PASSWORD`

#### 7. Environment Variables

Copy `.devcontainer/.env.example` to `.devcontainer/.env` and fill in the values:

```bash
# OIDC provider (Zitadel)
OIDC_ISSUER=https://your-instance.zitadel.cloud
VITE_OIDC_ISSUER=https://your-instance.zitadel.cloud
VITE_OIDC_CLIENT_ID=your-client-id-from-step-3

# Auth mode: "dual" allows both local and OIDC (default for dev).
# Set to "oidc" in production to disable local email/password auth.
#AUTH_MODE=dual
#VITE_AUTH_MODE=dual

# Optional: Zitadel test user for the OIDC e2e test
#ZITADEL_TEST_EMAIL=test@example.com
#ZITADEL_TEST_PASSWORD=your-test-password
```

The `.devcontainer/.env` file is gitignored. The `--env-file` flag in `devcontainer.json` injects these into the container environment on startup.

For terminals already open, source the env file:

```bash
export $(grep -v '^#' /workspaces/wallandshadow/.devcontainer/.env | xargs)
```

## Running Tests

```bash
cd was-web

# Firebase client unit tests (watch mode)
yarn test:unit

# Hono server integration tests (requires PostgreSQL running)
yarn test:server

# End-to-end tests (requires dev server running)
yarn test:e2e

# E2E in interactive UI mode (opens at http://localhost:8444)
yarn test:e2e:ui

# Run a single test on a single browser
yarn test:e2e --project chromium-desktop --grep "create account"
```

To run server tests with lint and type-check, from `was-web/server/`:

```bash
yarn tsc --noEmit
yarn lint
yarn test
```

## Deployment (Firebase — Legacy)

For Firebase deployment instructions, see **[DEPLOY.md](DEPLOY.md)**.

Quick deploy (after initial setup):

```bash
cd was-web
yarn build
firebase deploy --only hosting    # Web app only (fast)
firebase deploy                   # Everything (includes Functions)
```

## License

Apache License, version 2.0

## AI Policy

I use Generative AI to deal with the tedious, time-consuming parts of maintaining a project like this, such as keeping on top of JavaScript package churn. I'm aware it's a controversial and much-misused technology but having it available to me has made the difference between being able to keep Wall & Shadow running and having to mothball it permanently.

If you feel I have accidentally incorporated copyright code verbatim in this project, in violation of the code's original license, please raise a GitHub Issue with details.
