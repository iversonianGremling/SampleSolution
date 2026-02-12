# Embedding Backend in Electron - Realistic Guide

## 🚨 **The Challenge**

Your backend has **complex dependencies** that make full embedding difficult:

```
Backend Dependencies:
├── Node.js runtime
├── @tensorflow/tfjs-node (native bindings)
├── better-sqlite3 (native module)
├── Python scripts (audio analysis)
├── Python dependencies (numpy, librosa, etc.)
└── 100+ npm packages
```

**Size estimate:** ~500MB-1GB per platform (with all dependencies)

---

## 🎯 **Realistic Options**

### **Option B1: Partial Embedding (Recommended)**

Bundle Node.js backend, but **require Python** to be installed by user.

**Pros:**
- Smaller package size
- Easier to build
- Node.js parts work cross-platform

**Cons:**
- User must install Python + dependencies
- Not truly "one-click" install

**Best for:** Power users, developers

---

### **Option B2: Full Embedding (Advanced)**

Bundle everything including Python runtime.

**Pros:**
- ✅ True standalone app
- ✅ One-click install for users

**Cons:**
- ❌ Very large download (1GB+)
- ❌ Complex build process
- ❌ Platform-specific builds required
- ❌ Native module rebuilding needed

**Best for:** Production distribution to end users

---

### **Option B3: Hybrid (Practical)**

Embed backend, but **optional advanced features** require Python.

**Pros:**
- Core features work out of the box
- Advanced analysis optional
- Reasonable package size

**Cons:**
- Some features disabled without Python
- Need feature detection

**Best for:** Most users

---

## 📦 **Implementation: Option B1 (Partial Embedding)**

This bundles the Node.js backend but lets users install Python separately for advanced features.

### **1. Prepare Backend for Bundling**

Create `backend/package-electron.json`:

```json
{
  "name": "sample-extractor-backend-embedded",
  "version": "1.0.0",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "start": "node dist/index.js"
  },
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

### **2. Build Script**

Create `frontend/scripts/prepare-backend.sh`:

```bash
#!/bin/bash
set -e

echo "📦 Preparing backend for Electron embedding..."

# Build backend
cd ../backend
echo "Building backend TypeScript..."
npm run build

# Create embedded package directory
EMBED_DIR="../frontend/embedded-backend"
rm -rf "$EMBED_DIR"
mkdir -p "$EMBED_DIR"

# Copy built files
echo "Copying backend files..."
cp -r dist "$EMBED_DIR/"
cp -r src/python "$EMBED_DIR/dist/"  # Python scripts
cp package-electron.json "$EMBED_DIR/package.json"

# Copy environment template
echo "PORT=4000" > "$EMBED_DIR/.env"

# Install production dependencies
cd "$EMBED_DIR"
echo "Installing production dependencies..."
npm install --production --ignore-scripts

# Rebuild native modules for Electron
cd ../../frontend
echo "Rebuilding native modules for Electron..."
npx electron-rebuild -f -w better-sqlite3 -m ../frontend/embedded-backend

echo "✅ Backend prepared in: frontend/embedded-backend"
echo "⚠️  Note: Python scripts require Python to be installed on user's system"
```

### **3. Update Electron Main Process**

Update `frontend/electron/main.js`:

```javascript
const { app, BrowserWindow, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

let backendProcess = null;
let mainWindow;

// Check if Python is available
function checkPython() {
  return new Promise((resolve) => {
    const python = spawn('python3', ['--version']);
    python.on('error', () => resolve(false));
    python.on('close', (code) => resolve(code === 0));
  });
}

async function startBackend() {
  const isDev = process.env.NODE_ENV !== 'production';

  if (isDev) {
    console.log('Dev mode: Expecting backend at http://localhost:4000');
    return { success: true, mode: 'dev' };
  }

  // In production, start embedded backend
  const backendPath = app.isPackaged
    ? path.join(process.resourcesPath, 'embedded-backend')
    : path.join(__dirname, '..', 'embedded-backend');

  // Check if backend exists
  if (!fs.existsSync(backendPath)) {
    return {
      success: false,
      error: 'Backend not found. Please rebuild the app with embedded backend.'
    };
  }

  // Check Python availability
  const pythonAvailable = await checkPython();
  if (!pythonAvailable) {
    console.warn('⚠️  Python not found - advanced audio analysis will be disabled');
  }

  // Start Node.js backend
  console.log('Starting embedded backend from:', backendPath);

  // Set backend working directory to user data
  const userDataPath = app.getPath('userData');
  const backendDataPath = path.join(userDataPath, 'backend-data');
  fs.mkdirSync(backendDataPath, { recursive: true });

  backendProcess = spawn('node', ['dist/index.js'], {
    cwd: backendPath,
    env: {
      ...process.env,
      PORT: '4000',
      DATA_PATH: backendDataPath,
      PYTHON_AVAILABLE: pythonAvailable ? 'true' : 'false'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  backendProcess.stdout.on('data', (data) => {
    console.log(`[Backend] ${data}`);
  });

  backendProcess.stderr.on('data', (data) => {
    console.error(`[Backend Error] ${data}`);
  });

  backendProcess.on('error', (err) => {
    console.error('Failed to start backend:', err);
  });

  backendProcess.on('exit', (code) => {
    console.log(`Backend exited with code ${code}`);
  });

  // Wait for backend to be ready
  await new Promise(resolve => setTimeout(resolve, 3000));

  return {
    success: true,
    mode: 'embedded',
    pythonAvailable
  };
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false, // Don't show until backend is ready
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
}

app.whenReady().then(async () => {
  const backendResult = await startBackend();

  if (!backendResult.success) {
    await dialog.showErrorBox(
      'Backend Error',
      backendResult.error || 'Failed to start backend server'
    );
    app.quit();
    return;
  }

  if (backendResult.mode === 'embedded' && !backendResult.pythonAvailable) {
    // Show optional warning about Python
    // (Don't block, just inform)
    setTimeout(() => {
      dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Python Not Found',
        message: 'Advanced audio analysis features require Python 3',
        detail: 'Install Python 3 to enable all features. Basic functionality will work without it.',
        buttons: ['OK']
      });
    }, 2000);
  }

  await createWindow();
});

app.on('quit', () => {
  if (backendProcess) {
    backendProcess.kill();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
```

### **4. Update electron-builder Config**

Update `frontend/package.json` → `build` section:

```json
{
  "build": {
    "files": [
      "dist/**/*",
      "electron/**/*",
      "embedded-backend/**/*"
    ],
    "extraResources": [
      {
        "from": "embedded-backend",
        "to": "embedded-backend",
        "filter": ["**/*"]
      }
    ],
    "linux": {
      "target": ["AppImage", "deb"],
      "category": "Audio"
    },
    "win": {
      "target": ["nsis", "portable"]
    },
    "asarUnpack": [
      "embedded-backend/**/*"
    ]
  }
}
```

### **5. Build Process**

```bash
# 1. Prepare backend
cd frontend
chmod +x scripts/prepare-backend.sh
./scripts/prepare-backend.sh

# 2. Build Electron app
npm run build:electron
```

---

## 📊 **Package Sizes**

| Option | Linux | Windows | macOS |
|--------|-------|---------|-------|
| **B1 (Partial)** | ~200MB | ~250MB | ~280MB |
| **B2 (Full)** | ~800MB | ~1.2GB | ~900MB |
| **A (Separate)** | ~50MB | ~70MB | ~80MB |

---

## ⚠️ **Limitations of Option B1**

### **What Works Out of the Box:**
✅ Basic audio playback
✅ Slice management
✅ YouTube import
✅ Collections
✅ Tags

### **What Requires Python:**
⚠️ Advanced audio analysis
⚠️ BPM detection
⚠️ Key detection
⚠️ Feature extraction

### **User Instructions:**

If user wants advanced features:
```bash
# Ubuntu/Debian
sudo apt install python3 python3-pip
pip3 install numpy librosa scipy

# macOS
brew install python3
pip3 install numpy librosa scipy

# Windows
# Download Python from python.org
pip install numpy librosa scipy
```

---

## 🎯 **Recommendation**

**For your use case, I recommend:**

### **Keep it Simple: Option A (Separate Backend)**

**Why?**
1. Your backend is **complex** (TensorFlow, Python, native modules)
2. You're still developing/iterating
3. Docker already works for deployment
4. Most users can run `docker compose up`

**When to use embedded (Option B):**
- Distributing to non-technical end users
- Need true "portable" app
- Ready to invest time in packaging complexity

---

## 🚀 **Practical Approach**

**Current (Development):**
```bash
Terminal 1: docker compose up
Terminal 2: npm run dev:electron
```

**Future (Distribution):**
- Provide Docker Compose setup for users
- Or invest in full embedding (Option B2) later
- Document Python requirements clearly

---

**Want me to implement Option B1?** It's doable but adds complexity. Let me know!
