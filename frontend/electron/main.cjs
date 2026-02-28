const { app, BrowserWindow, ipcMain, dialog, session } = require('electron');
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const runtimeConfig = require('./runtime-config.json');

let mainWindow;
let backendProcess = null;

// ── Persistent log file ──
// Writes all main-process console output to a rotating log file in userData
// so users can inspect it after a crash.  The file is located at:
//   Windows:  %APPDATA%/<app-name>/main.log
//   macOS:    ~/Library/Application Support/<app-name>/main.log
//   Linux:    ~/.config/<app-name>/main.log
let _logStream = null;

function getLogStream() {
  if (_logStream) return _logStream;
  try {
    const logDir = app.getPath('userData');
    fs.mkdirSync(logDir, { recursive: true });
    const logPath = path.join(logDir, 'main.log');

    // Rotate: if the log exceeds 5 MB, move it to main.log.old
    try {
      const stats = fs.statSync(logPath);
      if (stats.size > 5 * 1024 * 1024) {
        fs.renameSync(logPath, logPath + '.old');
      }
    } catch {}

    _logStream = fs.createWriteStream(logPath, { flags: 'a' });
    _logStream.write(`\n--- App started ${new Date().toISOString()} ---\n`);
  } catch {}
  return _logStream;
}

// Patch console.log / console.error to also write to the log file
const _origLog = console.log;
const _origErr = console.error;

console.log = (...args) => {
  _origLog(...args);
  const s = getLogStream();
  if (s) s.write(`[${new Date().toISOString()}] ${args.map(String).join(' ')}\n`);
};

console.error = (...args) => {
  _origErr(...args);
  const s = getLogStream();
  if (s) s.write(`[${new Date().toISOString()}] [ERROR] ${args.map(String).join(' ')}\n`);
};

// ── Cross-platform process kill helpers ──
function forceKillChild(proc) {
  if (!proc || proc.killed || proc.pid == null) return;
  if (process.platform === 'win32') {
    try { execSync(`taskkill /pid ${proc.pid} /T /F`, { stdio: 'ignore' }); } catch {}
  } else {
    try { proc.kill('SIGKILL'); } catch {}
  }
}

function gracefulKillChild(proc, forceAfterMs = 3000) {
  if (!proc || proc.killed || proc.pid == null) return;
  if (process.platform === 'win32') {
    forceKillChild(proc);
  } else {
    proc.kill('SIGTERM');
    setTimeout(() => forceKillChild(proc), forceAfterMs);
  }
}
const DEFAULT_DEV_FRONTEND_PORT = runtimeConfig.ports.devFrontend;
const DEFAULT_DEV_BACKEND_PORT = runtimeConfig.ports.devBackend;
const DEFAULT_PROD_BACKEND_PORT = runtimeConfig.ports.prodBackend;

function getRendererSettingsPath() {
  return path.join(app.getPath('userData'), 'renderer-settings.json');
}

function readRendererSettings() {
  const settingsPath = getRendererSettingsPath();
  try {
    if (!fs.existsSync(settingsPath)) return {};
    const raw = fs.readFileSync(settingsPath, 'utf8');
    if (!raw.trim()) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return parsed;
  } catch (error) {
    console.warn('Failed to read renderer settings:', error);
    return {};
  }
}

function writeRendererSettings(settings) {
  const settingsPath = getRendererSettingsPath();
  try {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.warn('Failed to write renderer settings:', error);
    return false;
  }
}

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

function isDevelopmentRuntime() {
  // Packaged apps should always use embedded resources even if NODE_ENV is unset.
  return !app.isPackaged && process.env.NODE_ENV !== 'production';
}

function parsePortValue(rawValue, fallbackPort) {
  if (typeof rawValue === 'number' && Number.isInteger(rawValue)) {
    return rawValue >= 1 && rawValue <= 65535 ? rawValue : fallbackPort;
  }

  if (typeof rawValue !== 'string') return fallbackPort;
  const trimmed = rawValue.trim();
  if (!trimmed) return fallbackPort;

  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return fallbackPort;
  }

  return parsed;
}

function getDevFrontendPort() {
  return parsePortValue(process.env.ELECTRON_DEV_FRONTEND_PORT, DEFAULT_DEV_FRONTEND_PORT);
}

function getBackendPort() {
  if (isDevelopmentRuntime()) {
    return parsePortValue(
      process.env.ELECTRON_DEV_BACKEND_PORT || process.env.PORT,
      DEFAULT_DEV_BACKEND_PORT
    );
  }

  return parsePortValue(
    process.env.ELECTRON_PROD_BACKEND_PORT || process.env.PORT,
    DEFAULT_PROD_BACKEND_PORT
  );
}

function getBackendOrigin() {
  const host = isDevelopmentRuntime() ? 'localhost' : '127.0.0.1';
  return `http://${host}:${getBackendPort()}`;
}

function getBackendWsOrigin() {
  return getBackendOrigin().replace('http://', 'ws://');
}

function getDevFrontendOrigin() {
  return `http://localhost:${getDevFrontendPort()}`;
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
function testBackendConnection(backendOrigin, maxAttempts = 10, delayMs = 1000) {
  return new Promise((resolve) => {
    let attempts = 0;
    const statusUrl = `${backendOrigin}/api/auth/status`;

    const tryConnect = () => {
      attempts++;

      const req = http.get(statusUrl, (res) => {
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

function attachBackendProcessHandlers(label = 'Backend') {
  if (!backendProcess) return;

  backendProcess.stdout.on('data', (data) => {
    console.log(`[${label}] ${data.toString().trim()}`);
  });

  backendProcess.stderr.on('data', (data) => {
    console.error(`[${label} Error] ${data.toString().trim()}`);
  });

  backendProcess.on('error', (err) => {
    console.error(`❌ Failed to start ${label.toLowerCase()}:`, err);
  });

  backendProcess.on('exit', (code, signal) => {
    console.log(`${label} exited with code ${code}, signal ${signal}`);
    backendProcess = null;

    // Show error dialog if backend crashes while app is running
    if (mainWindow && !mainWindow.isDestroyed() && !app.isQuitting) {
      const logPath = path.join(app.getPath('userData'), 'main.log');
      dialog.showErrorBox(
        'Backend Stopped',
        `The backend server has stopped unexpectedly (code ${code}, signal ${signal}).\n\nLogs: ${logPath}\n\nPlease restart the application.`
      );
      app.quit();
    }
  });
}

async function startWorkspaceBackendDev(backendPort, backendOrigin, frontendOrigin) {
  const backendPath = path.join(__dirname, '..', '..', 'backend');
  const backendPackageJson = path.join(backendPath, 'package.json');

  if (!fs.existsSync(backendPackageJson)) {
    return {
      success: false,
      mode: 'dev',
      error: `Backend project not found.\n\nExpected: ${backendPackageJson}`
    };
  }

  const userDataPath = app.getPath('userData');
  const backendDataPath = path.join(userDataPath, 'backend-data-dev');
  fs.mkdirSync(backendDataPath, { recursive: true });

  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

  // In dev fallback mode, run backend from workspace and keep data in Electron userData.
  const backendEnv = {
    ...process.env,
    PORT: String(backendPort),
    DATA_DIR: backendDataPath,
    FRONTEND_URL: frontendOrigin,
    BACKEND_URL: backendOrigin,
    LOCAL_IMPORT_MODE: 'reference',
    CORS_EXTRA_ORIGINS: frontendOrigin,
    CORS_ALLOW_NO_ORIGIN: 'true',
  };

  console.log('Starting workspace backend process on', backendOrigin);
  backendProcess = spawn(npmCommand, ['run', 'dev'], {
    cwd: backendPath,
    env: backendEnv,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  attachBackendProcessHandlers('Backend Dev');

  console.log('⏳ Waiting for workspace backend to start...');
  const isReady = await testBackendConnection(backendOrigin, 30, 1000);

  if (!isReady) {
    return {
      success: false,
      mode: 'dev',
      error: 'Could not start workspace backend in development mode.\n\nRun `cd backend && npm run dev` to inspect logs.'
    };
  }

  return {
    success: true,
    mode: 'dev-embedded',
    backendPort,
    backendOrigin,
    backendPath,
    dataPath: backendDataPath
  };
}

// Start backend (external in dev if available, embedded in production)
async function startBackend() {
  const isDev = isDevelopmentRuntime();
  const backendPort = getBackendPort();
  const backendOrigin = getBackendOrigin();
  const frontendOrigin = isDev ? getDevFrontendOrigin() : backendOrigin;

  if (isDev) {
    console.log(`🔧 Dev mode: Checking backend at ${backendOrigin}`);
    const isRunning = await testBackendConnection(backendOrigin, 3, 1000);

    if (isRunning) {
      return { success: true, mode: 'dev-external', backendPort, backendOrigin };
    }

    console.warn(`⚠️  Backend not detected on ${backendOrigin}. Starting workspace backend...`);
    return startWorkspaceBackendDev(backendPort, backendOrigin, frontendOrigin);
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
  fs.mkdirSync(backendDataPath, { recursive: true });

  console.log('Backend path:', backendPath);
  console.log('Data path:', backendDataPath);
  console.log('Python path:', pythonPath || 'not found');

  // Environment variables for backend
  const backendEnv = {
    ...process.env,
    PORT: String(backendPort),
    NODE_ENV: 'production',
    DATA_DIR: backendDataPath,
    LOCAL_IMPORT_MODE: 'reference',
    PYTHON_PATH: pythonPath || 'python3',
    PYTHON_AVAILABLE: pythonPath ? 'true' : 'false',
    FRONTEND_URL: frontendOrigin,
    BACKEND_URL: backendOrigin,
    CORS_EXTRA_ORIGINS: frontendOrigin,
    CORS_ALLOW_NULL_ORIGIN: 'true',
    CORS_ALLOW_NO_ORIGIN: 'true',
    // Disable GPU for TensorFlow (CPU only)
    CUDA_VISIBLE_DEVICES: '-1'
  };

  const backendArgs = ['dist/index.js'];
  let backendCommand = 'node';

  if (app.isPackaged) {
    // Use the bundled Electron runtime as Node so portable builds don't require a system Node install.
    backendCommand = process.execPath;
    backendEnv.ELECTRON_RUN_AS_NODE = '1';
  }

  // Start Node.js backend as child process
  console.log('Starting backend process...');
  console.log('Backend command:', backendCommand);

  backendProcess = spawn(backendCommand, backendArgs, {
    cwd: backendPath,
    env: backendEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  attachBackendProcessHandlers('Backend');

  // Wait for backend to start and respond
  console.log('⏳ Waiting for backend to start...');
  const isReady = await testBackendConnection(backendOrigin, 15, 1000);

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
    backendPort,
    backendOrigin,
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

  const isDev = isDevelopmentRuntime();

  if (isDev) {
    mainWindow.loadURL(getDevFrontendOrigin());
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

ipcMain.handle('select-import-path', async (_event, options = {}) => {
  const result = await dialog.showOpenDialog(mainWindow || undefined, {
    properties: ['openFile', 'openDirectory'],
    defaultPath: options.defaultPath || undefined,
    title: options.title || 'Select backup folder or ZIP file',
    filters: [
      { name: 'Backup ZIP', extensions: ['zip'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (result.canceled || !result.filePaths?.length) {
    return null;
  }

  return result.filePaths[0];
});

ipcMain.handle('renderer-settings-get', async (_event, key) => {
  if (typeof key !== 'string' || !key.trim()) {
    return null;
  }
  const settings = readRendererSettings();
  const value = settings[key];
  return typeof value === 'string' ? value : null;
});

ipcMain.handle('renderer-settings-set', async (_event, key, value) => {
  if (typeof key !== 'string' || !key.trim() || typeof value !== 'string') {
    return false;
  }
  const settings = readRendererSettings();
  settings[key] = value;
  return writeRendererSettings(settings);
});

ipcMain.handle('renderer-settings-remove', async (_event, key) => {
  if (typeof key !== 'string' || !key.trim()) {
    return false;
  }
  const settings = readRendererSettings();
  if (Object.prototype.hasOwnProperty.call(settings, key)) {
    delete settings[key];
    return writeRendererSettings(settings);
  }
  return true;
});

// App lifecycle
app.whenReady().then(async () => {
  console.log('=== Sample Extractor Starting ===');
  console.log('Chrome:', process.versions.chrome);
  console.log('Node:', process.versions.node);
  console.log('Electron:', process.versions.electron);
  console.log('');

  // Set Content Security Policy to allow WebGL, fonts, images, and backend connections.
  // In development, Vite injects an inline React preamble script that requires 'unsafe-inline'.
  const isDevMode = isDevelopmentRuntime();
  const backendOrigin = getBackendOrigin();
  const backendWsOrigin = getBackendWsOrigin();
  const scriptSrc = isDevMode
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:; "
    : "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' blob:; ";

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; " +
          scriptSrc +
          "worker-src 'self' blob:; " +
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net; " +
          "font-src 'self' data: https://fonts.gstatic.com https://cdn.jsdelivr.net; " +
          "img-src 'self' data: blob: https://i.ytimg.com; " +
          `connect-src 'self' ${backendOrigin} ${backendWsOrigin}; ` +
          `media-src 'self' blob: ${backendOrigin};`
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
    gracefulKillChild(backendProcess);
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
