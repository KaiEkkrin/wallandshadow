#!/bin/bash

# Start PostgreSQL (idempotent — skips if already running)
if pg_ctl -D "$PGDATA" status > /dev/null 2>&1; then
    echo "🐘 PostgreSQL already running"
else
    echo "🐘 Starting PostgreSQL..."
    pg_ctl -D "$PGDATA" -l "$PGDATA/postgresql.log" -w start
fi

# Start MinIO (idempotent — skips if already running)
MINIO_DATA="/workspaces/wallandshadow/.devcontainer/.minio-data"
if pgrep -x minio > /dev/null 2>&1; then
    echo "🪣 MinIO already running"
else
    echo "🪣 Starting MinIO..."
    MINIO_ROOT_USER=wasdev MINIO_ROOT_PASSWORD=wasdevpass \
        minio server "$MINIO_DATA" \
        --address :9000 --console-address :9001 \
        > "$MINIO_DATA/minio.log" 2>&1 &

    # Wait for MinIO to be ready, then configure mc alias and ensure bucket exists
    for i in $(seq 1 10); do
        if mc alias set was-local http://localhost:9000 wasdev wasdevpass > /dev/null 2>&1; then
            mc mb --ignore-existing was-local/wallandshadow > /dev/null 2>&1 || true
            break
        fi
        sleep 1
    done
fi

echo ""
echo "🔄 Wall & Shadow dev container started!"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 Service Endpoints"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  New stack"
echo "    Hono API Server:         http://localhost:3000  (start manually)"
echo "    PostgreSQL:              localhost:5432         (auto-started)"
echo "    MinIO console:           http://localhost:9001  (auto-started)"
echo "    MinIO API:               http://localhost:9000"
echo ""
echo "  Firebase (existing stack)"
echo "    React Dev Server:        http://localhost:5000"
echo "    Firebase Emulator UI:    http://localhost:4000"
echo "    Firebase Hosting:        http://localhost:3400"
echo "    Firebase Functions:      http://localhost:5001"
echo "    Firebase Storage:        localhost:9199"
echo "    Firestore Emulator:      localhost:8080"
echo "    Firebase Auth:           localhost:9099"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "💡 Firebase: cd was-web && yarn start"
echo "💡 psql:     psql -h localhost -U was wallandshadow"
echo ""
