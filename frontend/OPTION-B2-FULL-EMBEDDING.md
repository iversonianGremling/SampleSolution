# Option B2: Full Embedding - Complete Standalone App

## 🎯 Goal

**True standalone app** - user downloads one file, runs it, everything works. No Docker, no separate backend, no Python installation.

## 📦 What Gets Embedded

```
Electron App Package (~800MB - 1.5GB per platform)
│
├── Frontend (React + Vite build)
│   └── dist/ (~5MB)
│
├── Electron Runtime (~150MB)
│   ├── Chromium
│   └── Node.js
│
├── Backend (~300MB)
│   ├── Node.js API server
│   ├── npm dependencies
│   │   ├── TensorFlow.js Node (~200MB)
│   │   ├── better-sqlite3 (native)
│   │   └── All other packages
│   └── Python scripts
│
└── Python Runtime (~400MB)
    ├── Embedded Python 3.x
    ├── numpy
    ├── librosa
    ├── scipy
    ├── scikit-learn
    └── Other audio analysis libraries
```

---

## 🛠️ Implementation Steps

### **Phase 1: Prepare Backend (Node.js Part)**

#### 1.1. Build Backend for Production

```bash
cd backend
npm run build
```

This creates `backend/dist/` with compiled JavaScript.

#### 1.2. Install Production Dependencies

Create `backend/.npmrc`:
```
ignore-scripts=false
```

Then:
```bash
cd backend
npm install --production
```

#### 1.3. Create Electron-Specific Package

Create `backend/package.electron.json`:

```json
{
  "name": "sample-extractor-backend",
  "version": "1.0.0",
  "main": "dist/index.js",
  "type": "module",
  "dependencies": {
    "@tensorflow/tfjs-node": "^4.11.0",
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
    "uuid": "^9.0.0"
  }
}
```

---

### **Phase 2: Embed Python Runtime**

You have **3 options** for Python:

#### **Option 2A: Python Standalone Build (Recommended)**

Use **python-build-standalone** - pre-built Python with no dependencies.

Create `frontend/scripts/download-python.sh`:

```bash
#!/bin/bash
set -e

PYTHON_VERSION="3.11.7"
ARCH=$(uname -m)
OS=$(uname -s | tr '[:upper:]' '[:lower:]')

echo "📥 Downloading standalone Python for $OS-$ARCH..."

PYTHON_DIR="frontend/embedded-python"
rm -rf "$PYTHON_DIR"
mkdir -p "$PYTHON_DIR"

if [ "$OS" = "linux" ]; then
    URL="https://github.com/indygreg/python-build-standalone/releases/download/20240107/cpython-3.11.7+20240107-x86_64-unknown-linux-gnu-install_only.tar.gz"
elif [ "$OS" = "darwin" ]; then
    URL="https://github.com/indygreg/python-build-standalone/releases/download/20240107/cpython-3.11.7+20240107-aarch64-apple-darwin-install_only.tar.gz"
fi

wget -O python.tar.gz "$URL"
tar -xzf python.tar.gz -C "$PYTHON_DIR" --strip-components=1
rm python.tar.gz

echo "✅ Python downloaded to: $PYTHON_DIR"
```

#### **Option 2B: Bundle System Python (Easier but larger)**

Copy your system Python installation:

```bash
#!/bin/bash
mkdir -p frontend/embedded-python
cp -r /usr/lib/python3.11 frontend/embedded-python/
cp /usr/bin/python3 frontend/embedded-python/python
```

#### **Option 2C: PyInstaller Bundle (Most Portable)**

Package Python scripts as standalone executables:

```bash
cd backend/src/python
pip install pyinstaller

# Bundle each Python script
pyinstaller --onefile audio_analyzer.py
pyinstaller --onefile feature_extractor.py

# Copy to frontend
cp dist/* ../../../frontend/embedded-python-binaries/
```

---

### **Phase 3: Install Python Dependencies**

#### 3.1. Create Requirements File

Create `backend/python-requirements.txt`:

```txt
numpy==1.24.3
librosa==0.10.1
scipy==1.11.4
scikit-learn==1.3.2
soundfile==0.12.1
```

#### 3.2. Install into Embedded Python

```bash
#!/bin/bash
PYTHON_DIR="frontend/embedded-python"

# Install pip packages
$PYTHON_DIR/bin/python3 -m pip install -r ../backend/python-requirements.txt --target $PYTHON_DIR/lib/python3.11/site-packages

echo "✅ Python dependencies installed"
```

---

### **Phase 4: Prepare Backend Bundle**

Create `frontend/scripts/bundle-backend.sh`:

```bash
#!/bin/bash
set -e

echo "📦 Bundling complete backend for Electron..."

BACKEND_SRC="../backend"
BUNDLE_DIR="frontend/embedded-backend"

# Clean previous build
rm -rf "$BUNDLE_DIR"
mkdir -p "$BUNDLE_DIR"

# Copy built backend
echo "Copying backend files..."
cp -r "$BACKEND_SRC/dist" "$BUNDLE_DIR/"
cp -r "$BACKEND_SRC/node_modules" "$BUNDLE_DIR/"
cp "$BACKEND_SRC/package.electron.json" "$BUNDLE_DIR/package.json"

# Copy Python scripts
cp -r "$BACKEND_SRC/src/python" "$BUNDLE_DIR/python"

# Create data directory structure
mkdir -p "$BUNDLE_DIR/data"
mkdir -p "$BUNDLE_DIR/uploads"

# Create .env file
cat > "$BUNDLE_DIR/.env" << EOF
PORT=4000
NODE_ENV=production
DATA_PATH=./data
UPLOAD_PATH=./uploads
PYTHON_PATH=../embedded-python/bin/python3
EOF

echo "✅ Backend bundled at: $BUNDLE_DIR"
```

---

### **Phase 5: Rebuild Native Modules for Electron**

Native modules (TensorFlow, SQLite) must be compiled for Electron's Node.js version.

Create `frontend/scripts/rebuild-native.sh`:

```bash
#!/bin/bash
set -e

echo "🔨 Rebuilding native modules for Electron..."

cd frontend

# Install electron-rebuild
npm install --save-dev @electron/rebuild

# Rebuild native modules
npx @electron/rebuild -f \
  -w @tensorflow/tfjs-node \
  -w better-sqlite3 \
  -m embedded-backend

echo "✅ Native modules rebuilt for Electron"
```

---

### **Phase 6: Update Electron Main Process**

Update `frontend/electron/main.js`:

```javascript
const { app, BrowserWindow, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');
const { exec } = require('child_process');
const execAsync = promisify(exec);

let backendProcess = null;
let mainWindow;

// Get resource path (handles both dev and production)
function getResourcePath(relativePath) {
  if (app.isPackaged) {
    // Production: resources are in app.asar.unpacked or extraResources
    return path.join(process.resourcesPath, relativePath);
  } else {
    // Development
    return path.join(__dirname, '..', relativePath);
  }
}

// Check if embedded Python exists
function getPythonPath() {
  const pythonDir = getResourcePath('embedded-python');

  // Try different Python executables based on platform
  const possiblePaths = [
    path.join(pythonDir, 'bin', 'python3'),
    path.join(pythonDir, 'bin', 'python'),
    path.join(pythonDir, 'python.exe'), // Windows
    path.join(pythonDir, 'python'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return null;
}

// Test Python installation
async function testPython() {
  const pythonPath = getPythonPath();

  if (!pythonPath) {
    return { success: false, error: 'Python executable not found' };
  }

  try {
    const { stdout } = await execAsync(`"${pythonPath}" --version`);
    console.log('Python version:', stdout.trim());

    // Test numpy import
    const testImport = await execAsync(
      `"${pythonPath}" -c "import numpy; print('numpy OK')"`
    );
    console.log('Python libraries:', testImport.stdout.trim());

    return { success: true, version: stdout.trim() };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Start embedded backend
async function startBackend() {
  const isDev = process.env.NODE_ENV !== 'production';

  if (isDev) {
    console.log('🔧 Dev mode: Expecting backend at http://localhost:4000');
    return { success: true, mode: 'dev' };
  }

  console.log('🚀 Starting embedded backend...');

  // Get paths
  const backendPath = getResourcePath('embedded-backend');
  const pythonPath = getPythonPath();

  // Verify backend exists
  if (!fs.existsSync(backendPath)) {
    return {
      success: false,
      error: 'Embedded backend not found. App may be corrupted.'
    };
  }

  // Test Python
  const pythonTest = await testPython();
  if (!pythonTest.success) {
    console.warn('⚠️  Python test failed:', pythonTest.error);
    // Decide whether to continue or fail
    // For now, we'll continue but disable Python features
  }

  // Set up backend data directory in user's home
  const userDataPath = app.getPath('userData');
  const backendDataPath = path.join(userDataPath, 'backend-data');
  const uploadsPath = path.join(userDataPath, 'uploads');

  fs.mkdirSync(backendDataPath, { recursive: true });
  fs.mkdirSync(uploadsPath, { recursive: true });

  // Copy database schema if it doesn't exist
  const dbPath = path.join(backendDataPath, 'db.sqlite');
  if (!fs.existsSync(dbPath)) {
    // Run migrations or copy initial DB
    console.log('Initializing database...');
  }

  // Environment variables for backend
  const backendEnv = {
    ...process.env,
    PORT: '4000',
    NODE_ENV: 'production',
    DATA_PATH: backendDataPath,
    UPLOAD_PATH: uploadsPath,
    PYTHON_PATH: pythonPath || 'python3',
    PYTHON_AVAILABLE: pythonTest.success ? 'true' : 'false',
    // Disable GPU for TensorFlow (unless you want to handle GPU libs)
    CUDA_VISIBLE_DEVICES: '-1'
  };

  // Start Node.js backend
  console.log('Starting backend from:', backendPath);
  console.log('Data path:', backendDataPath);
  console.log('Python path:', pythonPath);

  backendProcess = spawn('node', ['dist/index.js'], {
    cwd: backendPath,
    env: backendEnv,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  backendProcess.stdout.on('data', (data) => {
    console.log(`[Backend] ${data.toString().trim()}`);
  });

  backendProcess.stderr.on('data', (data) => {
    console.error(`[Backend Error] ${data.toString().trim()}`);
  });

  backendProcess.on('error', (err) => {
    console.error('❌ Failed to start backend:', err);
  });

  backendProcess.on('exit', (code, signal) => {
    console.log(`Backend exited with code ${code}, signal ${signal}`);

    if (mainWindow && !mainWindow.isDestroyed()) {
      dialog.showErrorBox(
        'Backend Stopped',
        'The backend server has stopped. Please restart the application.'
      );
    }
  });

  // Wait for backend to be ready (check if port is listening)
  console.log('⏳ Waiting for backend to start...');
  await new Promise(resolve => setTimeout(resolve, 4000));

  // Verify backend is responding
  try {
    const http = require('http');
    await new Promise((resolve, reject) => {
      const req = http.get('http://localhost:4000/api/auth/status', (res) => {
        resolve();
      });
      req.on('error', reject);
      req.setTimeout(5000);
    });
    console.log('✅ Backend is ready');
  } catch (error) {
    console.error('⚠️  Backend may not be ready:', error.message);
  }

  return {
    success: true,
    mode: 'embedded',
    pythonAvailable: pythonTest.success,
    backendPath,
    dataPath: backendDataPath
  };
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    backgroundColor: '#1a1a1a',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webgl: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  const isDev = process.env.NODE_ENV !== 'production';

  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// App lifecycle
app.whenReady().then(async () => {
  console.log('=== Sample Extractor Starting ===');

  const backendResult = await startBackend();

  if (!backendResult.success) {
    await dialog.showErrorBox(
      'Backend Error',
      backendResult.error || 'Failed to start backend server. Please check logs.'
    );
    app.quit();
    return;
  }

  console.log('Backend started in mode:', backendResult.mode);

  if (backendResult.mode === 'embedded') {
    console.log('Data directory:', backendResult.dataPath);
    console.log('Python available:', backendResult.pythonAvailable);

    if (!backendResult.pythonAvailable) {
      // Optional: Show warning dialog
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          dialog.showMessageBox(mainWindow, {
            type: 'warning',
            title: 'Limited Functionality',
            message: 'Advanced audio analysis features are unavailable',
            detail: 'The embedded Python runtime could not be initialized. Basic features will work.',
            buttons: ['OK']
          });
        }
      }, 3000);
    }
  }

  await createWindow();
});

app.on('will-quit', () => {
  console.log('App is quitting, stopping backend...');
  if (backendProcess) {
    backendProcess.kill('SIGTERM');

    // Force kill after 5 seconds
    setTimeout(() => {
      if (backendProcess && !backendProcess.killed) {
        backendProcess.kill('SIGKILL');
      }
    }, 5000);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
```

---

### **Phase 7: Update electron-builder Configuration**

Update `frontend/package.json`:

```json
{
  "build": {
    "appId": "com.sample-extractor.app",
    "productName": "Sample Extractor",
    "files": [
      "dist/**/*",
      "electron/**/*"
    ],
    "extraResources": [
      {
        "from": "embedded-backend",
        "to": "embedded-backend",
        "filter": ["**/*"]
      },
      {
        "from": "embedded-python",
        "to": "embedded-python",
        "filter": ["**/*"]
      }
    ],
    "asarUnpack": [
      "**/*.node",
      "embedded-backend/**/*",
      "embedded-python/**/*"
    ],
    "linux": {
      "target": ["AppImage", "deb"],
      "category": "Audio",
      "extraFiles": [
        {
          "from": "embedded-backend/node_modules/@tensorflow/tfjs-node",
          "to": "resources/embedded-backend/node_modules/@tensorflow/tfjs-node",
          "filter": ["**/*"]
        }
      ]
    },
    "win": {
      "target": ["nsis", "portable"]
    },
    "mac": {
      "target": ["dmg"],
      "category": "public.app-category.music"
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true
    }
  }
}
```

---

### **Phase 8: Master Build Script**

Create `frontend/build-standalone.sh`:

```bash
#!/bin/bash
set -e

echo "🏗️  Building fully standalone Electron app..."
echo "This will take a while (10-30 minutes)..."
echo ""

# 1. Download/prepare Python
echo "📥 Step 1/7: Downloading embedded Python..."
./scripts/download-python.sh

# 2. Install Python dependencies
echo "📦 Step 2/7: Installing Python dependencies..."
PYTHON=embedded-python/bin/python3
$PYTHON -m pip install -r ../backend/python-requirements.txt

# 3. Build backend
echo "🔨 Step 3/7: Building backend..."
cd ../backend
npm run build
cd ../frontend

# 4. Bundle backend
echo "📦 Step 4/7: Bundling backend..."
./scripts/bundle-backend.sh

# 5. Rebuild native modules
echo "🔧 Step 5/7: Rebuilding native modules for Electron..."
./scripts/rebuild-native.sh

# 6. Build frontend
echo "🎨 Step 6/7: Building frontend..."
npm run build

# 7. Package with electron-builder
echo "📦 Step 7/7: Packaging Electron app..."
npm run build:electron

echo ""
echo "✅ Build complete!"
echo "📁 Output: frontend/release/"
ls -lh release/
```

Make it executable:
```bash
chmod +x frontend/build-standalone.sh
```

---

## 🚀 **Build Process**

### **Full Build (Clean)**

```bash
cd frontend
./build-standalone.sh
```

**Time:** 15-30 minutes (first time)
**Output:** `frontend/release/Sample-Extractor-1.0.0.AppImage` (~1.2GB)

### **Incremental Build** (after code changes)

```bash
# Just rebuild frontend and repackage
npm run build
npm run build:electron
```

**Time:** 2-5 minutes

---

## 📊 **Final Package Sizes**

| Platform | Size | Compressed |
|----------|------|------------|
| **Linux AppImage** | ~1.2GB | ~600MB (zipped) |
| **Windows Installer** | ~1.4GB | ~700MB |
| **macOS DMG** | ~1.0GB | ~550MB |

---

## ✅ **What Works**

- ✅ **Drag app file, double-click, run**
- ✅ **All backend features** (Node.js + Python)
- ✅ **Audio analysis** (TensorFlow + Python libraries)
- ✅ **YouTube import** (with credentials)
- ✅ **Database** (SQLite stored in user data)
- ✅ **No dependencies** required by user

---

## ⚠️ **Challenges & Solutions**

### **Challenge 1: TensorFlow native bindings**

**Solution:** Rebuild for Electron with `@electron/rebuild`

### **Challenge 2: Python libraries need system libs**

**Solution:** Use python-build-standalone (includes all C libraries)

### **Challenge 3: Large download**

**Solutions:**
- Compress releases (~50% size reduction)
- Offer "lite" version without Python
- Delta updates (update just changed parts)

### **Challenge 4: Platform-specific builds**

**Solution:** Build on each platform or use CI/CD:
- Linux: Build on Ubuntu
- Windows: Build on Windows or use wine
- macOS: Build on macOS (requires Mac)

---

## 🎯 **Distribution**

### **GitHub Releases**

```bash
# Tag version
git tag v1.0.0
git push origin v1.0.0

# Build releases
./build-standalone.sh

# Upload to GitHub Releases
gh release create v1.0.0 \
  release/Sample-Extractor-1.0.0.AppImage \
  release/Sample-Extractor-1.0.0.exe \
  --title "v1.0.0" \
  --notes "Full standalone release"
```

### **Auto-Updates**

Add to `package.json`:
```json
{
  "build": {
    "publish": {
      "provider": "github",
      "owner": "your-username",
      "repo": "sample-extractor"
    }
  }
}
```

---

## 🔥 **Ready to Build It?**

This is **ambitious but doable**. The result: **true standalone desktop app**.

Say the word and I'll help you implement it step-by-step! 🚀
