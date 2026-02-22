import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Pause, Play, Search, X } from 'lucide-react'
import type { AudioFilterState } from './SourcesAudioFilter'
import { SourcesAudioFilter } from './SourcesAudioFilter'
import { SourcesTagFilter } from './SourcesTagFilter'
import { CustomCheckbox } from './CustomCheckbox'
import type { CustomSplitAction, SplitCategory } from '../hooks/useCustomSplitState'
import type { SourceScope, SliceWithTrackExtended, Tag } from '../types'
import { useScopedSamples } from '../hooks/useScopedSamples'
import { getSliceDownloadUrl } from '../api/client'
import { getRelatedKeys, getRelatedNotes } from '../utils/musicTheory'

export type SplitSampleContext =
  | { type: 'all' }
  | { type: 'folder'; id: number; name: string }
  | { type: 'tag'; id: number; name: string }
  | { type: 'collection'; id: number; name: string }

interface Props {
  context: SplitSampleContext | null
  activeCategory: SplitCategory | null
  dispatch: React.Dispatch<CustomSplitAction>
  allTags: Tag[]
  folderCollectionMap: Map<number, number>
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
  dateUpdatedFrom: '',
  dateUpdatedTo: '',
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

function resolveScope(context: SplitSampleContext | null): SourceScope {
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

export function CustomSplitSampleSelectPanel({
  context,
  activeCategory,
  dispatch,
  allTags,
  folderCollectionMap,
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
      dateUpdatedFrom: audioFilter.dateUpdatedFrom || undefined,
      dateUpdatedTo: audioFilter.dateUpdatedTo || undefined,
    }
  )

  const allSamples = samplesData?.samples || []
  const totalCount = samplesData?.total || 0

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

      const matchesDateRange = (
        value: string | null | undefined,
        from: string,
        to: string,
      ) => {
        if (!from && !to) return true
        if (!value) return false
        if (from && value < from) return false
        if (to && value > `${to}T23:59:59`) return false
        return true
      }

      if (!matchesDateRange(sample.dateAdded, audioFilter.dateAddedFrom, audioFilter.dateAddedTo)) {
        return false
      }
      if (!matchesDateRange(sample.dateCreated, audioFilter.dateCreatedFrom, audioFilter.dateCreatedTo)) {
        return false
      }
      if (!matchesDateRange(sample.dateModified, audioFilter.dateUpdatedFrom, audioFilter.dateUpdatedTo)) {
        return false
      }

      return true
    })
  }, [allSamples, minDuration, maxDuration, audioFilter])

  const handlePlay = (id: number) => {
    if (playingId === id) {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
      setPlayingId(null)
      return
    }
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    const audio = new Audio(getSliceDownloadUrl(id))
    audio.loop = false
    audio.onended = () => {
      setPlayingId(null)
      audioRef.current = null
    }
    audio.play()
    audioRef.current = audio
    setPlayingId(id)
  }

  const selection = activeCategory?.sourceSelection

  const isAutoSelected = (sample: SliceWithTrackExtended) => {
    if (!selection) return false
    if (sample.folderIds?.some(id => selection.selectedFolderIds.has(id))) return true
    if (sample.tags?.some(tag => selection.selectedTagIds.has(tag.id))) return true
    if (sample.folderIds?.some(id => {
      const collectionId = folderCollectionMap.get(id)
      return collectionId ? selection.selectedCollectionIds.has(collectionId) : false
    })) return true
    return false
  }

  const handleToggleSample = (sample: SliceWithTrackExtended) => {
    if (!selection) return
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

  const heading =
    context?.type === 'all'
      ? 'All samples'
      : context?.type === 'folder'
      ? `Samples in ${context.name}`
      : context?.type === 'collection'
      ? `Samples in ${context.name}`
      : context?.type === 'tag'
      ? `Samples tagged ${context.name}`
      : 'Pick a source'

  if (!context) return null

  return (
    <div
      className={`absolute inset-y-0 right-0 w-[58%] max-w-2xl bg-surface-raised border-l border-surface-border shadow-xl transform transition-transform duration-300 ${
        isOpen && !isClosing ? 'translate-x-0' : 'translate-x-full'
      }`}
    >
      <div className="flex flex-col h-full">
        <div className="px-4 py-3 border-b border-surface-border flex items-start gap-3">
          <button
            className="mt-0.5 p-1 text-slate-400 hover:text-white"
            onClick={onClose}
          >
            <X size={16} />
          </button>
          <div>
            <h3 className="text-sm font-medium text-slate-200">Filter Samples</h3>
            <p className="text-xs text-slate-500 mt-1">{heading}</p>
          </div>
        </div>

        {!activeCategory && (
          <div className="flex-1 flex items-center justify-center text-sm text-slate-500">
            Create or select a category to start.
          </div>
        )}

        {activeCategory && (
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-surface-border space-y-2">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search samples..."
                  className="w-full pl-8 pr-3 py-1.5 text-sm bg-surface-base border border-surface-border rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary"
                />
              </div>
              <SourcesTagFilter
                selectedTags={selectedTags}
                onTagsChange={setSelectedTags}
                allTags={filteredTagsForFilter}
                onCreateTag={undefined}
                totalCount={totalCount}
                filteredCount={samples.length}
              />
              <div className="flex items-center gap-2">
                <label className="text-xs text-slate-500">Tag category</label>
                <select
                  className="text-xs bg-surface-base border border-surface-border rounded px-2 py-1 text-slate-200"
                  value={tagCategory}
                  onChange={(e) => setTagCategory(e.target.value)}
                >
                  <option value="all">All</option>
                  {tagCategories.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
                <button
                  className="ml-auto text-xs text-slate-500 hover:text-slate-300 flex items-center gap-1"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                >
                  <ChevronDown size={12} className={showAdvanced ? 'rotate-180 transition-transform' : 'transition-transform'} />
                  Advanced
                </button>
              </div>
            </div>

            {showAdvanced && (
              <div className="px-4 py-3 border-b border-surface-border">
                <SourcesAudioFilter
                  filterState={audioFilter}
                  onChange={setAudioFilter}
                  availableKeys={[...new Set(samples.map(s => s.keyEstimate).filter(Boolean) as string[])]}
                  availableEnvelopeTypes={[...new Set(samples.map(s => s.envelopeType).filter(Boolean) as string[])]}
                  availableInstruments={[...new Set(samples.map(s => s.instrumentType || s.instrumentPrimary).filter(Boolean) as string[])]}
                  availableGenres={[...new Set(samples.map(s => s.genrePrimary).filter(Boolean) as string[])]}
                />
              </div>
            )}

            <div className="flex-1 min-h-0 overflow-y-auto">
              {isLoading ? (
                <div className="text-xs text-slate-500 p-4">Loading samples...</div>
              ) : samples.length === 0 ? (
                <div className="text-xs text-slate-500 p-4">No samples match these filters.</div>
              ) : (
                <div className="divide-y divide-surface-border">
                  {samples.map(sample => {
                    const autoSelected = isAutoSelected(sample)
                    const individuallySelected = selection?.individuallySelectedIds.has(sample.id) ?? false
                    const excluded = selection?.excludedSampleIds.has(sample.id) ?? false
                    const isChecked = (autoSelected || individuallySelected) && !excluded
                    return (
                      <div key={sample.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                        <CustomCheckbox checked={isChecked} onChange={() => handleToggleSample(sample)} />
                        <button
                          className="p-1 text-slate-400 hover:text-white"
                          onClick={() => handlePlay(sample.id)}
                        >
                          {playingId === sample.id ? <Pause size={14} /> : <Play size={14} />}
                        </button>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-slate-200 truncate">{sample.name}</span>
                            <span className="text-xs text-slate-500">{formatDuration(sample.startTime, sample.endTime)}</span>
                          </div>
                          <div className="text-[11px] text-slate-500 truncate">{sample.track?.title}</div>
                        </div>
                        {sample.tags && sample.tags.length > 0 && (
                          <span className="text-xs text-slate-500">+{sample.tags.length}</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
