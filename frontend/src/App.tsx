import { useState } from 'react'
import { Music, FileUp, LogOut, Settings, Volume2, VolumeX, Home } from 'lucide-react'
import { YouTubeHub } from './components/YouTubeHub'
import { SourcesSettings } from './components/SourcesSettings'
import { WorkspaceLayout } from './components/WorkspaceLayout'
import { useAuthStatus } from './hooks/useTracks'
import { useDrumRack } from './contexts/DrumRackContext'
import { logout } from './api/client'

type Tab = 'workspace' | 'youtube' | 'settings'

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
    <div className="flex items-center gap-2 pl-3 border-l border-surface-border/80">
      {volume <= 0.001 ? (
        <VolumeX size={16} className="text-slate-500" />
      ) : (
        <Volume2 size={16} className="text-slate-500" />
      )}
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={volume}
        onChange={(e) => handleVolumeChange(Number(e.target.value))}
        className="w-20 sm:w-24 h-1 appearance-none bg-surface-border rounded-full slider-thumb"
        title={`Master volume ${volumePercent}%`}
      />
      <span className="text-[10px] text-slate-500 font-mono w-7 text-right hidden sm:inline">
        {volumePercent}
      </span>
    </div>
  )
}

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('workspace')
  const { data: authStatus } = useAuthStatus()

  const handleLogout = async () => {
    await logout()
    window.location.reload()
  }

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'workspace', label: 'Workspace', icon: <Home size={18} /> },
    { id: 'youtube', label: 'Import', icon: <FileUp size={18} /> },
    { id: 'settings', label: 'Settings', icon: <Settings size={18} /> },
  ]

  return (
    <div className="min-h-screen bg-surface-base">
      {/* Header */}
      <header className="bg-surface-raised border-b border-surface-border">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <Music className="text-accent-primary" size={28} />
            <h1 className="text-xl font-bold text-white">Sample Solution</h1>
          </div>

          <div className="flex items-center gap-4">
            {authStatus?.authenticated ? (
              <div className="flex items-center gap-3">
                <img
                  src={authStatus.user?.picture}
                  alt={authStatus.user?.name}
                  className="w-8 h-8 rounded-full"
                />
                <span className="text-sm text-slate-300">{authStatus.user?.name}</span>
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm text-slate-400 hover:text-white transition-colors"
                >
                  <LogOut size={16} />
                  Logout
                </button>
              </div>
            ) : (
              ''
            )}

            <MasterVolumeControl />
          </div>
        </div>
      </header>

      {/* Navigation Tabs */}
      <nav className="bg-surface-raised border-b border-surface-border">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex gap-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'text-accent-primary border-b-2 border-accent-primary'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className={activeTab === 'workspace' || activeTab === 'youtube' ? 'h-[calc(100vh-120px)]' : 'max-w-7xl mx-auto px-4 py-6'}>
        {activeTab === 'workspace' && <WorkspaceLayout />}
        {activeTab === 'youtube' && (
          <YouTubeHub onTracksAdded={() => setActiveTab('workspace')} />
        )}
        {activeTab === 'settings' && <SourcesSettings />}
      </main>
    </div>
  )
}

export default App
