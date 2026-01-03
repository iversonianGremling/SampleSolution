import { AlertCircle, Check, X, ExternalLink } from 'lucide-react'
import { useEffect, useState } from 'react'

interface CredentialStatus {
  configured: boolean
  details: {
    youtubeApiKey: boolean
    googleOAuth: boolean
    sessionSecret: boolean
  }
}

export function SetupInstructions() {
  const [status, setStatus] = useState<CredentialStatus | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/credentials/status')
      .then(res => res.json())
      .then(data => {
        setStatus(data)
        setLoading(false)
      })
      .catch(() => {
        setLoading(false)
      })
  }, [])

  if (loading) {
    return null
  }

  if (status?.configured) {
    return null
  }

  return (
    <div className="fixed inset-0 bg-gray-900 flex items-center justify-center p-4 z-50">
      <div className="bg-gray-800 rounded-lg shadow-xl max-w-3xl w-full p-8 border border-gray-700">
        <div className="flex items-start gap-4 mb-6">
          <AlertCircle className="text-yellow-500 flex-shrink-0" size={32} />
          <div>
            <h1 className="text-2xl font-bold text-white mb-2">Setup Required</h1>
            <p className="text-gray-300">
              The application needs API credentials to function properly. Please configure the following:
            </p>
          </div>
        </div>

        <div className="space-y-4 mb-8">
          <CredentialItem
            name="YouTube API Key"
            configured={status?.details.youtubeApiKey || false}
            description="Required for YouTube search and playlist imports"
          />
          <CredentialItem
            name="Google OAuth Credentials"
            configured={status?.details.googleOAuth || false}
            description="Required for accessing user playlists"
          />
          <CredentialItem
            name="Session Secret"
            configured={status?.details.sessionSecret || false}
            description="Required for secure session management"
          />
        </div>

        <div className="bg-gray-900 rounded-lg p-6 space-y-4 mb-6">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            Setup Instructions
          </h2>

          <div className="space-y-3 text-sm text-gray-300">
            <div>
              <h3 className="font-semibold text-white mb-2">1. Get Google Cloud Credentials</h3>
              <ul className="list-disc list-inside space-y-1 ml-4">
                <li>
                  Visit the{' '}
                  <a
                    href="https://console.cloud.google.com/apis/credentials"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-400 hover:text-indigo-300 inline-flex items-center gap-1"
                  >
                    Google Cloud Console <ExternalLink size={12} />
                  </a>
                </li>
                <li>Create or select a project</li>
                <li>Enable the YouTube Data API v3</li>
                <li>Create an API Key (for YouTube search)</li>
                <li>Create OAuth 2.0 Client ID (for playlist access)</li>
              </ul>
            </div>

            <div>
              <h3 className="font-semibold text-white mb-2">2. Configure Environment Variables</h3>
              <div className="bg-gray-800 rounded p-3 font-mono text-xs overflow-x-auto">
                <div className="text-gray-400"># Edit backend/.env or .env file</div>
                <div className="text-green-400">YOUTUBE_API_KEY=<span className="text-yellow-400">your_api_key_here</span></div>
                <div className="text-green-400">GOOGLE_CLIENT_ID=<span className="text-yellow-400">your_client_id.apps.googleusercontent.com</span></div>
                <div className="text-green-400">GOOGLE_CLIENT_SECRET=<span className="text-yellow-400">your_client_secret</span></div>
                <div className="text-green-400">SESSION_SECRET=<span className="text-yellow-400">(generate with: openssl rand -base64 32)</span></div>
              </div>
            </div>

            <div>
              <h3 className="font-semibold text-white mb-2">3. Restart the Application</h3>
              <div className="bg-gray-800 rounded p-3 font-mono text-xs">
                <div className="text-gray-400"># If using Docker:</div>
                <div className="text-blue-400">docker compose restart</div>
                <div className="text-gray-400 mt-2"># Or if running locally:</div>
                <div className="text-blue-400">cd backend && npm run dev</div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-400">
            See the README for detailed setup instructions
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors"
          >
            Refresh Page
          </button>
        </div>
      </div>
    </div>
  )
}

function CredentialItem({ name, configured, description }: { name: string; configured: boolean; description: string }) {
  return (
    <div className="flex items-start gap-3 p-4 bg-gray-900 rounded-lg">
      {configured ? (
        <Check className="text-green-500 flex-shrink-0 mt-0.5" size={20} />
      ) : (
        <X className="text-red-500 flex-shrink-0 mt-0.5" size={20} />
      )}
      <div>
        <div className="font-medium text-white">{name}</div>
        <div className="text-sm text-gray-400">{description}</div>
      </div>
    </div>
  )
}
