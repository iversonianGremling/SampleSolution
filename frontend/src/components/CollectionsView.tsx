import { useState, useMemo, useCallback } from 'react'
import {
  FolderOpen,
  Plus,
  ChevronRight,
  ChevronDown,
  Trash2,
  Pencil,
  Palette,
  SplitSquareHorizontal,
  LayoutGrid,
  List,
  Check,
  X,
  Layers,
  FolderPlus,
  MoreHorizontal,
  Eye,
  Search,
  Heart,
} from 'lucide-react'
import { SourcesSampleGrid } from './SourcesSampleGrid'
import { SourcesSampleList } from './SourcesSampleList'
import { SourcesDetailModal } from './SourcesDetailModal'
import { SourcesTagFilter } from './SourcesTagFilter'
import { CustomOrderModal } from './CustomOrderModal'
import { SourcesBatchActions } from './SourcesBatchActions'
import { SourcesAudioFilter, AudioFilterState } from './SourcesAudioFilter'
import { useScopedSamples } from '../hooks/useScopedSamples'
import {
  useCollections,
  useCreateCollection,
  useUpdateCollection,
  useDeleteCollection,
  useFolders,
  useCreateFolder,
  useUpdateFolder,
  useDeleteFolder,
  useFolderFacets,
  useCollectionFacets,
  useSplitFolder,
  useSplitCollection,
  useTags,
  useToggleFavorite,
  useAddTagToSlice,
  useRemoveTagFromSlice,
  useAddSliceToFolder,
  useRemoveSliceFromFolder,
  useCreateTag,
  useBatchDeleteSlices,
  useBatchReanalyzeSlices,
  useBatchAddSlicesToFolder,
} from '../hooks/useTracks'
import { getRelatedKeys, getRelatedNotes } from '../utils/musicTheory'
import { getSliceDownloadUrl } from '../api/client'
import type { SourceScope, Folder } from '../types'

const FOLDER_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e',
  '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1',
  '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e', '#64748b',
]

const FACET_LABELS: Record<string, string> = {
  // Tag categories
  general: 'General Tags',
  type: 'Type Tags',
  instrument: 'Instrument Tags',
  tempo: 'Tempo Tags',
  energy: 'Energy Tags',
  spectral: 'Spectral Tags',
  filename: 'Filename Tags',
  // Metadata fields
  instrumentType: 'Instrument Type',
  genrePrimary: 'Genre',
  keyEstimate: 'Key',
  envelopeType: 'Envelope Type',
}

interface FolderNode extends Folder {
  children: FolderNode[]
}

export function FoldersView() {
  // Collection state
  const [activeCollectionId, setActiveCollectionId] = useState<number | null>(null)
  const [showCollectionDropdown, setShowCollectionDropdown] = useState(false)
  const [isCreatingCollection, setIsCreatingCollection] = useState(false)
  const [newCollectionName, setNewCollectionName] = useState('')
  const [editingCollectionId, setEditingCollectionId] = useState<number | null>(null)
  const [editingCollectionName, setEditingCollectionName] = useState('')

  // Folder tree state
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null)
  const [expandedFolders, setExpandedFolders] = useState<Set<number>>(new Set())
  const [isCreatingFolder, setIsCreatingFolder] = useState(false)
  const [creatingUnderParentId, setCreatingUnderParentId] = useState<number | null>(null)
  const [newFolderName, setNewFolderName] = useState('')
  const [editingFolderId, setEditingFolderId] = useState<number | null>(null)
  const [editingFolderName, setEditingFolderName] = useState('')
  const [contextMenuId, setContextMenuId] = useState<number | null>(null)
  const [colorPickerFolderId, setColorPickerFolderId] = useState<number | null>(null)

  // Facet panel state
  const [showFacetPanel, setShowFacetPanel] = useState(false)
  const [selectedFacetType, setSelectedFacetType] = useState<'tag-category' | 'metadata'>('tag-category')
  const [selectedFacetKey, setSelectedFacetKey] = useState<string>('')
  const [selectedFacetValues, setSelectedFacetValues] = useState<Set<string>>(new Set())

  // Content area state
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [selectedSampleId, setSelectedSampleId] = useState<number | null>(null)
  const [selectedSampleIds, setSelectedSampleIds] = useState<Set<number>>(new Set())

  // Filtering state (same as SourcesView)
  const [selectedTags, setSelectedTags] = useState<number[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [minDuration, setMinDuration] = useState<number>(0)
  const [maxDuration, setMaxDuration] = useState<number>(300)
  const [audioFilter, setAudioFilter] = useState<AudioFilterState>({
    sortBy: null,
    sortOrder: 'asc',
    minBpm: 0,
    maxBpm: 300,
    pitchFilterMode: 'fundamental',
    selectedNotes: [],
    relatedNotesLevels: [],
    selectedKeys: [],
    selectedEnvelopeTypes: [],
    minBrightness: 0,
    maxBrightness: 1,
    minWarmth: 0,
    maxWarmth: 1,
    minHardness: 0,
    maxHardness: 1,
    selectedInstruments: [],
    selectedGenres: [],
    relatedKeysLevels: [],
    groupByScaleDegree: false,
  })

  // Compute effective keys (selected + related levels)
  const effectiveKeys = useMemo(() => {
    const keys = [...audioFilter.selectedKeys]
    if (audioFilter.relatedKeysLevels.length > 0) {
      const relatedGroups = getRelatedKeys(audioFilter.selectedKeys)
      for (const group of relatedGroups) {
        if (audioFilter.relatedKeysLevels.includes(group.level)) {
          keys.push(...group.keys)
        }
      }
    }
    return keys
  }, [audioFilter.selectedKeys, audioFilter.relatedKeysLevels])

  // Compute effective notes (selected + related levels)
  const effectiveNotes = useMemo(() => {
    const notes = [...(audioFilter.selectedNotes || [])]
    if ((audioFilter.relatedNotesLevels || []).length > 0) {
      const relatedGroups = getRelatedNotes(audioFilter.selectedNotes || [])
      for (const group of relatedGroups) {
        if (audioFilter.relatedNotesLevels!.includes(group.level)) {
          notes.push(...group.keys)
        }
      }
    }
    return notes
  }, [audioFilter.selectedNotes, audioFilter.relatedNotesLevels])

  // Data hooks
  const { data: collections = [] } = useCollections()
  const { data: folders = [] } = useFolders(
    activeCollectionId ? { collectionId: activeCollectionId } : undefined
  )
  const { data: allTags = [] } = useTags()
  const { data: folderFacets } = useFolderFacets(selectedFolderId)
  const { data: collectionFacets } = useCollectionFacets(
    !selectedFolderId ? activeCollectionId : null
  )
  const facets = selectedFolderId ? folderFacets : collectionFacets

  // Set default collection on first load
  useMemo(() => {
    if (collections.length > 0 && activeCollectionId === null) {
      setActiveCollectionId(collections[0].id)
    }
  }, [collections, activeCollectionId])

  // Sample scope — use collection scope when no folder is selected
  const currentScope: SourceScope = selectedFolderId
    ? { type: 'my-folder', folderId: selectedFolderId }
    : activeCollectionId
      ? { type: 'collection', collectionId: activeCollectionId }
      : { type: 'all' }

  const { data: samplesData } = useScopedSamples(
    currentScope,
    selectedTags,
    searchQuery,
    showFavoritesOnly,
    {
      sortBy: audioFilter.sortBy || undefined,
      sortOrder: audioFilter.sortOrder,
      minBpm: audioFilter.minBpm > 0 ? audioFilter.minBpm : undefined,
      maxBpm: audioFilter.maxBpm < 300 ? audioFilter.maxBpm : undefined,
      keys: audioFilter.pitchFilterMode === 'scale' && effectiveKeys.length > 0 ? effectiveKeys : undefined,
      notes: audioFilter.pitchFilterMode === 'fundamental' && effectiveNotes.length > 0 ? effectiveNotes : undefined,
    }
  )

  const allSamples = samplesData?.samples || []
  const totalCount = samplesData?.total || 0

  // Filter samples by duration and advanced features (same as SourcesView)
  const samples = useMemo(() => {
    return allSamples.filter(sample => {
      const duration = sample.endTime - sample.startTime
      if (duration < minDuration || (maxDuration < 600 && duration > maxDuration)) {
        return false
      }
      if (audioFilter.selectedEnvelopeTypes.length > 0) {
        if (!sample.envelopeType || !audioFilter.selectedEnvelopeTypes.includes(sample.envelopeType)) {
          return false
        }
      }
      if (audioFilter.selectedInstruments.length > 0) {
        const instrType = sample.instrumentType || sample.instrumentPrimary
        if (!instrType || !audioFilter.selectedInstruments.includes(instrType)) {
          return false
        }
      }
      if (audioFilter.selectedGenres.length > 0) {
        if (!sample.genrePrimary || !audioFilter.selectedGenres.includes(sample.genrePrimary)) {
          return false
        }
      }
      return true
    })
  }, [allSamples, minDuration, maxDuration, audioFilter])

  const selectedSample = samples.find(s => s.id === selectedSampleId) || null
  const selectedSampleIndex = selectedSample ? samples.indexOf(selectedSample) : -1

  // Mutations
  const createCollection = useCreateCollection()
  const updateCollection = useUpdateCollection()
  const deleteCollection = useDeleteCollection()
  const createFolder = useCreateFolder()
  const updateFolder = useUpdateFolder()
  const deleteFolder = useDeleteFolder()
  const splitFolder = useSplitFolder()
  const splitCollection = useSplitCollection()
  const toggleFavorite = useToggleFavorite()
  const addTagToSlice = useAddTagToSlice()
  const removeTagFromSlice = useRemoveTagFromSlice()
  const addSliceToFolder = useAddSliceToFolder()
  const removeSliceFromFolder = useRemoveSliceFromFolder()
  const createTag = useCreateTag()
  const batchDeleteSlices = useBatchDeleteSlices()
  const batchReanalyzeSlices = useBatchReanalyzeSlices()
  const batchAddSlices = useBatchAddSlicesToFolder()

  // Custom Order modal state
  const [showCustomOrder, setShowCustomOrder] = useState(false)

  // Create folder from selected samples state
  const [isCreatingFromSelection, setIsCreatingFromSelection] = useState(false)
  const [folderFromSelectionName, setFolderFromSelectionName] = useState('')

  // Build folder tree
  const folderTree = useMemo(() => {
    const buildTree = (parentId: number | null = null): FolderNode[] => {
      return folders
        .filter(c => c.parentId === parentId)
        .map(c => ({
          ...c,
          children: buildTree(c.id),
        }))
    }
    return buildTree(null)
  }, [folders])

  // Available facet dimensions
  const availableFacets = useMemo(() => {
    if (!facets) return []
    const dims: { type: 'tag-category' | 'metadata'; key: string; label: string; count: number }[] = []

    for (const [category, items] of Object.entries(facets.tags)) {
      if (items.length > 0) {
        dims.push({ type: 'tag-category', key: category, label: FACET_LABELS[category] || category, count: items.length })
      }
    }
    for (const [field, items] of Object.entries(facets.metadata)) {
      if (items.length > 0) {
        dims.push({ type: 'metadata', key: field, label: FACET_LABELS[field] || field, count: items.length })
      }
    }
    return dims
  }, [facets])

  // Currently selected facet values list
  const currentFacetItems = useMemo(() => {
    if (!facets || !selectedFacetKey) return []
    if (selectedFacetType === 'tag-category') {
      return (facets.tags[selectedFacetKey] || []).map(t => ({ value: t.name, count: t.count }))
    } else {
      return facets.metadata[selectedFacetKey] || []
    }
  }, [facets, selectedFacetType, selectedFacetKey])

  // Handlers
  const handleCreateCollection = useCallback(() => {
    if (!newCollectionName.trim()) return
    createCollection.mutate({ name: newCollectionName.trim() }, {
      onSuccess: (p) => {
        setActiveCollectionId(p.id)
        setNewCollectionName('')
        setIsCreatingCollection(false)
      },
    })
  }, [newCollectionName, createCollection])

  const handleRenameCollection = useCallback(() => {
    if (!editingCollectionId || !editingCollectionName.trim()) return
    updateCollection.mutate({ id: editingCollectionId, data: { name: editingCollectionName.trim() } })
    setEditingCollectionId(null)
  }, [editingCollectionId, editingCollectionName, updateCollection])

  const handleDeleteCollection = useCallback((id: number) => {
    if (activeCollectionId === id) {
      const other = collections.find(p => p.id !== id)
      setActiveCollectionId(other?.id || null)
    }
    deleteCollection.mutate(id)
    setSelectedFolderId(null)
  }, [activeCollectionId, collections, deleteCollection])

  const handleCreateFolderSubmit = useCallback((parentId?: number) => {
    if (!newFolderName.trim() || !activeCollectionId) return
    createFolder.mutate({
      name: newFolderName.trim(),
      collectionId: activeCollectionId,
      parentId,
    }, {
      onSuccess: () => {
        setNewFolderName('')
        setIsCreatingFolder(false)
        setCreatingUnderParentId(null)
      },
    })
  }, [newFolderName, activeCollectionId, createFolder])

  const handleSplit = useCallback(() => {
    if (!selectedFacetKey) return
    const values = selectedFacetValues.size > 0
      ? Array.from(selectedFacetValues)
      : undefined

    const onSuccess = () => {
      if (selectedFolderId) {
        setExpandedFolders(prev => new Set([...prev, selectedFolderId]))
      }
      setShowFacetPanel(false)
      setSelectedFacetKey('')
      setSelectedFacetValues(new Set())
    }

    if (selectedFolderId) {
      splitFolder.mutate({
        folderId: selectedFolderId,
        data: { facetType: selectedFacetType, facetKey: selectedFacetKey, selectedValues: values },
      }, { onSuccess })
    } else if (activeCollectionId) {
      splitCollection.mutate({
        collectionId: activeCollectionId,
        data: { facetType: selectedFacetType, facetKey: selectedFacetKey, selectedValues: values },
      }, { onSuccess })
    }
  }, [selectedFolderId, activeCollectionId, selectedFacetType, selectedFacetKey, selectedFacetValues, splitFolder, splitCollection])

  const toggleFolderExpand = (id: number) => {
    setExpandedFolders(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleFacetValue = (value: string) => {
    setSelectedFacetValues(prev => {
      const next = new Set(prev)
      if (next.has(value)) next.delete(value)
      else next.add(value)
      return next
    })
  }

  const handleToggleSelect = (id: number) => {
    setSelectedSampleIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleToggleSelectAll = () => {
    if (selectedSampleIds.size === samples.length && samples.length > 0) {
      setSelectedSampleIds(new Set())
    } else {
      setSelectedSampleIds(new Set(samples.map(s => s.id)))
    }
  }

  const handleBatchDelete = (ids: number[]) => {
    if (confirm(`Delete ${ids.length} selected samples?`)) {
      batchDeleteSlices.mutate(ids, {
        onSuccess: () => setSelectedSampleIds(new Set())
      })
    }
  }

  const handleBatchDownload = (ids: number[]) => {
    const selectedSamplesForDownload = samples.filter(s => ids.includes(s.id))
    selectedSamplesForDownload.forEach(sample => {
      const link = document.createElement('a')
      link.href = getSliceDownloadUrl(sample.id)
      link.download = `${sample.name}.mp3`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    })
  }

  const handleAnalyzeSelected = (ids: number[]) => {
    if (ids.length === 0) {
      return
    }

    const modifiedCount = samples.filter(sample => ids.includes(sample.id) && sample.sampleModified).length

    const confirmed = confirm(
      modifiedCount > 0
        ? `Analyze ${ids.length} selected samples? (${modifiedCount} modified)`
        : `Analyze ${ids.length} selected samples?`
    )
    if (!confirmed) return

    batchReanalyzeSlices.mutate(
      {
        sliceIds: ids,
        analysisLevel: 'standard',
        concurrency: 2,
        includeFilenameTags: true,
      },
      {
        onSuccess: (result) => {
          if (result.warnings && result.warnings.totalWithWarnings > 0) {
            const preview = result.warnings.messages.slice(0, 3)
            const extra = Math.max(0, result.warnings.messages.length - preview.length)
            const details = preview.map((m) => `• ${m}`).join('\n')
            window.alert(
              [
                `Warning: ${result.warnings.totalWithWarnings} sample(s) had potential custom state before re-analysis.`,
                details,
                extra > 0 ? `...and ${extra} more warning(s).` : '',
              ]
                .filter(Boolean)
                .join('\n')
            )
          }
          setSelectedSampleIds(new Set())
        },
      }
    )
  }

  const modifiedSelectedCount = useMemo(() => {
    if (selectedSampleIds.size === 0) return 0
    return samples.filter(sample => selectedSampleIds.has(sample.id) && sample.sampleModified).length
  }, [samples, selectedSampleIds])

  const handleCreateTag = (name: string, color: string) => {
    createTag.mutate({ name, color })
  }

  const handleCreateFolderFromSelection = useCallback(() => {
    if (!folderFromSelectionName.trim() || !activeCollectionId || selectedSampleIds.size === 0) return
    createFolder.mutate({
      name: folderFromSelectionName.trim(),
      collectionId: activeCollectionId,
      parentId: selectedFolderId || undefined,
    }, {
      onSuccess: (newCol) => {
        batchAddSlices.mutate({
          folderId: newCol.id,
          sliceIds: Array.from(selectedSampleIds),
        }, {
          onSuccess: () => {
            setSelectedSampleIds(new Set())
            setIsCreatingFromSelection(false)
            setFolderFromSelectionName('')
          },
        })
      },
    })
  }, [folderFromSelectionName, activeCollectionId, selectedFolderId, selectedSampleIds, createFolder, batchAddSlices])

  // Render folder tree node
  const renderFolderNode = (node: FolderNode, depth: number = 0): React.ReactNode => {
    const isExpanded = expandedFolders.has(node.id)
    const isSelected = selectedFolderId === node.id
    const hasChildren = node.children.length > 0

    return (
      <div key={node.id}>
        <div
          className={`flex items-center gap-1.5 py-1.5 px-2 cursor-pointer text-sm transition-colors group ${
            isSelected
              ? 'bg-accent-primary/20 text-white'
              : 'text-slate-300 hover:bg-surface-border/50'
          }`}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => setSelectedFolderId(node.id)}
        >
          {/* Expand toggle */}
          <button
            className="p-0.5 hover:text-white flex-shrink-0"
            onClick={(e) => {
              e.stopPropagation()
              toggleFolderExpand(node.id)
            }}
          >
            {hasChildren ? (
              isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />
            ) : (
              <span className="w-3.5" />
            )}
          </button>

          {/* Color dot */}
          <span
            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
            style={{ backgroundColor: node.color }}
          />

          {/* Name */}
          {editingFolderId === node.id ? (
            <input
              autoFocus
              className="flex-1 bg-surface-base px-1.5 py-0.5 rounded text-sm text-white border border-surface-border outline-none"
              value={editingFolderName}
              onChange={(e) => setEditingFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  updateFolder.mutate({ id: node.id, data: { name: editingFolderName.trim() } })
                  setEditingFolderId(null)
                } else if (e.key === 'Escape') {
                  setEditingFolderId(null)
                }
              }}
              onBlur={() => {
                if (editingFolderName.trim()) {
                  updateFolder.mutate({ id: node.id, data: { name: editingFolderName.trim() } })
                }
                setEditingFolderId(null)
              }}
            />
          ) : (
            <span className="flex-1 truncate">{node.name}</span>
          )}

          {/* Slice count */}
          <span className="text-xs text-slate-500 flex-shrink-0 transition-opacity group-hover:opacity-0">
            {node.sliceCount}
          </span>

          {/* Context menu trigger */}
          <button
            className="p-0.5 opacity-0 group-hover:opacity-100 hover:text-white flex-shrink-0"
            onClick={(e) => {
              e.stopPropagation()
              setContextMenuId(contextMenuId === node.id ? null : node.id)
            }}
          >
            <MoreHorizontal size={14} />
          </button>
        </div>

        {/* Context menu */}
        {contextMenuId === node.id && (
          <div className="ml-8 mr-2 mb-1 bg-surface-base border border-surface-border rounded-lg shadow-lg overflow-hidden">
            <button
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-slate-300 hover:bg-surface-border/50"
              onClick={() => {
                setEditingFolderId(node.id)
                setEditingFolderName(node.name)
                setContextMenuId(null)
              }}
            >
              <Pencil size={12} /> Rename
            </button>
            <button
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-slate-300 hover:bg-surface-border/50"
              onClick={() => {
                setColorPickerFolderId(colorPickerFolderId === node.id ? null : node.id)
                setContextMenuId(null)
              }}
            >
              <Palette size={12} /> Change Color
            </button>
            <button
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-slate-300 hover:bg-surface-border/50"
              onClick={() => {
                setCreatingUnderParentId(node.id)
                setIsCreatingFolder(true)
                setNewFolderName('')
                setExpandedFolders(prev => new Set([...prev, node.id]))
                setContextMenuId(null)
              }}
            >
              <FolderPlus size={12} /> Add Subfolder
            </button>
            <button
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-slate-300 hover:bg-surface-border/50"
              onClick={() => {
                setSelectedFolderId(node.id)
                setShowFacetPanel(true)
                setContextMenuId(null)
              }}
            >
              <SplitSquareHorizontal size={12} /> Split by Facet
            </button>
            <button
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-surface-border/50"
              onClick={() => {
                deleteFolder.mutate(node.id)
                if (selectedFolderId === node.id) setSelectedFolderId(null)
                setContextMenuId(null)
              }}
            >
              <Trash2 size={12} /> Delete
            </button>
          </div>
        )}

        {/* Color picker */}
        {colorPickerFolderId === node.id && (
          <div className="ml-8 mr-2 mb-1 p-2 bg-surface-base border border-surface-border rounded-lg">
            <div className="grid grid-cols-9 gap-1">
              {FOLDER_COLORS.map((color) => (
                <button
                  key={color}
                  className={`w-5 h-5 rounded-full border-2 ${
                    node.color === color ? 'border-white' : 'border-transparent'
                  }`}
                  style={{ backgroundColor: color }}
                  onClick={() => {
                    updateFolder.mutate({ id: node.id, data: { color } })
                    setColorPickerFolderId(null)
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Children */}
        {isExpanded && node.children.map(child => renderFolderNode(child, depth + 1))}

        {/* Inline create under this node */}
        {isCreatingFolder && creatingUnderParentId === node.id && isExpanded && (
          <div className="flex items-center gap-1.5 py-1 px-2" style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}>
            <FolderOpen size={14} className="text-slate-500 flex-shrink-0" />
            <input
              autoFocus
              className="flex-1 bg-surface-base px-1.5 py-0.5 rounded text-sm text-white border border-surface-border outline-none"
              placeholder="Folder name..."
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateFolderSubmit(node.id)
                else if (e.key === 'Escape') {
                  setIsCreatingFolder(false)
                  setCreatingUnderParentId(null)
                }
              }}
              onBlur={() => {
                if (newFolderName.trim()) handleCreateFolderSubmit(node.id)
                else {
                  setIsCreatingFolder(false)
                  setCreatingUnderParentId(null)
                }
              }}
            />
          </div>
        )}
      </div>
    )
  }

  const activeCollection = collections.find(p => p.id === activeCollectionId)

  return (
    <div className="h-full flex overflow-hidden bg-surface-base">
      {/* Sidebar */}
      <div className="w-72 flex-shrink-0 bg-surface-raised border-r border-surface-border flex flex-col overflow-hidden">
        {/* Collection Switcher */}
        <div className="p-3 border-b border-surface-border">
          <div className="relative">
            <button
              className="w-full flex items-center justify-between px-3 py-2 bg-surface-base border border-surface-border rounded-lg text-sm text-white hover:border-slate-500 transition-colors"
              onClick={() => setShowCollectionDropdown(!showCollectionDropdown)}
            >
              <div className="flex items-center gap-2">
                <Layers size={16} className="text-accent-primary" />
                <span className="truncate">{activeCollection?.name || 'Select Collection'}</span>
              </div>
              <ChevronDown size={14} className={`text-slate-400 transition-transform ${showCollectionDropdown ? 'rotate-180' : ''}`} />
            </button>

            {showCollectionDropdown && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-surface-base border border-surface-border rounded-lg shadow-xl z-20 overflow-hidden">
                {collections.map(p => (
                  <div key={p.id} className="flex items-center group">
                    <button
                      className={`flex-1 flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${
                        p.id === activeCollectionId
                          ? 'bg-accent-primary/20 text-white'
                          : 'text-slate-300 hover:bg-surface-border/50'
                      }`}
                      onClick={() => {
                        setActiveCollectionId(p.id)
                        setSelectedFolderId(null)
                        setShowCollectionDropdown(false)
                      }}
                    >
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: p.color }} />
                      {editingCollectionId === p.id ? (
                        <input
                          autoFocus
                          className="flex-1 bg-surface-base px-1.5 py-0.5 rounded text-sm text-white border border-surface-border outline-none"
                          value={editingCollectionName}
                          onChange={(e) => setEditingCollectionName(e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleRenameCollection()
                            else if (e.key === 'Escape') setEditingCollectionId(null)
                          }}
                          onBlur={handleRenameCollection}
                        />
                      ) : (
                        <span className="truncate">{p.name}</span>
                      )}
                      <span className="text-xs text-slate-500 ml-auto transition-opacity group-hover:opacity-0">
                        {p.folderCount}
                      </span>
                    </button>
                    <div className="flex items-center gap-0.5 pr-2 opacity-0 group-hover:opacity-100">
                      <button
                        className="p-1 text-slate-400 hover:text-white"
                        onClick={(e) => {
                          e.stopPropagation()
                          setEditingCollectionId(p.id)
                          setEditingCollectionName(p.name)
                        }}
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        className="p-1 text-slate-400 hover:text-red-400"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDeleteCollection(p.id)
                          setShowCollectionDropdown(false)
                        }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}

                {/* Create new collection */}
                <div className="border-t border-surface-border">
                  {isCreatingCollection ? (
                    <div className="flex items-center gap-2 p-2">
                      <input
                        autoFocus
                        className="flex-1 bg-surface-base px-2 py-1 rounded text-sm text-white border border-surface-border outline-none"
                        placeholder="Collection name..."
                        value={newCollectionName}
                        onChange={(e) => setNewCollectionName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleCreateCollection()
                          else if (e.key === 'Escape') setIsCreatingCollection(false)
                        }}
                      />
                      <button className="p-1 text-green-400 hover:text-green-300" onClick={handleCreateCollection}>
                        <Check size={14} />
                      </button>
                      <button className="p-1 text-slate-400 hover:text-white" onClick={() => setIsCreatingCollection(false)}>
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <button
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-400 hover:text-white hover:bg-surface-border/50"
                      onClick={() => {
                        setIsCreatingCollection(true)
                        setNewCollectionName('')
                      }}
                    >
                      <Plus size={14} /> New Collection
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Folder Tree */}
        <div className="flex-1 overflow-y-auto">
          {activeCollectionId ? (
            <>
              <div className="px-3 pt-3 pb-1 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Folders</span>
                <button
                  className="p-1 text-slate-400 hover:text-white"
                  onClick={() => {
                    setIsCreatingFolder(true)
                    setCreatingUnderParentId(null)
                    setNewFolderName('')
                  }}
                  title="New folder"
                >
                  <Plus size={14} />
                </button>
              </div>

              {/* Root-level "All" item */}
              <div
                className={`flex items-center gap-1.5 py-1.5 px-2 cursor-pointer text-sm transition-colors ${
                  selectedFolderId === null
                    ? 'bg-accent-primary/20 text-white'
                    : 'text-slate-300 hover:bg-surface-border/50'
                }`}
                onClick={() => setSelectedFolderId(null)}
              >
                <Eye size={14} className="ml-1.5 text-slate-400" />
                <span className="flex-1">All in collection</span>
                <span className="text-xs text-slate-500">{folders.reduce((sum, c) => sum + c.sliceCount, 0)}</span>
              </div>

              {folderTree.map(node => renderFolderNode(node))}

              {/* Root-level create */}
              {isCreatingFolder && creatingUnderParentId === null && (
                <div className="flex items-center gap-1.5 py-1 px-3">
                  <FolderOpen size={14} className="text-slate-500 flex-shrink-0" />
                  <input
                    autoFocus
                    className="flex-1 bg-surface-base px-1.5 py-0.5 rounded text-sm text-white border border-surface-border outline-none"
                    placeholder="Folder name..."
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreateFolderSubmit()
                      else if (e.key === 'Escape') setIsCreatingFolder(false)
                    }}
                    onBlur={() => {
                      if (newFolderName.trim()) handleCreateFolderSubmit()
                      else setIsCreatingFolder(false)
                    }}
                  />
                </div>
              )}

              {folderTree.length === 0 && !isCreatingFolder && (
                <div className="px-4 py-8 text-center">
                  <FolderOpen size={32} className="mx-auto text-slate-600 mb-2" />
                  <p className="text-sm text-slate-500">No folders yet</p>
                  <p className="text-xs text-slate-600 mt-1">Create a folder to start organizing</p>
                </div>
              )}
            </>
          ) : (
            <div className="px-4 py-8 text-center">
              <Layers size={32} className="mx-auto text-slate-600 mb-2" />
              <p className="text-sm text-slate-500">No collection selected</p>
              <p className="text-xs text-slate-600 mt-1">Create or select a collection to begin</p>
            </div>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Search & Filter bar */}
        <div className="p-4 border-b border-surface-border bg-surface-raised">
          <div className="flex items-center gap-4">
            {/* Search input */}
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={`Search in ${selectedFolderId ? folders.find(c => c.id === selectedFolderId)?.name || 'folder' : 'collection'}...`}
                className="w-full pl-10 pr-4 py-2 bg-surface-base border border-surface-border rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary transition-colors"
              />
            </div>

            {/* View mode toggle */}
            <div className="flex items-center gap-1 bg-surface-base border border-surface-border rounded-lg p-0.5">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-1.5 rounded transition-colors ${
                  viewMode === 'grid'
                    ? 'bg-accent-primary text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
                title="Grid view"
              >
                <LayoutGrid size={16} />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-1.5 rounded transition-colors ${
                  viewMode === 'list'
                    ? 'bg-accent-primary text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
                title="List view"
              >
                <List size={16} />
              </button>
            </div>

            {/* Favorites toggle */}
            <button
              onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
                showFavoritesOnly
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                  : 'bg-surface-base text-slate-400 hover:text-slate-300 border border-surface-border'
              }`}
            >
              <Heart size={16} className={showFavoritesOnly ? 'fill-current' : ''} />
              <span className="text-sm">Favorites</span>
            </button>

            {/* Split by Facet button */}
            <button
              className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg transition-colors ${
                showFacetPanel
                  ? 'bg-accent-primary text-white'
                  : 'bg-surface-base text-slate-300 hover:text-white border border-surface-border hover:border-slate-500'
              }`}
              onClick={() => setShowFacetPanel(!showFacetPanel)}
            >
              <SplitSquareHorizontal size={14} />
              Split by Facet
            </button>


            {/* Custom Order button */}
            <button
              className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg transition-colors bg-surface-base text-slate-300 hover:text-white border border-surface-border hover:border-slate-500"
              onClick={() => setShowCustomOrder(true)}
            >
              <Layers size={14} />
              Custom Order
            </button>

            {/* Create Folder from Selection */}
            {selectedSampleIds.size > 0 && !isCreatingFromSelection && (
              <button
                className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg transition-colors bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-600/30"
                onClick={() => setIsCreatingFromSelection(true)}
              >
                <FolderPlus size={14} />
                Create Folder ({selectedSampleIds.size})
              </button>
            )}

            {isCreatingFromSelection && (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={folderFromSelectionName}
                  onChange={(e) => setFolderFromSelectionName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateFolderFromSelection()
                    if (e.key === 'Escape') {
                      setIsCreatingFromSelection(false)
                      setFolderFromSelectionName('')
                    }
                  }}
                  placeholder="Folder name..."
                  className="px-2 py-1.5 text-sm bg-surface-base border border-surface-border rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary w-40"
                  autoFocus
                />
                <button
                  onClick={handleCreateFolderFromSelection}
                  disabled={!folderFromSelectionName.trim() || batchAddSlices.isPending}
                  className="px-2 py-1.5 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 disabled:opacity-50"
                >
                  {batchAddSlices.isPending ? '...' : <Check size={14} />}
                </button>
                <button
                  onClick={() => { setIsCreatingFromSelection(false); setFolderFromSelectionName('') }}
                  className="px-2 py-1.5 text-sm text-slate-400 hover:text-white"
                >
                  <X size={14} />
                </button>
              </div>
            )}
          </div>

          {/* Tag filter bar */}
          <div className="mt-3">
            <SourcesTagFilter
              selectedTags={selectedTags}
              onTagsChange={setSelectedTags}
              allTags={allTags}
              onCreateTag={handleCreateTag}
              totalCount={totalCount}
              filteredCount={samples.length}
            />
          </div>

          {/* Advanced filters section */}
          <div className="mt-3">
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-300 transition-colors"
            >
              <ChevronDown size={14} className={`transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
              <span>Advanced</span>
            </button>

            {showAdvanced && (
              <div className="mt-3 p-3 bg-surface-base border border-surface-border rounded-lg space-y-3">
                {/* Audio feature filters */}
                <SourcesAudioFilter
                  filterState={audioFilter}
                  onChange={setAudioFilter}
                  availableKeys={[...new Set(samples.map(s => s.keyEstimate).filter(Boolean) as string[])]}
                  availableEnvelopeTypes={[...new Set(samples.map(s => s.envelopeType).filter(Boolean) as string[])]}
                  availableInstruments={[...new Set(samples.map(s => s.instrumentType || s.instrumentPrimary).filter(Boolean) as string[])]}
                  availableGenres={[...new Set(samples.map(s => s.genrePrimary).filter(Boolean) as string[])]}
                />

                {/* Separator */}
                <div className="h-px bg-surface-border" />

                <div className="flex items-center gap-4">
                  {/* Duration controls */}
                  <div className="flex items-center gap-3 flex-1 max-w-md">
                    <span className="text-xs text-slate-400 whitespace-nowrap">Duration:</span>
                    <div className="flex-1 flex items-center gap-2">
                      {(() => {
                        const MAX_DURATION = 600
                        const EXPONENT = 5.5

                        const sliderToDuration = (sliderValue: number) => {
                          return MAX_DURATION * Math.pow(sliderValue / 100, EXPONENT)
                        }

                        const durationToSlider = (duration: number) => {
                          return 100 * Math.pow(Math.min(duration, MAX_DURATION) / MAX_DURATION, 1 / EXPONENT)
                        }

                        const minSlider = durationToSlider(minDuration)
                        const maxSlider = durationToSlider(maxDuration)

                        const isMaxInfinity = maxDuration >= MAX_DURATION

                        return (
                          <>
                            <input
                              type="number"
                              value={minDuration.toFixed(1)}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value) || 0
                                setMinDuration(Math.max(0, Math.min(val, maxDuration)))
                              }}
                              placeholder="Min"
                              className="w-16 px-1.5 py-0.5 text-xs bg-surface-raised border border-surface-border rounded text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary no-spinner"
                              step="0.1"
                              min="0"
                              max={maxDuration}
                            />

                            <div className="flex-1 relative h-6 flex items-center min-w-[120px]">
                              <div className="absolute left-0 right-0 h-0.5 bg-surface-raised rounded-full" />
                              <div
                                className="absolute h-0.5 bg-accent-primary rounded-full pointer-events-none"
                                style={{
                                  left: `${minSlider}%`,
                                  right: `${100 - maxSlider}%`,
                                }}
                              />
                              <input
                                type="range"
                                min={0}
                                max={100}
                                step={0.1}
                                value={minSlider}
                                onChange={(e) => {
                                  const newSliderMin = parseFloat(e.target.value)
                                  const newDuration = sliderToDuration(newSliderMin)
                                  setMinDuration(Math.min(newDuration, maxDuration))
                                }}
                                className="absolute w-full h-6 appearance-none bg-transparent cursor-pointer slider-thumb"
                                style={{ zIndex: minSlider > maxSlider - 2 ? 5 : 3 }}
                              />
                              <input
                                type="range"
                                min={0}
                                max={100}
                                step={0.1}
                                value={maxSlider}
                                onChange={(e) => {
                                  const newSliderMax = parseFloat(e.target.value)
                                  const newDuration = sliderToDuration(newSliderMax)
                                  setMaxDuration(Math.max(newDuration, minDuration))
                                }}
                                className="absolute w-full h-6 appearance-none bg-transparent cursor-pointer slider-thumb"
                                style={{ zIndex: maxSlider < minSlider + 2 ? 5 : 4 }}
                              />
                            </div>

                            {isMaxInfinity ? (
                              <div className="w-16 px-1.5 py-0.5 text-xs bg-surface-raised border border-surface-border rounded text-center text-white flex items-center justify-center">
                                ∞
                              </div>
                            ) : (
                              <input
                                type="number"
                                value={maxDuration.toFixed(1)}
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value) || 0
                                  setMaxDuration(Math.max(minDuration, Math.min(val, MAX_DURATION)))
                                }}
                                placeholder="Max"
                                className="w-16 px-1.5 py-0.5 text-xs bg-surface-raised border border-surface-border rounded text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary no-spinner"
                                step="0.1"
                                min={minDuration}
                                max={MAX_DURATION}
                              />
                            )}
                            <span className="text-xs text-slate-500 whitespace-nowrap">sec</span>
                          </>
                        )
                      })()}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Facet Panel */}
        {showFacetPanel && (selectedFolderId || activeCollectionId) && (
          <div className="border-b border-surface-border bg-surface-raised">
            <div className="p-3">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-sm text-slate-400">Split by:</span>
                <select
                  className="bg-surface-base border border-surface-border rounded-lg px-3 py-1.5 text-sm text-white outline-none"
                  value={`${selectedFacetType}:${selectedFacetKey}`}
                  onChange={(e) => {
                    const [type, key] = e.target.value.split(':')
                    setSelectedFacetType(type as 'tag-category' | 'metadata')
                    setSelectedFacetKey(key)
                    setSelectedFacetValues(new Set())
                  }}
                >
                  <option value=":">Choose dimension...</option>
                  {availableFacets.map(f => (
                    <option key={`${f.type}:${f.key}`} value={`${f.type}:${f.key}`}>
                      {f.label} ({f.count} values)
                    </option>
                  ))}
                </select>

                {selectedFacetKey && currentFacetItems.length > 0 && (
                  <button
                    className="ml-auto px-3 py-1.5 bg-accent-primary text-white text-sm rounded-lg hover:bg-accent-primary/80 transition-colors disabled:opacity-50"
                    onClick={handleSplit}
                    disabled={splitFolder.isPending || splitCollection.isPending}
                  >
                    {(splitFolder.isPending || splitCollection.isPending) ? 'Splitting...' : `Create ${selectedFacetValues.size > 0 ? selectedFacetValues.size : currentFacetItems.length} Sub-folders`}
                  </button>
                )}
              </div>

              {/* Facet values */}
              {selectedFacetKey && currentFacetItems.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {currentFacetItems.map(item => {
                    const isChecked = selectedFacetValues.size === 0 || selectedFacetValues.has(item.value)
                    return (
                      <button
                        key={item.value}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs transition-colors ${
                          isChecked
                            ? 'bg-accent-primary/20 text-accent-primary border border-accent-primary/30'
                            : 'bg-surface-base text-slate-400 border border-surface-border hover:text-slate-300'
                        }`}
                        onClick={() => toggleFacetValue(item.value)}
                      >
                        {isChecked && <Check size={10} />}
                        {item.value}
                        <span className="text-slate-500">({item.count})</span>
                      </button>
                    )
                  })}
                </div>
              )}

              {selectedFacetKey && currentFacetItems.length === 0 && (
                <p className="text-xs text-slate-500">No values found for this dimension.</p>
              )}
            </div>
          </div>
        )}

        {/* Batch actions bar */}
        {selectedSampleIds.size > 0 && (
          <SourcesBatchActions
            selectedCount={selectedSampleIds.size}
            selectedIds={selectedSampleIds}
            modifiedSelectedCount={modifiedSelectedCount}
            onBatchDelete={handleBatchDelete}
            onBatchDownload={handleBatchDownload}
            onAnalyzeSelected={handleAnalyzeSelected}
            onClearSelection={() => setSelectedSampleIds(new Set())}
            isDeleting={batchDeleteSlices.isPending}
            isAnalyzing={batchReanalyzeSlices.isPending}
          />
        )}

        {/* Sample content */}
        <div className="flex-1 overflow-auto">
          {viewMode === 'grid' ? (
            <SourcesSampleGrid
              samples={samples}
              selectedId={selectedSampleId}
              selectedIds={selectedSampleIds}
              onSelect={(id) => setSelectedSampleId(id)}
              onToggleSelect={handleToggleSelect}
              onToggleSelectAll={handleToggleSelectAll}
              onToggleFavorite={(id) => toggleFavorite.mutate(id)}
              playMode="normal"
              loopEnabled={false}
            />
          ) : (
            <SourcesSampleList
              samples={samples}
              selectedId={selectedSampleId}
              selectedIds={selectedSampleIds}
              onSelect={(id) => setSelectedSampleId(id)}
              onToggleSelect={handleToggleSelect}
              onToggleSelectAll={handleToggleSelectAll}
              onToggleFavorite={(id) => toggleFavorite.mutate(id)}
              onUpdateName={() => {}}
              onDelete={() => {}}
              playMode="normal"
              loopEnabled={false}
            />
          )}
        </div>
      </div>

      {/* Detail Modal */}
      {selectedSample && (
        <SourcesDetailModal
          sample={selectedSample}
          allTags={allTags}
          folders={folders}
          onClose={() => setSelectedSampleId(null)}
          onToggleFavorite={(id) => toggleFavorite.mutate(id)}
          onAddTag={(sliceId, tagId) => addTagToSlice.mutate({ sliceId, tagId })}
          onRemoveTag={(sliceId, tagId) => removeTagFromSlice.mutate({ sliceId, tagId })}
          onAddToFolder={(folderId, sliceId) => addSliceToFolder.mutate({ folderId, sliceId })}
          onRemoveFromFolder={(folderId, sliceId) => removeSliceFromFolder.mutate({ folderId, sliceId })}
          onPrevious={selectedSampleIndex > 0 ? () => setSelectedSampleId(samples[selectedSampleIndex - 1].id) : undefined}
          onNext={selectedSampleIndex < samples.length - 1 ? () => setSelectedSampleId(samples[selectedSampleIndex + 1].id) : undefined}
          hasPrevious={selectedSampleIndex > 0}
          hasNext={selectedSampleIndex < samples.length - 1}
        />
      )}

      {/* Custom Order Modal */}
      {showCustomOrder && (
        <CustomOrderModal
          onClose={() => setShowCustomOrder(false)}
          activeCollectionId={activeCollectionId}
        />
      )}

    </div>
  )
}
