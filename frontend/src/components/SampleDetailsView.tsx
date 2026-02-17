import { useState, useRef, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Play, Pause, Heart, Download, ChevronDown, Sparkles, Activity, Disc3, Trash2 } from 'lucide-react'
import type { SliceWithTrackExtended, Tag, Folder, AudioFeatures } from '../types'
import { getSliceDownloadUrl, deleteSlice } from '../api/client'
import { InstrumentIcon } from './InstrumentIcon'
import { freqToNoteName } from '../utils/musicTheory'
import { SliceWaveform, type SliceWaveformRef } from './SliceWaveform'
import { DrumRackPadPicker } from './DrumRackPadPicker'
import { ConfirmModal } from './ConfirmModal'

interface SampleDetailsViewProps {
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
  onSampleDeleted?: (sliceId: number) => void
  onSelectSample?: (sampleId: number) => void
  onFilterBySimilarity?: (sampleId: number, sampleName: string) => void
}

// Helper component to display a feature value
function FeatureItem({
  label,
  value,
  unit,
  decimals = 2,
  isText = false
}: {
  label: string
  value: number | string | null | undefined
  unit?: string
  decimals?: number
  isText?: boolean
}) {
  if (value === null || value === undefined) {
    return (
      <div>
        <div className="text-xs text-slate-500">{label}</div>
        <div className="text-sm text-slate-600">-</div>
      </div>
    )
  }

  const displayValue = isText
    ? String(value)
    : typeof value === 'number'
    ? value.toFixed(decimals)
    : value

  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-sm text-white font-mono">
        {displayValue}
        {unit && <span className="text-slate-400 ml-1">{unit}</span>}
      </div>
    </div>
  )
}

interface SimilarSample {
  id: number
  name: string
  filePath: string
  similarity: number
  track: {
    title: string
  }
}

function SimilarSamplesSection({
  sampleId,
  sampleName,
  onSelectSample,
  onFilterBySimilarity,
}: {
  sampleId: number
  sampleName: string
  onSelectSample?: (id: number) => void
  onFilterBySimilarity?: (sampleId: number, sampleName: string) => void
}) {
  const [hoveredSample, setHoveredSample] = useState<number | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const { data: similarSamples, isLoading } = useQuery<SimilarSample[]>({
    queryKey: ['similar-samples', sampleId],
    queryFn: async () => {
      const res = await fetch(`/api/slices/${sampleId}/similar?limit=6`)
      if (!res.ok) {
        if (res.status === 404) return []
        throw new Error('Failed to fetch similar samples')
      }
      return res.json()
    },
  })

  const currentSampleId = Number(sampleId)
  const visibleSimilarSamples = (similarSamples ?? []).filter((sample) => {
    const candidateId = Number(sample.id)
    return Number.isFinite(candidateId) && candidateId !== currentSampleId
  })

  const handleMouseEnter = (similarSampleId: number) => {
    setHoveredSample(similarSampleId)
    if (audioRef.current) {
      audioRef.current.pause()
    }
    audioRef.current = new Audio(getSliceDownloadUrl(similarSampleId))
    audioRef.current.volume = 0.5
    audioRef.current.play().catch(() => {})
  }

  const handleMouseLeave = () => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    setHoveredSample(null)
  }

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
    }
  }, [])

  if (isLoading) {
    return (
      <div>
        <label className="text-sm font-medium text-slate-400 flex items-center gap-2 mb-2">
          <Sparkles size={14} />
          Similar Samples
        </label>
        <div className="text-sm text-slate-500">Loading...</div>
      </div>
    )
  }

  if (visibleSimilarSamples.length === 0) {
    return null
  }

  return (
    <div>
      <label className="text-sm font-medium text-slate-400 flex items-center gap-2 mb-2">
        <Sparkles size={14} />
        Similar Samples
      </label>
      <div className="grid grid-cols-2 gap-2">
        {visibleSimilarSamples.slice(0, 4).map((sample) => {
          const sampleIdNum = Number(sample.id)
          if (!Number.isFinite(sampleIdNum)) return null

          return (
            <button
              key={sampleIdNum}
              onMouseEnter={() => handleMouseEnter(sampleIdNum)}
              onMouseLeave={handleMouseLeave}
              onClick={() => onSelectSample?.(sampleIdNum)}
              className={`group relative p-2 rounded-lg border transition-all text-left ${
                hoveredSample === sampleIdNum
                  ? 'border-accent-primary bg-accent-primary/10 scale-105'
                  : 'border-surface-border bg-surface-base hover:border-slate-600'
              }`}
            >
              <div className="absolute top-1 right-1 px-1 py-0.5 rounded text-[9px] font-medium bg-slate-900/90 text-slate-300">
                {Math.round(sample.similarity * 100)}%
              </div>
              <div className="text-xs font-medium text-white truncate pr-8">
                {sample.name}
              </div>
              <div className="text-[10px] text-slate-500 truncate">
                {sample.track.title}
              </div>
            </button>
          )
        })}
      </div>
      {onFilterBySimilarity && (
        <button
          onClick={() => onFilterBySimilarity(sampleId, sampleName)}
          className="mt-2 w-full px-3 py-2 bg-accent-primary/10 hover:bg-accent-primary/20 text-accent-primary rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
        >
          <Sparkles size={14} />
          Show All Similar Samples
        </button>
      )}
    </div>
  )
}

export function SampleDetailsView({
  sample,
  allTags,
  folders,
  onSelectSample,
  onFilterBySimilarity,
  onToggleFavorite,
  onAddTag,
  onRemoveTag,
  onAddToFolder,
  onRemoveFromFolder,
  onUpdateName,
  onTagClick,
  onSampleDeleted,
}: SampleDetailsViewProps) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [isWaveformReady, setIsWaveformReady] = useState(false)
  const [activeTab, setActiveTab] = useState<'details' | 'advanced'>('details')
  const [showPadPicker, setShowPadPicker] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleteSourceFile, setDeleteSourceFile] = useState(false)
  const waveformRef = useRef<SliceWaveformRef>(null)
  const queryClient = useQueryClient()

  // Fetch audio features for the advanced tab
  const { data: audioFeatures } = useQuery<AudioFeatures>({
    queryKey: ['audioFeatures', sample?.id],
    queryFn: async () => {
      const res = await fetch(`/api/slices/${sample?.id}/features`)
      if (!res.ok) throw new Error('Failed to fetch audio features')
      return res.json()
    },
    enabled: !!sample && activeTab === 'advanced',
  })

  // Reset state when sample changes
  useEffect(() => {
    setIsPlaying(false)
    setIsWaveformReady(false)
    if (waveformRef.current) {
      waveformRef.current.pause()
    }
  }, [sample?.id])

  if (!sample) {
    return (
      <div className="h-full flex items-center justify-center bg-surface-base">
        <div className="text-center text-slate-500">
          <p className="text-sm">Select a sample to view details</p>
        </div>
      </div>
    )
  }

  const handlePlayPause = async () => {
    if (!waveformRef.current) return

    if (isPlaying) {
      waveformRef.current.pause()
    } else {
      await waveformRef.current.play()
    }
  }

  const handleDownload = () => {
    const link = document.createElement('a')
    link.href = getSliceDownloadUrl(sample.id)
    link.download = `${sample.name || `sample-${sample.id}`}.mp3`
    link.click()
  }

  const handleDeleteConfirm = async () => {
    if (!sample) return

    try {
      await deleteSlice(sample.id, deleteSourceFile)
      // Invalidate queries to refresh the lists
      queryClient.invalidateQueries({ queryKey: ['slices'] })
      queryClient.invalidateQueries({ queryKey: ['tracks'] })
      // Close modal
      setShowDeleteModal(false)
      // Notify parent
      onSampleDeleted?.(sample.id)
    } catch (error) {
      console.error('Failed to delete sample:', error)
      alert('Failed to delete sample. Please try again.')
    }
  }

  const duration = sample.endTime - sample.startTime
  const fundamentalNote = sample.fundamentalFrequency != null ? freqToNoteName(sample.fundamentalFrequency) : null

  return (
    <div className="h-full flex flex-col bg-surface-base overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-surface-border bg-surface-raised flex-shrink-0">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-medium text-white truncate">{sample.name}</h2>
            <p className="text-sm text-slate-400 truncate">{sample.track?.title || 'Unknown track'}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => onToggleFavorite(sample.id)}
              className={`p-2 rounded-lg transition-colors ${
                sample.favorite
                  ? 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30'
                  : 'bg-surface-overlay text-slate-400 hover:text-amber-400'
              }`}
              title={sample.favorite ? 'Remove from favorites' : 'Add to favorites'}
            >
              <Heart size={16} className={sample.favorite ? 'fill-current' : ''} />
            </button>
            <button
              onClick={handleDownload}
              className="p-2 rounded-lg bg-surface-overlay text-slate-400 hover:text-white transition-colors"
              title="Download"
            >
              <Download size={16} />
            </button>
            <button
              onClick={() => setShowPadPicker(true)}
              className="p-2 rounded-lg bg-surface-overlay text-slate-400 hover:text-accent-primary transition-colors"
              title="Send to Drum Rack"
            >
              <Disc3 size={16} />
            </button>
            <button
              onClick={() => setShowDeleteModal(true)}
              className="p-2 rounded-lg bg-surface-overlay text-slate-400 hover:text-red-400 transition-colors"
              title="Delete sample"
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-surface-border -mb-4 pb-0">
          <button
            onClick={() => setActiveTab('details')}
            className={`px-3 py-2 text-sm font-medium transition-colors border-b-2 ${
              activeTab === 'details'
                ? 'text-white border-accent-primary'
                : 'text-slate-400 border-transparent hover:text-slate-300'
            }`}
          >
            Details
          </button>
          <button
            onClick={() => setActiveTab('advanced')}
            className={`px-3 py-2 text-sm font-medium transition-colors border-b-2 flex items-center gap-1.5 ${
              activeTab === 'advanced'
                ? 'text-white border-accent-primary'
                : 'text-slate-400 border-transparent hover:text-slate-300'
            }`}
          >
            <Activity size={14} />
            Advanced
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {activeTab === 'details' && (
          <>
            {/* Waveform */}
            <div>
              <SliceWaveform
                ref={waveformRef}
                sliceId={sample.id}
                height={80}
                onReady={() => setIsWaveformReady(true)}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onFinish={() => setIsPlaying(false)}
              />
              {/* Playback controls */}
              <div className="flex items-center gap-3 mt-3">
                <button
                  onClick={handlePlayPause}
                  disabled={!isWaveformReady}
                  className="w-10 h-10 rounded-full bg-accent-primary flex items-center justify-center text-white hover:bg-accent-primary/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isPlaying ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
                </button>
                <div className="text-sm text-slate-400">
                  {duration.toFixed(2)}s
                </div>
              </div>
            </div>

            {/* Basic Info */}
            <div>
              <h3 className="text-sm font-medium text-slate-400 mb-2">Basic Info</h3>
              <div className="grid grid-cols-2 gap-3">
                <FeatureItem label="Duration" value={duration} unit="s" />
                {sample.bpm != null && <FeatureItem label="BPM" value={Math.round(sample.bpm)} decimals={0} />}
                {sample.keyEstimate != null && <FeatureItem label="Key" value={sample.keyEstimate} isText />}
                {fundamentalNote != null && <FeatureItem label="Note" value={fundamentalNote} isText />}
                {sample.instrumentPrimary != null && (
                  <div>
                    <div className="text-xs text-slate-500">Instrument</div>
                    <div className="flex items-center gap-1.5">
                      <InstrumentIcon type={sample.instrumentPrimary} size={14} />
                      <div className="text-sm text-white">{sample.instrumentPrimary}</div>
                    </div>
                  </div>
                )}
                {sample.envelopeType != null && <FeatureItem label="Envelope" value={sample.envelopeType} isText />}
              </div>
            </div>

            {/* Tags */}
            {sample.tags != null && sample.tags.length > 0 && (
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

            {/* Similar Samples */}
            <SimilarSamplesSection
              sampleId={sample.id}
              sampleName={sample.name}
              onSelectSample={onSelectSample}
              onFilterBySimilarity={onFilterBySimilarity}
            />
          </>
        )}

        {activeTab === 'advanced' && audioFeatures && (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-medium text-slate-400 mb-2">Spectral Features</h3>
              <div className="grid grid-cols-2 gap-3">
                <FeatureItem label="Spectral Centroid" value={audioFeatures.spectralCentroid} unit="Hz" decimals={1} />
                <FeatureItem label="Spectral Rolloff" value={audioFeatures.spectralRolloff} unit="Hz" decimals={1} />
                <FeatureItem label="Spectral Flux" value={audioFeatures.spectralFlux} decimals={3} />
                <FeatureItem label="Spectral Flatness" value={audioFeatures.spectralFlatness} decimals={3} />
              </div>
            </div>

            <div>
              <h3 className="text-sm font-medium text-slate-400 mb-2">Temporal Features</h3>
              <div className="grid grid-cols-2 gap-3">
                <FeatureItem label="RMS Energy" value={audioFeatures.rmsEnergy} decimals={3} />
                <FeatureItem label="Zero Crossing Rate" value={audioFeatures.zeroCrossingRate} decimals={3} />
                <FeatureItem label="Onset Strength" value={(audioFeatures as any).onsetStrength} decimals={3} />
              </div>
            </div>

            <div>
              <h3 className="text-sm font-medium text-slate-400 mb-2">Perceptual Features</h3>
              <div className="grid grid-cols-2 gap-3">
                <FeatureItem label="Brightness" value={(sample as any).brightnessEstimate} decimals={2} />
                <FeatureItem label="Warmth" value={(sample as any).warmthEstimate} decimals={2} />
                <FeatureItem label="Hardness" value={(sample as any).hardnessEstimate} decimals={2} />
                <FeatureItem label="Roughness" value={(audioFeatures as any).roughness} decimals={3} />
              </div>
            </div>
          </div>
        )}
      </div>

      {showPadPicker && (
        <DrumRackPadPicker
          sample={sample}
          onClose={() => setShowPadPicker(false)}
        />
      )}

      {showDeleteModal && (
        <ConfirmModal
          title="Delete Sample"
          message="Are you sure you want to delete this sample? This action cannot be undone."
          confirmText="Delete"
          cancelText="Cancel"
          isDestructive
          checkboxLabel="Also delete the source file from disk (if accessible)"
          checkboxDefaultChecked={false}
          onCheckboxChange={setDeleteSourceFile}
          onConfirm={handleDeleteConfirm}
          onCancel={() => {
            setShowDeleteModal(false)
            setDeleteSourceFile(false)
          }}
        />
      )}
    </div>
  )
}
