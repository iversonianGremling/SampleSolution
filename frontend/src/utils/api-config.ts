/**
 * API configuration for web and Electron environments
 */

import { isElectron } from './platform';

/**
 * Get the API base URL based on environment
 */
export function getApiBaseUrl(): string {
  // In development (Vite dev server), use proxy
  if (import.meta.env.DEV) {
    return '/api';
  }

  // In Electron production, connect to backend
  if (isElectron()) {
    // Option 1: Embedded backend (localhost)
    const embeddedBackend = 'http://localhost:4000/api';

    // Option 2: Remote backend (can be configured by user)
    const remoteBackend = localStorage.getItem('apiBaseUrl');

    return remoteBackend || embeddedBackend;
  }

  // Web production: Use relative path (same origin)
  return '/api';
}

/**
 * Set a custom API base URL (for Electron settings)
 */
export function setApiBaseUrl(url: string): void {
  localStorage.setItem('apiBaseUrl', url);
  window.location.reload(); // Reload to apply new URL
}

/**
 * Get the configured API base URL (for settings display)
 */
export function getConfiguredApiUrl(): string | null {
  return localStorage.getItem('apiBaseUrl');
}

/**
 * Reset to default API URL
 */
export function resetApiBaseUrl(): void {
  localStorage.removeItem('apiBaseUrl');
  window.location.reload();
}
