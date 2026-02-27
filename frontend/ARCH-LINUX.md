# Building on Arch Linux

## ✅ **Arch Linux is Fully Supported**

Your development platform (Arch) is actually **ideal** for building Electron apps. Here's what you need:

---

## 📦 **Prerequisites**

### Install Build Dependencies

```bash
# Core build tools (you probably have these)
sudo pacman -S base-devel git nodejs npm python

# Electron dependencies
sudo pacman -S gtk3 nss alsa-lib

# Optional: For better AppImage support
sudo pacman -S fuse2
```

That's it! Arch has everything needed.

---

## 🚀 **Quick Test**

### 1. **Test Web Dev (Should Already Work)**

```bash
cd frontend
npm install
npm run dev
```

### 2. **Test Electron Dev**

```bash
# Terminal 1: Start backend
cd backend && npm start

# Terminal 2: Start Electron
cd frontend && npm run dev:electron
```

If Electron dev works, the standalone build will work too!

---

## 📦 **Build Standalone App**

### Full Build

```bash
cd frontend
./build-standalone.sh
```

**What happens:**
1. Downloads Python standalone (Linux x86_64 build)
2. Installs numpy, librosa, scipy, etc.
3. Builds backend TypeScript
4. Bundles with node_modules
5. Rebuilds TensorFlow & SQLite for Electron
6. Packages as AppImage

**Time:** ~20 minutes first time, ~5 minutes after

### Quick Build (After First Time)

```bash
# Just rebuild frontend + package
npm run build && npm run build:electron
```

**Time:** ~2 minutes

---

## 🏃 **Running the Built App**

```bash
# Make executable
chmod +x release/Sample-Extractor-*.AppImage

# Run
./release/Sample-Extractor-*.AppImage
```

### If You Get "FUSE" Error

```bash
# Install fuse2
sudo pacman -S fuse2

# Or extract and run directly
./Sample-Extractor-*.AppImage --appimage-extract
./squashfs-root/AppRun
```

---

## 🔧 **Arch-Specific Notes**

### 1. **Python Standalone Works Great**

The python-build-standalone builds are compiled to work on any Linux distro, including Arch. No special handling needed.

### 2. **Native Modules Build Smoothly**

Arch's up-to-date toolchain (gcc, make, etc.) handles native modules perfectly:
- `@tensorflow/tfjs-node` ✅
- `better-sqlite3` ✅

### 3. **AppImage Support**

AppImages work on Arch out of the box. If you prefer:

```bash
# Build .deb instead (can convert to pacman package)
# Edit package.json:
"linux": {
  "target": ["AppImage", "pacman"]
}
```

But AppImage is more portable for distribution.

---

## 🐛 **Troubleshooting**

### Issue: `npm run dev:electron` Shows Blank Screen

**Check backend:**
```bash
curl http://localhost:4000/api/auth/status
```

If it fails, start backend first:
```bash
cd backend && npm start
```

### Issue: Native Module Build Fails

**Install missing headers:**
```bash
sudo pacman -S python python-numpy  # For Python headers
```

### Issue: Electron Won't Launch

**Check for missing libraries:**
```bash
# Test Electron binary directly
npx electron --version
```

If it fails, install GTK/NSS:
```bash
sudo pacman -S gtk3 nss
```

### Issue: AppImage Won't Run

**Option 1: Install FUSE**
```bash
sudo pacman -S fuse2
```

**Option 2: Extract & Run**
```bash
./Sample-Extractor-*.AppImage --appimage-extract
./squashfs-root/AppRun
```

---

## 💡 **Arch Advantages**

**Why Arch is great for Electron dev:**

1. ✅ **Rolling release** - Always latest Node.js, npm, Python
2. ✅ **AUR** - Easy access to dev tools
3. ✅ **Up-to-date toolchain** - Native modules compile smoothly
4. ✅ **No version conflicts** - Clean, minimal system

**Potential issues:**
- ⚠️ Too new packages? Rare, but if you hit issues, use `nvm` for specific Node version

---

## 📊 **Expected Build Output on Arch**

```bash
$ ./build-standalone.sh

# Should complete successfully with:
✅ Python setup complete! (~5 min)
✅ Backend bundled! (~2 min)
✅ Native modules rebuilt! (~8 min)
✅ Frontend built! (~1 min)
✅ Packaged! (~5 min)

Output:
frontend/release/
├── Sample-Extractor-1.0.0.AppImage  (~1.2GB)
├── Sample-Extractor_1.0.0_amd64.deb (~1.2GB)  # If enabled
└── builder-debug.yml
```

---

## 🧪 **Testing Checklist**

Before distributing to users:

```bash
# 1. Test AppImage
./release/Sample-Extractor-*.AppImage

# Verify:
- [ ] App launches
- [ ] Backend starts (check terminal logs)
- [ ] UI loads
- [ ] Can import audio files
- [ ] Audio analysis works (Python features)
- [ ] Can create slices
- [ ] Database persists (~/.config/Sample Extractor/)

# 2. Test on clean Arch VM (optional but recommended)
# - Ensures no missing dependencies
# - Confirms it works without dev tools installed
```

---

## 🚀 **Recommended Workflow on Arch**

### Daily Development

```bash
# Use web mode - fastest iteration
npm run dev

# Hot reload, browser DevTools, easy debugging
```

### Test Desktop Features

```bash
# Use Electron dev mode
npm run dev:electron

# Still fast, connects to separate backend
```

### Build for Distribution

```bash
# Once per release
./build-standalone.sh

# Test the built AppImage
./release/Sample-Extractor-*.AppImage
```

---

## 📝 **Arch-Specific Tips**

### Use `yay` or `paru` for Extra Tools

```bash
# Install latest electron globally (optional)
yay -S electron

# Install AppImage tools
yay -S appimagetool
```

### Keep System Updated

```bash
# Before building for release
sudo pacman -Syu

# Ensures latest toolchain
```

### Use `nvm` for Node Version Management

```bash
# If you need specific Node version
yay -S nvm
nvm install 18
nvm use 18
```

## 📦 **AUR Packaging Automation**

This repo now includes an AUR scaffold in `packaging/aur` for `sample-solution-bin`.

```bash
# 1) Update PKGBUILD + .SRCINFO from a GitHub release tag
./packaging/aur/update-pkgbuild.sh --version 0.1.0

# 2) Build/test locally
cd packaging/aur
makepkg -si
```

Useful helper:

```bash
./packaging/aur/calc-sha256.sh https://github.com/OWNER/REPO/releases/download/v0.1.0/linux-YourAsset.AppImage
```

Then copy `PKGBUILD` + `.SRCINFO` into your AUR git repo and push.

---

## ✨ **You're All Set!**

Arch is probably the **best** platform for this workflow:
- Latest packages ✅
- Clean dependency management ✅
- Great for development ✅
- Smooth native module builds ✅

Just run:

```bash
cd frontend
./build-standalone.sh
```

And you'll have a working AppImage! 🎉

---

**Questions or issues?** Arch Linux is well-supported. Most "Linux" instructions apply directly to Arch with no modifications needed.
