#!/usr/bin/env bash
# =============================================================================
# Ad-hoc rotation of POSTGRES_PASSWORD and JWT_SECRET on the VPS.
#
# Usage (on the VPS, as root):
#   ./rotate_secrets.sh
#
# After running: re-run the Deploy Server (Test) workflow in GitHub Actions so
# the containers pick up the new values. Delete /etc/wallandshadow/secrets.bak.*
# once everything is confirmed working.
# =============================================================================

set -euo pipefail

NEW_PG_PASSWORD=$(openssl rand -base64 32 | tr -d '=+/' | cut -c1-32)
NEW_JWT_SECRET=$(openssl rand -base64 48 | tr -d '\n')

cp /etc/wallandshadow/secrets /etc/wallandshadow/secrets.bak.$(date +%s)

sudo -u postgres psql -c "ALTER USER was WITH PASSWORD '$NEW_PG_PASSWORD';"

sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${NEW_PG_PASSWORD}|" /etc/wallandshadow/secrets
sed -i "s|^JWT_SECRET=.*|JWT_SECRET=${NEW_JWT_SECRET}|" /etc/wallandshadow/secrets
sed -i "s|^DATABASE_URL_PROD=.*|DATABASE_URL_PROD=postgresql://was:${NEW_PG_PASSWORD}@localhost:5432/wallandshadow|" /etc/wallandshadow/secrets
sed -i "s|^DATABASE_URL_TEST=.*|DATABASE_URL_TEST=postgresql://was:${NEW_PG_PASSWORD}@localhost:5432/wallandshadow_test|" /etc/wallandshadow/secrets

echo "--- secrets file (redacted) ---"
grep -E '^(POSTGRES_PASSWORD|JWT_SECRET|DATABASE_URL_)' /etc/wallandshadow/secrets | sed -E 's|=.*|=<set>|'

echo "--- DB auth test ---"
PGPASSWORD="$NEW_PG_PASSWORD" psql -h localhost -U was -d wallandshadow -c 'SELECT 1;'
