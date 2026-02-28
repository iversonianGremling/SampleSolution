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
    "uuid": "^9.0.0"
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
