import { useState } from 'react'
import { Loader2, CheckCircle, AlertCircle, Clock } from 'lucide-react'
import { useTracks, useDeleteTrack, useAddTracks } from '../hooks/useTracks'
import { TrackItem } from './TrackItem'
import type { Track } from '../types'

interface TrackListProps {
  onSelectTrack: (track: Track) => void
  selectedTrackId?: number
}

export function TrackList({ onSelectTrack, selectedTrackId }: TrackListProps) {
  const [quickUrl, setQuickUrl] = useState('')
  const { data: tracks, isLoading } = useTracks()
  const deleteTrack = useDeleteTrack()
  const addTracks = useAddTracks()

  const handleQuickAdd = (e: React.FormEvent) => {
    e.preventDefault()
    if (quickUrl.trim()) {
      addTracks.mutate([quickUrl.trim()])
      setQuickUrl('')
    }
  }

  const statusIcon = (status: Track['status']) => {
    switch (status) {
      case 'ready':
        return <CheckCircle className="text-green-500" size={16} />
      case 'downloading':
        return <Loader2 className="text-blue-500 animate-spin" size={16} />
      case 'error':
        return <AlertCircle className="text-red-500" size={16} />
      default:
        return <Clock className="text-gray-500" size={16} />
    }
  }

  if (isLoading) {
    return (
      <div className="bg-gray-800 rounded-lg p-8 text-center">
        <Loader2 className="animate-spin mx-auto text-indigo-500" size={32} />
        <p className="mt-2 text-gray-400">Loading tracks...</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Quick Add */}
      <form onSubmit={handleQuickAdd} className="flex gap-2">
        <input
          type="text"
          value={quickUrl}
          onChange={(e) => setQuickUrl(e.target.value)}
          placeholder="Paste YouTube URL to add..."
          className="flex-1 px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
        />
        <button
          type="submit"
          disabled={addTracks.isPending || !quickUrl.trim()}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-700 text-white rounded-lg transition-colors"
        >
          {addTracks.isPending ? (
            <Loader2 className="animate-spin" size={20} />
          ) : (
            'Add'
          )}
        </button>
      </form>

      {/* Track List */}
      <div className="bg-gray-800 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-700">
          <h2 className="font-semibold text-white">
            Tracks ({tracks?.length || 0})
          </h2>
        </div>

        {tracks && tracks.length > 0 ? (
          <div className="divide-y divide-gray-700">
            {tracks.map((track) => (
              <TrackItem
                key={track.id}
                track={track}
                isSelected={track.id === selectedTrackId}
                onSelect={() => onSelectTrack(track)}
                onDelete={() => deleteTrack.mutate(track.id)}
                statusIcon={statusIcon(track.status)}
              />
            ))}
          </div>
        ) : (
          <div className="p-8 text-center text-gray-500">
            No tracks yet. Add one using the search or import features.
          </div>
        )}
      </div>
    </div>
  )
}
