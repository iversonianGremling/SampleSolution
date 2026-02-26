export type ImportSourceKind = 'files' | 'folder'
export type ImportPhase = 'uploading' | 'processing' | 'success' | 'error'

export interface ImportProgressEntry {
  id: number
  sourceKind: ImportSourceKind
  importType: 'sample' | 'track'
  totalFiles: number | null
  phase: ImportPhase
  progressPercent: number
  uploadedBytes: number
  totalBytes: number | null
  successful: number | null
  failed: number | null
  startedAt: number
  finishedAt: number | null
  message: string | null
}

export interface ImportProgressSnapshot {
  active: ImportProgressEntry | null
  activeCount: number
  latest: ImportProgressEntry | null
}

interface StartImportProgressInput {
  sourceKind: ImportSourceKind
  importType: 'sample' | 'track'
  totalFiles: number | null
}

interface CompleteImportProgressInput {
  total?: number
  successful: number
  failed: number
}

type MutableImportProgressEntry = ImportProgressEntry

const RECENT_RESULT_VISIBLE_MS = 20_000

let nextImportProgressId = 1
const activeImports = new Map<number, MutableImportProgressEntry>()
let latestImport: MutableImportProgressEntry | null = null
let clearLatestTimerId: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<() => void>()
let snapshot: ImportProgressSnapshot = {
  active: null,
  activeCount: 0,
  latest: null,
}

function cloneEntry(entry: MutableImportProgressEntry): ImportProgressEntry {
  return { ...entry }
}

function getMostRecentActiveImport(): MutableImportProgressEntry | null {
  let latestActive: MutableImportProgressEntry | null = null
  for (const entry of activeImports.values()) {
    if (!latestActive || entry.startedAt >= latestActive.startedAt) {
      latestActive = entry
    }
  }
  return latestActive
}

function computeSnapshot(): ImportProgressSnapshot {
  return {
    active: (() => {
      const active = getMostRecentActiveImport()
      return active ? cloneEntry(active) : null
    })(),
    activeCount: activeImports.size,
    latest: latestImport ? cloneEntry(latestImport) : null,
  }
}

function notifyImportProgressListeners() {
  snapshot = computeSnapshot()
  listeners.forEach((listener) => listener())
}

function setLatestImport(entry: MutableImportProgressEntry | null) {
  latestImport = entry ? cloneEntry(entry) : null

  if (clearLatestTimerId !== null) {
    clearTimeout(clearLatestTimerId)
    clearLatestTimerId = null
  }

  if (latestImport) {
    const expectedLatestId = latestImport.id
    clearLatestTimerId = setTimeout(() => {
      if (latestImport?.id !== expectedLatestId) return
      latestImport = null
      clearLatestTimerId = null
      notifyImportProgressListeners()
    }, RECENT_RESULT_VISIBLE_MS)
  }
}

function updateEntry(
  id: number,
  updater: (entry: MutableImportProgressEntry) => void,
) {
  const entry = activeImports.get(id)
  if (!entry) return
  updater(entry)
  notifyImportProgressListeners()
}

export interface ImportProgressController {
  id: number
  markUploadProgress: (loadedBytes: number, totalBytes?: number) => void
  markProcessing: () => void
  complete: (result: CompleteImportProgressInput) => void
  fail: (error: unknown) => void
}

export function startImportProgress({
  sourceKind,
  importType,
  totalFiles,
}: StartImportProgressInput): ImportProgressController {
  const id = nextImportProgressId++
  const entry: MutableImportProgressEntry = {
    id,
    sourceKind,
    importType,
    totalFiles,
    phase: 'uploading',
    progressPercent: sourceKind === 'folder' ? 8 : 4,
    uploadedBytes: 0,
    totalBytes: null,
    successful: null,
    failed: null,
    startedAt: Date.now(),
    finishedAt: null,
    message: null,
  }

  activeImports.set(id, entry)
  notifyImportProgressListeners()

  return {
    id,
    markUploadProgress: (loadedBytes, totalBytes) => {
      updateEntry(id, (current) => {
        current.uploadedBytes = Math.max(0, loadedBytes)
        if (typeof totalBytes === 'number' && Number.isFinite(totalBytes) && totalBytes > 0) {
          current.totalBytes = totalBytes
          const uploadRatio = Math.max(0, Math.min(1, loadedBytes / totalBytes))
          current.progressPercent = Math.max(current.progressPercent, Math.round(uploadRatio * 78))
          if (uploadRatio >= 1) {
            current.phase = 'processing'
            current.progressPercent = Math.max(current.progressPercent, 82)
          } else {
            current.phase = 'uploading'
          }
          return
        }

        current.totalBytes = null
        current.progressPercent = Math.max(current.progressPercent, 10)
      })
    },
    markProcessing: () => {
      updateEntry(id, (current) => {
        current.phase = 'processing'
        current.progressPercent = Math.max(current.progressPercent, 82)
      })
    },
    complete: ({ total, successful, failed }) => {
      const current = activeImports.get(id)
      if (!current) return

      const completedEntry: MutableImportProgressEntry = {
        ...current,
        phase: 'success',
        progressPercent: 100,
        totalFiles: typeof total === 'number' ? total : current.totalFiles,
        successful,
        failed,
        finishedAt: Date.now(),
        message: null,
      }

      activeImports.delete(id)
      setLatestImport(completedEntry)
      notifyImportProgressListeners()
    },
    fail: (error) => {
      const current = activeImports.get(id)
      if (!current) return

      const errorMessage = error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : 'Import failed'

      const failedEntry: MutableImportProgressEntry = {
        ...current,
        phase: 'error',
        progressPercent: 100,
        finishedAt: Date.now(),
        message: errorMessage,
      }

      activeImports.delete(id)
      setLatestImport(failedEntry)
      notifyImportProgressListeners()
    },
  }
}

export function subscribeImportProgress(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getImportProgressSnapshot(): ImportProgressSnapshot {
  return snapshot
}
