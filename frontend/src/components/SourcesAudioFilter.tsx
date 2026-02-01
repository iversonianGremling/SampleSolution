import { ArrowUpDown, ArrowUp, ArrowDown, ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'

export interface AudioFilterState {
  sortBy: 'bpm' | 'key' | 'name' | 'duration' | 'createdAt' | null
  sortOrder: 'asc' | 'desc'
  minBpm: number
  maxBpm: number
  selectedKeys: string[]
  selectedEnvelopeTypes: string[]
  // Perceptual features (0-1 range)
  minBrightness: number
  maxBrightness: number
  minWarmth: number
  maxWarmth: number
  minHardness: number
  maxHardness: number
  // ML classifications (when available)
  selectedInstruments: string[]
  selectedGenres: string[]
}

interface SourcesAudioFilterProps {
  filterState: AudioFilterState
  onChange: (state: AudioFilterState) => void
  availableKeys: string[]
  availableEnvelopeTypes?: string[]
  availableInstruments?: string[]
  availableGenres?: string[]
}

const COMMON_KEYS = [
  'C major', 'C minor', 'C# major', 'C# minor',
  'D major', 'D minor', 'D# major', 'D# minor',
  'E major', 'E minor',
  'F major', 'F minor', 'F# major', 'F# minor',
  'G major', 'G minor', 'G# major', 'G# minor',
  'A major', 'A minor', 'A# major', 'A# minor',
  'B major', 'B minor'
]

export function SourcesAudioFilter({
  filterState,
  onChange,
  availableKeys,
  availableEnvelopeTypes = [],
  availableInstruments = [],
  availableGenres = []
}: SourcesAudioFilterProps) {
  const [showPerceptual, setShowPerceptual] = useState(false)
  const [showClassification, setShowClassification] = useState(false)
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

  const handleInstrumentToggle = (instrument: string) => {
    const newInstruments = filterState.selectedInstruments.includes(instrument)
      ? filterState.selectedInstruments.filter(i => i !== instrument)
      : [...filterState.selectedInstruments, instrument]
    onChange({ ...filterState, selectedInstruments: newInstruments })
  }

  const handleGenreToggle = (genre: string) => {
    const newGenres = filterState.selectedGenres.includes(genre)
      ? filterState.selectedGenres.filter(g => g !== genre)
      : [...filterState.selectedGenres, genre]
    onChange({ ...filterState, selectedGenres: newGenres })
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

  // Display keys that are actually in the data
  const displayKeys = availableKeys.length > 0 ? availableKeys : COMMON_KEYS

  return (
    <div className="flex flex-col gap-3">
      {/* Sort controls */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-400 whitespace-nowrap">Sort by:</span>
        <div className="flex items-center gap-1 flex-wrap">
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
            Date {getSortIcon('createdAt')}
          </button>
        </div>
      </div>

      {/* BPM range filter */}
      <div className="flex items-center gap-3">
        <span className="text-xs text-slate-400 whitespace-nowrap">BPM:</span>
        <div className="flex items-center gap-2 flex-1 max-w-md">
          <input
            type="number"
            value={filterState.minBpm}
            onChange={(e) => {
              const val = parseFloat(e.target.value) || 0
              handleBpmRangeChange(Math.max(0, val), filterState.maxBpm)
            }}
            placeholder="Min"
            className="w-20 px-2 py-1 text-xs bg-surface-base border border-surface-border rounded text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary"
            min="0"
            max={filterState.maxBpm}
          />
          <span className="text-xs text-slate-500">to</span>
          <input
            type="number"
            value={filterState.maxBpm}
            onChange={(e) => {
              const val = parseFloat(e.target.value) || 300
              handleBpmRangeChange(filterState.minBpm, Math.max(filterState.minBpm, val))
            }}
            placeholder="Max"
            className="w-20 px-2 py-1 text-xs bg-surface-base border border-surface-border rounded text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary"
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

      {/* Key filter */}
      <div className="flex items-start gap-3">
        <span className="text-xs text-slate-400 whitespace-nowrap pt-1">Key:</span>
        <div className="flex-1">
          <div className="flex flex-wrap gap-1">
            {displayKeys.slice(0, 12).map((key) => (
              <button
                key={key}
                onClick={() => handleKeyToggle(key)}
                className={`px-2 py-0.5 text-xs rounded transition-colors ${
                  filterState.selectedKeys.includes(key)
                    ? 'bg-accent-primary text-white'
                    : 'bg-surface-base text-slate-400 hover:text-white hover:bg-surface-raised'
                }`}
              >
                {key}
              </button>
            ))}
          </div>
          {displayKeys.length > 12 && (
            <details className="mt-1">
              <summary className="text-xs text-slate-400 hover:text-white cursor-pointer">
                Show more ({displayKeys.length - 12} more)
              </summary>
              <div className="flex flex-wrap gap-1 mt-1">
                {displayKeys.slice(12).map((key) => (
                  <button
                    key={key}
                    onClick={() => handleKeyToggle(key)}
                    className={`px-2 py-0.5 text-xs rounded transition-colors ${
                      filterState.selectedKeys.includes(key)
                        ? 'bg-accent-primary text-white'
                        : 'bg-surface-base text-slate-400 hover:text-white hover:bg-surface-raised'
                    }`}
                  >
                    {key}
                  </button>
                ))}
              </div>
            </details>
          )}
          {filterState.selectedKeys.length > 0 && (
            <button
              onClick={clearKeyFilter}
              className="text-xs text-slate-400 hover:text-white transition-colors mt-1"
            >
              Clear ({filterState.selectedKeys.length} selected)
            </button>
          )}
        </div>
      </div>

      {/* Envelope Type filter */}
      {availableEnvelopeTypes.length > 0 && (
        <div className="flex items-start gap-3">
          <span className="text-xs text-slate-400 whitespace-nowrap pt-1">Envelope:</span>
          <div className="flex-1">
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

      {/* Perceptual features - collapsible */}
      <div className="border-t border-surface-border pt-3">
        <button
          onClick={() => setShowPerceptual(!showPerceptual)}
          className="flex items-center gap-2 text-xs text-slate-400 hover:text-white transition-colors w-full"
        >
          {showPerceptual ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span className="font-medium">Perceptual Features</span>
        </button>

        {showPerceptual && (
          <div className="mt-3 space-y-3 pl-5">
            {/* Brightness */}
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-400 w-20">Brightness:</span>
              <div className="flex-1 flex items-center gap-2">
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={filterState.minBrightness}
                  onChange={(e) => handlePerceptualRangeChange('brightness', 'min', parseFloat(e.target.value))}
                  className="flex-1 h-1 accent-accent-primary"
                />
                <span className="text-xs text-slate-500 w-8">{filterState.minBrightness.toFixed(2)}</span>
                <span className="text-xs text-slate-500">-</span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={filterState.maxBrightness}
                  onChange={(e) => handlePerceptualRangeChange('brightness', 'max', parseFloat(e.target.value))}
                  className="flex-1 h-1 accent-accent-primary"
                />
                <span className="text-xs text-slate-500 w-8">{filterState.maxBrightness.toFixed(2)}</span>
              </div>
            </div>

            {/* Warmth */}
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-400 w-20">Warmth:</span>
              <div className="flex-1 flex items-center gap-2">
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={filterState.minWarmth}
                  onChange={(e) => handlePerceptualRangeChange('warmth', 'min', parseFloat(e.target.value))}
                  className="flex-1 h-1 accent-accent-primary"
                />
                <span className="text-xs text-slate-500 w-8">{filterState.minWarmth.toFixed(2)}</span>
                <span className="text-xs text-slate-500">-</span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={filterState.maxWarmth}
                  onChange={(e) => handlePerceptualRangeChange('warmth', 'max', parseFloat(e.target.value))}
                  className="flex-1 h-1 accent-accent-primary"
                />
                <span className="text-xs text-slate-500 w-8">{filterState.maxWarmth.toFixed(2)}</span>
              </div>
            </div>

            {/* Hardness */}
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-400 w-20">Hardness:</span>
              <div className="flex-1 flex items-center gap-2">
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={filterState.minHardness}
                  onChange={(e) => handlePerceptualRangeChange('hardness', 'min', parseFloat(e.target.value))}
                  className="flex-1 h-1 accent-accent-primary"
                />
                <span className="text-xs text-slate-500 w-8">{filterState.minHardness.toFixed(2)}</span>
                <span className="text-xs text-slate-500">-</span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={filterState.maxHardness}
                  onChange={(e) => handlePerceptualRangeChange('hardness', 'max', parseFloat(e.target.value))}
                  className="flex-1 h-1 accent-accent-primary"
                />
                <span className="text-xs text-slate-500 w-8">{filterState.maxHardness.toFixed(2)}</span>
              </div>
            </div>

            {/* Reset button */}
            {(filterState.minBrightness > 0 || filterState.maxBrightness < 1 ||
              filterState.minWarmth > 0 || filterState.maxWarmth < 1 ||
              filterState.minHardness > 0 || filterState.maxHardness < 1) && (
              <button
                onClick={() => onChange({
                  ...filterState,
                  minBrightness: 0,
                  maxBrightness: 1,
                  minWarmth: 0,
                  maxWarmth: 1,
                  minHardness: 0,
                  maxHardness: 1,
                })}
                className="text-xs text-slate-400 hover:text-white transition-colors"
              >
                Reset perceptual filters
              </button>
            )}
          </div>
        )}
      </div>

      {/* ML Classification - collapsible (only show if data available) */}
      {(availableInstruments.length > 0 || availableGenres.length > 0) && (
        <div className="border-t border-surface-border pt-3">
          <button
            onClick={() => setShowClassification(!showClassification)}
            className="flex items-center gap-2 text-xs text-slate-400 hover:text-white transition-colors w-full"
          >
            {showClassification ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span className="font-medium">Classification</span>
          </button>

          {showClassification && (
            <div className="mt-3 space-y-3 pl-5">
              {/* Instruments */}
              {availableInstruments.length > 0 && (
                <div className="flex items-start gap-3">
                  <span className="text-xs text-slate-400 whitespace-nowrap pt-1">Instruments:</span>
                  <div className="flex-1">
                    <div className="flex flex-wrap gap-1">
                      {availableInstruments.map((instrument) => (
                        <button
                          key={instrument}
                          onClick={() => handleInstrumentToggle(instrument)}
                          className={`px-2 py-0.5 text-xs rounded capitalize transition-colors ${
                            filterState.selectedInstruments.includes(instrument)
                              ? 'bg-accent-primary text-white'
                              : 'bg-surface-base text-slate-400 hover:text-white hover:bg-surface-raised'
                          }`}
                        >
                          {instrument}
                        </button>
                      ))}
                    </div>
                    {filterState.selectedInstruments.length > 0 && (
                      <button
                        onClick={() => onChange({ ...filterState, selectedInstruments: [] })}
                        className="text-xs text-slate-400 hover:text-white transition-colors mt-1"
                      >
                        Clear ({filterState.selectedInstruments.length} selected)
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Genres */}
              {availableGenres.length > 0 && (
                <div className="flex items-start gap-3">
                  <span className="text-xs text-slate-400 whitespace-nowrap pt-1">Genres:</span>
                  <div className="flex-1">
                    <div className="flex flex-wrap gap-1">
                      {availableGenres.map((genre) => (
                        <button
                          key={genre}
                          onClick={() => handleGenreToggle(genre)}
                          className={`px-2 py-0.5 text-xs rounded capitalize transition-colors ${
                            filterState.selectedGenres.includes(genre)
                              ? 'bg-accent-primary text-white'
                              : 'bg-surface-base text-slate-400 hover:text-white hover:bg-surface-raised'
                          }`}
                        >
                          {genre}
                        </button>
                      ))}
                    </div>
                    {filterState.selectedGenres.length > 0 && (
                      <button
                        onClick={() => onChange({ ...filterState, selectedGenres: [] })}
                        className="text-xs text-slate-400 hover:text-white transition-colors mt-1"
                      >
                        Clear ({filterState.selectedGenres.length} selected)
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
