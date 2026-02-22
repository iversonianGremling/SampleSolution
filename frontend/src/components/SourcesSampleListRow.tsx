import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Play, Pause, Heart, Trash2, Pencil, Disc3, MoreHorizontal } from 'lucide-react'
import { CustomCheckbox } from './CustomCheckbox'
import { InstrumentIcon } from './InstrumentIcon'
import { DrumRackPadPicker } from './DrumRackPadPicker'
import type { SliceWithTrackExtended } from '../types'
import { freqToNoteName } from '../utils/musicTheory'

export type PlayMode = 'normal' | 'one-shot' | 'reproduce-while-clicking'

type DuplicatePairMatchType = 'exact' | 'content' | 'file'

interface DuplicatePairRowMeta {
  pairId: string
  pairIndex: number
  role: 'keep' | 'duplicate'
  partnerSampleId: number
  selectedForDelete: boolean
  canDelete: boolean
  matchType: DuplicatePairMatchType
  similarityPercent: number
}

export type SourcesListColumnWidthKey =
  | 'name'
  | 'tags'
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
  | 'scale'
  | 'envelope'
  | 'brightness'
  | 'noisiness'
  | 'warmth'
  | 'hardness'
  | 'sharpness'
  | 'loudness'
  | 'sampleRate'
  | 'channels'
  | 'format'
  | 'polyphony'
  | 'dateAdded'
  | 'dateCreated'
  | 'dateModified'
  | 'path'
  | 'duration'
  | 'similarity'
  | 'actions'

export type SourcesListColumnWidths = Record<SourcesListColumnWidthKey, number>

export const DEFAULT_SOURCES_LIST_COLUMN_WIDTHS: SourcesListColumnWidths = {
  name: 260,
  tags: 160,
  artist: 140,
  album: 140,
  year: 80,
  albumArtist: 140,
  genre: 120,
  composer: 140,
  trackNumber: 88,
  discNumber: 84,
  tagBpm: 88,
  musicalKey: 96,
  isrc: 140,
  bpm: 72,
  key: 84,
  scale: 90,
  envelope: 100,
  brightness: 96,
  noisiness: 96,
  warmth: 96,
  hardness: 96,
  sharpness: 96,
  loudness: 92,
  sampleRate: 100,
  channels: 84,
  format: 84,
  polyphony: 88,
  dateAdded: 120,
  dateCreated: 120,
  dateModified: 120,
  path: 280,
  duration: 88,
  similarity: 96,
  actions: 76,
}

export interface SourcesListColumnVisibility {
  tags: boolean
  artist: boolean
  album: boolean
  year: boolean
  albumArtist: boolean
  genre: boolean
  composer: boolean
  trackNumber: boolean
  discNumber: boolean
  tagBpm: boolean
  musicalKey: boolean
  isrc: boolean
  bpm: boolean
  key: boolean
  scale: boolean
  envelope: boolean
  brightness: boolean
  noisiness: boolean
  warmth: boolean
  hardness: boolean
  sharpness: boolean
  loudness: boolean
  sampleRate: boolean
  channels: boolean
  format: boolean
  polyphony: boolean
  dateAdded: boolean
  dateCreated: boolean
  dateModified: boolean
  path: boolean
  similarity: boolean
}

export const DEFAULT_SOURCES_LIST_COLUMN_VISIBILITY: SourcesListColumnVisibility = {
  tags: true,
  artist: false,
  album: false,
  year: false,
  albumArtist: false,
  genre: false,
  composer: false,
  trackNumber: false,
  discNumber: false,
  tagBpm: false,
  musicalKey: false,
  isrc: false,
  bpm: true,
  key: true,
  scale: false,
  envelope: false,
  brightness: false,
  noisiness: false,
  warmth: false,
  hardness: false,
  sharpness: false,
  loudness: false,
  sampleRate: false,
  channels: false,
  format: false,
  polyphony: false,
  dateAdded: false,
  dateCreated: false,
  dateModified: false,
  path: false,
  similarity: false,  // Only shown in similarity mode
}

interface SourcesSampleListRowProps {
  sample: SliceWithTrackExtended
  isSelected: boolean
  isChecked: boolean
  isPlaying: boolean
  onSelect: () => void
  onToggleCheck: () => void
  onPlay: (e: React.MouseEvent) => void
  onMouseDown?: (e: React.MouseEvent) => void
  onMouseUp?: (e: React.MouseEvent) => void
  onToggleFavorite: () => void
  onUpdateName: (name: string) => void
  onDelete: () => void
  onTagClick?: (tagId: number) => void
  onDragStart?: (e: React.DragEvent) => void
  onDragEnd?: () => void
  playMode?: PlayMode
  columnVisibility?: SourcesListColumnVisibility
  columnWidths?: SourcesListColumnWidths
  minWidth?: number
  showInstrumentColumn?: boolean
  showSimilarity?: boolean
  bulkRenamePreviewName?: string | null
  duplicatePairMeta?: DuplicatePairRowMeta
  onToggleDuplicateDeleteTarget?: () => void
}

function formatDuration(startTime: number, endTime: number): string {
  const dur = endTime - startTime
  if (dur < 60) return `${dur.toFixed(1)}s`
  const mins = Math.floor(dur / 60)
  const secs = Math.floor(dur % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function formatSampleRate(sampleRate: number | null | undefined): string {
  if (!sampleRate || sampleRate <= 0) return '-'
  return `${(sampleRate / 1000).toFixed(1)}k`
}

function formatLoudness(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-'
  return `${value.toFixed(1)} dB`
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleDateString()
}

function formatTagBpm(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-'
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function getDuplicateMatchLabel(matchType: DuplicatePairMatchType): string {
  if (matchType === 'exact') return 'Fingerprint'
  if (matchType === 'content') return 'Content'
  return 'File'
}

const TAG_COLUMN_LEFT_PADDING_PX = 4
const TAG_CELL_RIGHT_BUFFER_PX = 4
const TAG_GAP_PX = 4
const TAG_CHAR_WIDTH_PX = 6
const TAG_BADGE_BASE_WIDTH_PX = 10
const TAG_BADGE_HORIZONTAL_PADDING_PX = 12
const TAG_BADGE_MIN_VISIBLE_WIDTH_PX = 44

function estimateTagBadgeWidth(label: string): number {
  return Math.max(
    TAG_BADGE_MIN_VISIBLE_WIDTH_PX,
    Math.ceil(TAG_BADGE_BASE_WIDTH_PX + TAG_BADGE_HORIZONTAL_PADDING_PX + label.length * TAG_CHAR_WIDTH_PX),
  )
}

function estimateOverflowCounterWidth(count: number): number {
  return Math.ceil(8 + String(count).length * TAG_CHAR_WIDTH_PX)
}

function getVisibleTagCount(tags: Array<{ name: string }>, availableWidth: number): number {
  if (tags.length === 0 || availableWidth <= 0) return 0

  let consumedWidth = 0
  let visibleCount = 0

  for (let idx = 0; idx < tags.length; idx += 1) {
    const gapBefore = visibleCount > 0 ? TAG_GAP_PX : 0
    const currentTagWidth = estimateTagBadgeWidth(tags[idx].name)
    const remainingCount = tags.length - (idx + 1)
    const overflowReservation =
      remainingCount > 0
        ? TAG_GAP_PX + estimateOverflowCounterWidth(remainingCount)
        : 0

    const nextWidth = consumedWidth + gapBefore + currentTagWidth + overflowReservation
    if (nextWidth > availableWidth) break

    consumedWidth += gapBefore + currentTagWidth
    visibleCount += 1
  }

  if (visibleCount === 0) {
    const remainingAfterFirst = tags.length - 1
    const overflowReservation =
      remainingAfterFirst > 0
        ? TAG_GAP_PX + estimateOverflowCounterWidth(remainingAfterFirst)
        : 0
    const minimumFirstTagWidth = Math.min(estimateTagBadgeWidth(tags[0].name), 56)
    if (minimumFirstTagWidth + overflowReservation <= availableWidth || tags.length === 1) {
      return 1
    }
  }

  return visibleCount
}

function SubjectiveBar({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) {
    return <span className="text-xs text-text-muted">-</span>
  }

  const percent = Math.round(Math.max(0, Math.min(1, value)) * 100)
  return (
    <div className="w-14 h-1.5 rounded-full bg-surface-base border border-surface-border overflow-hidden" title={`${percent}%`}>
      <div className="h-full bg-accent-warm/70" style={{ width: `${percent}%` }} />
    </div>
  )
}

export function SourcesSampleListRow({
  sample,
  isSelected,
  isChecked,
  isPlaying,
  onSelect,
  onToggleCheck,
  onPlay,
  onMouseDown,
  onMouseUp,
  onToggleFavorite,
  onUpdateName,
  onDelete,
  onTagClick,
  onDragStart,
  onDragEnd,
  playMode = 'normal',
  columnVisibility = DEFAULT_SOURCES_LIST_COLUMN_VISIBILITY,
  columnWidths = DEFAULT_SOURCES_LIST_COLUMN_WIDTHS,
  minWidth,
  showInstrumentColumn = true,
  showSimilarity = false,
  bulkRenamePreviewName = null,
  duplicatePairMeta = undefined,
  onToggleDuplicateDeleteTarget,
}: SourcesSampleListRowProps) {
  const [isEditingName, setIsEditingName] = useState(false)
  const [editingName, setEditingName] = useState(sample.name)
  const [showTagsPopup, setShowTagsPopup] = useState(false)
  const [tagsPopupPosition, setTagsPopupPosition] = useState<{ top: number; left: number } | null>(null)
  const [showActionsMenu, setShowActionsMenu] = useState(false)
  const [showPadPicker, setShowPadPicker] = useState(false)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tagsOverflowTriggerRef = useRef<HTMLDivElement>(null)
  const tagsPopupRef = useRef<HTMLDivElement>(null)
  const actionsMenuRef = useRef<HTMLDivElement>(null)
  const actionsMenuButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (isEditingName && nameInputRef.current) {
      nameInputRef.current.focus()
      nameInputRef.current.select()
    }
  }, [isEditingName])

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current)
        closeTimeoutRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!showActionsMenu) return

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      if (actionsMenuButtonRef.current?.contains(target)) return
      if (actionsMenuRef.current?.contains(target)) return
      setShowActionsMenu(false)
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowActionsMenu(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [showActionsMenu])

  useEffect(() => {
    if (!showTagsPopup) {
      setTagsPopupPosition(null)
      return
    }

    if (typeof window === 'undefined') {
      return
    }

    const updateTagsPopupPosition = () => {
      const trigger = tagsOverflowTriggerRef.current
      if (!trigger) return

      const popup = tagsPopupRef.current
      const triggerRect = trigger.getBoundingClientRect()
      const popupWidth = popup?.offsetWidth ?? 224
      const popupHeight = popup?.offsetHeight ?? 0
      const viewportPadding = 8
      const gap = 4

      const nextLeft = Math.min(
        Math.max(viewportPadding, triggerRect.right - popupWidth),
        window.innerWidth - popupWidth - viewportPadding,
      )

      let nextTop = triggerRect.top - gap - popupHeight
      if (nextTop < viewportPadding) {
        nextTop = Math.min(
          triggerRect.bottom + gap,
          Math.max(viewportPadding, window.innerHeight - popupHeight - viewportPadding),
        )
      }

      setTagsPopupPosition({ top: nextTop, left: nextLeft })
    }

    updateTagsPopupPosition()
    const rafId = window.requestAnimationFrame(updateTagsPopupPosition)
    window.addEventListener('resize', updateTagsPopupPosition)
    window.addEventListener('scroll', updateTagsPopupPosition, true)

    return () => {
      window.cancelAnimationFrame(rafId)
      window.removeEventListener('resize', updateTagsPopupPosition)
      window.removeEventListener('scroll', updateTagsPopupPosition, true)
    }
  }, [showTagsPopup])

  const saveName = () => {
    if (editingName.trim() && editingName !== sample.name) {
      onUpdateName(editingName.trim())
    }
    setIsEditingName(false)
  }

  const availableTagWidth = Math.max(0, columnWidths.tags - TAG_COLUMN_LEFT_PADDING_PX - TAG_CELL_RIGHT_BUFFER_PX)
  const maxVisibleTags = getVisibleTagCount(sample.tags, availableTagWidth)
  const visibleTags = sample.tags.slice(0, maxVisibleTags)
  const remainingTags = Math.max(0, sample.tags.length - maxVisibleTags)

  const handleTagPopupOpen = () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current)
      closeTimeoutRef.current = null
    }
    setShowTagsPopup(true)
  }

  const handleTagPopupClose = () => {
    closeTimeoutRef.current = setTimeout(() => {
      setShowTagsPopup(false)
    }, 150)
  }

  const handleTagPopupEnter = () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current)
      closeTimeoutRef.current = null
    }
    setShowTagsPopup(true)
  }

  const keyDisplay = (sample.fundamentalFrequency ? freqToNoteName(sample.fundamentalFrequency) : null) || sample.keyEstimate || '-'
  const scaleDisplay = sample.scale || '-'
  const noisiness = sample.subjectiveNormalized?.noisiness ?? sample.noisiness
  const brightness = sample.subjectiveNormalized?.brightness ?? sample.brightness
  const warmth = sample.subjectiveNormalized?.warmth ?? sample.warmth
  const hardness = sample.subjectiveNormalized?.hardness ?? sample.hardness
  const sharpness = sample.subjectiveNormalized?.sharpness ?? sample.sharpness
  const controlsColumnWidth = Math.max(
    72,
    Math.min(columnWidths.actions, DEFAULT_SOURCES_LIST_COLUMN_WIDTHS.actions),
  )
  const duplicateRoleLabel = duplicatePairMeta ? (duplicatePairMeta.role === 'keep' ? 'Keep' : 'Duplicate') : null
  const duplicateRoleBadgeClass = duplicatePairMeta
    ? duplicatePairMeta.selectedForDelete
      ? 'bg-red-500/20 text-red-100'
      : duplicatePairMeta.role === 'keep'
        ? 'bg-emerald-500/20 text-emerald-200'
        : 'bg-amber-500/20 text-amber-200'
    : ''
  const duplicateCanToggleDelete =
    Boolean(duplicatePairMeta && duplicatePairMeta.canDelete && onToggleDuplicateDeleteTarget)
  const duplicateActionLabel = duplicatePairMeta
    ? duplicatePairMeta.selectedForDelete
      ? 'Keep both'
      : 'Delete this'
    : ''
  const defaultRowStateClass = duplicatePairMeta
    ? duplicatePairMeta.selectedForDelete
      ? 'bg-red-500/10 border-red-500/60'
      : duplicatePairMeta.role === 'keep'
        ? 'bg-emerald-500/5 border-emerald-500/50'
        : 'bg-amber-500/5 border-amber-500/50'
    : 'hover:bg-surface-raised border-transparent'

  return (
    <div
      data-sources-list-row="true"
      onClick={onSelect}
      draggable={!!onDragStart}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`relative px-3 py-[7px] cursor-pointer transition-colors border-l-2 z-0 ${
        showTagsPopup ? 'z-30' : 'hover:z-10'
      } ${
        isSelected
          ? 'bg-accent-warm/10 border-accent-warm'
          : isChecked
          ? 'bg-accent-primary/15 border-accent-primary/40'
          : defaultRowStateClass
      }`}
      style={minWidth ? { minWidth } : undefined}
    >
      <div className="flex items-center gap-1.5 sm:gap-2">
        <CustomCheckbox
          checked={isChecked}
          onChange={(e) => {
            e.stopPropagation()
            onToggleCheck()
          }}
          onClick={(e) => e.stopPropagation()}
          className="flex-shrink-0"
        />

        <div className="relative flex-shrink-0 flex items-center justify-start gap-0.5" style={{ width: controlsColumnWidth }}>
          <button
            onClick={(e) => {
              e.stopPropagation()
              if (playMode !== 'reproduce-while-clicking') onPlay(e)
            }}
            onMouseDown={playMode === 'reproduce-while-clicking' && onMouseDown ? (e) => {
              e.stopPropagation()
              onMouseDown(e)
            } : undefined}
            onMouseUp={playMode === 'reproduce-while-clicking' && onMouseUp ? (e) => {
              e.stopPropagation()
              onMouseUp(e)
            } : undefined}
            onMouseLeave={playMode === 'reproduce-while-clicking' && onMouseUp ? (e) => {
              e.stopPropagation()
              onMouseUp(e)
            } : undefined}
            className={`p-0.5 sm:p-1 rounded transition-colors flex-shrink-0 ${
              isPlaying
                ? 'bg-accent-primary text-white'
                : 'text-slate-400 hover:text-accent-primary hover:bg-surface-base'
            }`}
            title={isPlaying && playMode === 'normal' ? 'Pause' : 'Play'}
          >
            {isPlaying && playMode === 'normal' ? <Pause size={13} /> : <Play size={13} />}
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation()
              onToggleFavorite()
            }}
            className={`p-0.5 sm:p-1 rounded transition-colors flex-shrink-0 ${
              sample.favorite
                ? 'text-amber-400 bg-amber-400/20'
                : 'text-slate-400 hover:text-amber-400 hover:bg-amber-400/20'
            }`}
            title={sample.favorite ? 'Remove from favorites' : 'Add to favorites'}
          >
            <Heart size={12} className={sample.favorite ? 'fill-current' : ''} />
          </button>

          <button
            ref={actionsMenuButtonRef}
            onClick={(e) => {
              e.stopPropagation()
              setShowActionsMenu((prev) => !prev)
            }}
            className="p-0.5 sm:p-1 rounded text-slate-400 hover:text-white hover:bg-surface-base transition-colors flex-shrink-0"
            title="More actions"
            aria-label="More actions"
            aria-expanded={showActionsMenu}
            aria-haspopup="menu"
          >
            <MoreHorizontal size={12} />
          </button>

          {showActionsMenu && (
            <div
              ref={actionsMenuRef}
              role="menu"
              onClick={(e) => e.stopPropagation()}
              className="absolute left-0 top-[calc(100%+3px)] z-40 min-w-44 rounded-lg border border-surface-border bg-surface-raised shadow-xl p-1"
            >
              <button
                type="button"
                role="menuitem"
                onClick={(event) => {
                  event.stopPropagation()
                  setShowActionsMenu(false)
                  setShowPadPicker(true)
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[11px] text-slate-300 hover:bg-surface-base hover:text-white transition-colors"
              >
                <Disc3 size={13} />
                <span>Send to Drum Rack</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={(event) => {
                  event.stopPropagation()
                  setShowActionsMenu(false)
                  onDelete()
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[11px] text-red-300 hover:bg-red-500/15 hover:text-red-200 transition-colors"
              >
                <Trash2 size={13} />
                <span>Delete</span>
              </button>
            </div>
          )}
        </div>

        {showInstrumentColumn && (
          <div className="w-4 flex-shrink-0 text-slate-400" title={sample.instrumentType || sample.instrumentPrimary || ''}>
            {(sample.instrumentType || sample.instrumentPrimary) && (
              <InstrumentIcon type={sample.instrumentType || sample.instrumentPrimary || 'other'} size={13} />
            )}
          </div>
        )}

        {showSimilarity && (
          <div className="flex flex-shrink-0 items-center justify-end pr-1" style={{ width: columnWidths.similarity }}>
            {sample.similarity !== undefined && sample.similarity !== null ? (
              <div className="flex items-center gap-1.5 w-full px-1">
                <div className="flex-1 h-1.5 rounded-full bg-surface-base border border-surface-border overflow-hidden">
                  <div
                    className="h-full bg-accent-primary transition-all"
                    style={{ width: `${Math.round(sample.similarity * 100)}%` }}
                  />
                </div>
                <span className="text-[10px] text-slate-300 font-mono w-7 text-right tabular-nums flex-shrink-0">
                  {Math.round(sample.similarity * 100)}%
                </span>
              </div>
            ) : (
              <span className="text-xs text-slate-500">-</span>
            )}
          </div>
        )}

        <div className="flex-shrink-0 min-w-0 overflow-hidden pl-1" style={{ width: columnWidths.name }}>
          {isEditingName ? (
            <input
              ref={nameInputRef}
              type="text"
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') saveName()
                if (e.key === 'Escape') setIsEditingName(false)
              }}
              onBlur={saveName}
              className="w-full px-2 py-1 bg-surface-base border border-accent-primary rounded text-white text-sm focus:outline-none"
            />
          ) : (
            <div
              className="group flex w-full min-w-0 items-center gap-1.5"
              onDoubleClick={(e) => {
                e.stopPropagation()
                setEditingName(sample.name)
                setIsEditingName(true)
              }}
            >
              <div className="min-w-0 flex-1">
                {duplicatePairMeta && duplicateRoleLabel && (
                  <div className="mb-0.5 flex items-center gap-1.5 text-[10px]">
                    <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 font-medium ${duplicateRoleBadgeClass}`}>
                      Pair {duplicatePairMeta.pairIndex} • {duplicateRoleLabel}
                    </span>
                    <span className="text-slate-500">
                      {getDuplicateMatchLabel(duplicatePairMeta.matchType)} {duplicatePairMeta.similarityPercent}%
                    </span>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        if (!duplicateCanToggleDelete) return
                        onToggleDuplicateDeleteTarget?.()
                      }}
                      disabled={!duplicateCanToggleDelete}
                      className={`ml-auto inline-flex items-center rounded border px-1.5 py-0.5 font-medium transition-colors ${
                        !duplicatePairMeta.canDelete
                          ? 'border-surface-border text-slate-500 cursor-not-allowed'
                          : duplicatePairMeta.selectedForDelete
                            ? 'border-red-500/40 bg-red-500/20 text-red-100 hover:bg-red-500/25'
                            : 'border-red-500/35 text-red-200 hover:bg-red-500/15'
                      }`}
                    >
                      {duplicatePairMeta.canDelete ? duplicateActionLabel : 'Protected'}
                    </button>
                  </div>
                )}
                {bulkRenamePreviewName && bulkRenamePreviewName !== sample.name ? (
                  <>
                    <span className="block max-w-full truncate text-sm font-medium text-accent-primary" title={bulkRenamePreviewName}>
                      {bulkRenamePreviewName}
                    </span>
                    <span className="block max-w-full truncate text-[10px] text-slate-500 line-through" title={sample.name}>
                      {sample.name}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="block max-w-full truncate text-[13px] font-medium leading-tight text-white" title={sample.name}>
                      {sample.name}
                    </span>
                    {sample.track.artist && !columnVisibility.artist && (
                      <span className="block max-w-full truncate text-[10px] text-slate-500" title={sample.track.artist}>
                        {sample.track.artist}
                      </span>
                    )}
                  </>
                )}
              </div>
              <Pencil size={11} className="text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
            </div>
          )}
        </div>

        {columnVisibility.tags && (
          <div
            className="hidden sm:flex items-center justify-start gap-1 flex-shrink-0 pl-1 min-w-0"
            style={{ width: columnWidths.tags }}
          >
            {visibleTags.map((tag) => (
              <span
                key={tag.id}
                onClick={(e) => {
                  if (onTagClick) {
                    e.stopPropagation()
                    onTagClick(tag.id)
                  }
                }}
                className={`inline-flex max-w-full min-w-0 items-center rounded-full px-1.5 py-0.5 text-[10px] leading-none ${onTagClick ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
                style={{
                  backgroundColor: tag.color + '25',
                  color: tag.color,
                }}
                title={onTagClick ? `Filter by ${tag.name}` : tag.name}
              >
                <span className="min-w-0 truncate">{tag.name}</span>
              </span>
            ))}

            {remainingTags > 0 && (
              <div
                ref={tagsOverflowTriggerRef}
                className="relative flex-shrink-0"
                onMouseEnter={handleTagPopupOpen}
                onMouseLeave={handleTagPopupClose}
              >
                <span className="text-[10px] leading-none text-slate-500 cursor-default">+{remainingTags}</span>
                {showTagsPopup && typeof document !== 'undefined' && createPortal(
                  <div
                    ref={tagsPopupRef}
                    className="fixed max-w-56 bg-surface-raised border border-surface-border rounded-lg shadow-lg py-1 px-2 z-[130]"
                    style={{
                      top: tagsPopupPosition?.top ?? 0,
                      left: tagsPopupPosition?.left ?? 0,
                      visibility: tagsPopupPosition ? 'visible' : 'hidden',
                    }}
                    onClick={(e) => e.stopPropagation()}
                    onMouseEnter={handleTagPopupEnter}
                    onMouseLeave={handleTagPopupClose}
                  >
                    <div className="flex flex-wrap gap-1 max-w-56">
                      {sample.tags.slice(maxVisibleTags).map((tag) => (
                        <span
                          key={tag.id}
                          onClick={(e) => {
                            if (onTagClick) {
                              e.stopPropagation()
                              onTagClick(tag.id)
                            }
                            setShowTagsPopup(false)
                            if (closeTimeoutRef.current) {
                              clearTimeout(closeTimeoutRef.current)
                              closeTimeoutRef.current = null
                            }
                          }}
                          className={`inline-flex max-w-40 items-center rounded-full px-1.5 py-0.5 text-[10px] leading-none whitespace-nowrap ${onTagClick ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
                          style={{
                            backgroundColor: tag.color + '25',
                            color: tag.color,
                          }}
                          title={onTagClick ? `Filter by ${tag.name}` : tag.name}
                        >
                          <span className="truncate">{tag.name}</span>
                        </span>
                      ))}
                    </div>
                  </div>,
                  document.body
                )}
              </div>
            )}
          </div>
        )}

        {columnVisibility.artist && (
          <div className="hidden lg:flex flex-shrink-0 justify-start min-w-0" style={{ width: columnWidths.artist }}>
            <span className="text-xs text-slate-400 truncate">{sample.track.artist || '-'}</span>
          </div>
        )}

        {columnVisibility.album && (
          <div className="hidden lg:flex flex-shrink-0 justify-start min-w-0" style={{ width: columnWidths.album }}>
            <span className="text-xs text-slate-400 truncate">{sample.track.album || '-'}</span>
          </div>
        )}

        {columnVisibility.year && (
          <div className="hidden lg:flex flex-shrink-0 justify-center" style={{ width: columnWidths.year }}>
            <span className="text-xs text-slate-400">{sample.track.year ?? '-'}</span>
          </div>
        )}

        {columnVisibility.albumArtist && (
          <div className="hidden xl:flex flex-shrink-0 justify-start min-w-0" style={{ width: columnWidths.albumArtist }}>
            <span className="text-xs text-slate-400 truncate">{sample.track.albumArtist || '-'}</span>
          </div>
        )}

        {columnVisibility.genre && (
          <div className="hidden xl:flex flex-shrink-0 justify-start min-w-0" style={{ width: columnWidths.genre }}>
            <span className="text-xs text-slate-400 truncate">{sample.track.genre || '-'}</span>
          </div>
        )}

        {columnVisibility.composer && (
          <div className="hidden xl:flex flex-shrink-0 justify-start min-w-0" style={{ width: columnWidths.composer }}>
            <span className="text-xs text-slate-400 truncate">{sample.track.composer || '-'}</span>
          </div>
        )}

        {columnVisibility.trackNumber && (
          <div className="hidden xl:flex flex-shrink-0 justify-center" style={{ width: columnWidths.trackNumber }}>
            <span className="text-xs text-slate-400">{sample.track.trackNumber ?? '-'}</span>
          </div>
        )}

        {columnVisibility.discNumber && (
          <div className="hidden xl:flex flex-shrink-0 justify-center" style={{ width: columnWidths.discNumber }}>
            <span className="text-xs text-slate-400">{sample.track.discNumber ?? '-'}</span>
          </div>
        )}

        {columnVisibility.tagBpm && (
          <div className="hidden xl:flex flex-shrink-0 justify-center" style={{ width: columnWidths.tagBpm }}>
            <span className="text-xs text-slate-400">{formatTagBpm(sample.track.tagBpm)}</span>
          </div>
        )}

        {columnVisibility.musicalKey && (
          <div className="hidden xl:flex flex-shrink-0 justify-center" style={{ width: columnWidths.musicalKey }}>
            <span className="text-xs text-slate-400 truncate">{sample.track.musicalKey || '-'}</span>
          </div>
        )}

        {columnVisibility.isrc && (
          <div className="hidden xl:flex flex-shrink-0 justify-start min-w-0" style={{ width: columnWidths.isrc }}>
            <span className="text-xs text-slate-400 truncate">{sample.track.isrc || '-'}</span>
          </div>
        )}

        {columnVisibility.bpm && (
          <div className="hidden md:flex flex-shrink-0 justify-center" style={{ width: columnWidths.bpm }}>
            <span className="text-xs text-slate-400">{sample.bpm ? Math.round(sample.bpm) : '-'}</span>
          </div>
        )}

        {columnVisibility.key && (
          <div className="hidden lg:flex flex-shrink-0 justify-center" style={{ width: columnWidths.key }}>
            <span className="text-xs text-slate-400">{keyDisplay}</span>
          </div>
        )}

        {columnVisibility.scale && (
          <div className="hidden lg:flex flex-shrink-0 justify-center" style={{ width: columnWidths.scale }}>
            <span className="text-xs text-slate-400 capitalize">{scaleDisplay}</span>
          </div>
        )}

        {columnVisibility.envelope && (
          <div className="hidden xl:flex flex-shrink-0 justify-center" style={{ width: columnWidths.envelope }}>
            <span className="text-xs text-slate-400 capitalize">{sample.envelopeType || '-'}</span>
          </div>
        )}

        {columnVisibility.brightness && (
          <div className="hidden xl:flex flex-shrink-0 justify-center" style={{ width: columnWidths.brightness }}>
            <SubjectiveBar value={brightness} />
          </div>
        )}

        {columnVisibility.noisiness && (
          <div className="hidden xl:flex flex-shrink-0 justify-center" style={{ width: columnWidths.noisiness }}>
            <SubjectiveBar value={noisiness} />
          </div>
        )}

        {columnVisibility.warmth && (
          <div className="hidden xl:flex flex-shrink-0 justify-center" style={{ width: columnWidths.warmth }}>
            <SubjectiveBar value={warmth} />
          </div>
        )}

        {columnVisibility.hardness && (
          <div className="hidden xl:flex flex-shrink-0 justify-center" style={{ width: columnWidths.hardness }}>
            <SubjectiveBar value={hardness} />
          </div>
        )}

        {columnVisibility.sharpness && (
          <div className="hidden xl:flex flex-shrink-0 justify-center" style={{ width: columnWidths.sharpness }}>
            <SubjectiveBar value={sharpness} />
          </div>
        )}

        {columnVisibility.loudness && (
          <div className="hidden xl:flex flex-shrink-0 justify-center" style={{ width: columnWidths.loudness }}>
            <span className="text-xs text-slate-400">{formatLoudness(sample.loudness)}</span>
          </div>
        )}

        {columnVisibility.sampleRate && (
          <div className="hidden xl:flex flex-shrink-0 justify-center" style={{ width: columnWidths.sampleRate }}>
            <span className="text-xs text-slate-400">{formatSampleRate(sample.sampleRate)}</span>
          </div>
        )}

        {columnVisibility.channels && (
          <div className="hidden xl:flex flex-shrink-0 justify-center" style={{ width: columnWidths.channels }}>
            <span className="text-xs text-slate-400">{sample.channels ?? '-'}</span>
          </div>
        )}

        {columnVisibility.format && (
          <div className="hidden xl:flex flex-shrink-0 justify-center" style={{ width: columnWidths.format }}>
            <span className="text-xs text-slate-400 uppercase">{sample.format || '-'}</span>
          </div>
        )}

        {columnVisibility.polyphony && (
          <div className="hidden xl:flex flex-shrink-0 justify-center" style={{ width: columnWidths.polyphony }}>
            <span className="text-xs text-slate-400">{sample.polyphony ?? '-'}</span>
          </div>
        )}

        {columnVisibility.dateAdded && (
          <div className="hidden xl:flex flex-shrink-0 justify-center" style={{ width: columnWidths.dateAdded }}>
            <span className="text-xs text-slate-400">{formatDate(sample.dateAdded || sample.createdAt)}</span>
          </div>
        )}

        {columnVisibility.dateCreated && (
          <div className="hidden xl:flex flex-shrink-0 justify-center" style={{ width: columnWidths.dateCreated }}>
            <span className="text-xs text-slate-400">{formatDate(sample.dateCreated)}</span>
          </div>
        )}

        {columnVisibility.dateModified && (
          <div className="hidden xl:flex flex-shrink-0 justify-center" style={{ width: columnWidths.dateModified }}>
            <span className="text-xs text-slate-400">{formatDate(sample.dateModified)}</span>
          </div>
        )}

        {columnVisibility.path && (
          <div className="hidden xl:flex flex-shrink-0 justify-start min-w-0" style={{ width: columnWidths.path }}>
            <span className="text-xs text-slate-400 truncate" title={sample.pathDisplay || sample.track.relativePath || sample.track.originalPath || '-'}>
              {sample.pathDisplay || sample.track.relativePath || sample.track.originalPath || '-'}
            </span>
          </div>
        )}

        <div className="flex-shrink-0 text-right" style={{ width: columnWidths.duration }}>
          <span className="text-xs text-slate-400">{formatDuration(sample.startTime, sample.endTime)}</span>
        </div>
      </div>

      {showPadPicker && (
        <DrumRackPadPicker
          sample={sample}
          onClose={() => setShowPadPicker(false)}
        />
      )}
    </div>
  )
}
