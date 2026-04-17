# Wall & Shadow

This project contains the source code for [Wall & Shadow](https://wallandshadow.com). It is available under the terms of the [Apache License, version 2.0](http://www.apache.org/licenses/LICENSE-2.0) -- see the LICENSE file.

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

- **React 19** + TypeScript + Vite
- **Three.js** for WebGL map rendering
- **Bootstrap 5** with react-bootstrap
- **Hono** + TypeScript API server (`was-web/server/`)
- **PostgreSQL 17** + Drizzle ORM
- **MinIO** (dev) / Hetzner Object Storage (prod) for images and spritesheets
- **Zitadel** OIDC for authentication
- **Caddy** + systemd-supervised Docker containers on a Hetzner VPS

The original Firebase stack (Firestore, Cloud Functions, Firebase Auth, Firebase Hosting, Firebase Storage) lives on the `legacy-firebase` branch. See @docs/REPLATFORM.md for the migration story.

## Development with VS Code Dev Container (Recommended)

The easiest way to get started is with the VS Code dev container.

### Prerequisites

1. [Podman](https://podman.io/) (or Docker Desktop) installed and running
2. [Visual Studio Code](https://code.visualstudio.com/) with the [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)

### Quick Start

1. Open this repository in VS Code
2. Press `F1` and select **"Dev Containers: Reopen in Container"**
3. Wait for the container to build (5-10 minutes first time)
4. The dev container automatically starts PostgreSQL and MinIO.

5. Start developing:

   ```bash
   cd was-web

   # Terminal 1: Start the Hono API server
   cd server && yarn dev

   # Terminal 2: Start the Vite dev server
   yarn dev:vite
   ```

6. Open **http://localhost:5000** — register a new account or sign in via Zitadel OIDC.

See `.devcontainer/README.md` for comprehensive dev container documentation.

## Hono API Server

PostgreSQL and MinIO start automatically when the dev container starts.

```bash
cd was-web/server

# Apply schema to the local dev and test databases (first time, or after schema changes)
yarn db:push
yarn db:push:test

# Start the server with hot reload
yarn dev
```

The server runs on **http://localhost:3000** and the Vite dev server proxies `/api` and `/ws` to it.

### Auth modes

- **Production / test deploys**: OIDC-only. The login page shows a single "Sign in" button that redirects to Zitadel.
- **Vite dev server (`import.meta.env.DEV`)**: both the email/password modal and the OIDC button are shown. This keeps Playwright E2E tests and local experimentation working without a Zitadel round-trip.

### Zitadel OIDC Setup

Wall & Shadow uses [Zitadel](https://zitadel.com/) as its external OIDC provider.

#### 1. Create a Zitadel Instance

Sign up at [zitadel.cloud](https://zitadel.cloud/) (free tier available) or self-host. Note your instance URL (e.g. `https://your-instance.eu1.zitadel.cloud`).

#### 2. Create a Project

In the Zitadel console, create a **Project** (e.g. "Wall & Shadow").

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

| Environment     | URI                                     |
| --------------- | --------------------------------------- |
| Vite dev server | `http://localhost:5000/auth/callback`   |
| Production      | `https://your-domain.com/auth/callback` |

**Post Logout Redirect URIs** — same origins, pointing to the login page:

| Environment     | URI                             |
| --------------- | ------------------------------- |
| Vite dev server | `http://localhost:5000/login`   |
| Production      | `https://your-domain.com/login` |

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

# Client unit tests (watch mode)
yarn test:unit

# Hono server integration tests (requires PostgreSQL + MinIO running)
yarn test:server

# End-to-end tests (requires Hono server + Vite dev server running)
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

## Deployment

Production and test deploys run through `.github/workflows/deploy-server-production.yml` and `deploy-server-test.yml` — they build a multi-arch Docker image, push it to GHCR, and SSH to the Hetzner VPS to restart the systemd unit with the new image tag.

Infrastructure is provisioned by `.github/workflows/provision.yml` (OpenTofu + Ansible). See @docs/INFRASTRUCTURE_BOOTSTRAP.md for first-time VPS bootstrap.

For the retired Firebase deployment (applicable only to the `legacy-firebase` branch), see @docs/LEGACY_FIREBASE_DEPLOY.md.

## License

Apache License, version 2.0

## AI Policy

I use Generative AI to deal with the tedious, time-consuming parts of maintaining a project like this, such as keeping on top of JavaScript package churn. I'm aware it's a controversial and much-misused technology but having it available to me has made the difference between being able to keep Wall & Shadow running and having to mothball it permanently.

If you feel I have accidentally incorporated copyright code verbatim in this project, in violation of the code's original license, please raise a GitHub Issue with details.
