import { useMemo, useState, useEffect } from 'react'
import {
  Search,
  ChevronRight,
  ChevronDown,
  FolderOpen,
  Check,
  Minus,
  Tag as TagIcon,
  X,
  List,
  ArrowRight,
} from 'lucide-react'
import type { CustomOrderState, CustomOrderAction, SourceSelection } from '../hooks/useCustomOrderState'
import { hasSelectionContent } from '../hooks/useCustomOrderState'
import type { Folder, Collection, Tag } from '../types'
import { useCollections, useFolders, useTags, useCollectionFacets } from '../hooks/useTracks'
import { useScopedSamples } from '../hooks/useScopedSamples'
import { CustomOrderSampleSelectPanel, SampleSelectContext } from './CustomOrderSampleSelectPanel'

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
  state: CustomOrderState
  dispatch: React.Dispatch<CustomOrderAction>
  onClearSelection?: () => void
  allowViewWithoutDestination?: boolean
}

function CollectionFolders({
  collection,
  state,
  dispatch,
  onOpenSamples,
  canSelect,
}: {
  collection: Collection
  state: CustomOrderState
  dispatch: React.Dispatch<CustomOrderAction>
  onOpenSamples: (context: SampleSelectContext) => void
  canSelect: boolean
}) {
  const { data: folders = [] } = useFolders({ collectionId: collection.id })
  const tree = useMemo(() => buildTree(folders), [folders])
  const folderCount = folders.length
  const isExpanded = state.folderSearchQuery.trim()
    ? true
    : state.expandedSourceCollections.has(collection.id)
  const selectionSource = state.stagedSelection

  const matchedNodes = useMemo(() => {
    if (!state.folderSearchQuery.trim()) return null
    const query = state.folderSearchQuery.toLowerCase()
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
  }, [tree, state.folderSearchQuery])

  return (
    <div className="mb-2">
      <button
        className="group flex items-center gap-2 w-full px-2 py-1.5 text-sm hover:bg-surface-border/50 rounded transition-colors"
        onClick={() => dispatch({ type: 'TOGGLE_EXPAND_COLLECTION', collectionId: collection.id })}
      >
        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
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
                  selectionSource={selectionSource}
                  canSelect={canSelect}
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
                selectionSource={selectionSource}
                canSelect={canSelect}
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
  selectionSource,
  canSelect,
  onOpenSamples,
}: {
  node: FolderNode
  depth: number
  state: CustomOrderState
  dispatch: React.Dispatch<CustomOrderAction>
  selectionSource: SourceSelection
  canSelect: boolean
  onOpenSamples: (context: SampleSelectContext) => void
}) {
  const isExpanded = state.expandedSourceFolders.has(node.id)
  const hasChildren = node.children.length > 0
  const isSelected = selectionSource.selectedFolderIds.has(node.id)
  const isExcluded = selectionSource.excludedFolderIds.has(node.id)

  return (
    <div>
      <div
        className="flex items-center gap-1.5 py-1 px-2 text-sm group hover:bg-surface-border/30 rounded transition-colors"
        style={{ paddingLeft: `${depth * 16 + 12}px` }}
      >
        {/* Expand toggle */}
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

        {/* Select all checkbox */}
        <button
          className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
            isSelected
              ? 'bg-accent-primary border-accent-primary text-white'
              : 'border-slate-500 hover:border-slate-400'
          } ${canSelect ? '' : 'opacity-50 pointer-events-none'}`}
          onClick={() => {
            dispatch({ type: 'TOGGLE_SOURCE_FOLDER', folderId: node.id })
          }}
          title="Select all samples in this folder"
        >
          {isSelected && <Check size={10} />}
        </button>

        <button
          className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
            isExcluded
              ? 'bg-red-500/20 border-red-500 text-red-300'
              : 'border-slate-500 hover:border-red-400 hover:text-red-300 text-slate-500'
          } ${canSelect ? '' : 'opacity-50 pointer-events-none'}`}
          onClick={() => {
            dispatch({ type: 'TOGGLE_EXCLUDED_SOURCE_FOLDER', folderId: node.id })
          }}
          title="Exclude this folder"
        >
          {isExcluded && <Minus size={10} />}
        </button>

        {/* Color dot + name */}
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

        {/* Individual mode toggle removed */}
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
              selectionSource={selectionSource}
              canSelect={canSelect}
              onOpenSamples={onOpenSamples}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function CustomOrderSourcePane({
  state,
  dispatch,
  onClearSelection,
  allowViewWithoutDestination = false,
}: Props) {
  const { data: collections = [] } = useCollections()
  const { data: allTags = [] } = useTags()
  const { data: collectionFacets } = useCollectionFacets(state.targetCollectionId)
  const { data: globalSamplesData } = useScopedSamples({ type: 'all' }, [], '', false)
  const activeFolder = state.destinationFolders.find(f => f.tempId === state.activeFolderId)
  const [foldersOpen, setFoldersOpen] = useState(true)
  const [tagsOpen, setTagsOpen] = useState(true)
  const [openTagCategories, setOpenTagCategories] = useState<Set<string>>(new Set())
  const [sampleSelectContext, setSampleSelectContext] = useState<SampleSelectContext | null>(null)
  const [isSampleSelectOpen, setIsSampleSelectOpen] = useState(false)
  const [isSampleSelectClosing, setIsSampleSelectClosing] = useState(false)

  const globalTagCounts = useMemo(() => {
    const map = new Map<number, number>()
    const samples = globalSamplesData?.samples || []
    for (const sample of samples) {
      for (const tag of sample.tags || []) {
        map.set(tag.id, (map.get(tag.id) || 0) + 1)
      }
    }
    return map
  }, [globalSamplesData])

  const tagCounts = useMemo(() => {
    // Prefer collection-scoped counts when available; otherwise fall back
    // to global sample counts so Advanced Order never shows all zeros.
    const hasCollectionCounts =
      !!collectionFacets && Object.keys(collectionFacets.tags || {}).length > 0

    if (!hasCollectionCounts) return globalTagCounts

    const map = new Map<number, number>()
    for (const items of Object.values(collectionFacets.tags)) {
      for (const item of items) {
        map.set(item.tagId, item.count)
      }
    }
    return map
  }, [collectionFacets, globalTagCounts])

  const tagsByCategory = useMemo(() => {
    const grouped: Record<string, Tag[]> = {}
    for (const tag of allTags) {
      const cat = (tag as any).category || 'general'
      if (!grouped[cat]) grouped[cat] = []
      grouped[cat].push(tag)
    }
    return grouped
  }, [allTags])

  useEffect(() => {
    setOpenTagCategories(new Set(Object.keys(tagsByCategory)))
  }, [tagsByCategory])

  const filteredCollections = useMemo(() => {
    if (!state.folderSearchQuery.trim()) return collections
    return collections
  }, [collections, state.folderSearchQuery])

  const filteredTagsByCategory = useMemo(() => {
    if (!state.folderSearchQuery.trim()) return tagsByCategory
    const query = state.folderSearchQuery.toLowerCase()
    const result: Record<string, Tag[]> = {}
    for (const [category, tags] of Object.entries(tagsByCategory)) {
      const matches = tags.filter(tag => tag.name.toLowerCase().includes(query))
      if (matches.length > 0) result[category] = matches
    }
    return result
  }, [tagsByCategory, state.folderSearchQuery])

  const toggleTagCategory = (category: string) => {
    setOpenTagCategories(prev => {
      const next = new Set(prev)
      if (next.has(category)) next.delete(category)
      else next.add(category)
      return next
    })
  }

  const openSampleSelect = (context: SampleSelectContext) => {
    setSampleSelectContext(context)
    setIsSampleSelectClosing(false)
    setIsSampleSelectOpen(false)
    setTimeout(() => setIsSampleSelectOpen(true), 10)
  }

  const closeSampleSelect = () => {
    setIsSampleSelectClosing(true)
    setTimeout(() => {
      setIsSampleSelectOpen(false)
      setIsSampleSelectClosing(false)
      setSampleSelectContext(null)
    }, 250)
  }

  return (
    <div className="flex flex-col h-full relative overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-surface-border">
        <h3 className="text-sm font-medium text-slate-200 mb-0.5">Sources</h3>
        <p className="text-xs text-slate-500 mb-2">Browse and select samples to assign to your destinations</p>
        <div className="flex gap-2">
          {/* Folder + tag filter */}
          <div className="relative flex-1">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={state.folderSearchQuery}
              onChange={(e) => dispatch({ type: 'SET_FOLDER_SEARCH', query: e.target.value })}
              placeholder="Search folders or tags..."
              className="w-full pl-8 pr-3 py-1.5 text-sm bg-surface-base border border-surface-border rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary"
            />
          </div>
        </div>
      </div>

      {!activeFolder && !allowViewWithoutDestination && (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-slate-500 text-sm">Select or create a destination on the right to start picking samples</p>
        </div>
      )}

      {(activeFolder || allowViewWithoutDestination) && (
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col relative">
          {!activeFolder && allowViewWithoutDestination && (
            <div className="px-4 py-2 text-xs text-slate-400 border-b border-surface-border">
              Select sources now. Pick a destination on the right to apply them.
            </div>
          )}
          <div className="flex-1 min-h-0 overflow-y-auto">
            {/* Folders section */}
            <div className="border-b border-surface-border">
              <div className="px-4 pt-3 pb-2">
                <button
                  className="flex items-center justify-center gap-2 w-full px-4 py-2 text-sm font-medium text-slate-200 bg-surface-base border border-surface-border rounded-lg hover:bg-surface-border/60 hover:text-white transition-colors"
                  onClick={() => openSampleSelect({ type: 'all' })}
                >
                  <List size={14} />
                  Show All Samples
                </button>
              </div>
              <button
                className="flex items-center gap-2 px-4 py-2 text-xs font-medium text-slate-400 uppercase tracking-wider"
                onClick={() => setFoldersOpen(!foldersOpen)}
              >
                {foldersOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <FolderOpen size={14} className="text-slate-400" />
                Folders
              </button>
            </div>
            {foldersOpen && (
              <div className="p-2">
                {filteredCollections.length === 0 && (
                  <p className="text-xs text-slate-500 px-4 py-2">No results</p>
                )}
                {filteredCollections.map(p => (
                  <CollectionFolders
                    key={p.id}
                    collection={p}
                    state={state}
                    dispatch={dispatch}
                    onOpenSamples={openSampleSelect}
                    canSelect
                  />
                ))}
              </div>
            )}

            {/* Tags section */}
            <div className="border-t border-surface-border">
              <button
                className="flex items-center gap-2 px-4 py-2 text-xs font-medium text-slate-400 uppercase tracking-wider"
                onClick={() => setTagsOpen(!tagsOpen)}
              >
                {tagsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <TagIcon size={14} className="text-slate-400" />
                Tags
              </button>
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
                            const isSelected = state.stagedSelection.selectedTagIds.has(tag.id)
                            const isExcluded = state.stagedSelection.excludedTagIds.has(tag.id)
                            return (
                              <div
                                key={tag.id}
                                className={`group flex items-center gap-2 px-3 py-1 rounded-full text-sm transition-colors ${
                                  isSelected
                                    ? 'bg-accent-primary/20 text-accent-primary border border-accent-primary/30'
                                    : 'bg-surface-base text-slate-400 border border-surface-border hover:text-slate-300'
                                }`}
                              >
                                <button
                                  className="flex items-center gap-2"
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
                                </button>
                                <span className="text-xs text-slate-500">
                                  {tagCounts.get(tag.id) ?? 0}
                                </span>
                                <button
                                  className={`p-0.5 rounded transition-colors ${
                                    isExcluded
                                      ? 'text-red-300 bg-red-500/20'
                                      : 'text-slate-500 hover:text-red-300'
                                  }`}
                                  onClick={() => dispatch({ type: 'TOGGLE_EXCLUDED_SOURCE_TAG', tagId: tag.id })}
                                  title="Exclude this tag"
                                >
                                  <Minus size={10} />
                                </button>
                                <button
                                  className="p-0.5 text-slate-500 hover:text-white opacity-0 group-hover:opacity-100"
                                  onClick={() => openSampleSelect({ type: 'tag', id: tag.id, name: tag.name })}
                                  title="Browse samples for this tag"
                                >
                                  <List size={12} />
                                </button>
                              </div>
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

          {(activeFolder || allowViewWithoutDestination) && (
            <div className="border-t border-surface-border px-4 py-2 text-xs text-slate-400 sticky bottom-0 bg-surface-base flex-shrink-0">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-1 bg-surface-base border border-surface-border rounded-full px-2 py-0.5">
                  Folders {state.stagedSelection.selectedFolderIds.size}
                  <button onClick={() => dispatch({ type: 'CLEAR_SELECTED_FOLDERS' })} className="text-slate-500 hover:text-white"><X size={10} /></button>
                </div>
                <div className="flex items-center gap-1 bg-surface-base border border-surface-border rounded-full px-2 py-0.5 text-red-400">
                  Excl. folders {state.stagedSelection.excludedFolderIds.size}
                  <button onClick={() => dispatch({ type: 'CLEAR_EXCLUDED_FOLDERS' })} className="text-red-300 hover:text-red-200"><X size={10} /></button>
                </div>
                <div className="flex items-center gap-1 bg-surface-base border border-surface-border rounded-full px-2 py-0.5">
                  Tags {state.stagedSelection.selectedTagIds.size}
                  <button onClick={() => dispatch({ type: 'CLEAR_SELECTED_TAGS' })} className="text-slate-500 hover:text-white"><X size={10} /></button>
                </div>
                <div className="flex items-center gap-1 bg-surface-base border border-surface-border rounded-full px-2 py-0.5 text-red-400">
                  Excl. tags {state.stagedSelection.excludedTagIds.size}
                  <button onClick={() => dispatch({ type: 'CLEAR_EXCLUDED_TAGS' })} className="text-red-300 hover:text-red-200"><X size={10} /></button>
                </div>
                <div className="flex items-center gap-1 bg-surface-base border border-surface-border rounded-full px-2 py-0.5">
                  Samples {state.stagedSelection.individuallySelectedIds.size}
                  <button onClick={() => dispatch({ type: 'CLEAR_SELECTED_SAMPLES' })} className="text-slate-500 hover:text-white"><X size={10} /></button>
                </div>
                <div className="flex items-center gap-1 bg-surface-base border border-surface-border rounded-full px-2 py-0.5 text-red-400">
                  Excluded {state.stagedSelection.excludedSampleIds.size}
                  <button onClick={() => dispatch({ type: 'CLEAR_EXCLUDED_SAMPLES' })} className="text-red-300 hover:text-red-200"><X size={10} /></button>
                </div>
              </div>
              {activeFolder && (
                <button
                  className="mt-2 w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-accent-primary text-white hover:bg-accent-primary/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  onClick={() => dispatch({ type: 'COMMIT_STAGED_TO_ACTIVE' })}
                  disabled={!hasSelectionContent(state.stagedSelection)}
                >
                  <ArrowRight size={14} />
                  Copy to {activeFolder.destinationType === 'tag' ? 'tag' : 'folder'} "{activeFolder.name || 'Untitled'}"
                </button>
              )}
              {onClearSelection && (
                <button
                  className="mt-2 text-xs text-slate-500 hover:text-white flex items-center gap-1"
                  onClick={onClearSelection}
                >
                  <X size={12} />
                  Clear selection
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {(activeFolder || allowViewWithoutDestination) && (
        <CustomOrderSampleSelectPanel
          context={sampleSelectContext}
          selectionSource={state.stagedSelection}
          dispatch={dispatch}
          allTags={allTags}
          isOpen={isSampleSelectOpen}
          isClosing={isSampleSelectClosing}
          onClose={closeSampleSelect}
        />
      )}
    </div>
  )
}
