import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Play, Pause, Search, X } from 'lucide-react'
import type { AudioFilterState } from './SourcesAudioFilter'
import { SourcesAudioFilter } from './SourcesAudioFilter'
import { SourcesTagFilter } from './SourcesTagFilter'
import { CustomCheckbox } from './CustomCheckbox'
import type { CustomOrderAction, SourceSelection } from '../hooks/useCustomOrderState'
import type { SourceScope, SliceWithTrackExtended, Tag } from '../types'
import { useScopedSamples } from '../hooks/useScopedSamples'
import { getSliceDownloadUrl } from '../api/client'
import { getRelatedKeys, getRelatedNotes } from '../utils/musicTheory'
import { createManagedAudio, releaseManagedAudio } from '../services/globalAudioVolume'

export type SampleSelectContext =
  | { type: 'all' }
  | { type: 'folder'; id: number; name: string }
  | { type: 'tag'; id: number; name: string }
  | { type: 'collection'; id: number; name: string }

interface Props {
  context: SampleSelectContext | null
  selectionSource: SourceSelection
  dispatch: React.Dispatch<CustomOrderAction>
  allTags: Tag[]
  isOpen: boolean
  isClosing: boolean
  onClose: () => void
}

const initialAudioFilter: AudioFilterState = {
  sortBy: null,
  sortOrder: 'asc',
  minBpm: 0,
  maxBpm: 300,
  dateAddedFrom: '',
  dateAddedTo: '',
  dateCreatedFrom: '',
  dateCreatedTo: '',
  pitchFilterMode: 'fundamental',
  selectedNotes: [],
  relatedNotesLevels: [],
  selectedKeys: [],
  selectedEnvelopeTypes: [],
  minBrightness: 0,
  maxBrightness: 1,
  minWarmth: 0,
  maxWarmth: 1,
  minHardness: 0,
  maxHardness: 1,
  selectedInstruments: [],
  selectedGenres: [],
  relatedKeysLevels: [],
  groupByScaleDegree: false,
}

function resolveScope(context: SampleSelectContext | null): SourceScope {
  if (!context) return { type: 'all' }
  if (context.type === 'all') return { type: 'all' }
  if (context.type === 'folder') return { type: 'my-folder', folderId: context.id }
  if (context.type === 'collection') return { type: 'collection', collectionId: context.id }
  return { type: 'all' }
}

function formatDuration(startTime: number, endTime: number) {
  const dur = endTime - startTime
  if (dur < 60) return `${dur.toFixed(1)}s`
  const mins = Math.floor(dur / 60)
  const secs = Math.floor(dur % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export function CustomOrderSampleSelectPanel({
  context,
  selectionSource,
  dispatch,
  allTags,
  isOpen,
  isClosing,
  onClose,
}: Props) {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTags, setSelectedTags] = useState<number[]>([])
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [minDuration, setMinDuration] = useState(0)
  const [maxDuration, setMaxDuration] = useState(300)
  const [audioFilter, setAudioFilter] = useState<AudioFilterState>(initialAudioFilter)
  const [tagCategory, setTagCategory] = useState('all')
  const [playingId, setPlayingId] = useState<number | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
        releaseManagedAudio(audioRef.current)
        audioRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    setSearchQuery('')
    setSelectedTags([])
    setShowAdvanced(false)
    setMinDuration(0)
    setMaxDuration(300)
    setAudioFilter(initialAudioFilter)
  }, [context?.type, (context as any)?.id])

  const tagCategories = useMemo(() => {
    const categories = new Set<string>()
    for (const tag of allTags) {
      categories.add(((tag as any).category || 'general') as string)
    }
    return Array.from(categories).sort()
  }, [allTags])

  const filteredTagsForFilter = useMemo(() => {
    if (tagCategory === 'all') return allTags
    return allTags.filter(tag => ((tag as any).category || 'general') === tagCategory)
  }, [allTags, tagCategory])

  const effectiveKeys = useMemo(() => {
    const keys = [...audioFilter.selectedKeys]
    if (audioFilter.relatedKeysLevels.length > 0) {
      const relatedGroups = getRelatedKeys(audioFilter.selectedKeys)
      for (const group of relatedGroups) {
        if (audioFilter.relatedKeysLevels.includes(group.level)) {
          keys.push(...group.keys)
        }
      }
    }
    return keys
  }, [audioFilter.selectedKeys, audioFilter.relatedKeysLevels])

  const effectiveNotes = useMemo(() => {
    const notes = [...(audioFilter.selectedNotes || [])]
    if ((audioFilter.relatedNotesLevels || []).length > 0) {
      const relatedGroups = getRelatedNotes(audioFilter.selectedNotes || [])
      for (const group of relatedGroups) {
        if (audioFilter.relatedNotesLevels!.includes(group.level)) {
          notes.push(...group.keys)
        }
      }
    }
    return notes
  }, [audioFilter.selectedNotes, audioFilter.relatedNotesLevels])

  const baseTagIds = context?.type === 'tag' ? [context.id] : []
  const effectiveTagIds = Array.from(new Set([...baseTagIds, ...selectedTags]))

  const { data: samplesData, isLoading } = useScopedSamples(
    resolveScope(context),
    effectiveTagIds,
    searchQuery,
    false,
    {
      sortBy: audioFilter.sortBy || undefined,
      sortOrder: audioFilter.sortOrder,
      minBpm: audioFilter.minBpm > 0 ? audioFilter.minBpm : undefined,
      maxBpm: audioFilter.maxBpm < 300 ? audioFilter.maxBpm : undefined,
      keys: audioFilter.pitchFilterMode === 'scale' && effectiveKeys.length > 0 ? effectiveKeys : undefined,
      notes: audioFilter.pitchFilterMode === 'fundamental' && effectiveNotes.length > 0 ? effectiveNotes : undefined,
      dateAddedFrom: audioFilter.dateAddedFrom || undefined,
      dateAddedTo: audioFilter.dateAddedTo || undefined,
      dateCreatedFrom: audioFilter.dateCreatedFrom || undefined,
      dateCreatedTo: audioFilter.dateCreatedTo || undefined,
    }
  )

  const allSamples = samplesData?.samples || []
  const totalCount = samplesData?.total || 0

  const tagCounts = useMemo(() => {
    const counts: Record<number, number> = {}
    const countsByName: Record<string, number> = {}
    for (const sample of allSamples) {
      for (const tag of sample.tags || []) {
        counts[tag.id] = (counts[tag.id] || 0) + 1
        const key = tag.name.toLowerCase()
        countsByName[key] = (countsByName[key] || 0) + 1
      }
    }
    return { counts, countsByName }
  }, [allSamples])

  const samples = useMemo(() => {
    return allSamples.filter(sample => {
      const duration = sample.endTime - sample.startTime
      if (duration < minDuration || (maxDuration < 600 && duration > maxDuration)) {
        return false
      }
      if (audioFilter.selectedEnvelopeTypes.length > 0) {
        if (!sample.envelopeType || !audioFilter.selectedEnvelopeTypes.includes(sample.envelopeType)) {
          return false
        }
      }
      if (audioFilter.selectedInstruments.length > 0) {
        const instrType = sample.instrumentType || sample.instrumentPrimary
        if (!instrType || !audioFilter.selectedInstruments.includes(instrType)) {
          return false
        }
      }
      if (audioFilter.selectedGenres.length > 0) {
        if (!sample.genrePrimary || !audioFilter.selectedGenres.includes(sample.genrePrimary)) {
          return false
        }
      }
      return true
    })
  }, [allSamples, minDuration, maxDuration, audioFilter])

  const handlePlay = (id: number) => {
    if (playingId === id) {
      if (audioRef.current) {
        audioRef.current.pause()
        releaseManagedAudio(audioRef.current)
        audioRef.current = null
      }
      setPlayingId(null)
      return
    }
    if (audioRef.current) {
      audioRef.current.pause()
      releaseManagedAudio(audioRef.current)
      audioRef.current = null
    }
    const audio = createManagedAudio(getSliceDownloadUrl(id), { loop: false })
    audio.onended = () => {
      setPlayingId(null)
      releaseManagedAudio(audio)
      audioRef.current = null
    }
    audio.play()
    audioRef.current = audio
    setPlayingId(id)
  }

  const selection = selectionSource

  const isAutoSelected = (sample: SliceWithTrackExtended) => {
    const fromFolder = sample.folderIds?.some(id => selection.selectedFolderIds.has(id)) ?? false
    const fromTag = sample.tags?.some(tag => selection.selectedTagIds.has(tag.id)) ?? false
    const excludedByFolder = sample.folderIds?.some(id => selection.excludedFolderIds.has(id)) ?? false
    const excludedByTag = sample.tags?.some(tag => selection.excludedTagIds.has(tag.id)) ?? false

    return (fromFolder || fromTag) && !(excludedByFolder || excludedByTag)
  }

  const isSampleChecked = (sample: SliceWithTrackExtended) => {
    const autoSelected = isAutoSelected(sample)
    const individuallySelected = selection.individuallySelectedIds.has(sample.id)
    const excluded = selection.excludedSampleIds.has(sample.id)
    return (autoSelected || individuallySelected) && !excluded
  }

  const unselectedVisibleCount = useMemo(() => {
    let count = 0
    for (const sample of samples) {
      if (!isSampleChecked(sample)) count += 1
    }
    return count
  }, [samples, selection])

  const handleSelectAllVisible = () => {
    for (const sample of samples) {
      if (!isSampleChecked(sample)) {
        dispatch({ type: 'TOGGLE_INDIVIDUAL_SAMPLE', sampleId: sample.id })
      }
    }
  }

  const handleDeselectAllVisible = () => {
    for (const sample of samples) {
      if (isSampleChecked(sample)) {
        handleToggleSample(sample)
      }
    }
  }

  const selectedVisibleCount = samples.length - unselectedVisibleCount
  const allVisibleSelected = samples.length > 0 && unselectedVisibleCount === 0
  const partiallySelected = selectedVisibleCount > 0 && unselectedVisibleCount > 0

  const handleToggleSample = (sample: SliceWithTrackExtended) => {
    const autoSelected = isAutoSelected(sample)
    const individuallySelected = selection.individuallySelectedIds.has(sample.id)
    const excluded = selection.excludedSampleIds.has(sample.id)
    const isChecked = (autoSelected || individuallySelected) && !excluded

    if (excluded) {
      dispatch({ type: 'INCLUDE_SAMPLE', sampleId: sample.id })
      return
    }

    if (isChecked) {
      if (autoSelected && !individuallySelected) {
        dispatch({ type: 'EXCLUDE_SAMPLE', sampleId: sample.id })
        return
      }
      if (!autoSelected && individuallySelected) {
        dispatch({ type: 'TOGGLE_INDIVIDUAL_SAMPLE', sampleId: sample.id })
        return
      }
      if (autoSelected && individuallySelected) {
        dispatch({ type: 'EXCLUDE_SAMPLE', sampleId: sample.id })
        dispatch({ type: 'TOGGLE_INDIVIDUAL_SAMPLE', sampleId: sample.id })
        return
      }
    } else {
      dispatch({ type: 'TOGGLE_INDIVIDUAL_SAMPLE', sampleId: sample.id })
    }
  }

  if (!context) return null

  const heading =
    context.type === 'all'
      ? 'All samples'
      : context.type === 'folder'
      ? `Samples in ${context.name}`
      : context.type === 'collection'
      ? `Samples in ${context.name}`
      : `Samples tagged ${context.name}`

  const panelClass = `absolute inset-0 bg-surface-raised z-20 transition-transform duration-300 ease-out ${
    isOpen && !isClosing ? 'translate-x-0' : '-translate-x-full'
  }`

  return (
    <div className={panelClass}>
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-surface-border">
          <button
            className="p-1 text-slate-400 hover:text-white"
            onClick={onClose}
            title="Close sample selector"
          >
            <X size={16} />
          </button>
          <div>
            <div className="text-sm font-medium text-slate-200">{heading}</div>
            <div className="text-xs text-slate-500">Select samples to include or exclude.</div>
          </div>
        </div>

        <div className="px-4 py-3 border-b border-surface-border space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search samples..."
                className="w-full pl-8 pr-3 py-1.5 text-sm bg-surface-base border border-surface-border rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary"
              />
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span>Category</span>
              <select
                value={tagCategory}
                onChange={(e) => setTagCategory(e.target.value)}
                className="bg-surface-base border border-surface-border rounded px-2 py-1 text-xs text-slate-300"
              >
                <option value="all">All</option>
                {tagCategories.map(category => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <SourcesTagFilter
            selectedTags={selectedTags}
            onTagsChange={setSelectedTags}
            allTags={filteredTagsForFilter}
            tagCounts={tagCounts.counts}
            tagNameCounts={tagCounts.countsByName}
            totalCount={totalCount}
            filteredCount={samples.length}
          />

          {context.type === 'all' && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-slate-500">
                {selectedVisibleCount} selected • {samples.length} visible
              </span>
              <div className="flex items-center gap-2">
                <CustomCheckbox
                  checked={allVisibleSelected}
                  indeterminate={partiallySelected}
                  onChange={(e) => {
                    e.stopPropagation()
                    if (allVisibleSelected || partiallySelected) {
                      handleDeselectAllVisible()
                    } else {
                      handleSelectAllVisible()
                    }
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className={`${isLoading || samples.length === 0 ? 'opacity-50 pointer-events-none' : ''}`}
                  title="Toggle all visible samples"
                />
                <span className="text-xs text-slate-300">Select all visible</span>
              </div>
            </div>
          )}

          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-300 transition-colors"
          >
            <ChevronDown size={12} className={`transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
            <span>Advanced filters</span>
          </button>

          {showAdvanced && (
            <div className="mt-2 p-3 bg-surface-base border border-surface-border rounded-lg space-y-3">
              <SourcesAudioFilter
                filterState={audioFilter}
                onChange={setAudioFilter}
                availableKeys={[...new Set(samples.map(s => s.keyEstimate).filter(Boolean) as string[])]}
                availableEnvelopeTypes={[...new Set(samples.map(s => s.envelopeType).filter(Boolean) as string[])]}
                availableInstruments={[...new Set(samples.map(s => s.instrumentType || s.instrumentPrimary).filter(Boolean) as string[])]}
                availableGenres={[...new Set(samples.map(s => s.genrePrimary).filter(Boolean) as string[])]}
              />

              <div className="h-px bg-surface-border" />

              <div className="flex items-center gap-3 text-xs text-slate-400">
                <span className="whitespace-nowrap">Duration</span>
                <input
                  type="number"
                  value={minDuration.toFixed(1)}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value) || 0
                    setMinDuration(Math.max(0, Math.min(val, maxDuration)))
                  }}
                  className="w-16 px-1.5 py-0.5 text-xs bg-surface-raised border border-surface-border rounded text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary no-spinner"
                  step="0.1"
                />
                <span>-</span>
                <input
                  type="number"
                  value={maxDuration.toFixed(1)}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value) || 0
                    setMaxDuration(Math.max(minDuration, Math.min(val, 600)))
                  }}
                  className="w-16 px-1.5 py-0.5 text-xs bg-surface-raised border border-surface-border rounded text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary no-spinner"
                  step="0.1"
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading && (
            <div className="px-4 py-3 text-xs text-slate-500">Loading samples...</div>
          )}
          {!isLoading && samples.length === 0 && (
            <div className="px-4 py-3 text-xs text-slate-500">No samples</div>
          )}
          {!isLoading && samples.map(sample => {
            const excluded = selection.excludedSampleIds.has(sample.id)
            const isChecked = isSampleChecked(sample)

            return (
              <div
                key={sample.id}
                className={`px-4 py-2 border-b border-surface-border/50 ${
                  excluded ? 'opacity-60' : 'hover:bg-surface-base/60'
                }`}
              >
                <div className="flex items-center gap-3">
                  <CustomCheckbox
                    checked={isChecked}
                    onChange={(e) => {
                      e.stopPropagation()
                      handleToggleSample(sample)
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-shrink-0"
                  />
                  <button
                    className={`p-1.5 rounded transition-colors ${
                      playingId === sample.id
                        ? 'bg-accent-primary text-white'
                        : 'text-slate-400 hover:text-accent-primary hover:bg-surface-base'
                    }`}
                    onClick={(e) => {
                      e.stopPropagation()
                      handlePlay(sample.id)
                    }}
                  >
                    {playingId === sample.id ? <Pause size={14} /> : <Play size={14} />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white font-medium truncate">{sample.name}</div>
                    <div className="text-[11px] text-slate-500 truncate">
                      {sample.track.artist || sample.track.title}
                    </div>
                  </div>
                  <div className="hidden md:flex items-center gap-3 text-xs text-slate-500">
                    <span>{sample.bpm ? Math.round(sample.bpm) : '-'}</span>
                    <span>{sample.keyEstimate || '-'}</span>
                    <span>{formatDuration(sample.startTime, sample.endTime)}</span>
                  </div>
                  {sample.tags.length > 0 && (
                    <div className="group relative text-[10px] text-slate-500">
                      <span className="cursor-default">+{sample.tags.length}</span>
                      <div className="absolute right-0 top-full mt-1 hidden group-hover:block bg-surface-raised border border-surface-border rounded-lg shadow-lg p-2 z-20">
                        <div className="flex flex-wrap gap-1 max-w-[200px]">
                          {sample.tags.map(tag => (
                            <span
                              key={tag.id}
                              className="px-1.5 py-0.5 rounded-full text-[10px]"
                              style={{ backgroundColor: tag.color + '25', color: tag.color }}
                            >
                              {tag.name}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
