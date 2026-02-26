import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  LogOut,
  Settings,
  X,
  Volume2,
  VolumeX,
  Square,
  Play,
  MousePointerClick,
  Repeat,
} from 'lucide-react'
import { SourcesSettings } from './components/SourcesSettings'
import { WorkspaceLayout } from './components/WorkspaceLayout'
import { GlobalTuneControl } from './components/GlobalTuneControl'
import type { PlayMode } from './components/SourcesView'
import { useAuthStatus } from './hooks/useTracks'
import { useImportProgress } from './hooks/useImportProgress'
import { useDrumRack } from './contexts/DrumRackContext'
import { getBatchReanalyzeStatus, getImportAnalysisStatus, getSliceCount, logout } from './api/client'
import { ensureGlobalAudioTracking, panicStopAllAudio } from './services/globalAudioVolume'
import { formatReanalyzeEtaLabel } from './utils/reanalyzeEta'

type Tab = 'workspace' | 'settings'
const SETTINGS_TRANSITION_MS = 220
const LARGE_REANALYZE_SAMPLE_THRESHOLD = 50
const NAVBAR_REANALYZE_SUCCESS_MS = 30_000

type NavbarReanalyzeIndicator =
  | {
      kind: 'progress'
      total: number
      processed: number
      progressPercent: number
      isStopping: boolean
      etaLabel: string | null
    }
  | {
      kind: 'success'
    }

type NavbarImportIndicator =
  | {
      kind: 'progress'
      title: string
      detail: string
      progressPercent: number
      isProcessing: boolean
    }
  | {
      kind: 'success'
      message: string
    }
  | {
      kind: 'error'
      message: string
    }

function formatBytes(bytes: number): string {
  const safeBytes = Number.isFinite(bytes) ? Math.max(0, bytes) : 0
  if (safeBytes < 1024) return `${safeBytes} B`
  if (safeBytes < 1024 * 1024) return `${(safeBytes / 1024).toFixed(1)} KB`
  if (safeBytes < 1024 * 1024 * 1024) return `${(safeBytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(safeBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

interface SamplePlayModeControlProps {
  playMode: PlayMode
  loopEnabled: boolean
  onCyclePlayMode: () => void
  onToggleLoop: () => void
}

function SamplePlayModeControl({
  playMode,
  loopEnabled,
  onCyclePlayMode,
  onToggleLoop,
}: SamplePlayModeControlProps) {
  const isHoldMode = playMode === 'reproduce-while-clicking'

  return (
    <div className="flex items-center gap-1 pl-2.5 border-l border-surface-border">
      <button
        type="button"
        onClick={onCyclePlayMode}
        className="flex items-center gap-1 px-2 py-1 bg-surface-overlay border border-surface-border rounded-md text-xs text-text-secondary hover:text-text-primary hover:bg-surface-raised transition-colors"
        title={isHoldMode ? 'Only play while clicking' : 'Play until stop'}
      >
        {isHoldMode ? (
          <MousePointerClick size={13} />
        ) : (
          <Play size={13} />
        )}
        <span className="hidden xl:inline">
          {isHoldMode ? 'While clicking' : 'Play until stop'}
        </span>
      </button>

      <button
        type="button"
        onClick={onToggleLoop}
        className={`flex items-center gap-1 px-2 py-1 border rounded-md text-xs transition-colors ${
          loopEnabled
            ? 'bg-accent-warm/20 border-accent-warm/50 text-accent-warm'
            : 'bg-surface-overlay border-surface-border text-text-secondary hover:text-text-primary hover:bg-surface-raised'
        }`}
        title={loopEnabled ? 'Loop enabled' : 'Loop disabled'}
      >
        <Repeat size={13} />
      </button>
    </div>
  )
}

function MasterVolumeControl() {
  const { setMasterVolume, getMasterVolume } = useDrumRack()
  const [volume, setVolume] = useState(() => {
    const initialVolume = getMasterVolume()
    return Number.isFinite(initialVolume) ? initialVolume : 0.9
  })

  const handleVolumeChange = (value: number) => {
    const safeVolume = Number.isFinite(value)
      ? Math.max(0, Math.min(1, value))
      : 0

    setVolume(safeVolume)
    setMasterVolume(safeVolume)
  }

  const volumePercent = Math.round(volume * 100)

  return (
    <div className="flex items-center gap-1.5 pl-2.5 border-l border-surface-border">
      {volume <= 0.001 ? (
        <VolumeX size={14} className="text-text-muted shrink-0" />
      ) : (
        <Volume2 size={14} className="text-text-muted shrink-0" />
      )}
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={volume}
        onChange={(e) => handleVolumeChange(Number(e.target.value))}
        className="w-16 sm:w-20 h-1 appearance-none bg-surface-border rounded-full slider-thumb"
        title={`Master volume ${volumePercent}%`}
      />
      <span className="text-[10px] text-text-muted font-mono w-7 text-right hidden md:inline">
        {volumePercent}
      </span>
    </div>
  )
}

function App() {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<Tab>('workspace')
  const [isSettingsRendered, setIsSettingsRendered] = useState(false)
  const [isSettingsVisible, setIsSettingsVisible] = useState(false)
  const [tuneTargetNote, setTuneTargetNote] = useState<string | null>(null)
  const [samplePlayMode, setSamplePlayMode] = useState<PlayMode>('normal')
  const [sampleLoopEnabled, setSampleLoopEnabled] = useState(false)
  const [etaNowMs, setEtaNowMs] = useState(() => Date.now())
  const wasImportAnalysisActiveRef = useRef(false)
  const importProgress = useImportProgress()
  const { data: authStatus } = useAuthStatus()
  const { data: reanalyzeStatus } = useQuery({
    queryKey: ['batch-reanalyze-status'],
    queryFn: getBatchReanalyzeStatus,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => (query.state.data?.isActive ? 1000 : 5000),
    refetchIntervalInBackground: true,
  })
  const { data: librarySampleCount } = useQuery({
    queryKey: ['slice-count'],
    queryFn: getSliceCount,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })
  const { data: importAnalysisStatus } = useQuery({
    queryKey: ['import-analysis-status'],
    queryFn: getImportAnalysisStatus,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => (query.state.data?.isActive ? 1000 : 4000),
    refetchIntervalInBackground: true,
  })

  useEffect(() => {
    if (activeTab === 'settings') {
      setIsSettingsRendered(true)
      return
    }

    setIsSettingsVisible(false)
  }, [activeTab])

  useEffect(() => {
    ensureGlobalAudioTracking()
  }, [])

  useEffect(() => {
    if (activeTab !== 'settings' || !isSettingsRendered) return

    // Use two animation frames so the hidden state is committed and painted
    // before switching to visible; this guarantees the enter transition runs.
    let nextFrameId = 0
    const frameId = window.requestAnimationFrame(() => {
      nextFrameId = window.requestAnimationFrame(() => setIsSettingsVisible(true))
    })

    return () => {
      window.cancelAnimationFrame(frameId)
      if (nextFrameId) window.cancelAnimationFrame(nextFrameId)
    }
  }, [activeTab, isSettingsRendered])

  useEffect(() => {
    if (activeTab === 'settings' || !isSettingsRendered) return

    const timeoutId = window.setTimeout(() => {
      setIsSettingsRendered(false)
    }, SETTINGS_TRANSITION_MS)

    return () => window.clearTimeout(timeoutId)
  }, [activeTab, isSettingsRendered])

  useEffect(() => {
    if (!reanalyzeStatus?.isActive) return

    const timerId = window.setInterval(() => {
      setEtaNowMs(Date.now())
    }, 500)

    return () => window.clearInterval(timerId)
  }, [reanalyzeStatus?.isActive])

  useEffect(() => {
    if (!importAnalysisStatus?.isActive) return

    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: ['allSlices'] })
      void queryClient.invalidateQueries({ queryKey: ['scopedSamples'] })
      void queryClient.invalidateQueries({ queryKey: ['tracks'] })
    }

    refresh()
    const timerId = window.setInterval(refresh, 1500)
    return () => window.clearInterval(timerId)
  }, [importAnalysisStatus?.isActive, queryClient])

  useEffect(() => {
    const isActive = Boolean(importAnalysisStatus?.isActive)
    if (wasImportAnalysisActiveRef.current && !isActive) {
      void queryClient.invalidateQueries({ queryKey: ['allSlices'] })
      void queryClient.invalidateQueries({ queryKey: ['scopedSamples'] })
      void queryClient.invalidateQueries({ queryKey: ['tracks'] })
      void queryClient.invalidateQueries({ queryKey: ['sourceTree'] })
    }
    wasImportAnalysisActiveRef.current = isActive
  }, [importAnalysisStatus?.isActive, queryClient])

  const handleLogout = async () => {
    await logout()
    window.location.reload()
  }

  const handleCycleSamplePlayMode = () => {
    setSamplePlayMode((prev) => {
      if (prev === 'normal') return 'reproduce-while-clicking'
      return 'normal'
    })
  }

  const handleCloseSettings = () => {
    setActiveTab('workspace')
  }

  const navbarReanalyzeIndicator = useMemo<NavbarReanalyzeIndicator | null>(() => {
    if (!reanalyzeStatus) return null
    if (reanalyzeStatus.total <= 0) return null

    const isWholeLibraryBatch =
      typeof librarySampleCount === 'number' &&
      librarySampleCount > 0 &&
      reanalyzeStatus.total >= librarySampleCount
    const isLargeBatch = reanalyzeStatus.total >= LARGE_REANALYZE_SAMPLE_THRESHOLD
    if (!isWholeLibraryBatch && !isLargeBatch) return null

    const progressPercent = Math.max(0, Math.min(100, reanalyzeStatus.progressPercent))
    const finishedAtMs = reanalyzeStatus.finishedAt
      ? new Date(reanalyzeStatus.finishedAt).getTime()
      : Number.NaN
    const isCompletedRecently =
      Number.isFinite(finishedAtMs) &&
      Date.now() - finishedAtMs <= NAVBAR_REANALYZE_SUCCESS_MS
    const hasReachedCompletion =
      !reanalyzeStatus.isStopping &&
      reanalyzeStatus.status !== 'failed' &&
      reanalyzeStatus.status !== 'canceled' &&
      progressPercent >= 100 &&
      (reanalyzeStatus.isActive || isCompletedRecently)

    if (hasReachedCompletion) {
      return { kind: 'success' }
    }

    if (!reanalyzeStatus.isActive) return null

    const etaLabel = formatReanalyzeEtaLabel({
      isStopping: reanalyzeStatus.isStopping,
      startedAt: reanalyzeStatus.startedAt,
      processed: reanalyzeStatus.processed,
      total: reanalyzeStatus.total,
      nowMs: etaNowMs,
    })

    return {
      kind: 'progress',
      total: reanalyzeStatus.total,
      processed: reanalyzeStatus.processed,
      progressPercent,
      isStopping: reanalyzeStatus.isStopping,
      etaLabel,
    }
  }, [reanalyzeStatus, librarySampleCount, etaNowMs])

  const navbarImportIndicator = useMemo<NavbarImportIndicator | null>(() => {
    const activeImport = importProgress.active
    if (activeImport) {
      const sourceLabel = activeImport.sourceKind === 'folder' ? 'folder' : 'files'
      const modeLabel = activeImport.importType === 'sample' ? 'sample mode' : 'track mode'
      const fileCountLabel = typeof activeImport.totalFiles === 'number'
        ? `${activeImport.totalFiles} ${activeImport.totalFiles === 1 ? 'file' : 'files'}`
        : 'unknown file count'
      const byteProgressLabel = activeImport.totalBytes && activeImport.totalBytes > 0
        ? `${formatBytes(activeImport.uploadedBytes)} / ${formatBytes(activeImport.totalBytes)}`
        : null
      const detailParts = [fileCountLabel, modeLabel]
      if (byteProgressLabel) detailParts.push(byteProgressLabel)
      if (importProgress.activeCount > 1) {
        detailParts.push(`${importProgress.activeCount} active imports`)
      }
      return {
        kind: 'progress',
        title: activeImport.phase === 'processing'
          ? `Processing imported ${sourceLabel}`
          : `Importing ${sourceLabel}`,
        detail: detailParts.join(' • '),
        progressPercent: Math.max(0, Math.min(100, activeImport.progressPercent)),
        isProcessing: activeImport.phase === 'processing',
      }
    }

    const latestImport = importProgress.latest
    if (!latestImport) return null

    if (latestImport.phase === 'success') {
      const successful = latestImport.successful ?? 0
      const total = latestImport.totalFiles ?? successful
      const failed = latestImport.failed ?? 0
      const failedMessage = failed > 0 ? `, ${failed} failed` : ''
      return {
        kind: 'success',
        message: `Imported ${successful}/${total} files${failedMessage}.`,
      }
    }

    if (latestImport.phase === 'error') {
      return {
        kind: 'error',
        message: latestImport.message || 'Import failed.',
      }
    }

    return null
  }, [importProgress])

  const hasNavbarIndicators = Boolean(navbarImportIndicator || navbarReanalyzeIndicator)

  return (
    <div className="h-screen overflow-hidden bg-surface-base flex flex-col">
      {/* ── Header ─────────────────────────── */}
      <header className="bg-surface-raised border-b border-surface-border shrink-0">
        <div className="px-3 py-1.5 sm:px-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          {/* Left zone: Tune control */}
          <div className="flex items-center min-w-0 shrink-0">
            <GlobalTuneControl
              tuneTargetNote={tuneTargetNote}
              onTuneTargetNoteChange={setTuneTargetNote}
            />
          </div>

          {hasNavbarIndicators && (
            <div className="order-3 basis-full min-w-0 flex flex-col gap-1 md:order-none md:flex-1 md:basis-auto md:items-center">
              {navbarImportIndicator?.kind === 'progress' ? (
                <div
                  className="w-full md:max-w-md rounded-md border border-emerald-400/30 bg-surface-overlay px-2 py-1"
                  title={`${navbarImportIndicator.title} — ${navbarImportIndicator.detail}`}
                >
                  <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide">
                    <span className={navbarImportIndicator.isProcessing ? 'text-amber-300' : 'text-emerald-300'}>
                      {navbarImportIndicator.title}
                    </span>
                    <span className="font-mono text-slate-200">{navbarImportIndicator.progressPercent}%</span>
                  </div>
                  <div className="mb-1 text-[10px] text-slate-300 truncate">
                    {navbarImportIndicator.detail}
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-surface-border">
                    <div
                      className={`h-full rounded-full transition-[width] duration-300 ${
                        navbarImportIndicator.isProcessing
                          ? 'bg-gradient-to-r from-amber-400 to-orange-300 animate-pulse'
                          : 'bg-gradient-to-r from-emerald-400 to-cyan-300'
                      }`}
                      style={{ width: `${navbarImportIndicator.progressPercent}%` }}
                    />
                  </div>
                </div>
              ) : navbarImportIndicator?.kind === 'success' ? (
                <div className="w-full md:max-w-md rounded-md border border-green-400/25 bg-green-500/10 px-2 py-1 text-center text-[10px] uppercase tracking-wide text-green-300">
                  {navbarImportIndicator.message}
                </div>
              ) : navbarImportIndicator?.kind === 'error' ? (
                <div className="w-full md:max-w-md rounded-md border border-red-400/25 bg-red-500/10 px-2 py-1 text-center text-[10px] uppercase tracking-wide text-red-300 truncate">
                  {navbarImportIndicator.message}
                </div>
              ) : null}

              {navbarReanalyzeIndicator?.kind === 'progress' ? (
                <div
                  className="w-full md:max-w-md rounded-md border border-accent-primary/25 bg-surface-overlay px-2 py-1"
                  title={`Re-analyzing ${navbarReanalyzeIndicator.processed}/${navbarReanalyzeIndicator.total} samples`}
                >
                  <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide">
                    <span className={navbarReanalyzeIndicator.isStopping ? 'text-amber-300' : 'text-accent-primary'}>
                      {navbarReanalyzeIndicator.isStopping ? 'Stopping re-analysis...' : 'Re-analyzing samples'}
                    </span>
                    <span className="font-mono text-slate-200">
                      {navbarReanalyzeIndicator.progressPercent}%
                      {navbarReanalyzeIndicator.etaLabel ? ` ETA ${navbarReanalyzeIndicator.etaLabel}` : ''}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-surface-border">
                    <div
                      className={`h-full rounded-full transition-[width] duration-300 ${
                        navbarReanalyzeIndicator.isStopping
                          ? 'bg-gradient-to-r from-amber-400 to-amber-300'
                          : 'bg-gradient-to-r from-accent-primary to-cyan-400'
                      }`}
                      style={{ width: `${navbarReanalyzeIndicator.progressPercent}%` }}
                    />
                  </div>
                </div>
              ) : navbarReanalyzeIndicator?.kind === 'success' ? (
                <div className="w-full md:max-w-md rounded-md border border-green-400/25 bg-green-500/10 px-2 py-1 text-center text-[10px] uppercase tracking-wide text-green-300">
                  Library successfully analyzed
                </div>
              ) : null}
            </div>
          )}

          {/* Right zone: Playback + Volume + Auth */}
          <div className="ml-auto flex items-center gap-1.5 shrink-0">
            <SamplePlayModeControl
              playMode={samplePlayMode}
              loopEnabled={sampleLoopEnabled}
              onCyclePlayMode={handleCycleSamplePlayMode}
              onToggleLoop={() => setSampleLoopEnabled((prev) => !prev)}
            />
            <div className="flex items-center pl-2.5 border-l border-surface-border">
              <button
                type="button"
                onClick={panicStopAllAudio}
                className="flex items-center gap-1 px-2 py-1 border border-red-400/40 bg-red-500/15 rounded-md text-xs text-red-200 hover:bg-red-500/25 transition-colors"
                title="Panic stop all audio"
                aria-label="Panic stop all audio"
              >
                <Square size={12} className="fill-current" />
                <span className="hidden xl:inline">Panic</span>
              </button>
            </div>
            <MasterVolumeControl />
            <div className="flex items-center gap-1.5 pl-2.5 border-l border-surface-border">
              <button
                type="button"
                onClick={() =>
                  setActiveTab((prev) => (prev === 'settings' ? 'workspace' : 'settings'))
                }
                className={`p-1.5 rounded-lg border transition-colors ${
                  activeTab === 'settings'
                    ? 'border-accent-primary/50 bg-accent-primary/15 text-accent-primary'
                    : 'border-surface-border bg-surface-overlay text-text-secondary hover:text-text-primary hover:bg-surface-raised'
                }`}
                title={activeTab === 'settings' ? 'Close settings' : 'Open settings'}
                aria-label={activeTab === 'settings' ? 'Close settings' : 'Open settings'}
              >
                <Settings size={14} />
              </button>
            </div>
            {authStatus?.authenticated && (
              <div className="flex items-center gap-1.5 pl-2.5 border-l border-surface-border">
                {authStatus.user?.picture && (
                  <img
                    src={authStatus.user.picture}
                    alt={authStatus.user?.name}
                    className="w-5 h-5 rounded-full ring-1 ring-surface-border"
                  />
                )}
                <span className="text-xs text-text-muted hidden lg:block truncate max-w-[120px]">
                  {authStatus.user?.name}
                </span>
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-1 px-1.5 py-1 text-xs text-text-muted hover:text-text-primary rounded-md hover:bg-surface-overlay transition-colors"
                  title="Logout"
                >
                  <LogOut size={13} />
                  <span className="hidden lg:inline">Logout</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── Main Content ─────────────────────────────────── */}
      <main className="relative flex-1 min-h-0 overflow-hidden">
        <WorkspaceLayout
          mode="workspace"
          tuneTargetNote={tuneTargetNote}
          onTuneToNote={setTuneTargetNote}
          samplePlayMode={samplePlayMode}
          sampleLoopEnabled={sampleLoopEnabled}
        />
        {isSettingsRendered && (
          <section
            className={`fixed inset-0 z-40 flex items-center justify-center p-3 sm:p-5 transition-opacity duration-[220ms] ease-in-out ${
              isSettingsVisible
                ? 'opacity-100'
                : 'pointer-events-none opacity-0'
            }`}
            role="dialog"
            aria-modal="true"
            aria-label="Settings"
          >
            <div className="absolute inset-0 bg-surface-base/70" />
            <div className="relative z-10 flex h-[94vh] w-fit max-w-full flex-col overflow-hidden rounded-xl border border-surface-border bg-surface-raised shadow-2xl sm:h-[90vh]">
              <div className="flex items-center justify-between border-b border-surface-border px-4 py-3">
                <h2 className="text-base font-semibold text-text-primary">Settings</h2>
                <button
                  type="button"
                  onClick={handleCloseSettings}
                  className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-overlay hover:text-text-primary"
                  aria-label="Close settings"
                  title="Close settings"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="mx-auto w-fit max-w-full px-4 py-5">
                  <SourcesSettings />
                </div>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}

export default App
