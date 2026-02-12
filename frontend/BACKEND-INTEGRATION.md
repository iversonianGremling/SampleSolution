# Backend Integration Guide

## 🔄 How It Works

Your app has a **separate backend** running on port 4000. Here's how it integrates in different modes:

### Development Mode

| Mode | Frontend | Backend | How It Connects |
|------|----------|---------|----------------|
| **Web** | Vite dev server (:3000) | localhost:4000 | Vite proxy: `/api` → `http://localhost:4000` |
| **Electron** | Loads `http://localhost:3000` | localhost:4000 | Same Vite proxy |

✅ **No changes needed** - works automatically!

### Production Mode

| Mode | Frontend | Backend | Configuration |
|------|----------|---------|---------------|
| **Web** | Nginx/Apache | Same server or remote | Nginx proxy or CORS |
| **Electron** | Bundled app | **See options below** | Dynamic base URL |

---

## 📦 Electron Production Options

### **Option A: Separate Backend (Recommended for Development)**

Run backend separately, Electron connects to it.

**Pros:**
- Simple to develop
- Backend can be shared across multiple Electron instances
- Easy debugging

**Cons:**
- User must start backend separately
- Not truly "portable"

**Setup:**

1. **Start backend:**
   ```bash
   cd backend
   npm start  # or python main.py
   ```

2. **Build Electron:**
   ```bash
   cd frontend
   npm run build:electron
   ```

3. **Electron connects to `http://localhost:4000/api`** automatically

4. **Optional: Configure remote backend** via Settings → Backend Server

---

### **Option B: Embed Backend in Electron (True Standalone)**

Package the backend inside the Electron app.

**Pros:**
- ✅ True standalone app
- ✅ User doesn't need to do anything
- ✅ Fully portable

**Cons:**
- More complex setup
- Larger app size

**Implementation:**

#### 1. **Copy backend into Electron package**

Update `frontend/package.json`:

```json
{
  "build": {
    "files": [
      "dist/**/*",
      "electron/**/*",
      "backend/**/*",  // ← Include backend
      "package.json"
    ],
    "extraResources": [
      {
        "from": "../backend",
        "to": "backend",
        "filter": ["**/*", "!node_modules", "!venv"]
      }
    ]
  }
}
```

#### 2. **Start backend from Electron**

Update `frontend/electron/main.js`:

```javascript
const { app, BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const path = require('path');

let backendProcess = null;

function startBackend() {
  const isDev = process.env.NODE_ENV !== 'production';

  if (isDev) {
    // In dev, assume backend is running separately
    console.log('Dev mode: Expecting backend at http://localhost:4000');
    return;
  }

  // In production, start embedded backend
  const backendPath = path.join(process.resourcesPath, 'backend');

  // For Node.js backend:
  backendProcess = spawn('node', ['src/index.js'], {
    cwd: backendPath,
    env: { ...process.env, PORT: '4000' }
  });

  // Or for Python backend:
  // backendProcess = spawn('python', ['main.py'], {
  //   cwd: backendPath,
  //   env: { ...process.env, PORT: '4000' }
  // });

  backendProcess.stdout.on('data', (data) => {
    console.log(`Backend: ${data}`);
  });

  backendProcess.stderr.on('data', (data) => {
    console.error(`Backend Error: ${data}`);
  });

  // Wait for backend to start (adjust time as needed)
  return new Promise(resolve => setTimeout(resolve, 2000));
}

app.whenReady().then(async () => {
  await startBackend();
  createWindow();
});

app.on('quit', () => {
  if (backendProcess) {
    backendProcess.kill();
  }
});
```

#### 3. **Bundle backend dependencies**

**For Node.js backend:**
```bash
cd backend
npm install --production
# node_modules will be included in the Electron package
```

**For Python backend:**
- Package as executable using PyInstaller:
  ```bash
  pip install pyinstaller
  pyinstaller --onefile backend/main.py
  ```
- Include the executable in Electron resources

---

### **Option C: Use Docker Backend (Best for Complex Backends)**

Run backend in a Docker container, Electron connects to it.

**Pros:**
- Backend dependencies isolated
- Easy updates
- Works cross-platform

**Setup:**

1. **Create backend Docker image** (you already have `docker-compose.yml`)

2. **Electron starts Docker container** on launch:

```javascript
const { spawn } = require('child_process');

function startDockerBackend() {
  return spawn('docker', ['compose', 'up'], {
    cwd: path.join(__dirname, '..', 'backend')
  });
}
```

3. **Connect to `http://localhost:4000/api`**

---

## 🛠️ API Configuration (Already Implemented!)

The following files handle dynamic backend URLs:

### **[src/utils/api-config.ts](src/utils/api-config.ts)**

```typescript
import { isElectron } from './platform';

export function getApiBaseUrl(): string {
  // Dev: Use Vite proxy
  if (import.meta.env.DEV) return '/api';

  // Electron: Use configured URL or localhost
  if (isElectron()) {
    return localStorage.getItem('apiBaseUrl') || 'http://localhost:4000/api';
  }

  // Web production: Same origin
  return '/api';
}
```

### **[src/components/ApiSettings.tsx](src/components/ApiSettings.tsx)**

Settings panel for configuring backend URL in Electron.

**To use:** Add to your settings page:

```typescript
import { ApiSettings } from './components/ApiSettings';

function SourcesSettings() {
  return (
    <div>
      <ApiSettings />  {/* Shows only in Electron */}
      {/* Other settings... */}
    </div>
  );
}
```

---

## 📝 Current Setup Summary

✅ **Web dev:** Works (Vite proxy)
✅ **Electron dev:** Works (same proxy)
✅ **Web production:** Works (deploy frontend + backend)
⚠️ **Electron production:** Needs backend running separately (or embed it)

---

## 🚀 Quick Start for Electron Production

### **Simple Way (Separate Backend):**

**Terminal 1:**
```bash
cd backend
npm start  # Start backend on port 4000
```

**Terminal 2:**
```bash
cd frontend
npm run build:electron
./release/Sample\ Extractor*.AppImage  # Run the built app
```

The Electron app will connect to `http://localhost:4000/api` automatically.

### **For Users: Distribution**

**If you want to distribute your app to users who don't have the backend:**

1. **Create installer script:**
   ```bash
   # install.sh
   #!/bin/bash
   cd backend && npm install && npm start &
   ./Sample-Extractor.AppImage
   ```

2. **Or embed backend** (see Option B above)

---

## 🔧 Troubleshooting

### **"Cannot connect to backend" in Electron production**

1. Check if backend is running:
   ```bash
   curl http://localhost:4000/api/auth/status
   ```

2. Check backend logs

3. In Electron, open Settings → Backend Server → Test Connection

### **CORS errors**

If connecting to remote backend, ensure CORS is configured:

```javascript
// backend/src/index.js
app.use(cors({
  origin: 'http://localhost:3000',  // Dev
  credentials: true
}));
```

For Electron production, add:
```javascript
origin: ['http://localhost:3000', 'file://'],
```

---

## 📚 Next Steps

1. **For development:** Everything works! Just run `npm run dev:electron`

2. **For production testing:**
   - Start backend: `cd backend && npm start`
   - Build Electron: `cd frontend && npm run build:electron`
   - Run: `./frontend/release/Sample-Extractor*.AppImage`

3. **For distribution:** Decide on Option A (separate), B (embedded), or C (Docker)

4. **Add ApiSettings to your UI:** Import and use `<ApiSettings />` component in settings page

---

## 💡 Recommendation

**For now:** Use **Option A** (separate backend)
- Easiest to develop and debug
- Can embed later when ready for distribution

**For production distribution:** Use **Option B** (embedded backend)
- Best user experience
- Truly standalone app
