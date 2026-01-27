import { useState } from 'react'
import { LinkImport } from './LinkImport'
import { YouTubeSearch } from './YouTubeSearch'
import { PlaylistImport } from './PlaylistImport'
import { useAuthStatus } from '../hooks/useTracks'
import { getGoogleAuthUrl } from '../api/client'
import { LogIn, ExternalLink } from 'lucide-react'

interface YouTubeHubProps {
  onTracksAdded: () => void
}

export function YouTubeHub({ onTracksAdded }: YouTubeHubProps) {
  const { data: authStatus } = useAuthStatus()
  const [activeSubTab, setActiveSubTab] = useState<'search' | 'playlists'>('search')

  return (
    <div className="flex flex-col h-full gap-4 p-4">
      {/* Import Section - Top */}
      <div className="flex-shrink-0">
        <LinkImport onTracksAdded={onTracksAdded} />
      </div>

      {/* Divider */}
      <div className="border-t border-gray-700" />

      {/* Search & Playlists Section - Bottom */}
      <div className="flex-1 flex flex-col min-h-0">
        {!authStatus?.authenticated ? (
          /* Not Authenticated - Show Sign In Prompt */
          <div className="bg-gray-800 rounded-lg p-8 text-center">
            <h2 className="text-xl font-semibold text-white mb-4">
              Sign in to Access YouTube Features
            </h2>
            <p className="text-gray-400 mb-6 max-w-2xl mx-auto">
              Sign in with Google to search YouTube and access your playlists, including private ones.
            </p>

            <a
              href={getGoogleAuthUrl()}
              className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors mb-8"
            >
              <LogIn size={18} />
              Sign in with Google
            </a>

            {/* Instructions for Getting YouTube API Tokens */}
            <div className="bg-gray-900 rounded-lg p-6 text-left max-w-3xl mx-auto">
              <h3 className="text-lg font-semibold text-white mb-3">
                How to Set Up YouTube API Access
              </h3>
              <ol className="text-sm text-gray-300 space-y-3 list-decimal list-inside">
                <li>
                  Go to the{' '}
                  <a
                    href="https://console.cloud.google.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:text-blue-300 inline-flex items-center gap-1"
                  >
                    Google Cloud Console
                    <ExternalLink size={12} />
                  </a>
                </li>
                <li>Create a new project or select an existing one</li>
                <li>
                  Enable the{' '}
                  <a
                    href="https://console.cloud.google.com/apis/library/youtube.googleapis.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:text-blue-300 inline-flex items-center gap-1"
                  >
                    YouTube Data API v3
                    <ExternalLink size={12} />
                  </a>
                </li>
                <li>
                  Go to{' '}
                  <a
                    href="https://console.cloud.google.com/apis/credentials"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:text-blue-300 inline-flex items-center gap-1"
                  >
                    Credentials
                    <ExternalLink size={12} />
                  </a>
                  {' '}and create:
                  <ul className="ml-6 mt-2 space-y-1 list-disc">
                    <li>An API Key (for YouTube search)</li>
                    <li>
                      OAuth 2.0 Client ID (for accessing your playlists)
                      <ul className="ml-6 mt-1 space-y-1 list-circle">
                        <li>Application type: Web application</li>
                        <li>Authorized redirect URI: <code className="text-xs bg-gray-800 px-1 py-0.5 rounded">http://localhost:4000/api/auth/google/callback</code></li>
                      </ul>
                    </li>
                  </ul>
                </li>
                <li>
                  Add the credentials to your <code className="text-xs bg-gray-800 px-1 py-0.5 rounded">.env</code> file:
                  <pre className="mt-2 bg-gray-800 p-3 rounded text-xs overflow-x-auto">
{`YOUTUBE_API_KEY=your_api_key_here
GOOGLE_CLIENT_ID=your_client_id_here
GOOGLE_CLIENT_SECRET=your_client_secret_here
SESSION_SECRET=your_random_session_secret_here`}
                  </pre>
                </li>
                <li>Restart the application to apply the changes</li>
              </ol>
            </div>
          </div>
        ) : (
          /* Authenticated - Show Search and Playlists Tabs */
          <>
            {/* Sub-tabs for Search and Playlists */}
            <div className="flex gap-2 mb-4 flex-shrink-0">
              <button
                onClick={() => setActiveSubTab('search')}
                className={`px-4 py-2 rounded-lg transition-colors ${
                  activeSubTab === 'search'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                Search
              </button>
              <button
                onClick={() => setActiveSubTab('playlists')}
                className={`px-4 py-2 rounded-lg transition-colors ${
                  activeSubTab === 'playlists'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                Playlists
              </button>
            </div>

            {/* Content Area */}
            <div className="flex-1 min-h-0">
              {activeSubTab === 'search' && (
                <YouTubeSearch onTrackAdded={onTracksAdded} />
              )}
              {activeSubTab === 'playlists' && (
                <PlaylistImport
                  isAuthenticated={authStatus?.authenticated || false}
                  onTracksAdded={onTracksAdded}
                />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
