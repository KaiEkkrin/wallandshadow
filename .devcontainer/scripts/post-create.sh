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
# Use -f to force in case they already exist from a rebuild
# Use $HOME instead of /home/node for Podman rootless compatibility
# (updateRemoteUserUID may remap the node user's UID, but HOME stays /home/node)
ln -sfn "$DEVCONTAINER_DIR/.cache/firebase" "$HOME/.cache/firebase"
ln -sfn "$DEVCONTAINER_DIR/.config" "$HOME/.config"
ln -sfn "$DEVCONTAINER_DIR/.claude" "$HOME/.claude"

echo "   ✅ \$HOME/.cache/firebase -> .devcontainer/.cache/firebase"
echo "   ✅ \$HOME/.config -> .devcontainer/.config"
echo "   ✅ \$HOME/.claude -> .devcontainer/.claude"
echo ""

# Check for Firebase admin credentials
CREDS_FILE="/workspaces/wallandshadow/was-web/firebase-admin-credentials.json"
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

# Install Firebase Functions dependencies
echo "📦 Installing Firebase Functions dependencies..."
cd /workspaces/wallandshadow/was-web/functions
if [ -f "yarn.lock" ]; then
    echo "   Using yarn.lock for deterministic install..."
    yarn install --frozen-lockfile || yarn install
else
    yarn install
fi
echo ""

# Install Playwright browsers for E2E tests
echo "🎭 Installing Playwright browsers..."
cd /workspaces/wallandshadow/was-web
npx playwright install || echo "   Note: Playwright browser installation failed (non-critical)"
echo ""

# Firebase setup
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

echo "✅ Setup complete!"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📚 Quick Start Guide"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Start development server:"
echo "    cd was-web && yarn start"
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
