/// <reference types="vitest" />
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

function resolveDevProxyTarget(rawValue: string | undefined): string {
  const fallback = 'http://localhost:4000'
  if (!rawValue || !rawValue.trim()) return fallback

  const trimmed = rawValue.trim().replace(/\/+$/, '')
  if (trimmed.endsWith('/api')) {
    return trimmed.slice(0, -4) || fallback
  }
  return trimmed
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const proxyTarget = resolveDevProxyTarget(
    env.VITE_DEV_PROXY_TARGET || env.VITE_API_URL,
  )

  return {
    plugins: [react()],
    server: {
      port: 3000,
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
        },
      },
    },
    // Set base to './' for Electron compatibility
    base: './',
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      css: true,
    },
    build: {
      minify: false,
      sourcemap: true,
      // Optimize for Electron
      outDir: 'dist',
      emptyOutDir: true,
    },
  }
})
