import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, CheckSquare, ChevronDown, ChevronRight } from 'lucide-react'
import type { AudioFilterState } from './SourcesAudioFilter'

type SortField = NonNullable<AudioFilterState['sortBy']>
type SortOrder = AudioFilterState['sortOrder']

const PRIMARY_SORT_OPTIONS: Array<{ value: SortField; label: string }> = [
  { value: 'name', label: 'Name' },
  { value: 'bpm', label: 'BPM' },
  { value: 'key', label: 'Key' },
  { value: 'duration', label: 'Duration' },
  { value: 'createdAt', label: 'Added date' },
]

const OTHER_SORT_OPTIONS: Array<{ value: SortField; label: string }> = [
  { value: 'note', label: 'Note' },
  { value: 'artist', label: 'Artist' },
  { value: 'album', label: 'Album' },
  { value: 'year', label: 'Year' },
  { value: 'albumArtist', label: 'Album artist' },
  { value: 'genre', label: 'Genre' },
  { value: 'composer', label: 'Composer' },
  { value: 'trackNumber', label: 'Track #' },
  { value: 'discNumber', label: 'Disc #' },
  { value: 'tagBpm', label: 'Detected BPM' },
  { value: 'musicalKey', label: 'Detected key' },
  { value: 'isrc', label: 'ISRC' },
  { value: 'similarity', label: 'Similarity' },
]

const PRIMARY_SORT_FIELD_SET = new Set(PRIMARY_SORT_OPTIONS.map((option) => option.value))
const SORT_LABEL_BY_FIELD = new Map<SortField, string>(
  [...PRIMARY_SORT_OPTIONS, ...OTHER_SORT_OPTIONS].map((option) => [option.value, option.label]),
)

interface SampleSortMenuProps {
  sortBy: AudioFilterState['sortBy']
  sortOrder: AudioFilterState['sortOrder']
  onSortByChange: (sortBy: AudioFilterState['sortBy']) => void
  onSortOrderChange: (sortOrder: AudioFilterState['sortOrder']) => void
  similarityEnabled?: boolean
}

export function SampleSortMenu({
  sortBy,
  sortOrder,
  onSortByChange,
  onSortOrderChange,
  similarityEnabled = true,
}: SampleSortMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const activeSortLabel = useMemo(() => {
    if (!sortBy) return 'Default order'
    return SORT_LABEL_BY_FIELD.get(sortBy) ?? 'Default order'
  }, [sortBy])
  const hasOtherActiveField = Boolean(sortBy && !PRIMARY_SORT_FIELD_SET.has(sortBy))

  const clearCloseTimer = () => {
    if (!closeTimeoutRef.current) return
    clearTimeout(closeTimeoutRef.current)
    closeTimeoutRef.current = null
  }

  const scheduleClose = () => {
    if (!isOpen) return
    clearCloseTimer()
    closeTimeoutRef.current = setTimeout(() => {
      setIsOpen(false)
      closeTimeoutRef.current = null
    }, 140)
  }

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
      clearCloseTimer()
    }
  }, [])

  const applySort = (field: SortField, order: SortOrder) => {
    onSortByChange(field)
    onSortOrderChange(order)
    setIsOpen(false)
  }

  const getArrowButtonClass = (
    field: SortField,
    order: SortOrder,
    disabled: boolean,
  ): string => {
    const isActive = sortBy === field && sortOrder === order
    if (disabled) {
      return 'inline-flex h-5 w-5 cursor-not-allowed items-center justify-center rounded border border-surface-border text-text-muted/40'
    }
    return `inline-flex h-5 w-5 items-center justify-center rounded border transition-colors ${
      isActive
        ? 'border-accent-primary/60 bg-accent-primary/20 text-accent-primary'
        : 'border-surface-border text-text-muted hover:text-text-secondary'
    }`
  }

  const renderSortRow = (field: SortField, label: string) => {
    const isFieldActive = sortBy === field
    const isDisabled = field === 'similarity' && !similarityEnabled
    return (
      <div
        key={field}
        className={`flex h-7 items-center justify-between px-2.5 text-[11px] transition-colors ${
          isDisabled
            ? 'text-text-muted/45'
            : isFieldActive
            ? 'bg-accent-primary/10 text-accent-primary'
            : 'text-text-secondary hover:bg-surface-base hover:text-text-primary'
        }`}
        title={isDisabled ? 'Select a sample first to enable similarity sort' : undefined}
      >
        <span>{label}</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={isDisabled}
            onClick={() => applySort(field, 'asc')}
            className={getArrowButtonClass(field, 'asc', isDisabled)}
            title={`Sort ${label.toLowerCase()} ascending`}
          >
            <ArrowUp size={11} />
          </button>
          <button
            type="button"
            disabled={isDisabled}
            onClick={() => applySort(field, 'desc')}
            className={getArrowButtonClass(field, 'desc', isDisabled)}
            title={`Sort ${label.toLowerCase()} descending`}
          >
            <ArrowDown size={11} />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={menuRef}
      className="relative"
      onMouseEnter={clearCloseTimer}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="inline-flex h-7 max-w-[180px] items-center gap-1 rounded-md border border-surface-border bg-surface-base px-2 text-[11px] font-medium text-text-secondary transition-colors hover:text-text-primary"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        title={sortBy ? `Sorted by ${activeSortLabel.toLowerCase()} (${sortOrder})` : 'Default order'}
      >
        <span className="truncate">Sort: {activeSortLabel}</span>
        <ChevronDown size={12} className={`${isOpen ? 'rotate-180' : ''} transition-transform`} />
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full z-30 mt-2 min-w-[220px] overflow-visible rounded-md border border-surface-border bg-surface-raised py-0 shadow-xl">
          <button
            type="button"
            onClick={() => {
              onSortByChange(null)
              setIsOpen(false)
            }}
            className={`flex h-7 w-full items-center justify-between px-2.5 text-left text-[11px] transition-colors ${
              sortBy == null
                ? 'bg-accent-primary/15 text-accent-primary'
                : 'text-text-secondary hover:bg-surface-base hover:text-text-primary'
            }`}
            role="menuitem"
            title="Use default order"
          >
            <span>Default order</span>
            {sortBy == null && <CheckSquare size={13} className="text-accent-primary" />}
          </button>

          <div className="h-px bg-surface-border" />

          {PRIMARY_SORT_OPTIONS.map((option) => renderSortRow(option.value, option.label))}

          <div className="h-px bg-surface-border" />

          <div className="group/other relative">
            <button
              type="button"
              className={`flex h-7 w-full items-center justify-between px-2.5 text-left text-[11px] transition-colors ${
                hasOtherActiveField
                  ? 'bg-accent-primary/10 text-accent-primary'
                  : 'text-text-secondary hover:bg-surface-base hover:text-text-primary'
              }`}
              title="More sort fields"
            >
              <span>Other</span>
              <ChevronRight size={12} className="text-text-muted" />
            </button>

            <div className="absolute left-full top-0 -ml-px hidden min-w-[220px] overflow-hidden rounded-md border border-surface-border bg-surface-raised py-0 shadow-xl group-hover/other:block group-focus-within/other:block">
              {OTHER_SORT_OPTIONS.map((option) => renderSortRow(option.value, option.label))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
