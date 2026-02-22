import { useState, useEffect } from 'react'
import { X, AlertTriangle } from 'lucide-react'

interface ConfirmModalProps {
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  hideCancel?: boolean
  onConfirm: () => void | Promise<void>
  onCancel: () => void
  isDestructive?: boolean
  checkboxLabel?: string
  checkboxDefaultChecked?: boolean
  onCheckboxChange?: (checked: boolean) => void
}

export function ConfirmModal({
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  hideCancel = false,
  onConfirm,
  onCancel,
  isDestructive = false,
  checkboxLabel,
  checkboxDefaultChecked = false,
  onCheckboxChange,
}: ConfirmModalProps) {
  const [isClosing, setIsClosing] = useState(false)
  const [isEntering, setIsEntering] = useState(true)
  const [isCheckboxChecked, setIsCheckboxChecked] = useState(checkboxDefaultChecked)
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

  const handleConfirm = async () => {
    if (isProcessing) return
    setIsProcessing(true)
    try {
      await onConfirm()
    } finally {
      setIsProcessing(false)
    }
  }

  const handleCheckboxChange = (checked: boolean) => {
    setIsCheckboxChecked(checked)
    onCheckboxChange?.(checked)
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-surface-base/40 z-40 transition-opacity duration-300 ${
          isClosing || isEntering ? 'opacity-0' : 'opacity-100'
        }`}
        onClick={handleClose}
      />

      {/* Modal content */}
      <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none p-4">
        <div
          className={`bg-surface-raised rounded-xl overflow-hidden flex flex-col w-full max-w-md pointer-events-auto shadow-2xl border border-surface-border transition-all duration-300 ease-out ${
            isClosing || isEntering ? 'opacity-0 scale-95' : 'opacity-100 scale-100'
          }`}
        >
          {/* Header */}
          <div className="flex items-start gap-3 px-6 py-4 border-b border-surface-border">
            {isDestructive && (
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center">
                <AlertTriangle size={20} className="text-red-400" />
              </div>
            )}
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

          {/* Content */}
          <div className="px-6 py-4 space-y-4">
            <p className="text-sm text-slate-300">{message}</p>

            {/* Optional checkbox */}
            {checkboxLabel && (
              <label className="flex items-start gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={isCheckboxChecked}
                  onChange={(e) => handleCheckboxChange(e.target.checked)}
                  disabled={isProcessing}
                  className="mt-0.5 w-4 h-4 rounded border-slate-600 bg-surface-base text-accent-primary focus:ring-2 focus:ring-accent-primary/50 focus:ring-offset-0 disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <span className="text-sm text-slate-300 group-hover:text-white transition-colors">
                  {checkboxLabel}
                </span>
              </label>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 px-6 py-4 border-t border-surface-border bg-surface-base">
            {!hideCancel && (
              <button
                onClick={handleClose}
                disabled={isProcessing}
                className="flex-1 px-4 py-2 rounded-lg text-sm font-medium text-slate-300 bg-surface-overlay hover:bg-surface-border transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {cancelText}
              </button>
            )}
            <button
              onClick={handleConfirm}
              disabled={isProcessing}
              className={`${hideCancel ? 'w-full' : 'flex-1'} px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                isDestructive
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'bg-accent-primary hover:bg-accent-primary/80'
              }`}
            >
              {isProcessing ? 'Processing...' : confirmText}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
