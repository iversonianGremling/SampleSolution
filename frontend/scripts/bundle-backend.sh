#!/bin/bash
set -e

echo "📦 Bundling backend for Electron embedding..."
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$(dirname "$SCRIPT_DIR")"
BACKEND_DIR="$FRONTEND_DIR/../backend"
BUNDLE_DIR="$FRONTEND_DIR/embedded-backend"

# Verify backend exists
if [ ! -d "$BACKEND_DIR" ]; then
    echo "❌ Backend directory not found: $BACKEND_DIR"
    exit 1
fi

# Clean previous bundle
echo "Cleaning previous bundle..."
rm -rf "$BUNDLE_DIR"
mkdir -p "$BUNDLE_DIR"

# Always rebuild backend to avoid embedding stale dist output.
echo ""
echo "🔨 Building backend..."
cd "$BACKEND_DIR"
echo "Running npm run build..."
npm run build

# Copy built backend
echo ""
echo "📋 Copying backend files..."
cp -r dist "$BUNDLE_DIR/"
echo "✓ Copied dist/"

# Copy Python scripts
if [ -d "src/python" ]; then
    cp -r src/python "$BUNDLE_DIR/dist/"
    echo "✓ Copied Python scripts"
fi

# Create package.json for embedded backend
echo ""
echo "📝 Creating package.json..."
cat > "$BUNDLE_DIR/package.json" << 'EOF'
{
  "name": "sample-extractor-backend-embedded",
  "version": "1.0.0",
  "type": "module",
  "main": "dist/index.js",
  "dependencies": {
    "axios": "^1.6.5",
    "better-sqlite3": "^9.3.0",
    "cors": "^2.8.5",
    "dotenv": "^17.2.3",
    "drizzle-orm": "^0.29.3",
    "express": "^4.18.2",
    "express-session": "^1.17.3",
    "googleapis": "^130.0.0",
    "meyda": "^5.6.3",
    "multer": "^2.0.2",
    "archiver": "^7.0.1",
    "uuid": "^9.0.0",
    "ffmpeg-static": "^5.2.0",
    "ffprobe-static": "^3.1.0"
  }
}
EOF

# Remove yamnet.js — it depends on @tensorflow/tfjs-node (native C++ addon)
# which is not bundled.  All ML inference runs via Python subprocess instead.
rm -f "$BUNDLE_DIR/dist/services/yamnet.js" "$BUNDLE_DIR/dist/services/yamnet.js.map" \
      "$BUNDLE_DIR/dist/services/yamnet.d.ts" "$BUNDLE_DIR/dist/services/yamnet.d.ts.map"

# Install production dependencies
echo ""
echo "📦 Installing production dependencies..."
cd "$BUNDLE_DIR"
npm install --production --legacy-peer-deps

# Rebuild native modules (better-sqlite3) against Electron's Node ABI.
# The embedded backend runs via ELECTRON_RUN_AS_NODE=1 which uses Electron's
# bundled Node.js, not the system Node.  Native addons must match that ABI.
echo ""
echo "🔧 Rebuilding native modules for Electron..."
cd "$FRONTEND_DIR"
ELECTRON_VERSION=$(node -e "console.log(require('electron/package.json').version)")
npx @electron/rebuild \
  --module-dir "$BUNDLE_DIR" \
  --electron-version "$ELECTRON_VERSION" \
  --only better-sqlite3
cd "$BUNDLE_DIR"

# Ensure bundled ffmpeg/ffprobe binaries are executable and clear macOS quarantine.
echo ""
echo "🔧 Fixing ffmpeg/ffprobe binary permissions..."
# ffmpeg-static puts the binary at the package root (ffmpeg or ffmpeg.exe)
# ffprobe-static puts it under bin/{platform}/{arch}/ffprobe[.exe]
find "$BUNDLE_DIR/node_modules/ffmpeg-static" "$BUNDLE_DIR/node_modules/ffprobe-static" \
    \( -name 'ffmpeg' -o -name 'ffmpeg.exe' -o -name 'ffprobe' -o -name 'ffprobe.exe' \) \
    -type f -exec chmod +x {} + 2>/dev/null || true
# Remove macOS quarantine attribute so Gatekeeper doesn't block the binaries
if command -v xattr &> /dev/null; then
    xattr -cr "$BUNDLE_DIR/node_modules/ffmpeg-static" 2>/dev/null || true
    xattr -cr "$BUNDLE_DIR/node_modules/ffprobe-static" 2>/dev/null || true
    echo "✓ Cleared quarantine attributes"
fi
echo "✓ Binary permissions set"

# Clean ffmpeg-static/ffprobe-static install scripts and docs (not needed at runtime)
rm -rf "$BUNDLE_DIR/node_modules/ffmpeg-static/install.js" \
       "$BUNDLE_DIR/node_modules/ffmpeg-static/.github" \
       "$BUNDLE_DIR/node_modules/ffprobe-static/install.js" \
       "$BUNDLE_DIR/node_modules/ffprobe-static/.github" 2>/dev/null || true

# Remove native module build artifacts (only the .node binary is needed at runtime).
# These intermediate files add ~16 MB and create deeply nested paths that break
# Windows NSIS installer builds (260-char path limit).
echo ""
echo "🧹 Cleaning native module build artifacts..."
SQLITE_BUILD="$BUNDLE_DIR/node_modules/better-sqlite3/build"
if [ -d "$SQLITE_BUILD" ]; then
    find "$SQLITE_BUILD" -name "*.o" -o -name "*.a" -o -name "*.Makefile" -o -name "*.target.mk" -o -name "*.mk" | xargs rm -f 2>/dev/null
    rm -rf "$SQLITE_BUILD/Release/.deps" "$SQLITE_BUILD/Release/obj" "$SQLITE_BUILD/Release/obj.target" \
           "$SQLITE_BUILD/Release/test_extension.node" "$SQLITE_BUILD/Release/.forge-meta" \
           "$SQLITE_BUILD/config.gypi" "$SQLITE_BUILD/gyp-mac-tool" 2>/dev/null
    echo "✓ Cleaned build artifacts"
fi

# Create environment file
echo ""
echo "📝 Creating .env file..."
cat > "$BUNDLE_DIR/.env" << 'EOF'
PORT=4000
NODE_ENV=production
EOF

# Create data directories
mkdir -p "$BUNDLE_DIR/data"
mkdir -p "$BUNDLE_DIR/uploads"

# Check bundle size
BUNDLE_SIZE=$(du -sh "$BUNDLE_DIR" | cut -f1)
echo ""
echo "✅ Backend bundled successfully!"
echo "   Location: $BUNDLE_DIR"
echo "   Size: $BUNDLE_SIZE"
echo ""
echo "Contents:"
ls -lh "$BUNDLE_DIR"
echo ""
