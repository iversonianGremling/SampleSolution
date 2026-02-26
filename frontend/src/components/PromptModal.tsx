import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'

interface PromptModalProps {
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  defaultValue?: string
  placeholder?: string
  validate?: (value: string) => string | null
  onConfirm: (value: string) => void | Promise<void>
  onCancel: () => void
}

export function PromptModal({
  title,
  message,
  confirmText = 'Save',
  cancelText = 'Cancel',
  defaultValue = '',
  placeholder = '',
  validate,
  onConfirm,
  onCancel,
}: PromptModalProps) {
  const [isClosing, setIsClosing] = useState(false)
  const [isEntering, setIsEntering] = useState(true)
  const [isProcessing, setIsProcessing] = useState(false)
  const [inputValue, setInputValue] = useState(defaultValue)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setIsEntering(true)
    const timer = setTimeout(() => {
      setIsEntering(false)
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 10)
    return () => clearTimeout(timer)
  }, [])

  const validationError = useMemo(() => validate?.(inputValue) ?? null, [validate, inputValue])

  const handleClose = () => {
    if (isProcessing) return
    setIsClosing(true)
    setTimeout(() => {
      onCancel()
      setIsClosing(false)
    }, 300)
  }

  const handleConfirm = async () => {
    if (isProcessing) return

    if (validationError) {
      setError(validationError)
      return
    }

    setIsProcessing(true)
    setError(null)
    try {
      await onConfirm(inputValue)
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <>
      <div
        className={`fixed inset-0 bg-surface-base/40 z-40 transition-opacity duration-300 ${
          isClosing || isEntering ? 'opacity-0' : 'opacity-100'
        }`}
        onClick={handleClose}
      />

      <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none p-4">
        <div
          className={`bg-surface-raised rounded-xl overflow-hidden flex flex-col w-full max-w-md pointer-events-auto shadow-2xl border border-surface-border transition-all duration-300 ease-out ${
            isClosing || isEntering ? 'opacity-0 scale-95' : 'opacity-100 scale-100'
          }`}
        >
          <div className="flex items-start gap-3 px-6 py-4 border-b border-surface-border">
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-semibold text-white">{title}</h2>
            </div>
            <button
              onClick={handleClose}
              disabled={isProcessing}
              className="flex-shrink-0 p-1 text-slate-400 hover:text-white rounded-lg transition-colors hover:bg-surface-base disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <X size={18} />
            </button>
          </div>

          <div className="px-6 py-4 space-y-3">
            <p className="text-sm text-slate-300">{message}</p>
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(event) => {
                setInputValue(event.target.value)
                if (error) setError(null)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void handleConfirm()
                }
              }}
              disabled={isProcessing}
              placeholder={placeholder}
              className="w-full rounded-lg border border-surface-border bg-surface-base px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-primary/60 disabled:opacity-50 disabled:cursor-not-allowed"
            />
            {(error || validationError) && (
              <p className="text-xs text-red-300">{error || validationError}</p>
            )}
          </div>

          <div className="flex items-center gap-3 px-6 py-4 border-t border-surface-border bg-surface-base">
            <button
              onClick={handleClose}
              disabled={isProcessing}
              className="flex-1 px-4 py-2 rounded-lg text-sm font-medium text-slate-300 bg-surface-overlay hover:bg-surface-border transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {cancelText}
            </button>
            <button
              onClick={() => {
                void handleConfirm()
              }}
              disabled={isProcessing}
              className="flex-1 px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-accent-primary hover:bg-accent-primary/80"
            >
              {isProcessing ? 'Saving...' : confirmText}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
