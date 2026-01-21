import { useState } from 'react'
import { Music, Search, ListMusic, Upload, Layers, Sparkles, LogIn, LogOut } from 'lucide-react'
import { TrackList } from './components/TrackList'
import { WaveformEditor } from './components/WaveformEditor'
import { YouTubeSearch } from './components/YouTubeSearch'
import { PlaylistImport } from './components/PlaylistImport'
import { LinkImport } from './components/LinkImport'
import { SliceBrowser } from './components/SliceBrowser'
import { SampleSpaceView } from './components/SampleSpaceView'
import { SetupInstructions } from './components/SetupInstructions'
import { useAuthStatus } from './hooks/useTracks'
import { getGoogleAuthUrl, logout } from './api/client'
import type { Track } from './types'

type Tab = 'tracks' | 'samples' | 'space' | 'search' | 'playlists' | 'import'

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('tracks')
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null)
  const { data: authStatus } = useAuthStatus()
  console.log("AAAAAAA")

  const handleLogin = () => {
    window.location.href = getGoogleAuthUrl()
  }

  const handleLogout = async () => {
    await logout()
    window.location.reload()
  }

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'tracks', label: 'Tracks', icon: <Music size={18} /> },
    { id: 'samples', label: 'Samples', icon: <Layers size={18} /> },
    { id: 'space', label: 'Sample Space', icon: <Sparkles size={18} /> },
    { id: 'search', label: 'Search', icon: <Search size={18} /> },
    { id: 'playlists', label: 'Playlists', icon: <ListMusic size={18} /> },
    { id: 'import', label: 'Import', icon: <Upload size={18} /> },
  ]

  return (
    <div className="min-h-screen bg-gray-900">
      {/* Setup Instructions Overlay */}
      <SetupInstructions />

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
      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className={`grid gap-6 ${activeTab === 'tracks' ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'}`}>
          {/* Left Panel */}
          <div className="space-y-6">
            {activeTab === 'tracks' && (
              <TrackList
                onSelectTrack={setSelectedTrack}
                selectedTrackId={selectedTrack?.id}
              />
            )}
            {activeTab === 'samples' && <SliceBrowser />}
            {activeTab === 'space' && <SampleSpaceView />}
            {activeTab === 'search' && (
              <YouTubeSearch onTrackAdded={() => setActiveTab('tracks')} />
            )}
            {activeTab === 'playlists' && (
              <PlaylistImport
                isAuthenticated={authStatus?.authenticated || false}
                onTracksAdded={() => setActiveTab('tracks')}
              />
            )}
            {activeTab === 'import' && (
              <LinkImport onTracksAdded={() => setActiveTab('tracks')} />
            )}
          </div>

          {/* Right Panel - Waveform Editor (only on tracks tab) */}
          {activeTab === 'tracks' && (
            <div>
              {selectedTrack && selectedTrack.status === 'ready' ? (
                <WaveformEditor track={selectedTrack} />
              ) : selectedTrack ? (
                <div className="bg-gray-800 rounded-lg p-8 text-center">
                  <div className="animate-pulse text-gray-400">
                    {selectedTrack.status === 'downloading'
                      ? 'Downloading audio...'
                      : selectedTrack.status === 'pending'
                      ? 'Waiting to process...'
                      : 'Error processing track'}
                  </div>
                </div>
              ) : (
                <div className="bg-gray-800 rounded-lg p-8 text-center text-gray-500">
                  Select a track to edit samples
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

export default App
