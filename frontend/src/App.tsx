import { useEffect, useState } from 'react'
import {
  LogOut,
  Settings,
  X,
  Volume2,
  VolumeX,
  Play,
  MousePointerClick,
  Repeat,
} from 'lucide-react'
import { YouTubeHub } from './components/YouTubeHub'
import { SourcesSettings } from './components/SourcesSettings'
import { WorkspaceLayout } from './components/WorkspaceLayout'
import { GlobalTuneControl } from './components/GlobalTuneControl'
import type { PlayMode } from './components/SourcesView'
import { useAuthStatus } from './hooks/useTracks'
import { useDrumRack } from './contexts/DrumRackContext'
import { logout } from './api/client'

type Tab = 'workspace' | 'youtube' | 'settings'
const SETTINGS_TRANSITION_MS = 220

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
  const [activeTab, setActiveTab] = useState<Tab>('workspace')
  const [isSettingsRendered, setIsSettingsRendered] = useState(false)
  const [isSettingsVisible, setIsSettingsVisible] = useState(false)
  const [tuneTargetNote, setTuneTargetNote] = useState<string | null>(null)
  const [samplePlayMode, setSamplePlayMode] = useState<PlayMode>('normal')
  const [sampleLoopEnabled, setSampleLoopEnabled] = useState(false)
  const { data: authStatus } = useAuthStatus()

  useEffect(() => {
    if (activeTab === 'settings') {
      setIsSettingsRendered(true)
      const rafId = window.requestAnimationFrame(() => setIsSettingsVisible(true))
      return () => window.cancelAnimationFrame(rafId)
    }

    setIsSettingsVisible(false)
  }, [activeTab])

  useEffect(() => {
    if (activeTab === 'settings' || !isSettingsRendered) return

    const timeoutId = window.setTimeout(() => {
      setIsSettingsRendered(false)
    }, SETTINGS_TRANSITION_MS)

    return () => window.clearTimeout(timeoutId)
  }, [activeTab, isSettingsRendered])

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

  const handleOpenImport = () => {
    setActiveTab('youtube')
  }

  return (
    <div className="h-screen overflow-hidden bg-surface-base flex flex-col">
      {/* ── Header ─────────────────────────── */}
      <header className="bg-surface-raised border-b border-surface-border shrink-0">
        <div className="px-3 py-1.5 sm:px-4 flex items-center justify-between gap-3">
          {/* Left zone: Tune control */}
          <div className="flex items-center min-w-0">
            <GlobalTuneControl
              tuneTargetNote={tuneTargetNote}
              onTuneTargetNoteChange={setTuneTargetNote}
            />
          </div>

          {/* Right zone: Playback + Volume + Auth */}
          <div className="flex items-center gap-1.5 shrink-0">
            <SamplePlayModeControl
              playMode={samplePlayMode}
              loopEnabled={sampleLoopEnabled}
              onCyclePlayMode={handleCycleSamplePlayMode}
              onToggleLoop={() => setSampleLoopEnabled((prev) => !prev)}
            />
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
            {activeTab === 'youtube' && (
              <div className="flex items-center gap-1.5 pl-2.5 border-l border-surface-border">
                <button
                  type="button"
                  onClick={() => setActiveTab('workspace')}
                  className="p-1.5 rounded-lg border border-surface-border bg-surface-overlay text-text-secondary hover:text-text-primary hover:bg-surface-raised transition-colors"
                  title="Close and return to workspace"
                  aria-label="Close and return to workspace"
                >
                  <X size={14} />
                </button>
              </div>
            )}

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
        {activeTab === 'workspace' && (
          <WorkspaceLayout
            mode="workspace"
            tuneTargetNote={tuneTargetNote}
            onTuneToNote={setTuneTargetNote}
            samplePlayMode={samplePlayMode}
            sampleLoopEnabled={sampleLoopEnabled}
            onOpenAddSource={handleOpenImport}
          />
        )}
        {activeTab === 'youtube' && (
          <YouTubeHub
            onTracksAdded={() => setActiveTab('workspace')}
            onClose={() => setActiveTab('workspace')}
          />
        )}
        {isSettingsRendered && (
          <section
            className={`absolute inset-0 z-30 overflow-auto bg-surface-base transition-opacity duration-[220ms] ease-in-out ${
              isSettingsVisible
                ? 'opacity-100'
                : 'pointer-events-none opacity-0'
            }`}
          >
            <div className="mx-auto w-full max-w-5xl px-4 py-5">
              <SourcesSettings />
            </div>
          </section>
        )}
      </main>
    </div>
  )
}

export default App
