import { useState, useRef, useEffect } from 'react'
import { X, Plus, ChevronDown, Search } from 'lucide-react'
import type { Tag } from '../types'

interface SourcesTagFilterProps {
  selectedTags: number[]
  onTagsChange: (tagIds: number[]) => void
  allTags: Tag[]
  onCreateTag?: (name: string, color: string) => void
  totalCount: number
  filteredCount: number
}

// Preset colors for new tags
const TAG_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6',
  '#3b82f6', '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e',
]

export function SourcesTagFilter({
  selectedTags,
  onTagsChange,
  allTags,
  onCreateTag,
  totalCount,
  filteredCount,
}: SourcesTagFilterProps) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [newTagName, setNewTagName] = useState('')
  const [newTagColor, setNewTagColor] = useState(TAG_COLORS[0])
  const containerRef = useRef<HTMLDivElement>(null)

  // Click outside handler
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false)
        setSearchQuery('')
        setIsCreating(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const selectedTagObjects = allTags.filter(t => selectedTags.includes(t.id))
  const availableTags = allTags.filter(t => !selectedTags.includes(t.id))
  const filteredTags = availableTags.filter(t =>
    t.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const handleToggleTag = (tagId: number) => {
    if (selectedTags.includes(tagId)) {
      onTagsChange(selectedTags.filter(id => id !== tagId))
    } else {
      onTagsChange([...selectedTags, tagId])
    }
  }

  const handleCreateTag = () => {
    if (newTagName.trim() && onCreateTag) {
      onCreateTag(newTagName.trim().toLowerCase(), newTagColor)
      setNewTagName('')
      setNewTagColor(TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)])
      setIsCreating(false)
    }
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Count display */}
      <span className="text-sm text-slate-400">
        Showing <span className="text-white font-medium">{filteredCount}</span>
        {filteredCount !== totalCount && (
          <> of <span className="text-slate-300">{totalCount}</span></>
        )} samples
      </span>

      {/* Separator */}
      <div className="h-4 w-px bg-surface-border mx-2" />

      {/* Selected tags */}
      {selectedTagObjects.map(tag => (
        <span
          key={tag.id}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors"
          style={{
            backgroundColor: tag.color + '25',
            color: tag.color,
          }}
        >
          {tag.name}
          <button
            onClick={() => handleToggleTag(tag.id)}
            className="hover:opacity-70 transition-opacity"
          >
            <X size={12} />
          </button>
        </span>
      ))}

      {/* Add tag dropdown */}
      <div className="relative" ref={containerRef}>
        <button
          onClick={() => setIsDropdownOpen(!isDropdownOpen)}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-surface-raised text-slate-400 hover:text-slate-300 hover:bg-surface-base transition-colors"
        >
          <Plus size={12} />
          Add tag
          <ChevronDown size={10} className={`transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} />
        </button>

        {isDropdownOpen && (
          <div className="absolute top-full mt-1 left-0 z-30 w-56 bg-surface-raised border border-surface-border rounded-lg shadow-xl overflow-hidden">
            {/* Search input */}
            <div className="p-2 border-b border-surface-border">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search tags..."
                  className="w-full pl-7 pr-2 py-1.5 text-sm bg-surface-base border border-surface-border rounded text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary"
                  autoFocus
                />
              </div>
            </div>

            {/* Tag list */}
            {filteredTags.length > 0 && (
              <div className="max-h-48 overflow-y-auto">
                {filteredTags.map(tag => (
                  <button
                    key={tag.id}
                    onClick={() => {
                      handleToggleTag(tag.id)
                      setIsDropdownOpen(false)
                      setSearchQuery('')
                    }}
                    className="w-full px-3 py-2 text-left text-sm transition-colors hover:bg-surface-base flex items-center gap-2"
                  >
                    <span
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: tag.color }}
                    />
                    <span style={{ color: tag.color }}>{tag.name}</span>
                  </button>
                ))}
              </div>
            )}

            {/* No results */}
            {filteredTags.length === 0 && searchQuery && !isCreating && (
              <div className="px-3 py-2 text-sm text-slate-500">
                No tags found
              </div>
            )}

            {/* Create new tag */}
            {onCreateTag && (
              <>
                <div className="border-t border-surface-border" />
                {isCreating ? (
                  <div className="p-2 space-y-2">
                    <input
                      type="text"
                      value={newTagName}
                      onChange={(e) => setNewTagName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleCreateTag()
                        if (e.key === 'Escape') {
                          setIsCreating(false)
                          setNewTagName('')
                        }
                      }}
                      placeholder="Tag name..."
                      className="w-full px-2 py-1.5 text-sm bg-surface-base border border-surface-border rounded text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary"
                      autoFocus
                    />
                    <div className="flex flex-wrap gap-1">
                      {TAG_COLORS.map(color => (
                        <button
                          key={color}
                          onClick={() => setNewTagColor(color)}
                          className={`w-5 h-5 rounded-full transition-transform ${
                            newTagColor === color ? 'ring-2 ring-white ring-offset-1 ring-offset-surface-raised scale-110' : ''
                          }`}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={handleCreateTag}
                        disabled={!newTagName.trim()}
                        className="flex-1 px-2 py-1 text-xs bg-accent-primary text-white rounded hover:bg-accent-primary/80 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Create
                      </button>
                      <button
                        onClick={() => {
                          setIsCreating(false)
                          setNewTagName('')
                        }}
                        className="px-2 py-1 text-xs bg-slate-700 text-slate-300 rounded hover:bg-slate-600"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setIsCreating(true)}
                    className="w-full px-3 py-2 text-left text-sm text-slate-400 hover:bg-surface-base flex items-center gap-2"
                  >
                    <Plus size={14} />
                    Create new tag...
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Clear all button */}
      {selectedTags.length > 0 && (
        <button
          onClick={() => onTagsChange([])}
          className="text-xs text-slate-400 hover:text-slate-300 transition-colors"
        >
          Clear all
        </button>
      )}
    </div>
  )
}
