import { useState, useRef, useEffect, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Play,
  Pause,
  Heart,
  Download,
  Plus,
  Sparkles,
  Activity,
  Disc3,
  Trash2,
  Wand2,
  Loader2,
  Crosshair,
  X,
  Pencil,
} from 'lucide-react'
import type { SliceWithTrackExtended, Tag, Folder, AudioFeatures } from '../types'
import { getSliceDownloadUrl, deleteSlice, batchReanalyzeSamples, type UpdateSlicePayload } from '../api/client'
import { InstrumentIcon } from './InstrumentIcon'
import { freqToNoteName, freqToPitchDisplay } from '../utils/musicTheory'
import { SliceWaveform, type SliceWaveformRef } from './SliceWaveform'
import { DrumRackPadPicker } from './DrumRackPadPicker'
import { ConfirmModal } from './ConfirmModal'
import { SampleTypeIcon } from './SampleTypeIcon'
import { useAppDialog } from '../hooks/useAppDialog'
import { prepareTunePreviewPlayback } from '../services/tunePreviewAudio'
import {
  getTunePlaybackMode,
  getTunePreserveFormants,
  setTunePlaybackMode,
  setTunePreserveFormants,
  type TunePlaybackMode,
} from '../utils/tunePlaybackMode'
import {
  ENVELOPE_TYPE_OPTIONS,
  normalizeEnvelopeTypeForEdit,
  type EnvelopeTypeValue,
} from '../constants/envelopeTypes'

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
  onUpdateSample?: (sliceId: number, data: UpdateSlicePayload) => void
  onTagClick?: (tagId: number) => void
  onSampleDeleted?: (sliceId: number) => void
  onSelectSample?: (sampleId: number) => void
  onFilterBySimilarity?: (sampleId: number, sampleName: string) => void
  /** Semitone offset to apply during playback (e.g. +5.2 or -3). From external tuning. */
  pitchSemitones?: number
  /** Currently active tune-to note (null = off) */
  tuneTargetNote?: string | null
  /** Called when the user tunes all other samples to this sample's note */
  onTuneToNote?: (note: string | null) => void
}

const PITCH_ALGORITHM_OPTIONS: Array<{ value: TunePlaybackMode; label: string }> = [
  { value: 'tape', label: 'Tape' },
  { value: 'granular', label: 'Granular' },
  { value: 'hq', label: 'HQ' },
]
const NOTE_OPTIONS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

function normalizeTagName(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase()
}

function isOneShotName(value: string | null | undefined): boolean {
  const normalized = normalizeTagName(value)
  return normalized === 'oneshot' || normalized === 'one-shot' || normalized === 'one shot'
}

function isLoopName(value: string | null | undefined): boolean {
  const normalized = normalizeTagName(value)
  return normalized === 'loop' || normalized === 'loops'
}

function normalizeTagCategory(category: string | null | undefined): string {
  const normalized = (category || 'instrument').trim().toLowerCase()
  if (
    normalized === 'sample-type' ||
    normalized === 'sample type' ||
    normalized === 'sample_type' ||
    normalized === 'type'
  ) {
    return 'sample-type'
  }
  if (normalized === 'instrument' || normalized === 'filename') return normalized
  return 'instrument'
}

function isSampleTypeTag(tag: Pick<Tag, 'name' | 'category'>): boolean {
  return normalizeTagCategory(tag.category) === 'sample-type' || isOneShotName(tag.name) || isLoopName(tag.name)
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
        <div className="section-label mb-0.5">{label}</div>
        <div className="text-[13px] text-text-muted font-mono">—</div>
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
      <div className="section-label mb-0.5">{label}</div>
      <div className="text-[13px] text-text-primary font-mono">
        {displayValue}
        {unit && <span className="text-text-muted ml-1">{unit}</span>}
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
  const hasSimilarityListAction = Boolean(onFilterBySimilarity)
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
        <label className="section-label flex items-center gap-1.5 mb-2" data-tour="sample-details-similar-label">
          <Sparkles size={10} />
          Similar Samples
        </label>
        <div className="text-xs text-text-muted">Loading...</div>
      </div>
    )
  }

  if (visibleSimilarSamples.length === 0) {
    return null
  }

  const similarSectionTourTarget = hasSimilarityListAction ? undefined : 'sample-details-similar-section'
  const similarLabelTourTarget = hasSimilarityListAction ? undefined : 'sample-details-similar-label'

  return (
    <div data-tour={similarSectionTourTarget}>
      <label className="section-label flex items-center gap-1.5 mb-2" data-tour={similarLabelTourTarget}>
        <Sparkles size={10} />
        Similar Samples
      </label>
      <div className="grid grid-cols-2 gap-1.5">
        {visibleSimilarSamples.slice(0, 4).map((sample) => {
          const sampleIdNum = Number(sample.id)
          if (!Number.isFinite(sampleIdNum)) return null

          return (
            <button
              type="button"
              key={sampleIdNum}
              data-tour="sample-details-similar-card"
              onMouseEnter={() => handleMouseEnter(sampleIdNum)}
              onMouseLeave={handleMouseLeave}
              onClick={() => onSelectSample?.(sampleIdNum)}
              className={`group relative p-1.5 rounded-lg border transition-all text-left ${
                hoveredSample === sampleIdNum
                  ? 'border-accent-warm/50 bg-accent-warm/10 scale-[1.03]'
                  : 'border-surface-border bg-surface-base hover:border-surface-overlay'
              }`}
            >
              <div className="absolute top-0.5 right-0.5 px-1 py-0.5 rounded text-[9px] font-medium bg-accent-warm/20 text-accent-warm font-mono">
                {Math.round(sample.similarity * 100)}%
              </div>
              <div className="text-[11px] font-medium text-text-primary truncate pr-8">
                {sample.name}
              </div>
              <div className="text-[9px] text-text-muted truncate">
                {sample.track.title}
              </div>
            </button>
          )
        })}
      </div>
      {onFilterBySimilarity && (
        <div className="mt-1.5" data-tour="sample-details-show-all-similar-container">
          <button
            type="button"
            onClick={() => onFilterBySimilarity(sampleId, sampleName)}
            data-tour="sample-details-show-all-similar"
            className="w-full px-2.5 py-1.5 bg-accent-warm/10 hover:bg-accent-warm/15 text-accent-warm rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1.5"
          >
            <Sparkles size={12} />
            Show All Similar Samples
          </button>
        </div>
      )}
    </div>
  )
}

export function SampleDetailsView({
  sample,
  allTags,
  folders: _folders,
  onSelectSample,
  onFilterBySimilarity,
  onToggleFavorite,
  onAddTag,
  onRemoveTag,
  onAddToFolder: _onAddToFolder,
  onRemoveFromFolder: _onRemoveFromFolder,
  onUpdateName,
  onUpdateSample,
  onTagClick,
  onSampleDeleted,
  pitchSemitones: externalPitch = 0,
  tuneTargetNote,
  onTuneToNote,
}: SampleDetailsViewProps) {
  const { alert: showAlert, dialogNode } = useAppDialog()
  const [isPlaying, setIsPlaying] = useState(false)
  const [isWaveformReady, setIsWaveformReady] = useState(false)
  const [activeTab, setActiveTab] = useState<'details' | 'advanced'>('details')
  const [showPadPicker, setShowPadPicker] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleteSourceFile, setDeleteSourceFile] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isEditingName, setIsEditingName] = useState(false)
  const [editingName, setEditingName] = useState('')
  const [isEditingSampleType, setIsEditingSampleType] = useState(false)
  const [editingSampleType, setEditingSampleType] = useState<'oneshot' | 'loop' | null>(null)
  const [isEditingEnvelope, setIsEditingEnvelope] = useState(false)
  const [editingEnvelope, setEditingEnvelope] = useState<EnvelopeTypeValue | ''>('')
  const [isEditingNote, setIsEditingNote] = useState(false)
  const [editingNote, setEditingNote] = useState<string | null>(null)
  const [instrumentToAddId, setInstrumentToAddId] = useState<number | ''>('')
  const [editingInstrumentTagId, setEditingInstrumentTagId] = useState<number | null>(null)
  const [replacementInstrumentTagId, setReplacementInstrumentTagId] = useState<number | ''>('')
  const [manualPitch, setManualPitch] = useState(externalPitch)
  const [hasManualPitchOverride, setHasManualPitchOverride] = useState(false)
  const [pitchAlgorithm, setPitchAlgorithm] = useState<TunePlaybackMode>(() => getTunePlaybackMode())
  const [preserveFormants, setPreserveFormants] = useState<boolean>(() => getTunePreserveFormants())
  const [waveformSourceUrl, setWaveformSourceUrl] = useState<string | null>(null)
  const [waveformPlaybackSemitones, setWaveformPlaybackSemitones] = useState(externalPitch)
  const [isPreparingWaveform, setIsPreparingWaveform] = useState(false)
  const waveformRef = useRef<SliceWaveformRef>(null)
  const waveformRequestRef = useRef(0)
  const waveformSourceUrlRef = useRef<string | null>(null)
  const queryClient = useQueryClient()

  // Sync external pitch into local state when it changes
  useEffect(() => {
    if (!hasManualPitchOverride) {
      setManualPitch(externalPitch)
    }
  }, [externalPitch, hasManualPitchOverride])

  const updateManualPitch = (next: number, markAsManual = true) => {
    const clamped = Math.max(-24, Math.min(24, next))
    setManualPitch(clamped)
    if (markAsManual) {
      setHasManualPitchOverride(Math.abs(clamped - externalPitch) > 0.01)
    }
  }

  const handlePitchAlgorithmChange = (mode: TunePlaybackMode) => {
    setPitchAlgorithm(mode)
    setTunePlaybackMode(mode)
  }

  const handlePreserveFormantsChange = (enabled: boolean) => {
    setPreserveFormants(enabled)
    setTunePreserveFormants(enabled)
  }

  const setPreparedWaveform = useCallback((nextSourceUrl: string | null, nextPlaybackSemitones: number) => {
    const sourceChanged = waveformSourceUrlRef.current !== nextSourceUrl
    waveformSourceUrlRef.current = nextSourceUrl
    setWaveformSourceUrl(nextSourceUrl)
    setWaveformPlaybackSemitones(Number.isFinite(nextPlaybackSemitones) ? nextPlaybackSemitones : 0)
    if (sourceChanged) {
      setIsPlaying(false)
      setIsWaveformReady(false)
    }
  }, [])

  useEffect(() => {
    if (!sample) {
      setPreparedWaveform(null, 0)
      setIsPreparingWaveform(false)
      return
    }

    const requestId = ++waveformRequestRef.current
    let cancelled = false

    if (Math.abs(manualPitch) <= 0.0001) {
      setIsPreparingWaveform(false)
      setPreparedWaveform(getSliceDownloadUrl(sample.id), 0)
      return () => {
        cancelled = true
      }
    }

    setIsPreparingWaveform(true)
    const mode: TunePlaybackMode = pitchAlgorithm

    void (async () => {
      try {
        const { url, playbackRate } = await prepareTunePreviewPlayback(
          sample.id,
          manualPitch,
          mode,
          getSliceDownloadUrl(sample.id),
          {
            allowHqPreview: true,
            immediateFallbackToTape: false,
            renderFullSample: true,
            preserveFormants: mode !== 'tape' && preserveFormants,
          }
        )

        if (cancelled || requestId !== waveformRequestRef.current) return

        const playbackSemitones = Math.abs(playbackRate - 1) > 0.0001 ? 12 * Math.log2(playbackRate) : 0
        setPreparedWaveform(url, playbackSemitones)
      } catch (error) {
        console.error('Failed to prepare tuned sample details waveform:', error)
        if (!cancelled && requestId === waveformRequestRef.current) {
          setPreparedWaveform(getSliceDownloadUrl(sample.id), manualPitch)
        }
      } finally {
        if (!cancelled && requestId === waveformRequestRef.current) {
          setIsPreparingWaveform(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [sample?.id, manualPitch, pitchAlgorithm, preserveFormants, setPreparedWaveform])

  useEffect(() => {
    return () => {
      waveformRequestRef.current += 1
    }
  }, [])

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
    const nextFundamentalNote =
      sample?.fundamentalFrequency != null
        ? freqToNoteName(sample.fundamentalFrequency)
        : null
    setIsEditingName(false)
    setEditingName(sample?.name ?? '')
    setIsEditingSampleType(false)
    setEditingSampleType(sample?.sampleType ?? null)
    setIsEditingEnvelope(false)
    setEditingEnvelope(normalizeEnvelopeTypeForEdit(sample?.envelopeType))
    setIsEditingNote(false)
    setEditingNote(nextFundamentalNote)
    setInstrumentToAddId('')
    setEditingInstrumentTagId(null)
    setReplacementInstrumentTagId('')
    setManualPitch(externalPitch)
    setHasManualPitchOverride(false)
    if (waveformRef.current) {
      waveformRef.current.pause()
    }
  }, [sample?.id]) // eslint-disable-line react-hooks/exhaustive-deps

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

  const handleAnalyze = async () => {
    if (!sample) return
    try {
      setIsAnalyzing(true)
      await batchReanalyzeSamples([sample.id])
      queryClient.invalidateQueries({ queryKey: ['slices'] })
      queryClient.invalidateQueries({ queryKey: ['audioFeatures', sample.id] })
    } catch (error) {
      console.error('Failed to analyze sample:', error)
    } finally {
      setIsAnalyzing(false)
    }
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
      await showAlert({
        title: 'Delete Failed',
        message: 'Failed to delete sample. Please try again.',
        isDestructive: true,
      })
    }
  }

  const duration = sample.endTime - sample.startTime
  const fundamentalNote = sample.fundamentalFrequency != null ? freqToNoteName(sample.fundamentalFrequency) : null
  const fundamentalPitch = sample.fundamentalFrequency != null ? freqToPitchDisplay(sample.fundamentalFrequency) : null
  const hasTuneAllAction = !isEditingNote && Boolean(onTuneToNote && fundamentalNote)
  const isAutoPitch = externalPitch !== 0 && Math.abs(manualPitch - externalPitch) < 0.01
  const sampleTypeLabel = sample.sampleType === 'oneshot' ? 'One-shot' : sample.sampleType === 'loop' ? 'Loop' : 'Unspecified'
  const allInstrumentTags = allTags.filter((tag) => normalizeTagCategory(tag.category) === 'instrument' && !isSampleTypeTag(tag))
  const instrumentTags = sample.tags.filter((tag) => normalizeTagCategory(tag.category) === 'instrument' && !isSampleTypeTag(tag))
  const instrumentTagIds = new Set(instrumentTags.map((tag) => tag.id))
  const availableInstrumentTags = allInstrumentTags.filter((tag) => !instrumentTagIds.has(tag.id))
  const replacementInstrumentOptions = allInstrumentTags.filter((tag) => tag.id !== editingInstrumentTagId)
  const editingInstrumentTag = editingInstrumentTagId == null
    ? null
    : instrumentTags.find((tag) => tag.id === editingInstrumentTagId) || null

  const updateSampleField = (patch: UpdateSlicePayload) => {
    if (onUpdateSample) {
      onUpdateSample(sample.id, patch)
      return
    }

    if (typeof patch.name === 'string') {
      onUpdateName(sample.id, patch.name)
    }
  }

  const commitNameEdit = () => {
    const trimmed = editingName.trim()
    if (!trimmed) {
      void showAlert({
        title: 'Invalid Name',
        message: 'Sample name cannot be empty.',
      })
      return
    }

    if (trimmed !== sample.name) {
      updateSampleField({ name: trimmed })
    }
    setIsEditingName(false)
  }

  const cancelNameEdit = () => {
    setEditingName(sample.name)
    setIsEditingName(false)
  }

  const commitSampleTypeEdit = () => {
    if (editingSampleType !== (sample.sampleType ?? null)) {
      updateSampleField({ sampleType: editingSampleType })
    }
    setIsEditingSampleType(false)
  }

  const cancelSampleTypeEdit = () => {
    setEditingSampleType(sample.sampleType ?? null)
    setIsEditingSampleType(false)
  }

  const commitEnvelopeEdit = () => {
    const normalized = editingEnvelope || null
    const currentEnvelope = normalizeEnvelopeTypeForEdit(sample.envelopeType) || null
    if (normalized !== currentEnvelope) {
      updateSampleField({ envelopeType: normalized })
    }
    setIsEditingEnvelope(false)
  }

  const cancelEnvelopeEdit = () => {
    setEditingEnvelope(normalizeEnvelopeTypeForEdit(sample.envelopeType))
    setIsEditingEnvelope(false)
  }

  const commitNoteEdit = () => {
    const normalized = editingNote || null
    const currentNote = fundamentalNote || null
    if (normalized !== currentNote) {
      updateSampleField({ note: normalized })
    }
    setIsEditingNote(false)
  }

  const cancelNoteEdit = () => {
    setEditingNote(fundamentalNote)
    setIsEditingNote(false)
  }

  const commitAddInstrument = () => {
    if (instrumentToAddId === '') return
    onAddTag(sample.id, Number(instrumentToAddId))
    setInstrumentToAddId('')
  }

  const beginInstrumentEdit = (tagId: number) => {
    setEditingInstrumentTagId(tagId)
    setReplacementInstrumentTagId('')
  }

  const cancelInstrumentEdit = () => {
    setEditingInstrumentTagId(null)
    setReplacementInstrumentTagId('')
  }

  const commitInstrumentEdit = () => {
    if (editingInstrumentTagId == null) return
    if (replacementInstrumentTagId === '') {
      cancelInstrumentEdit()
      return
    }

    const replacementId = Number(replacementInstrumentTagId)
    if (!Number.isFinite(replacementId) || replacementId <= 0 || replacementId === editingInstrumentTagId) {
      cancelInstrumentEdit()
      return
    }

    if (!instrumentTagIds.has(replacementId)) {
      onAddTag(sample.id, replacementId)
    }
    onRemoveTag(sample.id, editingInstrumentTagId)
    cancelInstrumentEdit()
  }

  return (
    <div className="h-full flex flex-col bg-surface-base overflow-hidden" data-tour="sample-details-panel">
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-surface-border bg-surface-raised flex-shrink-0">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex-1 min-w-0">
            {isEditingName ? (
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  value={editingName}
                  onChange={(event) => setEditingName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') commitNameEdit()
                    if (event.key === 'Escape') cancelNameEdit()
                  }}
                  className="w-full rounded border border-surface-border bg-surface-base px-2 py-0.5 text-sm font-semibold text-text-primary focus:outline-none focus:border-accent-primary/70"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={commitNameEdit}
                  className="text-[11px] text-emerald-300 hover:text-emerald-200"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={cancelNameEdit}
                  className="text-[11px] text-text-muted hover:text-text-primary"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <h2 className="text-sm font-semibold text-text-primary truncate">{sample.name}</h2>
                <button
                  type="button"
                  onClick={() => setIsEditingName(true)}
                  className="p-0.5 rounded text-text-muted hover:text-text-primary hover:bg-surface-overlay"
                  title="Edit name"
                >
                  <Pencil size={11} />
                </button>
              </div>
            )}
            <p className="text-xs text-text-muted truncate mt-0.5">{sample.track?.title || 'Unknown track'}</p>
            <div className="mt-1 inline-flex items-center gap-1 rounded-full border border-surface-border bg-surface-overlay/70 px-2 py-0.5 text-[10px] text-text-secondary">
              <SampleTypeIcon sampleType={sample.sampleType ?? null} size={11} className="text-text-secondary" />
              <span>{sampleTypeLabel}</span>
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0" data-tour="sample-details-top-actions">
            <button
              onClick={() => onToggleFavorite(sample.id)}
              className={`p-1 rounded-md transition-colors ${
                sample.favorite
                  ? 'bg-accent-warm/20 text-accent-warm hover:bg-accent-warm/30'
                  : 'bg-surface-overlay text-text-muted hover:text-accent-warm'
              }`}
              title={sample.favorite ? 'Remove from favorites' : 'Add to favorites'}
            >
              <Heart size={14} className={sample.favorite ? 'fill-current' : ''} />
            </button>
            <button
              onClick={handleDownload}
              data-tour="sample-details-download"
              className="p-1 rounded-md bg-surface-overlay text-text-muted hover:text-text-primary transition-colors"
              title="Download"
            >
              <Download size={14} />
            </button>
            <button
              onClick={() => setShowPadPicker(true)}
              className="p-1 rounded-md bg-surface-overlay text-text-muted hover:text-accent-primary transition-colors"
              title="Send to Drum Rack"
            >
              <Disc3 size={14} />
            </button>
            <button
              onClick={handleAnalyze}
              disabled={isAnalyzing}
              data-tour="sample-details-reanalyze"
              className="p-1 rounded-md bg-surface-overlay text-text-muted hover:text-accent-primary transition-colors disabled:opacity-50"
              title="Re-analyze sample"
            >
              {isAnalyzing ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
            </button>
            <button
              onClick={() => setShowDeleteModal(true)}
              className="p-1 rounded-md bg-surface-overlay text-text-muted hover:text-red-400 transition-colors"
              title="Delete sample"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-surface-border -mb-2 pb-0">
          <button
            onClick={() => setActiveTab('details')}
            className={`px-2.5 py-1.5 text-xs font-medium transition-colors border-b-2 ${
              activeTab === 'details'
                ? 'text-text-primary border-text-secondary/50'
                : 'text-text-muted border-transparent hover:text-text-secondary'
            }`}
          >
            Details
          </button>
          <button
            onClick={() => setActiveTab('advanced')}
            className={`px-2.5 py-1.5 text-xs font-medium transition-colors border-b-2 flex items-center gap-1 ${
              activeTab === 'advanced'
                ? 'text-text-primary border-accent-warm/60'
                : 'text-text-muted border-transparent hover:text-text-secondary'
            }`}
          >
            <Activity size={12} />
            Advanced
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {activeTab === 'details' && (
          <>
            {/* Waveform */}
            <div>
              <SliceWaveform
                ref={waveformRef}
                sliceId={sample.id}
                sourceUrl={waveformSourceUrl || getSliceDownloadUrl(sample.id)}
                height={70}
                pitchSemitones={waveformPlaybackSemitones}
                onReady={() => setIsWaveformReady(true)}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onFinish={() => setIsPlaying(false)}
              />
              {/* Playback controls */}
              <div className="flex items-center gap-2 mt-2">
                <button
                  onClick={handlePlayPause}
                  disabled={!isWaveformReady || isPreparingWaveform}
                  className="w-8 h-8 rounded-full bg-accent-primary flex items-center justify-center text-white hover:bg-accent-primary/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isPlaying ? <Pause size={14} style={{ color: '#ffffff' }} /> : <Play size={14} className="ml-0.5" style={{ color: '#ffffff' }} />}
                </button>
                <div className="text-xs text-slate-400">
                  {isPreparingWaveform ? 'Preparing...' : `${duration.toFixed(2)}s`}
                </div>
              </div>

              {/* Pitch control */}
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-slate-500 whitespace-nowrap">Pitch:</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => updateManualPitch(+(manualPitch - 1).toFixed(1))}
                    className="w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:text-white hover:bg-surface-raised transition-colors text-xs"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    value={manualPitch}
                    step={0.1}
                    min={-24}
                    max={24}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value)
                      if (!isNaN(v)) updateManualPitch(v)
                    }}
                    className="w-14 text-center px-1 py-0.5 text-xs bg-surface-raised border border-surface-border rounded text-white focus:outline-none focus:border-accent-primary no-spinner"
                  />
                  <button
                    onClick={() => updateManualPitch(+(manualPitch + 1).toFixed(1))}
                    className="w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:text-white hover:bg-surface-raised transition-colors text-xs"
                  >
                    +
                  </button>
                </div>
                <span className="text-[11px] text-slate-500">st</span>
                {Math.abs(manualPitch) > 0.001 && (
                  <button
                    onClick={() => updateManualPitch(0)}
                    className="text-[11px] text-slate-500 hover:text-white transition-colors"
                    title="Reset pitch"
                  >
                    ×
                  </button>
                )}
                {isAutoPitch && (
                  <span className="text-[10px] text-accent-primary/70">auto</span>
                )}
                <div className="ml-auto flex items-center gap-1">
                  <span className="text-[10px] uppercase tracking-wide text-text-muted">Algo</span>
                  <select
                    value={pitchAlgorithm}
                    onChange={(event) => handlePitchAlgorithmChange(event.target.value as TunePlaybackMode)}
                    className="h-6 min-w-[92px] rounded border border-surface-border bg-surface-raised px-1.5 text-[11px] text-text-primary focus:outline-none focus:border-accent-primary/70"
                    title="Pitch algorithm"
                  >
                    {PITCH_ALGORITHM_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => handlePreserveFormantsChange(!preserveFormants)}
                    disabled={pitchAlgorithm === 'tape'}
                    className={`h-6 px-2 rounded border text-[10px] uppercase tracking-wide transition-colors ${
                      preserveFormants
                        ? 'border-emerald-500/70 bg-emerald-500/20 text-emerald-100'
                        : 'border-surface-border bg-surface-raised text-text-secondary'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                    title="Preserve vocal formants when using Granular/HQ pitch modes"
                  >
                    Formants
                  </button>
                </div>
              </div>
              {!hasManualPitchOverride && isAutoPitch && (
                <div className="mt-1 text-[10px] text-text-muted">
                  Auto tuning in this panel uses the selected algorithm. Hover/list previews still use Tape for performance.
                </div>
              )}
            </div>

            {/* Basic Info */}
            <div data-tour="sample-details-edit-fields">
              <h3 className="section-label mb-2">Basic Info</h3>
              <div className="grid grid-cols-2 gap-2">
                <FeatureItem label="Duration" value={duration} unit="s" />
                {sample.bpm != null && <FeatureItem label="BPM" value={Math.round(sample.bpm)} decimals={0} />}
                {sample.keyEstimate != null && <FeatureItem label="Key" value={sample.keyEstimate} isText />}
                <div data-tour={hasTuneAllAction ? undefined : 'sample-details-note-section'}>
                  <div className="text-[11px] text-slate-500">Note</div>
                  {isEditingNote ? (
                    <div className="flex items-center gap-1.5">
                      <select
                        value={editingNote ?? ''}
                        onChange={(event) => setEditingNote(event.target.value || null)}
                        className="h-6 rounded border border-surface-border bg-surface-raised px-1.5 text-[11px] text-text-primary focus:outline-none focus:border-accent-primary/70"
                      >
                        <option value="">Unspecified</option>
                        {NOTE_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={commitNoteEdit}
                        className="text-[11px] text-emerald-300 hover:text-emerald-200"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={cancelNoteEdit}
                        className="text-[11px] text-text-muted hover:text-text-primary"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {fundamentalPitch ? (
                        <div className="text-[13px] text-white font-mono">
                          {fundamentalPitch.noteWithOctave}
                          <span className="ml-1 text-[10px] text-slate-400">{fundamentalPitch.compactCentsLabel}</span>
                        </div>
                      ) : (
                        <div className="text-[13px] text-text-muted">Unspecified</div>
                      )}
                      <button
                        type="button"
                        onClick={() => setIsEditingNote(true)}
                        className="p-0.5 rounded text-text-muted hover:text-text-primary hover:bg-surface-overlay"
                        title="Edit note"
                      >
                        <Pencil size={11} />
                      </button>
                      {onTuneToNote && fundamentalNote && (
                        <button
                          onClick={() => onTuneToNote(tuneTargetNote === fundamentalNote ? null : fundamentalNote)}
                          data-tour="sample-details-tune-all"
                          className={`flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded border transition-colors ${
                            tuneTargetNote === fundamentalNote
                              ? 'bg-accent-primary/20 border-accent-primary text-accent-primary'
                              : 'border-surface-border text-slate-400 hover:text-white hover:border-slate-400'
                          }`}
                          title={tuneTargetNote === fundamentalNote ? 'Clear tuning' : `Tune all other samples to ${fundamentalNote}`}
                        >
                          <Crosshair size={8} />
                          {tuneTargetNote === fundamentalNote ? `Tuning → ${fundamentalNote}` : `Tune all to ${fundamentalNote}`}
                          {tuneTargetNote === fundamentalNote && <X size={8} className="ml-0.5 opacity-70" />}
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <div className="col-span-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[11px] text-slate-500">Instruments</div>
                    <div className="text-[10px] text-text-muted">{instrumentTags.length}</div>
                  </div>

                  {instrumentTags.length > 0 ? (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {instrumentTags.map((tag) => (
                        <div
                          key={tag.id}
                          className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px]"
                          style={{
                            backgroundColor: `${tag.color}25`,
                            color: tag.color,
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => onTagClick?.(tag.id)}
                            className={`inline-flex items-center gap-1 ${onTagClick ? 'hover:opacity-80 transition-opacity' : ''}`}
                            title={onTagClick ? `Filter by ${tag.name}` : undefined}
                          >
                            <InstrumentIcon type={tag.name} size={11} />
                            <span>{tag.name}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => beginInstrumentEdit(tag.id)}
                            className="rounded p-0.5 text-text-muted hover:text-text-primary hover:bg-surface-overlay"
                            title={`Replace ${tag.name}`}
                          >
                            <Pencil size={10} />
                          </button>
                          <button
                            type="button"
                            onClick={() => onRemoveTag(sample.id, tag.id)}
                            className="rounded p-0.5 text-text-muted hover:text-red-300 hover:bg-surface-overlay"
                            title={`Remove ${tag.name}`}
                          >
                            <X size={10} />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-1.5 text-[12px] text-text-muted">
                      {sample.instrumentPrimary ? `Detected: ${sample.instrumentPrimary}` : 'No instruments assigned.'}
                    </div>
                  )}

                  {editingInstrumentTag && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded border border-surface-border bg-surface-raised px-2 py-1.5">
                      <span className="text-[11px] text-text-muted">
                        Replace {editingInstrumentTag.name}:
                      </span>
                      <select
                        value={replacementInstrumentTagId}
                        onChange={(event) => {
                          const next = Number(event.target.value)
                          setReplacementInstrumentTagId(Number.isFinite(next) && next > 0 ? next : '')
                        }}
                        className="h-6 min-w-[130px] rounded border border-surface-border bg-surface-base px-1.5 text-[11px] text-text-primary focus:outline-none focus:border-accent-primary/70"
                      >
                        <option value="">Select instrument</option>
                        {replacementInstrumentOptions.map((tag) => (
                          <option key={tag.id} value={tag.id}>
                            {tag.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={commitInstrumentEdit}
                        disabled={replacementInstrumentTagId === ''}
                        className="text-[11px] text-emerald-300 hover:text-emerald-200 disabled:opacity-50"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={cancelInstrumentEdit}
                        className="text-[11px] text-text-muted hover:text-text-primary"
                      >
                        Cancel
                      </button>
                    </div>
                  )}

                  <div className="mt-2 flex items-center gap-1.5">
                    <select
                      value={instrumentToAddId}
                      onChange={(event) => {
                        const next = Number(event.target.value)
                        setInstrumentToAddId(Number.isFinite(next) && next > 0 ? next : '')
                      }}
                      className="h-6 min-w-[150px] rounded border border-surface-border bg-surface-raised px-1.5 text-[11px] text-text-primary focus:outline-none focus:border-accent-primary/70"
                    >
                      <option value="">Add instrument...</option>
                      {availableInstrumentTags.map((tag) => (
                        <option key={tag.id} value={tag.id}>
                          {tag.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={commitAddInstrument}
                      disabled={instrumentToAddId === ''}
                      className="h-6 w-6 rounded border border-surface-border bg-surface-raised text-text-muted hover:text-text-primary hover:border-surface-overlay disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                      title="Add instrument"
                    >
                      <Plus size={11} />
                    </button>
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500">Sample Type</div>
                  {isEditingSampleType ? (
                    <div className="flex items-center gap-1.5">
                      <select
                        value={editingSampleType ?? ''}
                        onChange={(event) => {
                          const next = event.target.value as 'oneshot' | 'loop' | ''
                          setEditingSampleType(next === '' ? null : next)
                        }}
                        className="h-6 rounded border border-surface-border bg-surface-raised px-1.5 text-[11px] text-text-primary focus:outline-none focus:border-accent-primary/70"
                      >
                        <option value="">Unspecified</option>
                        <option value="oneshot">One-shot</option>
                        <option value="loop">Loop</option>
                      </select>
                      <button
                        type="button"
                        onClick={commitSampleTypeEdit}
                        className="text-[11px] text-emerald-300 hover:text-emerald-200"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={cancelSampleTypeEdit}
                        className="text-[11px] text-text-muted hover:text-text-primary"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-[13px] text-white">
                      <SampleTypeIcon sampleType={sample.sampleType ?? null} size={13} className="text-slate-300" />
                      <span>{sampleTypeLabel}</span>
                      <button
                        type="button"
                        onClick={() => setIsEditingSampleType(true)}
                        className="p-0.5 rounded text-text-muted hover:text-text-primary hover:bg-surface-overlay"
                        title="Edit sample type"
                      >
                        <Pencil size={11} />
                      </button>
                    </div>
                  )}
                </div>
                <div>
                  <div className="text-[11px] text-slate-500">Envelope</div>
                  {isEditingEnvelope ? (
                    <div className="flex items-center gap-1.5">
                      <select
                        value={editingEnvelope}
                        onChange={(event) => setEditingEnvelope(event.target.value as EnvelopeTypeValue | '')}
                        className="h-6 min-w-[110px] rounded border border-surface-border bg-surface-raised px-1.5 text-[11px] text-text-primary focus:outline-none focus:border-accent-primary/70"
                      >
                        <option value="">Unspecified</option>
                        {ENVELOPE_TYPE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={commitEnvelopeEdit}
                        className="text-[11px] text-emerald-300 hover:text-emerald-200"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={cancelEnvelopeEdit}
                        className="text-[11px] text-text-muted hover:text-text-primary"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-[13px] text-text-primary">
                      <span>{sample.envelopeType || 'Unspecified'}</span>
                      <button
                        type="button"
                        onClick={() => setIsEditingEnvelope(true)}
                        className="p-0.5 rounded text-text-muted hover:text-text-primary hover:bg-surface-overlay"
                        title="Edit envelope"
                      >
                        <Pencil size={11} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

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
          <div className="space-y-3">
            <div>
              <h3 className="section-label mb-2">Spectral Features</h3>
              <div className="grid grid-cols-2 gap-2">
                <FeatureItem label="Spectral Centroid" value={audioFeatures.spectralCentroid} unit="Hz" decimals={1} />
                <FeatureItem label="Spectral Rolloff" value={audioFeatures.spectralRolloff} unit="Hz" decimals={1} />
                <FeatureItem label="Spectral Flux" value={audioFeatures.spectralFlux} decimals={3} />
                <FeatureItem label="Spectral Flatness" value={audioFeatures.spectralFlatness} decimals={3} />
              </div>
            </div>

            <div>
              <h3 className="section-label mb-2">Temporal Features</h3>
              <div className="grid grid-cols-2 gap-2">
                <FeatureItem label="RMS Energy" value={audioFeatures.rmsEnergy} decimals={3} />
                <FeatureItem label="Zero Crossing Rate" value={audioFeatures.zeroCrossingRate} decimals={3} />
                <FeatureItem label="Onset Strength" value={(audioFeatures as any).onsetStrength} decimals={3} />
              </div>
            </div>

            <div>
              <h3 className="section-label mb-2">Perceptual Features</h3>
              <div className="grid grid-cols-2 gap-2">
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
      {dialogNode}
    </div>
  )
}
