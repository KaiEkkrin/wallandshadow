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

# Start RustFS (idempotent — skips if already running)
RUSTFS_DATA="/workspaces/wallandshadow/.devcontainer/.rustfs-data"
RUSTFS_LOG="/workspaces/wallandshadow/.devcontainer/rustfs.log"
mkdir -p "$RUSTFS_DATA"
if pgrep -x rustfs > /dev/null 2>&1; then
    echo "🪣 RustFS already running"
else
    echo "🪣 Starting RustFS..."
    # Bind to [::] (dual-stack), not 0.0.0.0: Podman's rootless port forwarding
    # delivers the published ports over IPv6, so an IPv4-only listener is
    # unreachable from the host.
    nohup env RUSTFS_ACCESS_KEY=wasdev RUSTFS_SECRET_KEY=wasdevpass \
        rustfs server "$RUSTFS_DATA" \
        --address "[::]:9000" --console-enable --console-address "[::]:9001" \
        > "$RUSTFS_LOG" 2>&1 &
    disown

    RUSTFS_READY=false
    for i in $(seq 1 20); do
        if curl -sf -o /dev/null http://localhost:9000/health; then
            RUSTFS_READY=true
            break
        fi
        sleep 0.5
    done
    if [ "$RUSTFS_READY" != true ]; then
        echo "   ⚠️  RustFS did not become ready — see $RUSTFS_LOG"
    fi
fi

# Ensure the dev and test buckets exist, with the same CORS rules production
# applies to its buckets (ansible/templates/bucket_cors.json.j2) but allowing the
# Vite dev origin. The client loads images with crossOrigin="anonymous", so
# without this every image fails to load. Both calls are idempotent, so this is
# safe on every start. curl signs the requests itself.
CORS_XML='<CORSConfiguration><CORSRule><AllowedOrigin>http://localhost:5000</AllowedOrigin><AllowedMethod>GET</AllowedMethod><AllowedMethod>HEAD</AllowedMethod><AllowedHeader>*</AllowedHeader><ExposeHeader>ETag</ExposeHeader><ExposeHeader>Content-Length</ExposeHeader><ExposeHeader>Content-Type</ExposeHeader><MaxAgeSeconds>3600</MaxAgeSeconds></CORSRule></CORSConfiguration>'
CORS_MD5=$(printf '%s' "$CORS_XML" | openssl dgst -md5 -binary | base64)
s3_put() {
    curl -fsS -o /dev/null --aws-sigv4 "aws:amz:us-east-1:s3" --user wasdev:wasdevpass -X PUT "$@"
}
for bucket in wallandshadow wallandshadow-test; do
    if ! s3_put "http://localhost:9000/$bucket"; then
        echo "   ⚠️  Could not create bucket '$bucket' — see $RUSTFS_LOG"
    elif ! s3_put -H "Content-MD5: $CORS_MD5" -H "Content-Type: application/xml" \
        --data-binary "$CORS_XML" "http://localhost:9000/$bucket?cors"; then
        echo "   ⚠️  Could not set CORS on bucket '$bucket' — see $RUSTFS_LOG"
    fi
done

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
echo "  Hono API Server:         http://localhost:3000  (start manually)"
echo "  React Dev Server:        http://localhost:5000  (start manually)"
echo "  PostgreSQL:              localhost:5432         (auto-started)"
echo "  RustFS console:          http://localhost:9001/rustfs/console/  (auto-started)"
echo "  RustFS S3 API:           http://localhost:9000"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "💡 psql:     psql -h localhost -U was wallandshadow"
echo ""
