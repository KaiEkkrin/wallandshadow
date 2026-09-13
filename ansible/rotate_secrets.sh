#!/usr/bin/env bash
# =============================================================================
# Ad-hoc rotation of POSTGRES_PASSWORD and JWT_SECRET on the VPS.
#
# Usage (on the VPS, as root):
#   ./rotate_secrets.sh
#
# What it does:
#   1. Generates fresh POSTGRES_PASSWORD and JWT_SECRET.
#   2. Updates /mnt/pgdata/wallandshadow/secrets (the master file, on the volume).
#   3. Updates /etc/wallandshadow/{test,prod}.env (the per-environment files
#      consumed by the wallandshadow-{test,prod} systemd units).
#   4. Runs ALTER USER on the PostgreSQL role.
#   5. Restarts both systemd services so containers pick up the new values.
#
# Delete /mnt/pgdata/wallandshadow/secrets.bak.* once everything is confirmed working.
# =============================================================================

set -euo pipefail

# The master secrets file lives on the persistent volume (see
# ansible/vars/main.yml), so it survives a server rebuild.
SECRETS_FILE=/mnt/pgdata/wallandshadow/secrets

NEW_PG_PASSWORD=$(openssl rand -base64 32 | tr -d '=+/' | cut -c1-32)
NEW_JWT_SECRET=$(openssl rand -base64 48 | tr -d '\n')

cp "$SECRETS_FILE" "$SECRETS_FILE.bak.$(date +%s)"

sudo -u postgres psql -c "ALTER USER was WITH PASSWORD '$NEW_PG_PASSWORD';"

# Master secrets file.
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${NEW_PG_PASSWORD}|" "$SECRETS_FILE"
sed -i "s|^JWT_SECRET=.*|JWT_SECRET=${NEW_JWT_SECRET}|" "$SECRETS_FILE"
sed -i "s|^DATABASE_URL_PROD=.*|DATABASE_URL_PROD=postgresql://was:${NEW_PG_PASSWORD}@localhost:5432/wallandshadow|" "$SECRETS_FILE"
sed -i "s|^DATABASE_URL_TEST=.*|DATABASE_URL_TEST=postgresql://was:${NEW_PG_PASSWORD}@localhost:5432/wallandshadow_test|" "$SECRETS_FILE"

# Per-environment env-files (consumed by the systemd units).
sed -i "s|^JWT_SECRET=.*|JWT_SECRET=${NEW_JWT_SECRET}|" /etc/wallandshadow/test.env
sed -i "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://was:${NEW_PG_PASSWORD}@localhost:5432/wallandshadow_test|" /etc/wallandshadow/test.env

sed -i "s|^JWT_SECRET=.*|JWT_SECRET=${NEW_JWT_SECRET}|" /etc/wallandshadow/prod.env
sed -i "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://was:${NEW_PG_PASSWORD}@localhost:5432/wallandshadow|" /etc/wallandshadow/prod.env

echo "--- secrets file (redacted) ---"
grep -E '^(POSTGRES_PASSWORD|JWT_SECRET|DATABASE_URL_)' "$SECRETS_FILE" | sed -E 's|=.*|=<set>|'

echo "--- DB auth test ---"
PGPASSWORD="$NEW_PG_PASSWORD" psql -h localhost -U was -d wallandshadow -c 'SELECT 1;'

echo "--- Restarting application services ---"
systemctl restart wallandshadow-test.service wallandshadow-prod.service
sleep 5
systemctl is-active --quiet wallandshadow-test.service && echo "test: active"
systemctl is-active --quiet wallandshadow-prod.service && echo "prod: active"
