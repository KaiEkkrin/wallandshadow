# Wall & Shadow

This project contains the source code for [Wall & Shadow](https://wallandshadow.com). It is available under the terms of the [Apache License, version 2.0](http://www.apache.org/licenses/LICENSE-2.0) -- see the LICENSE file.

Wall & Shadow is a lightweight VTT (virtual tabletop) focused on providing a fast, on-the-fly battle map creation experience. It's aimed at groups who might:

- run homebrew campaigns;
- have unruly players who do unexpected things;
- run sandbox adventures in which anything could happen.

I originally built it in 2020 while I was unemployed. Since then the VTT space has become a lot more crowded, but most offerings focus on providing a polished experience given pre-built assets or lots of preparation, not the fast improvisation that I want :).

Wall & Shadow is a map tool only and doesn't attempt to provide dice rolling, player character tracking etc. I use Discord bots for that -- Avrae for D&D, [ThirteenIsh](https://github.com/KaiEkkrin/ThirteenIsh) for other systems.

Wall & Shadow is live at <https://wallandshadow.com>. The Terms of Service, Privacy Notice, and open-source acknowledgements are published in the app's **About** section.

## Requirements

Wall & Shadow should work well in any modern browser that supports [WebGL 2](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API#webgl_2). I don't have access to a Mac, so it may or may not work properly on Safari.

## Tech Stack

- **React 19** + TypeScript + Vite
- **Three.js** for WebGL map rendering
- **Bootstrap 5** with react-bootstrap
- **Hono** + TypeScript API server (`was-web/server/`)
- **PostgreSQL 17** + Drizzle ORM
- **MinIO** (dev) / Hetzner Object Storage (prod) for images and spritesheets
- **Zitadel** OIDC for authentication
- **Caddy** + systemd-supervised Docker containers on a Hetzner VPS

## Getting started

The easiest way to get started is the VS Code dev container:

1. Open this repository in VS Code.
2. Press `F1` and select **"Dev Containers: Reopen in Container"**.
3. Once the container is built, start the Hono API server and the Vite dev server, then open <http://localhost:5000>.

Full setup and the day-to-day workflow — database schema, auth modes, tests, and builds — are in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Documentation

| Document | Covers |
| --- | --- |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Local development setup and the day-to-day workflow |
| [docs/ZITADEL_OIDC_SETUP.md](docs/ZITADEL_OIDC_SETUP.md) | First-time Zitadel OIDC provider configuration |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Current architecture and deployment |
| [docs/architecture/](docs/architecture/README.md) | System-level subsystem overviews (e.g. ephemeral state & live overlays) |
| [docs/INFRASTRUCTURE_BOOTSTRAP.md](docs/INFRASTRUCTURE_BOOTSTRAP.md) | First-time Hetzner VPS provisioning |
| [docs/ANALYTICS.md](docs/ANALYTICS.md) | Analytics approach for the self-hosted stack |
| [docs/EPHEMERAL_WS.md](docs/EPHEMERAL_WS.md) | Design notes for the unimplemented ephemeral WebSocket messages |
| [.devcontainer/README.md](.devcontainer/README.md) | Dev container internals, GPU configuration, troubleshooting |

## Deployment

Production and test deploys run through `.github/workflows/deploy-server-production.yml` and `deploy-server-test.yml` — they build a multi-arch Docker image, push it to GHCR, and SSH to the Hetzner VPS to restart the systemd unit with the new image tag. Infrastructure is provisioned by `.github/workflows/provision.yml` (OpenTofu + Ansible).

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the deployment architecture and [docs/INFRASTRUCTURE_BOOTSTRAP.md](docs/INFRASTRUCTURE_BOOTSTRAP.md) for first-time VPS bootstrap.

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) to get started, and the [Code of Conduct](CODE_OF_CONDUCT.md). Report security vulnerabilities privately via [SECURITY.md](SECURITY.md), not a public issue.

## License

Apache License, version 2.0

## AI Policy

I use Generative AI to deal with the tedious, time-consuming parts of maintaining a project like this, such as keeping on top of JavaScript package churn. I'm aware it's a controversial and much-misused technology but having it available to me has made the difference between being able to keep Wall & Shadow running and having to mothball it permanently.

If you feel I have accidentally incorporated copyright code verbatim in this project, in violation of the code's original license, please raise a GitHub Issue with details.
