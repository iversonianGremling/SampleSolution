import { useState, useRef, useEffect, useMemo } from 'react'
import { Plus, Loader2 } from 'lucide-react'
import type { Tag } from '../types'

const PRESET_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308',
  '#84cc16', '#22c55e', '#10b981', '#14b8a6',
  '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1',
  '#8b5cf6', '#a855f7', '#d946ef', '#ec4899',
]

const getColorForName = (name: string): string => {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return PRESET_COLORS[Math.abs(hash) % PRESET_COLORS.length]
}

interface TagSearchInputProps {
  availableTags: Tag[]
  onAddTag: (tagId: number) => void
  onCreateTag: (name: string, color: string) => Promise<void>
  isCreatingTag?: boolean
  placeholder?: string
  className?: string
}

export function TagSearchInput({
  availableTags,
  onAddTag,
  onCreateTag,
  isCreatingTag = false,
  placeholder = 'Add instrument...',
  className = '',
}: TagSearchInputProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(0)

  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Filter tags based on search
  const filteredTags = useMemo(() => {
    if (!searchQuery.trim()) return availableTags
    return availableTags.filter(tag =>
      tag.name.toLowerCase().includes(searchQuery.toLowerCase())
    )
  }, [availableTags, searchQuery])

  // Check if we can create a new tag
  const exactMatch = availableTags.some(
    tag => tag.name.toLowerCase() === searchQuery.toLowerCase().trim()
  )
  const canCreateNew = searchQuery.trim().length > 0 && !exactMatch

  // Total selectable items (create option + filtered tags)
  const totalItems = (canCreateNew ? 1 : 0) + filteredTags.length

  // Click outside handler
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
        setSearchQuery('')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Reset highlight when filtered results change
  useEffect(() => {
    setHighlightedIndex(0)
  }, [filteredTags.length, canCreateNew])

  const handleSelect = async (index: number) => {
    if (canCreateNew && index === 0) {
      // Create new tag
      const name = searchQuery.trim()
      const color = getColorForName(name)
      await onCreateTag(name, color)
      setSearchQuery('')
      setIsOpen(false)
    } else {
      // Select existing tag
      const tagIndex = canCreateNew ? index - 1 : index
      const tag = filteredTags[tagIndex]
      if (tag) {
        onAddTag(tag.id)
        setSearchQuery('')
        setIsOpen(false)
      }
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen || totalItems === 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        setIsOpen(true)
        e.preventDefault()
      }
      return
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setHighlightedIndex(prev => (prev + 1) % totalItems)
        break
      case 'ArrowUp':
        e.preventDefault()
        setHighlightedIndex(prev => (prev - 1 + totalItems) % totalItems)
        break
      case 'Enter':
        e.preventDefault()
        handleSelect(highlightedIndex)
        break
      case 'Escape':
        e.preventDefault()
        setIsOpen(false)
        setSearchQuery('')
        inputRef.current?.blur()
        break
    }
  }

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      {/* Upward dropdown */}
      {isOpen && totalItems > 0 && (
        <div className="absolute bottom-full mb-1 left-0 z-20 w-48 max-h-48 overflow-y-auto bg-gray-800 border border-gray-700 rounded-lg shadow-xl">
          {/* Create new tag option */}
          {canCreateNew && (
            <button
              onClick={() => handleSelect(0)}
              disabled={isCreatingTag}
              className={`w-full px-3 py-2 text-left text-sm transition-colors flex items-center gap-2 ${
                highlightedIndex === 0 ? 'bg-gray-700' : 'hover:bg-gray-700'
              }`}
            >
              {isCreatingTag ? (
                <Loader2 className="animate-spin" size={12} />
              ) : (
                <Plus size={12} />
              )}
              <span className="text-indigo-400">
                Create "{searchQuery.trim()}"
              </span>
            </button>
          )}

          {/* Existing tags */}
          {filteredTags.map((tag, index) => {
            const itemIndex = canCreateNew ? index + 1 : index
            return (
              <button
                key={tag.id}
                onClick={() => handleSelect(itemIndex)}
                className={`w-full px-3 py-2 text-left text-sm transition-colors flex items-center gap-2 ${
                  highlightedIndex === itemIndex ? 'bg-gray-700' : 'hover:bg-gray-700'
                }`}
              >
                <span
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{ backgroundColor: tag.color }}
                />
                <span style={{ color: tag.color }}>{tag.name}</span>
              </button>
            )
          })}

          {/* Empty state */}
          {filteredTags.length === 0 && !canCreateNew && (
            <div className="px-3 py-2 text-sm text-gray-500">
              No matching instruments
            </div>
          )}
        </div>
      )}

      {/* Search input */}
      <input
        ref={inputRef}
        type="text"
        value={searchQuery}
        onChange={(e) => {
          setSearchQuery(e.target.value)
          setIsOpen(true)
        }}
        onFocus={() => setIsOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="w-20 px-2 py-0.5 text-xs bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition-colors"
      />
    </div>
  )
}
