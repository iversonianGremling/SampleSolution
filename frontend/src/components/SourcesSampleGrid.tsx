import { useState, useRef, useEffect } from 'react'
import { Play, Pause, Heart, GripVertical } from 'lucide-react'
import type { SliceWithTrackExtended } from '../types'
import { getSliceDownloadUrl } from '../api/client'

interface SourcesSampleGridProps {
  samples: SliceWithTrackExtended[]
  selectedId: number | null
  onSelect: (id: number) => void
  onToggleFavorite?: (id: number) => void
  isLoading?: boolean
}

export function SourcesSampleGrid({
  samples,
  selectedId,
  onSelect,
  onToggleFavorite,
  isLoading = false,
}: SourcesSampleGridProps) {
  const [playingId, setPlayingId] = useState<number | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [draggedId, setDraggedId] = useState<number | null>(null)

  // Stop audio when unmounting
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
    }
  }, [])

  const formatDuration = (startTime: number, endTime: number) => {
    const duration = endTime - startTime
    if (duration < 60) {
      return `${duration.toFixed(1)}s`
    }
    const mins = Math.floor(duration / 60)
    const secs = Math.floor(duration % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const handlePlay = (id: number, e: React.MouseEvent) => {
    e.stopPropagation()

    if (playingId === id) {
      // Stop playing
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
      setPlayingId(null)
    } else {
      // Stop previous
      if (audioRef.current) {
        audioRef.current.pause()
      }
      // Play new
      const audio = new Audio(getSliceDownloadUrl(id))
      audio.onended = () => {
        setPlayingId(null)
        audioRef.current = null
      }
      audio.play()
      audioRef.current = audio
      setPlayingId(id)
    }
  }

  const handleDragStart = (e: React.DragEvent, sample: SliceWithTrackExtended) => {
    setDraggedId(sample.id)
    e.dataTransfer.setData('text/plain', getSliceDownloadUrl(sample.id))
    e.dataTransfer.setData('application/json', JSON.stringify({
      type: 'sample',
      id: sample.id,
      name: sample.name,
    }))
    e.dataTransfer.effectAllowed = 'copyMove'
  }

  const handleDragEnd = () => {
    setDraggedId(null)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
        Loading samples...
      </div>
    )
  }

  if (samples.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-slate-400">
        <p className="text-lg">No samples found</p>
        <p className="text-sm mt-1">Try adjusting your filters or selecting a different source</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 p-4">
      {samples.map(sample => {
        const isSelected = selectedId === sample.id
        const isPlaying = playingId === sample.id
        const isDragging = draggedId === sample.id

        return (
          <div
            key={sample.id}
            onClick={() => onSelect(sample.id)}
            draggable
            onDragStart={(e) => handleDragStart(e, sample)}
            onDragEnd={handleDragEnd}
            className={`group relative bg-surface-raised rounded-lg overflow-hidden cursor-pointer transition-all ${
              isSelected
                ? 'ring-2 ring-accent-primary shadow-lg shadow-accent-primary/20'
                : 'hover:bg-surface-base hover:shadow-md'
            } ${isDragging ? 'opacity-50' : ''}`}
          >
            {/* Waveform placeholder / thumbnail area */}
            <div className="aspect-[4/3] bg-gradient-to-br from-slate-800 to-slate-900 relative flex items-center justify-center">
              {/* Simple waveform visualization placeholder */}
              <div className="absolute inset-0 flex items-center justify-center px-2">
                <div className="flex items-end gap-0.5 h-8 w-full">
                  {Array.from({ length: 24 }).map((_, i) => {
                    // Create consistent waveform based on sample.id (not random)
                    const baseHeight = 30
                    const variation = Math.abs(Math.sin((i / 24) * Math.PI * 4 + (sample.id % 100) / 10)) * 70
                    return (
                      <div
                        key={i}
                        className="flex-1 bg-accent-primary/40 rounded-t"
                        style={{
                          height: `${baseHeight + variation}%`,
                        }}
                      />
                    )
                  })}
                </div>
              </div>

              {/* Play button overlay */}
              <button
                onClick={(e) => handlePlay(sample.id, e)}
                className={`absolute inset-0 flex items-center justify-center transition-opacity ${
                  isPlaying ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                }`}
              >
                <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                  isPlaying ? 'bg-accent-primary' : 'bg-black/60 hover:bg-black/80'
                }`}>
                  {isPlaying ? (
                    <Pause size={18} className="text-white" />
                  ) : (
                    <Play size={18} className="text-white ml-0.5" />
                  )}
                </div>
              </button>

              {/* Favorite button */}
              {onToggleFavorite && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggleFavorite(sample.id)
                  }}
                  className={`absolute top-1.5 right-1.5 p-1 rounded transition-all ${
                    sample.favorite
                      ? 'text-amber-400 bg-amber-400/20'
                      : 'text-slate-400 opacity-0 group-hover:opacity-100 hover:text-amber-400 hover:bg-amber-400/20'
                  }`}
                >
                  <Heart size={14} className={sample.favorite ? 'fill-current' : ''} />
                </button>
              )}

              {/* Drag handle */}
              <div className="absolute top-1.5 left-1.5 p-1 text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab">
                <GripVertical size={14} />
              </div>

              {/* Duration badge */}
              <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 text-[10px] font-medium bg-black/60 rounded text-white">
                {formatDuration(sample.startTime, sample.endTime)}
              </span>
            </div>

            {/* Info */}
            <div className="p-2">
              <p className="text-sm font-medium text-white truncate" title={sample.name}>
                {sample.name}
              </p>
              <p className="text-xs text-slate-500 truncate" title={sample.track.title}>
                {sample.track.title}
              </p>

              {/* Tags preview */}
              {sample.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {sample.tags.slice(0, 2).map(tag => (
                    <span
                      key={tag.id}
                      className="px-1.5 py-0.5 text-[10px] rounded-full"
                      style={{
                        backgroundColor: tag.color + '25',
                        color: tag.color,
                      }}
                    >
                      {tag.name}
                    </span>
                  ))}
                  {sample.tags.length > 2 && (
                    <span className="px-1.5 py-0.5 text-[10px] text-slate-500">
                      +{sample.tags.length - 2}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
