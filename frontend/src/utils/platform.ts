/**
 * Platform detection utilities for web vs Electron environments
 */

interface ElectronAPI {
  isElectron: boolean;
  platform: string;
  arch: string;
  versions: {
    chrome: string;
    node: string;
    electron: string;
  };
  getGPUInfo: () => Promise<any>;
  selectDirectory?: (options?: { defaultPath?: string; title?: string }) => Promise<string | null>;
  selectImportPath?: (options?: { defaultPath?: string; title?: string }) => Promise<string | null>;
  getSetting?: (key: string) => Promise<string | null>;
  setSetting?: (key: string, value: string) => Promise<boolean>;
  removeSetting?: (key: string) => Promise<boolean>;
}

declare global {
  interface Window {
    electron?: ElectronAPI;
  }
}

/**
 * Check if the app is running in Electron
 */
export const isElectron = (): boolean => {
  return !!(window.electron?.isElectron);
};

/**
 * Get the current platform (web, win32, linux, darwin)
 */
export const getPlatform = (): string => {
  return window.electron?.platform || 'web';
};

/**
 * Get the architecture (x64, arm64, etc.)
 */
export const getArch = (): string => {
  return window.electron?.arch || 'unknown';
};

/**
 * Get Electron/Chrome versions
 */
export const getVersions = () => {
  if (!isElectron()) {
    return {
      chrome: 'N/A (Web)',
      node: 'N/A (Web)',
      electron: 'N/A (Web)'
    };
  }
  return window.electron?.versions || null;
};

/**
 * Get GPU information from Electron
 */
export const getElectronGPUInfo = async () => {
  if (!isElectron()) {
    return null;
  }
  try {
    return await window.electron?.getGPUInfo();
  } catch (error) {
    console.error('Failed to get GPU info:', error);
    return null;
  }
};

/**
 * Check if running on Windows
 */
export const isWindows = (): boolean => {
  return getPlatform() === 'win32';
};

/**
 * Check if running on macOS
 */
export const isMac = (): boolean => {
  return getPlatform() === 'darwin';
};

/**
 * Check if running on Linux
 */
export const isLinux = (): boolean => {
  return getPlatform() === 'linux';
};

/**
 * Check if running in web browser
 */
export const isWeb = (): boolean => {
  return !isElectron();
};
