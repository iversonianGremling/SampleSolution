import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DrumRackProvider } from './contexts/DrumRackContext'
import App from './App'
import './index.css'

// Handle unhandled promise rejections from PixiJS
window.addEventListener('unhandledrejection', (event) => {
  if (event.reason?.message?.includes('CanvasRenderer is not yet implemented')) {
    // This is expected in some browsers - PixiJS will fall back to WebGL
    event.preventDefault()
    console.warn('CanvasRenderer fallback attempted - WebGL will be used instead')
  }
})

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
    <QueryClientProvider client={queryClient}>
      <DrumRackProvider>
        <App />
      </DrumRackProvider>
    </QueryClientProvider>
  </React.StrictMode>,
)
