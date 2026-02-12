# Electron Setup Guide

This project supports both **web browser** and **Electron desktop** modes with a single codebase.

## 🚀 Quick Start

### Install Dependencies

```bash
cd frontend
npm install
```

### Development

**Web Mode (default):**
```bash
npm run dev
```
Opens at `http://localhost:3000`

**Electron Mode:**
```bash
npm run dev:electron
```
Launches Electron app with hot reload

### Production Build

**Web Build:**
```bash
npm run build
```

**Electron Build:**
```bash
npm run build:electron
```

This creates distributable packages in `frontend/release/`:
- **Linux**: `.AppImage` and `.deb` packages
- **Windows**: `.exe` installer and portable version
- **macOS**: `.dmg` and `.zip`

## 🎨 Features

### Debug Panel

A floating debug panel is available to inspect:
- Platform information (Web vs Electron)
- WebGL status and capabilities
- GPU acceleration status
- Renderer information

**To use:** The debug panel will appear in the top-right corner. Click to expand/collapse.

### Platform Detection

Use the utilities in `src/utils/platform.ts`:

```typescript
import { isElectron, getPlatform, isLinux, isWindows, isMac } from './utils/platform';

if (isElectron()) {
  // Electron-specific code
  console.log('Running in Electron on', getPlatform());
} else {
  // Web browser code
  console.log('Running in web browser');
}
```

### WebGL Detection

Use the utilities in `src/utils/webgl-check.ts`:

```typescript
import { checkWebGLStatus, logWebGLInfo } from './utils/webgl-check';

const status = checkWebGLStatus();

if (!status.isHardwareAccelerated) {
  console.warn('GPU acceleration is disabled!');
}

// Log detailed info to console
logWebGLInfo();
```

## 🖥️ Electron-Specific Features

### File Drag & Drop

```typescript
import { isElectron } from './utils/platform';

function AudioDropZone() {
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();

    const files = Array.from(e.dataTransfer.files);

    if (isElectron()) {
      // Direct file system access
      console.log('File paths:', files.map(f => f.path));
    } else {
      // Web File API
      console.log('Files:', files);
    }
  };

  return (
    <div onDrop={handleDrop} onDragOver={(e) => e.preventDefault()}>
      Drop files here
    </div>
  );
}
```

### Accessing Electron APIs

The main process exposes safe APIs via the preload script:

```typescript
// Check if running in Electron
if (window.electron?.isElectron) {
  // Get GPU info
  const gpuInfo = await window.electron.getGPUInfo();
  console.log(gpuInfo);
}
```

### Adding New Electron APIs

1. **Add IPC handler in `electron/main.js`:**

```javascript
ipcMain.handle('show-save-dialog', async () => {
  const { dialog } = require('electron');
  return await dialog.showSaveDialog({ /* options */ });
});
```

2. **Expose in `electron/preload.js`:**

```javascript
contextBridge.exposeInMainWorld('electron', {
  // ... existing APIs
  showSaveDialog: () => ipcRenderer.invoke('show-save-dialog'),
});
```

3. **Use in React:**

```typescript
const result = await window.electron?.showSaveDialog();
```

## 🐧 Linux GPU Support

### Check GPU Status

When running in Electron, open DevTools and check the console for GPU info.

### Common Issues

**Software Renderer (SwiftShader):**
- Missing GPU drivers
- GPU acceleration disabled

**Fix:**
```bash
# Install Mesa drivers
sudo apt install libgl1-mesa-dri libgl1-mesa-glx

# Check GPU
glxinfo | grep "OpenGL renderer"
```

**Force GPU in Electron:**
The app automatically enables GPU features. If issues persist, check `electron/main.js` flags.

## 📦 Build Artifacts

After `npm run build:electron`:

```
frontend/release/
  ├── sample-extractor-1.0.0.AppImage  # Linux portable
  ├── sample-extractor_1.0.0_amd64.deb # Debian/Ubuntu
  ├── Sample Extractor Setup 1.0.0.exe # Windows installer
  └── Sample Extractor 1.0.0.dmg       # macOS
```

## 🔧 Configuration

### Electron Builder

Edit `package.json` → `"build"` section:

```json
{
  "build": {
    "appId": "com.sample-extractor.app",
    "productName": "Sample Extractor",
    "linux": {
      "target": ["AppImage", "deb"],
      "category": "Audio"
    }
  }
}
```

### Window Settings

Edit `electron/main.js`:

```javascript
const mainWindow = new BrowserWindow({
  width: 1400,
  height: 900,
  // Add your customizations
});
```

## 🧪 Testing

The same tests work for both web and Electron:

```bash
npm run test
npm run test:watch
```

## 🌐 API Proxy

The backend API proxy works in both modes:
- **Web**: Vite dev server proxies `/api` → `http://localhost:4000`
- **Electron dev**: Same proxy through Vite
- **Electron production**: Configure backend URL in your settings

## 📝 Notes

- The same codebase works for web and desktop
- Use platform detection to enable desktop-only features
- Hot reload works in both modes
- WebGL/Canvas/Audio APIs work identically
- All npm packages (React, PixiJS, WaveSurfer, etc.) work in both modes

## 🚨 Troubleshooting

**Electron doesn't start:**
```bash
# Clear cache
rm -rf node_modules/.vite
npm run dev:electron
```

**WebGL not working:**
- Check Debug Panel (top-right)
- Look for "Software Renderer" warning
- Verify GPU drivers are installed

**Build fails:**
```bash
# Clean and rebuild
rm -rf dist release
npm run build:electron
```

## 📚 Resources

- [Electron Docs](https://www.electronjs.org/docs/latest/)
- [Electron Builder](https://www.electron.build/)
- [Vite + Electron](https://vitejs.dev/guide/build.html)
