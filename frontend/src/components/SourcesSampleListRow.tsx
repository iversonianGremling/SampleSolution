import { useState, useRef, useEffect } from 'react'
import { Play, Pause, Heart, Trash2, Pencil } from 'lucide-react'
import { CustomCheckbox } from './CustomCheckbox'
import type { SliceWithTrackExtended } from '../types'

export type PlayMode = 'normal' | 'one-shot' | 'reproduce-while-clicking'

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
}: SourcesSampleListRowProps) {
  const [isEditingName, setIsEditingName] = useState(false)
  const [editingName, setEditingName] = useState(sample.name)
  const [showTagsPopup, setShowTagsPopup] = useState(false)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const tagTriggerRef = useRef<HTMLDivElement>(null)
  const closeTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    if (isEditingName && nameInputRef.current) {
      nameInputRef.current.focus()
      nameInputRef.current.select()
    }
  }, [isEditingName])

  const saveName = () => {
    if (editingName.trim() && editingName !== sample.name) {
      onUpdateName(editingName.trim())
    }
    setIsEditingName(false)
  }

  const formatDuration = (startTime: number, endTime: number) => {
    const dur = endTime - startTime
    if (dur < 60) {
      return `${dur.toFixed(1)}s`
    }
    const mins = Math.floor(dur / 60)
    const secs = Math.floor(dur % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const maxVisibleTags = 3
  const visibleTags = sample.tags.slice(0, maxVisibleTags)
  const remainingTags = sample.tags.length - maxVisibleTags

  const handleTagPopupOpen = () => {
    // Clear any pending close timeout
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current)
      closeTimeoutRef.current = null
    }
    setShowTagsPopup(true)
  }

  const handleTagPopupClose = () => {
    // Add a small delay before closing to make it easier to move mouse to popup
    closeTimeoutRef.current = setTimeout(() => {
      setShowTagsPopup(false)
    }, 150)
  }

  const handleTagPopupEnter = () => {
    // Cancel close if mouse enters popup
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current)
      closeTimeoutRef.current = null
    }
    setShowTagsPopup(true)
  }

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
    >
      {/* Main row */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Checkbox */}
        <CustomCheckbox
          checked={isChecked}
          onChange={(e) => {
            e.stopPropagation()
            onToggleCheck()
          }}
          onClick={(e) => e.stopPropagation()}
          className="flex-shrink-0"
        />

        {/* Play button */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            if (playMode !== 'reproduce-while-clicking') {
              onPlay(e)
            }
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

        {/* Sample name (editable) */}
        <div className="flex-1 min-w-0 pl-1">
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
              <span className="font-medium text-white text-sm truncate">
                {sample.name}
              </span>
              <Pencil size={12} className="text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
            </div>
          )}
        </div>

        {/* Tags (hidden on small screens) */}
        <div className="hidden sm:flex items-center gap-1 flex-shrink-0 pl-1">
          {visibleTags.map((tag) => (
            <span
              key={tag.id}
              onClick={(e) => {
                if (onTagClick) {
                  e.stopPropagation()
                  onTagClick(tag.id)
                }
              }}
              className={`px-1.5 py-0.5 text-[10px] rounded-full flex-shrink-0 ${onTagClick ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
              style={{
                backgroundColor: tag.color + '25',
                color: tag.color,
              }}
              title={onTagClick ? `Filter by ${tag.name}` : tag.name}
            >
              {tag.name.length > 10 ? tag.name.slice(0, 10) + '…' : tag.name}
            </span>
          ))}
          {remainingTags > 0 && (
            <div
              ref={tagTriggerRef}
              className="relative flex-shrink-0"
              onMouseEnter={handleTagPopupOpen}
              onMouseLeave={handleTagPopupClose}
            >
              <span className="text-[10px] text-slate-500 cursor-default">
                +{remainingTags}
              </span>
              {showTagsPopup && (
                <div
                  className="absolute left-full ml-2 top-1/2 bg-surface-raised border border-surface-border rounded-lg shadow-lg py-1 px-2"
                  style={{
                    zIndex: 9999,
                    transform: 'translateY(-50%)'
                  }}
                  onClick={(e) => e.stopPropagation()}
                  onMouseEnter={handleTagPopupEnter}
                  onMouseLeave={handleTagPopupClose}
                >
                  <div
                    className="gap-1"
                    style={{
                      display: remainingTags > 2 ? 'grid' : 'flex',
                      flexDirection: remainingTags <= 2 ? 'column' : undefined,
                      gridTemplateRows: remainingTags > 2 ? 'repeat(2, auto)' : undefined,
                      gridAutoFlow: remainingTags > 2 ? 'column' : undefined
                    }}
                  >
                    {sample.tags.slice(maxVisibleTags).map((tag) => (
                      <span
                        key={tag.id}
                        onClick={(e) => {
                          if (onTagClick) {
                            e.stopPropagation()
                            onTagClick(tag.id)
                            setShowTagsPopup(false)
                            if (closeTimeoutRef.current) {
                              clearTimeout(closeTimeoutRef.current)
                              closeTimeoutRef.current = null
                            }
                          }
                        }}
                        className={`px-1.5 py-0.5 text-[10px] rounded-full whitespace-nowrap ${onTagClick ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
                        style={{
                          backgroundColor: tag.color + '25',
                          color: tag.color,
                        }}
                        title={onTagClick ? `Filter by ${tag.name}` : tag.name}
                      >
                        {tag.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* BPM (hidden on small screens) */}
        <div className="hidden md:flex w-14 flex-shrink-0 justify-end">
          <span className="text-xs text-slate-400">
            {sample.bpm ? Math.round(sample.bpm) : '-'}
          </span>
        </div>

        {/* Key (hidden on small screens) */}
        <div className="hidden lg:flex w-16 flex-shrink-0 justify-center">
          <span className="text-xs text-slate-400">
            {sample.keyEstimate || '-'}
          </span>
        </div>

        {/* Envelope Type (hidden on small screens) */}
        <div className="hidden xl:flex w-20 flex-shrink-0 justify-center">
          <span className="text-xs text-slate-400 capitalize">
            {sample.envelopeType || '-'}
          </span>
        </div>

        {/* Duration */}
        <div className="w-16 sm:w-20 flex-shrink-0 text-right">
          <span className="text-xs text-slate-400">
            {formatDuration(sample.startTime, sample.endTime)}
          </span>
        </div>

        {/* Actions */}
        <div className="w-12 sm:w-16 flex-shrink-0 flex items-center justify-end gap-0.5 sm:gap-1">
          {/* Favorite button */}
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

          {/* Delete button */}
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
    </div>
  )
}
