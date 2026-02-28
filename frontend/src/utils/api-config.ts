/**
 * API configuration for web and Electron environments
 */

import { isElectron } from './platform';
import runtimeConfig from '../../electron/runtime-config.json';

const DEFAULT_WEB_API_BASE = '/api';
const ELECTRON_API_STORAGE_KEY = 'electron.apiBaseUrl';
const DEFAULT_ELECTRON_DEV_API_BASE = `http://localhost:${runtimeConfig.ports.devBackend}/api`;
const DEFAULT_ELECTRON_PROD_API_BASE = `http://127.0.0.1:${runtimeConfig.ports.prodBackend}/api`;

function ensureApiBasePath(rawValue: string | null | undefined): string | null {
  if (!rawValue) return null;

  const trimmed = rawValue.trim();
  if (!trimmed) return null;

  // Preserve relative API roots such as /api.
  if (trimmed.startsWith('/')) {
    const normalized = trimmed.replace(/\/+$/, '');
    if (!normalized) return DEFAULT_WEB_API_BASE;
    return normalized.endsWith('/api') ? normalized : `${normalized}/api`;
  }

  try {
    const url = new URL(trimmed);
    const normalizedPath = url.pathname.replace(/\/+$/, '');
    url.pathname = normalizedPath.endsWith('/api')
      ? normalizedPath || '/api'
      : `${normalizedPath || ''}/api`;
    return url.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function getElectronConfiguredApiBase(): string | null {
  return ensureApiBasePath(localStorage.getItem(ELECTRON_API_STORAGE_KEY));
}

function getWebConfiguredApiBase(): string | null {
  return ensureApiBasePath(
    import.meta.env.VITE_WEB_API_BASE_URL || import.meta.env.VITE_API_URL,
  );
}

function getDevConfiguredApiBase(): string | null {
  return ensureApiBasePath(import.meta.env.VITE_DEV_API_BASE_URL);
}

export function getDefaultElectronApiBaseUrl(): string {
  const envValue = import.meta.env.DEV
    ? import.meta.env.VITE_ELECTRON_DEV_API_BASE_URL
    : import.meta.env.VITE_ELECTRON_PROD_API_BASE_URL;

  return ensureApiBasePath(envValue)
    || (import.meta.env.DEV ? DEFAULT_ELECTRON_DEV_API_BASE : DEFAULT_ELECTRON_PROD_API_BASE);
}

/**
 * Get the API base URL based on environment
 */
export function getApiBaseUrl(): string {
  // Electron keeps its own backend configuration independent of web.
  if (isElectron()) {
    return getElectronConfiguredApiBase() || getDefaultElectronApiBaseUrl();
  }

  // Web dev can use direct API URL when configured; otherwise use Vite proxy.
  if (import.meta.env.DEV) {
    return getDevConfiguredApiBase() || DEFAULT_WEB_API_BASE;
  }

  // Web production can target a separate backend service via env configuration.
  return getWebConfiguredApiBase() || DEFAULT_WEB_API_BASE;
}

/**
 * Set a custom API base URL (for Electron settings)
 */
export function setApiBaseUrl(url: string): void {
  const normalized = ensureApiBasePath(url);
  if (!normalized) return;
  localStorage.setItem(ELECTRON_API_STORAGE_KEY, normalized);
  window.location.reload(); // Reload to apply new URL
}

/**
 * Get the configured API base URL (for settings display)
 */
export function getConfiguredApiUrl(): string | null {
  return getElectronConfiguredApiBase();
}

/**
 * Reset to default API URL
 */
export function resetApiBaseUrl(): void {
  localStorage.removeItem(ELECTRON_API_STORAGE_KEY);
  window.location.reload();
}
