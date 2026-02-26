import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

export interface ChoiceModalOption {
  value: string
  label: string
  isDestructive?: boolean
}

interface ChoiceModalProps {
  title: string
  message: string
  options: ChoiceModalOption[]
  cancelText?: string
  onSelect: (value: string) => void | Promise<void>
  onCancel: () => void
}

export function ChoiceModal({
  title,
  message,
  options,
  cancelText = 'Cancel',
  onSelect,
  onCancel,
}: ChoiceModalProps) {
  const [isClosing, setIsClosing] = useState(false)
  const [isEntering, setIsEntering] = useState(true)
  const [isProcessing, setIsProcessing] = useState(false)

  useEffect(() => {
    setIsEntering(true)
    const timer = setTimeout(() => {
      setIsEntering(false)
    }, 10)
    return () => clearTimeout(timer)
  }, [])

  const handleClose = () => {
    if (isProcessing) return
    setIsClosing(true)
    setTimeout(() => {
      onCancel()
      setIsClosing(false)
    }, 300)
  }

  const handleSelect = async (value: string) => {
    if (isProcessing) return
    setIsProcessing(true)
    try {
      await onSelect(value)
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

          <div className="px-6 py-4">
            <p className="text-sm text-slate-300">{message}</p>
          </div>

          <div className="flex flex-wrap items-center gap-3 px-6 py-4 border-t border-surface-border bg-surface-base">
            <button
              onClick={handleClose}
              disabled={isProcessing}
              className="flex-1 min-w-[100px] px-4 py-2 rounded-lg text-sm font-medium text-slate-300 bg-surface-overlay hover:bg-surface-border transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {cancelText}
            </button>
            {options.map((option) => (
              <button
                key={option.value}
                onClick={() => {
                  void handleSelect(option.value)
                }}
                disabled={isProcessing}
                className={`flex-1 min-w-[100px] px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  option.isDestructive
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-accent-primary hover:bg-accent-primary/80'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
