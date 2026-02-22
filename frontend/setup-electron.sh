#!/bin/bash

# Electron Setup Script
# This script installs Electron dependencies and tests both web and electron modes

set -e

echo "🚀 Setting up Electron..."
echo ""

# Check if we're in the frontend directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: package.json not found. Please run this script from the frontend directory."
    exit 1
fi

# Install dependencies
echo "📦 Installing dependencies (this may take a few minutes)..."
npm install

echo ""
echo "✅ Dependencies installed!"
echo ""

# Check if electron directory exists
if [ ! -d "electron" ]; then
    echo "❌ Error: electron/ directory not found."
    echo "   Expected: frontend/electron/main.js and frontend/electron/preload.js"
    exit 1
fi

echo "✨ Electron setup complete!"
echo ""
echo "Available commands:"
echo "  npm run dev          - Run in web browser (http://localhost:3000)"
echo "  npm run dev:electron - Run in Electron app"
echo "  npm run build        - Build for web"
echo "  npm run build:electron - Build Electron app (creates .AppImage, .deb, etc.)"
echo ""
echo "Debug Panel:"
echo "  The debug panel will appear in the top-right corner of the app."
echo "  It shows platform info, WebGL status, and GPU acceleration details."
echo ""
echo "Next steps:"
echo "  1. Start web dev server:     npm run dev"
echo "  2. Or start Electron:        npm run dev:electron"
echo ""
echo "📖 See ELECTRON.md for detailed documentation."
