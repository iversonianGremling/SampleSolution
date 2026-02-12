import { useEffect, useMemo, useRef, useState } from 'react'
import { X, Plus, ChevronDown, Search, FolderPlus, Minus, FolderOpen } from 'lucide-react'
import type { Tag, Folder } from '../types'

interface SourcesTagFilterProps {
  selectedTags: number[]
  onTagsChange: (tagIds: number[]) => void
  selectedFolderIds?: number[]
  onSelectedFolderIdsChange?: (folderIds: number[]) => void
  excludedTags?: number[]
  onExcludedTagsChange?: (tagIds: number[]) => void
  allTags: Tag[]
  allFolders?: Folder[]
  excludedFolderIds?: number[]
  onExcludedFolderIdsChange?: (folderIds: number[]) => void
  onCreateTag?: (name: string, color: string) => void
  onCreateFolderFromTag?: (tagId: number, name: string, color: string) => void
  tagCounts?: Record<number, number>
  tagNameCounts?: Record<string, number>
  totalCount: number
  filteredCount: number
}

type PickerItem = {
  kind: 'tag' | 'folder'
  id: number
  name: string
  color?: string
}

const TAG_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6',
  '#3b82f6', '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e',
]

function scoreName(name: string, query: string): number {
  if (!query) return 1000
  const n = name.toLowerCase()
  const q = query.toLowerCase().trim()
  if (!q) return 1000
  if (n === q) return 0
  if (n.startsWith(q)) return 10 + (n.length - q.length)
  const idx = n.indexOf(q)
  if (idx >= 0) return 100 + idx + (n.length - q.length)
  return 9999
}

function sortByBestMatch<T extends { name: string }>(items: T[], query: string): T[] {
  const normalizeName = (value: unknown): string => (typeof value === 'string' ? value : '')

  if (!query.trim()) {
    return [...items].sort((a, b) => normalizeName(a.name).localeCompare(normalizeName(b.name)))
  }
  return [...items]
    .map(item => ({ item, score: scoreName(normalizeName(item.name), query) }))
    .filter(x => x.score < 9999)
    .sort((a, b) => a.score - b.score || normalizeName(a.item.name).localeCompare(normalizeName(b.item.name)))
    .map(x => x.item)
}

export function SourcesTagFilter({
  selectedTags,
  onTagsChange,
  selectedFolderIds = [],
  onSelectedFolderIdsChange,
  excludedTags = [],
  onExcludedTagsChange,
  allTags,
  allFolders = [],
  excludedFolderIds = [],
  onExcludedFolderIdsChange,
  onCreateTag,
  onCreateFolderFromTag,
  tagCounts,
  tagNameCounts,
  totalCount,
  filteredCount,
}: SourcesTagFilterProps) {
  const [isAddDropdownOpen, setIsAddDropdownOpen] = useState(false)
  const [isExcludeDropdownOpen, setIsExcludeDropdownOpen] = useState(false)
  const [addSearchQuery, setAddSearchQuery] = useState('')
  const [excludeSearchQuery, setExcludeSearchQuery] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [newTagName, setNewTagName] = useState('')
  const [newTagColor, setNewTagColor] = useState(TAG_COLORS[0])
  const [folderFromTagId, setFolderFromTagId] = useState<number | null>(null)
  const [folderFromTagName, setFolderFromTagName] = useState('')

  const containerRef = useRef<HTMLDivElement>(null)
  const folderPopoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsAddDropdownOpen(false)
        setIsExcludeDropdownOpen(false)
        setAddSearchQuery('')
        setExcludeSearchQuery('')
        setIsCreating(false)
      }
      if (folderPopoverRef.current && !folderPopoverRef.current.contains(e.target as Node)) {
        setFolderFromTagId(null)
        setFolderFromTagName('')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const selectedTagObjects = useMemo(
    () => allTags.filter(t => selectedTags.includes(t.id)),
    [allTags, selectedTags]
  )
  const selectedFolderObjects = useMemo(
    () => allFolders.filter(c => selectedFolderIds.includes(c.id)),
    [allFolders, selectedFolderIds]
  )
  const excludedTagObjects = useMemo(
    () => allTags.filter(t => excludedTags.includes(t.id)),
    [allTags, excludedTags]
  )
  const excludedFolderObjects = useMemo(
    () => allFolders.filter(c => excludedFolderIds.includes(c.id)),
    [allFolders, excludedFolderIds]
  )

  const addCandidates = useMemo(() => {
    const tags: PickerItem[] = allTags
      .filter(t => !selectedTags.includes(t.id))
      .map(t => ({ kind: 'tag', id: t.id, name: t.name, color: t.color }))

    const folders: PickerItem[] = onSelectedFolderIdsChange
      ? allFolders
          .filter(c => !selectedFolderIds.includes(c.id))
          .map(c => ({ kind: 'folder', id: c.id, name: c.name, color: c.color }))
      : []

    return sortByBestMatch([...tags, ...folders], addSearchQuery)
  }, [allTags, allFolders, selectedTags, selectedFolderIds, onSelectedFolderIdsChange, addSearchQuery])

  const excludeCandidates = useMemo(() => {
    const tags: PickerItem[] = allTags
      .filter(t => !excludedTags.includes(t.id))
      .map(t => ({ kind: 'tag', id: t.id, name: t.name, color: t.color }))

    const folders: PickerItem[] = allFolders
      .filter(c => !excludedFolderIds.includes(c.id))
      .map(c => ({ kind: 'folder', id: c.id, name: c.name, color: c.color }))

    return sortByBestMatch([...tags, ...folders], excludeSearchQuery)
  }, [allTags, allFolders, excludedTags, excludedFolderIds, excludeSearchQuery])

  const handleToggleTag = (tagId: number) => {
    onTagsChange(
      selectedTags.includes(tagId)
        ? selectedTags.filter(id => id !== tagId)
        : [...selectedTags, tagId]
    )
  }

  const handleToggleFolder = (folderId: number) => {
    if (!onSelectedFolderIdsChange) return
    onSelectedFolderIdsChange(
      selectedFolderIds.includes(folderId)
        ? selectedFolderIds.filter(id => id !== folderId)
        : [...selectedFolderIds, folderId]
    )
  }

  const handleToggleExcludedTag = (tagId: number) => {
    if (!onExcludedTagsChange) return
    onExcludedTagsChange(
      excludedTags.includes(tagId)
        ? excludedTags.filter(id => id !== tagId)
        : [...excludedTags, tagId]
    )
  }

  const handleToggleExcludedFolder = (folderId: number) => {
    if (!onExcludedFolderIdsChange) return
    onExcludedFolderIdsChange(
      excludedFolderIds.includes(folderId)
        ? excludedFolderIds.filter(id => id !== folderId)
        : [...excludedFolderIds, folderId]
    )
  }

  const handleCreateTag = () => {
    if (!newTagName.trim() || !onCreateTag) return
    onCreateTag(newTagName.trim().toLowerCase(), newTagColor)
    setNewTagName('')
    setNewTagColor(TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)])
    setIsCreating(false)
  }

  const getTagCount = (tag: Tag) => {
    const byId = tagCounts?.[tag.id]
    if (typeof byId === 'number' && byId > 0) return byId
    return tagNameCounts?.[tag.name.toLowerCase()] ?? 0
  }

  const renderItemIcon = (item: PickerItem) => {
    if (item.kind === 'tag') {
      return <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: item.color }} />
    }
    return <FolderOpen size={13} className="text-slate-500" />
  }

  const hasAnySelection =
    selectedTags.length > 0 ||
    selectedFolderIds.length > 0 ||
    excludedTags.length > 0 ||
    excludedFolderIds.length > 0

  return (
    <div ref={containerRef} className="flex items-center gap-2 flex-wrap">
      <span className="text-sm text-slate-400">
        Showing <span className="text-white font-medium">{filteredCount}</span>
        {filteredCount !== totalCount && (
          <> of <span className="text-slate-300">{totalCount}</span></>
        )} samples
      </span>

      <div className="h-4 w-px bg-surface-border mx-2" />

      {selectedTagObjects.map(tag => (
        <span
          key={`selected-tag-${tag.id}`}
          className="relative inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors"
          style={{ backgroundColor: `${tag.color}25`, color: tag.color }}
        >
          {tag.name}
          <span className="text-[10px] text-slate-400">{getTagCount(tag)}</span>
          {onCreateFolderFromTag && (
            <button
              onClick={() => {
                setFolderFromTagId(tag.id)
                setFolderFromTagName(tag.name)
              }}
              className="hover:opacity-70 transition-opacity"
              title="Turn into folder"
            >
              <FolderPlus size={12} />
            </button>
          )}
          <button onClick={() => handleToggleTag(tag.id)} className="hover:opacity-70 transition-opacity">
            <X size={12} />
          </button>

          {folderFromTagId === tag.id && (
            <div
              ref={folderPopoverRef}
              className="absolute left-0 top-full mt-1 z-30 w-52 p-2 bg-surface-raised border border-surface-border rounded-lg shadow-xl space-y-2"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-xs text-slate-400 font-medium">Turn tag into folder</div>
              <input
                type="text"
                value={folderFromTagName}
                onChange={(e) => setFolderFromTagName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && folderFromTagName.trim()) {
                    onCreateFolderFromTag!(tag.id, folderFromTagName.trim(), tag.color)
                    setFolderFromTagId(null)
                    setFolderFromTagName('')
                  }
                  if (e.key === 'Escape') {
                    setFolderFromTagId(null)
                    setFolderFromTagName('')
                  }
                }}
                placeholder="Folder name..."
                className="w-full px-2 py-1.5 text-sm bg-surface-base border border-surface-border rounded text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary"
                autoFocus
              />
              <div className="flex gap-1">
                <button
                  onClick={() => {
                    if (folderFromTagName.trim()) {
                      onCreateFolderFromTag!(tag.id, folderFromTagName.trim(), tag.color)
                      setFolderFromTagId(null)
                      setFolderFromTagName('')
                    }
                  }}
                  disabled={!folderFromTagName.trim()}
                  className="flex-1 px-2 py-1 text-xs bg-accent-primary text-white rounded hover:bg-accent-primary/80 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Create
                </button>
                <button
                  onClick={() => {
                    setFolderFromTagId(null)
                    setFolderFromTagName('')
                  }}
                  className="px-2 py-1 text-xs bg-slate-700 text-slate-300 rounded hover:bg-slate-600"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </span>
      ))}

      {selectedFolderObjects.map(folder => (
        <span
          key={`selected-folder-${folder.id}`}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-surface-raised border border-surface-border text-slate-300"
        >
          <FolderOpen size={12} className="text-slate-500" />
          {folder.name}
          <button onClick={() => handleToggleFolder(folder.id)} className="hover:text-white transition-colors">
            <X size={12} />
          </button>
        </span>
      ))}

      {excludedTagObjects.map(tag => (
        <span
          key={`excluded-tag-${tag.id}`}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border"
          style={{
            backgroundColor: 'rgba(239, 68, 68, 0.12)',
            color: '#fca5a5',
            borderColor: 'rgba(239, 68, 68, 0.35)',
          }}
        >
          <Minus size={12} />
          {tag.name}
          <span className="text-[10px] text-slate-400">{getTagCount(tag)}</span>
          <button onClick={() => handleToggleExcludedTag(tag.id)} className="hover:opacity-70 transition-opacity">
            <X size={12} />
          </button>
        </span>
      ))}

      {excludedFolderObjects.map(folder => (
        <span
          key={`excluded-folder-${folder.id}`}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border"
          style={{
            backgroundColor: 'rgba(239, 68, 68, 0.12)',
            color: '#fca5a5',
            borderColor: 'rgba(239, 68, 68, 0.35)',
          }}
        >
          <FolderOpen size={12} />
          {folder.name}
          <button onClick={() => handleToggleExcludedFolder(folder.id)} className="hover:opacity-70 transition-opacity">
            <X size={12} />
          </button>
        </span>
      ))}

      <div className="relative">
        <button
          onClick={() => {
            setIsAddDropdownOpen(v => !v)
            setIsExcludeDropdownOpen(false)
          }}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-surface-raised text-slate-400 hover:text-slate-300 hover:bg-surface-base transition-colors"
        >
          <Plus size={12} />
          Add
          <ChevronDown size={10} className={`transition-transform ${isAddDropdownOpen ? 'rotate-180' : ''}`} />
        </button>

        {isAddDropdownOpen && (
          <div className="absolute top-full mt-1 left-0 z-30 w-64 bg-surface-raised border border-surface-border rounded-lg shadow-xl overflow-hidden">
            <div className="p-2 border-b border-surface-border">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
                <input
                  type="text"
                  value={addSearchQuery}
                  onChange={(e) => setAddSearchQuery(e.target.value)}
                  placeholder="Search tags/folders..."
                  className="w-full pl-7 pr-2 py-1.5 text-sm bg-surface-base border border-surface-border rounded text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary"
                  autoFocus
                />
              </div>
            </div>

            {addCandidates.length > 0 ? (
              <div className="max-h-56 overflow-y-auto">
                {addCandidates.map(item => (
                  <button
                    key={`add-${item.kind}-${item.id}`}
                    onClick={() => {
                      if (item.kind === 'tag') handleToggleTag(item.id)
                      else handleToggleFolder(item.id)
                      setIsAddDropdownOpen(false)
                      setAddSearchQuery('')
                    }}
                    className="w-full px-3 py-2 text-left text-sm transition-colors hover:bg-surface-base flex items-center gap-2"
                  >
                    {renderItemIcon(item)}
                    <span className="truncate" style={item.kind === 'tag' ? { color: item.color } : undefined}>
                      {item.name}
                    </span>
                    {item.kind === 'tag' && (
                      <span className="text-[10px] text-slate-500">
                        {getTagCount({ id: item.id, name: item.name, color: item.color || '#6366f1' })}
                      </span>
                    )}
                    <span className="ml-auto text-[10px] uppercase tracking-wide text-slate-500">
                      {item.kind === 'tag' ? 'tag' : 'folder'}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="px-3 py-2 text-sm text-slate-500">No matches</div>
            )}

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

      {(onExcludedTagsChange || onExcludedFolderIdsChange) && (
        <div className="relative">
          <button
            onClick={() => {
              setIsExcludeDropdownOpen(v => !v)
              setIsAddDropdownOpen(false)
            }}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium hover:bg-red-500/20 transition-colors"
          >
            <Minus size={12} />
            Exclude
            <ChevronDown size={10} className={`transition-transform ${isExcludeDropdownOpen ? 'rotate-180' : ''}`} />
          </button>

          {isExcludeDropdownOpen && (
            <div className="absolute top-full mt-1 left-0 z-30 w-64 bg-surface-raised border border-surface-border rounded-lg shadow-xl overflow-hidden">
              <div className="p-2 border-b border-surface-border">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
                  <input
                    type="text"
                    value={excludeSearchQuery}
                    onChange={(e) => setExcludeSearchQuery(e.target.value)}
                    placeholder="Search tags/folders..."
                    className="w-full pl-7 pr-2 py-1.5 text-sm bg-surface-base border border-surface-border rounded text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary"
                    autoFocus
                  />
                </div>
              </div>

              {excludeCandidates.length > 0 ? (
                <div className="max-h-56 overflow-y-auto">
                  {excludeCandidates.map(item => (
                    <button
                      key={`exclude-${item.kind}-${item.id}`}
                      onClick={() => {
                        if (item.kind === 'tag') handleToggleExcludedTag(item.id)
                        else handleToggleExcludedFolder(item.id)
                        setIsExcludeDropdownOpen(false)
                        setExcludeSearchQuery('')
                      }}
                      className="w-full px-3 py-2 text-left text-sm transition-colors hover:bg-surface-base flex items-center gap-2"
                    >
                      {renderItemIcon(item)}
                      <span className="truncate" style={item.kind === 'tag' ? { color: item.color } : undefined}>
                        {item.name}
                      </span>
                      {item.kind === 'tag' && (
                        <span className="text-[10px] text-slate-500">
                          {getTagCount({ id: item.id, name: item.name, color: item.color || '#6366f1' })}
                        </span>
                      )}
                      <span className="ml-auto text-[10px] uppercase tracking-wide text-slate-500">
                        {item.kind === 'tag' ? 'tag' : 'folder'}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="px-3 py-2 text-sm text-slate-500">No matches</div>
              )}
            </div>
          )}
        </div>
      )}

      {hasAnySelection && (
        <button
          onClick={() => {
            onTagsChange([])
            onSelectedFolderIdsChange?.([])
            onExcludedTagsChange?.([])
            onExcludedFolderIdsChange?.([])
          }}
          className="text-xs text-slate-400 hover:text-slate-300 transition-colors"
        >
          Clear all
        </button>
      )}
    </div>
  )
}
