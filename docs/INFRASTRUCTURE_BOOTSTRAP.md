# Infrastructure Bootstrap

The self-hosted stack runs on Hetzner Cloud. Infrastructure is provisioned with OpenTofu (VPS, volume, static IP, firewall) and configured with Ansible (PostgreSQL, Caddy, Docker, backups). Both run from a single GitHub Actions workflow.

## One-time setup (the only ClickOps)

These steps create the credentials that OpenTofu and Ansible need. Do them once.

**1. Hetzner Cloud API token**

- Log in to [Hetzner Cloud Console](https://console.hetzner.cloud/)
- Select or create a project
- Go to **Security** > **API Tokens** > **Generate API Token** (Read/Write)
- Save as GitHub Secret: `HCLOUD_TOKEN`

**2. Create Object Storage buckets and credentials**

Hetzner only shows the S3 credentials UI after you've created your first bucket.

1. In the Cloud Console, go to **Object Storage** > **Create Bucket**
2. Create these buckets (all in the same location as your planned VPS):
   - `wallandshadow-tfstate` (OpenTofu state)
   - `wallandshadow-prod` (production image storage)
   - `wallandshadow-test` (test image storage)
   - `wallandshadow-backups` (database backups)
3. Go to **Object Storage** > **Manage credentials** (now visible)
4. Generate an access key / secret key pair
5. Save as GitHub Secrets: `HCLOUD_S3_ACCESS_KEY`, `HCLOUD_S3_SECRET_KEY`

**4. SSH key pair**

```bash
ssh-keygen -t ed25519 -C "wallandshadow-deploy" -f ~/.ssh/wallandshadow_deploy
# Save the private key as GitHub Secret: SSH_PRIVATE_KEY
# The public key is derived automatically by the provision workflow
```

**5. Update placeholder values**

Edit `infra/main.tf` and `ansible/vars/main.yml` — replace `hel1.your-objectstorage.com` with your actual Hetzner Object Storage endpoint. Update `config/deploy.yml` S3 settings similarly.

**6. OIDC provider** (when ready for auth)

- Set up Zitadel (see [Zitadel OIDC Setup](#zitadel-oidc-setup) above)
- Save as GitHub Secrets: `OIDC_ISSUER`, `OIDC_CLIENT_ID`

**7. Stats dashboard credentials**

GoAccess renders an HTML traffic report from Caddy's access log. Caddy serves it at `https://wallandshadow.com/stats` behind HTTP basic auth. Pick a username and a strong password (any string — Ansible bcrypts it before writing to the Caddyfile):

- Save as GitHub Secrets: `STATS_BASIC_AUTH_USER`, `STATS_BASIC_AUTH_PASSWORD`

To rotate the password later, change the GitHub Secret value and re-run the provision workflow — Caddy reload is graceful.

## GitHub Secrets summary

| Secret                      | Source                     | Used by                                      |
| --------------------------- | -------------------------- | -------------------------------------------- |
| `HCLOUD_TOKEN`              | Hetzner Cloud Console      | Provision workflow (OpenTofu)                |
| `SSH_PRIVATE_KEY`           | You generate once          | Provision + deploy workflows                 |
| `HCLOUD_S3_ACCESS_KEY`      | Hetzner Cloud Console      | Provision workflow (state backend + Ansible) |
| `HCLOUD_S3_SECRET_KEY`      | Hetzner Cloud Console      | Provision workflow (state backend + Ansible) |
| `VPS_IP`                    | First provision run output | Deploy workflows                             |
| `OIDC_ISSUER`               | Zitadel instance           | Deploy workflows                             |
| `OIDC_CLIENT_ID`            | Zitadel application        | Deploy workflows                             |
| `STATS_BASIC_AUTH_USER`     | You choose                 | Provision workflow (Caddy basic auth on /stats) |
| `STATS_BASIC_AUTH_PASSWORD` | You choose                 | Provision workflow (Caddy basic auth on /stats) |

`DATABASE_URL`, `JWT_SECRET`, and `S3_ACCESS_KEY`/`S3_SECRET_KEY` are **not** GitHub Secrets — they live on the VPS (written by Ansible) and are fetched by deploy workflows via SSH.

## Running the provision workflow

1. Go to **Actions** > **Provision Infrastructure** > **Run workflow**
2. OpenTofu creates the VPS, volume, static IP, and firewall
3. Ansible configures PostgreSQL (data on the volume), Caddy, Docker, backups
4. On first run: copy the displayed `VPS_IP` to GitHub Secrets
5. Point your DNS A records at the VPS IP (only needed once — the IP is static)

Subsequent runs are safe to re-run (both OpenTofu and Ansible are idempotent).