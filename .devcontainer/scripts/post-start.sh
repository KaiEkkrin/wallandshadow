#!/bin/bash

# Ensure .bashrc re-sources .devcontainer/.env on every new interactive shell.
# This makes `.env` edits take effect by opening a new terminal, without
# needing to rebuild/recreate the container (the `--env-file` in
# devcontainer.json runArgs is only applied at container create, not start).
BASHRC="$HOME/.bashrc"
GUARD="# wallandshadow-devcontainer-env-source"
if ! grep -qF "$GUARD" "$BASHRC" 2>/dev/null; then
    cat >> "$BASHRC" <<'EOF'

# wallandshadow-devcontainer-env-source
# Auto-source .devcontainer/.env so edits take effect on new terminals
# without rebuilding the container. Safe if the file is missing.
if [ -f /workspaces/wallandshadow/.devcontainer/.env ]; then
    set -a
    . /workspaces/wallandshadow/.devcontainer/.env
    set +a
fi
EOF
fi

# Start PostgreSQL (idempotent — skips if already running)
# pg_ctl status checks the PID in postmaster.pid, but after a container rebuild the
# PID may have been reused by a different process (e.g. VS Code's node). Detect this
# by verifying the process is actually postgres, and clean up the stale PID file if not.
if pg_ctl -D "$PGDATA" status > /dev/null 2>&1; then
    PG_PID=$(head -1 "$PGDATA/postmaster.pid" 2>/dev/null)
    if [ -n "$PG_PID" ] && [ -e "/proc/$PG_PID/exe" ] && \
       readlink "/proc/$PG_PID/exe" | grep -q postgres; then
        echo "🐘 PostgreSQL already running"
    else
        echo "🐘 Stale PostgreSQL PID file detected, cleaning up..."
        rm -f "$PGDATA/postmaster.pid"
        pg_ctl -D "$PGDATA" -l "$PGDATA/postgresql.log" -w start
    fi
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
    nohup env MINIO_ROOT_USER=wasdev MINIO_ROOT_PASSWORD=wasdevpass \
        minio server "$MINIO_DATA" \
        --address 0.0.0.0:9000 --console-address 0.0.0.0:9001 \
        > "$MINIO_DATA/minio.log" 2>&1 &
    disown

    # Wait for MinIO to be ready, then configure mc alias and ensure bucket exists
    for i in $(seq 1 10); do
        if mc alias set was-local http://127.0.0.1:9000 wasdev wasdevpass > /dev/null 2>&1; then
            mc mb --ignore-existing was-local/wallandshadow > /dev/null 2>&1 || true
            break
        fi
        sleep 1
    done
fi

echo "📝 Updating dot-config..."
git -C "$HOME/.config" pull --ff-only origin main 2>/dev/null \
    && echo "   ✅ dot-config up to date" \
    || echo "   ℹ️  dot-config pull skipped (offline or local changes)"

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
echo "    MinIO API:               http://127.0.0.1:9000"
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
