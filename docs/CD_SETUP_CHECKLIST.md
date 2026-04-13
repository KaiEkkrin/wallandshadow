# CD Pipeline Setup Checklist

Checklist for getting the Hono server deployed to a Hetzner Cloud VPS via Kamal,
as described in [REPLATFORM.md](REPLATFORM.md).

---

## 1. Hetzner Cloud VPS

Single VPS running Ubuntu Server. Hosts both production and test environments,
with native PostgreSQL and Caddy, plus Docker for the application containers
(managed by Kamal). VPS configuration is managed by Ansible (see section 17).

- [ ] Create Hetzner Cloud account and project
- [ ] Provision a VPS (CPX21 recommended: 3 vCPU, 4 GB RAM, ~€8/month)
- [ ] Choose Ubuntu Server as the OS image
- [ ] Choose data centre region (Nuremberg / Falkenstein / Helsinki)
- [ ] Add your SSH public key to the VPS (Kamal deploys over SSH and Ansible
      uses the same key)
- [ ] Note the VPS public IPv4 address
- [ ] Everything else (firewall, Docker, packages, config) is handled by the
      Ansible playbook — see section 16

## 2. Domain and DNS

Both production and test are served from the same VPS, distinguished by hostname.
Caddy routes requests and provisions separate TLS certificates automatically.

- [ ] Register or choose a domain (e.g. `wallandshadow.com`)
- [ ] Create DNS A records pointing to the VPS IP:
  - [ ] `wallandshadow.com` (or chosen apex/subdomain) — production
  - [ ] `test.wallandshadow.com` — test environment
- [ ] Confirm DNS propagation before enabling HTTPS

## 3. Hetzner Object Storage (S3)

- [ ] Enable Hetzner Object Storage in the same project
- [ ] Create a bucket (e.g. `wallandshadow`)
- [ ] Generate S3 access key and secret key
- [ ] Note the S3 endpoint URL (e.g. `https://hel1.your-objectstorage.com`)
- [ ] Configure bucket policy / ACL as needed for image serving

## 4. PostgreSQL (native on VPS)

Installed natively via `apt` — managed by systemd, not Docker. A single instance
serves both environments via separate databases. Native install gives you
automatic startup, log rotation, and straightforward `pg_upgrade` for major
version bumps. If you later move to managed Postgres (e.g. Scaleway), just change
`DATABASE_URL` and uninstall the package.

All of the following are handled by the Ansible playbook (section 17). Listed
here so you can verify the result.

- [ ] PostgreSQL 17 installed and enabled
- [ ] `was` role created with auto-generated password (section 16)
- [ ] Two databases created:
  - [ ] `wallandshadow` — production
  - [ ] `wallandshadow_test` — test environment
- [ ] `pg_hba.conf` configured for local connections only (the app containers
      connect via `localhost` using Docker host networking or the host gateway)
- [ ] Run initial schema migration against both databases
      (Kamal deploy hook or manual `yarn db:migrate`)
- [ ] Backup cron job in place for the production database
      (`pg_dump` to object storage; test database doesn't need backups)

## 5. Auth / OIDC Provider

The server requires `AUTH_MODE=oidc` in production (enforced by `validateEnv.ts`).
This blocks deployment unless an OIDC provider is running.

- [ ] Choose provider: Zitadel or Hanko
- [ ] Deploy provider (self-hosted container on the VPS, or use their cloud offering)
- [ ] Configure the provider:
  - [ ] Create an OIDC application/client for Wall & Shadow
  - [ ] Note the client ID and OIDC issuer URL
  - [ ] Set allowed redirect URIs for the web app
  - [ ] Enable Google federation (if retaining Google sign-in)
  - [ ] Create initial test/admin user(s)
- [ ] Verify the provider's `.well-known/openid-configuration` endpoint is reachable
- [ ] **Alternative for early testing**: temporarily relax `validateEnv.ts` to allow
      `AUTH_MODE=dual` in a staging environment (not recommended for production)

## 6. Server Dockerfile

No production Dockerfile exists yet. Needs to be created. The image is
self-contained: it includes both the Hono API server and the built React SPA,
so each environment is a single container.

- [ ] Write `was-web/server/Dockerfile` (Node 22 LTS base, multi-stage build)
  - Stage 1: build the React SPA (`yarn build` in `was-web/`)
  - Stage 2: install server dependencies
  - Stage 3: production image with server runtime + SPA build output
- [ ] Add `serveStatic` middleware to Hono to serve the SPA build:
  - [ ] Serve `landing-index.html` at `/`
  - [ ] Serve `app.html` as the SPA fallback for `/app/**`, `/adventure/**`,
        `/map/**`, `/invite/**` routes
  - [ ] Serve static assets (`/assets/*`, JS, CSS, images)
- [ ] Ensure it runs `yarn db:migrate` or equivalent on startup (or as a separate
      init step in Kamal)
- [ ] Verify the image builds and runs locally:
      `docker build -t wallandshadow-server .`
- [ ] Confirm the health check endpoint (`GET /api/health`) works in the container
- [ ] Confirm SPA routing works (e.g. `/app` serves `app.html`)

## 7. Caddy Reverse Proxy (native on VPS)

Installed natively via `apt` — managed by systemd, not Docker. Caddy is a pure
reverse proxy: it terminates TLS, routes by hostname, and forwards to the app
containers. Static files are served by Hono inside each container. Native install
keeps Let's Encrypt certificate state in `/var/lib/caddy/`, decoupled from
container lifecycle. Caddy binds ports 80/443 directly with no port-mapping
indirection.

```
wallandshadow.com        → localhost:3001   (app-prod container)
test.wallandshadow.com   → localhost:3002   (app-test container)
```

Caddy installation and systemd enablement are handled by the Ansible playbook
(section 17). The Caddyfile is templated from `ansible/templates/Caddyfile.j2`
in the repo, so changes are version-controlled and deployed via Ansible.

- [ ] Write `ansible/templates/Caddyfile.j2`:
  - [ ] `wallandshadow.com` block → `reverse_proxy localhost:3001`
  - [ ] `test.wallandshadow.com` block → `reverse_proxy localhost:3002`
  - [ ] Auto-HTTPS via Let's Encrypt (Caddy's default behaviour)
  - [ ] Set appropriate headers (HSTS, CSP, etc.)
- [ ] Verify WebSocket upgrades pass through correctly (Caddy proxies
      `Upgrade: websocket` by default)
- [ ] Disable kamal-proxy (Kamal's built-in proxy) — Caddy replaces it.
      In `deploy.yml`, set `proxy: false` or configure Kamal to expose
      container ports directly without its proxy

## 8. Kamal Configuration

Both environments deploy the same image with different env vars, using Kamal
destinations: `kamal deploy -d production` and `kamal deploy -d test`.

- [ ] Install Kamal locally: `gem install kamal` (requires Ruby)
- [ ] Create `config/deploy.yml` with:
  - [ ] `service` name
  - [ ] `image` pointing to GHCR (e.g. `ghcr.io/KaiEkkrin/wallandshadow`)
  - [ ] `servers.web` with VPS IP
  - [ ] `proxy` configuration (health check path `/api/health`)
  - [ ] `env.secret` list (values come from `.kamal/secrets` — see section 16):
        `DATABASE_URL`, `JWT_SECRET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`,
        `OIDC_ISSUER`, `OIDC_CLIENT_ID`
  - [ ] `env.clear` for non-secret env vars: `S3_ENDPOINT`, `S3_BUCKET`,
        `S3_REGION`, `NODE_ENV=production`, `AUTH_MODE=oidc`, `PORT`
  - [ ] `accessories` for OIDC provider (if containerised)
        — PostgreSQL and Caddy are native, not managed by Kamal
- [ ] Create destination files for per-environment overrides:
  - [ ] `config/deploy.production.yml` — `DATABASE_URL` pointing at `wallandshadow` db,
        `PORT=3001`, host `wallandshadow.com`
  - [ ] `config/deploy.test.yml` — `DATABASE_URL` pointing at `wallandshadow_test` db,
        `PORT=3002`, host `test.wallandshadow.com`
- [ ] Set up `.kamal/secrets` (see section 16 for details)
- [ ] Verify Kamal can reach the VPS: `kamal server exec --cmd 'hostname'`
- [ ] Smoke test: `kamal deploy -d test` before touching production

## 9. GitHub Container Registry (GHCR)

- [ ] Ensure the GitHub repo (or org) has GHCR enabled
- [ ] Create a Personal Access Token (PAT) with `write:packages` scope,
      or use `GITHUB_TOKEN` in Actions (auto-granted for the repo)
- [ ] Verify you can push an image manually:
      `docker login ghcr.io -u USERNAME` then `docker push ghcr.io/...`

## 10. GitHub Actions CD Workflow

Two-stage pipeline: push to `main` auto-deploys to test; production deploy
is a separate manual trigger (or auto after test passes).

- [ ] Create `.github/workflows/deploy-server.yml` (or similar) with:
  - [ ] **Test job**: run `ci-server.yml` tests (or reuse the existing workflow)
  - [ ] **Build job**: build Docker image, push to GHCR with SHA + `latest` tags
  - [ ] **Deploy to test job** (on push to `main`):
        `kamal deploy -d test`
  - [ ] **Deploy to production job** (manual dispatch or separate workflow):
        `kamal deploy -d production`
- [ ] GitHub Secrets are already populated (section 16) — verify the deploy
      workflow can read: `SSH_PRIVATE_KEY`, `DATABASE_URL_PROD`,
      `DATABASE_URL_TEST`, `JWT_SECRET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`,
      `OIDC_ISSUER`, `OIDC_CLIENT_ID`
- [ ] Consider a GitHub Environment (`production`) with required reviewers
      for manual approval before deploy
- [ ] Decide whether to gate deploys on the web app CI passing too

## 11. Web App Static Build

**Decision: Hono serves the SPA.** Each container is self-contained (API + static
files), so both environments are independent single-container deploys. Caddy is
a pure reverse proxy.

- [ ] Ensure the Dockerfile builds the React SPA and copies it into the
      server image (see section 6)
- [ ] Add Hono `serveStatic` middleware for production static serving
- [ ] Update Vite build config to use relative paths for API calls
      (same-origin, so `/api/*` works without an absolute URL)
- [ ] Verify `landing-index.html` at `/` and `app.html` SPA fallback work
- [ ] Verify static assets (JS, CSS, images) are served with appropriate
      cache headers

## 12. Data Migration

Not strictly CD, but needed before the new stack can serve real traffic.

- [ ] Write or verify the Firestore → PostgreSQL migration script
- [ ] Write or verify the Firebase Storage → Hetzner Object Storage migration
- [ ] Plan a migration dry-run against a copy of production data
- [ ] Decide on cutover strategy (DNS switch, maintenance window, etc.)

## 13. Monitoring and Observability

- [ ] Set up basic uptime monitoring (e.g. Hetzner's built-in monitoring,
      or an external service hitting `/api/health`)
- [ ] Configure server logging (stdout → journald or a log aggregator)
- [ ] Set up PostgreSQL monitoring (connection count, disk usage)
- [ ] Set up alerts for disk space, memory, CPU on the VPS
- [ ] Decide whether to add Plausible or similar analytics now or later

## 14. Backup and Recovery

- [ ] Automate PostgreSQL backups (cron + `pg_dump` → object storage)
- [ ] Test restoring from a backup
- [ ] Document the rollback procedure (`kamal rollback` for the app;
      restore from backup for the database)
- [ ] Keep Firebase as a fallback until the new stack is proven stable

## 15. Security Hardening

Most of these are handled by Ansible (section 17) and the secrets flow
(section 16). Listed here for verification.

- [ ] SSH: password auth disabled, key-only (Ansible)
- [ ] Firewall: `ufw` allowing only 22, 80, 443 (Ansible)
- [ ] Automatic security updates: `unattended-upgrades` enabled (Ansible)
- [ ] PostgreSQL: listens on localhost only via `pg_hba.conf` (Ansible)
- [ ] Caddy headers: HSTS, X-Frame-Options, CSP (in Caddyfile template)
- [ ] VPS-internal secrets auto-generated by Ansible, not human-chosen (section 16)
- [ ] Secrets file on VPS is root-only: `chmod 600 /etc/wallandshadow/secrets`
- [ ] Ensure S3 bucket is not publicly listable
- [ ] Confirm OIDC provider tokens have appropriate expiry times

## 16. Secret Management

No dedicated secrets manager — at this scale, Ansible generates internal secrets
and GitHub Secrets is the single store for CI. Manual secret handling is limited
to a one-time copy after initial provisioning.

### How secrets flow

```
Ansible (first run)                    GitHub Secrets
├─ Generates:                          ├─ You add once after first Ansible run:
│  • POSTGRES_PASSWORD (random)        │  • DATABASE_URL_PROD
│  • JWT_SECRET (random)               │  • DATABASE_URL_TEST
│  • DATABASE_URL_PROD (composed)      │  • JWT_SECRET
│  • DATABASE_URL_TEST (composed)      │  • POSTGRES_PASSWORD
│                                      │
├─ Writes to VPS:                      ├─ You add from external providers:
│  • /etc/wallandshadow/secrets        │  • SSH_PRIVATE_KEY
│    (root-only, all secrets)          │  • S3_ACCESS_KEY / S3_SECRET_KEY
│  • PostgreSQL role password          │  • OIDC_ISSUER / OIDC_CLIENT_ID
│  • pg_hba.conf                       │  • VPS_IP
│                                      │
└─ Caches generated values locally     └─ Feeds into:
   (ansible/secrets/ — gitignored)        • Kamal deploys (via .kamal/secrets)
   so re-runs are idempotent              • Ansible provision workflow
```

### Secret categories

| Secret              | Generated by        | Stored in                                         | Injected into containers by              |
| ------------------- | ------------------- | ------------------------------------------------- | ---------------------------------------- |
| SSH private key     | You (once)          | GitHub Secrets + local `~/.ssh/`                  | N/A (used by Ansible + Kamal for SSH)    |
| Postgres password   | Ansible (auto)      | VPS `/etc/wallandshadow/secrets` + GitHub Secrets | Kamal → `DATABASE_URL` env var           |
| `JWT_SECRET`        | Ansible (auto)      | VPS `/etc/wallandshadow/secrets` + GitHub Secrets | Kamal → env var                          |
| `DATABASE_URL_PROD` | Ansible (composed)  | VPS `/etc/wallandshadow/secrets` + GitHub Secrets | Kamal → env var (production destination) |
| `DATABASE_URL_TEST` | Ansible (composed)  | VPS `/etc/wallandshadow/secrets` + GitHub Secrets | Kamal → env var (test destination)       |
| S3 access key       | Hetzner Console     | GitHub Secrets                                    | Kamal → env var                          |
| S3 secret key       | Hetzner Console     | GitHub Secrets                                    | Kamal → env var                          |
| OIDC issuer URL     | OIDC provider setup | GitHub Secrets                                    | Kamal → env var                          |
| OIDC client ID      | OIDC provider setup | GitHub Secrets                                    | Kamal → env var                          |

### Ansible generates VPS-internal secrets

Ansible uses `ansible.builtin.password` to generate random secrets on first run
and cache them locally (in `ansible/secrets/`, which is gitignored). Subsequent
runs reuse the cached values — idempotent. The playbook:

1. Generates `POSTGRES_PASSWORD` and `JWT_SECRET` (random, high-entropy)
2. Composes `DATABASE_URL_PROD` and `DATABASE_URL_TEST` from the generated password
3. Sets the PostgreSQL role password
4. Writes all values to `/etc/wallandshadow/secrets` on the VPS (root-only, `chmod 600`)

### Kamal reads secrets via `.kamal/secrets`

`.kamal/secrets` is a shell script checked into the repo — it contains no
actual secrets, just variable references. Kamal evaluates it before each deploy.

```bash
# .kamal/secrets (checked into repo)
# In GitHub Actions: variables come from GitHub Secrets via env.
# Locally: source .kamal/secrets.local (gitignored) first, or
#          source from the VPS: ssh root@VPS cat /etc/wallandshadow/secrets

DATABASE_URL=$DATABASE_URL
JWT_SECRET=$JWT_SECRET
S3_ACCESS_KEY=$S3_ACCESS_KEY
S3_SECRET_KEY=$S3_SECRET_KEY
OIDC_ISSUER=$OIDC_ISSUER
OIDC_CLIENT_ID=$OIDC_CLIENT_ID
```

For local Kamal runs, create `.kamal/secrets.local` (gitignored):

```bash
# .kamal/secrets.local (gitignored — never committed)
export DATABASE_URL="postgresql://was:GENERATED_PASSWORD@localhost:5432/wallandshadow"
export JWT_SECRET="GENERATED_VALUE"
# ... etc
```

### One-time manual step

After the first Ansible run, copy the generated secrets to GitHub Secrets.
Ansible outputs them at the end of the playbook run, or you can retrieve
them from the VPS:

```bash
ssh root@VPS_IP cat /etc/wallandshadow/secrets
```

Then add each value to GitHub Secrets via the web UI or CLI:

```bash
gh secret set JWT_SECRET --body "..."
gh secret set DATABASE_URL_PROD --body "..."
gh secret set DATABASE_URL_TEST --body "..."
```

This only happens once (or when a secret is rotated).

### Debugging on the VPS

All secrets are readable on the VPS for debugging:

```bash
# View all secrets
sudo cat /etc/wallandshadow/secrets

# View a running container's env vars
kamal app exec -d production -- env | grep -E 'DATABASE|JWT|S3|OIDC'
```

### Setup checklist

- [ ] Add `ansible/secrets/` to `.gitignore`
- [ ] Add `.kamal/secrets.local` to `.gitignore`
- [ ] Write `.kamal/secrets` shell script (variable references only)
- [ ] Verify Ansible generates and caches secrets on first run
- [ ] Verify `/etc/wallandshadow/secrets` is created with `chmod 600`
- [ ] Copy generated secrets to GitHub Secrets (one-time, after first Ansible run)
- [ ] Add external secrets to GitHub Secrets:
  - [ ] `SSH_PRIVATE_KEY`
  - [ ] `VPS_IP`
  - [ ] `S3_ACCESS_KEY` / `S3_SECRET_KEY`
  - [ ] `OIDC_ISSUER` / `OIDC_CLIENT_ID`

## 17. Ansible (VPS Configuration as Code)

All VPS configuration is defined in Ansible playbooks stored in the repo under
`ansible/`. This means the VPS setup is version-controlled, repeatable, and
doesn't require manual SSH sessions. Ansible is agentless — it connects over
SSH using the same key as Kamal.

**Separation of concerns**: Ansible manages the OS and native services (the
things that outlive any single deploy). Kamal manages the application containers
(the things that change on every deploy).

| Layer             | Tool                                    | Runs when               |
| ----------------- | --------------------------------------- | ----------------------- |
| VPS provisioning  | Hetzner Console (or OpenTofu, optional) | Once                    |
| VPS configuration | Ansible                                 | On infra changes (rare) |
| App deployment    | Kamal                                   | Every code push         |

### Repo structure

```
ansible/
├── playbook.yml              # Main playbook
├── inventory.yml             # VPS host(s) and connection details
├── secrets/                  # Ansible-generated secrets cache (gitignored)
├── vars/
│   └── main.yml              # Variables (db names, ports, S3 bucket, etc.)
├── templates/
│   ├── Caddyfile.j2          # Caddy reverse proxy config
│   ├── pg_hba.conf.j2        # PostgreSQL client auth config
│   ├── secrets.env.j2        # VPS secrets file template
│   └── pg_backup.sh.j2       # Backup script for cron
└── files/
    └── (any static files to deploy, e.g. sshd config snippets)
```

### What the playbook manages

- [ ] **Packages**: `postgresql-17`, `caddy`, `docker.io`, `ufw`,
      `unattended-upgrades`
- [ ] **Firewall**: `ufw` rules (22, 80, 443 only)
- [ ] **SSH hardening**: disable password auth
- [ ] **Secrets**: generate `POSTGRES_PASSWORD` and `JWT_SECRET`, compose
      `DATABASE_URL` values, write to `/etc/wallandshadow/secrets` (section 16)
- [ ] **PostgreSQL**: create `was` role (using generated password), create both
      databases, deploy `pg_hba.conf`, enable and start the service
- [ ] **Caddy**: deploy `Caddyfile` from template, enable and start the
      service, reload on config change
- [ ] **Backup cron**: `pg_dump` of production database to S3, scheduled
      nightly
- [ ] **Unattended upgrades**: enable automatic security patches
- [ ] **Docker**: installed and running (required by Kamal)

### GitHub Actions workflow

- [ ] Create `.github/workflows/provision.yml`:
  - [ ] Trigger: `workflow_dispatch` (manual only — infra changes are
        intentional, not triggered by code pushes)
  - [ ] Runs `ansible-playbook` against the VPS
  - [ ] Reads `SSH_PRIVATE_KEY` and `VPS_IP` from GitHub Secrets (section 16)

### Local usage

For ad-hoc runs or debugging, run Ansible locally:

```bash
cd ansible
ansible-playbook playbook.yml -i inventory.yml --ask-become-pass
```

---

## Target Architecture

```
Native services (systemd)            Docker containers (Kamal)
─────────────────────────            ────────────────────────────

Caddy (:80/:443)                     ┌─────────────────────────┐
├─ wallandshadow.com      ────────── │  app-prod (:3001)       │
│                                    │  Hono: API + WS + SPA   │
└─ test.wallandshadow.com ────────── │                         │
                                     ├─────────────────────────┤
                                     │  app-test (:3002)       │
                                     │  Hono: API + WS + SPA   │
                                     │  Same image, test env   │
                                     └──────────┬──────────────┘
                                                │
PostgreSQL 17 (native)                          │
├─ wallandshadow       (prod db)  ◄─────────────┤
└─ wallandshadow_test  (test db)  ◄─────────────┘

Hetzner Object Storage (S3-compatible, remote)
└─ Shared bucket (or separate per env)
```

## Suggested Order of Operations

1. **Provision VPS** (section 1) — Hetzner Console, add SSH key
2. **Write Ansible playbook** (section 17) — define all VPS config in the repo
3. **Run Ansible** — provisions everything on the VPS in one shot:
   PostgreSQL, Caddy, Docker, firewall, SSH hardening, backup cron,
   unattended upgrades, secret generation (sections 4, 7, 15, 16, 17)
4. **Copy generated secrets to GitHub Secrets** (section 16) — one-time
5. **Object storage bucket** (section 3) — Hetzner Console, then add
   S3 credentials to GitHub Secrets
6. **OIDC provider** (section 5) — then add OIDC credentials to GitHub Secrets
7. **Server Dockerfile + SPA static serving** (sections 6, 11) — verify locally
8. **GHCR push** (section 9) — verify manually
9. **Domain + DNS** (section 2) — point both hostnames at VPS
10. **Kamal config + first manual deploy to test** (section 8) — `kamal setup -d test`
11. **GitHub Actions CD workflow** (section 10) — app deploys + Ansible provision workflow
12. **Monitoring** (section 13)
13. **Data migration dry-run** (section 12)
