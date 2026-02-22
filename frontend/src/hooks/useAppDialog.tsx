import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ConfirmModal } from '../components/ConfirmModal'

type ConfirmDialogOptions = {
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
  isDestructive?: boolean
}

type AlertDialogOptions = {
  title?: string
  message: string
  buttonText?: string
  isDestructive?: boolean
}

type PendingConfirm = {
  kind: 'confirm'
  options: ConfirmDialogOptions
  resolve: (value: boolean) => void
}

type PendingAlert = {
  kind: 'alert'
  options: AlertDialogOptions
  resolve: () => void
}

type PendingDialog = PendingConfirm | PendingAlert

export function useAppDialog() {
  const [pendingDialog, setPendingDialog] = useState<PendingDialog | null>(null)
  const pendingDialogRef = useRef<PendingDialog | null>(null)

  useEffect(() => {
    pendingDialogRef.current = pendingDialog
  }, [pendingDialog])

  useEffect(() => {
    return () => {
      const pending = pendingDialogRef.current
      if (!pending) return
      if (pending.kind === 'confirm') {
        pending.resolve(false)
      } else {
        pending.resolve()
      }
    }
  }, [])

  const confirm = useCallback((options: ConfirmDialogOptions) => {
    return new Promise<boolean>((resolve) => {
      setPendingDialog({ kind: 'confirm', options, resolve })
    })
  }, [])

  const alert = useCallback((options: AlertDialogOptions) => {
    return new Promise<void>((resolve) => {
      setPendingDialog({ kind: 'alert', options, resolve })
    })
  }, [])

  const dialogNode = useMemo(() => {
    if (!pendingDialog) return null

    if (pendingDialog.kind === 'confirm') {
      const { options } = pendingDialog
      return (
        <ConfirmModal
          title={options.title || 'Please Confirm'}
          message={options.message}
          confirmText={options.confirmText || 'Confirm'}
          cancelText={options.cancelText || 'Cancel'}
          isDestructive={Boolean(options.isDestructive)}
          onConfirm={() => {
            pendingDialog.resolve(true)
            setPendingDialog(null)
          }}
          onCancel={() => {
            pendingDialog.resolve(false)
            setPendingDialog(null)
          }}
        />
      )
    }

    const { options } = pendingDialog
    return (
      <ConfirmModal
        title={options.title || 'Notice'}
        message={options.message}
        confirmText={options.buttonText || 'OK'}
        hideCancel
        isDestructive={Boolean(options.isDestructive)}
        onConfirm={() => {
          pendingDialog.resolve()
          setPendingDialog(null)
        }}
        onCancel={() => {
          pendingDialog.resolve()
          setPendingDialog(null)
        }}
      />
    )
  }, [pendingDialog])

  return { confirm, alert, dialogNode }
}
