import { useState, useRef, useEffect } from 'react'
import {
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Circle,
  CircleDot,
  Database,
  Youtube,
  FolderOpen,
  Music2,
  Plus,
  MoreVertical,
  Pencil,
  Trash2,
  Search,
  Heart,
  FolderPlus,
  Palette,
  Tag,
  Settings2,
} from 'lucide-react'
import { useResizablePanel } from '../hooks/useResizablePanel'
import { ResizableDivider } from './ResizableDivider'
import { AddSourceMenu } from './AddSourceMenu'
import type {
  SourceTree,
  SourceScope,
  Folder,
  Collection,
  Tag as AppTag,
  FolderNode as SourceFolderNode,
  LibrarySourceNode as SourceLibraryNode,
} from '../types'

interface SourcesTreeProps {
  tree: SourceTree | undefined
  folders: Folder[]
  currentScope: SourceScope
  onScopeChange: (scope: SourceScope) => void
  onDeleteSource?: (scope: string, label: string) => void
  onCreateFolder?: (name: string, parentId?: number) => void
  onRenameFolder?: (id: number, name: string) => void
  onDeleteFolder?: (id: number) => void
  onUpdateFolder?: (id: number, data: { parentId?: number | null; color?: string; collectionId?: number | null }) => void
  onCreateImportedFolder?: (parentPath: string, name: string) => Promise<void> | void
  onBatchAddToFolder?: (folderId: number, sampleIds: number[]) => void
  onCreateTagFromFolder?: (folderId: number, name: string, color: string) => void
  instrumentTags?: Array<Pick<AppTag, 'id' | 'name' | 'color' | 'category'>>
  instrumentTagCounts?: Record<number, number>
  selectedInstrumentTagIds?: number[]
  onSelectInstrumentTag?: (tagId: number) => void
  onClearInstrumentSelection?: () => void
  isLoading?: boolean
  collections?: Collection[]
  activeCollectionId?: number | null
  onCollectionChange?: (id: number) => void
  onCreateCollection?: (name: string) => void
  onRenameCollection?: (id: number, name: string) => void
  onDeleteCollection?: (id: number) => void
  onMoveCollection?: (id: number, direction: 'up' | 'down') => void
  onOpenAdvancedCategoryManagement?: () => void
  onOpenLibraryImport?: () => void
  showFavoritesOnly?: boolean
  onToggleFavoritesOnly?: () => void
}

interface MyFolderNode extends Folder {
  children: MyFolderNode[]
}

const TREE_SECTION_DIVIDER_HEIGHT = 4
const TREE_SECTION_MIN_HEIGHT = 120
const TREE_SECTION_FALLBACK_HEIGHT = 640

export function SourcesTree({
  tree,
  folders,
  currentScope,
  onScopeChange,
  onDeleteSource,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onUpdateFolder,
  onCreateImportedFolder,
  onBatchAddToFolder,
  onCreateTagFromFolder,
  isLoading = false,
  collections = [],
  activeCollectionId = null,
  onCollectionChange,
  onCreateCollection,
  onRenameCollection,
  onDeleteCollection,
  onMoveCollection,
  onOpenAdvancedCategoryManagement,
  onOpenLibraryImport,
  showFavoritesOnly = false,
  onToggleFavoritesOnly,
}: SourcesTreeProps) {
  const hasInitializedCollectionExpansion = useRef(false)
  const sectionsContainerRef = useRef<HTMLDivElement | null>(null)
  const [sectionsContainerHeight, setSectionsContainerHeight] = useState(TREE_SECTION_FALLBACK_HEIGHT)

  // Expanded state for tree nodes
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['sources', 'myfolders']))
  const [expandedSourceFolders, setExpandedSourceFolders] = useState<Set<string>>(new Set())
  const [expandedFolders, setExpandedFolders] = useState<Set<number>>(new Set())
  const [expandedCollections, setExpandedCollections] = useState<Set<string>>(new Set())
  const [treeSearchQuery, setTreeSearchQuery] = useState('')
  const [creatingImportedFolderParentPath, setCreatingImportedFolderParentPath] = useState<string | null>(null)
  const [newImportedFolderName, setNewImportedFolderName] = useState('')
  const [isCreatingImportedFolder, setIsCreatingImportedFolder] = useState(false)
  const [importedFolderError, setImportedFolderError] = useState<string | null>(null)

  // Auto-expand YouTube section when tree loads and has videos
  useEffect(() => {
    if (tree && (tree.youtube?.length ?? 0) > 0) {
      setExpandedSections(prev => {
        const updated = new Set(prev)
        updated.add('youtube')
        return updated
      })
    }
  }, [tree])

  useEffect(() => {
    if (!tree?.streaming) return
    const streaming = tree.streaming

    setExpandedSections(prev => {
      const updated = new Set(prev)
      if (Number(streaming.soundcloud?.count || 0) > 0) updated.add('soundcloud')
      if (Number(streaming.spotify?.count || 0) > 0) updated.add('spotify')
      if (Number(streaming.bandcamp?.count || 0) > 0) updated.add('bandcamp')
      return updated
    })
  }, [tree])

  // Auto-expand Libraries section when imported libraries exist
  useEffect(() => {
    if (tree && (tree.libraries?.length ?? 0) > 0) {
      setExpandedSections(prev => {
        const updated = new Set(prev)
        updated.add('libraries')
        return updated
      })
    }
  }, [tree])

  useEffect(() => {
    if (hasInitializedCollectionExpansion.current) return

    const keys = new Set<string>()
    for (const p of collections) keys.add(String(p.id))
    if (folders.some(c => c.collectionId === null)) keys.add('ungrouped')
    if (keys.size > 0) {
      setExpandedCollections(keys)
      hasInitializedCollectionExpansion.current = true
    }
  }, [collections, folders])

  // Folder management state
  const [newFolderName, setNewFolderName] = useState('')
  const [isCreatingFolder, setIsCreatingFolder] = useState(false)
  const [creatingUnderParentId, setCreatingUnderParentId] = useState<number | null>(null)
  const [editingFolderId, setEditingFolderId] = useState<number | null>(null)
  const [editingFolderName, setEditingFolderName] = useState('')
  const [contextMenuId, setContextMenuId] = useState<number | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const [collectionContextMenuId, setCollectionContextMenuId] = useState<number | null>(null)
  const collectionContextMenuRef = useRef<HTMLDivElement>(null)

  // Color picker state
  const [colorPickerFolderId, setColorPickerFolderId] = useState<number | null>(null)
  const colorPickerRef = useRef<HTMLDivElement>(null)

  // Create instrument from folder state
  const [createTagFromId, setCreateTagFromId] = useState<number | null>(null)
  const [createTagName, setCreateTagName] = useState('')

  // Collection management state
  const [isCreatingCollection, setIsCreatingCollection] = useState(false)
  const [newCollectionName, setNewCollectionName] = useState('')
  const [editingCollectionId, setEditingCollectionId] = useState<number | null>(null)
  const [editingCollectionName, setEditingCollectionName] = useState('')

  // Drag and drop state
  const [draggedFolderId, setDraggedFolderId] = useState<number | null>(null)
  const [dropTargetId, setDropTargetId] = useState<number | null>(null)
  const [dropPosition, setDropPosition] = useState<'before' | 'inside' | 'after' | null>(null)
  const [dropTargetCollection, setDropTargetCollection] = useState<string | null>(null)
  const expandTimerRef = useRef<number | null>(null)
  const lastHoveredIdRef = useRef<number | null>(null)
  const maxSourcesSectionHeight = Math.max(
    TREE_SECTION_MIN_HEIGHT,
    sectionsContainerHeight - TREE_SECTION_MIN_HEIGHT - TREE_SECTION_DIVIDER_HEIGHT,
  )
  const sourcesSectionInitialHeight = Math.max(
    TREE_SECTION_MIN_HEIGHT,
    Math.min(
      maxSourcesSectionHeight,
      Math.floor((sectionsContainerHeight - TREE_SECTION_DIVIDER_HEIGHT) * 0.56),
    ),
  )
  const sourcesCollectionsPanel = useResizablePanel({
    direction: 'vertical',
    initialSize: sourcesSectionInitialHeight,
    minSize: TREE_SECTION_MIN_HEIGHT,
    maxSize: maxSourcesSectionHeight,
    storageKey: 'sources-tree-sources-section-height',
    clampOnBoundsChange: false,
  })

  // Click outside handler for context menu and color picker
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenuId(null)
      }
      if (collectionContextMenuRef.current && !collectionContextMenuRef.current.contains(e.target as Node)) {
        setCollectionContextMenuId(null)
      }
      if (colorPickerRef.current && !colorPickerRef.current.contains(e.target as Node)) {
        setColorPickerFolderId(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    const element = sectionsContainerRef.current
    if (!element) return

    const setMeasuredHeight = (height: number) => {
      setSectionsContainerHeight(
        Math.max(
          TREE_SECTION_MIN_HEIGHT * 2 + TREE_SECTION_DIVIDER_HEIGHT,
          Math.floor(height),
        ),
      )
    }

    setMeasuredHeight(element.getBoundingClientRect().height)

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver((entries) => {
        const entry = entries[0]
        if (!entry) return
        setMeasuredHeight(entry.contentRect.height)
      })
      observer.observe(element)
      return () => observer.disconnect()
    }

    const handleResize = () => {
      setMeasuredHeight(element.getBoundingClientRect().height)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const toggleSection = (section: string) => {
    const newExpanded = new Set(expandedSections)
    if (newExpanded.has(section)) {
      newExpanded.delete(section)
    } else {
      newExpanded.add(section)
    }
    setExpandedSections(newExpanded)
  }

  const toggleCollection = (key: string) => {
    setExpandedCollections(prev => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  const toggleFolder = (id: number) => {
    const newExpanded = new Set(expandedFolders)
    if (newExpanded.has(id)) {
      newExpanded.delete(id)
    } else {
      newExpanded.add(id)
    }
    setExpandedFolders(newExpanded)
  }

  const toggleSourceFolder = (path: string) => {
    const newExpanded = new Set(expandedSourceFolders)
    if (newExpanded.has(path)) {
      newExpanded.delete(path)
    } else {
      newExpanded.add(path)
    }
    setExpandedSourceFolders(newExpanded)
  }

  const startCreateImportedFolder = (parentPath: string) => {
    if (!onCreateImportedFolder) return
    setCreatingImportedFolderParentPath(parentPath)
    setNewImportedFolderName('')
    setImportedFolderError(null)
    setExpandedSections(prev => new Set(prev).add('folders'))
    setExpandedSourceFolders(prev => new Set(prev).add(parentPath))
  }

  const cancelCreateImportedFolder = () => {
    setCreatingImportedFolderParentPath(null)
    setNewImportedFolderName('')
    setImportedFolderError(null)
  }

  const submitCreateImportedFolder = async () => {
    if (!onCreateImportedFolder || !creatingImportedFolderParentPath) return
    const folderName = newImportedFolderName.trim()
    if (!folderName) {
      setImportedFolderError('Folder name is required')
      return
    }

    try {
      setIsCreatingImportedFolder(true)
      setImportedFolderError(null)
      await Promise.resolve(onCreateImportedFolder(creatingImportedFolderParentPath, folderName))
      cancelCreateImportedFolder()
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to create folder'
      setImportedFolderError(message)
    } finally {
      setIsCreatingImportedFolder(false)
    }
  }

  const isActive = (scope: SourceScope): boolean => {
    if (scope.type !== currentScope.type) return false
    switch (scope.type) {
      case 'youtube-video':
        return currentScope.type === 'youtube-video' && currentScope.trackId === scope.trackId
      case 'soundcloud-track':
        return currentScope.type === 'soundcloud-track' && currentScope.trackId === scope.trackId
      case 'spotify-track':
        return currentScope.type === 'spotify-track' && currentScope.trackId === scope.trackId
      case 'bandcamp-track':
        return currentScope.type === 'bandcamp-track' && currentScope.trackId === scope.trackId
      case 'folder':
        return currentScope.type === 'folder' && currentScope.path === scope.path
      case 'library':
        return currentScope.type === 'library' && currentScope.libraryId === scope.libraryId
      case 'my-folder':
        return currentScope.type === 'my-folder' && currentScope.folderId === scope.folderId
      default:
        return scope.type === currentScope.type
    }
  }

  const handleCreateFolder = (parentId?: number) => {
    if (newFolderName.trim() && onCreateFolder) {
      onCreateFolder(newFolderName.trim(), parentId)
      setNewFolderName('')
      setIsCreatingFolder(false)
      setCreatingUnderParentId(null)
    }
  }

  const handleRenameFolder = (id: number) => {
    if (editingFolderName.trim() && onRenameFolder) {
      onRenameFolder(id, editingFolderName.trim())
      setEditingFolderId(null)
      setEditingFolderName('')
    }
  }

  const handleChangeColor = (id: number, color: string) => {
    if (onUpdateFolder) {
      onUpdateFolder(id, { color })
    }
    setColorPickerFolderId(null)
  }

  const handleCreateCollection = () => {
    if (!newCollectionName.trim() || !onCreateCollection) return
    onCreateCollection(newCollectionName.trim())
    setNewCollectionName('')
    setIsCreatingCollection(false)
  }

  const handleRenameCollection = (id: number) => {
    if (!editingCollectionName.trim() || !onRenameCollection) {
      setEditingCollectionId(null)
      setEditingCollectionName('')
      return
    }
    onRenameCollection(id, editingCollectionName.trim())
    setEditingCollectionId(null)
    setEditingCollectionName('')
  }

  const handleDragStart = (e: React.DragEvent, folderId: number) => {
    setDraggedFolderId(folderId)
    setDropTargetCollection(null)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e: React.DragEvent, targetId: number | null, hasChildren?: boolean) => {
    e.preventDefault()
    e.stopPropagation()

    // Check if we're dragging samples or folders
    const hasJsonData = e.dataTransfer.types.includes('application/json')
    const isDraggingFolder = draggedFolderId !== null

    if (hasJsonData || isDraggingFolder) {
      e.dataTransfer.dropEffect = isDraggingFolder ? 'move' : 'copy'
      setDropTargetId(targetId)
      setDropTargetCollection(null)

      // For folder dragging, determine drop position based on mouse position
      if (isDraggingFolder && targetId !== null) {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
        const mouseY = e.clientY - rect.top
        const height = rect.height

        // Divide into three zones: before (top 25%), inside (middle 50%), after (bottom 25%)
        if (mouseY < height * 0.25) {
          setDropPosition('before')
        } else if (mouseY > height * 0.75) {
          setDropPosition('after')
        } else {
          setDropPosition('inside')
        }
      } else {
        setDropPosition(null)
      }

      // Auto-expand folders with children after a delay (only for 'inside' drops)
      if (hasChildren && targetId !== null && !expandedFolders.has(targetId) && dropPosition === 'inside') {
        // Only set timer if we've moved to a different folder
        if (lastHoveredIdRef.current !== targetId) {
          // Clear any existing timer
          if (expandTimerRef.current !== null) {
            clearTimeout(expandTimerRef.current)
          }

          lastHoveredIdRef.current = targetId

          // Set new timer to expand after 600ms
          expandTimerRef.current = window.setTimeout(() => {
            setExpandedFolders(prev => new Set(prev).add(targetId))
            expandTimerRef.current = null
          }, 600)
        }
      }
    }
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()

    // Only clear if we're actually leaving the element (not moving to a child)
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = e.clientX
    const y = e.clientY

    if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) {
      // Clear the expand timer
      if (expandTimerRef.current !== null) {
        clearTimeout(expandTimerRef.current)
        expandTimerRef.current = null
      }
      lastHoveredIdRef.current = null
      setDropTargetId(null)
      setDropPosition(null)
      setDropTargetCollection(null)
    }
  }

  const handleDrop = (e: React.DragEvent, targetId: number | null) => {
    e.preventDefault()
    e.stopPropagation()

    try {
      const jsonData = e.dataTransfer.getData('application/json')
      if (jsonData) {
        const data = JSON.parse(jsonData)

        // Handle dropping samples onto a folder
        if (data.type === 'samples' && data.sampleIds && targetId !== null && onBatchAddToFolder) {
          onBatchAddToFolder(targetId, data.sampleIds)
          setDropTargetId(null)
          setDraggedFolderId(null)
          setDropPosition(null)
          return
        }
      }
    } catch (err) {
      // Ignore JSON parse errors for folder drags
    }

    // Handle moving folders
    if (draggedFolderId !== null && onUpdateFolder) {
      // Can't drop onto itself
      if (draggedFolderId === targetId && dropPosition === 'inside') {
        setDraggedFolderId(null)
        setDropTargetId(null)
        setDropPosition(null)
        return
      }

      // Prevent moving a folder into itself or its descendants
      const isDescendant = (parentId: number, childId: number): boolean => {
        const child = folders.find(c => c.id === childId)
        if (!child || !child.parentId) return false
        if (child.parentId === parentId) return true
        return isDescendant(parentId, child.parentId)
      }

      if (targetId !== null && dropPosition === 'inside' && isDescendant(draggedFolderId, targetId)) {
        // Cannot move a folder into its own descendant
        setDraggedFolderId(null)
        setDropTargetId(null)
        setDropPosition(null)
        return
      }

      // Determine the new parent based on drop position
      let newParentId: number | null = null
      let targetCollectionId: number | null | undefined = undefined

      if (dropPosition === 'inside') {
        // Drop inside the target folder
        newParentId = targetId
        const targetFolder = folders.find(c => c.id === targetId)
        targetCollectionId = targetFolder?.collectionId ?? null
      } else if (dropPosition === 'before' || dropPosition === 'after') {
        // Drop at the same level as the target folder
        const targetFolder = folders.find(c => c.id === targetId)
        newParentId = targetFolder?.parentId ?? null
        targetCollectionId = targetFolder?.collectionId ?? null
      } else {
        // Default: root level
        newParentId = targetId
      }

      onUpdateFolder(draggedFolderId, {
        parentId: newParentId,
        ...(targetCollectionId !== undefined ? { collectionId: targetCollectionId } : {}),
      })
    }
    setDraggedFolderId(null)
    setDropTargetId(null)
    setDropPosition(null)
    setDropTargetCollection(null)
  }

  const handleCollectionDragOver = (e: React.DragEvent, key: string) => {
    e.preventDefault()
    e.stopPropagation()
    if (draggedFolderId === null) return
    setDropTargetCollection(key)
    setDropTargetId(null)
    setDropPosition(null)
  }

  const handleCollectionDrop = (e: React.DragEvent, _key: string, collectionId: number | null) => {
    e.preventDefault()
    e.stopPropagation()
    if (draggedFolderId === null || !onUpdateFolder) return
    onUpdateFolder(draggedFolderId, { parentId: null, collectionId })
    setDraggedFolderId(null)
    setDropTargetId(null)
    setDropPosition(null)
    setDropTargetCollection(null)
  }

  const buildFolderTree = (list: Folder[], parentId: number | null = null): MyFolderNode[] => {
    return list
      .filter(c => c.parentId === parentId)
      .map(c => ({
        ...c,
        children: buildFolderTree(list, c.id),
      }))
  }

  // Filter tree items based on search
  const filteredYouTubeVideos = (tree?.youtube ?? []).filter(video =>
    !treeSearchQuery || video.title.toLowerCase().includes(treeSearchQuery.toLowerCase())
  )
  type StreamingSection = {
    sectionKey: 'soundcloud' | 'spotify' | 'bandcamp'
    scopeType: 'soundcloud' | 'spotify' | 'bandcamp'
    trackScopeType: 'soundcloud-track' | 'spotify-track' | 'bandcamp-track'
    label: string
    badge: string
    badgeClassName: string
    count: number
    tracks: Array<{ id: number; title: string; thumbnailUrl: string; sliceCount: number }>
    filteredTracks: Array<{ id: number; title: string; thumbnailUrl: string; sliceCount: number }>
  }
  const streamingSections: StreamingSection[] = [
    {
      sectionKey: 'soundcloud',
      scopeType: 'soundcloud',
      trackScopeType: 'soundcloud-track',
      label: 'SoundCloud',
      badge: 'SC',
      badgeClassName: 'bg-orange-500/20 text-orange-300',
      count: Number(tree?.streaming?.soundcloud?.count || 0),
      tracks: tree?.streaming?.soundcloud?.tracks ?? [],
      filteredTracks: (tree?.streaming?.soundcloud?.tracks ?? []).filter((track) =>
        !treeSearchQuery || track.title.toLowerCase().includes(treeSearchQuery.toLowerCase())
      ),
    },
    {
      sectionKey: 'spotify',
      scopeType: 'spotify',
      trackScopeType: 'spotify-track',
      label: 'Spotify',
      badge: 'SP',
      badgeClassName: 'bg-emerald-500/20 text-emerald-300',
      count: Number(tree?.streaming?.spotify?.count || 0),
      tracks: tree?.streaming?.spotify?.tracks ?? [],
      filteredTracks: (tree?.streaming?.spotify?.tracks ?? []).filter((track) =>
        !treeSearchQuery || track.title.toLowerCase().includes(treeSearchQuery.toLowerCase())
      ),
    },
    {
      sectionKey: 'bandcamp',
      scopeType: 'bandcamp',
      trackScopeType: 'bandcamp-track',
      label: 'Bandcamp',
      badge: 'BC',
      badgeClassName: 'bg-sky-500/20 text-sky-300',
      count: Number(tree?.streaming?.bandcamp?.count || 0),
      tracks: tree?.streaming?.bandcamp?.tracks ?? [],
      filteredTracks: (tree?.streaming?.bandcamp?.tracks ?? []).filter((track) =>
        !treeSearchQuery || track.title.toLowerCase().includes(treeSearchQuery.toLowerCase())
      ),
    },
  ].filter((section): section is StreamingSection => section.count > 0)
  const filteredLibrarySources = (tree?.libraries ?? []).filter((library) =>
    !treeSearchQuery || library.name.toLowerCase().includes(treeSearchQuery.toLowerCase())
  )

  const filterFolderTree = (nodes: MyFolderNode[]): MyFolderNode[] => {
    if (!treeSearchQuery) return nodes

    return nodes.filter(node => {
      const matchesSearch = node.name.toLowerCase().includes(treeSearchQuery.toLowerCase())
      const hasMatchingChildren = node.children && node.children.length > 0 &&
        filterFolderTree(node.children).length > 0
      return matchesSearch || hasMatchingChildren
    }).map(node => ({
      ...node,
      children: filterFolderTree(node.children)
    }))
  }

  const filterSourceFolderNodes = (nodes: SourceFolderNode[]): SourceFolderNode[] => {
    if (!treeSearchQuery) return nodes

    return nodes.filter(node => {
      const matchesSearch = node.name.toLowerCase().includes(treeSearchQuery.toLowerCase())
      const hasMatchingChildren = node.children && node.children.length > 0 &&
        filterSourceFolderNodes(node.children).length > 0
      return matchesSearch || hasMatchingChildren
    }).map(node => ({
      ...node,
      children: filterSourceFolderNodes(node.children)
    }))
  }

  const filteredFolders = tree ? filterSourceFolderNodes(tree.folders ?? []) : []
  const foldersByCollection = (() => {
    const map = new Map<number | null, Folder[]>()
    for (const folder of folders) {
      const key = folder.collectionId ?? null
      const list = map.get(key) || []
      list.push(folder)
      map.set(key, list)
    }
    return map
  })()

  const knownCollectionIds = new Set(collections.map((p) => p.id))
  const orphanCollectionIds = Array.from(foldersByCollection.keys())
    .filter((id): id is number => id !== null && !knownCollectionIds.has(id))
    .sort((a, b) => a - b)

  const collectionEntries = [
    ...collections.map(p => ({ id: p.id, name: p.name, isUngrouped: false })),
    ...orphanCollectionIds.map(id => ({ id, name: `Collection ${id}`, isUngrouped: false })),
    ...(foldersByCollection.has(null) ? [{ id: null, name: 'Ungrouped', isUngrouped: true }] : []),
  ]

  const collectionTrees = collectionEntries.map(entry => {
    const list = foldersByCollection.get(entry.id) || []
    const tree = buildFolderTree(list)
    const filtered = filterFolderTree(tree)
    return { ...entry, tree, filtered }
  })
  const aggregateMyFolderCountsById = (() => {
    const countsById = new Map<number, number>()

    const accumulateNodeCount = (node: MyFolderNode): number => {
      let total = Number(node.sliceCount || 0)
      for (const child of node.children) {
        total += accumulateNodeCount(child)
      }
      countsById.set(node.id, total)
      return total
    }

    for (const entry of collectionTrees) {
      for (const root of entry.tree) {
        accumulateNodeCount(root)
      }
    }

    return countsById
  })()

  const totalYouTubeSlices = (tree?.youtube ?? []).reduce((sum, v) => sum + Number(v.sliceCount || 0), 0)
  const totalImportedFolderSlices = (tree?.folders ?? []).reduce((sum, f) => sum + Number(f.sampleCount || 0), 0)
  const totalLibrarySourceSlices = (tree?.libraries ?? []).reduce((sum, l) => sum + Number(l.sampleCount || 0), 0)

  const selectedSourceFolderPath = currentScope.type === 'folder' ? currentScope.path : null
  const folderById = new Map<number, Folder>(folders.map((folder) => [folder.id, folder]))
  const selectedMyFolderId = currentScope.type === 'my-folder' ? currentScope.folderId : null
  const selectedMyFolderAncestorIds = new Set<number>()
  let selectedMyFolderCollectionId: number | null = null

  if (selectedMyFolderId !== null) {
    const selectedFolder = folderById.get(selectedMyFolderId)
    if (selectedFolder) {
      selectedMyFolderCollectionId = selectedFolder.collectionId ?? null
      let parentId = selectedFolder.parentId
      while (parentId !== null) {
        selectedMyFolderAncestorIds.add(parentId)
        parentId = folderById.get(parentId)?.parentId ?? null
      }
    }
  }
  const hasSelectedMyFolder = selectedMyFolderId !== null && folderById.has(selectedMyFolderId)

  const sourceFolderContainsActivePath = (path: string): boolean => {
    if (!selectedSourceFolderPath || selectedSourceFolderPath === path) return false
    const pathWithSlash = path.endsWith('/') ? path : `${path}/`
    return selectedSourceFolderPath.startsWith(pathWithSlash)
  }

  type SelectionMarkerState = 'none' | 'active' | 'contains-active'

  const SelectionMarker = ({
    state,
    activeClassName = 'text-accent-warm',
    containsClassName = 'text-accent-primary/70',
  }: {
    state: SelectionMarkerState
    activeClassName?: string
    containsClassName?: string
  }) => (
    <span
      aria-hidden="true"
      className={`w-3.5 shrink-0 flex items-center justify-center transition-opacity ${
        state === 'none' ? 'opacity-0' : 'opacity-100'
      }`}
    >
      {state === 'active' ? (
        <CircleDot size={11} className={activeClassName} />
      ) : state === 'contains-active' ? (
        <Circle size={9} className={containsClassName} />
      ) : null}
    </span>
  )

  const renderSourceFolderNode = (node: SourceFolderNode, depth: number = 0) => {
    const isExpanded = expandedSourceFolders.has(node.path)
    const hasChildren = node.children && node.children.length > 0
    const scope: SourceScope = { type: 'folder', path: node.path }
    const active = isActive(scope)
    const markerState: SelectionMarkerState = active
      ? 'active'
      : sourceFolderContainsActivePath(node.path)
      ? 'contains-active'
      : 'none'

    return (
      <div key={node.path}>
        <button
          onClick={() => onScopeChange(scope)}
          className={`group w-full min-h-6 flex items-center gap-1.5 pl-1.5 pr-0.5 py-0.5 text-[12px] rounded-sm transition-colors ${
            active
              ? 'bg-accent-warm/12 text-accent-warm'
              : 'text-text-secondary hover:bg-surface-overlay hover:text-text-primary'
          }`}
          style={{ paddingLeft: `${(depth + 2) * 10}px` }}
        >
          <SelectionMarker state={markerState} />
          {hasChildren ? (
            <span
              role="button"
              tabIndex={0}
              className="p-0.5 hover:text-white"
              onClick={(e) => {
                e.stopPropagation()
                toggleSourceFolder(node.path)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  e.stopPropagation()
                  toggleSourceFolder(node.path)
                }
              }}
              aria-label={isExpanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
            >
              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </span>
          ) : (
            <span className="w-3.5" />
          )}
          <FolderOpen size={14} className={active ? 'text-accent-primary' : 'text-slate-400'} />
          <span className="flex-1 text-left truncate">{node.name}</span>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {onCreateImportedFolder && (
              <span
                role="button"
                tabIndex={0}
                className="p-0.5 rounded text-slate-400 opacity-0 group-hover:opacity-100 hover:text-white hover:bg-surface-overlay transition-all"
                onClick={(e) => {
                  e.stopPropagation()
                  startCreateImportedFolder(node.path)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    e.stopPropagation()
                    startCreateImportedFolder(node.path)
                  }
                }}
                aria-label={`Create folder inside ${node.name}`}
                title={`Create folder inside ${node.name}`}
              >
                <FolderPlus size={12} />
              </span>
            )}
            {onDeleteSource && (
              <span
                role="button"
                tabIndex={0}
                className="p-0.5 rounded text-slate-400 opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-surface-overlay transition-all"
                onClick={(e) => {
                  e.stopPropagation()
                  onDeleteSource(`folder:${node.path}`, `imported folder "${node.name}"`)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    e.stopPropagation()
                    onDeleteSource(`folder:${node.path}`, `imported folder "${node.name}"`)
                  }
                }}
                aria-label={`Delete imported folder source ${node.name}`}
                title={`Delete imported folder source ${node.name}`}
              >
                <Trash2 size={12} />
              </span>
            )}
            <span className="min-w-[3ch] text-right text-xs tabular-nums text-slate-500">
              {Number(node.sampleCount || 0)}
            </span>
          </div>
        </button>
        {isExpanded && hasChildren && (
          <div>
            {node.children.map(child => renderSourceFolderNode(child, depth + 1))}
          </div>
        )}
        {creatingImportedFolderParentPath === node.path && onCreateImportedFolder && (
          <div className="px-2 py-1" style={{ paddingLeft: `${(depth + 3) * 12}px` }}>
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={newImportedFolderName}
                onChange={(e) => setNewImportedFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submitCreateImportedFolder()
                  if (e.key === 'Escape') cancelCreateImportedFolder()
                }}
                placeholder="New subfolder..."
                className="flex-1 px-2 py-1 text-sm bg-surface-base border border-surface-border rounded text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary"
                autoFocus
              />
              <button
                onClick={() => void submitCreateImportedFolder()}
                disabled={isCreatingImportedFolder || !newImportedFolderName.trim()}
                className="px-2 py-1 text-xs bg-accent-primary text-white rounded hover:bg-accent-primary/80 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Create
              </button>
              <button
                onClick={cancelCreateImportedFolder}
                disabled={isCreatingImportedFolder}
                className="px-2 py-1 text-xs bg-slate-700 text-slate-300 rounded hover:bg-slate-600 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
            {importedFolderError && (
              <div className="mt-1 text-xs text-red-400">{importedFolderError}</div>
            )}
          </div>
        )}
      </div>
    )
  }

  const renderLibrarySourceNode = (library: SourceLibraryNode) => {
    const scope: SourceScope = { type: 'library', libraryId: library.id }
    const active = isActive(scope)

    return (
      <div
        key={library.id}
        className={`group flex min-w-0 items-center gap-1.5 min-h-6 pl-7 pr-0.5 rounded-sm transition-colors ${
          active
            ? 'bg-accent-warm/12 text-accent-warm'
            : 'text-text-secondary hover:bg-surface-overlay hover:text-text-primary'
        }`}
      >
        <SelectionMarker state={active ? 'active' : 'none'} />
        <button
          type="button"
          onClick={() => onScopeChange(scope)}
          className="flex min-w-0 flex-1 items-center gap-1.5 py-0.5 text-[12px] text-left"
          title={library.name}
        >
          <Database size={14} className="text-cyan-400 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-left">{library.name}</span>
        </button>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {onDeleteSource && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onDeleteSource(`library:${library.id}`, `library source "${library.name}"`)
              }}
              className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-surface-base transition-all"
              title={`Delete library source ${library.name}`}
              aria-label={`Delete library source ${library.name}`}
            >
              <Trash2 size={12} className="text-red-400" />
            </button>
          )}
          <span className="min-w-[3ch] text-right text-xs tabular-nums text-slate-500">
            {Number(library.sampleCount || 0)}
          </span>
        </div>
      </div>
    )
  }


  const colors = [
    '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16',
    '#22c55e', '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9',
    '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef',
    '#ec4899', '#f43f5e', '#64748b'
  ]

  const renderMyFolderNode = (node: MyFolderNode, depth: number = 0) => {
    const scope: SourceScope = { type: 'my-folder', folderId: node.id }
    const active = isActive(scope)
    const containsActiveDescendant = selectedMyFolderAncestorIds.has(node.id)
    const markerState: SelectionMarkerState = active
      ? 'active'
      : containsActiveDescendant
      ? 'contains-active'
      : 'none'
    const isEditing = editingFolderId === node.id
    const isExpanded = expandedFolders.has(node.id)
    const hasChildren = node.children && node.children.length > 0
    const isDragOver = dropTargetId === node.id
    const isDragging = draggedFolderId === node.id

    // Highlight self when dropping inside
    const shouldHighlightSelf = isDragOver && dropPosition === 'inside' && draggedFolderId !== null

    if (isEditing) {
      return (
        <div key={node.id} className="px-2 py-1" style={{ paddingLeft: `${depth * 16 + 8}px` }}>
          <input
            type="text"
            value={editingFolderName}
            onChange={(e) => setEditingFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRenameFolder(node.id)
              if (e.key === 'Escape') {
                setEditingFolderId(null)
                setEditingFolderName('')
              }
            }}
            onBlur={() => handleRenameFolder(node.id)}
            className="w-full px-2 py-1 text-sm bg-surface-base border border-surface-border rounded text-white focus:outline-none focus:border-accent-primary"
            autoFocus
          />
        </div>
      )
    }

    return (
      <div key={node.id} className="relative">
        {/* Drop indicator - BEFORE */}
        {isDragOver && dropPosition === 'before' && (
          <div className="absolute left-0 right-0 -top-[2px] h-[3px] bg-accent-warm rounded-full shadow-lg shadow-accent-warm/40 z-10 animate-pulse" />
        )}

        <div
          className="relative group"
          draggable
          onDragStart={(e) => handleDragStart(e, node.id)}
          onDragEnd={() => {
            setDraggedFolderId(null)
            setDropTargetId(null)
            setDropPosition(null)
            setDropTargetCollection(null)
            if (expandTimerRef.current !== null) {
              clearTimeout(expandTimerRef.current)
              expandTimerRef.current = null
            }
            lastHoveredIdRef.current = null
          }}
          onDragOver={(e) => handleDragOver(e, node.id, hasChildren)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, node.id)}
        >
          <button
            draggable={false}
            onClick={() => {
              if (node.collectionId !== null && onCollectionChange && node.collectionId !== activeCollectionId) {
                onCollectionChange(node.collectionId)
              }
              onScopeChange(scope)
            }}
            className={`group/folder w-full flex items-center gap-2 text-sm rounded-md transition-colors relative ${
              active
                ? 'bg-accent-warm/12 text-accent-warm'
                : shouldHighlightSelf
                ? 'bg-accent-warm/20 outline outline-2 outline-accent-warm/50'
                : 'text-text-secondary hover:bg-surface-overlay hover:text-text-primary'
            } ${isDragging ? 'opacity-40 cursor-grabbing' : ''}`}
            style={{ paddingLeft: `${depth * 16 + 8}px` }}
          >
            <SelectionMarker state={markerState} />
            {hasChildren ? (
              <span
                role="button"
                tabIndex={0}
                className="p-0.5 hover:text-white"
                onClick={(e) => {
                  e.stopPropagation()
                  toggleFolder(node.id)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    e.stopPropagation()
                    toggleFolder(node.id)
                  }
                }}
                aria-label={isExpanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
              >
                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </span>
            ) : (
              <span className="w-3.5" />
            )}
            <FolderOpen size={14} style={{ color: node.color }} />
            <span className="flex-1 text-left truncate">{node.name}</span>
            {isDragOver && dropPosition === 'inside' && (
              <span className="text-[10px] text-accent-warm mr-1 font-semibold animate-pulse">
                drop inside
              </span>
            )}
            {isDragOver && dropPosition === 'before' && (
              <span className="text-[10px] text-accent-warm mr-1 font-semibold animate-pulse">
                drop above
              </span>
            )}
            {isDragOver && dropPosition === 'after' && (
              <span className="text-[10px] text-accent-warm mr-1 font-semibold animate-pulse">
                drop below
              </span>
            )}
            <span className={`text-xs text-slate-500 transition-opacity ${draggedFolderId !== null && !isDragOver && !isDragging ? 'opacity-0' : ''} group-hover:opacity-0`}>
              {Number(aggregateMyFolderCountsById.get(node.id) ?? node.sliceCount ?? 0)}
            </span>
          </button>

          {/* Context menu button */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              setContextMenuId(contextMenuId === node.id ? null : node.id)
            }}
            className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-surface-base transition-all"
          >
            <MoreVertical size={14} className="text-slate-400" />
          </button>

          {/* Context menu */}
          {contextMenuId === node.id && (
            <div
              ref={contextMenuRef}
              className="absolute right-0 top-full mt-1 z-20 w-44 bg-surface-overlay/95 backdrop-blur-sm border border-surface-border rounded-xl shadow-xl overflow-hidden"
            >
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setEditingFolderId(node.id)
                  setEditingFolderName(node.name)
                  setContextMenuId(null)
                }}
                className="w-full px-3 py-2 text-left text-sm text-text-secondary hover:bg-surface-raised hover:text-text-primary flex items-center gap-2 transition-colors"
              >
                <Pencil size={12} />
                Rename
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setColorPickerFolderId(node.id)
                  setContextMenuId(null)
                }}
                className="w-full px-3 py-2 text-left text-sm text-text-secondary hover:bg-surface-raised hover:text-text-primary flex items-center gap-2 transition-colors"
              >
                <Palette size={12} />
                Change Color
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  if (node.collectionId !== null && onCollectionChange && node.collectionId !== activeCollectionId) {
                    onCollectionChange(node.collectionId)
                  }
                  setIsCreatingFolder(true)
                  setCreatingUnderParentId(node.id)
                  setContextMenuId(null)
                  // Expand to show new subfolder
                  setExpandedFolders(prev => new Set(prev).add(node.id))
                }}
                className="w-full px-3 py-2 text-left text-sm text-text-secondary hover:bg-surface-raised hover:text-text-primary flex items-center gap-2 transition-colors"
              >
                <FolderPlus size={12} />
                Add Subfolder
              </button>
              {onCreateTagFromFolder && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setCreateTagFromId(node.id)
                    setCreateTagName(node.name)
                    setContextMenuId(null)
                  }}
                  className="w-full px-3 py-2 text-left text-sm text-text-secondary hover:bg-surface-raised hover:text-text-primary flex items-center gap-2 transition-colors"
                >
                  <Tag size={12} />
                  Create Instrument from Folder
                </button>
              )}
              {onDeleteFolder && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onDeleteFolder(node.id)
                    setContextMenuId(null)
                  }}
                  className="w-full px-3 py-2 text-left text-sm text-red-400 hover:bg-surface-base flex items-center gap-2"
                >
                  <Trash2 size={12} />
                  Delete
                </button>
              )}
            </div>
          )}

          {/* Create instrument from folder confirmation */}
          {createTagFromId === node.id && (
            <div
              className="absolute right-0 top-full mt-1 z-20 w-52 p-2 bg-surface-raised border border-surface-border rounded-lg shadow-xl space-y-2"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-xs text-slate-400 font-medium">Create instrument from folder</div>
              <input
                type="text"
                value={createTagName}
                onChange={(e) => setCreateTagName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && createTagName.trim()) {
                    onCreateTagFromFolder!(node.id, createTagName.trim(), node.color)
                    setCreateTagFromId(null)
                    setCreateTagName('')
                  }
                  if (e.key === 'Escape') {
                    setCreateTagFromId(null)
                    setCreateTagName('')
                  }
                }}
                placeholder="Instrument name..."
                className="w-full px-2 py-1.5 text-sm bg-surface-base border border-surface-border rounded text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary"
                autoFocus
              />
              <div className="flex gap-1">
                <button
                  onClick={() => {
                    if (createTagName.trim()) {
                      onCreateTagFromFolder!(node.id, createTagName.trim(), node.color)
                      setCreateTagFromId(null)
                      setCreateTagName('')
                    }
                  }}
                  disabled={!createTagName.trim()}
                  className="flex-1 px-2 py-1 text-xs bg-accent-primary text-white rounded hover:bg-accent-primary/80 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Create
                </button>
                <button
                  onClick={() => {
                    setCreateTagFromId(null)
                    setCreateTagName('')
                  }}
                  className="px-2 py-1 text-xs bg-slate-700 text-slate-300 rounded hover:bg-slate-600"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Color picker */}
          {colorPickerFolderId === node.id && (
            <div
              ref={colorPickerRef}
              className="absolute right-0 top-full mt-1 z-20 p-2 bg-surface-raised border border-surface-border rounded-lg shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="grid grid-cols-6 gap-1.5">
                {colors.map(color => (
                  <button
                    key={color}
                    onClick={() => handleChangeColor(node.id, color)}
                    className={`w-6 h-6 rounded border-2 transition-all hover:scale-110 ${
                      node.color === color ? 'border-white' : 'border-transparent'
                    }`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Drop indicator - AFTER */}
        {isDragOver && dropPosition === 'after' && (
          <div className="absolute left-0 right-0 -bottom-[2px] h-[3px] bg-accent-warm rounded-full shadow-lg shadow-accent-warm/40 z-10 animate-pulse" />
        )}

        {/* Render children */}
        {isExpanded && hasChildren && (
          <div>
            {node.children.map(child => renderMyFolderNode(child, depth + 1))}
          </div>
        )}

        {/* Creating subfolder under this node */}
        {isCreatingFolder && creatingUnderParentId === node.id && (
          <div className="px-2 py-1" style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}>
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateFolder(node.id)
                if (e.key === 'Escape') {
                  setIsCreatingFolder(false)
                  setNewFolderName('')
                  setCreatingUnderParentId(null)
                }
              }}
              onBlur={() => {
                if (newFolderName.trim()) {
                  handleCreateFolder(node.id)
                } else {
                  setIsCreatingFolder(false)
                  setNewFolderName('')
                  setCreatingUnderParentId(null)
                }
              }}
              placeholder="Subfolder name..."
              className="w-full px-2 py-1 text-sm bg-surface-base border border-surface-border rounded text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary"
              autoFocus
            />
          </div>
        )}
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="p-4 text-slate-400 text-sm">
        Loading sources...
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Search bar */}
      <div className="p-2 border-b border-surface-border">
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
            <input
              type="text"
              value={treeSearchQuery}
              onChange={(e) => setTreeSearchQuery(e.target.value)}
              placeholder="Filter sources..."
              className="w-full pl-7 pr-2 py-1.5 text-sm bg-surface-base border border-surface-border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-primary/50 transition-colors"
            />
          </div>

          {onToggleFavoritesOnly && (
            <button
              type="button"
              onClick={onToggleFavoritesOnly}
              className={`inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border transition-colors ${
                showFavoritesOnly
                  ? 'bg-amber-500/20 text-amber-400 border-amber-500/40'
                  : 'bg-surface-base text-slate-400 hover:text-slate-300 border-surface-border'
              }`}
              title={showFavoritesOnly ? 'Showing favorites' : 'Show favorites only'}
              aria-label={showFavoritesOnly ? 'Showing favorites' : 'Show favorites only'}
            >
              <Heart size={14} className={showFavoritesOnly ? 'fill-current' : ''} />
            </button>
          )}
        </div>
      </div>

      <div ref={sectionsContainerRef} className="flex-1 min-h-0 flex flex-col">
        {/* SOURCES Section */}
        <div
          className={sourcesCollectionsPanel.isDragging ? 'panel-animate dragging min-h-0 overflow-hidden' : 'panel-animate min-h-0 overflow-hidden'}
          style={{ height: sourcesCollectionsPanel.size }}
        >
          <div className="h-full overflow-y-auto px-2 py-2">
            {/* Section Header: SOURCES */}
            <div className="flex items-center gap-1 px-1.5 py-1">
              <button
                onClick={() => toggleSection('sources')}
                className="flex-1 flex items-center gap-1.5 section-label hover:text-text-secondary transition-colors text-left"
              >
                {expandedSections.has('sources') ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                Sources
              </button>
            </div>

            {expandedSections.has('sources') && (
              <div className="space-y-px rounded-md border-surface-border/70 bg-surface-base/20 p-0.5">
              <AddSourceMenu onOpenLibraryImport={onOpenLibraryImport} />

              {(() => {
                const showAllActive = isActive({ type: 'all' })
                return (
                  <button
                    onClick={() => onScopeChange({ type: 'all' })}
                    className={`w-full min-h-6 px-1.5 py-0.5 text-[12px] rounded-sm transition-colors flex items-center gap-1.5 ${
                      showAllActive
                        ? 'bg-accent-warm/12 text-accent-warm'
                        : 'text-text-secondary hover:text-text-primary hover:bg-surface-overlay'
                    }`}
                  >
                    <SelectionMarker state={showAllActive ? 'active' : 'none'} />
                    <span className="text-left">Show all</span>
                  </button>
                )
              })()}

              {/* YouTube Section */}
              <div>
                {(() => {
                  const youtubeSectionActive = currentScope.type === 'youtube'
                  const youtubeSectionContainsActive = currentScope.type === 'youtube-video'
                  return (
                    <div
                      className={`group flex min-w-0 items-center gap-1 rounded-sm min-h-6 transition-colors ${
                        youtubeSectionActive || youtubeSectionContainsActive
                          ? 'bg-red-500/15 text-red-400'
                          : 'text-text-secondary hover:bg-surface-overlay hover:text-text-primary'
                      }`}
                    >
                      <SelectionMarker
                        state={youtubeSectionActive ? 'active' : youtubeSectionContainsActive ? 'contains-active' : 'none'}
                        activeClassName="text-red-400"
                        containsClassName="text-red-400/70"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          toggleSection('youtube')
                        }}
                        className="p-0.5 rounded text-slate-500 hover:text-slate-200"
                        aria-label={expandedSections.has('youtube') ? 'Collapse YouTube' : 'Expand YouTube'}
                      >
                        {expandedSections.has('youtube') ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                      <button
                        type="button"
                        onClick={() => onScopeChange({ type: 'youtube' })}
                        className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[12px]"
                      >
                        <Youtube size={14} className="text-red-500" />
                        <span className="flex-1 truncate text-left">YouTube</span>
                      </button>
                      <div className="ml-auto flex shrink-0 items-center gap-1">
                        <span className="min-w-[3ch] text-right text-xs tabular-nums text-slate-500">
                          {totalYouTubeSlices}
                        </span>
                      </div>
                    </div>
                  )
                })()}

                {expandedSections.has('youtube') && filteredYouTubeVideos.map(video => {
                  const scope: SourceScope = { type: 'youtube-video', trackId: video.id }
                  const active = isActive(scope)
                  return (
                    <div
                      key={video.id}
                      className={`flex min-w-0 items-center gap-1.5 min-h-6 pl-7 pr-0.5 rounded-sm transition-colors ${
                        active
                          ? 'bg-accent-primary/20 text-accent-primary'
                          : 'text-slate-300 hover:bg-surface-base'
                      }`}
                    >
                      <SelectionMarker
                        state={active ? 'active' : 'none'}
                        activeClassName="text-accent-primary"
                      />
                      <button
                        type="button"
                        onClick={() => onScopeChange(scope)}
                        className="flex min-w-0 flex-1 items-center gap-1.5 py-0.5 text-[12px]"
                      >
                        {video.thumbnailUrl && (
                          <img
                            src={video.thumbnailUrl}
                            alt=""
                            className="w-6 h-4 shrink-0 object-cover rounded"
                          />
                        )}
                        <span className="min-w-0 flex-1 truncate text-left text-[11px]">{video.title}</span>
                      </button>
                      <div className="ml-auto flex shrink-0 items-center gap-1">
                        <span className="min-w-[3ch] text-right text-xs tabular-nums text-slate-500">
                          {Number(video.sliceCount || 0)}
                        </span>
                      </div>
                    </div>
                  )
                })}
                {expandedSections.has('youtube') && treeSearchQuery && filteredYouTubeVideos.length === 0 && (
                  <div className="pl-8 pr-2 py-2 text-xs text-slate-500 italic">
                    No videos found
                  </div>
                )}
              </div>

              {streamingSections.map((section) => {
                const sectionActive = currentScope.type === section.scopeType
                const sectionContainsActive = currentScope.type === section.trackScopeType
                const sectionMarkerState: SelectionMarkerState = sectionActive
                  ? 'active'
                  : sectionContainsActive
                  ? 'contains-active'
                  : 'none'

                return (
                  <div key={section.sectionKey}>
                    <div
                      className={`group flex min-w-0 items-center gap-1 rounded-sm min-h-6 transition-colors ${
                        sectionActive || sectionContainsActive
                          ? 'bg-accent-warm/12 text-accent-warm'
                          : 'text-text-secondary hover:bg-surface-overlay hover:text-text-primary'
                      }`}
                    >
                      <SelectionMarker state={sectionMarkerState} />
                      <button
                        type="button"
                        onClick={() => {
                          toggleSection(section.sectionKey)
                        }}
                        className="p-0.5 rounded text-slate-500 hover:text-slate-200"
                        aria-label={expandedSections.has(section.sectionKey) ? `Collapse ${section.label}` : `Expand ${section.label}`}
                      >
                        {expandedSections.has(section.sectionKey) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                      <button
                        type="button"
                        onClick={() => onScopeChange({ type: section.scopeType })}
                        className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[12px]"
                      >
                        <span
                          className={`inline-flex h-4 min-w-[1.25rem] items-center justify-center rounded px-1 text-[9px] font-semibold ${section.badgeClassName}`}
                        >
                          {section.badge}
                        </span>
                        <span className="flex-1 truncate text-left">{section.label}</span>
                      </button>
                      <div className="ml-auto flex shrink-0 items-center gap-1">
                        <span className="min-w-[3ch] text-right text-xs tabular-nums text-slate-500">
                          {section.count}
                        </span>
                      </div>
                    </div>

                    {expandedSections.has(section.sectionKey) && section.filteredTracks.map((track) => {
                      const scope: SourceScope = { type: section.trackScopeType, trackId: track.id }
                      const active = isActive(scope)
                      return (
                        <div
                          key={track.id}
                          className={`flex min-w-0 items-center gap-1.5 min-h-6 pl-7 pr-0.5 rounded-sm transition-colors ${
                            active
                              ? 'bg-accent-primary/20 text-accent-primary'
                              : 'text-slate-300 hover:bg-surface-base'
                          }`}
                        >
                          <SelectionMarker
                            state={active ? 'active' : 'none'}
                            activeClassName="text-accent-primary"
                          />
                          <button
                            type="button"
                            onClick={() => onScopeChange(scope)}
                            className="flex min-w-0 flex-1 items-center gap-1.5 py-0.5 text-[12px]"
                          >
                            {track.thumbnailUrl && (
                              <img
                                src={track.thumbnailUrl}
                                alt=""
                                className="w-6 h-4 shrink-0 object-cover rounded"
                              />
                            )}
                            <span className="min-w-0 flex-1 truncate text-left text-[11px]">{track.title}</span>
                          </button>
                          <div className="ml-auto flex shrink-0 items-center gap-1">
                            <span className="min-w-[3ch] text-right text-xs tabular-nums text-slate-500">
                              {Number(track.sliceCount || 0)}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                    {expandedSections.has(section.sectionKey) && treeSearchQuery && section.filteredTracks.length === 0 && (
                      <div className="pl-8 pr-2 py-2 text-xs text-slate-500 italic">
                        No {section.label.toLowerCase()} tracks found
                      </div>
                    )}
                  </div>
                )
              })}

              {/* Local Samples */}
              {(() => {
                const localActive = isActive({ type: 'local' })
                return (
                  <div
                    className={`flex items-center gap-1.5 pl-1.5 pr-0.5 py-0.5 min-h-6 rounded-sm transition-colors ${
                      localActive
                        ? 'bg-accent-warm/12 text-accent-warm'
                        : 'text-text-secondary hover:bg-surface-overlay hover:text-text-primary'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onScopeChange({ type: 'local' })}
                      className="flex flex-1 items-center gap-1.5 text-[12px] text-left"
                    >
                      <SelectionMarker state={localActive ? 'active' : 'none'} />
                      <Music2 size={14} className="text-emerald-500" />
                      <span className="flex-1 text-left">Local Samples</span>
                    </button>
                    <div className="ml-auto flex shrink-0 items-center gap-1">
                      <span className="min-w-[3ch] text-right text-xs tabular-nums text-slate-500">
                        {Number(tree?.local?.count || 0)}
                      </span>
                    </div>
                  </div>
                )
              })()}

              {/* Library Sources */}
              {tree?.libraries && tree.libraries.length > 0 && (
                <div>
                  {(() => {
                    const librarySectionContainsActive = currentScope.type === 'library'
                    return (
                      <div
                        className={`flex items-center gap-1 pl-1.5 pr-0.5 py-0.5 min-h-6 text-[12px] rounded-sm transition-colors ${
                          librarySectionContainsActive
                            ? 'bg-accent-warm/12 text-accent-warm'
                            : 'text-text-secondary hover:bg-surface-overlay hover:text-text-primary'
                        }`}
                      >
                        <SelectionMarker state={librarySectionContainsActive ? 'contains-active' : 'none'} />
                        <button
                          type="button"
                          onClick={() => toggleSection('libraries')}
                          className="p-0.5 rounded text-slate-500 hover:text-slate-200"
                          aria-label={expandedSections.has('libraries') ? 'Collapse library sources' : 'Expand library sources'}
                        >
                          {expandedSections.has('libraries') ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                        <div className="flex flex-1 items-center gap-1.5 py-0.5 text-left">
                          <Database size={14} className="text-cyan-400" />
                          <span>Library Sources</span>
                        </div>
                        <span className="min-w-[3ch] text-right text-xs tabular-nums text-slate-500">
                          {totalLibrarySourceSlices}
                        </span>
                      </div>
                    )
                  })()}

                  {expandedSections.has('libraries') && (
                    <div className="ml-2 border-l border-surface-border/60 pl-1">
                      {filteredLibrarySources.map((library) => renderLibrarySourceNode(library))}
                      {treeSearchQuery && filteredLibrarySources.length === 0 && (
                        <div className="pl-8 pr-2 py-2 text-xs text-slate-500 italic">
                          No library sources found
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Imported Folders */}
              {tree?.folders && tree.folders.length > 0 && (
                <div>
                  {(() => {
                    const importedFoldersSectionContainsActive = currentScope.type === 'folder'
                    return (
                      <div
                        className={`flex items-center gap-1 pl-1.5 pr-0.5 py-0.5 min-h-6 text-[12px] rounded-sm transition-colors ${
                          importedFoldersSectionContainsActive
                            ? 'bg-accent-warm/12 text-accent-warm'
                            : 'text-text-secondary hover:bg-surface-overlay hover:text-text-primary'
                        }`}
                      >
                        <SelectionMarker state={importedFoldersSectionContainsActive ? 'contains-active' : 'none'} />
                        <button
                          type="button"
                          onClick={() => toggleSection('folders')}
                          className="p-0.5 rounded text-slate-500 hover:text-slate-200"
                          aria-label={expandedSections.has('folders') ? 'Collapse imported folders' : 'Expand imported folders'}
                        >
                          {expandedSections.has('folders') ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                        <div className="flex flex-1 items-center gap-1.5 py-0.5 text-left">
                          <FolderOpen size={14} className="text-amber-500" />
                          <span>Imported Folders</span>
                        </div>
                        <span className="min-w-[3ch] text-right text-xs tabular-nums text-slate-500">
                          {totalImportedFolderSlices}
                        </span>
                      </div>
                    )
                  })()}

                  {expandedSections.has('folders') && (
                    <div className="ml-2 border-l border-surface-border/60 pl-1">
                      {filteredFolders.map(folder => renderSourceFolderNode(folder))}
                      {treeSearchQuery && filteredFolders.length === 0 && (
                        <div className="pl-8 pr-2 py-2 text-xs text-slate-500 italic">
                          No folders found
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              </div>
            )}

          </div>
        </div>

        <ResizableDivider
          direction="vertical"
          isDragging={sourcesCollectionsPanel.isDragging}
          isCollapsed={sourcesCollectionsPanel.isCollapsed}
          onMouseDown={sourcesCollectionsPanel.dividerProps.onMouseDown}
          onDoubleClick={sourcesCollectionsPanel.dividerProps.onDoubleClick}
          onExpand={sourcesCollectionsPanel.restore}
        />

        {/* COLLECTIONS Section */}
        <div className="min-h-0 flex-1">
          <div className="h-full overflow-y-auto px-2 py-2">
            <div className="flex items-center gap-2 px-2 py-1.5">
              <button
                onClick={() => toggleSection('myfolders')}
                className="flex-1 flex items-center gap-1.5 section-label hover:text-text-secondary transition-colors text-left"
              >
                {expandedSections.has('myfolders') ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                COLLECTIONS
              </button>
              {onOpenAdvancedCategoryManagement && (
                <button
                  onClick={onOpenAdvancedCategoryManagement}
                  className="p-1 rounded text-slate-400 hover:text-white hover:bg-surface-base transition-colors"
                  title="advanced category management"
                  aria-label="advanced category management"
                >
                  <Settings2 size={14} />
                </button>
              )}
              {onCreateCollection && (
                <button
                  onClick={() => {
                    setIsCreatingCollection(true)
                    setNewCollectionName('')
                  }}
                  className="p-1 rounded text-slate-400 hover:text-white hover:bg-surface-base transition-colors"
                  title="new collection"
                  aria-label="new collection"
                >
                  <Plus size={14} />
                </button>
              )}
            </div>

            {expandedSections.has('myfolders') && (
              <div className="space-y-1.5">
                {collectionTrees
                  .filter(entry => !treeSearchQuery || entry.filtered.length > 0)
                  .map(entry => {
                  const key = entry.id === null ? 'ungrouped' : String(entry.id)
                  const isExpanded = treeSearchQuery.trim() ? true : expandedCollections.has(key)
                  const isActiveCollection =
                    entry.id !== null &&
                    currentScope.type === 'collection' &&
                    currentScope.collectionId === entry.id
                  const collectionContainsActiveFolder =
                    hasSelectedMyFolder &&
                    currentScope.type === 'my-folder' &&
                    selectedMyFolderCollectionId === entry.id
                  const collectionMarkerState: SelectionMarkerState = isActiveCollection
                    ? 'active'
                    : collectionContainsActiveFolder
                    ? 'contains-active'
                    : 'none'
                  const isDropTarget = dropTargetCollection === key
                  const collectionIndex = entry.id !== null
                    ? collections.findIndex(p => p.id === entry.id)
                    : -1
                  const canMoveUp = collectionIndex > 0
                  const canMoveDown = collectionIndex >= 0 && collectionIndex < collections.length - 1

                  return (
                    <div key={key} className="relative">
                      <div
                        className={`group relative flex items-center gap-2 rounded-md transition-colors ${
                          isDropTarget ? 'bg-accent-warm/15' : 'hover:bg-surface-overlay'
                        }`}
                        onDragOver={(e) => handleCollectionDragOver(e, key)}
                        onDrop={(e) => handleCollectionDrop(e, key, entry.id)}
                        onDragLeave={handleDragLeave}
                      >
                        <SelectionMarker state={collectionMarkerState} />
                        <button
                          className="p-0.5 text-slate-500 hover:text-slate-300"
                          onClick={() => toggleCollection(key)}
                        >
                          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        </button>
                        <button
                          className={`flex-1 text-left text-xs font-semibold uppercase tracking-wider ${
                            isActiveCollection
                              ? 'text-accent-warm'
                              : collectionContainsActiveFolder
                              ? 'text-accent-warm/80'
                              : 'text-text-secondary'
                          }`}
                          onClick={() => {
                            if (entry.id !== null) {
                              onCollectionChange?.(entry.id)
                              onScopeChange({ type: 'collection', collectionId: entry.id })
                            }
                          }}
                        >
                          {entry.name}
                        </button>
                        {entry.id !== null && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setCollectionContextMenuId(prev => prev === entry.id ? null : entry.id)
                            }}
                            className={`p-1 rounded hover:bg-surface-base transition-all ${
                              collectionContextMenuId === entry.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                            }`}
                            title="Collection options"
                            aria-label="Collection options"
                          >
                            <MoreVertical size={14} className="text-slate-400" />
                          </button>
                        )}

                        {entry.id !== null && collectionContextMenuId === entry.id && (
                          <div
                            ref={collectionContextMenuRef}
                            className="absolute right-0 top-full mt-1 z-20 w-44 bg-surface-overlay/95 backdrop-blur-sm border border-surface-border rounded-xl shadow-xl overflow-hidden"
                          >
                            {onCreateFolder && (
                              <button
                                className="w-full px-3 py-2 text-left text-sm text-text-secondary hover:bg-surface-raised hover:text-text-primary flex items-center gap-2 transition-colors"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  onCollectionChange?.(entry.id)
                                  setIsCreatingFolder(true)
                                  setCreatingUnderParentId(null)
                                  setCollectionContextMenuId(null)
                                }}
                              >
                                <FolderPlus size={12} />
                                Add Folder
                              </button>
                            )}
                            {onMoveCollection && (
                              <>
                                <button
                                  className="w-full px-3 py-2 text-left text-sm text-slate-300 hover:bg-surface-base flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    if (canMoveUp) onMoveCollection(entry.id, 'up')
                                    setCollectionContextMenuId(null)
                                  }}
                                  disabled={!canMoveUp}
                                >
                                  <ChevronUp size={12} />
                                  Move Up
                                </button>
                                <button
                                  className="w-full px-3 py-2 text-left text-sm text-slate-300 hover:bg-surface-base flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    if (canMoveDown) onMoveCollection(entry.id, 'down')
                                    setCollectionContextMenuId(null)
                                  }}
                                  disabled={!canMoveDown}
                                >
                                  <ChevronDown size={12} />
                                  Move Down
                                </button>
                              </>
                            )}
                            {onRenameCollection && (
                              <button
                                className="w-full px-3 py-2 text-left text-sm text-text-secondary hover:bg-surface-raised hover:text-text-primary flex items-center gap-2 transition-colors"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setEditingCollectionId(entry.id)
                                  setEditingCollectionName(entry.name)
                                  setCollectionContextMenuId(null)
                                }}
                              >
                                <Pencil size={12} />
                                Rename
                              </button>
                            )}
                            {onDeleteCollection && (
                              <button
                                className="w-full px-3 py-2 text-left text-sm text-red-400 hover:bg-surface-base flex items-center gap-2"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  onDeleteCollection(entry.id)
                                  setCollectionContextMenuId(null)
                                }}
                              >
                                <Trash2 size={12} />
                                Delete
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      {entry.id !== null && editingCollectionId === entry.id && (
                        <div className="px-2 pb-2">
                          <input
                            type="text"
                            value={editingCollectionName}
                            onChange={(e) => setEditingCollectionName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleRenameCollection(entry.id)
                              if (e.key === 'Escape') {
                                setEditingCollectionId(null)
                                setEditingCollectionName('')
                              }
                            }}
                            onBlur={() => handleRenameCollection(entry.id)}
                            className="w-full px-2 py-1 text-sm bg-surface-base border border-surface-border rounded text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary"
                            autoFocus
                          />
                        </div>
                      )}

                      {isExpanded && (
                        <div
                          onDragOver={(e) => handleCollectionDragOver(e, key)}
                          onDrop={(e) => handleCollectionDrop(e, key, entry.id)}
                          onDragLeave={handleDragLeave}
                          className="rounded-md"
                        >
                          {entry.filtered.map(folder => renderMyFolderNode(folder, 0))}

                          {!treeSearchQuery &&
                            isCreatingFolder &&
                            creatingUnderParentId === null &&
                            entry.id !== null &&
                            activeCollectionId === entry.id && (
                              <div className="px-2 py-1">
                                <input
                                  type="text"
                                  value={newFolderName}
                                  onChange={(e) => setNewFolderName(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleCreateFolder()
                                    if (e.key === 'Escape') {
                                      setIsCreatingFolder(false)
                                      setNewFolderName('')
                                    }
                                  }}
                                  onBlur={() => {
                                    if (newFolderName.trim()) {
                                      handleCreateFolder()
                                    } else {
                                      setIsCreatingFolder(false)
                                    }
                                  }}
                                  placeholder="Folder name..."
                                  className="w-full px-2 py-1 text-sm bg-surface-base border border-surface-border rounded text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary"
                                  autoFocus
                                />
                              </div>
                            )}
                        </div>
                      )}
                    </div>
                  )
                  })}

                {treeSearchQuery && collectionTrees.every(entry => entry.filtered.length === 0) && (
                  <div className="px-2 py-2 text-xs text-slate-500 italic">
                    No folders found
                  </div>
                )}

                {!treeSearchQuery && isCreatingCollection && (
                  <div className="px-2 py-1">
                    <input
                      type="text"
                      value={newCollectionName}
                      onChange={(e) => setNewCollectionName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleCreateCollection()
                        if (e.key === 'Escape') {
                          setIsCreatingCollection(false)
                          setNewCollectionName('')
                        }
                      }}
                      onBlur={() => {
                        if (newCollectionName.trim()) {
                          handleCreateCollection()
                        } else {
                          setIsCreatingCollection(false)
                        }
                      }}
                      placeholder="Collection name..."
                      className="w-full px-2 py-1 text-sm bg-surface-base border border-surface-border rounded text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary"
                      autoFocus
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
