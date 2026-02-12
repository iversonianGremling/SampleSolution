# Building Sample Extractor - Complete Guide

## 🎯 Build Modes

| Mode | Command | Use Case | Backend |
|------|---------|----------|---------|
| **Web Dev** | `npm run dev` | Daily development | Separate (Docker/npm) |
| **Electron Dev** | `npm run dev:electron` | Test desktop app | Separate (Docker/npm) |
| **Web Prod** | `npm run build` | Deploy to server | Separate server |
| **Electron Standalone** | `./build-standalone.sh` | Distribute to users | **Embedded** ✨ |

---

## 🌐 Web Development (Default)

**Best for:** Daily development, testing features

### Quick Start

```bash
# Terminal 1: Start backend
cd backend
npm start  # or docker compose up

# Terminal 2: Start frontend
cd frontend
npm run dev  # Opens at http://localhost:3000
```

**Features:**
- ✅ Hot reload
- ✅ Fast iteration
- ✅ Browser DevTools
- ✅ Works on any platform

---

## 🖥️ Electron Development

**Best for:** Testing desktop features, UI in Electron

### Quick Start

```bash
# Terminal 1: Start backend
cd backend
npm start

# Terminal 2: Start Electron
cd frontend
npm run dev:electron
```

**Features:**
- ✅ Hot reload (same as web)
- ✅ Electron DevTools
- ✅ Test native features (file drag/drop, etc.)
- ✅ Backend runs separately (easy to debug)

---

## 📦 Standalone Build (Full Embedding - Option B2)

**Best for:** Distributing to end users

### What Gets Embedded

```
Sample-Extractor.AppImage (~1.2GB)
├── Frontend (React app)
├── Backend (Node.js server)
├── Python (3.11 with libraries)
└── TensorFlow + native modules
```

### Prerequisites

1. **Linux** (for Linux builds) or **macOS** (for macOS builds)
2. **Node.js** 18+
3. **npm** or **yarn**
4. **Internet connection** (to download Python)
5. **~5GB free disk space**

### Build Steps

#### Option A: One-Command Build (Recommended)

```bash
cd frontend
./build-standalone.sh
```

This will:
1. Download Python standalone runtime (~400MB)
2. Install Python dependencies (numpy, librosa, etc.)
3. Build backend TypeScript
4. Bundle backend with node_modules
5. Rebuild native modules for Electron
6. Build frontend React app
7. Package everything

**Time:** 15-30 minutes (first time), ~5 minutes (subsequent)

#### Option B: Step-by-Step (Manual)

```bash
cd frontend

# 1. Setup Python
./scripts/setup-python.sh

# 2. Build backend
cd ../backend && npm run build && cd ../frontend

# 3. Bundle backend
./scripts/bundle-backend.sh

# 4. Rebuild native modules
./scripts/rebuild-native.sh

# 5. Build frontend
npm run build

# 6. Package
npm run build:electron
```

### Output

```
frontend/release/
├── Sample-Extractor-1.0.0.AppImage  (~1.2GB)
├── Sample-Extractor_1.0.0_amd64.deb (~1.2GB)
└── builder-debug.yml
```

### Running the Build

```bash
# Make executable (if needed)
chmod +x frontend/release/Sample-Extractor-*.AppImage

# Run
./frontend/release/Sample-Extractor-*.AppImage
```

The app will:
1. Start embedded backend automatically
2. Initialize Python runtime
3. Open the UI
4. Everything works offline!

---

## 🔧 Incremental Builds

After the first standalone build, you can rebuild faster:

### Frontend-Only Changes

```bash
cd frontend
npm run build
npm run build:electron
```

**Time:** ~2 minutes

### Backend-Only Changes

```bash
cd frontend
./scripts/bundle-backend.sh
./scripts/rebuild-native.sh  # Only if native modules changed
npm run build:electron
```

**Time:** ~3-5 minutes

### Python Changes

```bash
cd frontend
./scripts/setup-python.sh
npm run build:electron
```

**Time:** ~10 minutes

---

## 🐛 Troubleshooting

### Build Fails: "Python download failed"

**Solution:**
```bash
# Download manually from:
# https://github.com/indygreg/python-build-standalone/releases

# Extract to frontend/embedded-python/
# Then continue with ./scripts/bundle-backend.sh
```

### Build Fails: "Native module rebuild error"

**Solution:**
```bash
# Clean and retry
rm -rf frontend/embedded-backend/node_modules/@tensorflow
rm -rf frontend/embedded-backend/node_modules/better-sqlite3
./scripts/bundle-backend.sh
./scripts/rebuild-native.sh
```

### App Won't Start: "Backend not found"

**Check:**
```bash
# Verify embedded backend exists
ls -la frontend/embedded-backend/dist/index.js

# If missing, rebuild:
./scripts/bundle-backend.sh
```

### App Starts But Backend Errors

**Check logs:**
```bash
# Run from terminal to see logs
./frontend/release/Sample-Extractor-*.AppImage

# Check stderr output
```

Common issues:
- Database permissions
- Missing environment variables
- Python library loading errors

### Python Features Don't Work

**Check:**
```bash
# Verify Python is embedded
ls -la frontend/embedded-python/bin/python3

# Test Python
frontend/embedded-python/bin/python3 -c "import numpy; print('OK')"
```

If missing:
```bash
./scripts/setup-python.sh
npm run build:electron
```

---

## 📁 Build Artifacts

### What Gets Generated

```
frontend/
├── embedded-python/          # ~400MB - Python runtime
├── embedded-backend/         # ~300MB - Backend bundle
├── dist/                     # ~5MB - Frontend build
└── release/                  # ~1.2GB - Final packages
```

### What's in the Package

When you run the built app:

```
~/.config/Sample Extractor/  (Linux)
~/Library/Application Support/Sample Extractor/  (macOS)
└── backend-data/            # User's data
    ├── db.sqlite           # Database
    └── uploads/            # Uploaded files
```

---

## 🚀 Distribution

### Create Release

```bash
# Build
./build-standalone.sh

# Compress (optional)
cd release
tar -czf Sample-Extractor-1.0.0-linux.tar.gz Sample-Extractor-*.AppImage

# Upload to GitHub Releases
gh release create v1.0.0 \
  Sample-Extractor-1.0.0-linux.tar.gz \
  --title "v1.0.0 - Standalone Release" \
  --notes "Full standalone build with embedded backend and Python"
```

### User Installation

Users just:
1. Download `.AppImage`
2. `chmod +x Sample-Extractor-*.AppImage`
3. Double-click to run
4. That's it! ✨

No Docker, no npm, no Python installation needed.

---

## 💡 Tips

### Faster Iteration

**During development:**
- Use `npm run dev` (web mode) - fastest
- Only test in Electron when needed
- Build standalone only for final testing

**For testing:**
```bash
# Test without full build
cd backend && npm start &
npm run dev:electron
```

### Smaller Builds

If you don't need Python features:

1. Comment out Python in `build-standalone.sh`
2. Remove Python from `package.json` extraResources
3. Package will be ~600MB instead of ~1.2GB

### Cross-Platform Builds

**For Windows:**
- Build on Windows machine
- Or use electron-builder with wine

**For macOS:**
- Must build on macOS (Apple requirement)
- Can use CI/CD (GitHub Actions with macOS runner)

---

## 📊 Build Comparison

| Aspect | Web Dev | Electron Dev | Standalone |
|--------|---------|--------------|------------|
| **Build time** | 30s | 30s | 20 min |
| **Rebuild time** | 5s | 5s | 2-5 min |
| **Package size** | ~5MB | ~5MB | ~1.2GB |
| **Backend** | External | External | Embedded |
| **User setup** | Server | Docker | None |
| **Distribution** | Deploy | N/A | Download |

---

## 🎯 Recommended Workflow

1. **Develop** with `npm run dev` (web mode)
2. **Test features** with `npm run dev:electron`
3. **Build standalone** once per release
4. **Distribute** to users

Web mode is your daily driver - fast, easy, full-featured. Standalone build is for releases only.

---

## ❓ FAQ

**Q: Can I skip Python embedding?**
A: Yes, but advanced audio features won't work. Edit `build-standalone.sh` to skip Python steps.

**Q: How big is the download for users?**
A: ~600MB compressed, ~1.2GB installed.

**Q: Does web development still work?**
A: **Yes!** Nothing changes. Web dev is completely unaffected.

**Q: Can I update just the frontend?**
A: Yes: `npm run build && npm run build:electron` (~2 min)

**Q: Do I need to rebuild for every platform?**
A: Yes. Linux builds won't run on Windows, etc.

---

Need help? Check [BACKEND-INTEGRATION.md](BACKEND-INTEGRATION.md) and [ELECTRON.md](ELECTRON.md)!
