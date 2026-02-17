import { Play, Square, Heart, Download } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import type { SliceWithTrackExtended, Tag, Folder } from '../types'
import { getSliceDownloadUrl } from '../api/client'
import { InstrumentIcon } from './InstrumentIcon'
import { freqToNoteName } from '../utils/musicTheory'

interface SliceDetailPanelProps {
  sample: SliceWithTrackExtended | null
  allTags: Tag[]
  folders: Folder[]
  onToggleFavorite: (sliceId: number) => void
  onAddTag: (sliceId: number, tagId: number) => void
  onRemoveTag: (sliceId: number, tagId: number) => void
  onAddToFolder: (folderId: number, sliceId: number) => void
  onRemoveFromFolder: (folderId: number, sliceId: number) => void
  onUpdateName: (sliceId: number, name: string) => void
  onTagClick?: (tagId: number) => void
}

export function SliceDetailPanel({
  sample,
  allTags,
  folders,
  onToggleFavorite,
  onAddTag,
  onRemoveTag,
  onAddToFolder,
  onRemoveFromFolder,
  onUpdateName,
  onTagClick,
}: SliceDetailPanelProps) {
  const [isPlaying, setIsPlaying] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
      setIsPlaying(false)
    }
  }, [sample?.id])

  const togglePlayback = () => {
    if (!sample) return

    if (isPlaying && audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
      setIsPlaying(false)
    } else {
      audioRef.current = new Audio(getSliceDownloadUrl(sample.id))
      audioRef.current.volume = 0.8
      audioRef.current.onended = () => {
        setIsPlaying(false)
        audioRef.current = null
      }
      audioRef.current.play().catch(() => setIsPlaying(false))
      setIsPlaying(true)
    }
  }

  const handleDownload = () => {
    if (!sample) return
    const link = document.createElement('a')
    link.href = getSliceDownloadUrl(sample.id)
    link.download = `${sample.name || `sample-${sample.id}`}.mp3`
    link.click()
  }

  if (!sample) {
    return (
      <div className="h-full flex items-center justify-center bg-surface-base">
        <div className="text-center text-slate-500">
          <p className="text-sm">Select a sample to view details</p>
        </div>
      </div>
    )
  }

  const duration = sample.endTime - sample.startTime
  const fundamentalNote = sample.fundamentalFreq ? freqToNoteName(sample.fundamentalFreq) : null

  return (
    <div className="h-full flex flex-col bg-surface-base overflow-y-auto">
      {/* Header */}
      <div className="p-4 border-b border-surface-border bg-surface-raised">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-medium text-white truncate">{sample.name}</h2>
            <p className="text-sm text-slate-400 truncate">{sample.track?.title || 'Unknown track'}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={togglePlayback}
              className="p-2 rounded-lg bg-accent-primary/20 text-accent-primary hover:bg-accent-primary/30 transition-colors"
              title={isPlaying ? 'Stop' : 'Play'}
            >
              {isPlaying ? <Square size={16} /> : <Play size={16} />}
            </button>
            <button
              onClick={() => onToggleFavorite(sample.id)}
              className={`p-2 rounded-lg transition-colors ${
                sample.isFavorite
                  ? 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30'
                  : 'bg-surface-overlay text-slate-400 hover:text-amber-400'
              }`}
              title={sample.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            >
              <Heart size={16} className={sample.isFavorite ? 'fill-current' : ''} />
            </button>
            <button
              onClick={handleDownload}
              className="p-2 rounded-lg bg-surface-overlay text-slate-400 hover:text-white transition-colors"
              title="Download"
            >
              <Download size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 p-4 space-y-4">
        {/* Basic Info */}
        <div>
          <h3 className="text-sm font-medium text-slate-400 mb-2">Basic Info</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-slate-500">Duration</div>
              <div className="text-sm text-white font-mono">{duration.toFixed(2)}s</div>
            </div>
            {sample.bpm && (
              <div>
                <div className="text-xs text-slate-500">BPM</div>
                <div className="text-sm text-white font-mono">{Math.round(sample.bpm)}</div>
              </div>
            )}
            {sample.keyEstimate && (
              <div>
                <div className="text-xs text-slate-500">Key</div>
                <div className="text-sm text-white font-mono">{sample.keyEstimate}</div>
              </div>
            )}
            {fundamentalNote && (
              <div>
                <div className="text-xs text-slate-500">Note</div>
                <div className="text-sm text-white font-mono">{fundamentalNote}</div>
              </div>
            )}
            {sample.instrumentPrimary && (
              <div>
                <div className="text-xs text-slate-500">Instrument</div>
                <div className="flex items-center gap-1.5">
                  <InstrumentIcon instrument={sample.instrumentPrimary} size={14} />
                  <div className="text-sm text-white">{sample.instrumentPrimary}</div>
                </div>
              </div>
            )}
            {sample.envelopeType && (
              <div>
                <div className="text-xs text-slate-500">Envelope</div>
                <div className="text-sm text-white">{sample.envelopeType}</div>
              </div>
            )}
          </div>
        </div>

        {/* Tags */}
        {sample.tags && sample.tags.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-slate-400 mb-2">Tags</h3>
            <div className="flex flex-wrap gap-1.5">
              {sample.tags.map((tag) => (
                <button
                  key={tag.id}
                  onClick={() => onTagClick?.(tag.id)}
                  className="px-2 py-1 rounded-md text-xs transition-colors"
                  style={{
                    backgroundColor: `${tag.color || '#64748b'}20`,
                    color: tag.color || '#94a3b8',
                    borderWidth: '1px',
                    borderColor: `${tag.color || '#64748b'}40`,
                  }}
                >
                  {tag.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Perceptual Features */}
        {(sample.brightnessEstimate !== null || sample.warmthEstimate !== null || sample.hardnessEstimate !== null) && (
          <div>
            <h3 className="text-sm font-medium text-slate-400 mb-2">Perceptual Features</h3>
            <div className="grid grid-cols-3 gap-3">
              {sample.brightnessEstimate !== null && (
                <div>
                  <div className="text-xs text-slate-500">Brightness</div>
                  <div className="text-sm text-white font-mono">{sample.brightnessEstimate.toFixed(2)}</div>
                </div>
              )}
              {sample.warmthEstimate !== null && (
                <div>
                  <div className="text-xs text-slate-500">Warmth</div>
                  <div className="text-sm text-white font-mono">{sample.warmthEstimate.toFixed(2)}</div>
                </div>
              )}
              {sample.hardnessEstimate !== null && (
                <div>
                  <div className="text-xs text-slate-500">Hardness</div>
                  <div className="text-sm text-white font-mono">{sample.hardnessEstimate.toFixed(2)}</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
