#!/bin/bash
set -e

echo ""
echo "🚀 Setting up Wall & Shadow development environment..."
echo ""

# Verify repository is in the expected location
if [ ! -d "/workspaces/wallandshadow/.git" ]; then
    echo "❌ ERROR: Repository not found at /workspaces/wallandshadow"
    echo ""
    echo "   Please see .devcontainer/README.md for setup instructions."
    echo ""
    exit 1
fi

echo "✅ Repository found at /workspaces/wallandshadow"
echo ""

# Create directories for cache, config, and credentials within the workspace
# These will be symlinked from /home/node to keep everything in one volume
echo "🔗 Setting up cache and config symlinks..."
DEVCONTAINER_DIR="/workspaces/wallandshadow/.devcontainer"

# Create actual directories within .devcontainer
mkdir -p "$DEVCONTAINER_DIR/.cache/firebase"
mkdir -p "$DEVCONTAINER_DIR/.config"
mkdir -p "$DEVCONTAINER_DIR/.claude"

# Create parent directories in home if they don't exist
mkdir -p "$HOME/.cache"

# Create symlinks from home directory to workspace
# Use $HOME instead of /home/node for Podman rootless compatibility
# (updateRemoteUserUID may remap the node user's UID, but HOME stays /home/node)
#
# IMPORTANT: The Claude CLI installer (Dockerfile) creates ~/.claude as a real
# directory during the image build. ln -sfn cannot replace a directory — it creates
# the symlink *inside* the directory instead. We must remove any real directory
# first so the symlink points where we expect. Same precaution for ~/.config.
for dir in "$HOME/.claude" "$HOME/.config"; do
    if [ -d "$dir" ] && [ ! -L "$dir" ]; then
        rm -rf "$dir"
    fi
done
ln -sfn "$DEVCONTAINER_DIR/.cache/firebase" "$HOME/.cache/firebase"
ln -sfn "$DEVCONTAINER_DIR/.config" "$HOME/.config"
ln -sfn "$DEVCONTAINER_DIR/.claude" "$HOME/.claude"
mkdir -p "$DEVCONTAINER_DIR/.cache/ms-playwright"
ln -sfn "$DEVCONTAINER_DIR/.cache/ms-playwright" "$HOME/.cache/ms-playwright"

echo "   ✅ \$HOME/.cache/firebase -> .devcontainer/.cache/firebase"
echo "   ✅ \$HOME/.config -> .devcontainer/.config"
echo "   ✅ \$HOME/.claude -> .devcontainer/.claude"
echo "   ✅ \$HOME/.cache/ms-playwright -> .devcontainer/.cache/ms-playwright"
echo ""

# Clone dot-config into ~/.config so neovim, zellij, etc. pick up the shared config.
# Uses HTTPS (no SSH key setup needed in the container; push from the host instead).
# Existing untracked dirs (e.g. Code/ from VS Code) are preserved; tracked files are
# force-checked-out so the dot-config content is always authoritative.
echo "📝 Setting up dot-config..."
CONFIG_DIR="$DEVCONTAINER_DIR/.config"
if [ ! -d "$CONFIG_DIR/.git" ]; then
    echo "   Cloning dot-config from GitHub..."
    git init "$CONFIG_DIR"
    git -C "$CONFIG_DIR" remote add origin https://github.com/KaiEkkrin/dot-config.git
    git -C "$CONFIG_DIR" fetch origin main
    git -C "$CONFIG_DIR" checkout -f main
    echo "   ✅ dot-config checked out"
else
    echo "   ✅ dot-config already present (skipping clone)"
fi
echo ""

# Check for Firebase admin credentials (only relevant on the legacy-firebase branch,
# which is the only branch that still contains firebase.json / functions/)
FIREBASE_CONFIG="/workspaces/wallandshadow/was-web/firebase.json"
CREDS_FILE="/workspaces/wallandshadow/was-web/firebase-admin-credentials.json"
if [ -f "$FIREBASE_CONFIG" ]; then
    if [ ! -f "$CREDS_FILE" ]; then
        echo "⚠️  WARNING: Firebase admin credentials not found!"
        echo ""
        echo "📝 To enable full Firebase Functions and Firestore emulator functionality:"
        echo "   1. Open Firebase Console: https://console.firebase.google.com/"
        echo "   2. Select or create your Firebase project"
        echo "   3. Go to Project Settings > Service Accounts"
        echo "   4. Click 'Generate new private key'"
        echo "   5. Save the downloaded JSON file as:"
        echo "      was-web/firebase-admin-credentials.json"
        echo ""
        echo "   The dev container will work without this file, but some features"
        echo "   will be limited. You can add it later and restart the container."
        echo ""
    else
        echo "✅ Firebase admin credentials found"
        echo ""
    fi
else
    echo "ℹ️  Skipping Firebase admin credentials check (no firebase.json — main branch)"
    echo ""
fi

# Install web app dependencies
echo "📦 Installing web app dependencies..."
cd /workspaces/wallandshadow/was-web
if [ -f "yarn.lock" ]; then
    echo "   Using yarn.lock for deterministic install..."
    yarn install --frozen-lockfile || yarn install
else
    yarn install
fi
echo ""

# Install server dependencies
echo "📦 Installing server dependencies..."
cd /workspaces/wallandshadow/was-web/server
if [ -f "yarn.lock" ]; then
    echo "   Using yarn.lock for deterministic install..."
    yarn install --frozen-lockfile || yarn install
else
    yarn install
fi
echo ""

# Install Firebase Functions dependencies (legacy-firebase branch only)
FUNCTIONS_DIR="/workspaces/wallandshadow/was-web/functions"
if [ -d "$FUNCTIONS_DIR" ]; then
    echo "📦 Installing Firebase Functions dependencies..."
    cd "$FUNCTIONS_DIR"
    if [ -f "yarn.lock" ]; then
        echo "   Using yarn.lock for deterministic install..."
        yarn install --frozen-lockfile || yarn install
    else
        yarn install
    fi
    echo ""
else
    echo "ℹ️  Skipping Firebase Functions install (no was-web/functions — main branch)"
    echo ""
fi

# Install Playwright browsers for E2E tests
echo "🎭 Installing Playwright browsers..."
cd /workspaces/wallandshadow/was-web
npx playwright install || echo "   Note: Playwright browser installation failed (non-critical)"
echo ""

# Initialise PostgreSQL (runs once; data persists in .devcontainer/.pgdata/)
echo "🐘 Setting up PostgreSQL..."
if [ ! -f "$PGDATA/PG_VERSION" ]; then
    echo "   Initialising database cluster..."
    initdb -D "$PGDATA" --auth=trust --username=postgres --encoding=UTF8 --locale=C.UTF-8

    # Use TCP only (no Unix socket needed); keeps the setup simple.
    # Disable Unix socket entirely so pg_ctl doesn't try to create a lock file
    # in /var/run/postgresql (which the node user cannot write to).
    echo "listen_addresses = 'localhost'" >> "$PGDATA/postgresql.conf"
    echo "port = 5432" >> "$PGDATA/postgresql.conf"
    echo "unix_socket_directories = ''" >> "$PGDATA/postgresql.conf"

    # Start temporarily to create the app user and database
    pg_ctl -D "$PGDATA" -l "$PGDATA/postgresql.log" -w start

    psql -h localhost -U postgres -c "CREATE USER was WITH PASSWORD 'wasdev';"
    createdb -h localhost -U postgres --owner=was wallandshadow
    createdb -h localhost -U postgres --owner=was wallandshadow_test

    pg_ctl -D "$PGDATA" -w stop
    echo "   ✅ PostgreSQL cluster created (user: was, databases: wallandshadow, wallandshadow_test)"
else
    echo "   ✅ PostgreSQL cluster already initialised"
fi
echo ""

# Create MinIO data directory (runs once; data persists across rebuilds)
echo "🪣 Setting up MinIO..."
MINIO_DATA="/workspaces/wallandshadow/.devcontainer/.minio-data"
mkdir -p "$MINIO_DATA"
echo "   ✅ MinIO data directory ready"
echo ""

# Firebase setup (legacy-firebase branch only)
if [ -f "$FIREBASE_CONFIG" ]; then
    echo "🔥 Setting up Firebase..."
    cd /workspaces/wallandshadow/was-web

    # Try to login (may already be logged in)
    firebase login --no-localhost || echo "   Firebase login skipped (already logged in or running non-interactively)"

    # Check if a Firebase project is configured
    CURRENT_PROJECT=$(firebase use 2>/dev/null | grep "Now using" || echo "")
    if [ -z "$CURRENT_PROJECT" ]; then
        echo "   No Firebase project configured yet."
        echo "   You can run 'firebase use <project-id>' to select a project"
        echo "   or 'firebase use --add' to add a new project alias."
    else
        echo "   $CURRENT_PROJECT"
    fi
    echo ""
else
    echo "ℹ️  Skipping Firebase setup (no firebase.json — main branch)"
    echo ""
fi

echo "✅ Setup complete!"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📚 Quick Start Guide"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Start Firebase dev server (existing stack):"
echo "    cd was-web && yarn start"
echo ""
echo "  Connect to PostgreSQL:"
echo "    psql -h localhost -U was wallandshadow"
echo ""
echo "  MinIO console: http://localhost:9001 (wasdev / wasdevpass)"
echo ""
echo "  Run unit tests:"
echo "    cd was-web && yarn test:unit"
echo ""
echo "  Run E2E tests (requires dev server running):"
echo "    cd was-web && yarn test:e2e"
echo ""
echo "  View this guide anytime:"
echo "    cat .devcontainer/README.md"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
