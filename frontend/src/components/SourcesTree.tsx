import { useState, useRef, useEffect } from 'react'
import {
  ChevronRight,
  ChevronDown,
  Youtube,
  FolderOpen,
  Music2,
  Folder,
  Plus,
  MoreVertical,
  Pencil,
  Trash2,
  Search,
  FolderPlus,
  Palette
} from 'lucide-react'
import type { SourceTree, SourceScope, FolderNode, Collection } from '../types'

interface SourcesTreeProps {
  tree: SourceTree | undefined
  collections: Collection[]
  currentScope: SourceScope
  onScopeChange: (scope: SourceScope) => void
  onCreateCollection?: (name: string, parentId?: number) => void
  onRenameCollection?: (id: number, name: string) => void
  onDeleteCollection?: (id: number) => void
  onUpdateCollection?: (id: number, data: { parentId?: number | null; color?: string }) => void
  onBatchAddToCollection?: (collectionId: number, sampleIds: number[]) => void
  isLoading?: boolean
}

interface CollectionNode extends Collection {
  children: CollectionNode[]
}

export function SourcesTree({
  tree,
  collections,
  currentScope,
  onScopeChange,
  onCreateCollection,
  onRenameCollection,
  onDeleteCollection,
  onUpdateCollection,
  onBatchAddToCollection,
  isLoading = false,
}: SourcesTreeProps) {
  // Expanded state for tree nodes
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['sources', 'myfolders']))
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const [expandedCollections, setExpandedCollections] = useState<Set<number>>(new Set())
  const [treeSearchQuery, setTreeSearchQuery] = useState('')

  // Auto-expand YouTube section when tree loads and has videos
  useEffect(() => {
    if (tree && tree.youtube.length > 0) {
      setExpandedSections(prev => {
        const updated = new Set(prev)
        updated.add('youtube')
        return updated
      })
    }
  }, [tree])

  // Collection management state
  const [newCollectionName, setNewCollectionName] = useState('')
  const [isCreatingCollection, setIsCreatingCollection] = useState(false)
  const [creatingUnderParentId, setCreatingUnderParentId] = useState<number | null>(null)
  const [editingCollectionId, setEditingCollectionId] = useState<number | null>(null)
  const [editingCollectionName, setEditingCollectionName] = useState('')
  const [contextMenuId, setContextMenuId] = useState<number | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)

  // Color picker state
  const [colorPickerCollectionId, setColorPickerCollectionId] = useState<number | null>(null)
  const colorPickerRef = useRef<HTMLDivElement>(null)

  // Drag and drop state
  const [draggedCollectionId, setDraggedCollectionId] = useState<number | null>(null)
  const [dropTargetId, setDropTargetId] = useState<number | null>(null)
  const expandTimerRef = useRef<number | null>(null)
  const lastHoveredIdRef = useRef<number | null>(null)

  // Click outside handler for context menu and color picker
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenuId(null)
      }
      if (colorPickerRef.current && !colorPickerRef.current.contains(e.target as Node)) {
        setColorPickerCollectionId(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
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

  const toggleFolder = (path: string) => {
    const newExpanded = new Set(expandedFolders)
    if (newExpanded.has(path)) {
      newExpanded.delete(path)
    } else {
      newExpanded.add(path)
    }
    setExpandedFolders(newExpanded)
  }

  const toggleCollection = (id: number) => {
    const newExpanded = new Set(expandedCollections)
    if (newExpanded.has(id)) {
      newExpanded.delete(id)
    } else {
      newExpanded.add(id)
    }
    setExpandedCollections(newExpanded)
  }

  const isActive = (scope: SourceScope): boolean => {
    if (scope.type !== currentScope.type) return false
    switch (scope.type) {
      case 'youtube-video':
        return currentScope.type === 'youtube-video' && currentScope.trackId === scope.trackId
      case 'folder':
        return currentScope.type === 'folder' && currentScope.path === scope.path
      case 'my-folder':
        return currentScope.type === 'my-folder' && currentScope.collectionId === scope.collectionId
      default:
        return scope.type === currentScope.type
    }
  }

  const handleCreateCollection = (parentId?: number) => {
    if (newCollectionName.trim() && onCreateCollection) {
      onCreateCollection(newCollectionName.trim(), parentId)
      setNewCollectionName('')
      setIsCreatingCollection(false)
      setCreatingUnderParentId(null)
    }
  }

  const handleRenameCollection = (id: number) => {
    if (editingCollectionName.trim() && onRenameCollection) {
      onRenameCollection(id, editingCollectionName.trim())
      setEditingCollectionId(null)
      setEditingCollectionName('')
    }
  }

  const handleChangeColor = (id: number, color: string) => {
    if (onUpdateCollection) {
      onUpdateCollection(id, { color })
    }
    setColorPickerCollectionId(null)
  }

  const handleDragStart = (e: React.DragEvent, collectionId: number) => {
    setDraggedCollectionId(collectionId)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e: React.DragEvent, targetId: number | null, hasChildren?: boolean) => {
    e.preventDefault()
    e.stopPropagation()

    // Check if we're dragging samples or collections
    const data = e.dataTransfer.types.includes('application/json')
    if (data) {
      e.dataTransfer.dropEffect = draggedCollectionId !== null ? 'move' : 'copy'
      setDropTargetId(targetId)

      // Auto-expand folders with children after a delay
      if (hasChildren && targetId !== null && !expandedCollections.has(targetId)) {
        // Only set timer if we've moved to a different folder
        if (lastHoveredIdRef.current !== targetId) {
          // Clear any existing timer
          if (expandTimerRef.current !== null) {
            clearTimeout(expandTimerRef.current)
          }

          lastHoveredIdRef.current = targetId

          // Set new timer to expand after 600ms
          expandTimerRef.current = window.setTimeout(() => {
            setExpandedCollections(prev => new Set(prev).add(targetId))
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
    }
  }

  const handleDrop = (e: React.DragEvent, targetId: number | null) => {
    e.preventDefault()

    try {
      const jsonData = e.dataTransfer.getData('application/json')
      if (jsonData) {
        const data = JSON.parse(jsonData)

        // Handle dropping samples onto a collection
        if (data.type === 'samples' && data.sampleIds && targetId !== null && onBatchAddToCollection) {
          onBatchAddToCollection(targetId, data.sampleIds)
          setDropTargetId(null)
          return
        }
      }
    } catch (err) {
      console.error('Error parsing drag data:', err)
    }

    // Handle moving collections (existing logic)
    if (draggedCollectionId !== null && draggedCollectionId !== targetId && onUpdateCollection) {
      // Prevent moving a folder into itself or its descendants
      const isDescendant = (parentId: number, childId: number): boolean => {
        const child = collections.find(c => c.id === childId)
        if (!child || !child.parentId) return false
        if (child.parentId === parentId) return true
        return isDescendant(parentId, child.parentId)
      }

      if (targetId !== null && isDescendant(draggedCollectionId, targetId)) {
        // Cannot move a folder into its own descendant
        setDraggedCollectionId(null)
        setDropTargetId(null)
        return
      }

      onUpdateCollection(draggedCollectionId, { parentId: targetId })
    }
    setDraggedCollectionId(null)
    setDropTargetId(null)
  }

  // Build collection hierarchy
  const buildCollectionTree = (parentId: number | null = null): CollectionNode[] => {
    return collections
      .filter(c => c.parentId === parentId)
      .map(c => ({
        ...c,
        children: buildCollectionTree(c.id)
      }))
  }

  // Filter tree items based on search
  const filteredYouTubeVideos = tree?.youtube.filter(video =>
    !treeSearchQuery || video.title.toLowerCase().includes(treeSearchQuery.toLowerCase())
  ) || []

  const filterCollectionTree = (nodes: CollectionNode[]): CollectionNode[] => {
    if (!treeSearchQuery) return nodes

    return nodes.filter(node => {
      const matchesSearch = node.name.toLowerCase().includes(treeSearchQuery.toLowerCase())
      const hasMatchingChildren = node.children && node.children.length > 0 &&
        filterCollectionTree(node.children).length > 0
      return matchesSearch || hasMatchingChildren
    }).map(node => ({
      ...node,
      children: filterCollectionTree(node.children)
    }))
  }

  const filterFolderNodes = (nodes: FolderNode[]): FolderNode[] => {
    if (!treeSearchQuery) return nodes

    return nodes.filter(node => {
      const matchesSearch = node.name.toLowerCase().includes(treeSearchQuery.toLowerCase())
      const hasMatchingChildren = node.children && node.children.length > 0 &&
        filterFolderNodes(node.children).length > 0
      return matchesSearch || hasMatchingChildren
    }).map(node => ({
      ...node,
      children: filterFolderNodes(node.children)
    }))
  }

  const filteredFolders = tree ? filterFolderNodes(tree.folders) : []
  const collectionTree = buildCollectionTree()
  const filteredCollectionTree = filterCollectionTree(collectionTree)

  const totalYouTubeSlices = tree?.youtube.reduce((sum, v) => sum + Number(v.sliceCount || 0), 0) || 0
  const totalFolderSlices = tree?.folders.reduce((sum, f) => sum + Number(f.sampleCount || 0), 0) || 0

  const renderFolderNode = (node: FolderNode, depth: number = 0) => {
    const isExpanded = expandedFolders.has(node.path)
    const hasChildren = node.children && node.children.length > 0
    const scope: SourceScope = { type: 'folder', path: node.path }
    const active = isActive(scope)

    return (
      <div key={node.path}>
        <button
          onClick={() => {
            onScopeChange(scope)
            if (hasChildren) toggleFolder(node.path)
          }}
          className={`w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md transition-colors ${
            active
              ? 'bg-accent-primary/20 text-accent-primary'
              : 'text-slate-300 hover:bg-surface-base'
          }`}
          style={{ paddingLeft: `${(depth + 2) * 12}px` }}
        >
          {hasChildren ? (
            isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />
          ) : (
            <span className="w-3.5" />
          )}
          <Folder size={14} className={active ? 'text-accent-primary' : 'text-slate-400'} />
          <span className="flex-1 text-left truncate">{node.name}</span>
          <span className="text-xs text-slate-500">{Number(node.sampleCount || 0)}</span>
        </button>
        {isExpanded && hasChildren && (
          <div>
            {node.children.map(child => renderFolderNode(child, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  const colors = [
    '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16',
    '#22c55e', '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9',
    '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef',
    '#ec4899', '#f43f5e', '#64748b'
  ]

  const renderCollectionNode = (node: CollectionNode, depth: number = 0) => {
    const scope: SourceScope = { type: 'my-folder', collectionId: node.id }
    const active = isActive(scope)
    const isEditing = editingCollectionId === node.id
    const isExpanded = expandedCollections.has(node.id)
    const hasChildren = node.children && node.children.length > 0
    const isDragOver = dropTargetId === node.id
    const isDragging = draggedCollectionId === node.id

    if (isEditing) {
      return (
        <div key={node.id} className="px-2 py-1" style={{ paddingLeft: `${depth * 16 + 8}px` }}>
          <input
            type="text"
            value={editingCollectionName}
            onChange={(e) => setEditingCollectionName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRenameCollection(node.id)
              if (e.key === 'Escape') {
                setEditingCollectionId(null)
                setEditingCollectionName('')
              }
            }}
            onBlur={() => handleRenameCollection(node.id)}
            className="w-full px-2 py-1 text-sm bg-surface-base border border-surface-border rounded text-white focus:outline-none focus:border-accent-primary"
            autoFocus
          />
        </div>
      )
    }

    return (
      <div key={node.id}>
        <div
          className="relative group"
          draggable
          onDragStart={(e) => handleDragStart(e, node.id)}
          onDragEnd={() => {
            setDraggedCollectionId(null)
            setDropTargetId(null)
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
            onClick={() => {
              onScopeChange(scope)
              if (hasChildren) toggleCollection(node.id)
            }}
            className={`group/folder w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md transition-all relative ${
              active
                ? 'bg-accent-primary/20 text-accent-primary'
                : isDragOver
                ? 'bg-indigo-500/30 border-2 border-indigo-400 text-white shadow-lg shadow-indigo-500/50 scale-105'
                : 'text-slate-300 hover:bg-surface-base hover:ring-1 hover:ring-indigo-400/30'
            } ${isDragging ? 'opacity-50' : ''}`}
            style={{ paddingLeft: `${depth * 16 + 8}px` }}
          >
            {hasChildren ? (
              isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />
            ) : (
              <span className="w-3.5" />
            )}
            <Folder size={14} style={{ color: node.color }} />
            <span className="flex-1 text-left truncate">{node.name}</span>
            {/* Drop hint on hover */}
            {!active && !isDragOver && (
              <span className="text-[10px] text-indigo-400/0 group-hover/folder:text-indigo-400/70 transition-colors mr-1">
                drop here
              </span>
            )}
            <span className="text-xs text-slate-500">{Number(node.sliceCount || 0)}</span>
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
              className="absolute right-0 top-full mt-1 z-20 w-40 bg-surface-raised border border-surface-border rounded-lg shadow-xl overflow-hidden"
            >
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setEditingCollectionId(node.id)
                  setEditingCollectionName(node.name)
                  setContextMenuId(null)
                }}
                className="w-full px-3 py-2 text-left text-sm text-slate-300 hover:bg-surface-base flex items-center gap-2"
              >
                <Pencil size={12} />
                Rename
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setColorPickerCollectionId(node.id)
                  setContextMenuId(null)
                }}
                className="w-full px-3 py-2 text-left text-sm text-slate-300 hover:bg-surface-base flex items-center gap-2"
              >
                <Palette size={12} />
                Change Color
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setIsCreatingCollection(true)
                  setCreatingUnderParentId(node.id)
                  setContextMenuId(null)
                  // Expand to show new subfolder
                  setExpandedCollections(prev => new Set(prev).add(node.id))
                }}
                className="w-full px-3 py-2 text-left text-sm text-slate-300 hover:bg-surface-base flex items-center gap-2"
              >
                <FolderPlus size={12} />
                Add Subfolder
              </button>
              {onDeleteCollection && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onDeleteCollection(node.id)
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

          {/* Color picker */}
          {colorPickerCollectionId === node.id && (
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

        {/* Render children */}
        {isExpanded && hasChildren && (
          <div>
            {node.children.map(child => renderCollectionNode(child, depth + 1))}
          </div>
        )}

        {/* Creating subfolder under this node */}
        {isCreatingCollection && creatingUnderParentId === node.id && (
          <div className="px-2 py-1" style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}>
            <input
              type="text"
              value={newCollectionName}
              onChange={(e) => setNewCollectionName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateCollection(node.id)
                if (e.key === 'Escape') {
                  setIsCreatingCollection(false)
                  setNewCollectionName('')
                  setCreatingUnderParentId(null)
                }
              }}
              onBlur={() => {
                if (newCollectionName.trim()) {
                  handleCreateCollection(node.id)
                } else {
                  setIsCreatingCollection(false)
                  setNewCollectionName('')
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
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
          <input
            type="text"
            value={treeSearchQuery}
            onChange={(e) => setTreeSearchQuery(e.target.value)}
            placeholder="Filter sources..."
            className="w-full pl-7 pr-2 py-1.5 text-sm bg-surface-base border border-surface-border rounded text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary transition-colors"
          />
        </div>
      </div>

      {/* SOURCES Section */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-2">
          {/* Section Header: SOURCES */}
          <button
            onClick={() => toggleSection('sources')}
            className="w-full flex items-center gap-2 px-2 py-2 text-xs font-semibold text-slate-400 uppercase tracking-wider hover:text-slate-300 transition-colors"
          >
            {expandedSections.has('sources') ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            Sources
          </button>

          {expandedSections.has('sources') && (
            <div className="space-y-0.5">
              {/* YouTube Section */}
              <div>
                <button
                  onClick={() => {
                    onScopeChange({ type: 'youtube' })
                    toggleSection('youtube')
                  }}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md transition-colors ${
                    isActive({ type: 'youtube' })
                      ? 'bg-red-500/20 text-red-400'
                      : 'text-slate-300 hover:bg-surface-base'
                  }`}
                >
                  {expandedSections.has('youtube') ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <Youtube size={14} className="text-red-500" />
                  <span className="flex-1 text-left">YouTube</span>
                  <span className="text-xs text-slate-500">{totalYouTubeSlices}</span>
                </button>

                {expandedSections.has('youtube') && filteredYouTubeVideos.map(video => {
                  const scope: SourceScope = { type: 'youtube-video', trackId: video.id }
                  const active = isActive(scope)
                  return (
                    <button
                      key={video.id}
                      onClick={() => onScopeChange(scope)}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md transition-colors pl-8 ${
                        active
                          ? 'bg-accent-primary/20 text-accent-primary'
                          : 'text-slate-300 hover:bg-surface-base'
                      }`}
                    >
                      {video.thumbnailUrl && (
                        <img
                          src={video.thumbnailUrl}
                          alt=""
                          className="w-6 h-4 object-cover rounded"
                        />
                      )}
                      <span className="flex-1 text-left truncate text-xs">{video.title}</span>
                      <span className="text-xs text-slate-500">{Number(video.sliceCount || 0)}</span>
                    </button>
                  )
                })}
                {expandedSections.has('youtube') && treeSearchQuery && filteredYouTubeVideos.length === 0 && (
                  <div className="pl-8 pr-2 py-2 text-xs text-slate-500 italic">
                    No videos found
                  </div>
                )}
              </div>

              {/* Local Samples */}
              <button
                onClick={() => onScopeChange({ type: 'local' })}
                className={`w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md transition-colors ${
                  isActive({ type: 'local' })
                    ? 'bg-accent-primary/20 text-accent-primary'
                    : 'text-slate-300 hover:bg-surface-base'
                }`}
              >
                <span className="w-3.5" />
                <Music2 size={14} className="text-emerald-500" />
                <span className="flex-1 text-left">Local Samples</span>
                <span className="text-xs text-slate-500">{Number(tree?.local.count || 0)}</span>
              </button>

              {/* Imported Folders */}
              {tree?.folders && tree.folders.length > 0 && (
                <div>
                  <button
                    onClick={() => toggleSection('folders')}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md transition-colors ${
                      currentScope.type === 'folder'
                        ? 'bg-accent-primary/20 text-accent-primary'
                        : 'text-slate-300 hover:bg-surface-base'
                    }`}
                  >
                    {expandedSections.has('folders') ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <FolderOpen size={14} className="text-amber-500" />
                    <span className="flex-1 text-left">Imported Folders</span>
                    <span className="text-xs text-slate-500">{totalFolderSlices}</span>
                  </button>

                  {expandedSections.has('folders') && (
                    <div>
                      {filteredFolders.map(folder => renderFolderNode(folder))}
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

          {/* Section Header: MY FOLDERS */}
          <button
            onClick={() => toggleSection('myfolders')}
            className="w-full flex items-center gap-2 px-2 py-2 mt-4 text-xs font-semibold text-slate-400 uppercase tracking-wider hover:text-slate-300 transition-colors"
          >
            {expandedSections.has('myfolders') ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            My Folders
          </button>

          {expandedSections.has('myfolders') && (
            <div className="space-y-0.5">
              {/* Drop zone for root level */}
              <div
                onDragOver={(e) => handleDragOver(e, null)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, null)}
                className={`${dropTargetId === null && draggedCollectionId !== null ? 'bg-blue-500/10 border border-blue-500/30 rounded-md py-2' : ''}`}
              >
                {filteredCollectionTree.map(collection => renderCollectionNode(collection, 0))}
              </div>

              {treeSearchQuery && filteredCollectionTree.length === 0 && (
                <div className="px-2 py-2 text-xs text-slate-500 italic">
                  No folders found
                </div>
              )}

              {/* Creating root folder */}
              {!treeSearchQuery && isCreatingCollection && creatingUnderParentId === null && (
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
                    placeholder="Folder name..."
                    className="w-full px-2 py-1 text-sm bg-surface-base border border-surface-border rounded text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary"
                    autoFocus
                  />
                </div>
              )}

              {/* Create new folder button */}
              {!treeSearchQuery && !isCreatingCollection && onCreateCollection && (
                <button
                  onClick={() => {
                    setIsCreatingCollection(true)
                    setCreatingUnderParentId(null)
                  }}
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-slate-400 hover:text-slate-300 hover:bg-surface-base rounded-md transition-colors"
                >
                  <span className="w-3.5" />
                  <Plus size={14} />
                  <span>New Folder</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
