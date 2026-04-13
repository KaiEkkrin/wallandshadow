#!/bin/sh
set -e

# Run database migrations (idempotent — safe to run on every startup)
echo "Running database migrations..."
node dist/db/migrate.js
echo "Migrations complete."

# Start the server
exec node dist/index.js
