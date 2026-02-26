import { useEffect, useMemo, useRef, useState } from 'react'
import { X, Plus, ChevronDown, Search, FolderPlus, Minus, FolderOpen, AlertTriangle } from 'lucide-react'
import type { Tag, Folder } from '../types'
import {
  createDefaultFilterRule,
  FILTER_RULE_FIELDS,
  FILTER_RULE_NUMERIC_OPERATORS,
  FILTER_RULE_TEXT_OPERATORS,
  getFilterRuleField,
  getDefaultOperatorForField,
  isFilterRuleNumericField,
  normalizeOperatorForField,
  type FilterRule,
  type FilterRuleFieldId,
  type FilterRuleOperator,
} from '../utils/filterRuleQuery'

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
  showCategories?: boolean
  scopeLabel?: string
  scopeTypeLabel?: string
  compactMode?: boolean
  queryRules?: FilterRule[]
  onQueryRulesChange?: (rules: FilterRule[]) => void
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

function summarizeNames(names: string[], fallback: string): string {
  if (names.length === 0) return fallback
  if (names.length <= 3) return names.join(', ')
  return `${names.slice(0, 3).join(', ')} +${names.length - 3} more`
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
  showCategories = false,
  scopeLabel,
  scopeTypeLabel = 'scope',
  compactMode = false,
  queryRules = [],
  onQueryRulesChange,
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
  const showExcludeBuilder = Boolean(onExcludedTagsChange || onExcludedFolderIdsChange)
  const showRuleBuilder = Boolean(onQueryRulesChange)

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
    const tags: PickerItem[] = onExcludedTagsChange
      ? allTags
          .filter(t => !excludedTags.includes(t.id))
          .map(t => ({ kind: 'tag', id: t.id, name: t.name, color: t.color }))
      : []

    const folders: PickerItem[] = onExcludedFolderIdsChange
      ? allFolders
          .filter(c => !excludedFolderIds.includes(c.id))
          .map(c => ({ kind: 'folder', id: c.id, name: c.name, color: c.color }))
      : []

    return sortByBestMatch([...tags, ...folders], excludeSearchQuery)
  }, [
    allTags,
    allFolders,
    excludedTags,
    excludedFolderIds,
    onExcludedTagsChange,
    onExcludedFolderIdsChange,
    excludeSearchQuery,
  ])

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

  const handleAddRule = () => {
    if (!onQueryRulesChange) return
    onQueryRulesChange([...queryRules, createDefaultFilterRule(queryRules.length)])
  }

  const handleRemoveRule = (id: string) => {
    if (!onQueryRulesChange) return
    onQueryRulesChange(queryRules.filter((rule) => rule.id !== id))
  }

  const handleUpdateRule = (id: string, updates: Partial<FilterRule>) => {
    if (!onQueryRulesChange) return
    onQueryRulesChange(
      queryRules.map((rule) => {
        if (rule.id !== id) return rule
        const nextRule = { ...rule, ...updates }
        nextRule.operator = normalizeOperatorForField(nextRule.field, nextRule.operator)
        return nextRule
      })
    )
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

  const activeQueryRuleCount = queryRules.filter((rule) => rule.value.trim().length > 0).length

  const hasAnySelection =
    selectedTags.length > 0 ||
    selectedFolderIds.length > 0 ||
    excludedTags.length > 0 ||
    excludedFolderIds.length > 0 ||
    queryRules.length > 0

  const categorySummaries = useMemo(() => {
    const categoryMap = new Map<string, { count: number; selectedCount: number }>()

    for (const tag of allTags) {
      const category = (tag.category || 'general').toLowerCase()
      const current = categoryMap.get(category) || { count: 0, selectedCount: 0 }
      current.count += 1
      if (selectedTags.includes(tag.id)) {
        current.selectedCount += 1
      }
      categoryMap.set(category, current)
    }

    return Array.from(categoryMap.entries())
      .map(([category, values]) => ({ category, ...values }))
      .sort((a, b) => a.category.localeCompare(b.category))
  }, [allTags, selectedTags])

  const conflictingTagObjects = useMemo(
    () => selectedTagObjects.filter(tag => excludedTags.includes(tag.id)),
    [selectedTagObjects, excludedTags]
  )

  const conflictingFolderObjects = useMemo(
    () => selectedFolderObjects.filter(folder => excludedFolderIds.includes(folder.id)),
    [selectedFolderObjects, excludedFolderIds]
  )

  const querySummary = useMemo(() => {
    const parts: string[] = []
    const includeNames = [
      ...selectedTagObjects.map(tag => tag.name),
      ...selectedFolderObjects.map(folder => folder.name),
    ]
    const excludeNames = [
      ...excludedTagObjects.map(tag => tag.name),
      ...excludedFolderObjects.map(folder => folder.name),
    ]

    if (includeNames.length > 0) {
      parts.push(`with ${summarizeNames(includeNames, 'any filters')}`)
    }
    if (excludeNames.length > 0) {
      parts.push(`without ${summarizeNames(excludeNames, 'none')}`)
    }
    if (scopeLabel && scopeLabel.trim()) {
      parts.push(`from ${scopeTypeLabel} ${scopeLabel}`)
    }
    if (activeQueryRuleCount > 0) {
      parts.push(`where ${activeQueryRuleCount} advanced condition${activeQueryRuleCount === 1 ? '' : 's'} match`)
    }

    if (parts.length === 0) return 'Find samples from the current scope.'
    return `Find samples ${parts.join(' and ')}.`
  }, [
    selectedTagObjects,
    selectedFolderObjects,
    excludedTagObjects,
    excludedFolderObjects,
    scopeLabel,
    scopeTypeLabel,
    activeQueryRuleCount,
  ])

  const conflictNames = useMemo(() => {
    const names = [
      ...conflictingTagObjects.map(tag => tag.name),
      ...conflictingFolderObjects.map(folder => folder.name),
    ]
    return summarizeNames(names, '')
  }, [conflictingTagObjects, conflictingFolderObjects])

  if (compactMode) {
    return (
      <div ref={containerRef} className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-slate-400">
            Showing <span className="text-white font-medium">{filteredCount}</span>
            {filteredCount !== totalCount && (
              <> of <span className="text-slate-300">{totalCount}</span></>
            )} samples
          </span>

          {hasAnySelection && (
            <button
              onClick={() => {
                onTagsChange([])
                onSelectedFolderIdsChange?.([])
                onExcludedTagsChange?.([])
                onExcludedFolderIdsChange?.([])
                onQueryRulesChange?.([])
              }}
              className="text-xs text-slate-400 hover:text-slate-200 transition-colors"
            >
              Clear all filters
            </button>
          )}
        </div>

        {scopeLabel && scopeLabel.trim() && (
          <div className="text-xs text-slate-500">
            Scope: <span className="text-slate-300">{scopeTypeLabel} {scopeLabel}</span>
          </div>
        )}
      </div>
    )
  }

  return (
    <div ref={containerRef} className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-slate-400">
          Showing <span className="text-white font-medium">{filteredCount}</span>
          {filteredCount !== totalCount && (
            <> of <span className="text-slate-300">{totalCount}</span></>
          )} samples
        </span>

        {hasAnySelection && (
          <button
            onClick={() => {
              onTagsChange([])
              onSelectedFolderIdsChange?.([])
              onExcludedTagsChange?.([])
              onExcludedFolderIdsChange?.([])
              onQueryRulesChange?.([])
            }}
            className="text-xs text-slate-400 hover:text-slate-200 transition-colors"
          >
            Clear all
          </button>
        )}
      </div>

      <div className="rounded-lg border border-surface-border bg-surface-base p-2.5 space-y-2.5">
        <p className="text-xs text-slate-400">{querySummary}</p>

        {(conflictingTagObjects.length > 0 || conflictingFolderObjects.length > 0) && (
          <div className="rounded-md border border-amber-500/35 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-200 flex items-center gap-2">
            <AlertTriangle size={13} className="text-amber-300 flex-shrink-0" />
            <span>
              Include and exclude overlap: <span className="font-medium">{conflictNames}</span>
            </span>
          </div>
        )}

        {showCategories && categorySummaries.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] uppercase tracking-wide text-slate-500 mr-1">Categories</span>
            {categorySummaries.map((item) => (
              <span
                key={`category-${item.category}`}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] border ${
                  item.selectedCount > 0
                    ? 'bg-accent-primary/20 border-accent-primary/40 text-accent-primary'
                    : 'bg-surface-raised border-surface-border text-slate-400'
                }`}
                title={`${item.count} instrument${item.count !== 1 ? 's' : ''}`}
              >
                <span className="capitalize">{item.category}</span>
                <span className="text-[10px] text-slate-500">
                  {item.selectedCount > 0 ? `${item.selectedCount}/${item.count}` : item.count}
                </span>
              </span>
            ))}
          </div>
        )}

        <div className="space-y-2">
          <div className="rounded-md border border-surface-border/80 bg-surface-raised/30 px-2.5 py-2">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
              <span className="text-[11px] uppercase tracking-wide text-slate-500 sm:w-28 sm:pt-1">With instruments</span>

              <div className="flex-1 flex flex-wrap items-start gap-1.5 min-h-[28px]">
                {selectedTagObjects.map(tag => (
                  <span
                    key={`selected-tag-${tag.id}`}
                    className="relative inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors"
                    style={{ backgroundColor: `${tag.color}25`, color: tag.color }}
                    title={tag.name}
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
                        <div className="text-xs text-slate-400 font-medium">Turn instrument into folder</div>
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

                {selectedTagObjects.length === 0 && selectedFolderObjects.length === 0 && (
                  <span className="text-xs text-slate-500 py-1">No include filters. Results follow current scope.</span>
                )}
              </div>

              <div className="relative shrink-0 self-start">
                <button
                  onClick={() => {
                    setIsAddDropdownOpen(v => !v)
                    setIsExcludeDropdownOpen(false)
                  }}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-surface-raised text-slate-300 hover:text-white hover:bg-surface-base transition-colors border border-surface-border"
                >
                  <Plus size={12} />
                  Add
                  <ChevronDown size={10} className={`transition-transform ${isAddDropdownOpen ? 'rotate-180' : ''}`} />
                </button>

                {isAddDropdownOpen && (
                  <div className="absolute top-full mt-1 right-0 z-30 w-64 bg-surface-raised border border-surface-border rounded-lg shadow-xl overflow-hidden">
                    <div className="p-2 border-b border-surface-border">
                      <div className="relative">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
                        <input
                          type="text"
                          value={addSearchQuery}
                          onChange={(e) => setAddSearchQuery(e.target.value)}
                          placeholder="Search instruments/folders..."
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
                            <span
                              className="truncate"
                              style={item.kind === 'tag' ? { color: item.color } : undefined}
                              title={item.name}
                            >
                              {item.name}
                            </span>
                            {item.kind === 'tag' && (
                              <span className="text-[10px] text-slate-500">
                                {getTagCount({ id: item.id, name: item.name, color: item.color || '#6366f1' })}
                              </span>
                            )}
                            <span className="ml-auto text-[10px] uppercase tracking-wide text-slate-500">
                              {item.kind === 'tag' ? 'instrument' : 'folder'}
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
                              placeholder="Instrument name..."
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
                            Create new instrument...
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {showExcludeBuilder && (
            <div className="rounded-md border border-red-500/25 bg-red-500/5 px-2.5 py-2">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                <span className="text-[11px] uppercase tracking-wide text-slate-500 sm:w-28 sm:pt-1">And without</span>

                <div className="flex-1 flex flex-wrap items-start gap-1.5 min-h-[28px]">
                  {excludedTagObjects.map(tag => (
                    <span
                      key={`excluded-tag-${tag.id}`}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border"
                      style={{
                        backgroundColor: 'rgba(239, 68, 68, 0.12)',
                        color: '#fca5a5',
                        borderColor: 'rgba(239, 68, 68, 0.35)',
                      }}
                      title={tag.name}
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

                  {excludedTagObjects.length === 0 && excludedFolderObjects.length === 0 && (
                    <span className="text-xs text-slate-500 py-1">No exclusions.</span>
                  )}
                </div>

                <div className="relative shrink-0 self-start">
                  <button
                    onClick={() => {
                      setIsExcludeDropdownOpen(v => !v)
                      setIsAddDropdownOpen(false)
                    }}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border border-red-400/30 text-red-300 hover:bg-red-500/15 transition-colors"
                  >
                    <Minus size={12} />
                    Exclude
                    <ChevronDown size={10} className={`transition-transform ${isExcludeDropdownOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {isExcludeDropdownOpen && (
                    <div className="absolute top-full mt-1 right-0 z-30 w-64 bg-surface-raised border border-surface-border rounded-lg shadow-xl overflow-hidden">
                      <div className="p-2 border-b border-surface-border">
                        <div className="relative">
                          <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
                          <input
                            type="text"
                            value={excludeSearchQuery}
                            onChange={(e) => setExcludeSearchQuery(e.target.value)}
                            placeholder="Search instruments/folders..."
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
                              <span
                                className="truncate"
                                style={item.kind === 'tag' ? { color: item.color } : undefined}
                                title={item.name}
                              >
                                {item.name}
                              </span>
                              {item.kind === 'tag' && (
                                <span className="text-[10px] text-slate-500">
                                  {getTagCount({ id: item.id, name: item.name, color: item.color || '#6366f1' })}
                                </span>
                              )}
                              <span className="ml-auto text-[10px] uppercase tracking-wide text-slate-500">
                                {item.kind === 'tag' ? 'instrument' : 'folder'}
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
              </div>
            </div>
          )}

          {showRuleBuilder && (
            <div className="rounded-md border border-surface-border/80 bg-surface-raised/30 px-2.5 py-2 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] uppercase tracking-wide text-slate-500">Where</span>
                <button
                  onClick={handleAddRule}
                  className="inline-flex items-center gap-1.5 px-2 py-1 text-xs rounded border border-surface-border bg-surface-raised text-slate-300 hover:text-white hover:bg-surface-base transition-colors"
                >
                  <Plus size={12} />
                  Add condition
                </button>
              </div>

              {queryRules.length > 0 ? (
                <div className="space-y-2">
                  {queryRules.map((rule, index) => {
                    const fieldConfig = getFilterRuleField(rule.field)
                    const numericField = isFilterRuleNumericField(rule.field)
                    const operatorOptions = numericField ? FILTER_RULE_NUMERIC_OPERATORS : FILTER_RULE_TEXT_OPERATORS
                    const valuePlaceholder = numericField ? 'Value...' : 'Text...'

                    return (
                      <div key={rule.id} className="flex flex-wrap items-center gap-1.5 rounded border border-surface-border bg-surface-base px-2 py-1.5">
                        {index > 0 ? (
                          <select
                            value={rule.joinWithPrevious}
                            onChange={(e) => handleUpdateRule(rule.id, { joinWithPrevious: e.target.value as 'AND' | 'OR' })}
                            className="px-2 py-1 text-[11px] rounded border border-surface-border bg-surface-raised text-slate-200 focus:outline-none focus:border-accent-primary"
                            title="Join condition"
                          >
                            <option value="AND">AND</option>
                            <option value="OR">OR</option>
                          </select>
                        ) : (
                          <span className="px-2 py-1 text-[11px] rounded border border-surface-border bg-surface-raised text-slate-400">IF</span>
                        )}

                        <select
                          value={rule.field}
                          onChange={(e) => {
                            const nextField = e.target.value as FilterRuleFieldId
                            handleUpdateRule(rule.id, {
                              field: nextField,
                              operator: getDefaultOperatorForField(nextField),
                            })
                          }}
                          className="px-2 py-1 text-xs rounded border border-surface-border bg-surface-raised text-slate-200 focus:outline-none focus:border-accent-primary"
                          title="Field"
                        >
                          {FILTER_RULE_FIELDS.map((field) => (
                            <option key={field.id} value={field.id}>
                              {field.label}
                            </option>
                          ))}
                        </select>

                        <select
                          value={normalizeOperatorForField(rule.field, rule.operator)}
                          onChange={(e) => handleUpdateRule(rule.id, { operator: e.target.value as FilterRuleOperator })}
                          className="px-2 py-1 text-xs rounded border border-surface-border bg-surface-raised text-slate-200 focus:outline-none focus:border-accent-primary"
                          title="Operator"
                        >
                          {operatorOptions.map((operator) => (
                            <option key={operator.id} value={operator.id}>
                              {operator.label}
                            </option>
                          ))}
                        </select>

                        <input
                          type={fieldConfig.type === 'number' ? 'number' : 'text'}
                          value={rule.value}
                          onChange={(e) => handleUpdateRule(rule.id, { value: e.target.value })}
                          placeholder={valuePlaceholder}
                          className="flex-1 min-w-[140px] px-2 py-1 text-xs rounded border border-surface-border bg-surface-raised text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary no-spinner"
                          step={fieldConfig.type === 'number' ? 'any' : undefined}
                        />

                        <button
                          onClick={() => handleRemoveRule(rule.id)}
                          className="p-1 text-slate-500 hover:text-red-300 transition-colors"
                          title="Remove condition"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="text-xs text-slate-500">
                  Add conditions like <span className="text-slate-300">BPM &gt;= 120</span> or <span className="text-slate-300">Artist contains "madlib"</span>.
                </div>
              )}
            </div>
          )}

          {scopeLabel && scopeLabel.trim() && (
            <div className="rounded-md border border-surface-border/80 bg-surface-raised/30 px-2.5 py-2">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center">
                <span className="text-[11px] uppercase tracking-wide text-slate-500 sm:w-28">From {scopeTypeLabel}</span>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-surface-raised border border-surface-border text-slate-200 w-fit">
                  <FolderOpen size={12} className="text-slate-500" />
                  {scopeLabel}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
