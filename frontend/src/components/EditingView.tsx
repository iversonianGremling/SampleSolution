import { useState, useMemo } from 'react'
import { Search, Loader2, Music } from 'lucide-react'
import { useTracks } from '../hooks/useTracks'
import { WaveformEditor } from './WaveformEditor'
import type { Track } from '../types'

export function EditingView() {
  const [selectedTrackId, setSelectedTrackId] = useState<number | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const { data: tracks = [], isLoading } = useTracks()

  const selectedTrack = useMemo<Track | null>(() => {
    if (!selectedTrackId) return null
    return tracks.find(t => t.id === selectedTrackId) || null
  }, [selectedTrackId, tracks])

  const filteredTracks = useMemo<Track[]>(() => {
    return tracks.filter(track =>
      track.title.toLowerCase().includes(searchQuery.toLowerCase())
    )
  }, [tracks, searchQuery])

  return (
    <div className="h-full flex gap-4 bg-surface-base overflow-hidden p-4">
      {/* Left Panel - Track Selector */}
      <div className="w-80 flex-shrink-0 bg-surface-raised border border-surface-border rounded-lg flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-surface-border flex-shrink-0">
          <h2 className="font-semibold text-white mb-3">Tracks</h2>

          {/* Search input */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search tracks..."
              className="w-full pl-9 pr-3 py-2 bg-surface-base border border-surface-border rounded text-sm text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary transition-colors"
            />
          </div>
        </div>

        {/* Track List */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center h-32 text-slate-400">
              <Loader2 className="animate-spin mr-2" size={18} />
              Loading tracks...
            </div>
          ) : filteredTracks.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-slate-400 px-4">
              <Music size={24} className="mb-2" />
              <p className="text-sm text-center">
                {searchQuery ? 'No tracks found' : 'No tracks available'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-surface-border">
              {filteredTracks.map((track) => {
                const isSelected = selectedTrackId === track.id
                const isReady = track.status === 'ready'

                return (
                  <button
                    key={track.id}
                    onClick={() => setSelectedTrackId(track.id)}
                    className={`w-full px-4 py-3 text-left transition-colors border-l-2 ${
                      isSelected
                        ? 'bg-accent-primary/10 border-accent-primary'
                        : 'hover:bg-surface-base border-transparent'
                    } ${!isReady ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                    disabled={!isReady}
                    title={!isReady ? `Status: ${track.status}` : ''}
                  >
                    <p className="font-medium text-white truncate text-sm">
                      {track.title}
                    </p>
                    <div className="flex items-center justify-between mt-1">
                      <p className="text-xs text-slate-400 truncate">
                        {track.source === 'youtube' ? 'YouTube' : 'Local'}
                      </p>
                      {!isReady && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-base text-slate-400">
                          {track.status}
                        </span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Right Panel - Waveform Editor */}
      <div className="flex-1 overflow-hidden bg-surface-raised border border-surface-border rounded-lg">
        {selectedTrack ? (
          <div className="h-full overflow-y-auto">
            <WaveformEditor track={selectedTrack} />
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <Music size={48} className="mx-auto text-slate-400 mb-4" />
              <p className="text-slate-400 text-lg">
                Select a track to begin editing
              </p>
              <p className="text-slate-500 text-sm mt-1">
                Choose a track from the list on the left
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
