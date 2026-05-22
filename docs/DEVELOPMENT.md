# Development

How to set up a local development environment for Wall & Shadow and the
day-to-day workflow. For the project overview and architecture, start with the
[README](../README.md) and [REPLATFORM.md](REPLATFORM.md). For first-time setup
of the external OIDC provider, see
[ZITADEL_OIDC_SETUP.md](ZITADEL_OIDC_SETUP.md).

For contributing to development I would strongly recommend Linux, either
natively or through WSL.

## Dev container (recommended)

The easiest way to get started is with the VS Code dev container.

### Prerequisites

1. [Podman](https://podman.io/) (or Docker Desktop) installed and running
2. [Visual Studio Code](https://code.visualstudio.com/) with the [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)

### Quick start

1. Open this repository in VS Code
2. Press `F1` and select **"Dev Containers: Reopen in Container"**
3. Wait for the container to build (5-10 minutes first time)
4. The dev container automatically starts PostgreSQL and MinIO.

5. Apply the database schema (first time only):

   ```bash
   cd was-web/server
   yarn db:push       # dev database
   yarn db:push:test  # test database
   ```

6. Start the dev servers (see [Running the dev servers](#running-the-dev-servers) below).

7. Open **http://localhost:5000** — register a new account or sign in via Zitadel OIDC.

See [.devcontainer/README.md](../.devcontainer/README.md) for comprehensive dev
container documentation — the terminal-only (`devcontainer` CLI) workflow, GPU
configuration, service endpoints, and troubleshooting.

## Running the dev servers

PostgreSQL and MinIO start automatically when the dev container starts. Run the
two application servers in separate terminals — that way you can restart either
without restarting the other:

```bash
cd was-web

# Terminal 1: Hono API server
cd server && yarn dev

# Terminal 2: Vite dev server
yarn dev:vite
```

The Hono server runs on **http://localhost:3000**. The Vite dev server runs on
**http://localhost:5000** and proxies `/api` and `/ws` to the Hono server.

## Database schema

The Drizzle schema is `was-web/server/src/db/schema.ts`. After changing it,
re-apply it to both databases:

```bash
cd was-web/server
yarn db:push       # dev database
yarn db:push:test  # test database
```

`yarn db:generate` produces a migration SQL file from schema drift;
`yarn db:migrate` runs pending migrations in production.

## Resetting the databases

If either database gets into a bad state (e.g. a failed migration left schema
drift, or you want a clean slate for testing), drop and recreate it, then
re-apply the schema:

**Dev database:**

```bash
psql -h localhost -U postgres -c "DROP DATABASE IF EXISTS wallandshadow;"
psql -h localhost -U postgres -c "CREATE DATABASE wallandshadow OWNER was;"
cd was-web/server && yarn db:push
```

**Test database:**

```bash
psql -h localhost -U postgres -c "DROP DATABASE IF EXISTS wallandshadow_test;"
psql -h localhost -U postgres -c "CREATE DATABASE wallandshadow_test OWNER was;"
cd was-web/server && yarn db:push:test
```

After a dev database reset all local app data (adventures, maps, users) is gone.
After a test database reset the next `yarn test:server` run will recreate
everything it needs.

## Auth modes

- **Production / test deploys**: OIDC-only. The login page shows a single
  "Sign in" button that redirects to Zitadel.
- **Vite dev server (`import.meta.env.DEV`)**: both the email/password modal and
  the OIDC button are shown. This keeps Playwright E2E tests and local
  experimentation working without a Zitadel round-trip.

See [ZITADEL_OIDC_SETUP.md](ZITADEL_OIDC_SETUP.md) for configuring the OIDC
provider.

## Running tests

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

## Building for production

```bash
cd was-web
yarn build              # web client → was-web/build/

cd server
yarn build              # Hono server → was-web/server/dist/
```

Run `yarn lint` in both `was-web/` and `was-web/server/` before opening a pull
request — see [CONTRIBUTING.md](../CONTRIBUTING.md).
