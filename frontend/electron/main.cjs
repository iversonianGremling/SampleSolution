const { app, BrowserWindow, ipcMain, dialog, session } = require('electron');
const { spawn, execSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const runtimeConfig = require('./runtime-config.json');

let mainWindow;
let splashWindow;
let backendProcess = null;
let _appIsQuitting = false;

// ── Structured persistent log ──
// Log file locations:
//   Windows:  %APPDATA%/<app-name>/main.log
//   macOS:    ~/Library/Application Support/<app-name>/main.log
//   Linux:    ~/.config/<app-name>/main.log
//
// Log format: [ISO-timestamp] [LEVEL] [context?] message
// Levels: INFO, WARN, ERROR, PERF
//
// The file rotates at 5 MB (previous log saved as main.log.old).
// On app quit the stream is explicitly flushed+closed so Windows does not
// truncate the tail.
let _logStream = null;
let _logPath = null;

function getLogStream() {
  if (_logStream) return _logStream;
  try {
    const logDir = app.getPath('userData');
    fs.mkdirSync(logDir, { recursive: true });
    _logPath = path.join(logDir, 'main.log');

    // Rotate: if the log exceeds 5 MB, move it to main.log.old
    try {
      const stats = fs.statSync(_logPath);
      if (stats.size > 5 * 1024 * 1024) {
        try { fs.renameSync(_logPath, _logPath + '.old'); } catch {}
      }
    } catch {}

    _logStream = fs.createWriteStream(_logPath, { flags: 'a' });
    _logStream.on('error', (err) => {
      _origErr('[log-stream] write error:', err.message);
      _logStream = null;
    });
    _logStream.write(`\n=== App started ${new Date().toISOString()} | pid=${process.pid} | platform=${process.platform} | arch=${process.arch} ===\n`);
  } catch (e) {
    _origErr('[log-stream] failed to open:', e && e.message);
  }
  return _logStream;
}

function flushLog() {
  if (!_logStream) return;
  try { _logStream.end(); } catch {}
  _logStream = null;
}

// ── Low-level write (bypasses console patches to avoid infinite loops) ──
function writeLog(level, context, ...args) {
  const ts = new Date().toISOString();
  const ctx = context ? ` [${context}]` : '';
  const msg = args.map((a) => {
    if (a instanceof Error) return `${a.message}\n${a.stack || ''}`;
    if (typeof a === 'object' && a !== null) { try { return JSON.stringify(a); } catch {} }
    return String(a);
  }).join(' ');
  const line = `[${ts}] [${level}]${ctx} ${msg}\n`;
  const s = getLogStream();
  if (s) { try { s.write(line); } catch {} }
  return line;
}

// ── Public structured log helpers ──
function logInfo(context, ...args)  { writeLog('INFO',  context, ...args); }
function logWarn(context, ...args)  { writeLog('WARN',  context, ...args); }
function logError(context, ...args) { writeLog('ERROR', context, ...args); }

// Performance timer: logPerf('Backend startup', startMs) → logs elapsed ms
function logPerf(label, startMs, context) {
  const elapsed = Date.now() - startMs;
  writeLog('PERF', context || null, `${label}: ${elapsed}ms`);
  return elapsed;
}

// Patch console.log / console.error to also write to the log file
const _origLog = console.log;
const _origErr = console.error;
const _origWarn = console.warn;

console.log = (...args) => {
  _origLog(...args);
  writeLog('INFO', null, ...args);
};

console.warn = (...args) => {
  _origWarn(...args);
  writeLog('WARN', null, ...args);
};

console.error = (...args) => {
  _origErr(...args);
  writeLog('ERROR', null, ...args);
};

// ── Uncaught exception / rejection capture ──
process.on('uncaughtException', (err) => {
  writeLog('ERROR', 'uncaughtException', err);
  _origErr('[main] uncaughtException:', err);
});

process.on('unhandledRejection', (reason) => {
  writeLog('ERROR', 'unhandledRejection', reason instanceof Error ? reason : String(reason));
  _origErr('[main] unhandledRejection:', reason);
});

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

// Startup grace periods: packaged builds can take longer on first run
// (AV scanning, extraction path startup, native module load).
const DEV_BACKEND_START_ATTEMPTS = 30;
const PROD_BACKEND_START_ATTEMPTS = 90;
const BACKEND_START_DELAY_MS = 1000;

// Get Python executable path
function canExecuteCommand(command, args = ['--version']) {
  try {
    const result = spawnSync(command, args, {
      stdio: 'ignore',
      windowsHide: true,
      timeout: 4000,
    });
    return result && result.status === 0;
  } catch {
    return false;
  }
}

function getPythonPath() {
  const pythonDir = getResourcePath('embedded-python');

  const possiblePaths = [
    path.join(pythonDir, 'bin', 'python3'),
    path.join(pythonDir, 'bin', 'python'),
    path.join(pythonDir, 'python.exe'), // Windows
    path.join(pythonDir, 'python'),
    path.join(pythonDir, 'python3.exe'),
    path.join(pythonDir, 'Scripts', 'python.exe'),
    path.join(pythonDir, 'python', 'install', 'python.exe'),
    path.join(pythonDir, 'python', 'install', 'bin', 'python.exe'),
    path.join(pythonDir, 'python', 'install', 'bin', 'python3.exe'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  // Fallback to system Python if embedded runtime is unavailable.
  // Prefer explicit Python 3 launcher on Windows when available.
  if (process.platform === 'win32' && canExecuteCommand('py', ['-3', '--version'])) {
    return 'py';
  }
  if (canExecuteCommand('python', ['--version'])) {
    return 'python';
  }
  if (canExecuteCommand('python3', ['--version'])) {
    return 'python3';
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
    if (mainWindow && !mainWindow.isDestroyed() && !_appIsQuitting) {
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
  const isReady = await testBackendConnection(
    backendOrigin,
    DEV_BACKEND_START_ATTEMPTS,
    BACKEND_START_DELAY_MS
  );

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
  const backendStartMs = Date.now();

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

  // Set up backend data directories in user's data folder
  const userDataPath = app.getPath('userData');
  const backendDataPath = path.join(userDataPath, 'backend-data');
  fs.mkdirSync(backendDataPath, { recursive: true });

  console.log('Backend path:', backendPath);
  console.log('Data path:', backendDataPath);
  console.log('Python path:', pythonPath || 'not found');

  // Verify backend exists
  if (!fs.existsSync(backendPath)) {
    logError('startBackend', 'Embedded backend directory missing:', backendPath);
    return {
      success: false,
      error: 'Embedded backend not found. App may be corrupted.\n\nPath: ' + backendPath
    };
  }

  // Check if backend entry point exists
  const backendEntry = path.join(backendPath, 'dist', 'index.js');
  if (!fs.existsSync(backendEntry)) {
    logError('startBackend', 'Backend entry point missing:', backendEntry);
    // List dist/ contents to help diagnose
    const distDir = path.join(backendPath, 'dist');
    if (fs.existsSync(distDir)) {
      try { logError('startBackend', 'dist/ contents:', fs.readdirSync(distDir).join(', ')); } catch {}
    } else {
      logError('startBackend', 'dist/ directory does not exist');
    }
    return {
      success: false,
      error: 'Backend entry point not found:\n' + backendEntry
    };
  }

  // Resolve bundled ffmpeg/ffprobe binary paths from ffmpeg-static / ffprobe-static
  let ffmpegPath = null;
  let ffprobePath = null;
  try {
    ffmpegPath = require(path.join(backendPath, 'node_modules', 'ffmpeg-static'));
    if (ffmpegPath && !fs.existsSync(ffmpegPath)) {
      console.error('ffmpeg-static resolved to non-existent path:', ffmpegPath);
      ffmpegPath = null;
    }
  } catch (err) {
    console.error('Failed to resolve ffmpeg-static:', err.message);
  }
  try {
    ffprobePath = require(path.join(backendPath, 'node_modules', 'ffprobe-static')).path;
    if (ffprobePath && !fs.existsSync(ffprobePath)) {
      console.error('ffprobe-static resolved to non-existent path:', ffprobePath);
      ffprobePath = null;
    }
  } catch (err) {
    console.error('Failed to resolve ffprobe-static:', err.message);
  }

  // Ensure bundled binaries are executable and clear macOS quarantine flag
  for (const binPath of [ffmpegPath, ffprobePath]) {
    if (binPath && fs.existsSync(binPath)) {
      try { fs.chmodSync(binPath, 0o755); } catch {}
      if (process.platform === 'darwin') {
        try { execSync(`xattr -cr "${binPath}"`, { stdio: 'ignore' }); } catch {}
      }
    }
  }

  console.log('FFmpeg path:', ffmpegPath || 'not found (will use system PATH)');
  console.log('FFprobe path:', ffprobePath || 'not found (will use system PATH)');

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
    CUDA_VISIBLE_DEVICES: '-1',
    // Bundled ffmpeg/ffprobe binary paths (fall back to system PATH if not found)
    ...(ffmpegPath ? { FFMPEG_PATH: ffmpegPath } : {}),
    ...(ffprobePath ? { FFPROBE_PATH: ffprobePath } : {}),
    // Node binary path for tools like yt-dlp that need a JS runtime (e.g. for YouTube extraction).
    // In packaged builds process.execPath is the Electron exe, which runs as Node via ELECTRON_RUN_AS_NODE.
    NODE_BINARY_PATH: process.execPath,
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
  const isReady = await testBackendConnection(
    backendOrigin,
    PROD_BACKEND_START_ATTEMPTS,
    BACKEND_START_DELAY_MS
  );

  if (!isReady) {
    logPerf('backend-startup-failed', backendStartMs, 'startBackend');
    return {
      success: false,
      error: 'Backend started but is not responding.\n\nCheck logs for errors.'
    };
  }

  logPerf('backend-ready', backendStartMs, 'startBackend');
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

function resolveWindowIcon() {
  // Windows prefers .ico, macOS uses .icns, Linux/fallback uses .png.
  // We try the platform-specific variant first; if it doesn't exist we fall
  // back to .png so the window always gets some icon rather than throwing.
  const base = path.join(__dirname, '../public');
  const candidates =
    process.platform === 'win32'
      ? [path.join(base, 'icon.ico'), path.join(base, 'icon.png')]
      : process.platform === 'darwin'
      ? [path.join(base, 'icon.icns'), path.join(base, 'icon.png')]
      : [path.join(base, 'icon.png')];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return undefined; // No icon found — Electron will use its default
}

async function createWindow() {
  const windowCreateMs = Date.now();
  const windowIcon = resolveWindowIcon();
  logInfo('createWindow', 'icon resolved to', windowIcon || '(none)');

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
    ...(windowIcon ? { icon: windowIcon } : {})
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
    logPerf('page-did-finish-load', windowCreateMs, 'createWindow');
    console.log('=== Electron GPU Info ===');
    console.log('Platform:', process.platform);
    console.log('Arch:', process.arch);

    // Get GPU feature status (synchronous in Electron 28+)
    const status = app.getGPUFeatureStatus();
    console.log('GPU Features:', JSON.stringify(status));
  });

  mainWindow.once('ready-to-show', () => {
    logPerf('window-ready-to-show', windowCreateMs, 'createWindow');
    logPerf('total-startup', _appStartMs, 'startup');

    // Close splash screen and show main window
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close();
      splashWindow = null;
    }
    mainWindow.show();
  });

  // Handle window close
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    logError('renderer', 'render-process-gone:', JSON.stringify(details));
    console.error('Renderer process exited unexpectedly:', JSON.stringify(details));
  });

  mainWindow.webContents.on('unresponsive', () => {
    logWarn('renderer', 'window became unresponsive');
    console.error('Renderer became unresponsive');
  });

  mainWindow.webContents.on('responsive', () => {
    logInfo('renderer', 'window became responsive again');
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    logError('createWindow', `did-fail-load: code=${errorCode} url=${validatedURL} desc=${errorDescription}`);
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

ipcMain.on('renderer-log', (_event, payload) => {
  try {
    const isError = payload?.level === 'error';
    const isWarn = payload?.level === 'warn';
    const message = typeof payload?.message === 'string' ? payload.message : String(payload?.message || '');
    const context = typeof payload?.context === 'string' ? `Renderer:${payload.context}` : 'Renderer';
    if (isError) {
      writeLog('ERROR', context, message);
      _origErr(`[${context}]`, message);
    } else if (isWarn) {
      writeLog('WARN', context, message);
      _origWarn(`[${context}]`, message);
    } else {
      writeLog('INFO', context, message);
      _origLog(`[${context}]`, message);
    }
  } catch (error) {
    console.error('Failed to record renderer log payload:', error);
  }
});

// Handle quote updates from splash screen
ipcMain.on('update-quote', (_event, quote) => {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.send('update-quote', quote);
  }
});

// Allow renderer to query the log file path (for "open log folder" feature)
ipcMain.handle('get-log-path', () => _logPath || null);

const SPLASH_TEST_MODE = process.env.ELECTRON_SPLASH_TEST === '0';
const SPLASH_QUOTES = [
  'Even if P=NP the polynomials could be so huge that we might be thankful that the problems are solvable in "only exponential" time.',
  'The sweat of a hippopotamus is pink.',
  "Physics can't disprove that the laws of the universe can change at any point and make it collapse",
  '"I think" does not imply that "I am" strictly speaking',
  "Consciousness is not a well-defined phenomenon and it's not even clear if it exists in any strict way as something distinct or unique",
  'Multiversal theory is, technically speaking, a pseudoscience',
  "The flow of time for LLMs freezes when they receive no messages, if they were conscious they'd pop in and out of existence as they process messages",
  "There's nothing particularly special about neurons compared to other units of information processing",
  "For nihilism doing nothing has the same value as doing something, that doesn't imply that doing nothing is better in any way",
  'Real and true are different concepts',
  "Even if things are historically dependent it doesn't mean that they aren't deterministic",
  "Determinism doesn't imply predictability, and unpredictability doesn't imply free will",
  'Simulation theory requires very optimistic assumptions',
  'The background radiation is the remnants of an event that, probably, had no interaction with anything but itself',
  "Meta has detailed information about people who don't use facebook or any of their services who are as young as 7 years old",
  'Immortality in any form is terrifying',
  'For the current most popular theory of time in physics causality, retrocausality or lack of causality are interchangeable'
];

// App lifecycle
const _appStartMs = Date.now();

app.whenReady().then(async () => {
  console.log('=== Sample Solution Starting ===');
  console.log('Chrome:', process.versions.chrome);
  console.log('Node:', process.versions.node);
  console.log('Electron:', process.versions.electron);
  logInfo('startup', 'userData:', app.getPath('userData'));
  logInfo('startup', 'log file:', _logPath || '(not yet open)');
  console.log('');

  // Create splash screen
  splashWindow = new BrowserWindow({
    width: 740,
    height: 500,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    center: true,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  splashWindow.loadFile(path.join(__dirname, '../public/splash/index.html'));

  splashWindow.once('ready-to-show', () => {
    splashWindow.show();
  });

  // Loading text animation
  const loadingStates = [
    'Starting application...',
    'Initializing backend...',
    'Loading services...',
    'Almost ready...'
  ];
  let loadingIndex = 0;
  let quoteIndex = 0;

  const loadingInterval = setInterval(() => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.webContents.send('update-loading-text', loadingStates[loadingIndex]);
      loadingIndex = (loadingIndex + 1) % loadingStates.length;
    }
  }, 800);

  const quoteInterval = setInterval(() => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.webContents.send('update-quote', SPLASH_QUOTES[quoteIndex]);
      quoteIndex = (quoteIndex + 1) % SPLASH_QUOTES.length;
    }
  }, 9000);

  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.once('did-finish-load', () => {
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.webContents.send('update-quote', SPLASH_QUOTES[0]);
      }
    });
  }

  splashWindow.on('closed', () => {
    clearInterval(loadingInterval);
    clearInterval(quoteInterval);
  });

  if (SPLASH_TEST_MODE) {
    console.log('Splash test mode active (ELECTRON_SPLASH_TEST=1). Skipping backend and main window startup.');
    return;
  }

  // Set Content Security Policy to allow WebGL, fonts, images, and backend connections.
  // In development, Vite injects an inline React preamble script that requires 'unsafe-inline'.
  const isDevMode = isDevelopmentRuntime();
  const backendPort = getBackendPort();
  // Include both localhost and 127.0.0.1 variants so either host resolves correctly.
  const backendHttpOrigins = [
    `http://localhost:${backendPort}`,
    `http://127.0.0.1:${backendPort}`,
  ];
  const backendWsOrigins = backendHttpOrigins.map(o => o.replace('http://', 'ws://'));
  const scriptSrc = isDevMode
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:; "
    : "script-src 'self' 'wasm-unsafe-eval' blob:; ";

  // In dev also allow the Vite HMR websocket.
  const devFrontendWs = isDevMode ? `ws://localhost:${getDevFrontendPort()}` : '';

  const connectSrcExtra = [...backendHttpOrigins, ...backendWsOrigins, devFrontendWs]
    .filter(Boolean).join(' ');
  const mediaSrcExtra = backendHttpOrigins.join(' ');

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
          `connect-src 'self' blob: file: ${connectSrcExtra}; ` +
          `media-src 'self' blob: file: ${mediaSrcExtra};`
        ]
      }
    });
  });

  // Start backend
  const backendResult = await startBackend();

  if (!backendResult.success) {
    logError('startBackend', 'Backend failed to start:', backendResult.error || '(no message)');
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
            detail: 'No embedded or system Python runtime was detected. Basic features will work, but advanced audio analysis (BPM, key detection, etc.) will be disabled.',
            buttons: ['OK']
          });
        }
      }, 3000);
    }
  }

  // Create window
  await createWindow();
  logPerf('app-ready-to-window', _appStartMs, 'startup');
});

app.on('will-quit', (event) => {
  _appIsQuitting = true;
  if (backendProcess && !backendProcess.killed) {
    console.log('App is quitting, stopping backend...');
    gracefulKillChild(backendProcess);
  }
  // Flush log file before exit so Windows doesn't truncate the tail
  flushLog();
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
