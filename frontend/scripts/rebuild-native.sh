#!/bin/bash
set -e

echo "🔧 Rebuilding native modules for Electron..."
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$(dirname "$SCRIPT_DIR")"
BUNDLE_DIR="$FRONTEND_DIR/embedded-backend"

# Verify bundle exists
if [ ! -d "$BUNDLE_DIR" ]; then
    echo "❌ Backend bundle not found: $BUNDLE_DIR"
    echo "Run ./scripts/bundle-backend.sh first"
    exit 1
fi

cd "$FRONTEND_DIR"

# Install electron-rebuild if not present
if ! npm list @electron/rebuild &>/dev/null; then
    echo "Installing @electron/rebuild..."
    npm install --save-dev @electron/rebuild
fi

# Get Electron version
ELECTRON_VERSION=$(node -p "require('./package.json').devDependencies.electron" | tr -d '^~')
echo "Electron version: $ELECTRON_VERSION"
echo ""

# Rebuild native modules
echo "Rebuilding native modules..."
echo "This may take 5-10 minutes..."
echo ""

# Rebuild @tensorflow/tfjs-node
echo "1. Rebuilding @tensorflow/tfjs-node..."
npx @electron/rebuild -f \
  -w @tensorflow/tfjs-node \
  -m "$BUNDLE_DIR" \
  -v "$ELECTRON_VERSION" || echo "⚠️  TensorFlow rebuild had issues (may still work)"

echo ""

# Rebuild better-sqlite3
echo "2. Rebuilding better-sqlite3..."
npx @electron/rebuild -f \
  -w better-sqlite3 \
  -m "$BUNDLE_DIR" \
  -v "$ELECTRON_VERSION"

echo ""
echo "✅ Native modules rebuilt for Electron $ELECTRON_VERSION"
echo ""
echo "Verifying .node files:"
find "$BUNDLE_DIR/node_modules" -name "*.node" -type f | head -10
echo ""
