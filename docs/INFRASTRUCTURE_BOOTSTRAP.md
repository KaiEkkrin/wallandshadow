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
- `OIDC_ISSUER` is consumed by both deploy workflows (runtime client config) and the provision workflow (rendered into the Caddy `Content-Security-Policy` header so the SPA can call the issuer's discovery / token endpoints). If you ever change the Zitadel instance, re-run the provision workflow as well as redeploying.

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
| `OIDC_ISSUER`               | Zitadel instance           | Provision + deploy workflows                 |
| `OIDC_CLIENT_ID`            | Zitadel application        | Deploy workflows                             |
| `STATS_BASIC_AUTH_USER`     | You choose                 | Provision workflow (Caddy basic auth on /stats) |
| `STATS_BASIC_AUTH_PASSWORD` | You choose                 | Provision workflow (Caddy basic auth on /stats) |

`DATABASE_URL`, `JWT_SECRET`, and `S3_ACCESS_KEY`/`S3_SECRET_KEY` are **not** GitHub Secrets — they live on the VPS (written by Ansible) and are fetched by deploy workflows via SSH.

## Running the provision workflow

1. Go to **Actions** > **Provision Infrastructure** > **Run workflow**
2. OpenTofu creates the VPS, volume, static IP, and firewall
3. Ansible configures PostgreSQL (data on the volume), Caddy, Docker, backups
4. On first run: copy the displayed `VPS_IP` to GitHub Secrets
5. Point your DNS records at the VPS IP (see below — only needed once, the IP is static)

Subsequent runs are safe to re-run (both OpenTofu and Ansible are idempotent).

## DNS records

The VPS has a static IPv4 (and, if enabled, IPv6) from Hetzner. Configure these records at your registrar / DNS host. Replace `<VPS_IPv4>` and `<VPS_IPv6>` with the values from the OpenTofu output.

### Required — apex and test

| Name           | Type | Value         | TTL  | Notes                                  |
| -------------- | ---- | ------------- | ---- | -------------------------------------- |
| `@`            | A    | `<VPS_IPv4>`  | 3600 | Production (`wallandshadow.com`)       |
| `@`            | AAAA | `<VPS_IPv6>`  | 3600 | Omit if the VPS has no IPv6            |
| `test`         | A    | `<VPS_IPv4>`  | 3600 | Test deploy (`test.wallandshadow.com`) |
| `test`         | AAAA | `<VPS_IPv6>`  | 3600 | Omit if no IPv6                        |

Caddy obtains Let's Encrypt certs automatically once these resolve.

### Strongly recommended

**`www` → apex.** Without this, `www.wallandshadow.com` returns NXDOMAIN. Either point it at the apex with a CNAME, or duplicate the A/AAAA records. Caddy is configured to 301-redirect `www.` to the apex.

| Name  | Type  | Value                  | TTL  |
| ----- | ----- | ---------------------- | ---- |
| `www` | CNAME | `wallandshadow.com.`   | 3600 |

(If your DNS host disallows CNAME at apex-adjacent names alongside other records, use A/AAAA copies instead.)

**CAA — pin the certificate authority.** Restricts which CAs can issue certs for the domain. We use Let's Encrypt via Caddy:

| Name | Type | Value                          | TTL  |
| ---- | ---- | ------------------------------ | ---- |
| `@`  | CAA  | `0 issue "letsencrypt.org"`    | 3600 |
| `@`  | CAA  | `0 issuewild ";"`              | 3600 |

The second record forbids wildcard issuance (we don't use any). Mis-issuance by a rogue CA is rare but cheap to defend against.

**Anti-spoof TXT records (even though we don't send email).** If the domain has no MX, spammers can still forge `From: anything@wallandshadow.com` unless we publish a null SPF and a strict DMARC policy:

| Name              | Type | Value                                              | TTL  |
| ----------------- | ---- | -------------------------------------------------- | ---- |
| `@`               | TXT  | `v=spf1 -all`                                      | 3600 |
| `_dmarc`          | TXT  | `v=DMARC1; p=reject; adkim=s; aspf=s`              | 3600 |
| `*._domainkey`    | TXT  | `v=DKIM1; p=`                                      | 3600 |

The wildcard null DKIM record asserts that no DKIM selector is valid, completing the picture. Add an `rua=mailto:…` to the DMARC record only if someone will actually monitor the reports.

### Only if you actually want email

| Name | Type | Value             | TTL  | Notes                                                    |
| ---- | ---- | ----------------- | ---- | -------------------------------------------------------- |
| `@`  | MX   | `<mail provider>` | 3600 | Adding MX means revisiting the SPF/DKIM/DMARC records too |

We do not send email from the application today (password reset is admin-only — see @docs/REPLATFORM.md), so MX is omitted.

### Verifying

```bash
dig +short A     wallandshadow.com
dig +short AAAA  wallandshadow.com
dig +short A     test.wallandshadow.com
dig +short CNAME www.wallandshadow.com
dig +short CAA   wallandshadow.com
dig +short TXT   wallandshadow.com
dig +short TXT   _dmarc.wallandshadow.com
```

Expect propagation within the TTL of the previous record set (or within minutes on a fresh domain).