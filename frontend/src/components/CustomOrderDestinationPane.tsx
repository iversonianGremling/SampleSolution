import { useMemo, useState, useEffect } from 'react'
import { ChevronRight, ChevronDown, FolderOpen, Plus, Palette, X, Tag as TagIcon, Pencil, Trash2, Check, Loader2 } from 'lucide-react'
import type { CustomOrderState, CustomOrderAction, DestinationFolder } from '../hooks/useCustomOrderState'
import { getSelectionChangeCount } from '../hooks/useCustomOrderState'
import type { Folder, Collection } from '../types'
import { useFolders, useCreateCollection, useTags, useCreateTag, useUpdateTag, useUpdateFolder, useUpdateCollection, useDeleteFolder, useDeleteCollection, useBatchDeleteSlices } from '../hooks/useTracks'
import * as api from '../api/client'
import { useQueryClient } from '@tanstack/react-query'

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
  collections: Collection[]
  side: 'left' | 'right'
}

function countPendingByFolder(
  folders: DestinationFolder[],
  tempMap: Map<string, DestinationFolder>
) {
  const counts = new Map<number, number>()
  let rootCount = 0

  const resolveRootFolder = (folder: DestinationFolder): number | null => {
    let current: DestinationFolder | undefined = folder
    while (current) {
      if (current.parentFolderId) return current.parentFolderId
      if (current.parentTempId) {
        current = tempMap.get(current.parentTempId)
      } else {
        current = undefined
      }
    }
    return null
  }

  for (const folder of folders) {
    const folderId = resolveRootFolder(folder)
    if (folderId) {
      counts.set(folderId, (counts.get(folderId) || 0) + 1)
    } else {
      rootCount += 1
    }
  }

  return { counts, rootCount }
}

export function CustomOrderDestinationPane({ state, dispatch, collections, side }: Props) {
  const { data: allFolders = [] } = useFolders()
  const { data: allTags = [] } = useTags()
  const createCollection = useCreateCollection()
  const updateCollection = useUpdateCollection()
  const deleteCollection = useDeleteCollection()
  const updateFolder = useUpdateFolder()
  const deleteFolder = useDeleteFolder()
  const createTag = useCreateTag()
  const updateTag = useUpdateTag()
  const batchDeleteSlices = useBatchDeleteSlices()
  const queryClient = useQueryClient()
  const [expandedCollections, setExpandedCollections] = useState<Set<number>>(new Set())
  const [expandedFolders, setExpandedFolders] = useState<Set<number>>(new Set())
  const [newCollectionName, setNewCollectionName] = useState('')
  const [showNewCollectionInput, setShowNewCollectionInput] = useState(false)
  const [directorySearch, setDirectorySearch] = useState('')
  const [tagsOpen, setTagsOpen] = useState(false)
  const [openTagCategories, setOpenTagCategories] = useState<Set<string>>(new Set())
  const [editingCollectionId, setEditingCollectionId] = useState<number | null>(null)
  const [editingCollectionName, setEditingCollectionName] = useState('')
  const [editingFolderId, setEditingFolderId] = useState<number | null>(null)
  const [editingFolderName, setEditingFolderName] = useState('')
  const [editingTagId, setEditingTagId] = useState<number | null>(null)
  const [editingTagName, setEditingTagName] = useState('')
  const [editingTagColor, setEditingTagColor] = useState('#94a3b8')
  const [editingCategoryName, setEditingCategoryName] = useState<string | null>(null)
  const [editingCategoryValue, setEditingCategoryValue] = useState('')
  const [draftCategories, setDraftCategories] = useState<Array<{ id: string; name: string }>>([])
  const [newTagByCategory, setNewTagByCategory] = useState<Record<string, { name: string; color: string }>>({})
  const [deleteTarget, setDeleteTarget] = useState<null | {
    kind: 'folder' | 'collection' | 'tag' | 'tag-category'
    id?: number
    name: string
    category?: string
    tagIds?: number[]
  }>(null)
  const [deleteAlsoSamples, setDeleteAlsoSamples] = useState(false)
  const [deleteStage, setDeleteStage] = useState<'primary' | 'secondary'>('primary')
  const [deleteSampleIds, setDeleteSampleIds] = useState<number[]>([])
  const [deleteLoading, setDeleteLoading] = useState(false)

  const formatChangesLabel = (count: number) => `${count} ${count === 1 ? 'change' : 'changes'} made`

  const foldersByCollection = useMemo(() => {
    const map = new Map<number | null, Folder[]>()
    for (const folder of allFolders) {
      const key = folder.collectionId ?? null
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(folder)
    }
    return map
  }, [allFolders])

  const folderDestinations = useMemo(
    () => state.destinationFolders.filter(folder => folder.destinationType === 'folder'),
    [state.destinationFolders]
  )

  const tempMap = useMemo(() => {
    const map = new Map<string, DestinationFolder>()
    for (const folder of folderDestinations) map.set(folder.tempId, folder)
    return map
  }, [folderDestinations])

  const pendingCounts = useMemo(
    () => countPendingByFolder(folderDestinations, tempMap),
    [folderDestinations, tempMap]
  )

  const pendingByCollection = useMemo(() => {
    const map = new Map<number, number>()
    for (const [perspId, folders] of foldersByCollection.entries()) {
      if (!perspId) continue
      let total = 0
      for (const folder of folders) {
        total += pendingCounts.counts.get(folder.id) || 0
      }
      map.set(perspId, total)
    }
    return map
  }, [foldersByCollection, pendingCounts])

  const pendingByParentTempId = useMemo(() => {
    const map = new Map<string | null, DestinationFolder[]>()
    for (const folder of folderDestinations) {
      if (folder.parentTempId) {
        const key = folder.parentTempId
        if (!map.has(key)) map.set(key, [])
        map.get(key)!.push(folder)
      }
    }
    return map
  }, [folderDestinations])

  const pendingByParentFolderId = useMemo(() => {
    const map = new Map<number | null, DestinationFolder[]>()
    for (const folder of folderDestinations) {
      if (!folder.parentTempId) {
        const key = folder.parentFolderId ?? null
        if (!map.has(key)) map.set(key, [])
        map.get(key)!.push(folder)
      }
    }
    return map
  }, [folderDestinations])

  const toggleCollection = (id: number) => {
    setExpandedCollections(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleFolder = (id: number) => {
    setExpandedFolders(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleAddFolder = (collectionId: number, parentFolderId: number | null) => {
    dispatch({ type: 'SET_TARGET_COLLECTION', collectionId })
    setExpandedCollections(prev => {
      const next = new Set(prev)
      next.add(collectionId)
      return next
    })
    if (parentFolderId) {
      setExpandedFolders(prev => {
        const next = new Set(prev)
        next.add(parentFolderId)
        return next
      })
    }
    dispatch({ type: 'ADD_DESTINATION_FOLDER', parentFolderId })
  }

  const filterMatches = (tree: FolderNode[], query: string) => {
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
  }

  const renderPendingFolder = (folder: DestinationFolder, depth: number) => {
    const children = pendingByParentTempId.get(folder.tempId) || []
    return (
      <div key={folder.tempId}>
        <div
          className={`flex items-center gap-2 px-2 py-1.5 rounded-md bg-emerald-500/10 border border-emerald-400/40 ${
            state.activeFolderId === folder.tempId ? 'border-accent-primary/60' : ''
          }`}
          style={{ paddingLeft: `${depth * 18 + 28}px` }}
        >
          <FolderOpen size={14} className="text-emerald-300" />
          <input
            type="text"
            value={folder.name}
            onChange={(e) => dispatch({ type: 'RENAME_DESTINATION_FOLDER', tempId: folder.tempId, name: e.target.value })}
            placeholder="New folder name"
            className="flex-1 bg-transparent text-sm outline-none text-white placeholder-slate-500"
            onFocus={() => dispatch({ type: 'SET_ACTIVE_FOLDER', tempId: folder.tempId })}
          />
          <label className="flex items-center gap-1 text-xs text-slate-200">
            <Palette size={12} />
            <input
              type="color"
              value={folder.color}
              onChange={(e) => dispatch({ type: 'SET_FOLDER_COLOR', tempId: folder.tempId, color: e.target.value })}
              className="w-5 h-5 border border-surface-border rounded"
            />
          </label>
          <button
            className="p-1 text-slate-200 hover:text-red-400"
            onClick={() => dispatch({ type: 'REMOVE_DESTINATION_FOLDER', tempId: folder.tempId })}
            title="Remove folder"
          >
            <X size={14} />
          </button>
        </div>
        {children.length > 0 && children.map(child => renderPendingFolder(child, depth + 1))}
      </div>
    )
  }

  const renderFolderNode = (node: FolderNode, depth: number, collectionId: number) => {
    const isExpanded = expandedFolders.has(node.id)
    const hasChildren = node.children.length > 0
    const pendingCount = pendingCounts.counts.get(node.id) || 0
    const isCollapsedWithPending = !isExpanded && pendingCount > 0 && hasChildren
    const existingDest = state.destinationFolders.find(
      f => f.destinationType === 'existing-folder' && f.destinationFolderId === node.id
    )
    const existingDestChangeCount = existingDest ? getSelectionChangeCount(existingDest.sourceSelection) : 0
    const existingDestIsActive = !!existingDest && state.activeFolderId === existingDest.tempId
    const isHighlighted = isCollapsedWithPending

    const pendingHere = pendingByParentFolderId.get(node.id) || []

    return (
      <div key={node.id}>
        <div
          className={`group flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${
            isHighlighted
                ? 'bg-emerald-500/10 border border-emerald-400/40'
                : 'hover:bg-surface-border/40'
          } ${isCollapsedWithPending ? 'opacity-80' : ''}`}
          style={{ paddingLeft: `${depth * 18 + 16}px` }}
        >
          <button
            className="p-0.5 text-slate-500 hover:text-slate-300"
            onClick={() => hasChildren && toggleFolder(node.id)}
          >
            {hasChildren ? (isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : <span className="w-3" />}
          </button>
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: node.color }} />
          {editingFolderId === node.id ? (
            <div className="flex-1 flex items-center gap-2">
              <input
                type="text"
                value={editingFolderName}
                onChange={(e) => setEditingFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveEditFolder()
                  if (e.key === 'Escape') cancelEditFolder()
                }}
                className="flex-1 bg-transparent text-sm text-white outline-none border-b border-surface-border"
                autoFocus
              />
              <button
                className="text-emerald-300 hover:text-emerald-200"
                onClick={saveEditFolder}
                title="Save"
              >
                <Check size={12} />
              </button>
              <button
                className="text-slate-400 hover:text-white"
                onClick={cancelEditFolder}
                title="Cancel"
              >
                <X size={12} />
              </button>
            </div>
          ) : (
            <button
              className="flex-1 truncate text-slate-200 text-left hover:text-white"
              onClick={() => {
                if (existingDest) {
                  dispatch({ type: 'REMOVE_DESTINATION_FOLDER', tempId: existingDest.tempId })
                  return
                }
                dispatch({
                  type: 'ADD_DESTINATION_FROM_EXISTING_FOLDER',
                  folderId: node.id,
                  name: node.name,
                  color: node.color,
                  collectionId,
                })
              }}
              title="Use this folder as destination"
            >
              {node.name}
              {existingDestIsActive && (
                <span className="ml-1 text-[10px] uppercase tracking-wide text-accent-primary">Selected</span>
              )}
              {!!existingDest && !existingDestIsActive && existingDestChangeCount > 0 && (
                <span className="ml-1 text-[10px] uppercase tracking-wide text-amber-300">
                  {formatChangesLabel(existingDestChangeCount)}
                </span>
              )}
            </button>
          )}
          {isCollapsedWithPending && (
            <span className="text-xs text-emerald-300">{pendingCount} folders being created</span>
          )}
          <button
            className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-white"
            onClick={() => startEditFolder(node)}
            title="Edit folder name"
          >
            <Pencil size={12} />
          </button>
          <button
            className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-300"
            onClick={() => openDeleteModal({ kind: 'folder', id: node.id, name: node.name })}
            title="Delete folder"
          >
            <Trash2 size={12} />
          </button>
          <button
            className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-white"
            onClick={() => handleAddFolder(collectionId, node.id)}
            title="Create folder here"
          >
            <Plus size={12} />
          </button>
        </div>
        {isExpanded && pendingHere.length > 0 && pendingHere.map(folder => renderPendingFolder(folder, depth + 1))}
        {isExpanded && hasChildren && node.children.map(child => renderFolderNode(child, depth + 1, collectionId))}
      </div>
    )
  }

  const handleCreateCollection = () => {
    const name = newCollectionName.trim()
    if (!name) return
    createCollection.mutate({ name, color: '#6366f1' }, {
      onSuccess: () => {
        setNewCollectionName('')
        setShowNewCollectionInput(false)
      },
    })
  }

  const tagDestinations = state.destinationFolders.filter(folder => folder.destinationType === 'tag')
  const filteredTagDestinations = useMemo(() => {
    const query = directorySearch.trim().toLowerCase()
    if (!query) return tagDestinations
    return tagDestinations.filter(tag => tag.name.toLowerCase().includes(query))
  }, [directorySearch, tagDestinations])

  const tagsByCategory = useMemo(() => {
    const grouped: Record<string, typeof allTags> = {}
    for (const tag of allTags) {
      const cat = (tag as any).category || 'general'
      if (!grouped[cat]) grouped[cat] = []
      grouped[cat].push(tag)
    }
    return grouped
  }, [allTags])

  const categoryEntries = useMemo(() => {
    const entries: Array<{ name: string; tags: typeof allTags; isDraft: boolean }> = []
    for (const [name, tags] of Object.entries(tagsByCategory)) {
      entries.push({ name, tags, isDraft: false })
    }
    for (const draft of draftCategories) {
      if (!tagsByCategory[draft.name]) {
        entries.push({ name: draft.name, tags: [], isDraft: true })
      }
    }
    return entries
  }, [tagsByCategory, draftCategories])

  useEffect(() => {
    setOpenTagCategories(prev => {
      const next = new Set(prev)
      const allNames = new Set(categoryEntries.map(entry => entry.name))
      for (const name of Array.from(next)) {
        if (!allNames.has(name)) next.delete(name)
      }
      return next
    })
  }, [categoryEntries])

  const filteredCategoryEntries = useMemo(() => {
    const query = directorySearch.trim().toLowerCase()
    if (!query) return categoryEntries
    return categoryEntries
      .map(entry => {
        if (entry.name.toLowerCase().includes(query)) return entry
        const matches = entry.tags.filter(tag => tag.name.toLowerCase().includes(query))
        if (matches.length > 0) return { ...entry, tags: matches }
        return null
      })
      .filter(Boolean) as Array<{ name: string; tags: typeof allTags; isDraft: boolean }>
  }, [categoryEntries, directorySearch])

  const toggleTagCategory = (category: string) => {
    setOpenTagCategories(prev => {
      const next = new Set(prev)
      if (next.has(category)) next.delete(category)
      else next.add(category)
      return next
    })
  }

  const handleAddTagCategory = () => {
    const id = `draft-${Date.now()}`
    const existing = new Set(categoryEntries.map(entry => entry.name))
    let name = 'New category'
    let index = 2
    while (existing.has(name)) {
      name = `New category ${index++}`
    }
    setDraftCategories(prev => [...prev, { id, name }])
    setOpenTagCategories(prev => new Set(prev).add(name))
    setTagsOpen(true)
    setEditingCategoryName(name)
    setEditingCategoryValue(name)
  }

  const handleStartEditCategory = (name: string) => {
    setEditingCategoryName(name)
    setEditingCategoryValue(name)
  }

  const handleSaveCategory = async () => {
    if (!editingCategoryName) return
    const newName = editingCategoryValue.trim()
    if (!newName) return
    const oldName = editingCategoryName

    if (draftCategories.some(d => d.name === oldName)) {
      setDraftCategories(prev => prev.map(d => (d.name === oldName ? { ...d, name: newName } : d)))
    } else {
      const tagsToUpdate = tagsByCategory[oldName] || []
      await Promise.all(tagsToUpdate.map(tag => api.updateTag(tag.id, { category: newName })))
      queryClient.invalidateQueries({ queryKey: ['tags'] })
    }

    setOpenTagCategories(prev => {
      const next = new Set(prev)
      if (next.has(oldName)) {
        next.delete(oldName)
        next.add(newName)
      }
      return next
    })

    setEditingCategoryName(null)
    setEditingCategoryValue('')
  }

  const handleCancelEditCategory = () => {
    setEditingCategoryName(null)
    setEditingCategoryValue('')
  }

  const handleAddTagInCategory = (category: string) => {
    setNewTagByCategory(prev => ({
      ...prev,
      [category]: prev[category] || { name: '', color: '#6366f1' },
    }))
    setOpenTagCategories(prev => new Set(prev).add(category))
    setTagsOpen(true)
  }

  const handleCreateTagInCategory = async (category: string) => {
    const entry = newTagByCategory[category]
    if (!entry || !entry.name.trim()) return
    await createTag.mutateAsync({
      name: entry.name.trim(),
      color: entry.color,
      category,
    })
    setNewTagByCategory(prev => {
      const next = { ...prev }
      delete next[category]
      return next
    })
    setDraftCategories(prev => prev.filter(d => d.name !== category))
  }

  const startEditTag = (tag: { id: number; name: string; color: string }) => {
    setEditingTagId(tag.id)
    setEditingTagName(tag.name)
    setEditingTagColor(tag.color || '#94a3b8')
  }

  const saveEditTag = async () => {
    if (!editingTagId) return
    await updateTag.mutateAsync({
      id: editingTagId,
      data: { name: editingTagName.trim(), color: editingTagColor },
    })
    setEditingTagId(null)
    setEditingTagName('')
  }

  const cancelEditTag = () => {
    setEditingTagId(null)
    setEditingTagName('')
  }

  const startEditCollection = (p: Collection) => {
    setEditingCollectionId(p.id)
    setEditingCollectionName(p.name)
  }

  const saveEditCollection = async () => {
    if (!editingCollectionId) return
    await updateCollection.mutateAsync({ id: editingCollectionId, data: { name: editingCollectionName.trim() } })
    setEditingCollectionId(null)
    setEditingCollectionName('')
  }

  const cancelEditCollection = () => {
    setEditingCollectionId(null)
    setEditingCollectionName('')
  }

  const startEditFolder = (node: Folder) => {
    setEditingFolderId(node.id)
    setEditingFolderName(node.name)
  }

  const saveEditFolder = async () => {
    if (!editingFolderId) return
    await updateFolder.mutateAsync({ id: editingFolderId, data: { name: editingFolderName.trim() } })
    setEditingFolderId(null)
    setEditingFolderName('')
  }

  const cancelEditFolder = () => {
    setEditingFolderId(null)
    setEditingFolderName('')
  }

  const fetchSampleIdsForTarget = async (target: NonNullable<typeof deleteTarget>) => {
    switch (target.kind) {
      case 'folder': {
        const data = await api.getSourcesSamples({ scope: `folder:${target.id}` })
        return data.samples.map(sample => sample.id)
      }
      case 'collection': {
        const data = await api.getSourcesSamples({ scope: `collection:${target.id}` })
        return data.samples.map(sample => sample.id)
      }
      case 'tag': {
        const data = await api.getSourcesSamples({ scope: 'all', tags: target.id ? [target.id] : [] })
        return data.samples.map(sample => sample.id)
      }
      case 'tag-category': {
        const tagIds = target.tagIds || []
        const idSet = new Set<number>()
        for (const tagId of tagIds) {
          const data = await api.getSourcesSamples({ scope: 'all', tags: [tagId] })
          for (const sample of data.samples) idSet.add(sample.id)
        }
        return Array.from(idSet)
      }
      default:
        return []
    }
  }

  const openDeleteModal = async (target: NonNullable<typeof deleteTarget>) => {
    setDeleteTarget(target)
    setDeleteStage('primary')
    setDeleteAlsoSamples(false)
    setDeleteSampleIds([])
    setDeleteLoading(true)
    try {
      const ids = await fetchSampleIdsForTarget(target)
      setDeleteSampleIds(ids)
    } finally {
      setDeleteLoading(false)
    }
  }

  const closeDeleteModal = () => {
    setDeleteTarget(null)
    setDeleteAlsoSamples(false)
    setDeleteStage('primary')
    setDeleteSampleIds([])
  }

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return

    if (deleteAlsoSamples && deleteStage === 'primary') {
      setDeleteStage('secondary')
      return
    }

    if (deleteAlsoSamples && deleteSampleIds.length > 0) {
      await batchDeleteSlices.mutateAsync(deleteSampleIds)
    }

    if (deleteTarget.kind === 'folder' && deleteTarget.id) {
      await deleteFolder.mutateAsync(deleteTarget.id)
    }
    if (deleteTarget.kind === 'collection' && deleteTarget.id) {
      await deleteCollection.mutateAsync(deleteTarget.id)
    }
    if (deleteTarget.kind === 'tag' && deleteTarget.id) {
      await api.deleteTag(deleteTarget.id)
      queryClient.invalidateQueries({ queryKey: ['tags'] })
    }
    if (deleteTarget.kind === 'tag-category') {
      const tagIds = deleteTarget.tagIds || []
      await Promise.all(tagIds.map(tagId => api.deleteTag(tagId)))
      queryClient.invalidateQueries({ queryKey: ['tags'] })
      setDraftCategories(prev => prev.filter(d => d.name !== deleteTarget.name))
    }

    closeDeleteModal()
  }

  return (
    <div
      className="flex flex-col h-full"
      data-side={side}
      data-tour={side === 'right' ? 'custom-order-destination-pane' : undefined}
    >
      <div className="px-4 py-3 border-b border-surface-border">
        <h3 className="text-sm font-medium text-slate-200">Destinations</h3>
        <p className="text-xs text-slate-500 mt-1">Click a folder to use it as destination, or hover to create new ones</p>
        <div className="mt-2">
          <input
            type="text"
            value={directorySearch}
            onChange={(e) => setDirectorySearch(e.target.value)}
            placeholder="Search directories..."
            className="w-full px-3 py-1.5 text-sm bg-surface-base border border-surface-border rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary"
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="p-3 space-y-4">
          <div className="flex items-center gap-2 px-2 text-xs font-medium text-slate-400 uppercase tracking-wider">
            <FolderOpen size={12} className="text-slate-400" />
            Folders
            <button
              className="ml-auto text-slate-400 hover:text-white"
              onClick={() => setShowNewCollectionInput(true)}
              title="Create new collection"
            >
              <Plus size={12} />
            </button>
          </div>
          {(() => {
            const query = directorySearch.trim().toLowerCase()
            const list = collections.map(p => {
              const folderTree = buildTree(foldersByCollection.get(p.id) || [])
              const matches = query ? filterMatches(folderTree, query) : null
              return { collection: p, tree: folderTree, matches }
            })
            const filteredList = query
              ? list.filter(item => (item.matches?.length || 0) > 0 || item.collection.name.toLowerCase().includes(query))
              : list

            if (
              query &&
              filteredList.length === 0 &&
              filteredTagDestinations.length === 0 &&
              filteredCategoryEntries.length === 0
            ) {
              return <p className="text-xs text-slate-500 px-2">No results</p>
            }

            return filteredList.map(({ collection: p, tree: folderTree, matches }) => {
            const isExpanded = directorySearch.trim() ? true : expandedCollections.has(p.id)
            const pendingRoot = state.targetCollectionId === p.id ? pendingCounts.rootCount : 0
            const pendingWithinCollection = pendingByCollection.get(p.id) || 0
            const pendingTotal = pendingRoot + pendingWithinCollection
            const isHighlighted = !isExpanded && pendingTotal > 0
            const pendingAtRoot = state.targetCollectionId === p.id ? (pendingByParentFolderId.get(null) || []) : []

            return (
              <div key={p.id}>
                <div
                  className={`group flex items-center gap-2 px-3 py-2 text-sm transition-colors rounded-md ${
                    isHighlighted ? 'bg-emerald-500/10' : 'hover:bg-surface-border/40'
                  }`}
                >
                  <button
                    className="p-0.5 text-slate-500 hover:text-slate-300"
                    onClick={() => toggleCollection(p.id)}
                  >
                    {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                  {editingCollectionId === p.id ? (
                    <div className="flex-1 flex items-center gap-2">
                      <input
                        type="text"
                        value={editingCollectionName}
                        onChange={(e) => setEditingCollectionName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveEditCollection()
                          if (e.key === 'Escape') cancelEditCollection()
                        }}
                        className="flex-1 bg-transparent text-sm text-white outline-none border-b border-surface-border"
                        autoFocus
                      />
                      <button
                        className="text-emerald-300 hover:text-emerald-200"
                        onClick={saveEditCollection}
                        title="Save"
                      >
                        <Check size={12} />
                      </button>
                      <button
                        className="text-slate-400 hover:text-white"
                        onClick={cancelEditCollection}
                        title="Cancel"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ) : (
                    <span className="flex-1 text-slate-200 font-mono uppercase tracking-wide">{p.name}</span>
                  )}
                  {!isExpanded && pendingTotal > 0 && (
                    <span className="text-xs text-emerald-300">{pendingTotal} folders being created</span>
                  )}
                  <button
                    className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-white"
                    onClick={() => startEditCollection(p)}
                    title="Edit collection name"
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-300"
                    onClick={() => openDeleteModal({ kind: 'collection', id: p.id, name: p.name })}
                    title="Delete collection"
                  >
                    <Trash2 size={12} />
                  </button>
                  <button
                    className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-white"
                    onClick={() => handleAddFolder(p.id, null)}
                    title="Create folder in this collection"
                  >
                    <Plus size={14} />
                  </button>
                </div>

                {isExpanded && (
                  <div className="py-2">
                    {isExpanded && pendingAtRoot.length > 0 && pendingAtRoot.map(folder => renderPendingFolder(folder, 0))}
                    {matches ? (
                      matches.length === 0 ? (
                        <p className="text-xs text-slate-500 px-4">No folders</p>
                      ) : (
                        matches.map(({ node, depth }) => renderFolderNode(node, depth, p.id))
                      )
                    ) : folderTree.length === 0 ? (
                      <p className="text-xs text-slate-500 px-4">No folders</p>
                    ) : (
                      folderTree.map(node => renderFolderNode(node, 0, p.id))
                    )}
                  </div>
                )}
              </div>
            )
          })
        })()}

          {showNewCollectionInput ? (
            <div className="flex items-center gap-2 px-2 pb-2">
              <input
                type="text"
                value={newCollectionName}
                onChange={(e) => setNewCollectionName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateCollection()
                  if (e.key === 'Escape') {
                    setShowNewCollectionInput(false)
                    setNewCollectionName('')
                  }
                }}
                placeholder="New collection name"
                className="flex-1 px-2 py-1 text-sm bg-surface-base border border-surface-border rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary"
                autoFocus
              />
              <button
                className="px-2 py-1 text-xs text-slate-300 hover:text-white"
                onClick={handleCreateCollection}
              >
                Create
              </button>
              <button
                className="px-2 py-1 text-xs text-slate-500 hover:text-white"
                onClick={() => { setShowNewCollectionInput(false); setNewCollectionName('') }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              className="text-xs text-slate-400 hover:text-white px-2 pb-2"
              onClick={() => setShowNewCollectionInput(true)}
            >
              + Create new collection
            </button>
          )}

          <div className="border-t border-surface-border pt-3">
            <div className="flex items-center gap-2 px-2 py-1.5 text-xs font-medium text-slate-400 uppercase tracking-wider">
              <button
                className="flex items-center gap-2"
                onClick={() => setTagsOpen(!tagsOpen)}
              >
                {tagsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                Instruments
              </button>
              <button
                className="ml-auto text-slate-400 hover:text-white"
                onClick={handleAddTagCategory}
                title="Create instrument category"
              >
                <Plus size={12} />
              </button>
            </div>
            {tagsOpen && (
              <div className="mt-2 space-y-3">
                {filteredCategoryEntries.length === 0 && filteredTagDestinations.length === 0 && (
                  <p className="text-xs text-slate-500 px-2">No results</p>
                )}

                {filteredCategoryEntries.map(({ name: category, tags, isDraft }) => {
                  const isOpen = openTagCategories.has(category)
                  return (
                    <div key={category} className="px-2">
                      <div className="group flex items-center gap-2 text-xs text-slate-500 mb-1 font-mono uppercase tracking-wide">
                        <button
                          className="flex items-center gap-2"
                          onClick={() => toggleTagCategory(category)}
                        >
                          {isOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                          {editingCategoryName === category ? (
                            <input
                              value={editingCategoryValue}
                              onChange={(e) => setEditingCategoryValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveCategory()
                                if (e.key === 'Escape') handleCancelEditCategory()
                              }}
                              className="bg-transparent text-xs outline-none border-b border-surface-border text-slate-300"
                              autoFocus
                            />
                          ) : (
                            <span>{category}</span>
                          )}
                          {isDraft && <span className="text-[10px] text-slate-500">(draft)</span>}
                        </button>
                        {editingCategoryName === category ? (
                          <>
                            <button
                              className="text-emerald-300 hover:text-emerald-200"
                              onClick={handleSaveCategory}
                              title="Save category"
                            >
                              <Check size={10} />
                            </button>
                            <button
                              className="text-slate-400 hover:text-white"
                              onClick={handleCancelEditCategory}
                              title="Cancel"
                            >
                              <X size={10} />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-white"
                              onClick={() => handleAddTagInCategory(category)}
                              title="Add instrument"
                            >
                              <Plus size={10} />
                            </button>
                            <button
                              className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-white"
                              onClick={() => handleStartEditCategory(category)}
                              title="Edit category"
                            >
                              <Pencil size={10} />
                            </button>
                            <button
                              className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-300"
                              onClick={() => {
                                if (isDraft && tags.length === 0) {
                                  setDraftCategories(prev => prev.filter(d => d.name !== category))
                                  return
                                }
                                openDeleteModal({
                                  kind: 'tag-category',
                                  name: category,
                                  tagIds: tags.map(tag => tag.id),
                                })
                              }}
                              title="Delete category"
                            >
                              <Trash2 size={10} />
                            </button>
                          </>
                        )}
                      </div>
                      {isOpen && (
                        <div className="space-y-1">
                          {newTagByCategory[category] && (
                            <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-surface-base border border-surface-border">
                              <input
                                type="text"
                                value={newTagByCategory[category].name}
                                onChange={(e) => setNewTagByCategory(prev => ({ ...prev, [category]: { ...prev[category], name: e.target.value } }))}
                                placeholder="New instrument name"
                                className="flex-1 bg-transparent text-sm text-white outline-none placeholder-slate-500"
                              />
                              <input
                                type="color"
                                value={newTagByCategory[category].color}
                                onChange={(e) => setNewTagByCategory(prev => ({ ...prev, [category]: { ...prev[category], color: e.target.value } }))}
                                className="w-5 h-5 border border-surface-border rounded"
                              />
                              <button
                                className="text-emerald-300 hover:text-emerald-200"
                                onClick={() => handleCreateTagInCategory(category)}
                                title="Create instrument"
                              >
                                <Check size={12} />
                              </button>
                              <button
                                className="text-slate-400 hover:text-white"
                                onClick={() => setNewTagByCategory(prev => { const next = { ...prev }; delete next[category]; return next })}
                                title="Cancel"
                              >
                                <X size={12} />
                              </button>
                            </div>
                          )}
                          {tags.map(tag => {
                            const existingDest = tagDestinations.find(t => t.destinationTagId === tag.id)
                            const existingDestChangeCount = existingDest ? getSelectionChangeCount(existingDest.sourceSelection) : 0
                            const existingDestIsActive = !!existingDest && state.activeFolderId === existingDest.tempId
                            return (
                              <div
                                key={tag.id}
                                className={`group flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${
                                  existingDest ? 'bg-surface-border/40' : 'hover:bg-surface-border/40'
                                }`}
                              >
                                {editingTagId === tag.id ? (
                                  <>
                                    <input
                                      value={editingTagName}
                                      onChange={(e) => setEditingTagName(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') saveEditTag()
                                        if (e.key === 'Escape') cancelEditTag()
                                      }}
                                      className="flex-1 bg-transparent text-sm outline-none text-white border-b border-surface-border"
                                      autoFocus
                                    />
                                    <input
                                      type="color"
                                      value={editingTagColor}
                                      onChange={(e) => setEditingTagColor(e.target.value)}
                                      className="w-5 h-5 border border-surface-border rounded"
                                    />
                                    <button
                                      className="text-emerald-300 hover:text-emerald-200"
                                      onClick={saveEditTag}
                                      title="Save instrument"
                                    >
                                      <Check size={12} />
                                    </button>
                                    <button
                                      className="text-slate-400 hover:text-white"
                                      onClick={cancelEditTag}
                                      title="Cancel"
                                    >
                                      <X size={12} />
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <button
                                      className="flex items-center gap-2 flex-1 text-left"
                                      onClick={() => {
                                        if (existingDest) {
                                          dispatch({ type: 'SET_ACTIVE_FOLDER', tempId: existingDest.tempId })
                                        } else {
                                          dispatch({
                                            type: 'ADD_DESTINATION_TAG_FROM_EXISTING',
                                            tagId: tag.id,
                                            name: tag.name,
                                            color: tag.color,
                                          })
                                        }
                                      }}
                                      title="Use instrument as destination"
                                    >
                                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: tag.color }} />
                                      <span className="flex-1 truncate text-slate-200">{tag.name}</span>
                                      {existingDestIsActive && (
                                        <span className="text-[10px] uppercase tracking-wide text-accent-primary">Selected</span>
                                      )}
                                      {!!existingDest && !existingDestIsActive && existingDestChangeCount > 0 && (
                                        <span className="text-[10px] uppercase tracking-wide text-amber-300">
                                          {formatChangesLabel(existingDestChangeCount)}
                                        </span>
                                      )}
                                    </button>
                                    <button
                                      className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-white"
                                      onClick={() => startEditTag(tag)}
                                      title="Edit instrument"
                                    >
                                      <Pencil size={12} />
                                    </button>
                                    <button
                                      className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-300"
                                      onClick={() => openDeleteModal({ kind: 'tag', id: tag.id, name: tag.name })}
                                      title="Delete instrument"
                                    >
                                      <Trash2 size={12} />
                                    </button>
                                  </>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}

                {filteredTagDestinations.length > 0 && (
                  <div className="px-2">
                    <div className="text-[11px] text-slate-500 uppercase tracking-wide mb-1">Selected instruments</div>
                    <div className="space-y-2">
                      {filteredTagDestinations.map(tag => {
                        const changeCount = getSelectionChangeCount(tag.sourceSelection)
                        const isActive = state.activeFolderId === tag.tempId
                        return (
                        <div
                          key={tag.tempId}
                          className={`flex items-center gap-2 px-2 py-1.5 rounded-md bg-surface-base border border-surface-border ${
                            state.activeFolderId === tag.tempId ? 'border-accent-primary/60' : ''
                          }`}
                        >
                          <TagIcon size={14} className="text-slate-400" />
                          <input
                            type="text"
                            value={tag.name}
                            onChange={(e) => dispatch({ type: 'RENAME_DESTINATION_FOLDER', tempId: tag.tempId, name: e.target.value })}
                            placeholder="New instrument name"
                            className="flex-1 bg-transparent text-sm outline-none text-white placeholder-slate-500"
                            onFocus={() => dispatch({ type: 'SET_ACTIVE_FOLDER', tempId: tag.tempId })}
                          />
                          {!isActive && changeCount > 0 && (
                            <span className="text-[10px] uppercase tracking-wide text-amber-300 whitespace-nowrap">
                              {formatChangesLabel(changeCount)}
                            </span>
                          )}
                          <label className="flex items-center gap-1 text-xs text-slate-200">
                            <Palette size={12} />
                            <input
                              type="color"
                              value={tag.color}
                              onChange={(e) => dispatch({ type: 'SET_FOLDER_COLOR', tempId: tag.tempId, color: e.target.value })}
                              className="w-5 h-5 border border-surface-border rounded"
                            />
                          </label>
                          <button
                            className="p-1 text-slate-200 hover:text-red-400"
                            onClick={() => dispatch({ type: 'REMOVE_DESTINATION_FOLDER', tempId: tag.tempId })}
                            title="Remove instrument destination"
                          >
                            <X size={14} />
                          </button>
                        </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-base/60">
          <div className="bg-surface-base border border-surface-border rounded-xl w-full max-w-md p-5">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-base font-semibold text-white">
                Delete {deleteTarget.kind === 'tag'
                  ? 'instrument'
                  : deleteTarget.kind === 'tag-category'
                    ? 'instrument category'
                    : deleteTarget.kind.replace('-', ' ')}
              </h4>
              <button className="text-slate-400 hover:text-white" onClick={closeDeleteModal}>
                <X size={16} />
              </button>
            </div>
            <div className="text-sm text-slate-300 space-y-3">
              {deleteStage === 'primary' ? (
                <>
                  <p>
                    Are you sure you want to delete <span className="text-white">{deleteTarget.name}</span>?
                  </p>
                  <p className="text-xs text-slate-500">
                    This will remove links only. Samples will remain in your library.
                  </p>
                  <label className="flex items-center gap-2 text-xs text-slate-300">
                    <input
                      type="checkbox"
                      checked={deleteAlsoSamples}
                      onChange={(e) => setDeleteAlsoSamples(e.target.checked)}
                      disabled={deleteLoading}
                    />
                    {deleteLoading ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="animate-spin" size={12} /> Counting samples...
                      </span>
                    ) : (
                      <span>Also delete {deleteSampleIds.length} samples</span>
                    )}
                  </label>
                </>
              ) : (
                <>
                  <p className="text-red-300">
                    You are about to delete {deleteSampleIds.length} samples from your library.
                  </p>
                  <p className="text-xs text-red-300/80">
                    These samples might exist in other folders, instruments, or collections. This cannot be undone.
                  </p>
                </>
              )}
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                className="px-3 py-1.5 text-sm text-slate-300 hover:text-white"
                onClick={closeDeleteModal}
              >
                Cancel
              </button>
              <button
                className={`px-3 py-1.5 text-sm rounded-lg ${
                  deleteStage === 'secondary' ? 'bg-red-600 hover:bg-red-500 text-white' : 'bg-surface-border text-white hover:bg-surface-border/80'
                }`}
                onClick={handleConfirmDelete}
              >
                {deleteStage === 'secondary' ? 'Delete Samples' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
