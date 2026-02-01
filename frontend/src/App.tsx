import { useState } from 'react'
import { Music, FileUp, LogOut } from 'lucide-react'
import { YouTubeHub } from './components/YouTubeHub'
import { SourcesView } from './components/SourcesView'
import { useAuthStatus } from './hooks/useTracks'
import { logout } from './api/client'

type Tab = 'sources' | 'youtube'

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('sources')
  const { data: authStatus } = useAuthStatus()

  const handleLogout = async () => {
    await logout()
    window.location.reload()
  }

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'sources', label: 'Sources', icon: <Music size={18} /> },
    { id: 'youtube', label: 'Import', icon: <FileUp size={18} /> },
  ]

  return (
    <div className="min-h-screen bg-surface-base">
      {/* Header */}
      <header className="bg-surface-raised border-b border-surface-border">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
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
      <main className={activeTab === 'sources' || activeTab === 'youtube' ? 'h-[calc(100vh-120px)]' : 'max-w-7xl mx-auto px-4 py-6'}>
        {activeTab === 'sources' && <SourcesView />}
        {activeTab === 'youtube' && (
          <YouTubeHub onTracksAdded={() => setActiveTab('sources')} />
        )}
      </main>
    </div>
  )
}

export default App
