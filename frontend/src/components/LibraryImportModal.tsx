import { useMemo, useRef, useState } from 'react'
import { AlertTriangle, FolderOpen, Loader2, X } from 'lucide-react'
import type { LibraryImportMode } from '../api/client'

interface LibraryImportSubmitPayload {
  libraryPath: string
  mode: LibraryImportMode
  importCollections: boolean
  collectionNames: string[]
  collectionNameSuffix: string
}

interface LibraryImportModalProps {
  isSubmitting?: boolean
  onClose: () => void
  onSubmit: (payload: LibraryImportSubmitPayload) => Promise<void> | void
}

const splitCollectionNames = (value: string): string[] => {
  const seen = new Set<string>()
  const names: string[] = []

  value
    .split(/[,;\n]/g)
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((name) => {
      const key = name.toLowerCase()
      if (seen.has(key)) return
      seen.add(key)
      names.push(name)
    })

  return names
}

export function LibraryImportModal({
  isSubmitting = false,
  onClose,
  onSubmit,
}: LibraryImportModalProps) {
  const [libraryPath, setLibraryPath] = useState('')
  const [mode, setMode] = useState<LibraryImportMode>('source')
  const [importCollections, setImportCollections] = useState(false)
  const [collectionNamesText, setCollectionNamesText] = useState('')
  const [collectionNameSuffix, setCollectionNameSuffix] = useState('')
  const [pickerNotice, setPickerNotice] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

  const parsedCollectionNames = useMemo(
    () => splitCollectionNames(collectionNamesText),
    [collectionNamesText],
  )

  const handleBrowse = async () => {
    setPickerNotice(null)
    const initialPath = libraryPath.trim() || undefined

    if (window.electron?.selectImportPath) {
      try {
        const selected = await window.electron.selectImportPath({
          defaultPath: initialPath,
          title: 'Select library folder or ZIP file',
        })
        if (selected) setLibraryPath(selected)
        return
      } catch {
        // Continue to fallback pickers.
      }
    }

    if (window.electron?.selectDirectory) {
      try {
        const selected = await window.electron.selectDirectory({
          defaultPath: initialPath,
          title: 'Select library folder',
        })
        if (selected) setLibraryPath(selected)
        return
      } catch {
        // Continue to browser fallback.
      }
    }

    try {
      const maybeShowOpenFilePicker = (window as unknown as {
        showOpenFilePicker?: (options?: unknown) => Promise<Array<{ name?: string }>>
      }).showOpenFilePicker
      if (typeof maybeShowOpenFilePicker === 'function') {
        const handles = await maybeShowOpenFilePicker({
          multiple: false,
          types: [
            {
              description: 'ZIP archives',
              accept: {
                'application/zip': ['.zip'],
              },
            },
          ],
        })
        const fileName = handles?.[0]?.name
        if (fileName) {
          setLibraryPath(fileName)
          setPickerNotice('Browser returned file name only. Paste absolute path manually if needed.')
          return
        }
      }
    } catch {
      // User cancelled or API unavailable.
    }

    try {
      const maybeShowDirectoryPicker = (window as unknown as { showDirectoryPicker?: () => Promise<{ name?: string }> })
        .showDirectoryPicker
      if (typeof maybeShowDirectoryPicker === 'function') {
        const handle = await maybeShowDirectoryPicker()
        if (handle?.name) {
          setLibraryPath(handle.name)
          setPickerNotice('Browser returned folder name only. Paste absolute path manually if needed.')
          return
        }
      }
    } catch {
      // User cancelled or API unavailable.
    }

    folderInputRef.current?.click()
  }

  const handleWebDirectoryPicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return

    const first = files[0]
    const folderName = first.webkitRelativePath?.split('/')[0] || first.name
    setLibraryPath(folderName)
    setPickerNotice('Browser returned folder name only. Paste absolute path manually if needed.')
  }

  const handleSubmit = async () => {
    const trimmedPath = libraryPath.trim()
    if (!trimmedPath) {
      setErrorMessage('Library path is required.')
      return
    }

    setErrorMessage(null)
    await Promise.resolve(
      onSubmit({
        libraryPath: trimmedPath,
        mode,
        importCollections,
        collectionNames: parsedCollectionNames,
        collectionNameSuffix: collectionNameSuffix.trim(),
      }),
    )
  }

  return (
    <>
      <div
        data-preserve-sources-sidebar="true"
        className="fixed inset-0 z-40 bg-surface-base/50"
        onClick={() => !isSubmitting && onClose()}
      />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div
          data-preserve-sources-sidebar="true"
          className="pointer-events-auto w-full max-w-2xl bg-surface-raised border border-surface-border rounded-xl shadow-2xl overflow-hidden"
        >
          <div className="flex items-start justify-between gap-3 px-6 py-4 border-b border-surface-border">
            <div>
              <h3 className="text-lg font-semibold text-white">Import Library</h3>
              <p className="text-sm text-slate-400 mt-1">
                Add another library as a source, or replace your current library.
              </p>
            </div>
            <button
              onClick={onClose}
              disabled={isSubmitting}
              className="p-1 rounded text-slate-400 hover:text-white hover:bg-surface-base transition-colors disabled:opacity-50"
              aria-label="Close import modal"
            >
              <X size={18} />
            </button>
          </div>

          <div className="px-6 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
            <div className="space-y-2">
              <label className="block text-xs uppercase tracking-wide text-slate-500">
                Library Path
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={libraryPath}
                  onChange={(e) => setLibraryPath(e.target.value)}
                  placeholder="Path to exported library folder or .zip file"
                  className="flex-1 px-3 py-2 bg-surface-base border border-surface-border rounded text-sm text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary"
                />
                <button
                  onClick={() => void handleBrowse()}
                  disabled={isSubmitting}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded border border-surface-border bg-surface-overlay text-slate-200 hover:bg-surface-border transition-colors disabled:opacity-50"
                >
                  <FolderOpen size={14} />
                  Browse
                </button>
              </div>
              <p className="text-xs text-slate-500">
                ZIP files are extracted on the backend before import. The path must be accessible by the backend server.
              </p>
              {pickerNotice && <p className="text-xs text-amber-400">{pickerNotice}</p>}
            </div>

            <div className="space-y-2">
              <label className="block text-xs uppercase tracking-wide text-slate-500">
                Import Mode
              </label>
              <div className="grid gap-2 md:grid-cols-2">
                <label className="flex items-start gap-3 rounded-lg border border-surface-border bg-surface-base px-3 py-2 cursor-pointer">
                  <input
                    type="radio"
                    checked={mode === 'source'}
                    onChange={() => setMode('source')}
                    disabled={isSubmitting}
                    className="mt-1 accent-accent-primary"
                  />
                  <div>
                    <p className="text-sm text-white font-medium">Add as source</p>
                    <p className="text-xs text-slate-400">Keeps your current library and adds this as a selectable source.</p>
                  </div>
                </label>
                <label className="flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 cursor-pointer">
                  <input
                    type="radio"
                    checked={mode === 'replace'}
                    onChange={() => setMode('replace')}
                    disabled={isSubmitting}
                    className="mt-1 accent-red-500"
                  />
                  <div>
                    <p className="text-sm text-red-300 font-medium">Replace current library</p>
                    <p className="text-xs text-red-200/80">Overwrites database data and reloads the app after import.</p>
                  </div>
                </label>
              </div>
            </div>

            {mode === 'source' && (
              <div className="space-y-3 rounded-lg border border-surface-border bg-surface-base px-4 py-3">
                <label className="flex items-center gap-2 text-sm text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={importCollections}
                    onChange={(e) => setImportCollections(e.target.checked)}
                    disabled={isSubmitting}
                    className="accent-accent-primary"
                  />
                  Also import as collection(s)
                </label>
                {importCollections && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1">
                        Collection Names (optional)
                      </label>
                      <textarea
                        rows={3}
                        value={collectionNamesText}
                        onChange={(e) => setCollectionNamesText(e.target.value)}
                        disabled={isSubmitting}
                        placeholder="kicks, snares, hats"
                        className="w-full px-3 py-2 bg-surface-raised border border-surface-border rounded text-sm text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary resize-y"
                      />
                      <p className="text-xs text-slate-500 mt-1">
                        Leave empty to import all collections from that library.
                      </p>
                    </div>
                    <div>
                      <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1">
                        Optional Name Suffix
                      </label>
                      <input
                        type="text"
                        value={collectionNameSuffix}
                        onChange={(e) => setCollectionNameSuffix(e.target.value)}
                        disabled={isSubmitting}
                        placeholder="by Mike"
                        className="w-full px-3 py-2 bg-surface-raised border border-surface-border rounded text-sm text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {mode === 'replace' && (
              <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                <AlertTriangle size={16} className="mt-0.5 text-red-300 flex-shrink-0" />
                This action is destructive. The app will ask for two confirmations before replacing your current library.
              </div>
            )}

            {errorMessage && (
              <div className="text-xs text-red-400">{errorMessage}</div>
            )}
          </div>

          <div className="px-6 py-4 border-t border-surface-border bg-surface-base flex items-center justify-end gap-2">
            <button
              onClick={onClose}
              disabled={isSubmitting}
              className="px-3 py-2 rounded border border-surface-border bg-surface-overlay text-slate-300 hover:bg-surface-border transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={() => void handleSubmit()}
              disabled={isSubmitting || !libraryPath.trim()}
              className={`inline-flex items-center gap-2 px-3 py-2 rounded text-white transition-colors disabled:opacity-50 ${
                mode === 'replace'
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'bg-accent-primary hover:bg-accent-primary/90'
              }`}
            >
              {isSubmitting && <Loader2 size={14} className="animate-spin" />}
              {mode === 'replace' ? 'Replace Library' : 'Import Library Source'}
            </button>
          </div>
        </div>
      </div>

      <input
        ref={folderInputRef}
        type="file"
        // @ts-expect-error webkitdirectory is not in TS lib but works in Chromium
        webkitdirectory=""
        directory=""
        multiple
        className="hidden"
        onChange={handleWebDirectoryPicked}
      />
    </>
  )
}
