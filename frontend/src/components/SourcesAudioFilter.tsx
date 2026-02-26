import { ArrowUpDown, ArrowUp, ArrowDown, ChevronDown, ChevronRight } from 'lucide-react'
import { useState, useMemo } from 'react'
import { getRelatedKeys, getRelatedNotes } from '../utils/musicTheory'

export interface AudioFilterState {
  sortBy:
    | 'artist'
    | 'album'
    | 'year'
    | 'albumArtist'
    | 'genre'
    | 'composer'
    | 'trackNumber'
    | 'discNumber'
    | 'tagBpm'
    | 'musicalKey'
    | 'isrc'
    | 'bpm'
    | 'key'
    | 'note'
    | 'name'
    | 'duration'
    | 'createdAt'
    | 'similarity'
    | null
  sortOrder: 'asc' | 'desc'
  minBpm: number
  maxBpm: number
  dateAddedFrom: string
  dateAddedTo: string
  dateCreatedFrom: string
  dateCreatedTo: string
  dateUpdatedFrom: string
  dateUpdatedTo: string
  // Pitch filter mode
  pitchFilterMode: 'fundamental' | 'scale'
  // Fundamental frequency filter (note names)
  selectedNotes: string[]
  relatedNotesLevels: number[]
  // Scale filter (key estimates)
  selectedKeys: string[]
  selectedEnvelopeTypes: string[]
  // Perceptual features (0-1 range)
  minBrightness: number
  maxBrightness: number
  minNoisiness?: number
  maxNoisiness?: number
  minAttack?: number
  maxAttack?: number
  minDynamics?: number
  maxDynamics?: number
  minSaturation?: number
  maxSaturation?: number
  minSurface?: number
  maxSurface?: number
  minRhythmic?: number
  maxRhythmic?: number
  minDensity?: number
  maxDensity?: number
  minAmbience?: number
  maxAmbience?: number
  minStereoWidth?: number
  maxStereoWidth?: number
  stereoChannelMode?: 'all' | 'mono' | 'stereo'
  minDepth?: number
  maxDepth?: number
  minWarmth: number
  maxWarmth: number
  minHardness: number
  maxHardness: number
  // ML classifications (when available)
  selectedInstruments: string[]
  selectedGenres: string[]
  // Related keys
  relatedKeysLevels: number[]
  // Scale degree grouping
  groupByScaleDegree: boolean
}

interface SourcesAudioFilterProps {
  filterState: AudioFilterState
  onChange: (state: AudioFilterState) => void
  availableKeys: string[]
  availableEnvelopeTypes?: string[]
  availableInstruments?: string[]
  availableGenres?: string[]
  showSortControls?: boolean
  mode?: 'all' | 'musical' | 'metadata' | 'perceptual'
  showBpmControl?: boolean
  showPitchControl?: boolean
  showEnvelopeControl?: boolean
  showDatesControl?: boolean
  perceptualFocus?: 'all' | 'brightness' | 'warmth' | 'hardness'
  perceptualExpandable?: boolean
}

// Chromatic order with color coding (based on circle of fifths hue)
const KEY_DATA = [
  { note: 'C', hue: 0 },      // Red
  { note: 'C#', hue: 30 },    // Orange
  { note: 'D', hue: 60 },     // Yellow
  { note: 'D#', hue: 90 },    // Yellow-green
  { note: 'E', hue: 120 },    // Green
  { note: 'F', hue: 150 },    // Cyan-green
  { note: 'F#', hue: 180 },   // Cyan
  { note: 'G', hue: 210 },    // Blue-cyan
  { note: 'G#', hue: 240 },   // Blue
  { note: 'A', hue: 270 },    // Purple
  { note: 'A#', hue: 300 },   // Magenta
  { note: 'B', hue: 330 },    // Pink-red
]

type DateFilterField = 'added' | 'created' | 'updated'
type DatePreset = 'today' | 'last7' | 'last30' | 'thisMonth' | 'lastMonth'

const DATE_PRESETS: Array<{ key: DatePreset; label: string }> = [
  { key: 'today', label: 'Today' },
  { key: 'last7', label: 'Last 7 days' },
  { key: 'last30', label: 'Last 30 days' },
  { key: 'thisMonth', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
]

const toInputDate = (date: Date): string => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const getPresetRange = (preset: DatePreset): { from: string; to: string } => {
  const today = new Date()

  switch (preset) {
    case 'today': {
      const value = toInputDate(today)
      return { from: value, to: value }
    }
    case 'last7': {
      const from = new Date(today)
      from.setDate(from.getDate() - 6)
      return { from: toInputDate(from), to: toInputDate(today) }
    }
    case 'last30': {
      const from = new Date(today)
      from.setDate(from.getDate() - 29)
      return { from: toInputDate(from), to: toInputDate(today) }
    }
    case 'thisMonth': {
      const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
      return { from: toInputDate(startOfMonth), to: toInputDate(today) }
    }
    case 'lastMonth': {
      const startOfLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1)
      const endOfLastMonth = new Date(today.getFullYear(), today.getMonth(), 0)
      return { from: toInputDate(startOfLastMonth), to: toInputDate(endOfLastMonth) }
    }
    default:
      return { from: '', to: '' }
  }
}


export function SourcesAudioFilter({
  filterState,
  onChange,
  availableKeys: _availableKeys,
  availableEnvelopeTypes = [],
  availableInstruments: _availableInstruments = [],
  availableGenres: _availableGenres = [],
  showSortControls = true,
  mode = 'all',
  showBpmControl,
  showPitchControl,
  showEnvelopeControl,
  showDatesControl,
  perceptualFocus = 'all',
  perceptualExpandable = true,
}: SourcesAudioFilterProps) {
  const [selectedDateField, setSelectedDateField] = useState<DateFilterField>('added')
  const [showPerceptual, setShowPerceptual] = useState(false)
  const [showRelatedKeys, setShowRelatedKeys] = useState(false)
  const [showRelatedNotes, setShowRelatedNotes] = useState(false)
  const showMusicalSection = mode === 'all' || mode === 'musical'
  const showMetadataSection = mode === 'all' || mode === 'metadata'
  const showPerceptualSection = mode === 'all' || mode === 'perceptual'
  const showBpmSection = showBpmControl ?? showMusicalSection
  const showPitchSection = showPitchControl ?? showMusicalSection
  const showEnvelopeSection = showEnvelopeControl ?? showMusicalSection
  const showDatesSection = showDatesControl ?? showMetadataSection
  const showPerceptualContent = !perceptualExpandable || showPerceptual
  const showBrightness = perceptualFocus === 'all' || perceptualFocus === 'brightness'
  const showWarmth = perceptualFocus === 'all' || perceptualFocus === 'warmth'
  const showHardness = perceptualFocus === 'all' || perceptualFocus === 'hardness'

  const relatedKeyGroups = useMemo(
    () => getRelatedKeys(filterState.selectedKeys),
    [filterState.selectedKeys]
  )

  const relatedNoteGroups = useMemo(
    () => getRelatedNotes(filterState.selectedNotes || []),
    [filterState.selectedNotes]
  )

  const handleRelatedLevelToggle = (level: number) => {
    const current = filterState.relatedKeysLevels || []
    const newLevels = current.includes(level)
      ? current.filter(l => l !== level)
      : [...current, level]
    onChange({ ...filterState, relatedKeysLevels: newLevels })
  }

  const handleNoteToggle = (note: string) => {
    const current = filterState.selectedNotes || []
    const newNotes = current.includes(note)
      ? current.filter(n => n !== note)
      : [...current, note]
    onChange({ ...filterState, selectedNotes: newNotes })
  }

  const handleRelatedNoteLevelToggle = (level: number) => {
    const current = filterState.relatedNotesLevels || []
    const newLevels = current.includes(level)
      ? current.filter(l => l !== level)
      : [...current, level]
    onChange({ ...filterState, relatedNotesLevels: newLevels })
  }

  const handlePitchModeChange = (mode: 'fundamental' | 'scale') => {
    onChange({ ...filterState, pitchFilterMode: mode })
  }

  const handleScaleDegreeToggle = () => {
    onChange({ ...filterState, groupByScaleDegree: !filterState.groupByScaleDegree })
  }
  const handleSortChange = (field: AudioFilterState['sortBy']) => {
    if (filterState.sortBy === field) {
      // Toggle order or clear
      if (filterState.sortOrder === 'asc') {
        onChange({ ...filterState, sortOrder: 'desc' })
      } else {
        onChange({ ...filterState, sortBy: null, sortOrder: 'asc' })
      }
    } else {
      onChange({ ...filterState, sortBy: field, sortOrder: 'asc' })
    }
  }

  const handleBpmRangeChange = (min: number, max: number) => {
    onChange({ ...filterState, minBpm: min, maxBpm: max })
  }

  const handleKeyToggle = (key: string) => {
    const newKeys = filterState.selectedKeys.includes(key)
      ? filterState.selectedKeys.filter(k => k !== key)
      : [...filterState.selectedKeys, key]
    onChange({ ...filterState, selectedKeys: newKeys })
  }

  const clearKeyFilter = () => {
    onChange({ ...filterState, selectedKeys: [] })
  }

  const handleEnvelopeTypeToggle = (type: string) => {
    const newTypes = filterState.selectedEnvelopeTypes.includes(type)
      ? filterState.selectedEnvelopeTypes.filter(t => t !== type)
      : [...filterState.selectedEnvelopeTypes, type]
    onChange({ ...filterState, selectedEnvelopeTypes: newTypes })
  }

  const handlePerceptualRangeChange = (
    feature: 'brightness' | 'warmth' | 'hardness',
    minOrMax: 'min' | 'max',
    value: number
  ) => {
    const clamped = Math.max(0, Math.min(1, value))
    if (feature === 'brightness') {
      onChange({
        ...filterState,
        [minOrMax === 'min' ? 'minBrightness' : 'maxBrightness']: clamped
      })
    } else if (feature === 'warmth') {
      onChange({
        ...filterState,
        [minOrMax === 'min' ? 'minWarmth' : 'maxWarmth']: clamped
      })
    } else if (feature === 'hardness') {
      onChange({
        ...filterState,
        [minOrMax === 'min' ? 'minHardness' : 'maxHardness']: clamped
      })
    }
  }

  const getSortIcon = (field: AudioFilterState['sortBy']) => {
    if (filterState.sortBy !== field) {
      return <ArrowUpDown size={12} className="opacity-50" />
    }
    return filterState.sortOrder === 'asc' ? (
      <ArrowUp size={12} />
    ) : (
      <ArrowDown size={12} />
    )
  }

  const getSortButtonClass = (field: AudioFilterState['sortBy']) => {
    const isActive = filterState.sortBy === field
    return `flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors ${
      isActive
        ? 'bg-accent-primary text-white'
        : 'bg-surface-base text-slate-400 hover:text-white hover:bg-surface-raised'
    }`
  }

  const hasDateFilter = Boolean(
    filterState.dateAddedFrom ||
      filterState.dateAddedTo ||
      filterState.dateCreatedFrom ||
      filterState.dateCreatedTo ||
      filterState.dateUpdatedFrom ||
      filterState.dateUpdatedTo
  )

  const getDateValues = (field: DateFilterField): { from: string; to: string } => {
    if (field === 'added') {
      return { from: filterState.dateAddedFrom, to: filterState.dateAddedTo }
    }
    if (field === 'created') {
      return { from: filterState.dateCreatedFrom, to: filterState.dateCreatedTo }
    }
    return { from: filterState.dateUpdatedFrom, to: filterState.dateUpdatedTo }
  }

  const setDateValues = (field: DateFilterField, from: string, to: string) => {
    if (field === 'added') {
      onChange({
        ...filterState,
        dateAddedFrom: from,
        dateAddedTo: to,
      })
      return
    }
    if (field === 'created') {
      onChange({
        ...filterState,
        dateCreatedFrom: from,
        dateCreatedTo: to,
      })
      return
    }
    onChange({
      ...filterState,
      dateUpdatedFrom: from,
      dateUpdatedTo: to,
    })
  }

  const clearDateValues = (field: DateFilterField) => {
    setDateValues(field, '', '')
  }

  const clearAllDateFilters = () => {
    onChange({
      ...filterState,
      dateAddedFrom: '',
      dateAddedTo: '',
      dateCreatedFrom: '',
      dateCreatedTo: '',
      dateUpdatedFrom: '',
      dateUpdatedTo: '',
    })
  }

  const applyDatePreset = (field: DateFilterField, preset: DatePreset) => {
    const { from, to } = getPresetRange(preset)
    setDateValues(field, from, to)
  }

  const isPresetActive = (field: DateFilterField, preset: DatePreset): boolean => {
    const { from, to } = getDateValues(field)
    const presetRange = getPresetRange(preset)
    return from === presetRange.from && to === presetRange.to
  }

  const handleDateChange = (
    field: DateFilterField,
    bound: 'from' | 'to',
    value: string
  ) => {
    const current = getDateValues(field)
    let nextFrom = current.from
    let nextTo = current.to

    if (bound === 'from') {
      nextFrom = value
      if (nextFrom && nextTo && nextFrom > nextTo) {
        nextTo = nextFrom
      }
    } else {
      nextTo = value
      if (nextFrom && nextTo && nextTo < nextFrom) {
        nextFrom = nextTo
      }
    }

    setDateValues(field, nextFrom, nextTo)
  }

  const selectedDateValues = getDateValues(selectedDateField)
  const hasSelectedDateFilter = Boolean(selectedDateValues.from || selectedDateValues.to)

  return (
    <div className="flex flex-col gap-2 min-w-0">
      {showSortControls && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-400 whitespace-nowrap">Sort by:</span>
          <div className="flex items-center gap-1 flex-wrap min-w-0">
            <button
              onClick={() => handleSortChange('name')}
              className={getSortButtonClass('name')}
            >
              Name {getSortIcon('name')}
            </button>
            <button
              onClick={() => handleSortChange('bpm')}
              className={getSortButtonClass('bpm')}
            >
              BPM {getSortIcon('bpm')}
            </button>
            <button
              onClick={() => handleSortChange('key')}
              className={getSortButtonClass('key')}
            >
              Key {getSortIcon('key')}
            </button>
            <button
              onClick={() => handleSortChange('duration')}
              className={getSortButtonClass('duration')}
            >
              Duration {getSortIcon('duration')}
            </button>
            <button
              onClick={() => handleSortChange('createdAt')}
              className={getSortButtonClass('createdAt')}
            >
              Added {getSortIcon('createdAt')}
            </button>
          </div>
        </div>
      )}

      {showBpmSection && (
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-slate-400 whitespace-nowrap">BPM:</span>
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          {/* Number inputs */}
          <input
            type="number"
            value={filterState.minBpm}
            onChange={(e) => {
              const val = parseFloat(e.target.value) || 0
              handleBpmRangeChange(Math.max(0, Math.min(val, filterState.maxBpm)), filterState.maxBpm)
            }}
            className="w-14 px-1.5 py-0.5 text-xs bg-surface-raised border border-surface-border rounded text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary no-spinner"
            min="0"
            max={filterState.maxBpm}
          />

          {/* Dual slider */}
          <div className="flex-1 relative h-6 flex items-center min-w-[80px]">
            {/* Track background */}
            <div className="absolute left-0 right-0 h-0.5 bg-surface-raised rounded-full" />

            {/* Active range */}
            <div
              className="absolute h-0.5 bg-accent-primary rounded-full pointer-events-none"
              style={{
                left: `${(filterState.minBpm / 300) * 100}%`,
                right: `${((300 - filterState.maxBpm) / 300) * 100}%`,
              }}
            />

            {/* Min handle */}
            <input
              type="range"
              min={0}
              max={300}
              step={1}
              value={filterState.minBpm}
              onChange={(e) => {
                const newMin = parseFloat(e.target.value)
                handleBpmRangeChange(Math.min(newMin, filterState.maxBpm), filterState.maxBpm)
              }}
              className="absolute w-full h-6 appearance-none bg-transparent cursor-pointer slider-thumb"
              style={{ zIndex: filterState.minBpm > filterState.maxBpm - 2 ? 5 : 3 }}
            />

            {/* Max handle */}
            <input
              type="range"
              min={0}
              max={300}
              step={1}
              value={filterState.maxBpm}
              onChange={(e) => {
                const newMax = parseFloat(e.target.value)
                handleBpmRangeChange(filterState.minBpm, Math.max(newMax, filterState.minBpm))
              }}
              className="absolute w-full h-6 appearance-none bg-transparent cursor-pointer slider-thumb"
              style={{ zIndex: filterState.maxBpm < filterState.minBpm + 2 ? 5 : 4 }}
            />
          </div>

          <input
            type="number"
            value={filterState.maxBpm}
            onChange={(e) => {
              const val = parseFloat(e.target.value) || 300
              handleBpmRangeChange(filterState.minBpm, Math.max(filterState.minBpm, Math.min(val, 300)))
            }}
            className="w-14 px-1.5 py-0.5 text-xs bg-surface-raised border border-surface-border rounded text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary no-spinner"
            min={filterState.minBpm}
            max="300"
          />

          {(filterState.minBpm > 0 || filterState.maxBpm < 300) && (
            <button
              onClick={() => handleBpmRangeChange(0, 300)}
              className="text-xs text-slate-400 hover:text-white transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      </div>
      )}

      {showPitchSection && (
      <div className="flex items-start gap-3">
        <div className="flex items-center gap-1.5 pt-1 flex-shrink-0">
          <select
            value={filterState.pitchFilterMode || 'fundamental'}
            onChange={(e) => handlePitchModeChange(e.target.value as 'fundamental' | 'scale')}
            className="text-xs text-slate-300 bg-surface-base border border-surface-border rounded px-1 py-0.5 cursor-pointer hover:text-white hover:border-slate-500 transition-colors focus:outline-none focus:border-accent-primary appearance-none"
            style={{ backgroundImage: 'none', colorScheme: 'dark' }}
          >
            <option value="fundamental" className="bg-surface-base text-slate-200">Note</option>
            <option value="scale" className="bg-surface-base text-slate-200">Scale</option>
          </select>
          <span className="text-[9px] text-slate-500">:</span>
        </div>
        <div className="flex-1 min-w-0">
          {/* Fundamental frequency mode */}
          {(filterState.pitchFilterMode || 'fundamental') === 'fundamental' && (
            <>
              <div className="flex flex-wrap gap-1.5">
                {KEY_DATA.map(({ note, hue }) => {
                  const isSelected = (filterState.selectedNotes || []).includes(note)
                  return (
                    <button
                      key={note}
                      onClick={() => handleNoteToggle(note)}
                      className="relative px-2.5 py-1 text-xs font-medium rounded border border-surface-border transition-all group"
                      style={{
                        backgroundColor: isSelected ? `hsl(${hue}, 60%, 45%)` : 'transparent',
                        color: isSelected ? '#fff' : '#94a3b8',
                        borderColor: isSelected ? `hsl(${hue}, 60%, 45%)` : undefined,
                      }}
                      title={`Filter by fundamental: ${note}`}
                    >
                      {note}
                      {!isSelected && (
                        <div
                          className="absolute inset-0 rounded opacity-0 group-hover:opacity-20 transition-opacity"
                          style={{ backgroundColor: `hsl(${hue}, 60%, 45%)` }}
                        />
                      )}
                    </button>
                  )
                })}
              </div>
              {(filterState.selectedNotes || []).length > 0 && (
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <button
                    onClick={() => onChange({ ...filterState, selectedNotes: [] })}
                    className="text-xs text-slate-400 hover:text-white transition-colors"
                  >
                    Clear ({(filterState.selectedNotes || []).length} selected)
                  </button>
                </div>
              )}

              {/* Related Notes (spiciness by interval) */}
              {(filterState.selectedNotes || []).length > 0 && relatedNoteGroups.length > 0 && (
                <div className="mt-2">
                  <button
                    onClick={() => setShowRelatedNotes(!showRelatedNotes)}
                    className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors"
                  >
                    {showRelatedNotes ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    <span>Related Notes</span>
                  </button>
                  {showRelatedNotes && (
                    <div className="mt-2 space-y-2 pl-4">
                      {relatedNoteGroups.map(group => {
                        const isActive = (filterState.relatedNotesLevels || []).includes(group.level)
                        return (
                          <div key={group.level} className="flex items-start gap-2">
                            <button
                              onClick={() => handleRelatedNoteLevelToggle(group.level)}
                              className={`flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded border transition-colors flex-shrink-0 ${
                                isActive
                                  ? 'border-current bg-current/10 text-white'
                                  : 'border-surface-border text-slate-500 hover:text-slate-300'
                              }`}
                              style={{ borderColor: isActive ? group.color : undefined, color: isActive ? group.color : undefined }}
                            >
                              <span>{group.emoji}</span>
                              <span>{group.label}</span>
                            </button>
                            <div className="flex flex-wrap gap-0.5">
                              {group.keys.map(n => {
                                const keyData = KEY_DATA.find(kd => kd.note === n)
                                const hue = keyData?.hue ?? 0
                                return (
                                  <button
                                    key={n}
                                    onClick={() => handleNoteToggle(n)}
                                    className="px-1.5 py-0 text-[9px] rounded transition-colors"
                                    style={{
                                      backgroundColor: `hsla(${hue}, 60%, 45%, 0.3)`,
                                      color: `hsl(${hue}, 50%, 70%)`,
                                    }}
                                    title={n}
                                  >
                                    {n}
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* Scale mode (existing key filter) */}
          {filterState.pitchFilterMode === 'scale' && (
            <>
              <div className="flex flex-wrap gap-1.5">
                {KEY_DATA.map(({ note, hue }) => {
                  const majorKey = `${note} major`
                  const minorKey = `${note} minor`
                  const isMajorSelected = filterState.selectedKeys.includes(majorKey)
                  const isMinorSelected = filterState.selectedKeys.includes(minorKey)

                  return (
                    <div key={note} className="flex items-center rounded overflow-hidden border border-surface-border">
                      <button
                        onClick={() => handleKeyToggle(majorKey)}
                        className="relative px-2 py-1 text-xs font-medium transition-all group"
                        style={{
                          backgroundColor: isMajorSelected ? `hsl(${hue}, 60%, 45%)` : 'transparent',
                          color: isMajorSelected ? '#fff' : '#94a3b8',
                          borderRight: '1px solid rgb(51, 65, 85)'
                        }}
                        title={majorKey}
                      >
                        <div className="flex items-center gap-0.5">
                          <span>{note}</span>
                          <span className="text-[9px] opacity-70">M</span>
                        </div>
                        {!isMajorSelected && (
                          <div
                            className="absolute inset-0 opacity-0 group-hover:opacity-20 transition-opacity"
                            style={{ backgroundColor: `hsl(${hue}, 60%, 45%)` }}
                          />
                        )}
                      </button>
                      <button
                        onClick={() => handleKeyToggle(minorKey)}
                        className="relative px-2 py-1 text-xs font-medium transition-all group"
                        style={{
                          backgroundColor: isMinorSelected ? `hsl(${hue}, 40%, 35%)` : 'transparent',
                          color: isMinorSelected ? '#fff' : '#94a3b8',
                        }}
                        title={minorKey}
                      >
                        <div className="flex items-center gap-0.5">
                          <span className="text-[9px] opacity-70">m</span>
                        </div>
                        {!isMinorSelected && (
                          <div
                            className="absolute inset-0 opacity-0 group-hover:opacity-20 transition-opacity"
                            style={{ backgroundColor: `hsl(${hue}, 40%, 35%)` }}
                          />
                        )}
                      </button>
                    </div>
                  )
                })}
              </div>
              {filterState.selectedKeys.length > 0 && (
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <button
                    onClick={clearKeyFilter}
                    className="text-xs text-slate-400 hover:text-white transition-colors"
                  >
                    Clear ({filterState.selectedKeys.length} selected)
                  </button>
                  {filterState.selectedKeys.length === 1 && (
                    <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={filterState.groupByScaleDegree}
                        onChange={handleScaleDegreeToggle}
                        className="accent-accent-primary"
                      />
                      Group by degree
                    </label>
                  )}
                </div>
              )}

              {/* Related Keys */}
              {filterState.selectedKeys.length > 0 && relatedKeyGroups.length > 0 && (
                <div className="mt-2">
                  <button
                    onClick={() => setShowRelatedKeys(!showRelatedKeys)}
                    className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors"
                  >
                    {showRelatedKeys ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    <span>Related Keys</span>
                  </button>
                  {showRelatedKeys && (
                    <div className="mt-2 space-y-2 pl-4">
                      {relatedKeyGroups.map(group => {
                        const isActive = (filterState.relatedKeysLevels || []).includes(group.level)
                        return (
                          <div key={group.level} className="flex items-start gap-2">
                            <button
                              onClick={() => handleRelatedLevelToggle(group.level)}
                              className={`flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded border transition-colors flex-shrink-0 ${
                                isActive
                                  ? 'border-current bg-current/10 text-white'
                                  : 'border-surface-border text-slate-500 hover:text-slate-300'
                              }`}
                              style={{ borderColor: isActive ? group.color : undefined, color: isActive ? group.color : undefined }}
                            >
                              <span>{group.emoji}</span>
                              <span>{group.label}</span>
                            </button>
                            <div className="flex flex-wrap gap-0.5">
                              {group.keys.map(k => {
                                const note = k.split(' ')[0]
                                const keyData = KEY_DATA.find(kd => kd.note === note)
                                const hue = keyData?.hue ?? 0
                                const isMajor = k.includes('major')
                                return (
                                  <button
                                    key={k}
                                    onClick={() => handleKeyToggle(k)}
                                    className="px-1 py-0 text-[9px] rounded transition-colors"
                                    style={{
                                      backgroundColor: `hsla(${hue}, ${isMajor ? 60 : 40}%, ${isMajor ? 45 : 35}%, 0.3)`,
                                      color: `hsl(${hue}, 50%, 70%)`,
                                    }}
                                    title={k}
                                  >
                                    {note}{isMajor ? '' : 'm'}
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
      )}

      {/* Envelope Type filter */}
      {showEnvelopeSection && availableEnvelopeTypes.length > 0 && (
        <div className="flex items-start gap-3">
          <span className="text-xs text-slate-400 whitespace-nowrap pt-1">Envelope:</span>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap gap-1">
              {availableEnvelopeTypes.map((type) => (
                <button
                  key={type}
                  onClick={() => handleEnvelopeTypeToggle(type)}
                  className={`px-2 py-0.5 text-xs rounded capitalize transition-colors ${
                    filterState.selectedEnvelopeTypes.includes(type)
                      ? 'bg-accent-primary text-white'
                      : 'bg-surface-base text-slate-400 hover:text-white hover:bg-surface-raised'
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
            {filterState.selectedEnvelopeTypes.length > 0 && (
              <button
                onClick={() => onChange({ ...filterState, selectedEnvelopeTypes: [] })}
                className="text-xs text-slate-400 hover:text-white transition-colors mt-1"
              >
                Clear ({filterState.selectedEnvelopeTypes.length} selected)
              </button>
            )}
          </div>
        </div>
      )}

      {/* Date filters */}
      {showDatesSection && (
      <div className="border-t border-surface-border pt-2">
        <div className="flex items-center gap-2">
          <select
            value={selectedDateField}
            onChange={(e) => setSelectedDateField(e.target.value as DateFilterField)}
            className="text-xs text-slate-300 bg-surface-base border border-surface-border rounded px-2 py-0.5 cursor-pointer hover:text-white hover:border-slate-500 transition-colors focus:outline-none focus:border-accent-primary appearance-none"
            style={{ backgroundImage: 'none', colorScheme: 'dark' }}
          >
            <option value="added" className="bg-surface-base text-slate-200">Date added</option>
            <option value="created" className="bg-surface-base text-slate-200">File created</option>
            <option value="updated" className="bg-surface-base text-slate-200">Date updated</option>
          </select>
          {hasSelectedDateFilter && (
            <button
              onClick={() => clearDateValues(selectedDateField)}
              className="text-xs text-slate-400 hover:text-white transition-colors whitespace-nowrap"
            >
              Clear
            </button>
          )}
          {hasDateFilter && (
            <button
              onClick={clearAllDateFilters}
              className="ml-auto text-xs text-slate-400 hover:text-white transition-colors whitespace-nowrap"
            >
              Clear all
            </button>
          )}
        </div>

        <div className="mt-1.5 grid grid-cols-2 gap-1.5 items-end">
          <label className="flex flex-col gap-0.5 text-[10px] text-slate-400">
            <span>From</span>
            <input
              type="date"
              value={selectedDateValues.from}
              onChange={(e) => handleDateChange(selectedDateField, 'from', e.target.value)}
              max={selectedDateValues.to || undefined}
              className="px-2 py-0.5 text-xs bg-surface-base border border-surface-border rounded text-white focus:outline-none focus:border-accent-primary"
            />
          </label>
          <label className="flex flex-col gap-0.5 text-[10px] text-slate-400">
            <span>To</span>
            <input
              type="date"
              value={selectedDateValues.to}
              onChange={(e) => handleDateChange(selectedDateField, 'to', e.target.value)}
              min={selectedDateValues.from || undefined}
              className="px-2 py-0.5 text-xs bg-surface-base border border-surface-border rounded text-white focus:outline-none focus:border-accent-primary"
            />
          </label>
        </div>

        <div className="mt-1.5 flex flex-wrap gap-1">
          {DATE_PRESETS.map((preset) => (
            <button
              key={preset.key}
              onClick={() => applyDatePreset(selectedDateField, preset.key)}
              className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
                isPresetActive(selectedDateField, preset.key)
                  ? 'bg-accent-primary text-white'
                  : 'bg-surface-base text-slate-400 hover:text-white hover:bg-surface-overlay'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>
      )}

      {/* Perceptual features */}
      {showPerceptualSection && (
      <div className={perceptualExpandable ? 'border-t border-surface-border pt-3' : ''}>
        {perceptualExpandable && (
          <button
            onClick={() => setShowPerceptual(!showPerceptual)}
            className="flex items-center gap-2 text-xs text-slate-400 hover:text-white transition-colors w-full"
          >
            {showPerceptual ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span className="font-medium">Perceptual Features</span>
          </button>
        )}

        {showPerceptualContent && (
          <div className={perceptualExpandable ? 'mt-3 space-y-3 pl-3' : 'space-y-3'}>
            {/* Brightness */}
            {showBrightness && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-slate-400">Brightness:</span>
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs text-slate-500 w-8 text-right">{filterState.minBrightness.toFixed(2)}</span>

                {/* Dual slider */}
                <div className="flex-1 relative h-6 flex items-center min-w-[80px]">
                  {/* Track background */}
                  <div className="absolute left-0 right-0 h-0.5 bg-surface-raised rounded-full" />

                  {/* Active range */}
                  <div
                    className="absolute h-0.5 bg-accent-primary rounded-full pointer-events-none"
                    style={{
                      left: `${filterState.minBrightness * 100}%`,
                      right: `${(1 - filterState.maxBrightness) * 100}%`,
                    }}
                  />

                  {/* Min handle */}
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={filterState.minBrightness}
                    onChange={(e) => {
                      const newMin = parseFloat(e.target.value)
                      handlePerceptualRangeChange('brightness', 'min', Math.min(newMin, filterState.maxBrightness))
                    }}
                    className="absolute w-full h-6 appearance-none bg-transparent cursor-pointer slider-thumb"
                    style={{ zIndex: filterState.minBrightness > filterState.maxBrightness - 0.02 ? 5 : 3 }}
                  />

                  {/* Max handle */}
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={filterState.maxBrightness}
                    onChange={(e) => {
                      const newMax = parseFloat(e.target.value)
                      handlePerceptualRangeChange('brightness', 'max', Math.max(newMax, filterState.minBrightness))
                    }}
                    className="absolute w-full h-6 appearance-none bg-transparent cursor-pointer slider-thumb"
                    style={{ zIndex: filterState.maxBrightness < filterState.minBrightness + 0.02 ? 5 : 4 }}
                  />
                </div>

                <span className="text-xs text-slate-500 w-8">{filterState.maxBrightness.toFixed(2)}</span>
              </div>
            </div>
            )}

            {/* Warmth */}
            {showWarmth && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-slate-400">Warmth:</span>
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs text-slate-500 w-8 text-right">{filterState.minWarmth.toFixed(2)}</span>

                {/* Dual slider */}
                <div className="flex-1 relative h-6 flex items-center min-w-[80px]">
                  {/* Track background */}
                  <div className="absolute left-0 right-0 h-0.5 bg-surface-raised rounded-full" />

                  {/* Active range */}
                  <div
                    className="absolute h-0.5 bg-accent-primary rounded-full pointer-events-none"
                    style={{
                      left: `${filterState.minWarmth * 100}%`,
                      right: `${(1 - filterState.maxWarmth) * 100}%`,
                    }}
                  />

                  {/* Min handle */}
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={filterState.minWarmth}
                    onChange={(e) => {
                      const newMin = parseFloat(e.target.value)
                      handlePerceptualRangeChange('warmth', 'min', Math.min(newMin, filterState.maxWarmth))
                    }}
                    className="absolute w-full h-6 appearance-none bg-transparent cursor-pointer slider-thumb"
                    style={{ zIndex: filterState.minWarmth > filterState.maxWarmth - 0.02 ? 5 : 3 }}
                  />

                  {/* Max handle */}
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={filterState.maxWarmth}
                    onChange={(e) => {
                      const newMax = parseFloat(e.target.value)
                      handlePerceptualRangeChange('warmth', 'max', Math.max(newMax, filterState.minWarmth))
                    }}
                    className="absolute w-full h-6 appearance-none bg-transparent cursor-pointer slider-thumb"
                    style={{ zIndex: filterState.maxWarmth < filterState.minWarmth + 0.02 ? 5 : 4 }}
                  />
                </div>

                <span className="text-xs text-slate-500 w-8">{filterState.maxWarmth.toFixed(2)}</span>
              </div>
            </div>
            )}

            {/* Hardness */}
            {showHardness && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-slate-400">Hardness:</span>
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs text-slate-500 w-8 text-right">{filterState.minHardness.toFixed(2)}</span>

                {/* Dual slider */}
                <div className="flex-1 relative h-6 flex items-center min-w-[80px]">
                  {/* Track background */}
                  <div className="absolute left-0 right-0 h-0.5 bg-surface-raised rounded-full" />

                  {/* Active range */}
                  <div
                    className="absolute h-0.5 bg-accent-primary rounded-full pointer-events-none"
                    style={{
                      left: `${filterState.minHardness * 100}%`,
                      right: `${(1 - filterState.maxHardness) * 100}%`,
                    }}
                  />

                  {/* Min handle */}
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={filterState.minHardness}
                    onChange={(e) => {
                      const newMin = parseFloat(e.target.value)
                      handlePerceptualRangeChange('hardness', 'min', Math.min(newMin, filterState.maxHardness))
                    }}
                    className="absolute w-full h-6 appearance-none bg-transparent cursor-pointer slider-thumb"
                    style={{ zIndex: filterState.minHardness > filterState.maxHardness - 0.02 ? 5 : 3 }}
                  />

                  {/* Max handle */}
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={filterState.maxHardness}
                    onChange={(e) => {
                      const newMax = parseFloat(e.target.value)
                      handlePerceptualRangeChange('hardness', 'max', Math.max(newMax, filterState.minHardness))
                    }}
                    className="absolute w-full h-6 appearance-none bg-transparent cursor-pointer slider-thumb"
                    style={{ zIndex: filterState.maxHardness < filterState.minHardness + 0.02 ? 5 : 4 }}
                  />
                </div>

                <span className="text-xs text-slate-500 w-8">{filterState.maxHardness.toFixed(2)}</span>
              </div>
            </div>
            )}

            {/* Reset button */}
            {((showBrightness && (filterState.minBrightness > 0 || filterState.maxBrightness < 1)) ||
              (showWarmth && (filterState.minWarmth > 0 || filterState.maxWarmth < 1)) ||
              (showHardness && (filterState.minHardness > 0 || filterState.maxHardness < 1))) && (
              <button
                onClick={() => onChange({
                  ...filterState,
                  minBrightness: showBrightness ? 0 : filterState.minBrightness,
                  maxBrightness: showBrightness ? 1 : filterState.maxBrightness,
                  minWarmth: showWarmth ? 0 : filterState.minWarmth,
                  maxWarmth: showWarmth ? 1 : filterState.maxWarmth,
                  minHardness: showHardness ? 0 : filterState.minHardness,
                  maxHardness: showHardness ? 1 : filterState.maxHardness,
                })}
                className="text-xs text-slate-400 hover:text-white transition-colors"
              >
                Reset {perceptualFocus === 'all' ? 'perceptual filters' : `${perceptualFocus} filter`}
              </button>
            )}
          </div>
        )}
      </div>
      )}
    </div>
  )
}
