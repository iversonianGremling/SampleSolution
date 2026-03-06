import React, { Component, type ErrorInfo, type ReactNode } from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AccessibilityProvider } from './contexts/AccessibilityContext'
import { DrumRackProvider } from './contexts/DrumRackContext'
import { ToastProvider } from './contexts/ToastContext'
import { AppDialogProvider } from './hooks/useAppDialog'
import App from './App'
import './index.css'

function reportRendererIssue(context: string, reason: unknown) {
  const message =
    reason instanceof Error
      ? `${reason.name}: ${reason.message}\n${reason.stack || ''}`.trim()
      : typeof reason === 'string'
      ? reason
      : JSON.stringify(reason)

  try {
    window.electron?.logRenderer?.({
      level: 'error',
      context,
      message,
    })
  } catch {
    // Best-effort diagnostics only.
  }
}

// Handle unhandled promise rejections from PixiJS
window.addEventListener('unhandledrejection', (event) => {
  if (event.reason?.message?.includes('CanvasRenderer is not yet implemented')) {
    // This is expected in some browsers - PixiJS will fall back to WebGL
    event.preventDefault()
    console.warn('CanvasRenderer fallback attempted - WebGL will be used instead')
    return
  }

  reportRendererIssue('unhandledrejection', event.reason)
})

window.addEventListener('error', (event) => {
  reportRendererIssue('window-error', event.error || event.message)
})

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }
  render() {
    const { error } = this.state
    if (error) {
      return (
        <div style={{ padding: 32, fontFamily: 'monospace', color: '#f87171', background: '#0f1216', minHeight: '100vh' }}>
          <h2 style={{ marginBottom: 12 }}>Render error</h2>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {(error as Error).stack || (error as Error).message}
          </pre>
          <p style={{ marginTop: 16, color: '#94a3b8', fontSize: 13 }}>
            Check the browser console for more details.
          </p>
        </div>
      )
    }
    return this.props.children
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,
      retry: 1,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AccessibilityProvider>
          <DrumRackProvider>
            <AppDialogProvider>
              <ToastProvider>
                <App />
              </ToastProvider>
            </AppDialogProvider>
          </DrumRackProvider>
        </AccessibilityProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)
