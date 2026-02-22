const { contextBridge, ipcRenderer } = require('electron');

// Expose safe APIs to the renderer process
contextBridge.exposeInMainWorld('electron', {
  isElectron: true,
  platform: process.platform,
  arch: process.arch,
  versions: {
    chrome: process.versions.chrome,
    node: process.versions.node,
    electron: process.versions.electron
  },

  // GPU info API
  getGPUInfo: () => ipcRenderer.invoke('get-gpu-info'),

  // Native directory picker
  selectDirectory: (options) => ipcRenderer.invoke('select-directory', options || {}),

  // Native path picker for backup import (directory or .zip file)
  selectImportPath: (options) => ipcRenderer.invoke('select-import-path', options || {}),

  // File system APIs (can be extended)
  // For example: dialog APIs, file reading, etc.
});
