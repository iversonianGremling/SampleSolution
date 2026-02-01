import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'

export interface AudioFilterState {
  sortBy: 'bpm' | 'key' | 'name' | 'duration' | 'createdAt' | null
  sortOrder: 'asc' | 'desc'
  minBpm: number
  maxBpm: number
  selectedKeys: string[]
}

interface SourcesAudioFilterProps {
  filterState: AudioFilterState
  onChange: (state: AudioFilterState) => void
  availableKeys: string[]
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

export function SourcesAudioFilter({ filterState, onChange, availableKeys }: SourcesAudioFilterProps) {
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
    </div>
  )
}
