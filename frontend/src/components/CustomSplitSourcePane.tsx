import { useMemo, useState } from 'react'
import {
  Search,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  FolderOpen,
  Check,
  Tag as TagIcon,
  List,
} from 'lucide-react'
import type { CustomSplitState, CustomSplitAction, SplitCategory } from '../hooks/useCustomSplitState'
import type { Folder, Collection, Tag } from '../types'
import { useCollections, useFolders, useTags, useCollectionFacets } from '../hooks/useTracks'
import type { SplitSampleContext } from './CustomSplitFilterPane'

interface FolderNode extends Folder {
  children: FolderNode[]
}

function buildTree(folders: Folder[], parentId: number | null = null): FolderNode[] {
  return folders
    .filter(c => c.parentId === parentId)
    .map(c => ({
      ...c,
      children: buildTree(folders, c.id),
    }))
}

interface Props {
  state: CustomSplitState
  dispatch: React.Dispatch<CustomSplitAction>
  activeCategory: SplitCategory | null
  onOpenSamples: (context: SplitSampleContext) => void
}

function CollectionFolders({
  collection,
  state,
  dispatch,
  activeCategory,
  onOpenSamples,
  searchQuery,
}: {
  collection: Collection
  state: CustomSplitState
  dispatch: React.Dispatch<CustomSplitAction>
  activeCategory: SplitCategory | null
  onOpenSamples: (context: SplitSampleContext) => void
  searchQuery: string
}) {
  const { data: folders = [] } = useFolders({ collectionId: collection.id })
  const tree = useMemo(() => buildTree(folders), [folders])
  const folderCount = folders.length
  const isExpanded = searchQuery.trim()
    ? true
    : state.expandedSourceCollections.has(collection.id)

  const matchedNodes = useMemo(() => {
    if (!searchQuery.trim()) return null
    const query = searchQuery.toLowerCase()
    const results: Array<{ node: FolderNode; depth: number }> = []
    const walk = (node: FolderNode, depth: number) => {
      if (node.name.toLowerCase().includes(query)) {
        results.push({ node: { ...node, children: [] }, depth })
      }
      for (const child of node.children) {
        walk(child, depth + 1)
      }
    }
    for (const root of tree) walk(root, 0)
    return results
  }, [tree, searchQuery])

  const hasMatches = matchedNodes ? matchedNodes.length > 0 : true
  if (searchQuery.trim() && !hasMatches && !collection.name.toLowerCase().includes(searchQuery.toLowerCase())) {
    return null
  }

  const isCollectionSelected = activeCategory?.sourceSelection.selectedCollectionIds.has(collection.id) ?? false

  return (
    <div className="mb-2">
      <button
        className="group flex items-center gap-2 w-full px-2 py-1.5 text-sm hover:bg-surface-border/50 rounded transition-colors"
        onClick={() => dispatch({ type: 'TOGGLE_EXPAND_COLLECTION', collectionId: collection.id })}
      >
        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <button
          className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
            isCollectionSelected
              ? 'bg-accent-primary border-accent-primary text-white'
              : 'border-slate-500 hover:border-slate-400'
          }`}
          onClick={(e) => {
            e.stopPropagation()
            dispatch({ type: 'TOGGLE_SOURCE_COLLECTION', collectionId: collection.id })
          }}
          title="Select all samples in this collection"
        >
          {isCollectionSelected && <Check size={10} />}
        </button>
        <span className="text-slate-200 font-mono uppercase tracking-wide">{collection.name}</span>
        <span className="text-slate-500 text-xs ml-auto">{folderCount} folders</span>
        <button
          className="p-1 text-slate-500 hover:text-white opacity-0 group-hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation()
            onOpenSamples({ type: 'collection', id: collection.id, name: collection.name })
          }}
          title="Browse samples in this collection"
        >
          <List size={12} />
        </button>
      </button>

      {isExpanded && (
        <div className="ml-2">
          {matchedNodes ? (
            matchedNodes.length === 0 ? (
              <p className="text-xs text-slate-500 px-4 py-1">No folders found</p>
            ) : (
              matchedNodes.map(({ node, depth }) => (
                <FolderTreeNode
                  key={`match-${node.id}-${depth}`}
                  node={node}
                  depth={depth}
                  state={state}
                  dispatch={dispatch}
                  activeCategory={activeCategory}
                  onOpenSamples={onOpenSamples}
                />
              ))
            )
          ) : (
            tree.map(node => (
              <FolderTreeNode
                key={node.id}
                node={node}
                depth={0}
                state={state}
                dispatch={dispatch}
                activeCategory={activeCategory}
                onOpenSamples={onOpenSamples}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

function FolderTreeNode({
  node,
  depth,
  state,
  dispatch,
  activeCategory,
  onOpenSamples,
}: {
  node: FolderNode
  depth: number
  state: CustomSplitState
  dispatch: React.Dispatch<CustomSplitAction>
  activeCategory: SplitCategory | null
  onOpenSamples: (context: SplitSampleContext) => void
}) {
  const isExpanded = state.expandedSourceFolders.has(node.id)
  const hasChildren = node.children.length > 0
  const isSelected = activeCategory?.sourceSelection.selectedFolderIds.has(node.id) ?? false

  return (
    <div>
      <div
        className="flex items-center gap-1.5 py-1 px-2 text-sm group hover:bg-surface-border/30 rounded transition-colors"
        style={{ paddingLeft: `${depth * 16 + 12}px` }}
      >
        <button
          className="p-0.5 hover:text-white flex-shrink-0 text-slate-400"
          onClick={() => {
            if (hasChildren) {
              dispatch({ type: 'TOGGLE_EXPAND_FOLDER', folderId: node.id })
            }
          }}
        >
          {hasChildren ? (
            isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />
          ) : (
            <span className="w-3" />
          )}
        </button>

        <button
          className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
            isSelected
              ? 'bg-accent-primary border-accent-primary text-white'
              : 'border-slate-500 hover:border-slate-400'
          }`}
          onClick={() => {
            dispatch({ type: 'TOGGLE_SOURCE_FOLDER', folderId: node.id })
          }}
          title="Select all samples in this folder"
        >
          {isSelected && <Check size={10} />}
        </button>

        <span
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: node.color }}
        />
        <span className={`flex-1 truncate ${isSelected ? 'text-white' : 'text-slate-300'}`}>
          {node.name}
        </span>
        <span className="text-slate-500 text-xs">{node.sliceCount}</span>

        <button
          className="p-0.5 text-slate-500 hover:text-slate-300 opacity-0 group-hover:opacity-100"
          onClick={() => onOpenSamples({ type: 'folder', id: node.id, name: node.name })}
          title="Browse samples in this folder"
        >
          <List size={12} />
        </button>
      </div>

      {isExpanded && (
        <div>
          {hasChildren && node.children.map(child => (
            <FolderTreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              state={state}
              dispatch={dispatch}
              activeCategory={activeCategory}
              onOpenSamples={onOpenSamples}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function CustomSplitSourcePane({ state, dispatch, activeCategory, onOpenSamples }: Props) {
  const { data: collections = [] } = useCollections()
  const { data: allTags = [] } = useTags()
  const { data: collectionFacets } = useCollectionFacets(activeCategory?.destinationCollectionId ?? null)
  const [foldersOpen, setFoldersOpen] = useState(true)
  const [tagsOpen, setTagsOpen] = useState(true)
  const [openTagCategories, setOpenTagCategories] = useState<Set<string>>(new Set())

  const tagCounts = useMemo(() => {
    const map = new Map<number, number>()
    if (!collectionFacets) return map
    for (const items of Object.values(collectionFacets.tags)) {
      for (const item of items) {
        map.set(item.tagId, item.count)
      }
    }
    return map
  }, [collectionFacets])

  const tagsByCategory = useMemo(() => {
    const grouped: Record<string, Tag[]> = {}
    for (const tag of allTags) {
      const cat = (tag as any).category || 'general'
      if (!grouped[cat]) grouped[cat] = []
      grouped[cat].push(tag)
    }
    return grouped
  }, [allTags])

  const filteredTagsByCategory = useMemo(() => {
    if (!state.sourceSearchQuery.trim()) return tagsByCategory
    const query = state.sourceSearchQuery.toLowerCase()
    const result: Record<string, Tag[]> = {}
    for (const [category, tags] of Object.entries(tagsByCategory)) {
      const matches = tags.filter(tag => tag.name.toLowerCase().includes(query))
      if (matches.length > 0) result[category] = matches
    }
    return result
  }, [tagsByCategory, state.sourceSearchQuery])

  const toggleTagCategory = (category: string) => {
    setOpenTagCategories(prev => {
      const next = new Set(prev)
      if (next.has(category)) next.delete(category)
      else next.add(category)
      return next
    })
  }

  const anyCollectionMatch = useMemo(() => {
    if (!state.sourceSearchQuery.trim()) return collections.length > 0
    const query = state.sourceSearchQuery.toLowerCase()
    return collections.some(p => p.name.toLowerCase().includes(query))
  }, [collections, state.sourceSearchQuery])

  const hasAnyResults = anyCollectionMatch || Object.keys(filteredTagsByCategory).length > 0

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-surface-border">
        <h3 className="text-sm font-medium text-slate-200 mb-2">Sources</h3>
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={state.sourceSearchQuery}
            onChange={(e) => dispatch({ type: 'SET_SOURCE_SEARCH', query: e.target.value })}
            placeholder="Search folders or tags..."
            className="w-full pl-8 pr-3 py-1.5 text-sm bg-surface-base border border-surface-border rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary"
          />
        </div>
      </div>

      {!activeCategory && (
        <div className="flex-1 flex items-center justify-center text-sm text-slate-500">
          Create or select a category to start selecting sources.
        </div>
      )}

      {activeCategory && (
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="border-b border-surface-border">
              <div className="px-4 pt-2 pb-1">
                <button
                  className="flex items-center gap-2 text-[11px] text-slate-500 hover:text-slate-300"
                  onClick={() => onOpenSamples({ type: 'all' })}
                >
                  <List size={12} />
                  All samples
                </button>
              </div>
              <div className="flex items-center">
                <button
                  className="flex items-center gap-2 flex-1 px-4 py-2 text-xs font-medium text-slate-400 uppercase tracking-wider"
                  onClick={() => setFoldersOpen(!foldersOpen)}
                >
                  {foldersOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  <FolderOpen size={14} className="text-slate-400" />
                  Root Folders
                </button>
                {foldersOpen && (state.expandedSourceCollections.size > 0 || state.expandedSourceFolders.size > 0) && (
                  <button
                    className="px-2 py-1 mr-2 text-slate-500 hover:text-slate-300 transition-colors"
                    onClick={() => dispatch({ type: 'COLLAPSE_ALL_FOLDERS' })}
                    title="Collapse all folders"
                  >
                    <ChevronUp size={12} />
                  </button>
                )}
              </div>
            </div>
            {foldersOpen && (
              <div className="p-2">
                {!hasAnyResults && (
                  <p className="text-xs text-slate-500 px-4 py-2">No results</p>
                )}
                {collections.map(p => (
                  <CollectionFolders
                    key={p.id}
                    collection={p}
                    state={state}
                    dispatch={dispatch}
                    activeCategory={activeCategory}
                    onOpenSamples={onOpenSamples}
                    searchQuery={state.sourceSearchQuery}
                  />
                ))}
              </div>
            )}

            <div className="border-t border-surface-border flex items-center">
              <button
                className="flex items-center gap-2 flex-1 px-4 py-2 text-xs font-medium text-slate-400 uppercase tracking-wider"
                onClick={() => setTagsOpen(!tagsOpen)}
              >
                {tagsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <TagIcon size={14} className="text-slate-400" />
                Tags
              </button>
              {tagsOpen && openTagCategories.size > 0 && (
                <button
                  className="px-2 py-1 mr-2 text-slate-500 hover:text-slate-300 transition-colors"
                  onClick={() => setOpenTagCategories(new Set())}
                  title="Collapse all tag categories"
                >
                  <ChevronUp size={12} />
                </button>
              )}
            </div>
            {tagsOpen && (
              <div className="p-2">
                {Object.entries(filteredTagsByCategory).length === 0 && (
                  <p className="text-xs text-slate-500 px-4 py-2">No results</p>
                )}
                {Object.entries(filteredTagsByCategory).map(([category, tags]) => {
                  const isOpen = openTagCategories.has(category)
                  return (
                    <div key={category} className="mb-2 px-2">
                      <button
                        className="flex items-center gap-2 text-xs text-slate-500 mb-1 font-mono uppercase tracking-wide"
                        onClick={() => toggleTagCategory(category)}
                      >
                        {isOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                        {category}
                      </button>
                      {isOpen && (
                        <div className="flex flex-wrap gap-1">
                          {tags.map(tag => {
                            const isSelected = activeCategory.sourceSelection.selectedTagIds.has(tag.id)
                            return (
                              <button
                                key={tag.id}
                                className={`group flex items-center gap-2 px-3 py-1 rounded-full text-sm transition-colors ${
                                  isSelected
                                    ? 'bg-accent-primary/20 text-accent-primary border border-accent-primary/30'
                                    : 'bg-surface-base text-slate-400 border border-surface-border hover:text-slate-300'
                                }`}
                                onClick={() => {
                                  dispatch({ type: 'TOGGLE_SOURCE_TAG', tagId: tag.id })
                                }}
                              >
                                {isSelected && <Check size={8} />}
                                <span
                                  className="w-1.5 h-1.5 rounded-full"
                                  style={{ backgroundColor: tag.color }}
                                />
                                {tag.name}
                                <span className="text-xs text-slate-500">
                                  {tagCounts.get(tag.id) ?? 0}
                                </span>
                                <button
                                  className="p-0.5 text-slate-500 hover:text-white opacity-0 group-hover:opacity-100"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    onOpenSamples({ type: 'tag', id: tag.id, name: tag.name })
                                  }}
                                  title="Browse samples for this tag"
                                >
                                  <List size={12} />
                                </button>
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
