import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'

export type ToastKind = 'info' | 'success' | 'warning' | 'error'

export interface ShowToastOptions {
  message: string
  kind?: ToastKind
  durationMs?: number
  actionLabel?: string
  onAction?: () => void
}

interface ToastEntry extends Required<Pick<ShowToastOptions, 'message' | 'kind' | 'durationMs'>> {
  id: number
  actionLabel?: string
  onAction?: () => void
}

interface ToastContextValue {
  showToast: (options: ShowToastOptions) => number
  dismissToast: (id: number) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

function getToastClassName(kind: ToastKind): string {
  if (kind === 'success') return 'bg-surface-raised border-green-500/55 text-green-200'
  if (kind === 'error') return 'bg-surface-raised border-red-500/55 text-red-200'
  if (kind === 'warning') return 'bg-surface-raised border-amber-500/55 text-amber-200'
  return 'bg-surface-raised border-surface-border text-slate-100'
}

interface ToastItemProps {
  toast: ToastEntry
  onDismiss: (id: number) => void
}

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  return (
    <div
      className={`pointer-events-auto w-full rounded-lg border px-4 py-3 text-sm shadow-xl ${getToastClassName(toast.kind)}`}
      role="status"
    >
      <div className="flex items-start gap-3">
        <div className="flex-1">{toast.message}</div>
        <button
          type="button"
          className="rounded p-0.5 text-slate-400 hover:text-slate-100 transition-colors"
          onClick={() => onDismiss(toast.id)}
          aria-label="Dismiss notification"
        >
          <X size={14} />
        </button>
      </div>

      {toast.actionLabel && toast.onAction && (
        <div className="mt-2">
          <button
            type="button"
            className="rounded border border-current/35 px-2.5 py-1 text-xs font-medium hover:bg-white/10 transition-colors"
            onClick={() => {
              toast.onAction?.()
              onDismiss(toast.id)
            }}
          >
            {toast.actionLabel}
          </button>
        </div>
      )}
    </div>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([])
  const nextToastIdRef = useRef(1)

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id))
  }, [])

  const showToast = useCallback((options: ShowToastOptions): number => {
    const id = nextToastIdRef.current
    nextToastIdRef.current += 1
    const toast: ToastEntry = {
      id,
      message: options.message,
      kind: options.kind ?? 'info',
      durationMs: options.durationMs ?? 5000,
      actionLabel: options.actionLabel,
      onAction: options.onAction,
    }

    setToasts((prev) => [...prev, toast])

    if (toast.durationMs > 0) {
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((entry) => entry.id !== id))
      }, toast.durationMs)
    }

    return id
  }, [])

  const value = useMemo<ToastContextValue>(
    () => ({
      showToast,
      dismissToast,
    }),
    [showToast, dismissToast],
  )

  return (
    <ToastContext.Provider value={value}>
      {children}

      {toasts.length > 0 && (
        <div className="pointer-events-none fixed right-4 top-4 z-[200] flex w-full max-w-sm flex-col gap-2">
          {toasts.map((toast) => (
            <ToastItem key={toast.id} toast={toast} onDismiss={dismissToast} />
          ))}
        </div>
      )}
    </ToastContext.Provider>
  )
}
