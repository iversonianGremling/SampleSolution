import { useState } from 'react'
import { Music, FileUp, Layers, LogIn, LogOut, Mic2 } from 'lucide-react'
import { YouTubeHub } from './components/YouTubeHub'
import { UnifiedSamplesView } from './components/UnifiedSamplesView'
import { SourcesView } from './components/SourcesView'
import { EditingView } from './components/EditingView'
import { useAuthStatus } from './hooks/useTracks'
import { getGoogleAuthUrl, logout } from './api/client'

type Tab = 'sources' | 'samples' | 'editing' | 'youtube'

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('sources')
  const { data: authStatus } = useAuthStatus()

  const handleLogin = () => {
    window.location.href = getGoogleAuthUrl()
  }

  const handleLogout = async () => {
    await logout()
    window.location.reload()
  }

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'sources', label: 'Sources', icon: <Music size={18} /> },
    { id: 'samples', label: 'Samples', icon: <Layers size={18} /> },
    { id: 'editing', label: 'Editing', icon: <Mic2 size={18} /> },
    { id: 'youtube', label: 'Import', icon: <FileUp size={18} /> },
  ]

  return (
    <div className="min-h-screen bg-gray-900">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Music className="text-indigo-500" size={28} />
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
                <span className="text-sm text-gray-300">{authStatus.user?.name}</span>
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-300 hover:text-white transition-colors"
                >
                  <LogOut size={16} />
                  Logout
                </button>
              </div>
            ) : (
              <button
                onClick={handleLogin}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors"
              >
                <LogIn size={16} />
                Sign in with Google
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Navigation Tabs */}
      <nav className="bg-gray-800 border-b border-gray-700">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex gap-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'text-indigo-400 border-b-2 border-indigo-400'
                    : 'text-gray-400 hover:text-gray-200'
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
      <main className={activeTab === 'sources' || activeTab === 'editing' ? 'h-[calc(100vh-120px)]' : activeTab === 'youtube' ? 'h-[calc(100vh-120px)]' : 'max-w-7xl mx-auto px-4 py-6'}>
        {activeTab === 'sources' && <SourcesView />}
        {activeTab === 'samples' && <UnifiedSamplesView />}
        {activeTab === 'editing' && <EditingView />}
        {activeTab === 'youtube' && (
          <YouTubeHub onTracksAdded={() => setActiveTab('sources')} />
        )}
      </main>
    </div>
  )
}

export default App
