import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { ChoiceModal, type ChoiceModalOption } from '../components/ChoiceModal'
import { ConfirmModal } from '../components/ConfirmModal'
import { PromptModal } from '../components/PromptModal'

type ConfirmDialogOptions = {
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
  isDestructive?: boolean
  checkboxLabel?: string
  checkboxDefaultChecked?: boolean
  onCheckboxChange?: (checked: boolean) => void
}

type AlertDialogOptions = {
  title?: string
  message: string
  buttonText?: string
  isDestructive?: boolean
}

type PromptDialogOptions = {
  title?: string
  message: string
  defaultValue?: string
  placeholder?: string
  confirmText?: string
  cancelText?: string
  validate?: (value: string) => string | null
}

export type ChoiceDialogOption<T extends string = string> = {
  value: T
  label: string
  isDestructive?: boolean
}

export type ChoiceDialogOptions<T extends string = string> = {
  title?: string
  message: string
  options: [ChoiceDialogOption<T>, ChoiceDialogOption<T>, ...ChoiceDialogOption<T>[]]
  cancelText?: string
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

type PendingPrompt = {
  kind: 'prompt'
  options: PromptDialogOptions
  resolve: (value: string | null) => void
}

type PendingChoice = {
  kind: 'choice'
  options: ChoiceDialogOptions<string>
  resolve: (value: string | null) => void
}

type PendingDialog = PendingConfirm | PendingAlert | PendingPrompt | PendingChoice

type ConfirmDialogFn = (options: ConfirmDialogOptions) => Promise<boolean>
type AlertDialogFn = (options: AlertDialogOptions) => Promise<void>
type PromptDialogFn = (options: PromptDialogOptions) => Promise<string | null>
type ChooseDialogFn = <T extends string>(options: ChoiceDialogOptions<T>) => Promise<T | null>

interface AppDialogContextValue {
  confirm: ConfirmDialogFn
  alert: AlertDialogFn
  prompt: PromptDialogFn
  choose: ChooseDialogFn
}

const AppDialogContext = createContext<AppDialogContextValue | null>(null)

function useAppDialogController() {
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
      } else if (pending.kind === 'prompt') {
        pending.resolve(null)
      } else if (pending.kind === 'choice') {
        pending.resolve(null)
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

  const prompt = useCallback((options: PromptDialogOptions) => {
    return new Promise<string | null>((resolve) => {
      setPendingDialog({ kind: 'prompt', options, resolve })
    })
  }, [])

  const choose = useCallback(<T extends string>(options: ChoiceDialogOptions<T>) => {
    return new Promise<T | null>((resolve) => {
      setPendingDialog({
        kind: 'choice',
        options: options as unknown as ChoiceDialogOptions<string>,
        resolve: resolve as (value: string | null) => void,
      })
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
          checkboxLabel={options.checkboxLabel}
          checkboxDefaultChecked={options.checkboxDefaultChecked}
          onCheckboxChange={options.onCheckboxChange}
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

    if (pendingDialog.kind === 'alert') {
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
    }

    if (pendingDialog.kind === 'choice') {
      const { options } = pendingDialog
      return (
        <ChoiceModal
          title={options.title || 'Choose an Option'}
          message={options.message}
          options={options.options as ChoiceModalOption[]}
          cancelText={options.cancelText || 'Cancel'}
          onSelect={(value) => {
            pendingDialog.resolve(value)
            setPendingDialog(null)
          }}
          onCancel={() => {
            pendingDialog.resolve(null)
            setPendingDialog(null)
          }}
        />
      )
    }

    const { options } = pendingDialog
    return (
      <PromptModal
        title={options.title || 'Input Required'}
        message={options.message}
        confirmText={options.confirmText || 'Save'}
        cancelText={options.cancelText || 'Cancel'}
        defaultValue={options.defaultValue}
        placeholder={options.placeholder}
        validate={options.validate}
        onConfirm={(value) => {
          pendingDialog.resolve(value)
          setPendingDialog(null)
        }}
        onCancel={() => {
          pendingDialog.resolve(null)
          setPendingDialog(null)
        }}
      />
    )
  }, [pendingDialog])

  return { confirm, alert, prompt, choose, dialogNode }
}

interface AppDialogProviderProps {
  children: ReactNode
}

export function AppDialogProvider({ children }: AppDialogProviderProps) {
  const { confirm, alert, prompt, choose, dialogNode } = useAppDialogController()

  const value = useMemo<AppDialogContextValue>(
    () => ({
      confirm,
      alert,
      prompt,
      choose,
    }),
    [confirm, alert, prompt, choose],
  )

  return (
    <AppDialogContext.Provider value={value}>
      {children}
      {dialogNode}
    </AppDialogContext.Provider>
  )
}

export function useAppDialog() {
  const context = useContext(AppDialogContext)
  if (!context) {
    throw new Error('useAppDialog must be used within AppDialogProvider')
  }

  return {
    ...context,
    dialogNode: null,
  }
}
