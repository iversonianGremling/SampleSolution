import { useState, useRef, useEffect } from 'react'
import { Play, Pause, Heart, Trash2, Pencil, Disc3 } from 'lucide-react'
import { CustomCheckbox } from './CustomCheckbox'
import { InstrumentIcon } from './InstrumentIcon'
import { DrumRackPadPicker } from './DrumRackPadPicker'
import type { SliceWithTrackExtended } from '../types'
import { freqToNoteName } from '../utils/musicTheory'

export type PlayMode = 'normal' | 'one-shot' | 'reproduce-while-clicking'

export type SourcesListColumnWidthKey =
  | 'name'
  | 'tags'
  | 'artist'
  | 'album'
  | 'year'
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
  actions: 96,
}

export interface SourcesListColumnVisibility {
  tags: boolean
  artist: boolean
  album: boolean
  year: boolean
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
  showSimilarity?: boolean
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

function SubjectiveBar({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) {
    return <span className="text-xs text-slate-500">-</span>
  }

  const percent = Math.round(Math.max(0, Math.min(1, value)) * 100)
  return (
    <div className="w-16 h-2 rounded-full bg-surface-base border border-surface-border overflow-hidden" title={`${percent}%`}>
      <div className="h-full bg-accent-primary" style={{ width: `${percent}%` }} />
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
  showSimilarity = false,
}: SourcesSampleListRowProps) {
  const [isEditingName, setIsEditingName] = useState(false)
  const [editingName, setEditingName] = useState(sample.name)
  const [showTagsPopup, setShowTagsPopup] = useState(false)
  const [showPadPicker, setShowPadPicker] = useState(false)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  const saveName = () => {
    if (editingName.trim() && editingName !== sample.name) {
      onUpdateName(editingName.trim())
    }
    setIsEditingName(false)
  }

  const maxVisibleTags = 1
  const visibleTags = sample.tags.slice(0, maxVisibleTags)
  const remainingTags = sample.tags.length - maxVisibleTags

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

  return (
    <div
      onClick={onSelect}
      draggable={!!onDragStart}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`px-4 py-2 cursor-pointer transition-colors border-l-2 ${
        isSelected
          ? 'bg-accent-primary/10 border-accent-primary ring-2 ring-accent-primary/40'
          : isChecked
          ? 'bg-accent-primary/20 border-accent-primary/50'
          : 'hover:bg-surface-base border-transparent'
      }`}
      style={minWidth ? { minWidth } : undefined}
    >
      <div className="flex items-center gap-2 sm:gap-3">
        <CustomCheckbox
          checked={isChecked}
          onChange={(e) => {
            e.stopPropagation()
            onToggleCheck()
          }}
          onClick={(e) => e.stopPropagation()}
          className="flex-shrink-0"
        />

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
          className={`p-1 sm:p-1.5 rounded transition-colors flex-shrink-0 ${
            isPlaying
              ? 'bg-accent-primary text-white'
              : 'text-slate-400 hover:text-accent-primary hover:bg-surface-base'
          }`}
          title={isPlaying && playMode === 'normal' ? 'Pause' : 'Play'}
        >
          {isPlaying && playMode === 'normal' ? <Pause size={16} /> : <Play size={16} />}
        </button>

        <div className="w-4 flex-shrink-0 text-slate-400" title={sample.instrumentType || sample.instrumentPrimary || ''}>
          {(sample.instrumentType || sample.instrumentPrimary) && (
            <InstrumentIcon type={sample.instrumentType || sample.instrumentPrimary || 'other'} size={14} />
          )}
        </div>

        {showSimilarity && (
          <div className="flex flex-shrink-0 items-center justify-center" style={{ width: columnWidths.similarity }}>
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

        <div className="flex-shrink-0 min-w-0 pl-1" style={{ width: columnWidths.name }}>
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
              className="group flex items-center gap-2"
              onDoubleClick={(e) => {
                e.stopPropagation()
                setEditingName(sample.name)
                setIsEditingName(true)
              }}
            >
              <div className="min-w-0">
                <span className="font-medium text-white text-sm truncate block">{sample.name}</span>
                {sample.track.artist && !columnVisibility.artist && (
                  <span className="text-[10px] text-slate-500 truncate block">{sample.track.artist}</span>
                )}
              </div>
              <Pencil size={12} className="text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
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
                className={`inline-flex max-w-full items-center px-1.5 py-0 text-[10px] rounded-full min-w-0 ${onTagClick ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
                style={{
                  backgroundColor: tag.color + '25',
                  color: tag.color,
                }}
                title={onTagClick ? `Filter by ${tag.name}` : tag.name}
              >
                <span className="truncate">{tag.name}</span>
              </span>
            ))}

            {remainingTags > 0 && (
              <div
                className="relative flex-shrink-0"
                onMouseEnter={handleTagPopupOpen}
                onMouseLeave={handleTagPopupClose}
              >
                <span className="text-[10px] text-slate-500 cursor-default">+{remainingTags}</span>
                {showTagsPopup && (
                  <div
                    className="absolute right-0 top-full mt-1 bg-surface-raised border border-surface-border rounded-lg shadow-lg py-1 px-2 z-[60]"
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
                          className={`inline-flex max-w-40 items-center px-1.5 py-0 text-[10px] rounded-full whitespace-nowrap ${onTagClick ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
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
                  </div>
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

        {columnVisibility.bpm && (
          <div className="hidden md:flex flex-shrink-0 justify-end" style={{ width: columnWidths.bpm }}>
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

        <div className="flex-shrink-0 flex items-center justify-end gap-0.5 sm:gap-1" style={{ width: columnWidths.actions }}>
          <button
            onClick={(e) => {
              e.stopPropagation()
              setShowPadPicker(true)
            }}
            className="p-1 sm:p-1.5 rounded text-slate-400 hover:text-accent-primary hover:bg-accent-primary/20 transition-colors flex-shrink-0"
            title="Send to Drum Rack"
          >
            <Disc3 size={14} />
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation()
              onToggleFavorite()
            }}
            className={`p-1 sm:p-1.5 rounded transition-colors flex-shrink-0 ${
              sample.favorite
                ? 'text-amber-400 bg-amber-400/20'
                : 'text-slate-400 hover:text-amber-400 hover:bg-amber-400/20'
            }`}
            title={sample.favorite ? 'Remove from favorites' : 'Add to favorites'}
          >
            <Heart size={14} className={sample.favorite ? 'fill-current' : ''} />
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
            className="p-1 sm:p-1.5 rounded text-slate-400 hover:text-red-400 hover:bg-red-400/20 transition-colors flex-shrink-0"
            title="Delete"
          >
            <Trash2 size={14} />
          </button>
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
