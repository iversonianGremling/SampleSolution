const { app, BrowserWindow, ipcMain, dialog, session } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

let mainWindow;
let backendProcess = null;

// Enable GPU acceleration optimizations
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
// Disable GPU shader disk cache (known to cause WebGL failures on Linux after driver updates)
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

// Linux-specific GPU optimizations
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder');
}

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

// Get Python executable path
function getPythonPath() {
  const pythonDir = getResourcePath('embedded-python');

  if (!fs.existsSync(pythonDir)) {
    return null;
  }

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

// Test if backend server is responding
function testBackendConnection(maxAttempts = 10, delayMs = 1000) {
  return new Promise((resolve) => {
    let attempts = 0;

    const tryConnect = () => {
      attempts++;

      const req = http.get('http://localhost:4000/api/auth/status', (res) => {
        console.log(`✓ Backend responding (attempt ${attempts})`);
        resolve(true);
      });

      req.on('error', (err) => {
        if (attempts >= maxAttempts) {
          console.error(`✗ Backend not responding after ${attempts} attempts`);
          resolve(false);
        } else {
          console.log(`Waiting for backend... (attempt ${attempts}/${maxAttempts})`);
          setTimeout(tryConnect, delayMs);
        }
      });

      req.setTimeout(2000, () => {
        req.destroy();
      });
    };

    tryConnect();
  });
}

// Start embedded backend
async function startBackend() {
  const isDev = process.env.NODE_ENV !== 'production';

  if (isDev) {
    console.log('🔧 Dev mode: Expecting backend at http://localhost:4000');
    const isRunning = await testBackendConnection(3, 1000);

    if (!isRunning) {
      console.warn('⚠️  Backend not detected. Please start it manually:');
      console.warn('   cd backend && npm start');
      return { success: false, mode: 'dev', error: 'Backend not running' };
    }

    return { success: true, mode: 'dev' };
  }

  // Production mode - start embedded backend
  console.log('🚀 Starting embedded backend...');

  const backendPath = getResourcePath('embedded-backend');
  const pythonPath = getPythonPath();

  // Verify backend exists
  if (!fs.existsSync(backendPath)) {
    return {
      success: false,
      error: 'Embedded backend not found. App may be corrupted.\n\nPath: ' + backendPath
    };
  }

  // Check if backend entry point exists
  const backendEntry = path.join(backendPath, 'dist', 'index.js');
  if (!fs.existsSync(backendEntry)) {
    return {
      success: false,
      error: 'Backend entry point not found:\n' + backendEntry
    };
  }

  // Set up backend data directories in user's data folder
  const userDataPath = app.getPath('userData');
  const backendDataPath = path.join(userDataPath, 'backend-data');
  const uploadsPath = path.join(userDataPath, 'uploads');

  fs.mkdirSync(backendDataPath, { recursive: true });
  fs.mkdirSync(uploadsPath, { recursive: true });

  console.log('Backend path:', backendPath);
  console.log('Data path:', backendDataPath);
  console.log('Python path:', pythonPath || 'not found');

  // Environment variables for backend
  const backendEnv = {
    ...process.env,
    PORT: '4000',
    NODE_ENV: 'production',
    DATA_PATH: backendDataPath,
    UPLOAD_PATH: uploadsPath,
    PYTHON_PATH: pythonPath || 'python3',
    PYTHON_AVAILABLE: pythonPath ? 'true' : 'false',
    // Disable GPU for TensorFlow (CPU only)
    CUDA_VISIBLE_DEVICES: '-1'
  };

  // Start Node.js backend as child process
  console.log('Starting backend process...');

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
    backendProcess = null;

    // Show error dialog if backend crashes while app is running
    if (mainWindow && !mainWindow.isDestroyed() && !app.isQuitting) {
      dialog.showErrorBox(
        'Backend Stopped',
        'The backend server has stopped unexpectedly. Please restart the application.'
      );
      app.quit();
    }
  });

  // Wait for backend to start and respond
  console.log('⏳ Waiting for backend to start...');
  const isReady = await testBackendConnection(15, 1000);

  if (!isReady) {
    return {
      success: false,
      error: 'Backend started but is not responding.\n\nCheck logs for errors.'
    };
  }

  console.log('✅ Backend ready');

  return {
    success: true,
    mode: 'embedded',
    pythonAvailable: !!pythonPath,
    backendPath,
    dataPath: backendDataPath
  };
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    show: false, // Don't show until backend is ready
    backgroundColor: '#1a1a1a',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webgl: true, // Explicitly enable WebGL
      preload: path.join(__dirname, 'preload.cjs')
    },
    icon: path.join(__dirname, '../public/icon.png')
  });

  const isDev = process.env.NODE_ENV !== 'production';

  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Log GPU info when page loads
  mainWindow.webContents.on('did-finish-load', () => {
    console.log('=== Electron GPU Info ===');
    console.log('Platform:', process.platform);
    console.log('Arch:', process.arch);

    // Get GPU feature status (synchronous in Electron 28+)
    const status = app.getGPUFeatureStatus();
    console.log('GPU Features:', status);
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Handle window close
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC handlers for debug info
ipcMain.handle('get-gpu-info', async () => {
  return {
    featureStatus: app.getGPUFeatureStatus(),
    platform: process.platform,
    arch: process.arch,
    versions: process.versions
  };
});

ipcMain.handle('select-directory', async (_event, options = {}) => {
  const result = await dialog.showOpenDialog(mainWindow || undefined, {
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: options.defaultPath || undefined,
    title: options.title || 'Select folder',
  });

  if (result.canceled || !result.filePaths?.length) {
    return null;
  }

  return result.filePaths[0];
});

// App lifecycle
app.whenReady().then(async () => {
  console.log('=== Sample Extractor Starting ===');
  console.log('Chrome:', process.versions.chrome);
  console.log('Node:', process.versions.node);
  console.log('Electron:', process.versions.electron);
  console.log('');

  // Set Content Security Policy to allow WebGL, fonts, images, and backend connections
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; " +
          "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' blob:; " +
          "worker-src 'self' blob:; " +
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
          "font-src 'self' data: https://fonts.gstatic.com; " +
          "img-src 'self' data: blob: https://i.ytimg.com; " +
          "connect-src 'self' http://localhost:4000 ws://localhost:4000; " +
          "media-src 'self' blob: http://localhost:4000;"
        ]
      }
    });
  });

  // Start backend
  const backendResult = await startBackend();

  if (!backendResult.success) {
    // Show error dialog
    await dialog.showErrorBox(
      'Backend Error',
      backendResult.error || 'Failed to start backend server.'
    );
    app.quit();
    return;
  }

  console.log('Backend mode:', backendResult.mode);

  if (backendResult.mode === 'embedded') {
    console.log('Data directory:', backendResult.dataPath);
    console.log('Python available:', backendResult.pythonAvailable);

    if (!backendResult.pythonAvailable) {
      // Show warning about Python (non-blocking)
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          dialog.showMessageBox(mainWindow, {
            type: 'warning',
            title: 'Python Not Available',
            message: 'Advanced audio analysis features are unavailable',
            detail: 'The embedded Python runtime could not be initialized. Basic features will work, but advanced audio analysis (BPM, key detection, etc.) will be disabled.',
            buttons: ['OK']
          });
        }
      }, 3000);
    }
  }

  // Create window
  await createWindow();
});

app.on('will-quit', (event) => {
  if (backendProcess && !backendProcess.killed) {
    console.log('App is quitting, stopping backend...');
    app.isQuitting = true;

    backendProcess.kill('SIGTERM');

    // Force kill after 3 seconds
    setTimeout(() => {
      if (backendProcess && !backendProcess.killed) {
        console.log('Force killing backend...');
        backendProcess.kill('SIGKILL');
      }
    }, 3000);
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

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}
