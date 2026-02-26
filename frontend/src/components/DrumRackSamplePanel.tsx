import { useMemo, useState } from 'react'
import { ChevronDown, Disc3, Play, Search, Square } from 'lucide-react'
import { useScopedSamples } from '../hooks/useScopedSamples'
import { useTags } from '../hooks/useTracks'
import { useDrumRack } from '../contexts/DrumRackContext'
import { SourcesTagFilter } from './SourcesTagFilter'
import { SourcesAudioFilter, type AudioFilterState } from './SourcesAudioFilter'
import { DrumRackPadPicker } from './DrumRackPadPicker'
import { getRelatedKeys, getRelatedNotes } from '../utils/musicTheory'
import type { SliceWithTrackExtended, Tag } from '../types'

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

function formatDuration(startTime: number, endTime: number) {
  const duration = endTime - startTime
  if (duration < 60) return `${duration.toFixed(1)}s`
  const mins = Math.floor(duration / 60)
  const secs = Math.floor(duration % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export function DrumRackSamplePanel() {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTags, setSelectedTags] = useState<number[]>([])
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [minDuration, setMinDuration] = useState(0)
  const [maxDuration, setMaxDuration] = useState(300)
  const [audioFilter, setAudioFilter] = useState<AudioFilterState>(initialAudioFilter)
  const [tagCategory, setTagCategory] = useState('all')
  const [padPickerSample, setPadPickerSample] = useState<SliceWithTrackExtended | null>(null)

  const { data: allTags = [] } = useTags()
  const { previewSample, previewingSliceId } = useDrumRack()

  const tagCategories = useMemo(() => {
    const categories = new Set<string>()
    for (const tag of allTags) {
      categories.add(((tag as Tag & { category?: string }).category || 'general') as string)
    }
    return Array.from(categories).sort()
  }, [allTags])

  const filteredTagsForFilter = useMemo(() => {
    if (tagCategory === 'all') return allTags
    return allTags.filter(tag => ((tag as Tag & { category?: string }).category || 'general') === tagCategory)
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

  const { data: samplesData, isLoading } = useScopedSamples(
    { type: 'all' },
    selectedTags,
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

  const handleDragStart = (sample: SliceWithTrackExtended) => (e: React.DragEvent) => {
    e.dataTransfer.setData('application/json', JSON.stringify({
      type: 'samples',
      sampleIds: [sample.id],
      slice: sample,
    }))
    e.dataTransfer.effectAllowed = 'copy'
  }

  return (
    <div className="flex w-56 sm:w-64 lg:w-72 xl:w-80 h-full min-h-0 border-r border-surface-border bg-surface-raised flex-col overflow-hidden shrink-0">
      <div className="px-3 py-3 border-b border-surface-border">
        <div className="text-sm font-medium text-white">Sample Browser</div>
        <div className="text-xs text-slate-500 mt-0.5">Drag samples to pads or use Send to Drum Rack.</div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="px-3 py-3 border-b border-surface-border space-y-3">
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

            <select
              value={tagCategory}
              onChange={(e) => setTagCategory(e.target.value)}
              className="bg-surface-base border border-surface-border rounded px-2 py-1.5 text-xs text-slate-300"
              title="Instrument category"
            >
              <option value="all">All</option>
              {tagCategories.map(category => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
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

          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-300 transition-colors"
          >
            <ChevronDown size={12} className={`transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
            <span>Advanced filters</span>
          </button>

          {showAdvanced && (
            <div className="p-2.5 bg-surface-base border border-surface-border rounded-lg space-y-3 overflow-x-hidden">
              <SourcesAudioFilter
                filterState={audioFilter}
                onChange={setAudioFilter}
                availableKeys={[...new Set(samples.map(s => s.keyEstimate).filter(Boolean) as string[])]}
                availableEnvelopeTypes={[...new Set(samples.map(s => s.envelopeType).filter(Boolean) as string[])]}
                availableInstruments={[...new Set(samples.map(s => s.instrumentType || s.instrumentPrimary).filter(Boolean) as string[])]}
                availableGenres={[...new Set(samples.map(s => s.genrePrimary).filter(Boolean) as string[])]}
              />

              <div className="h-px bg-surface-border" />

              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span className="whitespace-nowrap">Duration</span>
                <input
                  type="number"
                  value={minDuration.toFixed(1)}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value) || 0
                    setMinDuration(Math.max(0, Math.min(val, maxDuration)))
                  }}
                  className="w-14 px-1.5 py-0.5 text-xs bg-surface-raised border border-surface-border rounded text-white focus:outline-none focus:border-accent-primary no-spinner"
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
                  className="w-14 px-1.5 py-0.5 text-xs bg-surface-raised border border-surface-border rounded text-white focus:outline-none focus:border-accent-primary no-spinner"
                  step="0.1"
                />
                <span className="text-slate-500">sec</span>
              </div>
            </div>
          )}
        </div>

        <div>
          {isLoading && (
            <div className="px-3 py-3 text-xs text-slate-500">Loading samples...</div>
          )}

          {!isLoading && samples.length === 0 && (
            <div className="px-3 py-3 text-xs text-slate-500">No samples</div>
          )}

          {!isLoading && samples.map(sample => {
            const isPreviewing = previewingSliceId === sample.id

            return (
              <div
                key={sample.id}
                draggable
                onDragStart={handleDragStart(sample)}
                className="px-3 py-2 border-b border-surface-border/50 hover:bg-surface-base/70 transition-colors cursor-grab active:cursor-grabbing"
              >
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      previewSample(sample)
                    }}
                    className={`w-7 h-7 rounded-md border flex items-center justify-center flex-shrink-0 transition-all ${
                      isPreviewing
                        ? 'bg-accent-primary/20 border-accent-primary/40 text-accent-primary'
                        : 'bg-surface-overlay border-surface-border text-slate-400 hover:text-white hover:border-slate-500'
                    }`}
                    title={isPreviewing ? 'Stop preview' : 'Preview sample'}
                  >
                    {isPreviewing ? <Square size={10} /> : <Play size={11} className="ml-0.5" />}
                  </button>

                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white truncate">{sample.name}</div>
                    <div className="text-[10px] text-slate-500 truncate">{sample.track.artist || sample.track.title}</div>
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setPadPickerSample(sample)
                    }}
                    className="p-1.5 rounded text-slate-400 hover:text-accent-primary hover:bg-accent-primary/20 transition-colors"
                    title="Send to Drum Rack"
                  >
                    <Disc3 size={14} />
                  </button>
                </div>

                <div className="mt-1.5 flex items-center gap-2 text-[10px] text-slate-500">
                  <span>{sample.bpm ? `${Math.round(sample.bpm)} BPM` : '-'}</span>
                  <span>{sample.keyEstimate || '-'}</span>
                  <span>{formatDuration(sample.startTime, sample.endTime)}</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {padPickerSample && (
        <DrumRackPadPicker
          sample={padPickerSample}
          onClose={() => setPadPickerSample(null)}
        />
      )}
    </div>
  )
}
