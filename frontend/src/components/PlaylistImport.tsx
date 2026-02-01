import { useState } from 'react'
import { ListMusic, Plus, Loader2, ChevronRight, LogIn } from 'lucide-react'
import { usePlaylists, usePlaylistItems, useAddTracks } from '../hooks/useTracks'
import { getGoogleAuthUrl } from '../api/client'

interface PlaylistImportProps {
  isAuthenticated: boolean
  onTracksAdded: () => void
}

export function PlaylistImport({ isAuthenticated, onTracksAdded }: PlaylistImportProps) {
  const [selectedPlaylist, setSelectedPlaylist] = useState<string | null>(null)
  const [selectedVideos, setSelectedVideos] = useState<Set<string>>(new Set())

  const { data: playlists, isLoading: loadingPlaylists } = usePlaylists()
  const { data: playlistItems, isLoading: loadingItems } = usePlaylistItems(
    selectedPlaylist || ''
  )
  const addTracks = useAddTracks()

  const handleSelectAll = () => {
    if (playlistItems) {
      if (selectedVideos.size === playlistItems.length) {
        setSelectedVideos(new Set())
      } else {
        setSelectedVideos(new Set(playlistItems.map((v) => v.videoId)))
      }
    }
  }

  const toggleVideo = (videoId: string) => {
    const newSet = new Set(selectedVideos)
    if (newSet.has(videoId)) {
      newSet.delete(videoId)
    } else {
      newSet.add(videoId)
    }
    setSelectedVideos(newSet)
  }

  const handleImportSelected = async () => {
    const urls = Array.from(selectedVideos).map(
      (id) => `https://www.youtube.com/watch?v=${id}`
    )
    await addTracks.mutateAsync(urls)
    setSelectedVideos(new Set())
    onTracksAdded()
  }

  if (!isAuthenticated) {
    return (
      <div className="bg-surface-raised rounded-lg p-8 text-center border border-surface-border">
        <ListMusic className="mx-auto text-slate-600 mb-4" size={48} />
        <h2 className="text-xl font-semibold text-white mb-2">
          Import Your Playlists
        </h2>
        <p className="text-slate-400 mb-6">
          Sign in with Google to access your YouTube playlists, including private ones.
        </p>
        <a
          href={getGoogleAuthUrl()}
          className="inline-flex items-center gap-2 px-6 py-3 bg-accent-primary hover:bg-blue-600 text-white rounded-lg transition-colors"
        >
          <LogIn size={18} />
          Sign in with Google
        </a>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Playlists or Playlist Items */}
      {!selectedPlaylist ? (
        <div className="bg-surface-raised rounded-lg overflow-hidden border border-surface-border">
          <div className="px-4 py-3 border-b border-surface-border">
            <h2 className="font-semibold text-white">Your Playlists</h2>
          </div>

          {loadingPlaylists ? (
            <div className="p-8 text-center">
              <Loader2 className="animate-spin mx-auto text-accent-primary" size={32} />
              <p className="mt-2 text-slate-400">Loading playlists...</p>
            </div>
          ) : playlists && playlists.length > 0 ? (
            <div className="divide-y divide-surface-border">
              {playlists.map((playlist) => (
                <button
                  key={playlist.id}
                  onClick={() => setSelectedPlaylist(playlist.id)}
                  className="w-full flex items-center gap-3 p-3 hover:bg-surface-overlay/50 transition-colors text-left"
                >
                  <img
                    src={playlist.thumbnailUrl}
                    alt={playlist.title}
                    className="w-16 h-12 object-cover rounded"
                  />
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-white truncate">
                      {playlist.title}
                    </h3>
                    <p className="text-sm text-slate-400">
                      {playlist.itemCount} videos
                    </p>
                  </div>
                  <ChevronRight className="text-slate-500" size={20} />
                </button>
              ))}
            </div>
          ) : (
            <div className="p-8 text-center text-slate-500">
              No playlists found
            </div>
          )}
        </div>
      ) : (
        <div className="bg-surface-raised rounded-lg overflow-hidden border border-surface-border">
          {/* Header with back button */}
          <div className="px-4 py-3 border-b border-surface-border flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  setSelectedPlaylist(null)
                  setSelectedVideos(new Set())
                }}
                className="text-slate-400 hover:text-white transition-colors"
              >
                &larr; Back
              </button>
              <h2 className="font-semibold text-white">
                {playlists?.find((p) => p.id === selectedPlaylist)?.title}
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleSelectAll}
                className="px-3 py-1 text-sm text-slate-400 hover:text-white transition-colors"
              >
                {selectedVideos.size === playlistItems?.length
                  ? 'Deselect All'
                  : 'Select All'}
              </button>
              <button
                onClick={handleImportSelected}
                disabled={selectedVideos.size === 0 || addTracks.isPending}
                className="flex items-center gap-2 px-4 py-1.5 bg-green-600 hover:bg-green-700 disabled:bg-surface-overlay disabled:text-slate-500 text-white rounded transition-colors"
              >
                {addTracks.isPending ? (
                  <Loader2 className="animate-spin" size={16} />
                ) : (
                  <Plus size={16} />
                )}
                Import ({selectedVideos.size})
              </button>
            </div>
          </div>

          {/* Videos */}
          {loadingItems ? (
            <div className="p-8 text-center">
              <Loader2 className="animate-spin mx-auto text-accent-primary" size={32} />
              <p className="mt-2 text-slate-400">Loading videos...</p>
            </div>
          ) : playlistItems && playlistItems.length > 0 ? (
            <div className="divide-y divide-surface-border max-h-[500px] overflow-y-auto">
              {playlistItems.map((video) => (
                <label
                  key={video.videoId}
                  className="flex items-center gap-3 p-3 hover:bg-surface-overlay/50 transition-colors cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedVideos.has(video.videoId)}
                    onChange={() => toggleVideo(video.videoId)}
                    className="w-4 h-4 rounded border-surface-border bg-surface-overlay text-accent-primary focus:ring-accent-primary"
                  />
                  <img
                    src={video.thumbnailUrl}
                    alt={video.title}
                    className="w-20 h-12 object-cover rounded"
                  />
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-white truncate">
                      {video.title}
                    </h3>
                    <p className="text-sm text-slate-400 truncate">
                      {video.channelTitle}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          ) : (
            <div className="p-8 text-center text-slate-500">
              No videos in this playlist
            </div>
          )}
        </div>
      )}
    </div>
  )
}
