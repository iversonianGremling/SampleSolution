#!/bin/bash
set -e

echo "🏗️  Building Standalone Electron App with Embedded Backend"
echo "=========================================================="
echo ""
echo "This will download Python, bundle the backend, rebuild native"
echo "modules, and package everything into a single executable."
echo ""
echo "Estimated time: 15-30 minutes (first build)"
echo "Package size: ~1.2GB"
echo ""

read -p "Continue? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Build cancelled."
    exit 1
fi

echo ""
echo "Starting build..."
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Step 1: Setup Python
echo "═══════════════════════════════════════════════════════════"
echo "Step 1/6: Setting up embedded Python runtime..."
echo "═══════════════════════════════════════════════════════════"
./scripts/setup-python.sh

# Step 2: Build backend
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "Step 2/6: Building backend TypeScript..."
echo "═══════════════════════════════════════════════════════════"
cd ../backend
npm run build
cd ../frontend

# Step 3: Bundle backend
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "Step 3/6: Bundling backend with dependencies..."
echo "═══════════════════════════════════════════════════════════"
./scripts/bundle-backend.sh

# Step 4: Rebuild native modules
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "Step 4/6: Rebuilding native modules for Electron..."
echo "═══════════════════════════════════════════════════════════"
./scripts/rebuild-native.sh

# Step 5: Build frontend
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "Step 5/6: Building frontend React app..."
echo "═══════════════════════════════════════════════════════════"
npm run build

# Step 6: Package with electron-builder
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "Step 6/6: Packaging with electron-builder..."
echo "═══════════════════════════════════════════════════════════"
npm run build:electron

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "✅ Build Complete!"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Output files:"
ls -lh release/
echo ""
echo "Total size:"
du -sh release/
echo ""
echo "To run the app:"
echo "  ./release/Sample-Extractor-*.AppImage"
echo ""
