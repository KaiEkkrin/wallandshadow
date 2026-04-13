#!/usr/bin/env bash
# =============================================================================
# Fetch secrets from the VPS and export them into $GITHUB_ENV with masking.
#
# Shared by deploy-server-test.yml and deploy-server-production.yml.
#
# Arguments:
#   $1  VPS_HOST         — IP or hostname to SSH into as root
#   $2  DB_URL_KEY       — secrets-file key to alias into DATABASE_URL
#                          (e.g. DATABASE_URL_TEST or DATABASE_URL_PROD)
#
# Fail-safe ordering: every value is registered as a mask BEFORE any env-var
# write. If any step fails, the script aborts before unmasked values can
# appear in subsequent log output.
# =============================================================================

set -euo pipefail

if [ $# -ne 2 ]; then
  echo "::error::fetch-vps-secrets.sh: expected 2 arguments (VPS_HOST, DB_URL_KEY), got $#"
  exit 1
fi

VPS_HOST=$1
DB_URL_KEY=$2

SECRETS=$(ssh "root@${VPS_HOST}" cat /etc/wallandshadow/secrets)
if [ -z "$SECRETS" ]; then
  echo "::error::Fetched secrets file from VPS is empty; aborting before any env write."
  exit 1
fi

# Pass 1: register every KEY=value line's value as a mask.
# No writes to $GITHUB_ENV happen in this pass.
while IFS='=' read -r key value; do
  case "$key" in ''|\#*) continue ;; esac
  echo "::add-mask::$value"
done <<< "$SECRETS"

# Also mask the selected DATABASE_URL alias before using it.
DB_URL=$(printf '%s\n' "$SECRETS" | grep "^${DB_URL_KEY}=" | cut -d= -f2-)
if [ -z "$DB_URL" ]; then
  echo "::error::${DB_URL_KEY} not found in VPS secrets file."
  exit 1
fi
echo "::add-mask::$DB_URL"

# Pass 2: now that every value is masked, write them to $GITHUB_ENV.
while IFS='=' read -r key value; do
  case "$key" in ''|\#*) continue ;; esac
  echo "$key=$value" >> "$GITHUB_ENV"
done <<< "$SECRETS"
echo "DATABASE_URL=$DB_URL" >> "$GITHUB_ENV"
