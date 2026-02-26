import { useState, useEffect, useMemo, useRef } from 'react'
import { RefreshCw, AlertCircle, CheckCircle2, Copy, Link2, FolderOpen, ChevronDown, ChevronUp } from 'lucide-react'
import * as api from '../api/client'
import { useQuery, useQueryClient, useMutation, useQueries } from '@tanstack/react-query'
import { BackupPanel } from './BackupPanel'
import { useAppDialog } from '../hooks/useAppDialog'
import {
  isDownloadToolsUiVisible,
  isSpotdlIntegrationEnabled,
  SPOTDL_INTEGRATION_EVENT,
  SPOTDL_INTEGRATION_STORAGE_KEY,
} from '../utils/spotdlIntegration'
import { formatReanalyzeEtaLabel } from '../utils/reanalyzeEta'

const MAX_REANALYZE_CONCURRENCY = 10
const DEFAULT_REANALYZE_CONCURRENCY = 2

// Roughly calibrated from local advanced-analysis benchmarks.
const REANALYZE_REFERENCE_CPU_THREADS = 20
const REANALYZE_REFERENCE_PER_SAMPLE_MS = 24_000
const REANALYZE_STARTUP_OVERHEAD_MS = 12_000
const REANALYZE_FILENAME_TAGS_OVERHEAD = 1.08
const REANALYZE_ESTIMATE_LOW_FACTOR = 0.75
const REANALYZE_ESTIMATE_HIGH_FACTOR = 1.45
const REANALYZE_REFERENCE_CORES_PER_WORKER = 1.6
const REANALYZE_FIRST_WORKER_RAM_GB = 0.65
const REANALYZE_ADDITIONAL_WORKER_RAM_GB = 0.55
const REANALYZE_RECOMMENDED_CONCURRENCY_CPU_LOAD_TARGET = 0.85

const clampReanalyzeConcurrency = (value: number): number => {
  if (!Number.isFinite(value)) return DEFAULT_REANALYZE_CONCURRENCY
  return Math.min(MAX_REANALYZE_CONCURRENCY, Math.max(1, Math.round(value)))
}

const formatElapsedTime = (elapsedMs: number): string => {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

interface ReanalyzeEstimate {
  sampleCount: number
  cpuThreads: number
  effectiveParallelism: number
  totalMs: number
  lowMs: number
  highMs: number
}

type ReanalyzeUsageLevel = 'low' | 'moderate' | 'high' | 'extreme'

interface ReanalyzeUsageEstimate {
  cpuLoadPercent: number
  estimatedRamGb: number
  level: ReanalyzeUsageLevel
  workerToThreadRatio: number
}

interface ReanalyzeCpuTierProfile {
  id: 'i3_ryzen3' | 'i5_ryzen5' | 'i7_ryzen7' | 'workstation_high_end'
  label: string
  cpuThreads: number
  perThreadPerformanceFactor: number
}

interface ReanalyzeTierProjection {
  tier: ReanalyzeCpuTierProfile
  runtime: ReanalyzeEstimate
  usage: ReanalyzeUsageEstimate
  recommendedConcurrency: number
  recommendedRuntime: ReanalyzeEstimate
}

const REANALYZE_CPU_TIERS: ReanalyzeCpuTierProfile[] = [
  {
    id: 'i3_ryzen3',
    label: 'Intel Core i3 (6th-8th gen, 2015-2019) / AMD Ryzen 3 (1000-3000, 2017-2020)',
    cpuThreads: 4,
    perThreadPerformanceFactor: 0.55,
  },
  {
    id: 'i5_ryzen5',
    label: 'Intel Core i5 (8th-11th gen, 2017-2021) / AMD Ryzen 5 (2000-5000, 2018-2022)',
    cpuThreads: 8,
    perThreadPerformanceFactor: 0.75,
  },
  {
    id: 'i7_ryzen7',
    label: 'Intel Core i7 (10th-13th gen, 2019-2024) / AMD Ryzen 7 (3000-7000, 2019-2024)',
    cpuThreads: 12,
    perThreadPerformanceFactor: 0.95,
  },
  {
    id: 'workstation_high_end',
    label: 'AMD Threadripper / Intel Xeon W / Ryzen 9 class (2021-2025)',
    cpuThreads: 32,
    perThreadPerformanceFactor: 1.1,
  },
]

const estimateReanalyzeDuration = (
  sampleCount: number,
  requestedConcurrency: number,
  cpuThreads: number,
  includeFilenameTags: boolean,
  perThreadPerformanceFactor = 1,
): ReanalyzeEstimate => {
  const safeSampleCount = Math.max(0, Math.floor(sampleCount))
  const safeCpuThreads = Math.max(1, Math.round(cpuThreads))
  const safeConcurrency = clampReanalyzeConcurrency(requestedConcurrency)
  const safePerThreadPerformanceFactor = Math.max(0.25, Math.min(1.6, perThreadPerformanceFactor))
  const maxUsefulWorkers = Math.max(1, safeSampleCount)
  const effectiveParallelism = Math.max(1, Math.min(safeConcurrency, maxUsefulWorkers))

  const cpuPowerFactor = Math.max(
    0.25,
    Math.min(2.5, (safeCpuThreads / REANALYZE_REFERENCE_CPU_THREADS) * safePerThreadPerformanceFactor),
  )
  const perSampleMs = REANALYZE_REFERENCE_PER_SAMPLE_MS / cpuPowerFactor
  const filenameMultiplier = includeFilenameTags ? REANALYZE_FILENAME_TAGS_OVERHEAD : 1
  const workerToThreadRatio = effectiveParallelism / safeCpuThreads
  const oversubscriptionPenalty = workerToThreadRatio > 1 ? 1 + (workerToThreadRatio - 1) * 0.55 : 1
  const spawnOverheadMs = Math.max(0, effectiveParallelism - 1) * 450
  const processingMs = ((safeSampleCount * perSampleMs) / effectiveParallelism) * filenameMultiplier * oversubscriptionPenalty
  const totalMs = safeSampleCount > 0 ? REANALYZE_STARTUP_OVERHEAD_MS + spawnOverheadMs + processingMs : 0

  return {
    sampleCount: safeSampleCount,
    cpuThreads: safeCpuThreads,
    effectiveParallelism,
    totalMs,
    lowMs: totalMs * REANALYZE_ESTIMATE_LOW_FACTOR,
    highMs: totalMs * REANALYZE_ESTIMATE_HIGH_FACTOR,
  }
}

const formatEstimateRange = (estimate: ReanalyzeEstimate): string => {
  if (estimate.sampleCount <= 0) return 'a few seconds'
  return `${formatElapsedTime(estimate.lowMs)} - ${formatElapsedTime(estimate.highMs)}`
}

const formatSampleCountLabel = (count: number): string => {
  return `${count} sample${count === 1 ? '' : 's'}`
}

const formatProcessCountLabel = (count: number): string => {
  return `${count} process${count === 1 ? '' : 'es'}`
}

const getCpuTierShortLabel = (tierId: ReanalyzeCpuTierProfile['id']): string => {
  switch (tierId) {
    case 'i3_ryzen3':
      return 'i3 / Ryzen 3'
    case 'i5_ryzen5':
      return 'i5 / Ryzen 5'
    case 'i7_ryzen7':
      return 'i7 / Ryzen 7'
    case 'workstation_high_end':
      return 'Workstation'
    default:
      return 'CPU tier'
  }
}

const getUsageLevelBadgeClass = (level: ReanalyzeUsageLevel): string => {
  switch (level) {
    case 'extreme':
      return 'border-red-500/40 bg-red-500/15 text-red-300'
    case 'high':
      return 'border-amber-500/40 bg-amber-500/15 text-amber-300'
    case 'moderate':
      return 'border-sky-500/40 bg-sky-500/15 text-sky-300'
    case 'low':
    default:
      return 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
  }
}

const recommendConcurrencyForCpu = (sampleCount: number, cpuThreads: number): number => {
  const safeSampleCount = Math.max(1, Math.floor(sampleCount))
  const safeCpuThreads = Math.max(1, Math.floor(cpuThreads))
  const maxWorkersByCpu = Math.max(
    1,
    Math.floor((safeCpuThreads * REANALYZE_RECOMMENDED_CONCURRENCY_CPU_LOAD_TARGET) / REANALYZE_REFERENCE_CORES_PER_WORKER),
  )
  return Math.min(MAX_REANALYZE_CONCURRENCY, safeSampleCount, maxWorkersByCpu)
}

const estimateReanalyzeUsage = (effectiveParallelism: number, cpuThreads: number): ReanalyzeUsageEstimate => {
  const workers = Math.max(1, Math.floor(effectiveParallelism))
  const safeCpuThreads = Math.max(1, Math.floor(cpuThreads))
  const workerToThreadRatio = workers / safeCpuThreads

  const cpuLoadPercent = Math.min(
    100,
    ((workers * REANALYZE_REFERENCE_CORES_PER_WORKER) / safeCpuThreads) * 100,
  )
  const estimatedRamGb = REANALYZE_FIRST_WORKER_RAM_GB + Math.max(0, workers - 1) * REANALYZE_ADDITIONAL_WORKER_RAM_GB

  let level: ReanalyzeUsageLevel = 'low'
  if (cpuLoadPercent >= 85 || estimatedRamGb >= 8 || workerToThreadRatio >= 1.5) {
    level = 'extreme'
  } else if (cpuLoadPercent >= 65 || estimatedRamGb >= 5 || workerToThreadRatio >= 1.15) {
    level = 'high'
  } else if (cpuLoadPercent >= 40 || estimatedRamGb >= 3) {
    level = 'moderate'
  }

  return {
    cpuLoadPercent,
    estimatedRamGb,
    level,
    workerToThreadRatio,
  }
}

const buildTierProjection = (
  sampleCount: number,
  requestedConcurrency: number,
  includeFilenameTags: boolean,
  tier: ReanalyzeCpuTierProfile,
): ReanalyzeTierProjection => {
  const runtime = estimateReanalyzeDuration(
    sampleCount,
    requestedConcurrency,
    tier.cpuThreads,
    includeFilenameTags,
    tier.perThreadPerformanceFactor,
  )
  const usage = estimateReanalyzeUsage(runtime.effectiveParallelism, tier.cpuThreads)
  const recommendedConcurrency = recommendConcurrencyForCpu(sampleCount, tier.cpuThreads)
  const recommendedRuntime = estimateReanalyzeDuration(
    sampleCount,
    recommendedConcurrency,
    tier.cpuThreads,
    includeFilenameTags,
    tier.perThreadPerformanceFactor,
  )

  return {
    tier,
    runtime,
    usage,
    recommendedConcurrency,
    recommendedRuntime,
  }
}

const buildTierProjections = (
  sampleCount: number,
  requestedConcurrency: number,
  includeFilenameTags: boolean,
): ReanalyzeTierProjection[] => {
  return REANALYZE_CPU_TIERS.map((tier) => buildTierProjection(sampleCount, requestedConcurrency, includeFilenameTags, tier))
}

const isRequestAbortError = (error: unknown): boolean => {
  if (!error) return false

  if (error instanceof DOMException && error.name === 'AbortError') {
    return true
  }

  if (error instanceof Error) {
    const name = error.name.toLowerCase()
    const message = error.message.toLowerCase()
    return (
      name === 'aborterror' ||
      name === 'cancelederror' ||
      message.includes('aborted') ||
      message.includes('canceled') ||
      message.includes('cancelled')
    )
  }

  const maybe = error as { code?: string; name?: string }
  return maybe.code === 'ERR_CANCELED' || maybe.name === 'CanceledError'
}

const getApiErrorMessage = (error: unknown, fallback: string): string => {
  if (!error) return fallback

  if (error instanceof Error) {
    const maybeResponse = (error as Error & {
      response?: {
        data?: unknown
      }
    }).response

    if (maybeResponse && typeof maybeResponse.data === 'object' && maybeResponse.data) {
      const errorText = (maybeResponse.data as { error?: unknown }).error
      if (typeof errorText === 'string' && errorText.trim()) {
        return errorText.trim()
      }
    }

    return error.message || fallback
  }

  return fallback
}

const formatBytesCompact = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** exponent
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`
}

const ROLLBACK_SNAPSHOT_ENABLED_KEY = 'backup-rollback-snapshot-enabled-v1'
const ROLLBACK_SNAPSHOT_EXPORT_PATH_KEY = 'backup-rollback-snapshot-export-path-v1'
const ROLLBACK_SNAPSHOT_HISTORY_KEY = 'backup-rollback-snapshot-history-v1'
const RCLONE_SNAPSHOT_MODE_KEY = 'rclone-share-snapshot-mode-v1'
const RCLONE_QUICK_RECEIVE_TARGET_KEY = 'rclone-share-quick-receive-target-v1'
const QUICK_SHARE_CODE_LENGTH = 8
const QUICK_SHARE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const QUICK_SHARE_LIBRARY_PREFIX = 'peer'

type QuickShareScope = 'library' | 'collections'

interface QuickShareMetadata {
  code: string
  scope: QuickShareScope
  collections: string[]
}

function normalizeQuickShareCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, QUICK_SHARE_CODE_LENGTH)
}

function formatQuickShareCode(value: string): string {
  const normalized = normalizeQuickShareCode(value)
  if (normalized.length <= 4) return normalized
  return `${normalized.slice(0, 4)}-${normalized.slice(4)}`
}

function generateQuickShareCode(): string {
  const cryptoApi = typeof window !== 'undefined' ? window.crypto : undefined
  if (cryptoApi?.getRandomValues) {
    const bytes = new Uint8Array(QUICK_SHARE_CODE_LENGTH)
    cryptoApi.getRandomValues(bytes)
    return Array.from(bytes, (value) => QUICK_SHARE_CODE_ALPHABET[value % QUICK_SHARE_CODE_ALPHABET.length]).join('')
  }

  return Array.from({ length: QUICK_SHARE_CODE_LENGTH }, () => {
    const index = Math.floor(Math.random() * QUICK_SHARE_CODE_ALPHABET.length)
    return QUICK_SHARE_CODE_ALPHABET[index]
  }).join('')
}

function buildQuickShareLibraryName(code: string): string {
  const normalized = normalizeQuickShareCode(code)
  return `${QUICK_SHARE_LIBRARY_PREFIX}-${normalized.toLowerCase()}`
}

function parseCollectionNamesCsv(value: string): string[] {
  const seen = new Set<string>()
  const names: string[] = []

  for (const part of value.split(',')) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    names.push(trimmed)
  }

  return names
}

function buildQuickShareNote(metadata: QuickShareMetadata): string {
  const encodedCollections = encodeURIComponent(metadata.collections.join(','))
  return [
    'quick-share',
    `code=${normalizeQuickShareCode(metadata.code)}`,
    `scope=${metadata.scope}`,
    `collections=${encodedCollections}`,
  ].join('|')
}

function parseQuickShareNote(note: string | null | undefined): QuickShareMetadata | null {
  if (!note || !note.trim()) return null

  const parts = note.split('|')
  if (parts[0] !== 'quick-share') return null

  const map = new Map<string, string>()
  for (const part of parts.slice(1)) {
    const separatorIndex = part.indexOf('=')
    if (separatorIndex <= 0) continue
    const key = part.slice(0, separatorIndex).trim()
    const value = part.slice(separatorIndex + 1).trim()
    if (!key) continue
    map.set(key, value)
  }

  const normalizedCode = normalizeQuickShareCode(map.get('code') ?? '')
  if (normalizedCode.length !== QUICK_SHARE_CODE_LENGTH) return null

  const scope = map.get('scope') === 'collections' ? 'collections' : 'library'
  const rawCollections = map.get('collections') ?? ''
  let decodedCollections = ''
  if (rawCollections) {
    try {
      decodedCollections = decodeURIComponent(rawCollections)
    } catch {
      decodedCollections = rawCollections
    }
  }
  const collections = parseCollectionNamesCsv(decodedCollections)

  return {
    code: normalizedCode,
    scope,
    collections,
  }
}

function getLatestShareVersion(library: api.RcloneShareLibraryInfo | undefined): api.RcloneShareVersionInfo | null {
  if (!library || library.versions.length === 0) return null

  if (library.latest) {
    const exact = library.versions.find((entry) => entry.version === library.latest)
    if (exact) return exact
  }

  return library.versions[library.versions.length - 1] ?? null
}

interface RollbackSnapshotRecord {
  id: string
  createdAt: string
  path: string
  estimatedBytes: number | null
}

function readRollbackSnapshotHistory(): RollbackSnapshotRecord[] {
  try {
    const raw = localStorage.getItem(ROLLBACK_SNAPSHOT_HISTORY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => {
        const record = entry as Partial<RollbackSnapshotRecord>
        return {
          id: String(record.id ?? Date.now()),
          createdAt: typeof record.createdAt === 'string' ? record.createdAt : new Date().toISOString(),
          path: typeof record.path === 'string' ? record.path : '',
          estimatedBytes: typeof record.estimatedBytes === 'number' && Number.isFinite(record.estimatedBytes)
            ? record.estimatedBytes
            : null,
        }
      })
      .filter((entry) => entry.path.trim().length > 0)
      .slice(0, 40)
  } catch {
    return []
  }
}

function formatSnapshotTimestamp(iso: string): string {
  const value = new Date(iso)
  if (Number.isNaN(value.getTime())) return iso
  return value.toLocaleString()
}

function buildSnapshotVersionLabel(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  const year = date.getFullYear()
  const month = pad(date.getMonth() + 1)
  const day = pad(date.getDate())
  const hours = pad(date.getHours())
  const minutes = pad(date.getMinutes())
  return `snapshot-${year}${month}${day}-${hours}${minutes}`
}

function getLatestSuccessfulLogBytes(logs: api.BackupLog[]): number {
  for (const log of logs) {
    if (log.status !== 'success') continue

    let detailsBytes = 0
    if (typeof log.details_json === 'string' && log.details_json.trim()) {
      try {
        const parsed = JSON.parse(log.details_json) as { dataBytesAdded?: unknown; dataBytesProcessed?: unknown }
        if (typeof parsed.dataBytesAdded === 'number' && Number.isFinite(parsed.dataBytesAdded) && parsed.dataBytesAdded > 0) {
          detailsBytes = parsed.dataBytesAdded
        } else if (typeof parsed.dataBytesProcessed === 'number' && Number.isFinite(parsed.dataBytesProcessed) && parsed.dataBytesProcessed > 0) {
          detailsBytes = parsed.dataBytesProcessed
        }
      } catch {
        // ignore malformed details
      }
    }

    const fallbackBytes = typeof log.bytes_transferred === 'number' && Number.isFinite(log.bytes_transferred)
      ? Math.max(0, log.bytes_transferred)
      : 0
    const bestGuess = Math.max(detailsBytes, fallbackBytes)
    if (bestGuess > 0) return bestGuess
  }

  return 0
}

function BackupTransferSection() {
  const { confirm, dialogNode } = useAppDialog()
  const [importPath, setImportPath] = useState('')
  const [snapshotEnabled, setSnapshotEnabled] = useState(() => localStorage.getItem(ROLLBACK_SNAPSHOT_ENABLED_KEY) !== 'false')
  const [snapshotExportPath, setSnapshotExportPath] = useState(() => localStorage.getItem(ROLLBACK_SNAPSHOT_EXPORT_PATH_KEY) ?? '')
  const [snapshotHistory, setSnapshotHistory] = useState<RollbackSnapshotRecord[]>(() => readRollbackSnapshotHistory())
  const [pickerNotice, setPickerNotice] = useState<string | null>(null)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [isImportingBackup, setIsImportingBackup] = useState(false)
  const importDirInputRef = useRef<HTMLInputElement>(null)
  const snapshotDirInputRef = useRef<HTMLInputElement>(null)

  const { data: backupStatusForEstimate } = useQuery<api.BackupStatus>({
    queryKey: ['backupStatus', 'rollback-estimate'],
    queryFn: async () => {
      try {
        return await api.getBackupStatus()
      } catch {
        try {
          const configs = await api.getBackupConfigs()
          return { configs, rcloneAvailable: false }
        } catch {
          return { configs: [], rcloneAvailable: false }
        }
      }
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })

  const snapshotLogQueries = useQueries({
    queries: (backupStatusForEstimate?.configs ?? []).map((config) => ({
      queryKey: ['backupLogs', 'rollback-estimate', config.id],
      queryFn: () => api.getBackupLogs(config.id, 10),
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    })),
  })

  const snapshotEstimateBytes = useMemo(() => {
    let maxBytes = 0
    for (const query of snapshotLogQueries) {
      const logs = Array.isArray(query.data) ? query.data : []
      maxBytes = Math.max(maxBytes, getLatestSuccessfulLogBytes(logs))
    }
    return maxBytes > 0 ? maxBytes : null
  }, [snapshotLogQueries])

  const trackedSnapshotBytes = useMemo(
    () => snapshotHistory.reduce((sum, entry) => sum + (entry.estimatedBytes ?? 0), 0),
    [snapshotHistory],
  )

  const hasSnapshotsWithUnknownSize = useMemo(
    () => snapshotHistory.some((entry) => entry.estimatedBytes === null),
    [snapshotHistory],
  )

  useEffect(() => {
    localStorage.setItem(ROLLBACK_SNAPSHOT_ENABLED_KEY, String(snapshotEnabled))
  }, [snapshotEnabled])

  useEffect(() => {
    const normalized = snapshotExportPath.trim()
    if (!normalized) {
      localStorage.removeItem(ROLLBACK_SNAPSHOT_EXPORT_PATH_KEY)
      return
    }
    localStorage.setItem(ROLLBACK_SNAPSHOT_EXPORT_PATH_KEY, normalized)
  }, [snapshotExportPath])

  useEffect(() => {
    localStorage.setItem(ROLLBACK_SNAPSHOT_HISTORY_KEY, JSON.stringify(snapshotHistory.slice(0, 40)))
  }, [snapshotHistory])

  const downloadBackup = (includeAudio: boolean) => {
    const url = api.getBackupDownloadUrl(includeAudio)
    window.open(url, '_blank')
  }

  const openBrowse = async (target: 'import' | 'snapshot') => {
    setPickerNotice(null)
    const currentPath = target === 'import' ? importPath : snapshotExportPath
    const initialPath = currentPath.trim() || undefined

    if (target === 'import' && window.electron?.selectImportPath) {
      try {
        const selected = await window.electron.selectImportPath({
          defaultPath: initialPath,
          title: 'Select backup folder or ZIP file',
        })
        if (selected) setImportPath(selected)
        return
      } catch {
        // continue with folder picker fallback
      }
    }

    if (window.electron?.selectDirectory) {
      try {
        const selected = await window.electron.selectDirectory({
          defaultPath: initialPath,
          title: target === 'import' ? 'Select backup folder to import' : 'Select undo backup folder',
        })
        if (selected) {
          if (target === 'import') setImportPath(selected)
          if (target === 'snapshot') setSnapshotExportPath(selected)
        }
        return
      } catch {
        // continue with browser fallbacks
      }
    }

    if (target === 'import') {
      try {
        const maybeShowOpenFilePicker = (
          window as unknown as { showOpenFilePicker?: (options?: unknown) => Promise<Array<{ name?: string }>> }
        ).showOpenFilePicker
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
            setImportPath(fileName)
            setPickerNotice('Browser returned file name only. If needed, paste absolute path manually (or use Electron app).')
            return
          }
        }
      } catch {
        // canceled or unavailable
      }
    }

    try {
      const maybeShowDirectoryPicker = (window as unknown as { showDirectoryPicker?: () => Promise<{ name?: string }> }).showDirectoryPicker
      if (typeof maybeShowDirectoryPicker === 'function') {
        const handle = await maybeShowDirectoryPicker()
        if (handle?.name) {
          if (target === 'import') setImportPath(handle.name)
          if (target === 'snapshot') setSnapshotExportPath(handle.name)
          setPickerNotice('Browser returned folder name only. If needed, paste absolute path manually (or use Electron app).')
          return
        }
      }
    } catch {
      // canceled or unavailable
    }

    if (target === 'import') importDirInputRef.current?.click()
    if (target === 'snapshot') snapshotDirInputRef.current?.click()
  }

  const handleWebDirectoryPicked = (target: 'import' | 'snapshot', e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return

    const folderName = files[0].webkitRelativePath?.split('/')[0] || files[0].name
    if (target === 'import') setImportPath(folderName)
    if (target === 'snapshot') setSnapshotExportPath(folderName)
    setPickerNotice('Browser returned folder name only. If needed, paste absolute path manually (or use Electron app).')
  }

  const handleImportBackup = async () => {
    const trimmedImportPath = importPath.trim()
    if (!trimmedImportPath) return

    const firstConfirmed = await confirm({
      title: 'Import Backup',
      message: snapshotEnabled
        ? 'Importing will replace your current library. A backup will be saved first so you can undo changes if needed. Continue?'
        : 'Importing will replace your current library. Continue?',
      confirmText: 'Continue',
      cancelText: 'Cancel',
      isDestructive: true,
    })
    if (!firstConfirmed) return

    const secondConfirmed = await confirm({
      title: 'Final Confirmation',
      message: 'Final check: import this backup and replace your current library now?',
      confirmText: 'Import and Replace',
      cancelText: 'Cancel',
      isDestructive: true,
    })
    if (!secondConfirmed) return

    setIsImportingBackup(true)
    setActionError(null)
    setActionMessage(null)

    try {
      if (snapshotEnabled) {
        const snapshotResult = await api.exportLibrary(snapshotExportPath.trim() || undefined)
        const record: RollbackSnapshotRecord = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
          createdAt: new Date().toISOString(),
          path: snapshotResult.exportPath,
          estimatedBytes: snapshotEstimateBytes,
        }
        setSnapshotHistory((previous) => [record, ...previous].slice(0, 40))
        setActionMessage(`Undo backup saved to ${snapshotResult.exportPath}.`)
      }

      await api.importLibrary(trimmedImportPath, { mode: 'replace' })
      window.location.reload()
    } catch (error) {
      setActionError(getApiErrorMessage(error, 'Failed to import backup.'))
    } finally {
      setIsImportingBackup(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-sm font-medium text-white mb-2">Download / Upload Backup</h4>
        <p className="text-sm text-slate-400">
          Download a backup ZIP, then import the ZIP path (or extracted folder) to replace this instance.
        </p>
      </div>

      <div className="bg-surface-base border border-surface-border rounded-lg p-4 space-y-3">
        <div className="text-sm font-medium text-white">Download Backup ZIP</div>
        <p className="text-xs text-slate-500">Create a browser download of your current app data.</p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => downloadBackup(false)}
            className="px-3 py-2 text-xs bg-surface-raised border border-surface-border rounded hover:border-accent-primary/50 text-slate-300 transition-colors"
          >
            Download (app data + samples)
          </button>
          <button
            onClick={() => downloadBackup(true)}
            className="px-3 py-2 text-xs bg-surface-raised border border-surface-border rounded hover:border-accent-primary/50 text-slate-300 transition-colors"
          >
            Download (include source audio)
          </button>
        </div>
      </div>

      <div className="bg-surface-base border border-surface-border rounded-lg p-4 space-y-3">
        <div className="text-sm font-medium text-white">Import Backup</div>
        <input
          type="text"
          value={importPath}
          onChange={(e) => setImportPath(e.target.value)}
          placeholder="Path to backup folder or .zip file"
          className="w-full px-3 py-2 bg-surface-raised border border-surface-border rounded text-sm text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary"
        />
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => openBrowse('import')}
            className="inline-flex items-center gap-2 px-3 py-2 rounded text-xs font-medium bg-surface-raised hover:bg-surface-overlay text-slate-200 border border-surface-border transition-colors"
            type="button"
          >
            <FolderOpen size={14} />
            Browse
          </button>
          <button
            onClick={handleImportBackup}
            disabled={isImportingBackup || !importPath.trim()}
            className={`inline-flex items-center gap-2 px-3 py-2 rounded text-sm font-medium transition-colors ${
              isImportingBackup || !importPath.trim()
                ? 'bg-surface-overlay text-slate-500 cursor-not-allowed'
                : 'bg-accent-primary hover:bg-accent-primary/90 text-white'
            }`}
          >
            <Link2 size={14} />
            {isImportingBackup ? 'Importing...' : 'Import Backup'}
          </button>
        </div>
        <p className="text-xs text-slate-500">
          Supports a backup folder or a downloaded backup ZIP. ZIP files are extracted on the backend before import.
        </p>
        <p className="text-xs text-slate-500">The path must be accessible from the backend server.</p>
        <p className="text-xs text-amber-400">Import will replace what you currently have in this app.</p>
      </div>

      <div className="bg-surface-base rounded-lg p-4 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="text-sm font-medium text-white">Undo Changes (optional)</div>
            <p className="text-xs text-slate-400 max-w-xl">
              Make backups so you can undo changes after importing.
            </p>
          </div>
          <label className="inline-flex items-center gap-2 rounded-full border border-surface-border bg-surface-raised/70 px-2 py-1.5 text-xs text-slate-200 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={snapshotEnabled}
              onChange={(e) => setSnapshotEnabled(e.target.checked)}
              className="sr-only peer"
            />
            <span
              aria-hidden="true"
              className="
                relative h-5 w-9 rounded-full border border-surface-border bg-surface-base transition-colors
                after:content-[''] after:absolute after:left-[2px] after:top-[2px] after:h-3.5 after:w-3.5 after:rounded-full after:bg-slate-400 after:transition-all after:duration-200
                peer-checked:border-accent-primary/50 peer-checked:bg-accent-primary/25 peer-checked:after:translate-x-4 peer-checked:after:bg-accent-primary
                peer-focus-visible:ring-2 peer-focus-visible:ring-accent-primary/40
              "
            />
            <span className="min-w-7">{snapshotEnabled ? 'On' : 'Off'}</span>
          </label>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-3">
          <div className="space-y-2">
            <label className="block text-xs text-slate-400">Undo backup folder (optional)</label>
            <div className="flex flex-wrap sm:flex-nowrap gap-2">
              <input
                type="text"
                value={snapshotExportPath}
                onChange={(e) => setSnapshotExportPath(e.target.value)}
                placeholder="Use default backup folder"
                className="flex-1 px-3 py-2 bg-surface-raised border border-surface-border rounded text-sm text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary"
              />
              <button
                onClick={() => openBrowse('snapshot')}
                className="inline-flex items-center gap-1 px-3 py-2 rounded text-xs font-medium bg-surface-raised hover:bg-surface-overlay text-slate-200 border border-surface-border transition-colors"
                type="button"
              >
                <FolderOpen size={13} />
                Browse
              </button>
            </div>
            <p className="text-xs text-slate-500">Leave this blank to use the app default location.</p>
          </div>

          <div className="rounded border border-surface-border bg-surface-raised p-3 space-y-2">
            <p className="text-xs text-slate-500">Undo backup summary</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
              <div className="rounded border border-surface-border/70 bg-surface-base px-2.5 py-2">
                <p className="text-slate-500">Typical backup size</p>
                <p className="text-slate-200 mt-0.5">
                  {snapshotEstimateBytes ? formatBytesCompact(snapshotEstimateBytes) : 'Estimating after first backup'}
                </p>
              </div>
              <div className="rounded border border-surface-border/70 bg-surface-base px-2.5 py-2">
                <p className="text-slate-500">Backups saved</p>
                <p className="text-slate-200 mt-0.5">{snapshotHistory.length}</p>
              </div>
              <div className="rounded border border-surface-border/70 bg-surface-base px-2.5 py-2">
                <p className="text-slate-500">Space used</p>
                <p className="text-slate-200 mt-0.5">{trackedSnapshotBytes > 0 ? formatBytesCompact(trackedSnapshotBytes) : '0 B'}</p>
              </div>
            </div>
            {hasSnapshotsWithUnknownSize && (
              <p className="text-[11px] text-amber-300">Some older copies are missing size details, so this total may be low.</p>
            )}
          </div>
        </div>

        {snapshotHistory.length > 0 && (
          <div className="pt-1 space-y-2">
            <p className="text-xs text-slate-400 font-medium">Recent undo backups</p>
            {snapshotHistory.slice(0, 5).map((entry) => (
              <div
                key={entry.id}
                className="text-xs text-slate-500 bg-surface-raised border border-surface-border rounded px-2.5 py-2 space-y-1"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-slate-300">{formatSnapshotTimestamp(entry.createdAt)}</span>
                  <span>{entry.estimatedBytes ? formatBytesCompact(entry.estimatedBytes) : 'Size not available yet'}</span>
                </div>
                <div className="break-all">{entry.path}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {pickerNotice && (
        <div className="text-xs text-amber-400">{pickerNotice}</div>
      )}

      {actionMessage && (
        <div className="p-3 bg-green-500/10 border border-green-500/30 rounded text-xs text-green-300">
          {actionMessage}
        </div>
      )}

      {actionError && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-300">
          {actionError}
        </div>
      )}

      <input
        ref={importDirInputRef}
        type="file"
        // @ts-expect-error webkitdirectory is not in TS lib but supported in Chromium
        webkitdirectory=""
        directory=""
        multiple
        className="hidden"
        onChange={(e) => handleWebDirectoryPicked('import', e)}
      />
      <input
        ref={snapshotDirInputRef}
        type="file"
        // @ts-expect-error webkitdirectory is not in TS lib but supported in Chromium
        webkitdirectory=""
        directory=""
        multiple
        className="hidden"
        onChange={(e) => handleWebDirectoryPicked('snapshot', e)}
      />
      {dialogNode}
    </div>
  )
}

type ToastKind = 'warning' | 'success' | 'error'
type UpdateTool = 'ytdlp' | 'spotdl'
type UpdateStatus = 'running' | 'success' | 'error' | 'stopped' | null

interface ReanalyzeBottomProgress {
  isActive: boolean
  isStopping: boolean
  elapsedMs: number
  total: number | null
  processed: number
  analyzed: number
  failed: number
  progressPercent: number
  etaLabel: string | null
  parallelism: number
  statusNote: string | null
  error: string | null
  onStop: () => void
}

interface BackendToolsUpdateSectionProps {
  reanalyzeProgress: ReanalyzeBottomProgress
}

const getToolDisplayName = (tool: UpdateTool | null): string => {
  if (tool === 'ytdlp') return 'yt-dlp'
  if (tool === 'spotdl') return 'spotdl'
  return 'tools'
}

function BackendToolsUpdateSection({ reanalyzeProgress }: BackendToolsUpdateSectionProps) {
  const [updateLog, setUpdateLog] = useState('')
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>(null)
  const [activeTool, setActiveTool] = useState<UpdateTool | null>(null)
  const [isLogOpen, setIsLogOpen] = useState(false)
  const [isStoppingUpdate, setIsStoppingUpdate] = useState(false)
  const [toast, setToast] = useState<{ kind: ToastKind; message: string } | null>(null)
  const [spotdlEnabled, setSpotdlEnabledState] = useState(() => isSpotdlIntegrationEnabled())
  const lastToastKeyRef = useRef('')
  const logRef = useRef<HTMLPreElement>(null)
  const updateAbortRef = useRef<AbortController | null>(null)

  const {
    data: versions,
    isLoading,
    isFetching,
    refetch,
  } = useQuery<api.ToolVersions>({
    queryKey: ['tool-versions'],
    queryFn: api.getToolVersions,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })

  const updateYtdlpMutation = useMutation({
    mutationFn: api.streamYtdlpUpdate,
  })

  const updateSpotdlMutation = useMutation({
    mutationFn: api.streamSpotdlUpdate,
  })

  const hasYtdlpUpdate =
    Boolean(versions?.ytdlp.current) &&
    Boolean(versions?.ytdlp.latest) &&
    !String(versions?.ytdlp.current).includes(String(versions?.ytdlp.latest))

  const hasSpotdlUpdate =
    spotdlEnabled &&
    Boolean(versions?.spotdl.current) &&
    Boolean(versions?.spotdl.latest) &&
    !String(versions?.spotdl.current).includes(String(versions?.spotdl.latest))

  const outdatedCount = Number(hasYtdlpUpdate) + Number(hasSpotdlUpdate)

  const isUpdating = updateYtdlpMutation.isPending || updateSpotdlMutation.isPending
  const hasLogContent = updateLog.trim().length > 0
  const hasUpdatePanelContent = isUpdating || hasLogContent || Boolean(activeTool)
  const runningTool: UpdateTool | null = updateYtdlpMutation.isPending
    ? 'ytdlp'
    : updateSpotdlMutation.isPending
      ? 'spotdl'
      : activeTool
  const statusText = isUpdating
    ? `Updating ${getToolDisplayName(runningTool)}...`
    : updateStatus === 'error'
      ? 'Update failed'
      : updateStatus === 'stopped'
        ? 'Update stopped'
      : updateStatus === 'success'
        ? 'Update completed'
        : 'Ready'
  const statusClassName = isUpdating
    ? 'text-accent-primary'
    : updateStatus === 'error'
      ? 'text-red-400'
      : updateStatus === 'stopped'
        ? 'text-amber-300'
      : updateStatus === 'success'
        ? 'text-green-400'
        : 'text-slate-400'

  const handleUpdate = async (tool: UpdateTool) => {
    if (isUpdating) return
    if (tool === 'spotdl' && !spotdlEnabled) return
    const toolLabel = getToolDisplayName(tool)
    const startedAt = new Date().toLocaleTimeString()
    const abortController = new AbortController()

    setActiveTool(tool)
    setUpdateStatus('running')
    setIsStoppingUpdate(false)
    setIsLogOpen(true)
    updateAbortRef.current = abortController
    setUpdateLog((current) => {
      const prefix = current.trim().length > 0 ? `${current}\n\n` : ''
      return `${prefix}=== ${toolLabel} update (${startedAt}) ===\n`
    })

    try {
      if (tool === 'ytdlp') {
        await updateYtdlpMutation.mutateAsync({
          onChunk: (chunk) => {
            setUpdateLog((current) => current + chunk)
          },
          signal: abortController.signal,
        })
      } else {
        await updateSpotdlMutation.mutateAsync({
          onChunk: (chunk) => {
            setUpdateLog((current) => current + chunk)
          },
          signal: abortController.signal,
        })
      }

      setUpdateStatus('success')
      await refetch()
      setToast({ kind: 'success', message: `${toolLabel} updated.` })
    } catch (error) {
      if (isRequestAbortError(error)) {
        setUpdateStatus('stopped')
        setUpdateLog((current) => `${current}\nStopped by user.\n`)
        setToast({ kind: 'warning', message: `${toolLabel} update stopped.` })
        return
      }
      const message = error instanceof Error ? error.message : `Failed to update ${toolLabel}`
      setUpdateStatus('error')
      setUpdateLog((current) => `${current}\nError: ${message}\n`)
      setToast({ kind: 'error', message })
    } finally {
      updateAbortRef.current = null
      setIsStoppingUpdate(false)
    }
  }

  const handleStopUpdate = () => {
    if (!isUpdating) return
    setIsStoppingUpdate(true)
    updateAbortRef.current?.abort()
  }

  const isReanalyzingInPanel = reanalyzeProgress.isActive
  const hasReanalyzeReachedCompletion =
    reanalyzeProgress.isActive &&
    !reanalyzeProgress.isStopping &&
    reanalyzeProgress.progressPercent >= 100
  const panelMode: 'update' | 'reanalyze' | null = isUpdating
    ? 'update'
    : isReanalyzingInPanel
      ? 'reanalyze'
      : hasUpdatePanelContent
        ? 'update'
        : null
  const showBottomLogBar = panelMode !== null

  const reanalyzeStatusText = hasReanalyzeReachedCompletion
    ? 'Library successfully analyzed'
    : reanalyzeProgress.isActive
      ? reanalyzeProgress.isStopping
        ? 'Stopping re-analysis...'
        : `Re-analyzing samples... ${reanalyzeProgress.progressPercent}%${reanalyzeProgress.etaLabel ? ` (ETA ${reanalyzeProgress.etaLabel})` : ''}`
      : reanalyzeProgress.error
        ? 'Re-analysis failed'
        : reanalyzeProgress.statusNote
          ? reanalyzeProgress.statusNote
          : 'Ready'

  const reanalyzeStatusClassName = hasReanalyzeReachedCompletion
    ? 'text-green-300'
    : reanalyzeProgress.isActive
      ? reanalyzeProgress.isStopping
        ? 'text-amber-300'
        : 'text-accent-primary'
      : reanalyzeProgress.error
        ? 'text-red-400'
        : reanalyzeProgress.statusNote
          ? 'text-amber-300'
          : 'text-slate-400'

  const reanalyzeDetails = [
    hasReanalyzeReachedCompletion
      ? `Library successfully analyzed (processed: ${reanalyzeProgress.processed}/${reanalyzeProgress.total ?? '...'}, analyzed: ${reanalyzeProgress.analyzed}, failed: ${reanalyzeProgress.failed}, elapsed: ${formatElapsedTime(reanalyzeProgress.elapsedMs)})`
      : `Analyzing samples (processed: ${reanalyzeProgress.processed}/${reanalyzeProgress.total ?? '...'}, analyzed: ${reanalyzeProgress.analyzed}, failed: ${reanalyzeProgress.failed}, progress: ${reanalyzeProgress.progressPercent}%, parallelism: ${reanalyzeProgress.parallelism}, elapsed: ${formatElapsedTime(reanalyzeProgress.elapsedMs)}, eta: ${reanalyzeProgress.etaLabel ?? 'n/a'})`,
    hasReanalyzeReachedCompletion
      ? 'Finishing final audit and cleanup...'
      : reanalyzeProgress.isStopping
        ? 'Stopping analysis and terminating active workers...'
        : `Running advanced feature extraction and tag refresh across your library. It might seem frozen, it's normal.`,
    reanalyzeProgress.statusNote ? `Note: ${reanalyzeProgress.statusNote}` : '',
    reanalyzeProgress.error ? `Error: ${reanalyzeProgress.error}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  const panelTitle = panelMode === 'update' ? 'Update Progress' : 'Re-analysis Progress'
  const panelSubtitle =
    panelMode === 'update' && runningTool
      ? `(${getToolDisplayName(runningTool)})`
      : null
  const panelStatusText = panelMode === 'update' ? statusText : reanalyzeStatusText
  const panelStatusClassName = panelMode === 'update' ? statusClassName : reanalyzeStatusClassName
  const panelIsRunning =
    panelMode === 'update'
      ? isUpdating
      : reanalyzeProgress.isActive && !reanalyzeProgress.isStopping && !hasReanalyzeReachedCompletion
  const panelCanStop = panelMode === 'update' ? isUpdating : reanalyzeProgress.isActive
  const panelIsStopping = panelMode === 'update' ? isStoppingUpdate : reanalyzeProgress.isStopping
  const panelStopLabel = panelMode === 'update'
    ? (isStoppingUpdate ? 'Stopping...' : 'Stop Update')
    : (reanalyzeProgress.isStopping ? 'Stopping...' : 'Stop Re-analysis')
  const panelStopHandler = panelMode === 'update' ? handleStopUpdate : reanalyzeProgress.onStop

  useEffect(() => {
    if (!versions) return
    if (outdatedCount <= 0) return

    const toastKey = String(outdatedCount)
    if (lastToastKeyRef.current === toastKey) return

    lastToastKeyRef.current = toastKey
    setToast({
      kind: 'warning',
      message: `${outdatedCount} backend tool update${outdatedCount === 1 ? '' : 's'} available.`,
    })
  }, [versions, outdatedCount])

  useEffect(() => {
    if (!toast) return
    const timeoutId = window.setTimeout(() => setToast(null), 5500)
    return () => window.clearTimeout(timeoutId)
  }, [toast])

  useEffect(() => {
    const handleIntegrationChanged = (event: Event) => {
      const detail = (event as CustomEvent<boolean>).detail
      if (typeof detail === 'boolean') {
        setSpotdlEnabledState(detail)
        return
      }
      setSpotdlEnabledState(isSpotdlIntegrationEnabled())
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key === SPOTDL_INTEGRATION_STORAGE_KEY) {
        setSpotdlEnabledState(isSpotdlIntegrationEnabled())
      }
    }

    window.addEventListener(SPOTDL_INTEGRATION_EVENT, handleIntegrationChanged)
    window.addEventListener('storage', handleStorage)
    return () => {
      window.removeEventListener(SPOTDL_INTEGRATION_EVENT, handleIntegrationChanged)
      window.removeEventListener('storage', handleStorage)
    }
  }, [])

  useEffect(() => {
    const el = logRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [updateLog, isLogOpen])

  useEffect(() => {
    if (!isLogOpen) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsLogOpen(false)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isLogOpen])

  useEffect(() => {
    return () => {
      updateAbortRef.current?.abort()
    }
  }, [])

  return (
    <div>
      <h4 className="text-sm font-medium text-white mb-2">Backend Import Dependencies</h4>
      <p className="text-sm text-slate-400 mb-4">
        Check and update backend dependencies used for media import.
      </p>

      {isLoading && (
        <div className="mb-4 p-3 bg-surface-base rounded-lg border border-surface-border">
          <div className="flex items-center gap-2 text-sm text-slate-300">
            <RefreshCw size={16} className="animate-spin text-accent-primary" />
            Checking tool versions...
          </div>
        </div>
      )}

      {!isLoading && versions && (
        <div className="space-y-3 mb-4">
          <div className="bg-surface-base rounded-lg border border-surface-border p-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-white">yt-dlp</div>
              <div className="text-xs text-slate-400">
                {versions.ytdlp.current ?? 'Not installed'}{' '}
                {versions.ytdlp.latest && (
                  <>
                    →{' '}
                    <span className={hasYtdlpUpdate ? 'text-yellow-400' : 'text-slate-500'}>
                      latest: {versions.ytdlp.latest}
                    </span>
                  </>
                )}
              </div>
            </div>
            <button
              onClick={() => handleUpdate('ytdlp')}
              disabled={!hasYtdlpUpdate || isUpdating}
              className={`
                inline-flex items-center gap-2 px-3 py-1.5 rounded text-xs font-medium transition-colors
                ${
                  !hasYtdlpUpdate || isUpdating
                    ? 'bg-surface-overlay text-slate-500 cursor-not-allowed'
                    : 'bg-accent-primary hover:bg-accent-primary/90 text-white'
                }
              `}
            >
              <RefreshCw size={12} className={updateYtdlpMutation.isPending ? 'animate-spin' : ''} />
              Update
            </button>
          </div>

          {spotdlEnabled && (
            <div className="bg-surface-base rounded-lg border border-surface-border p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium text-white">spotdl</div>
                <div className="text-xs text-slate-400">
                  {versions.spotdl.current ?? 'Not installed'}{' '}
                  {versions.spotdl.latest && (
                    <>
                      →{' '}
                      <span className={hasSpotdlUpdate ? 'text-yellow-400' : 'text-slate-500'}>
                        latest: {versions.spotdl.latest}
                      </span>
                    </>
                  )}
                </div>
              </div>
              <button
                onClick={() => handleUpdate('spotdl')}
                disabled={!hasSpotdlUpdate || isUpdating}
                className={`
                  inline-flex items-center gap-2 px-3 py-1.5 rounded text-xs font-medium transition-colors
                  ${
                    !hasSpotdlUpdate || isUpdating
                      ? 'bg-surface-overlay text-slate-500 cursor-not-allowed'
                      : 'bg-accent-primary hover:bg-accent-primary/90 text-white'
                  }
                `}
              >
                <RefreshCw size={12} className={updateSpotdlMutation.isPending ? 'animate-spin' : ''} />
                Update
              </button>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => refetch()}
          disabled={isFetching || isLoading}
          className={`
            inline-flex items-center gap-2 px-3 py-2 rounded text-sm font-medium transition-colors
            ${
              isFetching || isLoading
                ? 'bg-surface-base text-slate-400 cursor-not-allowed'
                : 'bg-surface-overlay hover:bg-surface-border text-white'
            }
          `}
        >
          <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
          {isFetching ? 'Checking...' : 'Check Updates'}
        </button>
        {isUpdating && (
          <button
            onClick={handleStopUpdate}
            disabled={isStoppingUpdate}
            className={`
              inline-flex items-center gap-2 px-3 py-2 rounded text-sm font-medium transition-colors
              ${isStoppingUpdate
                ? 'bg-surface-base text-slate-400 cursor-not-allowed'
                : 'bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/40'}
            `}
          >
            {isStoppingUpdate ? 'Stopping...' : 'Stop Update'}
          </button>
        )}
      </div>

      {toast && (
        <div
          className={`
            fixed top-4 right-4 z-50 max-w-sm px-4 py-3 rounded-lg border text-sm shadow-lg
            ${
              toast.kind === 'success'
                ? 'bg-green-500/10 border-green-500/40 text-green-300'
                : toast.kind === 'error'
                  ? 'bg-red-500/10 border-red-500/40 text-red-300'
                  : 'bg-amber-500/10 border-amber-500/40 text-amber-300'
            }
          `}
        >
          {toast.message}
        </div>
      )}

      {showBottomLogBar && (
        <>
          {isLogOpen && (
            <button
              type="button"
              aria-label="Close progress panel"
              className="fixed inset-0 z-40 bg-surface-base/40"
              onClick={() => setIsLogOpen(false)}
            />
          )}

          <div className="fixed inset-x-0 bottom-0 z-50 pointer-events-none px-3 pb-3">
            <div className="mx-auto max-w-4xl pointer-events-auto">
              <div className="rounded-xl border border-surface-border bg-surface-raised shadow-2xl overflow-hidden">
                <div className="w-full px-4 py-3 flex items-center justify-between gap-3 hover:bg-surface-overlay/80 transition-colors">
                  <button
                    type="button"
                    onClick={() => setIsLogOpen((open) => !open)}
                    aria-expanded={isLogOpen}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex items-center gap-2 text-sm font-medium text-white">
                      <RefreshCw size={14} className={panelIsRunning ? 'animate-spin text-accent-primary' : 'text-slate-400'} />
                      <span>{panelTitle}</span>
                      {panelSubtitle && (
                        <span className="text-xs text-slate-400 font-normal">{panelSubtitle}</span>
                      )}
                    </div>
                    <div className={`text-xs mt-0.5 ${panelStatusClassName}`}>
                      {panelStatusText}
                    </div>
                  </button>
                  <div className="flex items-center gap-2">
                    {panelCanStop && (
                      <button
                        type="button"
                        onClick={panelStopHandler}
                        disabled={panelIsStopping}
                        className={`
                          inline-flex items-center gap-2 px-3 py-1.5 rounded text-xs font-medium transition-colors
                          ${panelIsStopping
                            ? 'bg-surface-base text-slate-400 cursor-not-allowed'
                            : 'bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/40'}
                        `}
                      >
                        {panelStopLabel}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setIsLogOpen((open) => !open)}
                      aria-label={isLogOpen ? 'Collapse progress details' : 'Expand progress details'}
                      className="text-slate-400 hover:text-slate-200 transition-colors"
                    >
                      {isLogOpen ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                    </button>
                  </div>
                </div>

                <div
                  className={`
                    border-t border-surface-border overflow-hidden transition-all duration-200 ease-out
                    ${isLogOpen ? 'max-h-[50vh] opacity-100' : 'max-h-0 opacity-0'}
                  `}
                >
                  {panelMode === 'update' ? (
                    <pre
                      ref={logRef}
                      className="bg-surface-base p-3 text-xs font-mono text-slate-300 whitespace-pre-wrap max-h-[46vh] overflow-y-auto"
                    >
                      {updateLog || 'Waiting for update output...'}
                    </pre>
                  ) : (
                    <pre className="bg-surface-base p-3 text-xs font-mono text-slate-300 whitespace-pre-wrap max-h-[46vh] overflow-y-auto">
                      {reanalyzeDetails || 'Waiting for re-analysis output...'}
                    </pre>
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

type RcloneShareMode = 'share' | 'sync'

function RcloneShareSection({ mode = 'share' }: { mode?: RcloneShareMode }) {
  const [publishName, setPublishName] = useState('')
  const [publishVersion, setPublishVersion] = useState('')
  const [publishNote, setPublishNote] = useState('')
  const [lastPreparedSnapshotPath, setLastPreparedSnapshotPath] = useState<string | null>(null)
  const [isPreparingPublish, setIsPreparingPublish] = useState(false)

  const [pullName, setPullName] = useState('')
  const [pullVersion, setPullVersion] = useState('')
  const [pullTarget, setPullTarget] = useState('')

  const [syncTargetRoot, setSyncTargetRoot] = useState('')
  const [libraryFilter, setLibraryFilter] = useState('')
  const [pickerNotice, setPickerNotice] = useState<string | null>(null)
  const [quickStatusMessage, setQuickStatusMessage] = useState<string | null>(null)
  const [commandError, setCommandError] = useState<string | null>(null)
  const [commandOutput, setCommandOutput] = useState('')
  const [isOutputOpen, setIsOutputOpen] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [snapshotModeEnabled, setSnapshotModeEnabled] = useState(() => localStorage.getItem(RCLONE_SNAPSHOT_MODE_KEY) !== 'false')
  const [quickSendCode, setQuickSendCode] = useState(() => generateQuickShareCode())
  const [quickSendScope, setQuickSendScope] = useState<QuickShareScope>('library')
  const [quickSendCollections, setQuickSendCollections] = useState('')
  const [quickReceiveCode, setQuickReceiveCode] = useState('')
  const [quickReceiveScope, setQuickReceiveScope] = useState<QuickShareScope>('library')
  const [quickReceiveCollections, setQuickReceiveCollections] = useState('')
  const [quickReceiveTarget, setQuickReceiveTarget] = useState(() => localStorage.getItem(RCLONE_QUICK_RECEIVE_TARGET_KEY) ?? '')
  const [isQuickReceiving, setIsQuickReceiving] = useState(false)
  const [transferStatus, setTransferStatus] = useState<'idle' | 'running' | 'success' | 'error'>('idle')
  const [transferLabel, setTransferLabel] = useState('')
  const [transferProgress, setTransferProgress] = useState(0)
  const transferResetTimerRef = useRef<number | null>(null)

  const {
    data: status,
    isLoading: isStatusLoading,
    isFetching: isStatusFetching,
    refetch: refetchStatus,
  } = useQuery<api.RcloneShareStatus>({
    queryKey: ['rclone-share-status'],
    queryFn: api.getRcloneShareStatus,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })

  const {
    data: listData,
    isLoading: isListLoading,
    isFetching: isListFetching,
    refetch: refetchList,
    error: listError,
  } = useQuery<api.RcloneShareListResult>({
    queryKey: ['rclone-share-list'],
    queryFn: () => api.listRcloneShareLibraries(),
    enabled: Boolean(status?.scriptExists && status?.configExists && status?.rcloneVersion),
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  })

  const applyCommandResult = async (
    title: string,
    result: api.RcloneShareCommandResult,
    contextLine?: string,
  ) => {
    setCommandError(null)
    setCommandOutput(
      [
        `# ${title}`,
        contextLine?.trim(),
        result.stdout.trim(),
        result.stderr.trim(),
        `Exit code: ${result.exitCode ?? 'unknown'}`,
      ]
        .filter(Boolean)
        .join('\n'),
    )
    setIsOutputOpen(true)
    await Promise.all([refetchStatus(), refetchList()])
  }

  const applyCommandError = (fallback: string, error: unknown) => {
    const message = getApiErrorMessage(error, fallback)
    setCommandError(message)
    setCommandOutput(
      [
        `# ${fallback}`,
        message,
      ]
        .filter(Boolean)
        .join('\n'),
    )
    setIsOutputOpen(true)
  }

  const initMutation = useMutation({
    mutationFn: api.initRcloneShare,
  })

  const publishMutation = useMutation({
    mutationFn: api.publishRcloneShareLibrary,
  })

  const pullMutation = useMutation({
    mutationFn: api.pullRcloneShareLibrary,
  })

  const syncMutation = useMutation({
    mutationFn: api.syncRcloneShareLibraries,
  })

  const isRunningCommand =
    isPreparingPublish ||
    isQuickReceiving ||
    initMutation.isPending ||
    publishMutation.isPending ||
    pullMutation.isPending ||
    syncMutation.isPending

  const canRunCommands = Boolean(
    status?.scriptExists &&
    status?.configExists &&
    status?.rcloneVersion,
  )

  const filteredLibraries = useMemo(() => {
    const source = listData?.libraries ?? {}
    const filter = libraryFilter.trim().toLowerCase()

    return Object.entries(source)
      .filter(([name]) => (filter ? name.toLowerCase().includes(filter) : true))
      .sort(([a], [b]) => a.localeCompare(b))
  }, [libraryFilter, listData?.libraries])

  const remoteSnapshotStats = useMemo(() => {
    const libraries = Object.values(listData?.libraries ?? {})
    let snapshotCount = 0
    let totalBytes = 0

    for (const library of libraries) {
      for (const version of library.versions) {
        snapshotCount += 1
        totalBytes += Number.isFinite(version.totalBytes) ? Math.max(0, version.totalBytes) : 0
      }
    }

    return {
      libraryCount: libraries.length,
      snapshotCount,
      totalBytes,
    }
  }, [listData?.libraries])

  useEffect(() => {
    localStorage.setItem(RCLONE_SNAPSHOT_MODE_KEY, String(snapshotModeEnabled))
  }, [snapshotModeEnabled])

  useEffect(() => {
    const target = quickReceiveTarget.trim()
    if (!target) {
      localStorage.removeItem(RCLONE_QUICK_RECEIVE_TARGET_KEY)
      return
    }
    localStorage.setItem(RCLONE_QUICK_RECEIVE_TARGET_KEY, target)
  }, [quickReceiveTarget])

  useEffect(() => {
    return () => {
      if (transferResetTimerRef.current !== null) {
        window.clearTimeout(transferResetTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (transferStatus !== 'running') return
    const intervalId = window.setInterval(() => {
      setTransferProgress((prev) => {
        if (prev >= 92) return prev
        const next = prev + Math.max(1, Math.ceil((92 - prev) * 0.12))
        return Math.min(92, next)
      })
    }, 450)
    return () => window.clearInterval(intervalId)
  }, [transferStatus])

  const clearTransferResetTimer = () => {
    if (transferResetTimerRef.current !== null) {
      window.clearTimeout(transferResetTimerRef.current)
      transferResetTimerRef.current = null
    }
  }

  const beginTransferProgress = (label: string, initialProgress = 8) => {
    clearTransferResetTimer()
    setTransferStatus('running')
    setTransferLabel(label)
    setTransferProgress(Math.max(1, Math.min(99, initialProgress)))
  }

  const advanceTransferProgress = (progress: number, label?: string) => {
    if (label) setTransferLabel(label)
    setTransferProgress((prev) => Math.max(prev, Math.min(99, progress)))
  }

  const finishTransferProgress = (label?: string) => {
    clearTransferResetTimer()
    if (label) setTransferLabel(label)
    setTransferStatus('success')
    setTransferProgress(100)
    transferResetTimerRef.current = window.setTimeout(() => {
      setTransferStatus('idle')
      setTransferLabel('')
      setTransferProgress(0)
      transferResetTimerRef.current = null
    }, 2200)
  }

  const failTransferProgress = (label?: string) => {
    clearTransferResetTimer()
    if (label) setTransferLabel(label)
    setTransferStatus('error')
    setTransferProgress((prev) => Math.max(prev, 20))
  }

  const openDirectoryPicker = async (
    currentPath: string,
    title: string,
    onSelected: (directoryPath: string) => void,
  ) => {
    setPickerNotice(null)

    if (!window.electron?.selectDirectory) {
      setPickerNotice('Directory picker is available in Electron only. Paste a path manually when running in browser mode.')
      return
    }

    try {
      const selected = await window.electron.selectDirectory({
        defaultPath: currentPath || undefined,
        title,
      })
      if (selected) onSelected(selected)
    } catch {
      setPickerNotice('Could not open directory picker. Paste a path manually.')
    }
  }

  const quickReceiveLookup = useMemo(() => {
    const code = normalizeQuickShareCode(quickReceiveCode)
    if (code.length !== QUICK_SHARE_CODE_LENGTH) return null

    const libraryName = buildQuickShareLibraryName(code)
    const library = listData?.libraries?.[libraryName]
    const latestVersion = getLatestShareVersion(library)
    const metadata = parseQuickShareNote(latestVersion?.note)

    return {
      code,
      libraryName,
      library,
      latestVersion,
      metadata,
    }
  }, [quickReceiveCode, listData?.libraries])

  const handlePublish = async () => {
    const name = publishName.trim()
    if (!name) {
      setCommandError('Publish requires a library name.')
      return
    }

    const resolvedVersion = publishVersion.trim() || (snapshotModeEnabled ? buildSnapshotVersionLabel() : undefined)
    setCommandError(null)
    setQuickStatusMessage(null)
    beginTransferProgress('Preparing library files for upload...', 10)

    setIsPreparingPublish(true)
    let snapshotPath: string | null = null
    try {
      const snapshotResult = await api.exportLibrary()
      snapshotPath = snapshotResult.exportPath
      setLastPreparedSnapshotPath(snapshotPath)
      advanceTransferProgress(40, 'Uploading files to shared storage...')

      const result = await publishMutation.mutateAsync({
        name,
        source: snapshotPath,
        version: resolvedVersion,
        note: publishNote.trim() || undefined,
      })

      await applyCommandResult(
        `Publish ${name || 'library'}`,
        result,
        `Prepared local library snapshot: ${snapshotPath}`,
      )
      finishTransferProgress('Upload complete')
    } catch (error) {
      const fallback = snapshotPath
        ? 'Failed to publish shared library'
        : 'Failed to prepare local library snapshot'
      failTransferProgress(snapshotPath ? 'Upload failed' : 'Failed to package files')
      applyCommandError(fallback, error)
    } finally {
      setIsPreparingPublish(false)
    }
  }

  const handlePull = async () => {
    const name = pullName.trim()
    if (!name) {
      setCommandError('Pull requires a library name.')
      return
    }

    setQuickStatusMessage(null)
    setCommandError(null)
    beginTransferProgress('Downloading files from shared storage...', 12)

    try {
      const result = await pullMutation.mutateAsync({
        name,
        version: pullVersion.trim() || undefined,
        target: pullTarget.trim() || undefined,
      })
      await applyCommandResult(`Pull ${name}`, result)
      finishTransferProgress('Download complete')
    } catch (error) {
      failTransferProgress('Download failed')
      applyCommandError('Failed to pull shared library', error)
    }
  }

  const handleSync = async () => {
    setQuickStatusMessage(null)
    setCommandError(null)
    beginTransferProgress('Syncing latest files to destination...', 10)

    try {
      const result = await syncMutation.mutateAsync({
        targetRoot: syncTargetRoot.trim() || undefined,
      })
      await applyCommandResult('Sync all latest shared libraries', result)
      finishTransferProgress('Sync complete')
    } catch (error) {
      failTransferProgress('Sync failed')
      applyCommandError('Failed to sync shared libraries', error)
    }
  }

  const handleQuickSend = async () => {
    const code = normalizeQuickShareCode(quickSendCode)
    if (code.length !== QUICK_SHARE_CODE_LENGTH) {
      setCommandError('Share code must be 8 characters.')
      return
    }

    const selectedCollections = quickSendScope === 'collections'
      ? parseCollectionNamesCsv(quickSendCollections)
      : []

    if (quickSendScope === 'collections' && selectedCollections.length === 0) {
      setCommandError('Add at least one collection name to share.')
      return
    }

    const resolvedVersion = snapshotModeEnabled ? buildSnapshotVersionLabel() : undefined
    const libraryName = buildQuickShareLibraryName(code)

    setCommandError(null)
    setQuickStatusMessage(null)
    beginTransferProgress('Preparing files for code-based send...', 10)
    setIsPreparingPublish(true)

    let snapshotPath: string | null = null
    try {
      const snapshotResult = await api.exportLibrary()
      snapshotPath = snapshotResult.exportPath
      setLastPreparedSnapshotPath(snapshotPath)
      advanceTransferProgress(40, 'Uploading shared files...')

      const result = await publishMutation.mutateAsync({
        name: libraryName,
        source: snapshotPath,
        version: resolvedVersion,
        note: buildQuickShareNote({
          code,
          scope: quickSendScope,
          collections: selectedCollections,
        }),
      })

      await applyCommandResult(
        `Send to ${formatQuickShareCode(code)}`,
        result,
        `Prepared local library snapshot: ${snapshotPath}`,
      )

      setQuickStatusMessage(
        quickSendScope === 'library'
          ? `Code ${formatQuickShareCode(code)} is ready. The other user can now receive your full library.`
          : `Code ${formatQuickShareCode(code)} is ready. The other user can now receive selected collections.`,
      )
      finishTransferProgress('Send complete')
    } catch (error) {
      const fallback = snapshotPath
        ? 'Failed to send shared library'
        : 'Failed to prepare local library snapshot'
      failTransferProgress(snapshotPath ? 'Send failed' : 'Failed to package files')
      applyCommandError(fallback, error)
    } finally {
      setIsPreparingPublish(false)
    }
  }

  const handleQuickReceive = async () => {
    const code = normalizeQuickShareCode(quickReceiveCode)
    if (code.length !== QUICK_SHARE_CODE_LENGTH) {
      setCommandError('Enter an 8-character code to receive from another user.')
      return
    }

    const target = quickReceiveTarget.trim()
    if (!target) {
      setCommandError('Choose a receive folder so the app can import what is pulled.')
      return
    }

    const selectedCollections = quickReceiveScope === 'collections'
      ? parseCollectionNamesCsv(quickReceiveCollections)
      : []

    if (quickReceiveScope === 'collections' && selectedCollections.length === 0) {
      setCommandError('Add collection names to receive selected collections.')
      return
    }

    const libraryName = buildQuickShareLibraryName(code)

    setCommandError(null)
    setQuickStatusMessage(null)
    setIsQuickReceiving(true)
    beginTransferProgress('Downloading shared files...', 12)

    try {
      const pullResult = await pullMutation.mutateAsync({
        name: libraryName,
        target,
      })
      advanceTransferProgress(72, 'Importing received files...')

      const importOptions: api.LibraryImportOptions = {
        mode: 'source',
        importCollections: true,
      }
      if (quickReceiveScope === 'collections') {
        importOptions.collectionNames = selectedCollections
      }

      const importResult = await api.importLibrary(target, importOptions)
      const importedCollectionsText = Array.isArray(importResult.importedCollections) && importResult.importedCollections.length > 0
        ? importResult.importedCollections.join(', ')
        : ''

      setCommandOutput(
        [
          `# Receive ${formatQuickShareCode(code)}`,
          `Library: ${libraryName}`,
          `Pulled to: ${target}`,
          `Import mode: ${quickReceiveScope === 'collections' ? 'Selected collections' : 'Full library source'}`,
          importedCollectionsText ? `Imported collections: ${importedCollectionsText}` : '',
          pullResult.stdout.trim(),
          pullResult.stderr.trim(),
          `Exit code: ${pullResult.exitCode ?? 'unknown'}`,
        ]
          .filter(Boolean)
          .join('\n'),
      )
      setIsOutputOpen(true)
      await Promise.all([refetchStatus(), refetchList()])

      setQuickStatusMessage(
        quickReceiveScope === 'collections'
          ? `Received and imported collections: ${selectedCollections.join(', ')}.`
          : 'Received and imported the full shared library as a source.',
      )
      finishTransferProgress('Receive complete')
    } catch (error) {
      failTransferProgress('Receive failed')
      applyCommandError('Failed to receive shared library from code', error)
    } finally {
      setIsQuickReceiving(false)
    }
  }

  const handleConnectStorage = async () => {
    setCommandError(null)
    setQuickStatusMessage(null)
    beginTransferProgress('Connecting storage...', 15)
    try {
      const result = await initMutation.mutateAsync()
      await applyCommandResult('Initialize share remote', result)
      finishTransferProgress('Storage connection successful')
    } catch (error) {
      failTransferProgress('Connection failed')
      applyCommandError('Failed to initialize share remote', error)
    }
  }

  const applySenderSettings = () => {
    if (!quickReceiveLookup?.metadata) return
    setQuickReceiveScope(quickReceiveLookup.metadata.scope)
    if (quickReceiveLookup.metadata.collections.length > 0) {
      setQuickReceiveCollections(quickReceiveLookup.metadata.collections.join(', '))
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-sm font-medium text-white mb-2">{mode === 'sync' ? 'Sync Transfers' : 'Other Computers'}</h4>
        <p className="text-sm text-slate-400">
          {mode === 'sync'
            ? 'Pull the latest transferred files into a destination folder on this machine.'
            : 'Connect with a code, then send or receive your library in a few clicks.'}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => void handleConnectStorage()}
          disabled={!canRunCommands || isRunningCommand}
          className={`inline-flex items-center gap-2 px-3 py-2 rounded text-sm font-medium transition-colors ${
            !canRunCommands || isRunningCommand
              ? 'bg-surface-base text-slate-500 cursor-not-allowed'
              : 'bg-accent-primary hover:bg-accent-primary/90 text-white'
          }`}
        >
          <Link2 size={14} />
          Connect Storage
        </button>

        <button
          onClick={() => {
            refetchStatus()
            refetchList()
          }}
          disabled={isStatusFetching || isListFetching}
          className={`inline-flex items-center gap-2 px-3 py-2 rounded text-sm font-medium transition-colors ${
            isStatusFetching || isListFetching
              ? 'bg-surface-base text-slate-500 cursor-not-allowed'
              : 'bg-surface-overlay hover:bg-surface-border text-white'
          }`}
        >
          <RefreshCw size={14} className={isStatusFetching || isListFetching ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-surface-base border border-surface-border rounded-lg p-3">
          <div className="text-xs text-slate-400 mb-1">rclone CLI</div>
          <div className="text-sm text-white flex items-center gap-2">
            {status?.rcloneVersion ? (
              <>
                <CheckCircle2 size={14} className="text-green-400" />
                <span className="truncate">{status.rcloneVersion}</span>
              </>
            ) : (
              <>
                <AlertCircle size={14} className="text-amber-400" />
                <span>Not detected</span>
              </>
            )}
          </div>
        </div>

        <div className="bg-surface-base border border-surface-border rounded-lg p-3">
          <div className="text-xs text-slate-400 mb-1">Share helper script</div>
          <div className="text-sm text-white flex items-center gap-2">
            {status?.scriptExists ? (
              <>
                <CheckCircle2 size={14} className="text-green-400" />
                <span>Ready</span>
              </>
            ) : (
              <>
                <AlertCircle size={14} className="text-amber-400" />
                <span>Missing</span>
              </>
            )}
          </div>
        </div>

        <div className="bg-surface-base border border-surface-border rounded-lg p-3">
          <div className="text-xs text-slate-400 mb-1">Share config</div>
          <div className="text-sm text-white flex items-center gap-2">
            {status?.configExists ? (
              <>
                <CheckCircle2 size={14} className="text-green-400" />
                <span>Found</span>
              </>
            ) : (
              <>
                <AlertCircle size={14} className="text-amber-400" />
                <span>Missing</span>
              </>
            )}
          </div>
        </div>
      </div>

      {status?.message && (
        <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded text-xs text-amber-300">
          Setup required: {status.message}
        </div>
      )}

      {canRunCommands ? (
        <div className="p-3 bg-green-500/10 border border-green-500/30 rounded text-xs text-green-300">
          Connection ready. You can transfer files now.
        </div>
      ) : (
        <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded text-xs text-amber-300">
          Connection not ready yet. Complete setup items above to enable file transfer.
        </div>
      )}

      {transferStatus !== 'idle' && (
        <div className={`p-3 rounded border ${
          transferStatus === 'success'
            ? 'bg-green-500/10 border-green-500/30'
            : transferStatus === 'error'
              ? 'bg-red-500/10 border-red-500/30'
              : 'bg-surface-base border-surface-border'
        }`}>
          <div className="flex items-center justify-between text-xs">
            <span className={`${
              transferStatus === 'success'
                ? 'text-green-300'
                : transferStatus === 'error'
                  ? 'text-red-300'
                  : 'text-slate-200'
            }`}>{transferLabel || 'Transferring files...'}</span>
            <span className="text-slate-400">{Math.round(transferProgress)}%</span>
          </div>
          <div className="mt-2 h-2 bg-surface-overlay rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                transferStatus === 'success'
                  ? 'bg-green-400'
                  : transferStatus === 'error'
                    ? 'bg-red-400'
                    : 'bg-accent-primary'
              }`}
              style={{ width: `${Math.max(0, Math.min(100, transferProgress))}%` }}
            />
          </div>
        </div>
      )}

      {mode === 'share' && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="bg-surface-base border border-surface-border rounded-lg p-4 space-y-3">
          <div>
            <div className="text-sm font-medium text-white">1. Share from this computer</div>
            <p className="text-xs text-slate-400 mt-1">
              Create a code and send your library snapshot. Share that code with the other user.
            </p>
          </div>

          <div className="space-y-2">
            <label className="block text-xs text-slate-400">Share code</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={quickSendCode}
                onChange={(e) => setQuickSendCode(normalizeQuickShareCode(e.target.value))}
                placeholder="8-character code"
                className="flex-1 px-3 py-2 bg-surface-raised border border-surface-border rounded text-sm text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary font-mono tracking-widest"
              />
              <button
                type="button"
                onClick={() => setQuickSendCode(generateQuickShareCode())}
                className="px-3 py-2 rounded text-xs font-medium bg-surface-raised hover:bg-surface-overlay text-slate-200 border border-surface-border transition-colors"
              >
                New Code
              </button>
            </div>
            <div className="text-xs text-slate-500">
              Share this code: <span className="font-mono text-slate-300">{formatQuickShareCode(quickSendCode) || '---- ----'}</span>
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-xs text-slate-400">What can they import?</label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setQuickSendScope('library')}
                className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                  quickSendScope === 'library'
                    ? 'bg-accent-primary text-white'
                    : 'bg-surface-raised border border-surface-border text-slate-300 hover:bg-surface-overlay'
                }`}
              >
                Full library
              </button>
              <button
                type="button"
                onClick={() => setQuickSendScope('collections')}
                className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                  quickSendScope === 'collections'
                    ? 'bg-accent-primary text-white'
                    : 'bg-surface-raised border border-surface-border text-slate-300 hover:bg-surface-overlay'
                }`}
              >
                Selected collections
              </button>
            </div>
            {quickSendScope === 'collections' && (
              <input
                type="text"
                value={quickSendCollections}
                onChange={(e) => setQuickSendCollections(e.target.value)}
                placeholder="Collection names (comma separated)"
                className="w-full px-3 py-2 bg-surface-raised border border-surface-border rounded text-sm text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary"
              />
            )}
            {quickSendScope === 'collections' && (
              <p className="text-xs text-slate-500">
                Collection mode shares one snapshot and lets the receiver import only these collection names.
              </p>
            )}
          </div>

          <button
            onClick={() => void handleQuickSend()}
            disabled={!canRunCommands || isRunningCommand}
            className={`inline-flex items-center gap-2 px-3 py-2 rounded text-sm font-medium transition-colors ${
              !canRunCommands || isRunningCommand
                ? 'bg-surface-overlay text-slate-500 cursor-not-allowed'
                : 'bg-accent-primary hover:bg-accent-primary/90 text-white'
            }`}
          >
            <Copy size={14} className={isPreparingPublish ? 'animate-pulse' : ''} />
            {isPreparingPublish ? 'Sending...' : 'Send with Code'}
          </button>
        </div>

        <div className="bg-surface-base border border-surface-border rounded-lg p-4 space-y-3">
          <div>
            <div className="text-sm font-medium text-white">2. Receive from another computer</div>
            <p className="text-xs text-slate-400 mt-1">
              Enter their code, choose full library or collections, then import.
            </p>
          </div>

          <div className="space-y-2">
            <label className="block text-xs text-slate-400">Their share code</label>
            <input
              type="text"
              value={quickReceiveCode}
              onChange={(e) => setQuickReceiveCode(normalizeQuickShareCode(e.target.value))}
              placeholder="Paste 8-character code"
              className="w-full px-3 py-2 bg-surface-raised border border-surface-border rounded text-sm text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary font-mono tracking-widest"
            />
          </div>

          {quickReceiveLookup && (
            <div
              className={`rounded border p-2 text-xs ${
                quickReceiveLookup.library
                  ? 'border-green-500/30 bg-green-500/10 text-green-300'
                  : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
              }`}
            >
              {quickReceiveLookup.library ? (
                <>
                  Found shared snapshot for <span className="font-mono">{formatQuickShareCode(quickReceiveLookup.code)}</span>
                  {quickReceiveLookup.latestVersion && (
                    <span>
                      {' '}
                      ({quickReceiveLookup.latestVersion.version}, {formatBytesCompact(quickReceiveLookup.latestVersion.totalBytes)})
                    </span>
                  )}
                </>
              ) : (
                <>No shared snapshot found yet for this code.</>
              )}
            </div>
          )}

          {quickReceiveLookup?.metadata && (
            <div className="rounded border border-surface-border bg-surface-raised p-2 text-xs text-slate-300">
              Sender suggestion: {quickReceiveLookup.metadata.scope === 'collections' ? 'Selected collections' : 'Full library'}
              {quickReceiveLookup.metadata.collections.length > 0 && (
                <> ({quickReceiveLookup.metadata.collections.join(', ')})</>
              )}
              <button
                type="button"
                onClick={applySenderSettings}
                className="ml-2 text-accent-primary hover:text-accent-primary/80 underline"
              >
                Use these settings
              </button>
            </div>
          )}

          <div className="space-y-2">
            <label className="block text-xs text-slate-400">What to import</label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setQuickReceiveScope('library')}
                className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                  quickReceiveScope === 'library'
                    ? 'bg-accent-primary text-white'
                    : 'bg-surface-raised border border-surface-border text-slate-300 hover:bg-surface-overlay'
                }`}
              >
                Full library
              </button>
              <button
                type="button"
                onClick={() => setQuickReceiveScope('collections')}
                className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                  quickReceiveScope === 'collections'
                    ? 'bg-accent-primary text-white'
                    : 'bg-surface-raised border border-surface-border text-slate-300 hover:bg-surface-overlay'
                }`}
              >
                Selected collections
              </button>
            </div>
            {quickReceiveScope === 'collections' && (
              <input
                type="text"
                value={quickReceiveCollections}
                onChange={(e) => setQuickReceiveCollections(e.target.value)}
                placeholder="Collection names (comma separated)"
                className="w-full px-3 py-2 bg-surface-raised border border-surface-border rounded text-sm text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary"
              />
            )}
          </div>

          <div className="space-y-2">
            <label className="block text-xs text-slate-400">Receive folder</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={quickReceiveTarget}
                onChange={(e) => setQuickReceiveTarget(e.target.value)}
                placeholder="Folder where received snapshot is pulled"
                className="flex-1 px-3 py-2 bg-surface-raised border border-surface-border rounded text-sm text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary"
              />
              <button
                onClick={() => openDirectoryPicker(quickReceiveTarget, 'Select receive folder', setQuickReceiveTarget)}
                className="inline-flex items-center gap-1 px-3 py-2 rounded text-xs font-medium bg-surface-raised hover:bg-surface-overlay text-slate-200 border border-surface-border transition-colors"
                type="button"
              >
                <FolderOpen size={13} />
                Browse
              </button>
            </div>
          </div>

          <button
            onClick={() => void handleQuickReceive()}
            disabled={!canRunCommands || isRunningCommand}
            className={`inline-flex items-center gap-2 px-3 py-2 rounded text-sm font-medium transition-colors ${
              !canRunCommands || isRunningCommand
                ? 'bg-surface-overlay text-slate-500 cursor-not-allowed'
                : 'bg-accent-primary hover:bg-accent-primary/90 text-white'
            }`}
          >
            <Link2 size={14} />
            {isQuickReceiving ? 'Receiving...' : 'Receive and Import'}
          </button>
        </div>
      </div>
      )}

      {mode === 'sync' && (
        <div className="bg-surface-base border border-surface-border rounded-lg p-4 space-y-3">
          <div>
            <div className="text-sm font-medium text-white">Sync Latest Transfers to This Computer</div>
            <p className="text-xs text-slate-400 mt-1">
              Pull the latest files for every shared library into one destination folder.
            </p>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={syncTargetRoot}
              onChange={(e) => setSyncTargetRoot(e.target.value)}
              placeholder="Destination root folder (optional)"
              className="flex-1 px-3 py-2 bg-surface-raised border border-surface-border rounded text-sm text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary"
            />
            <button
              onClick={() => openDirectoryPicker(syncTargetRoot, 'Select sync target root', setSyncTargetRoot)}
              className="inline-flex items-center gap-1 px-3 py-2 rounded text-xs font-medium bg-surface-raised hover:bg-surface-overlay text-slate-200 border border-surface-border transition-colors"
              type="button"
            >
              <FolderOpen size={13} />
              Browse
            </button>
          </div>

          <button
            onClick={() => void handleSync()}
            disabled={!canRunCommands || isRunningCommand}
            className={`inline-flex items-center gap-2 px-3 py-2 rounded text-sm font-medium transition-colors ${
              !canRunCommands || isRunningCommand
                ? 'bg-surface-overlay text-slate-500 cursor-not-allowed'
                : 'bg-accent-primary hover:bg-accent-primary/90 text-white'
            }`}
          >
            <RefreshCw size={14} className={syncMutation.isPending ? 'animate-spin' : ''} />
            Sync Latest Transfers
          </button>
        </div>
      )}

      {pickerNotice && (
        <div className="text-xs text-amber-400">{pickerNotice}</div>
      )}

      {quickStatusMessage && (
        <div className="p-3 bg-green-500/10 border border-green-500/30 rounded text-sm text-green-300">
          {quickStatusMessage}
        </div>
      )}

      {commandError && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded text-sm text-red-300">
          {commandError}
        </div>
      )}

      <div className="border border-surface-border rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setShowAdvanced((open) => !open)}
          className="w-full px-3 py-2 bg-surface-base hover:bg-surface-overlay text-left text-sm text-white flex items-center justify-between"
        >
          <span>Advanced Controls</span>
          {showAdvanced ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>

        {showAdvanced && (
          <div className="p-4 bg-surface-base border-t border-surface-border space-y-4">
            <div className="p-3 bg-surface-raised border border-surface-border rounded text-xs text-slate-300 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="font-medium text-slate-200">Snapshot behavior</span>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={snapshotModeEnabled}
                    onChange={(e) => setSnapshotModeEnabled(e.target.checked)}
                    className="h-4 w-4 rounded border-surface-border bg-surface-base text-accent-primary focus:ring-accent-primary/40"
                  />
                  Auto-create version labels
                </label>
              </div>
              <p className="text-slate-400">
                Remote snapshot footprint:{' '}
                <span className="text-slate-200">
                  {remoteSnapshotStats.snapshotCount} snapshots across {remoteSnapshotStats.libraryCount} libraries ({formatBytesCompact(remoteSnapshotStats.totalBytes)})
                </span>
              </p>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <div className="bg-surface-raised border border-surface-border rounded-lg p-4 space-y-3">
                <div className="text-sm font-medium text-white">Manual Publish</div>
                <input
                  type="text"
                  value={publishName}
                  onChange={(e) => setPublishName(e.target.value)}
                  placeholder="Library name"
                  className="w-full px-3 py-2 bg-surface-base border border-surface-border rounded text-sm text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary"
                />
                {lastPreparedSnapshotPath && (
                  <div className="text-[11px] text-slate-500 break-all">
                    Last prepared snapshot: {lastPreparedSnapshotPath}
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={publishVersion}
                    onChange={(e) => setPublishVersion(e.target.value)}
                    placeholder={snapshotModeEnabled ? 'Version (optional, auto if empty)' : 'Version (optional)'}
                    className="w-full px-3 py-2 bg-surface-base border border-surface-border rounded text-sm text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary"
                  />
                  <input
                    type="text"
                    value={publishNote}
                    onChange={(e) => setPublishNote(e.target.value)}
                    placeholder="Note (optional)"
                    className="w-full px-3 py-2 bg-surface-base border border-surface-border rounded text-sm text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary"
                  />
                </div>
                <button
                  onClick={() => void handlePublish()}
                  disabled={!canRunCommands || isRunningCommand}
                  className={`inline-flex items-center gap-2 px-3 py-2 rounded text-sm font-medium transition-colors ${
                    !canRunCommands || isRunningCommand
                      ? 'bg-surface-overlay text-slate-500 cursor-not-allowed'
                      : 'bg-accent-primary hover:bg-accent-primary/90 text-white'
                  }`}
                >
                  <Copy size={14} className={isPreparingPublish ? 'animate-pulse' : ''} />
                  {isPreparingPublish ? 'Preparing snapshot...' : 'Publish'}
                </button>
              </div>

              <div className="bg-surface-raised border border-surface-border rounded-lg p-4 space-y-3">
                <div className="text-sm font-medium text-white">{mode === 'sync' ? 'Manual Pull / Sync' : 'Manual Pull'}</div>
                <input
                  type="text"
                  value={pullName}
                  onChange={(e) => setPullName(e.target.value)}
                  placeholder="Library name"
                  className="w-full px-3 py-2 bg-surface-base border border-surface-border rounded text-sm text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary"
                />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={pullVersion}
                    onChange={(e) => setPullVersion(e.target.value)}
                    placeholder="Version (optional)"
                    className="w-full px-3 py-2 bg-surface-base border border-surface-border rounded text-sm text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary"
                  />
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={pullTarget}
                      onChange={(e) => setPullTarget(e.target.value)}
                      placeholder="Pull target (optional)"
                      className="flex-1 px-3 py-2 bg-surface-base border border-surface-border rounded text-sm text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary"
                    />
                    <button
                      onClick={() => openDirectoryPicker(pullTarget, 'Select pull target folder', setPullTarget)}
                      className="inline-flex items-center gap-1 px-3 py-2 rounded text-xs font-medium bg-surface-base hover:bg-surface-overlay text-slate-200 border border-surface-border transition-colors"
                      type="button"
                    >
                      <FolderOpen size={13} />
                      Browse
                    </button>
                  </div>
                </div>
                <button
                  onClick={() => void handlePull()}
                  disabled={!canRunCommands || isRunningCommand}
                  className={`inline-flex items-center gap-2 px-3 py-2 rounded text-sm font-medium transition-colors ${
                    !canRunCommands || isRunningCommand
                      ? 'bg-surface-overlay text-slate-500 cursor-not-allowed'
                      : 'bg-accent-primary hover:bg-accent-primary/90 text-white'
                  }`}
                >
                  <Link2 size={14} />
                  Pull Library
                </button>

                {mode === 'sync' && (
                  <div className="pt-2 border-t border-surface-border space-y-2">
                    <div className="text-sm font-medium text-white">Sync all libraries</div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={syncTargetRoot}
                        onChange={(e) => setSyncTargetRoot(e.target.value)}
                        placeholder="Sync target root (optional)"
                        className="flex-1 px-3 py-2 bg-surface-base border border-surface-border rounded text-sm text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary"
                      />
                      <button
                        onClick={() => openDirectoryPicker(syncTargetRoot, 'Select sync target root', setSyncTargetRoot)}
                        className="inline-flex items-center gap-1 px-3 py-2 rounded text-xs font-medium bg-surface-base hover:bg-surface-overlay text-slate-200 border border-surface-border transition-colors"
                        type="button"
                      >
                        <FolderOpen size={13} />
                        Browse
                      </button>
                    </div>
                    <button
                      onClick={() => void handleSync()}
                      disabled={!canRunCommands || isRunningCommand}
                      className={`inline-flex items-center gap-2 px-3 py-2 rounded text-sm font-medium transition-colors ${
                        !canRunCommands || isRunningCommand
                          ? 'bg-surface-overlay text-slate-500 cursor-not-allowed'
                          : 'bg-accent-primary hover:bg-accent-primary/90 text-white'
                      }`}
                    >
                      <RefreshCw size={14} className={syncMutation.isPending ? 'animate-spin' : ''} />
                      Sync Latest
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-surface-raised border border-surface-border rounded-lg p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div className="text-sm font-medium text-white">Available shared libraries</div>
                <input
                  type="text"
                  value={libraryFilter}
                  onChange={(e) => setLibraryFilter(e.target.value)}
                  placeholder="Search libraries"
                  className="w-full sm:w-64 px-3 py-2 bg-surface-base border border-surface-border rounded text-sm text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary"
                />
              </div>

              {isStatusLoading || isListLoading ? (
                <div className="text-sm text-slate-400">Loading shared libraries...</div>
              ) : listError ? (
                <div className="text-sm text-red-400">
                  {getApiErrorMessage(listError, 'Failed to load shared libraries.')}
                </div>
              ) : filteredLibraries.length === 0 ? (
                <div className="text-sm text-slate-500">No libraries found.</div>
              ) : (
                <div className="space-y-2">
                  {filteredLibraries.map(([name, library]) => {
                    const latestVersion = getLatestShareVersion(library)
                    return (
                      <div key={name} className="p-3 rounded border border-surface-border bg-surface-base">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="text-sm font-medium text-white">{name}</div>
                            <div className="text-xs text-slate-400">
                              Latest: <span className="text-slate-200">{library.latest ?? 'n/a'}</span>
                              {' · '}
                              Versions: {library.versions.length}
                            </div>
                          </div>
                          <button
                            onClick={() => setPullName(name)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-surface-overlay hover:bg-surface-border text-slate-200 transition-colors"
                            type="button"
                          >
                            <Link2 size={12} />
                            Use for Pull
                          </button>
                        </div>
                        {latestVersion && (
                          <div className="mt-2 text-[11px] text-slate-500">
                            Latest size: {formatBytesCompact(latestVersion.totalBytes)}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {commandOutput && (
        <div className="border border-surface-border rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => setIsOutputOpen((open) => !open)}
            className="w-full px-3 py-2 bg-surface-base hover:bg-surface-overlay text-left text-sm text-white flex items-center justify-between"
          >
            <span>Last activity details</span>
            {isOutputOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
          {isOutputOpen && (
            <pre className="p-3 text-xs text-slate-300 bg-surface-raised whitespace-pre-wrap break-words max-h-72 overflow-y-auto">
              {commandOutput}
            </pre>
          )}
        </div>
      )}

      {(isStatusFetching || isListFetching) && (
        <div className="text-xs text-slate-500">Refreshing status...</div>
      )}
    </div>
  )
}

type BackupManagementTabId = 'transfer' | 'jobs' | 'remote' | 'sync'

const BACKUP_MANAGEMENT_TABS: Array<{ id: BackupManagementTabId; label: string; description: string }> = [
  {
    id: 'transfer',
    label: 'Download / Upload',
    description: 'Manual backup transfer and restore',
  },
  {
    id: 'jobs',
    label: 'Backup Jobs',
    description: 'Automatic scheduled backups to services',
  },
  {
    id: 'remote',
    label: 'Other Computers',
    description: 'Import/export transfers between computers (code-based)',
  },
  {
    id: 'sync',
    label: 'Sync',
    description: 'Sync latest transferred libraries to this machine',
  },
]

const BACKUP_WHEN_OPTIONS: Array<{ value: api.BackupSchedule; label: string }> = [
  { value: 'manual', label: 'Manual (run now)' },
  { value: 'hourly', label: 'Every hour' },
  { value: 'daily', label: 'Every day' },
  { value: 'weekly', label: 'Every week' },
]

type SimplifiedTransferAction = 'import' | 'export'
type SimplifiedTransferTab = SimplifiedTransferAction | 'sync'
type SimplifiedTransferLocation = 'local' | 'gdrive' | 'another-computer'
type SimplifiedTransferScope = 'library' | 'collections'
type SimplifiedImportPlacement = 'separate' | 'suffix' | 'replace'

function SimplifiedBackupSection() {
  const [tab, setTab] = useState<SimplifiedTransferTab>('import')
  const [location, setLocation] = useState<SimplifiedTransferLocation>('local')
  const [scope, setScope] = useState<SimplifiedTransferScope>('library')
  const [collectionNames, setCollectionNames] = useState('')
  const [when, setWhen] = useState<api.BackupSchedule>('manual')
  const [syncEnabled, setSyncEnabled] = useState(false)
  const [placement, setPlacement] = useState<SimplifiedImportPlacement>('suffix')
  const [separateCollectionName, setSeparateCollectionName] = useState('')
  const [localImportPath, setLocalImportPath] = useState('')
  const [localExportPath, setLocalExportPath] = useState('')
  const [computerCode, setComputerCode] = useState(() => generateQuickShareCode())
  const [remotePullTarget, setRemotePullTarget] = useState('')
  const [syncTargetRoot, setSyncTargetRoot] = useState('')
  const [isGoogleConnecting, setIsGoogleConnecting] = useState(false)
  const [isComputerConnecting, setIsComputerConnecting] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [pickerNotice, setPickerNotice] = useState<string | null>(null)
  const [resultMessage, setResultMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const selectedCollections = useMemo(
    () => parseCollectionNamesCsv(collectionNames),
    [collectionNames],
  )

  const normalizedComputerCode = useMemo(
    () => normalizeQuickShareCode(computerCode),
    [computerCode],
  )

  const formattedComputerCode = useMemo(
    () => formatQuickShareCode(normalizedComputerCode),
    [normalizedComputerCode],
  )

  const isImportTab = tab === 'import'
  const isExportTab = tab === 'export'
  const isSyncTab = tab === 'sync'
  const isRemoteLocation = location !== 'local'
  const isScheduling = isExportTab && when !== 'manual'
  const isConnecting = isGoogleConnecting || isComputerConnecting

  const openDirectoryPicker = async (
    currentPath: string,
    title: string,
    onSelected: (directoryPath: string) => void,
  ) => {
    setPickerNotice(null)

    if (!window.electron?.selectDirectory) {
      setPickerNotice('Directory picker is available in Electron only. Paste a path manually in browser mode.')
      return
    }

    try {
      const selected = await window.electron.selectDirectory({
        defaultPath: currentPath.trim() || undefined,
        title,
      })
      if (selected) onSelected(selected)
    } catch {
      setPickerNotice('Could not open directory picker. Paste a path manually.')
    }
  }

  const openImportPicker = async () => {
    setPickerNotice(null)

    if (window.electron?.selectImportPath) {
      try {
        const selected = await window.electron.selectImportPath({
          defaultPath: localImportPath.trim() || undefined,
          title: 'Select backup folder or ZIP file',
        })
        if (selected) setLocalImportPath(selected)
        return
      } catch {
        // continue to directory picker fallback
      }
    }

    await openDirectoryPicker(localImportPath, 'Select backup folder to import', setLocalImportPath)
  }

  const handleGoogleDriveLogin = async () => {
    setErrorMessage(null)
    setResultMessage(null)
    setIsGoogleConnecting(true)
    try {
      const { authUrl } = await api.getGdriveAuthUrl()
      window.open(authUrl, '_blank', 'width=600,height=700')
      setResultMessage('Google Drive login opened in a popup window.')
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error, 'Failed to open Google Drive login.'))
    } finally {
      setIsGoogleConnecting(false)
    }
  }

  const handleConnectAnotherComputer = async () => {
    setErrorMessage(null)
    setResultMessage(null)
    setIsComputerConnecting(true)
    try {
      await api.initRcloneShare()
      setResultMessage(`Another computer connection is ready. ${formattedComputerCode ? `Code: ${formattedComputerCode}` : ''}`.trim())
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error, 'Failed to connect another computer.'))
    } finally {
      setIsComputerConnecting(false)
    }
  }

  const buildImportOptions = (): api.LibraryImportOptions => {
    if (placement === 'replace') {
      return { mode: 'replace' }
    }

    const options: api.LibraryImportOptions = {
      mode: 'source',
      importCollections: true,
    }

    if (scope === 'collections' && selectedCollections.length > 0) {
      options.collectionNames = selectedCollections
    }

    if (placement === 'suffix') {
      options.collectionNameSuffix = '-1'
    }

    if (placement === 'separate') {
      const rawSuffix = separateCollectionName.trim()
      if (rawSuffix) {
        options.collectionNameSuffix = rawSuffix.startsWith('-') ? rawSuffix : `-${rawSuffix}`
      }
    }

    return options
  }

  const validateBeforeRun = (): string | null => {
    if (!isSyncTab && scope === 'collections' && selectedCollections.length === 0) {
      return 'Add at least one collection name.'
    }

    if (isImportTab && placement === 'separate' && !separateCollectionName.trim()) {
      return 'Provide a collection suffix/name for the separate-collection option.'
    }

    if (isImportTab && !isRemoteLocation && !localImportPath.trim()) {
      return 'Enter a local backup path to import.'
    }

    if (isImportTab && location === 'gdrive') {
      return 'Google Drive import is not supported yet. Export from Drive to a local folder, then import locally.'
    }

    if (!isSyncTab && location === 'another-computer' && normalizedComputerCode.length !== QUICK_SHARE_CODE_LENGTH) {
      return 'Enter an 8-character computer code.'
    }

    if (isImportTab && location === 'another-computer' && !remotePullTarget.trim()) {
      return 'Choose a local folder where pulled files should be placed before import.'
    }

    if (isScheduling) {
      if (location === 'another-computer') {
        return 'Scheduled jobs are available for Local and Google Drive destinations.'
      }
      return null
    }

    if (isSyncTab && location === 'local') {
      return 'Choose Google Drive or Another computer for sync.'
    }

    if (isSyncTab && location === 'another-computer' && !syncTargetRoot.trim()) {
      return 'Choose a local folder for synced data.'
    }

    return null
  }

  const scheduleFullBackup = async () => {
    if (location === 'local') {
      const targetDir = localExportPath.trim() || '/app/data/backups'
      await api.createBackupConfig({
        name: 'Full backup',
        type: 'local',
        params: {
          targetDir,
          keepCount: 7,
        },
        schedule: when,
      })
      setResultMessage(`Full backup job created (${when}) to ${targetDir}.`)
      return
    }

    if (location === 'gdrive') {
      const existingConfigs = await api.getBackupConfigs()
      const existingGdrive = existingConfigs.find((config) => config.type === 'gdrive')

      if (existingGdrive) {
        await api.updateBackupConfig(existingGdrive.id, { schedule: when, enabled: true })
        setResultMessage(`Google Drive full backup schedule updated (${when}).`)
        return
      }

      const createdConfig = await api.createBackupConfig({
        name: 'Full backup',
        type: 'gdrive',
        params: {},
        remote_path: 'sample_solution',
        schedule: when,
      })
      const { authUrl } = await api.getGdriveAuthUrl(createdConfig.id)
      window.open(authUrl, '_blank', 'width=600,height=700')
      setResultMessage(`Full backup job created (${when}). Finish Google Drive sign-in in the popup.`)
    }
  }

  const runSync = async () => {
    if (location === 'another-computer') {
      await api.initRcloneShare()
      await api.syncRcloneShareLibraries({
        targetRoot: syncTargetRoot.trim(),
      })
      setResultMessage('Another computer sync completed.')
      return
    }

    if (location === 'gdrive') {
      const configs = await api.getBackupConfigs()
      const gdriveConfigs = configs.filter((config) => config.type === 'gdrive' && Boolean(config.enabled))
      if (gdriveConfigs.length === 0) {
        const { authUrl } = await api.getGdriveAuthUrl()
        window.open(authUrl, '_blank', 'width=600,height=700')
        setResultMessage('Log in to Google Drive first. After login, run Sync again.')
        return
      }

      for (const config of gdriveConfigs) {
        await api.runBackup(config.id)
      }

      setResultMessage(`Google Drive sync completed for ${gdriveConfigs.length} backup location${gdriveConfigs.length === 1 ? '' : 's'}.`)
    }
  }

  const runImport = async () => {
    if (!isRemoteLocation) {
      if (isImportTab) {
        const options = buildImportOptions()
        await api.importLibrary(localImportPath.trim(), options)
        setResultMessage('Import completed.')
        if (options.mode === 'replace') {
          window.location.reload()
        }
      }
      return
    }

    if (location === 'another-computer') {
      const libraryName = buildQuickShareLibraryName(normalizedComputerCode)
      const pullTarget = remotePullTarget.trim()
      await api.initRcloneShare()
      await api.pullRcloneShareLibrary({
        name: libraryName,
        target: pullTarget,
      })
      const options = buildImportOptions()
      await api.importLibrary(pullTarget, options)

      if (syncEnabled) {
        await api.syncRcloneShareLibraries({
          targetRoot: syncTargetRoot.trim() || pullTarget,
        })
      }

      setResultMessage(
        syncEnabled
          ? `Import completed from ${formattedComputerCode} and sync executed.`
          : `Import completed from ${formattedComputerCode}.`,
      )

      if (options.mode === 'replace') {
        window.location.reload()
      }
    }
  }

  const runExport = async () => {
    if (!isRemoteLocation) {
      const exportResult = await api.exportLibrary(localExportPath.trim() || undefined)
      setResultMessage(`Export completed: ${exportResult.exportPath}`)
      return
    }

    if (location === 'gdrive') {
      const configs = await api.getBackupConfigs()
      const gdriveConfigs = configs.filter((config) => config.type === 'gdrive' && Boolean(config.enabled))

      if (gdriveConfigs.length === 0) {
        const createdConfig = await api.createBackupConfig({
          name: 'Full backup',
          type: 'gdrive',
          params: {},
          remote_path: 'sample_solution',
          schedule: 'manual',
        })
        const { authUrl } = await api.getGdriveAuthUrl(createdConfig.id)
        window.open(authUrl, '_blank', 'width=600,height=700')
        setResultMessage('Google Drive authorization is required. Finish login in the popup, then run Export again.')
        return
      }

      if (syncEnabled) {
        for (const config of gdriveConfigs) {
          await api.runBackup(config.id)
        }
        setResultMessage(`Export synced to all Google Drive backup locations (${gdriveConfigs.length}).`)
        return
      }

      await api.runBackup(gdriveConfigs[0].id)
      setResultMessage('Export completed to Google Drive.')
      return
    }

    if (location === 'another-computer') {
      const libraryName = buildQuickShareLibraryName(normalizedComputerCode)
      await api.initRcloneShare()
      const snapshot = await api.exportLibrary()
      await api.publishRcloneShareLibrary({
        name: libraryName,
        source: snapshot.exportPath,
        version: buildSnapshotVersionLabel(),
        note: buildQuickShareNote({
          code: normalizedComputerCode,
          scope,
          collections: selectedCollections,
        }),
      })

      if (syncEnabled) {
        await api.syncRcloneShareLibraries({
          targetRoot: syncTargetRoot.trim() || undefined,
        })
      }

      setResultMessage(
        syncEnabled
          ? `Export completed to ${formattedComputerCode} and sync executed.`
          : `Export completed to ${formattedComputerCode}.`,
      )
    }
  }

  const handleRun = async () => {
    const validationError = validateBeforeRun()
    if (validationError) {
      setErrorMessage(validationError)
      setResultMessage(null)
      return
    }

    setErrorMessage(null)
    setResultMessage(null)
    setIsRunning(true)
    try {
      if (isSyncTab) {
        await runSync()
      } else if (isScheduling) {
        await scheduleFullBackup()
      } else if (isImportTab) {
        await runImport()
      } else {
        await runExport()
      }
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error, 'Backup action failed.'))
    } finally {
      setIsRunning(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-sm font-medium text-white mb-2">Import/export</h4>
        <p className="text-sm text-slate-400">
          {isSyncTab
            ? 'Sync your backup data across connected locations.'
            : `A single flow for ${isImportTab ? 'imports' : 'exports'} with optional full backup scheduling.`}
        </p>
      </div>

      <div className="bg-surface-base rounded-lg p-4 space-y-4">
        <div className="space-y-2">
          <label className="block text-xs text-slate-400">Import/export/sync</label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setTab('import')}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                isImportTab
                  ? 'bg-accent-primary text-white'
                  : 'bg-surface-raised border border-surface-border text-slate-300 hover:bg-surface-overlay'
              }`}
            >
              Import
            </button>
            <button
              type="button"
              onClick={() => setTab('export')}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                isExportTab
                  ? 'bg-accent-primary text-white'
                  : 'bg-surface-raised border border-surface-border text-slate-300 hover:bg-surface-overlay'
              }`}
            >
              Export
            </button>
            <button
              type="button"
              onClick={() => setTab('sync')}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                isSyncTab
                  ? 'bg-accent-primary text-white'
                  : 'bg-surface-raised border border-surface-border text-slate-300 hover:bg-surface-overlay'
              }`}
            >
              Sync
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <label className="block text-xs text-slate-400">
            {isImportTab
              ? 'Where is the data that you want to import?'
              : isExportTab
                ? 'Where do you want to export your data?'
                : 'What location do you want to sync with?'}
          </label>
          <div className="flex flex-wrap gap-2">
            {[
              { id: 'local', label: 'Local' },
              { id: 'gdrive', label: 'Google Drive' },
              { id: 'another-computer', label: 'Another computer' },
            ].map((option) => {
              const isActive = location === option.id
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setLocation(option.id as SimplifiedTransferLocation)}
                  className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                    isActive
                      ? 'bg-accent-primary text-white'
                      : 'bg-surface-raised border border-surface-border text-slate-300 hover:bg-surface-overlay'
                  }`}
                >
                  {option.label}
                </button>
              )
            })}
          </div>

          {location === 'gdrive' && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleGoogleDriveLogin()}
                disabled={isGoogleConnecting || isRunning}
                className={`inline-flex items-center gap-2 px-3 py-2 rounded text-xs font-medium transition-colors ${
                  isGoogleConnecting || isRunning
                    ? 'bg-surface-overlay text-slate-500 cursor-not-allowed'
                    : 'bg-surface-raised border border-surface-border text-slate-200 hover:bg-surface-overlay'
                }`}
              >
                <Link2 size={13} />
                {isGoogleConnecting ? 'Opening login...' : 'Log in to Google Drive'}
              </button>
            </div>
          )}

          {location === 'another-computer' && (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => void handleConnectAnotherComputer()}
                disabled={isComputerConnecting || isRunning}
                className={`inline-flex items-center gap-2 px-3 py-2 rounded text-xs font-medium transition-colors ${
                  isComputerConnecting || isRunning
                    ? 'bg-surface-overlay text-slate-500 cursor-not-allowed'
                    : 'bg-surface-raised border border-surface-border text-slate-200 hover:bg-surface-overlay'
                }`}
              >
                <Link2 size={13} />
                {isComputerConnecting ? 'Connecting...' : 'Connect another computer'}
              </button>

              {!isSyncTab && (
                <div className="space-y-1">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={normalizedComputerCode}
                      onChange={(e) => setComputerCode(normalizeQuickShareCode(e.target.value))}
                      placeholder={isImportTab ? 'Code from the other computer' : 'Your share code'}
                      className="flex-1 px-3 py-2 bg-surface-raised border border-surface-border rounded text-sm text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary font-mono tracking-widest"
                    />
                    {isExportTab && (
                      <button
                        type="button"
                        onClick={() => setComputerCode(generateQuickShareCode())}
                        className="px-3 py-2 rounded text-xs font-medium bg-surface-raised hover:bg-surface-overlay text-slate-200 border border-surface-border transition-colors"
                      >
                        New Code
                      </button>
                    )}
                  </div>
                  {formattedComputerCode && (
                    <div className="text-xs text-slate-500">
                      {isImportTab ? 'Using code:' : 'Share this code:'}{' '}
                      <span className="font-mono text-slate-300">{formattedComputerCode}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {!isSyncTab && (
          <div className="space-y-2">
            <label className="block text-xs text-slate-400">
              {isImportTab ? 'What do you want to import?' : 'What do you want to export?'}
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setScope('library')}
                className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                  scope === 'library'
                    ? 'bg-accent-primary text-white'
                    : 'bg-surface-raised border border-surface-border text-slate-300 hover:bg-surface-overlay'
                }`}
              >
                The whole library
              </button>
              <button
                type="button"
                onClick={() => setScope('collections')}
                className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                  scope === 'collections'
                    ? 'bg-accent-primary text-white'
                    : 'bg-surface-raised border border-surface-border text-slate-300 hover:bg-surface-overlay'
                }`}
              >
                This collection...
              </button>
            </div>
            {scope === 'collections' && (
              <input
                type="text"
                value={collectionNames}
                onChange={(e) => setCollectionNames(e.target.value)}
                placeholder="Collection names (comma separated)"
                className="w-full px-3 py-2 bg-surface-raised border border-surface-border rounded text-sm text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary"
              />
            )}
            {isExportTab && scope === 'collections' && (
              <p className="text-xs text-slate-500">
                Export creates a full backup package; collection filtering is applied on import.
              </p>
            )}
          </div>
        )}

        {!isSyncTab && (
          <div className="space-y-2">
            <label className="block text-xs text-slate-400">
              {isImportTab ? 'When should import run?' : 'When?'}
            </label>
            {isExportTab ? (
              <select
                value={when}
                onChange={(e) => setWhen(e.target.value as api.BackupSchedule)}
                className="w-full px-3 py-2 bg-surface-raised border border-surface-border rounded text-sm text-white focus:outline-none focus:border-accent-primary"
              >
                {BACKUP_WHEN_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            ) : (
              <div className="px-3 py-2 text-xs rounded border border-surface-border bg-surface-raised text-slate-300">
                Imports run immediately.
              </div>
            )}
            {isScheduling && (
              <p className="text-xs text-slate-500">
                Scheduled jobs in this simplified flow create a <span className="text-slate-200">full backup</span>.
              </p>
            )}
          </div>
        )}

        {!isSyncTab && isRemoteLocation && (
          <label className="inline-flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={syncEnabled}
              onChange={(e) => setSyncEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-surface-border bg-surface-base text-accent-primary focus:ring-accent-primary/40"
            />
            Sync everything after {isImportTab ? 'import' : 'export'}
          </label>
        )}

        <div className="space-y-2">
          <label className="block text-xs text-slate-400">
            {isSyncTab
              ? 'Where do you want to put synced data?'
              : 'Where do you want to import/export?'}
          </label>
          {!isSyncTab && (
            <p className="text-xs text-slate-500">
              {isImportTab ? 'Choose where imported data should go.' : 'Choose where exported data should be saved.'}
            </p>
          )}

          {isSyncTab && location === 'another-computer' && (
            <div className="flex flex-wrap sm:flex-nowrap gap-2">
              <input
                type="text"
                value={syncTargetRoot}
                onChange={(e) => setSyncTargetRoot(e.target.value)}
                placeholder="Local folder for synced data"
                className="flex-1 px-3 py-2 bg-surface-raised border border-surface-border rounded text-sm text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary"
              />
              <button
                type="button"
                onClick={() => openDirectoryPicker(syncTargetRoot, 'Select sync target folder', setSyncTargetRoot)}
                className="inline-flex items-center gap-1 px-3 py-2 rounded text-xs font-medium bg-surface-raised hover:bg-surface-overlay text-slate-200 border border-surface-border transition-colors"
              >
                <FolderOpen size={13} />
                Browse
              </button>
            </div>
          )}

          {isSyncTab && location === 'gdrive' && (
            <div className="px-3 py-2 text-xs rounded border border-surface-border bg-surface-raised text-slate-300">
              Sync runs all enabled Google Drive full backup jobs.
            </div>
          )}

          {isImportTab && (
            <div className="space-y-2">
              <label className="flex items-start gap-2 text-xs text-slate-300">
                <input
                  type="radio"
                  name="simplified-import-placement"
                  checked={placement === 'separate'}
                  onChange={() => setPlacement('separate')}
                  className="mt-0.5"
                />
                <span>On a separate collection with custom name</span>
              </label>
              {placement === 'separate' && (
                <input
                  type="text"
                  value={separateCollectionName}
                  onChange={(e) => setSeparateCollectionName(e.target.value)}
                  placeholder="Collection suffix/name"
                  className="w-full px-3 py-2 bg-surface-raised border border-surface-border rounded text-sm text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary"
                />
              )}

              <label className="flex items-start gap-2 text-xs text-slate-300">
                <input
                  type="radio"
                  name="simplified-import-placement"
                  checked={placement === 'suffix'}
                  onChange={() => setPlacement('suffix')}
                  className="mt-0.5"
                />
                <span>Preserve source names</span>
              </label>

              <label className="flex items-start gap-2 text-xs text-slate-300">
                <input
                  type="radio"
                  name="simplified-import-placement"
                  checked={placement === 'replace'}
                  onChange={() => setPlacement('replace')}
                  className="mt-0.5"
                />
                <span>Replace the whole library or collections with matching names</span>
              </label>
            </div>
          )}

          {isExportTab && !isRemoteLocation && (
            <div className="flex flex-wrap sm:flex-nowrap gap-2">
              <input
                type="text"
                value={localExportPath}
                onChange={(e) => setLocalExportPath(e.target.value)}
                placeholder="Destination folder (optional)"
                className="flex-1 px-3 py-2 bg-surface-raised border border-surface-border rounded text-sm text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary"
              />
              <button
                type="button"
                onClick={() => openDirectoryPicker(localExportPath, 'Select export destination', setLocalExportPath)}
                className="inline-flex items-center gap-1 px-3 py-2 rounded text-xs font-medium bg-surface-raised hover:bg-surface-overlay text-slate-200 border border-surface-border transition-colors"
              >
                <FolderOpen size={13} />
                Browse
              </button>
            </div>
          )}

          {isImportTab && !isRemoteLocation && (
            <div className="flex flex-wrap sm:flex-nowrap gap-2">
              <input
                type="text"
                value={localImportPath}
                onChange={(e) => setLocalImportPath(e.target.value)}
                placeholder="Path to backup folder or .zip file"
                className="flex-1 px-3 py-2 bg-surface-raised border border-surface-border rounded text-sm text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary"
              />
              <button
                type="button"
                onClick={() => void openImportPicker()}
                className="inline-flex items-center gap-1 px-3 py-2 rounded text-xs font-medium bg-surface-raised hover:bg-surface-overlay text-slate-200 border border-surface-border transition-colors"
              >
                <FolderOpen size={13} />
                Browse
              </button>
            </div>
          )}

          {location === 'another-computer' && !isSyncTab && (
            <div className="space-y-2">
              {isImportTab && (
                <div className="flex flex-wrap sm:flex-nowrap gap-2">
                  <input
                    type="text"
                    value={remotePullTarget}
                    onChange={(e) => setRemotePullTarget(e.target.value)}
                    placeholder="Local folder for pulled data"
                    className="flex-1 px-3 py-2 bg-surface-raised border border-surface-border rounded text-sm text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary"
                  />
                  <button
                    type="button"
                    onClick={() => openDirectoryPicker(remotePullTarget, 'Select local transfer folder', setRemotePullTarget)}
                    className="inline-flex items-center gap-1 px-3 py-2 rounded text-xs font-medium bg-surface-raised hover:bg-surface-overlay text-slate-200 border border-surface-border transition-colors"
                  >
                    <FolderOpen size={13} />
                    Browse
                  </button>
                </div>
              )}

              {syncEnabled && (
                <div className="flex flex-wrap sm:flex-nowrap gap-2">
                  <input
                    type="text"
                    value={syncTargetRoot}
                    onChange={(e) => setSyncTargetRoot(e.target.value)}
                    placeholder="Local folder for synced data (optional)"
                    className="flex-1 px-3 py-2 bg-surface-raised border border-surface-border rounded text-sm text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary"
                  />
                  <button
                    type="button"
                    onClick={() => openDirectoryPicker(syncTargetRoot, 'Select sync target folder', setSyncTargetRoot)}
                    className="inline-flex items-center gap-1 px-3 py-2 rounded text-xs font-medium bg-surface-raised hover:bg-surface-overlay text-slate-200 border border-surface-border transition-colors"
                  >
                    <FolderOpen size={13} />
                    Browse
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => void handleRun()}
          disabled={isRunning || isConnecting}
          className={`inline-flex items-center gap-2 px-3 py-2 rounded text-sm font-medium transition-colors ${
            isRunning || isConnecting
              ? 'bg-surface-overlay text-slate-500 cursor-not-allowed'
              : 'bg-accent-primary hover:bg-accent-primary/90 text-white'
          }`}
        >
          {isRunning
            ? 'Working...'
            : isSyncTab
              ? 'Sync now'
              : isScheduling
                ? 'Save Full Backup Job'
                : isImportTab
                  ? 'Import'
                  : 'Export'}
        </button>
      </div>

      {pickerNotice && (
        <div className="text-xs text-amber-400">{pickerNotice}</div>
      )}

      {resultMessage && (
        <div className="p-3 bg-green-500/10 border border-green-500/30 rounded text-sm text-green-300">
          {resultMessage}
        </div>
      )}

      {errorMessage && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded text-sm text-red-300">
          {errorMessage}
        </div>
      )}
    </div>
  )
}

function LegacyBackupControls() {
  const [activeTab, setActiveTab] = useState<BackupManagementTabId>('transfer')

  const activeMeta = BACKUP_MANAGEMENT_TABS.find((tab) => tab.id === activeTab) ?? BACKUP_MANAGEMENT_TABS[0]

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-sm font-medium text-white mb-2">Manage Backups</h4>
        <p className="text-sm text-slate-400">{activeMeta.description}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {BACKUP_MANAGEMENT_TABS.map((tab) => {
          const isActive = tab.id === activeTab
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                isActive
                  ? 'bg-accent-primary text-white'
                  : 'bg-surface-base border border-surface-border text-slate-300 hover:bg-surface-overlay'
              }`}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      {activeTab === 'transfer' && <BackupTransferSection />}

      {activeTab === 'jobs' && (
        <BackupPanel
          title="Automatic Backup Jobs"
          description="Set up backup destinations and schedules across cloud and local services."
          showDownloadSection={false}
        />
      )}

      {activeTab === 'remote' && <RcloneShareSection mode="share" />}
      {activeTab === 'sync' && <RcloneShareSection mode="sync" />}
    </div>
  )
}

function ManageBackupsSection() {
  const [showAdvanced, setShowAdvanced] = useState(false)

  return (
    <div className="space-y-4">
      <SimplifiedBackupSection />

      <div className="border border-surface-border rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setShowAdvanced((open) => !open)}
          className="w-full px-3 py-2 bg-surface-base hover:bg-surface-overlay text-left text-sm text-white flex items-center justify-between"
        >
          <span>Advanced backup controls</span>
          {showAdvanced ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>

        {showAdvanced && (
          <div className="p-4 bg-surface-base border-t border-surface-border">
            <LegacyBackupControls />
          </div>
        )}
      </div>
    </div>
  )
}

export function SourcesSettings() {
  const { confirm, alert: showAlert, dialogNode } = useAppDialog()
  const [reanalyzeActionError, setReanalyzeActionError] = useState<string | null>(null)
  const [isStoppingReanalyzeRequest, setIsStoppingReanalyzeRequest] = useState(false)
  const [elapsedNowMs, setElapsedNowMs] = useState(() => Date.now())
  const [concurrency, setConcurrency] = useState(() => {
    const saved = localStorage.getItem('analysis-concurrency')
    const parsed = saved ? Number.parseInt(saved, 10) : DEFAULT_REANALYZE_CONCURRENCY
    return clampReanalyzeConcurrency(parsed)
  })
  const [allowAiTagging, setAllowAiTagging] = useState(() => {
    const saved = localStorage.getItem('analysis-ai-tagging')
    return saved === '1'
  })
  const includeFilenameTags = true
  const showDownloadToolsUi = isDownloadToolsUiVisible()

  const queryClient = useQueryClient()
  const previousReanalyzeStatusRef = useRef<api.BatchReanalyzeJobState | null>(null)
  const shownWarningJobRef = useRef<string | null>(null)

  const { data: librarySampleCount, refetch: refetchSliceCount } = useQuery<number>({
    queryKey: ['slice-count'],
    queryFn: api.getSliceCount,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })

  const {
    data: reanalyzeJobStatus,
    refetch: refetchReanalyzeStatus,
  } = useQuery<api.BatchReanalyzeStatusResponse>({
    queryKey: ['batch-reanalyze-status'],
    queryFn: api.getBatchReanalyzeStatus,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => (query.state.data?.isActive ? 1000 : 5000),
    refetchIntervalInBackground: true,
  })

  const isReanalyzing = reanalyzeJobStatus?.isActive ?? false
  const isStoppingReanalyze = (reanalyzeJobStatus?.isStopping ?? false) || isStoppingReanalyzeRequest
  const reanalyzeStatus = reanalyzeJobStatus?.resultSummary ?? null
  const reanalyzeTotal = reanalyzeJobStatus?.total ?? (typeof librarySampleCount === 'number' ? librarySampleCount : null)
  const reanalyzeAnalyzed = reanalyzeJobStatus?.analyzed ?? 0
  const reanalyzeFailed = reanalyzeJobStatus?.failed ?? 0
  const reanalyzeProcessed = reanalyzeJobStatus?.processed ?? 0
  const reanalyzeProgressPercent = reanalyzeJobStatus?.progressPercent ?? 0
  const reanalyzeParallelism = reanalyzeJobStatus?.concurrency ?? concurrency
  const statusNote = reanalyzeJobStatus?.statusNote ?? null
  const error = reanalyzeActionError ?? reanalyzeJobStatus?.error ?? null
  const hasReanalyzeReachedCompletion =
    isReanalyzing &&
    !isStoppingReanalyze &&
    reanalyzeProgressPercent >= 100

  const reanalyzeElapsedMs = useMemo(() => {
    const startedAt = reanalyzeJobStatus?.startedAt ? new Date(reanalyzeJobStatus.startedAt).getTime() : Number.NaN
    if (!Number.isFinite(startedAt)) return 0
    const fallbackEnd = isReanalyzing ? elapsedNowMs : Date.now()
    const endAt = reanalyzeJobStatus?.finishedAt ? new Date(reanalyzeJobStatus.finishedAt).getTime() : fallbackEnd
    if (!Number.isFinite(endAt)) return 0
    return Math.max(0, endAt - startedAt)
  }, [reanalyzeJobStatus?.startedAt, reanalyzeJobStatus?.finishedAt, isReanalyzing, elapsedNowMs])
  const reanalyzeEtaLabel = useMemo(() => {
    return formatReanalyzeEtaLabel({
      isStopping: isStoppingReanalyze,
      startedAt: reanalyzeJobStatus?.startedAt,
      processed: reanalyzeProcessed,
      total: reanalyzeTotal ?? 0,
      nowMs: elapsedNowMs,
    })
  }, [
    isStoppingReanalyze,
    reanalyzeJobStatus?.startedAt,
    reanalyzeProcessed,
    reanalyzeTotal,
    elapsedNowMs,
  ])

  const projectionSampleCount = typeof librarySampleCount === 'number'
    ? librarySampleCount
    : Math.max(1, concurrency)
  const tierProjections = useMemo(
    () => buildTierProjections(projectionSampleCount, concurrency, includeFilenameTags),
    [projectionSampleCount, concurrency, includeFilenameTags],
  )
  const isHighSystemPressure = tierProjections.some(
    (projection) => projection.usage.level === 'high' || projection.usage.level === 'extreme',
  )
  const analysisDetailNotes = useMemo(() => {
    const notes: string[] = []
    const highPressureTiers = tierProjections
      .filter((projection) => projection.usage.level === 'high' || projection.usage.level === 'extreme')
      .map((projection) => getCpuTierShortLabel(projection.tier.id))

    if (highPressureTiers.length > 0) {
      const tierList = highPressureTiers.length === 1
        ? highPressureTiers[0]
        : highPressureTiers.length === 2
          ? `${highPressureTiers[0]} and ${highPressureTiers[1]}`
          : `${highPressureTiers.slice(0, -1).join(', ')}, and ${highPressureTiers[highPressureTiers.length - 1]}`
      notes.push(
        `${tierList} may become less responsive at ${formatProcessCountLabel(concurrency)}. Lower parallelism by 1-2 if the app feels sluggish.`,
      )
    }

    if (typeof librarySampleCount !== 'number') {
      notes.push('Runtime estimates stay approximate until the full library sample count finishes loading.')
    }

    return notes
  }, [tierProjections, concurrency, librarySampleCount])

  useEffect(() => {
    localStorage.setItem('analysis-concurrency', String(concurrency))
  }, [concurrency])

  useEffect(() => {
    localStorage.setItem('analysis-ai-tagging', allowAiTagging ? '1' : '0')
  }, [allowAiTagging])

  useEffect(() => {
    if (!isReanalyzing) return
    const timerId = window.setInterval(() => setElapsedNowMs(Date.now()), 500)
    return () => window.clearInterval(timerId)
  }, [isReanalyzing])

  useEffect(() => {
    const currentStatus = reanalyzeJobStatus?.status ?? null
    if (!currentStatus) return
    const previousStatus = previousReanalyzeStatusRef.current
    previousReanalyzeStatusRef.current = currentStatus

    if (
      previousStatus !== currentStatus &&
      (currentStatus === 'completed' || currentStatus === 'failed' || currentStatus === 'canceled')
    ) {
      queryClient.invalidateQueries({ queryKey: ['scopedSamples'] })
      queryClient.invalidateQueries({ queryKey: ['allSlices'] })
      queryClient.invalidateQueries({ queryKey: ['slice-count'] })
    }
  }, [reanalyzeJobStatus?.status, queryClient])

  useEffect(() => {
    if (!reanalyzeJobStatus?.isActive) {
      setIsStoppingReanalyzeRequest(false)
    }
  }, [reanalyzeJobStatus?.isActive])

  useEffect(() => {
    if (!reanalyzeJobStatus) return
    if (reanalyzeJobStatus.status !== 'completed') return
    if (reanalyzeJobStatus.warnings.totalWithWarnings <= 0) return
    if (!reanalyzeJobStatus.jobId) return
    if (shownWarningJobRef.current === reanalyzeJobStatus.jobId) return

    shownWarningJobRef.current = reanalyzeJobStatus.jobId
    const preview = reanalyzeJobStatus.warnings.messages.slice(0, 5)
    const extra = Math.max(0, reanalyzeJobStatus.warnings.messages.length - preview.length)
    const details = preview.map((message) => `• ${message}`).join('\n')

    void showAlert({
      title: 'Analysis Warning',
      message: [
        `Warning: ${reanalyzeJobStatus.warnings.totalWithWarnings} sample(s) had potential custom state before re-analysis.`,
        details,
        extra > 0 ? `...and ${extra} more warning(s).` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    })
  }, [reanalyzeJobStatus, showAlert])

  const handleReanalyzeAll = async () => {
    if (isReanalyzing) return

    const safeConcurrency = clampReanalyzeConcurrency(concurrency)
    if (safeConcurrency !== concurrency) {
      setConcurrency(safeConcurrency)
    }

    const refetchedSliceCount = await refetchSliceCount().catch(() => undefined)
    const sampleCountForEstimate = refetchedSliceCount?.data ?? librarySampleCount
    const sampleCountMessage = typeof sampleCountForEstimate === 'number'
      ? formatSampleCountLabel(sampleCountForEstimate)
      : 'all samples in your library'

    const confirmed = await confirm({
      title: 'Re-analyze All Samples',
      message: [
        `This will re-analyze ${sampleCountMessage} with ${formatProcessCountLabel(safeConcurrency)}.`,
        allowAiTagging
          ? 'AI instrument review via Ollama is enabled and can be very slow.'
          : 'AI instrument review via Ollama is disabled; fallback instrument labeling will be used.',
        'Lower end processors might have trouble executing this.',
        'Continue?',
      ]
        .filter(Boolean)
        .join(' '),
      confirmText: 'Re-analyze',
      cancelText: 'Cancel',
    })

    if (!confirmed) return

    setReanalyzeActionError(null)
    setIsStoppingReanalyzeRequest(false)

    try {
      const startResult = await api.startBatchReanalyzeSamples(
        undefined,
        'advanced',
        safeConcurrency,
        includeFilenameTags,
        allowAiTagging,
      )
      queryClient.setQueryData(['batch-reanalyze-status'], startResult.status)
      await refetchReanalyzeStatus()
    } catch (error) {
      setReanalyzeActionError(getApiErrorMessage(error, 'Failed to start re-analysis'))
    }
  }

  const handleStopReanalyze = () => {
    if (!isReanalyzing || isStoppingReanalyze) return
    setIsStoppingReanalyzeRequest(true)
    setReanalyzeActionError(null)
    void (async () => {
      try {
        const cancelResult = await api.cancelBatchReanalyze()
        queryClient.setQueryData(['batch-reanalyze-status'], cancelResult.status)
      } catch (error) {
        setIsStoppingReanalyzeRequest(false)
        setReanalyzeActionError(getApiErrorMessage(error, 'Failed to stop re-analysis'))
      } finally {
        await refetchReanalyzeStatus().catch(() => undefined)
      }
    })()
  }

  return (
    <div className="max-w-4xl px-3 md:px-4 md:py-5">
      <div className="space-y-4">
        <div>
          <h3 className="text-base font-medium text-white mb-2">Audio Analysis</h3>
          <div className="bg-surface-raised rounded-lg p-4 md:p-5 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h4 className="text-sm font-medium text-white">Re-analyze All Samples</h4>
                <p className="text-xs text-slate-400 mt-0.5">
                  Refresh BPM, key, loudness, and filename-derived tags.
                </p>
              </div>
              <div className="inline-flex items-center gap-2 rounded-md border border-surface-border bg-surface-base/70 px-2 py-1 text-[11px]">
                <span className="text-slate-400">Library</span>
                <span className="font-mono text-slate-100">
                  {typeof librarySampleCount === 'number'
                    ? formatSampleCountLabel(librarySampleCount)
                    : '...'}
                </span>
              </div>
            </div>

            <div className="rounded-lg border border-surface-border bg-surface-base/70 p-3">
              <div className="flex items-center justify-between gap-2">
                <label className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                  Parallelism
                </label>
                <span className="text-[11px] font-mono text-slate-200">
                  {formatProcessCountLabel(concurrency)}
                </span>
              </div>
              <input
                type="range"
                min={1}
                max={MAX_REANALYZE_CONCURRENCY}
                step={1}
                value={concurrency}
                onChange={(e) => setConcurrency(clampReanalyzeConcurrency(Number.parseInt(e.target.value, 10)))}
                className="mt-2 h-1 w-full accent-accent-primary"
                disabled={isReanalyzing}
              />
              <div className="mt-1 flex justify-between text-[10px] text-slate-500">
                <span>1</span>
                <span>4</span>
                <span>7</span>
                <span>10</span>
              </div>
            </div>

            <label className="flex items-start gap-2 rounded-lg border border-surface-border bg-surface-base/70 px-3 py-2.5 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={allowAiTagging}
                onChange={(e) => setAllowAiTagging(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-surface-border bg-surface-base text-accent-primary focus:ring-accent-primary/40"
                disabled={isReanalyzing}
              />
              <span>
                Advanced semantic/tag analysis with AI (VERY slow but more accurate)
              </span>
            </label>

            <div
              className={`rounded-lg border p-2.5 ${
                isHighSystemPressure
                  ? 'border-amber-500/35 bg-amber-500/10'
                  : 'border-surface-border bg-surface-base/70'
              }`}
            >
              <div className="mb-1.5 flex items-center gap-1.5">
                <AlertCircle
                  size={12}
                  className={isHighSystemPressure ? 'text-amber-400' : 'text-slate-400'}
                />
                <span className={isHighSystemPressure ? 'text-[10px] text-amber-300' : 'text-[10px] text-slate-300'}>
                  {isHighSystemPressure
                    ? 'High system pressure likely at this setting.'
                    : 'Estimated runtime and load by CPU tier.'}
                </span>
              </div>

              {typeof librarySampleCount === 'number' ? (
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {tierProjections.map((projection) => (
                    <div
                      key={projection.tier.id}
                      className="rounded-md border border-surface-border bg-surface-base/80 p-2"
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="text-[10px] text-slate-100">
                          {getCpuTierShortLabel(projection.tier.id)}
                        </span>
                        <span
                          className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${getUsageLevelBadgeClass(projection.usage.level)}`}
                        >
                          {projection.usage.level}
                        </span>
                      </div>
                      <div className="mt-0.5 text-[10px] text-slate-300">
                        {formatEstimateRange(projection.runtime)}
                      </div>
                      <div className="mt-0.5 text-[10px] text-slate-400">
                        {Math.round(projection.usage.cpuLoadPercent)}% CPU • {projection.usage.estimatedRamGb.toFixed(1)} GB • {formatProcessCountLabel(projection.runtime.effectiveParallelism)} active
                      </div>
                      {projection.recommendedConcurrency !== concurrency && (
                        <div className="mt-0.5 text-[10px] text-slate-500">
                          Better at {formatProcessCountLabel(projection.recommendedConcurrency)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[11px] text-slate-500">Loading sample count for estimates...</div>
              )}
            </div>

            {analysisDetailNotes.length > 0 && (
              <details className="rounded-lg border border-surface-border bg-surface-base/60 p-2.5">
                <summary className="cursor-pointer list-none text-[11px] text-slate-300">
                  Analysis details
                </summary>
                <ul className="mt-2 space-y-1 text-[11px] text-slate-400">
                  {analysisDetailNotes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </details>
            )}

            {isReanalyzing && !hasReanalyzeReachedCompletion && (
              <div className="rounded-lg border border-accent-primary/30 bg-accent-primary/10 p-3">
                <div className="flex items-start gap-2.5">
                  <RefreshCw size={16} className="mt-0.5 flex-shrink-0 animate-spin text-accent-primary" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-white">
                      Analyzing {reanalyzeTotal ?? '...'} samples • {formatProcessCountLabel(reanalyzeParallelism)} • {formatElapsedTime(reanalyzeElapsedMs)}{reanalyzeEtaLabel ? ` • ETA ${reanalyzeEtaLabel}` : ''}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-300">
                      {isStoppingReanalyze
                        ? 'Stopping analysis and terminating workers...'
                        : `Running advanced feature extraction and tag refresh. It might seem frozen, it's normal.`}
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[11px] text-slate-300">
                      <span>
                        Processed {reanalyzeProcessed}/{reanalyzeTotal ?? '...'} (analyzed {reanalyzeAnalyzed}, failed {reanalyzeFailed})
                      </span>
                      <span className="font-mono text-slate-100">
                        {reanalyzeProgressPercent}%{reanalyzeEtaLabel ? ` • ETA ${reanalyzeEtaLabel}` : ''}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded bg-surface-base/80">
                      <div
                        className={`h-full transition-[width] duration-300 ${
                          isStoppingReanalyze ? 'bg-amber-400' : 'bg-accent-primary'
                        }`}
                        style={{ width: `${Math.max(0, Math.min(100, reanalyzeProgressPercent))}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {hasReanalyzeReachedCompletion && (
              <div className="rounded-md border border-green-500/30 bg-green-500/10 px-3 py-1.5">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={14} className="text-green-400" />
                  <span className="text-[11px] text-green-300">Library successfully analyzed</span>
                </div>
              </div>
            )}

            {!isReanalyzing && reanalyzeStatus && (
              <div className="rounded-lg border border-surface-border bg-surface-base p-2.5">
                <div className="flex items-center gap-2 text-[12px]">
                  <CheckCircle2 size={14} className="flex-shrink-0 text-green-400" />
                  <span className="text-slate-100">
                    {reanalyzeJobStatus?.status === 'canceled' ? 'Stopped' : 'Complete'}: {reanalyzeStatus.analyzed} analyzed, {reanalyzeStatus.failed} failed (of {reanalyzeStatus.total}).
                  </span>
                </div>
              </div>
            )}

            {statusNote && reanalyzeJobStatus?.status === 'canceled' && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5">
                <div className="flex items-center gap-2 text-[12px]">
                  <AlertCircle size={14} className="flex-shrink-0 text-amber-400" />
                  <span className="text-amber-300">{statusNote}</span>
                </div>
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-2.5">
                <div className="flex items-center gap-2 text-[12px]">
                  <AlertCircle size={14} className="flex-shrink-0 text-red-400" />
                  <span className="text-red-400">{error}</span>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                onClick={handleReanalyzeAll}
                disabled={isReanalyzing}
                className={`
                  inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors
                  ${
                    isReanalyzing
                      ? 'cursor-not-allowed bg-surface-base text-slate-400'
                      : 'bg-accent-primary text-white hover:bg-accent-primary/90'
                  }
                `}
              >
                <RefreshCw size={14} className={isReanalyzing ? 'animate-spin' : ''} />
                {isReanalyzing ? 'Re-analyzing...' : 'Re-analyze all samples'}
              </button>
              {isReanalyzing && (
                <button
                  onClick={handleStopReanalyze}
                  disabled={isStoppingReanalyze}
                  className={`
                    inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors
                    ${
                      isStoppingReanalyze
                        ? 'cursor-not-allowed bg-surface-base text-slate-400'
                        : 'border-red-500/40 bg-red-500/15 text-red-300 hover:bg-red-500/25'
                    }
                  `}
                >
                  {isStoppingReanalyze ? 'Stopping...' : 'Stop'}
                </button>
              )}
            </div>
          </div>
        </div>

        {showDownloadToolsUi && (
          <div>
            <h3 className="text-lg font-medium text-white mb-4">System</h3>
            <div className="bg-surface-raised rounded-lg p-6">
              <BackendToolsUpdateSection
                reanalyzeProgress={{
                  isActive: isReanalyzing,
                  isStopping: isStoppingReanalyze,
                  elapsedMs: reanalyzeElapsedMs,
                  total: reanalyzeTotal,
                  processed: reanalyzeProcessed,
                  analyzed: reanalyzeAnalyzed,
                  failed: reanalyzeFailed,
                  progressPercent: reanalyzeProgressPercent,
                  etaLabel: reanalyzeEtaLabel,
                  parallelism: reanalyzeParallelism,
                  statusNote,
                  error,
                  onStop: handleStopReanalyze,
                }}
              />
            </div>
          </div>
        )}

        <div>
          <h3 className="text-lg font-medium text-white mb-4">Manage Backups</h3>
          <div className="bg-surface-raised rounded-lg p-6">
            <ManageBackupsSection />
          </div>
        </div>
      </div>
      {dialogNode}
    </div>
  )
}
