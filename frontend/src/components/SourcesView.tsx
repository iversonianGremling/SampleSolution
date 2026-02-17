import { useState, useMemo } from 'react'
import {
  X,
  Search,
  Heart,
  LayoutGrid,
  List,
  Sparkles,
  Play,
  Repeat1,
  MousePointerClick,
  ChevronDown,
  ChevronRight,
  Repeat,
  Layers3,
  FlaskConical,
  Lock,
  Unlock,
} from 'lucide-react'
import { SourcesTree } from './SourcesTree'
import { SourcesTagFilter } from './SourcesTagFilter'
import { SourcesSampleGrid } from './SourcesSampleGrid'
import { SourcesSampleList } from './SourcesSampleList'
import { SourcesYouTubeGroupedGrid } from './SourcesYouTubeGroupedGrid'
import { SourcesYouTubeGroupedList } from './SourcesYouTubeGroupedList'
import { SourcesBatchActions } from './SourcesBatchActions'
import { SourcesDetailModal } from './SourcesDetailModal'
import { EditingModal } from './EditingModal'
import { SampleSpaceView } from './SampleSpaceView'
import { CustomOrderModal } from './CustomOrderModal'
import { SourcesAudioFilter, AudioFilterState } from './SourcesAudioFilter'
import { useSourceTree } from '../hooks/useSourceTree'
import { useScopedSamples } from '../hooks/useScopedSamples'
import {
  useTags,
  useFolders,
  useCreateFolder,
  useUpdateFolder,
  useDeleteFolder,
  useToggleFavorite,
  useAddTagToSlice,
  useRemoveTagFromSlice,
  useAddSliceToFolder,
  useRemoveSliceFromFolder,
  useUpdateSliceGlobal,
  useCreateTag,
  useDeleteSliceGlobal,
  useBatchDeleteSlices,
  useBatchReanalyzeSlices,
  useCreateFolderFromTag,
  useCreateTagFromFolder,
  useCollections,
  useCreateCollection,
  useUpdateCollection,
  useDeleteCollection,
} from '../hooks/useTracks'
import type { SourceScope, SliceWithTrackExtended, Tag, Folder } from '../types'
import { downloadBatchSlicesZip } from '../api/client'
import { getRelatedKeys, getRelatedNotes, getScaleDegree } from '../utils/musicTheory'

export type PlayMode = 'normal' | 'one-shot' | 'reproduce-while-clicking'

interface WorkspaceState {
  selectedSample: SliceWithTrackExtended | null
  allTags: Tag[]
  folders: Folder[]
  onToggleFavorite: (sliceId: number) => void
  onAddTag: (sliceId: number, tagId: number) => void
  onRemoveTag: (sliceId: number, tagId: number) => void
  onAddToFolder: (folderId: number, sliceId: number) => void
  onRemoveFromFolder: (folderId: number, sliceId: number) => void
  onUpdateName: (sliceId: number, name: string) => void
  onTagClick: (tagId: number) => void
  onSelectSample: (sampleId: number) => void
  onFilterBySimilarity: (sampleId: number, sampleName: string) => void
  onSampleDeleted: (sampleId: number) => void
}

interface SourcesViewProps {
  workspaceTab?: 'details' | 'rack' | 'lab'
  onWorkspaceTabChange?: (tab: 'details' | 'rack' | 'lab') => void
  onWorkspaceStateChange?: (state: WorkspaceState | null) => void
}

export function SourcesView({
  workspaceTab = 'details',
  onWorkspaceTabChange,
  onWorkspaceStateChange,
}: SourcesViewProps) {
  // State
  const [currentScope, setCurrentScope] = useState<SourceScope>({ type: 'all' })
  const [selectedTags, setSelectedTags] = useState<number[]>([])
  const [selectedFolderIds, setSelectedFolderIds] = useState<number[]>([])
  const [excludedTags, setExcludedTags] = useState<number[]>([])
  const [excludedFolderIds, setExcludedFolderIds] = useState<number[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false)
  const [showTagCategories, setShowTagCategories] = useState(false)
  const [selectedSampleId, setSelectedSampleId] = useState<number | null>(null)
  const [viewMode, setViewMode] = useState<'grid' | 'list' | 'space'>('grid')
  const [selectedSampleIds, setSelectedSampleIds] = useState<Set<number>>(new Set())
  const [editingTrackId, setEditingTrackId] = useState<number | null>(null)
  const [showCustomOrder, setShowCustomOrder] = useState(false)
  const [isTreeSidebarOpen, setIsTreeSidebarOpen] = useState(true)
  const [isTreeSidebarLocked, setIsTreeSidebarLocked] = useState(true)
  const [isTreeSidebarCollapsed, setIsTreeSidebarCollapsed] = useState(false)

  // Similarity mode state
  const [similarityMode, setSimilarityMode] = useState<{
    enabled: boolean
    referenceSampleId: number
    referenceSampleName: string
    minSimilarity: number  // 0-1 range
  } | null>(null)

  // Advanced filters
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [minDuration, setMinDuration] = useState<number>(0)
  const [maxDuration, setMaxDuration] = useState<number>(300)
  const [playMode, setPlayMode] = useState<PlayMode>('normal')
  const [loopEnabled, setLoopEnabled] = useState(false)

  // Audio feature filters
  const [audioFilter, setAudioFilter] = useState<AudioFilterState>({
    sortBy: null,
    sortOrder: 'asc',
    minBpm: 0,
    maxBpm: 300,
    dateAddedFrom: '',
    dateAddedTo: '',
    dateCreatedFrom: '',
    dateCreatedTo: '',
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

  // Data queries
  const { data: collections = [] } = useCollections()
  const { data: sourceTree, isLoading: isTreeLoading } = useSourceTree()
  const { data: samplesData, isLoading: isSamplesLoading } = useScopedSamples(
    currentScope,
    selectedTags,
    searchQuery,
    showFavoritesOnly,
    {
      sortBy: audioFilter.sortBy || (similarityMode?.enabled ? 'similarity' : undefined),
      sortOrder: similarityMode?.enabled ? 'desc' : audioFilter.sortOrder,
      minBpm: audioFilter.minBpm > 0 ? audioFilter.minBpm : undefined,
      maxBpm: audioFilter.maxBpm < 300 ? audioFilter.maxBpm : undefined,
      keys: audioFilter.pitchFilterMode === 'scale' && effectiveKeys.length > 0 ? effectiveKeys : undefined,
      notes: audioFilter.pitchFilterMode === 'fundamental' && effectiveNotes.length > 0 ? effectiveNotes : undefined,
      dateAddedFrom: audioFilter.dateAddedFrom || undefined,
      dateAddedTo: audioFilter.dateAddedTo || undefined,
      dateCreatedFrom: audioFilter.dateCreatedFrom || undefined,
      dateCreatedTo: audioFilter.dateCreatedTo || undefined,
      similarTo: similarityMode?.enabled ? similarityMode.referenceSampleId : undefined,
      minSimilarity: similarityMode?.enabled ? similarityMode.minSimilarity : undefined,
    }
  )
  const { data: allTags = [] } = useTags()
  const [activeCollectionId, setActiveCollectionId] = useState<number | null>(null)
  const { data: allFolders = [] } = useFolders()

  // Auto-select first collection
  useMemo(() => {
    if (collections.length > 0 && activeCollectionId === null) {
      setActiveCollectionId(collections[0].id)
    }
  }, [collections, activeCollectionId])

  const folders = useMemo(() => {
    if (activeCollectionId === null) return allFolders
    return allFolders.filter(c => c.collectionId === activeCollectionId || c.collectionId === null)
  }, [allFolders, activeCollectionId])

  // Mutations
  const createFolder = useCreateFolder()
  const createCollection = useCreateCollection()
  const updateCollection = useUpdateCollection()
  const deleteCollection = useDeleteCollection()
  const updateFolder = useUpdateFolder()
  const deleteFolder = useDeleteFolder()
  const toggleFavorite = useToggleFavorite()
  const addTagToSlice = useAddTagToSlice()
  const removeTagFromSlice = useRemoveTagFromSlice()
  const addSliceToFolder = useAddSliceToFolder()
  const removeSliceFromFolder = useRemoveSliceFromFolder()
  const updateSlice = useUpdateSliceGlobal()
  const createTag = useCreateTag()
  const deleteSlice = useDeleteSliceGlobal()
  const batchDeleteSlices = useBatchDeleteSlices()
  const batchReanalyzeSlices = useBatchReanalyzeSlices()
  const createFolderFromTag = useCreateFolderFromTag()
  const createTagFromFolder = useCreateTagFromFolder()

  // Derived data
  const allSamples = useMemo(() => {
    const incoming = samplesData?.samples || []
    return Array.from(new Map(incoming.map((sample) => [sample.id, sample])).values())
  }, [samplesData?.samples])
  const totalCount = samplesData?.total || 0

  const tagCounts = useMemo(() => {
    const counts: Record<number, number> = {}
    const countsByName: Record<string, number> = {}

    for (const sample of allSamples) {
      for (const tag of sample.tags || []) {
        counts[tag.id] = (counts[tag.id] || 0) + 1
        const key = tag.name.toLowerCase()
        countsByName[key] = (countsByName[key] || 0) + 1
      }
    }

    return { counts, countsByName }
  }, [allSamples])

  // Filter samples by duration and advanced features
  const samples = useMemo(() => {
    return allSamples.filter(sample => {
      // Fallback scope filtering for deployments where backend scope filtering
      // can be inconsistent for custom folders/collections.
      if (currentScope.type === 'my-folder') {
        const itemFolderIds = sample.folderIds ?? []
        if (!itemFolderIds.includes(currentScope.folderId)) return false
      }

      if (currentScope.type === 'collection') {
        const collectionFolderIds = new Set(
          allFolders
            .filter(folder => folder.collectionId === currentScope.collectionId)
            .map(folder => folder.id)
        )
        const itemFolderIds = sample.folderIds ?? []
        if (!itemFolderIds.some(id => collectionFolderIds.has(id))) return false
      }

      const applyFolderFilters =
        currentScope.type === 'all' ||
        currentScope.type === 'youtube' ||
        currentScope.type === 'youtube-video' ||
        currentScope.type === 'local'

      // Included folder filter (AND logic)
      if (applyFolderFilters && selectedFolderIds.length > 0) {
        const itemFolderIds = sample.folderIds ?? []
        const inAllSelectedFolders = selectedFolderIds.every(id => itemFolderIds.includes(id))
        if (!inAllSelectedFolders) return false
      }

      // Excluded tag filter
      if (excludedTags.length > 0) {
        const hasExcludedTag = sample.tags?.some(tag => excludedTags.includes(tag.id))
        if (hasExcludedTag) return false
      }

      // Excluded folder filter
      if (applyFolderFilters && excludedFolderIds.length > 0) {
        const inExcludedFolder = sample.folderIds?.some(id => excludedFolderIds.includes(id))
        if (inExcludedFolder) return false
      }

      // Duration filter
      const duration = sample.endTime - sample.startTime
      if (duration < minDuration || (maxDuration < 600 && duration > maxDuration)) {
        return false
      }

      // Envelope type filter
      if (audioFilter.selectedEnvelopeTypes.length > 0) {
        if (!sample.envelopeType || !audioFilter.selectedEnvelopeTypes.includes(sample.envelopeType)) {
          return false
        }
      }

      // Instrument filter (check both instrumentType and instrumentPrimary)
      if (audioFilter.selectedInstruments.length > 0) {
        const instrType = sample.instrumentType || sample.instrumentPrimary
        if (!instrType || !audioFilter.selectedInstruments.includes(instrType)) {
          return false
        }
      }

      // Genre filter
      if (audioFilter.selectedGenres.length > 0) {
        if (!sample.genrePrimary || !audioFilter.selectedGenres.includes(sample.genrePrimary)) {
          return false
        }
      }

      // Note: Perceptual features (brightness, warmth, hardness) filtering
      // would require fetching full AudioFeatures data, which is not available
      // on the SliceWithTrackExtended type. This can be added when needed.

      return true
    })
  }, [allSamples, allFolders, currentScope, selectedFolderIds, excludedTags, excludedFolderIds, minDuration, maxDuration, audioFilter])

  // Scale degree grouping
  const scaleDegreeGroups = useMemo(() => {
    if (!audioFilter.groupByScaleDegree || audioFilter.selectedKeys.length !== 1) return null
    const refKey = audioFilter.selectedKeys[0]
    const groups = new Map<string, SliceWithTrackExtended[]>()
    const ungrouped: SliceWithTrackExtended[] = []
    for (const s of samples) {
      if (s.keyEstimate) {
        const degree = getScaleDegree(s.keyEstimate, refKey)
        if (degree !== 'Unknown') {
          if (!groups.has(degree)) groups.set(degree, [])
          groups.get(degree)!.push(s)
        } else {
          ungrouped.push(s)
        }
      } else {
        ungrouped.push(s)
      }
    }
    if (ungrouped.length > 0) {
      groups.set('No Key', ungrouped)
    }
    return groups
  }, [samples, audioFilter.groupByScaleDegree, audioFilter.selectedKeys])

  const selectedSample = useMemo<SliceWithTrackExtended | null>(() => {
    if (!selectedSampleId) return null
    return samples.find(s => s.id === selectedSampleId) || null
  }, [selectedSampleId, samples])

  // Calculate navigation state for the detail modal
  const selectedSampleIndex = useMemo(() => {
    if (!selectedSampleId) return -1
    return samples.findIndex(s => s.id === selectedSampleId)
  }, [selectedSampleId, samples])

  const hasNextSample = selectedSampleIndex >= 0 && selectedSampleIndex < samples.length - 1
  const hasPreviousSample = selectedSampleIndex > 0

  // Create filter state for SampleSpaceView
  const spaceViewFilterState = useMemo(() => ({
    searchQuery,
    selectedTags,
    excludedTags,
    minDuration,
    maxDuration: maxDuration >= 600 ? Infinity : maxDuration,
    showFavoritesOnly,
    selectedFolderIds:
      currentScope.type === 'my-folder' || currentScope.type === 'collection' || currentScope.type === 'folder'
        ? []
        : selectedFolderIds,
    excludedFolderIds:
      currentScope.type === 'my-folder' || currentScope.type === 'collection' || currentScope.type === 'folder'
        ? []
        : excludedFolderIds,
    selectedTrackId: currentScope.type === 'youtube-video' ? currentScope.trackId : null,
  }), [searchQuery, selectedTags, excludedTags, minDuration, maxDuration, showFavoritesOnly, currentScope, selectedFolderIds, excludedFolderIds])

  // Clear selected sample if it's no longer in the list
  if (selectedSampleId && !selectedSample && samples.length > 0) {
    setSelectedSampleId(null)
  }

  // Handlers
  const handleScopeChange = (scope: SourceScope) => {
    setCurrentScope(scope)
    if (scope.type === 'collection' || scope.type === 'my-folder' || scope.type === 'folder') {
      setSelectedFolderIds([])
      setExcludedFolderIds([])
    }
    setSelectedSampleId(null)
  }

  const handleCreateFolder = (name: string, parentId?: number) => {
    createFolder.mutate({ name, parentId, collectionId: activeCollectionId ?? collections[0]?.id })
  }

  const handleRenameFolder = (id: number, name: string) => {
    updateFolder.mutate({ id, data: { name } })
  }

  const handleUpdateFolder = (id: number, data: { parentId?: number | null; color?: string; collectionId?: number | null }) => {
    updateFolder.mutate({ id, data })
  }

  const handleDeleteFolder = (id: number) => {
    deleteFolder.mutate(id)
    // If we're viewing the deleted folder, reset scope
    if (currentScope.type === 'my-folder' && currentScope.folderId === id) {
      setCurrentScope({ type: 'all' })
    }
  }

  const handleToggleFavorite = (sliceId: number) => {
    toggleFavorite.mutate(sliceId)
  }

  const handleAddTag = (sliceId: number, tagId: number) => {
    addTagToSlice.mutate({ sliceId, tagId })
  }

  const handleRemoveTag = (sliceId: number, tagId: number) => {
    removeTagFromSlice.mutate({ sliceId, tagId })
  }

  const handleAddToFolder = (folderId: number, sliceId: number) => {
    addSliceToFolder.mutate({ folderId, sliceId })
  }

  const handleRemoveFromFolder = (folderId: number, sliceId: number) => {
    removeSliceFromFolder.mutate({ folderId, sliceId })
  }

  const handleUpdateName = (sliceId: number, name: string) => {
    updateSlice.mutate({ id: sliceId, data: { name } })
  }

  const handleFilterBySimilarity = (sampleId: number, sampleName: string) => {
    setSimilarityMode({
      enabled: true,
      referenceSampleId: sampleId,
      referenceSampleName: sampleName,
      minSimilarity: 0.5,  // Default 50% threshold
    })
    setViewMode('list')  // Switch to list view for better browsing
  }

  const handleCreateTag = (name: string, color: string) => {
    createTag.mutate({ name, color })
  }

  const handleCreateFolderFromTag = (tagId: number, name: string, color: string) => {
    createFolderFromTag.mutate({ tagId, name, color, collectionId: activeCollectionId ?? collections[0]?.id })
  }

  const handleCreateTagFromFolder = (folderId: number, name: string, color: string) => {
    createTagFromFolder.mutate({ folderId, name, color })
  }

  const handleCreateCollection = (name: string) => {
    createCollection.mutate({ name }, {
      onSuccess: (created) => {
        setActiveCollectionId(created.id)
        setCurrentScope({ type: 'collection', collectionId: created.id })
      },
    })
  }

  const handleRenameCollection = (id: number, name: string) => {
    updateCollection.mutate({ id, data: { name } })
  }

  const handleDeleteCollection = (id: number) => {
    const target = collections.find(p => p.id === id)
    if (!target) return

    if (!confirm(`Delete collection "${target.name}"?`)) return

    const fallback = collections.find(p => p.id !== id)
    if (activeCollectionId === id) {
      setActiveCollectionId(fallback?.id ?? null)
      setCurrentScope(fallback ? { type: 'collection', collectionId: fallback.id } : { type: 'all' })
    }
    deleteCollection.mutate(id)
  }

  const handleMoveCollection = (id: number, direction: 'up' | 'down') => {
    const sorted = [...collections].sort((a, b) => a.sortOrder - b.sortOrder)
    const index = sorted.findIndex(p => p.id === id)
    if (index === -1) return

    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= sorted.length) return

    const current = sorted[index]
    const target = sorted[targetIndex]

    updateCollection.mutate({ id: current.id, data: { sortOrder: target.sortOrder } })
    updateCollection.mutate({ id: target.id, data: { sortOrder: current.sortOrder } })
  }

  const handleTagClick = (tagId: number) => {
    setSelectedTags((prev) => {
      if (prev.includes(tagId)) {
        // Remove tag from filter
        return prev.filter(id => id !== tagId)
      } else {
        // Add tag to filter
        return [...prev, tagId]
      }
    })
  }

  // Handle sample selection via workspace state when available, fallback to modal
  const handleSampleSelect = (id: number) => {
    const sample = samples.find(s => s.id === id)
    if (sample && onWorkspaceStateChange) {
      onWorkspaceStateChange({
        selectedSample: sample,
        allTags,
        folders,
        onToggleFavorite: handleToggleFavorite,
        onAddTag: handleAddTag,
        onRemoveTag: handleRemoveTag,
        onAddToFolder: handleAddToFolder,
        onRemoveFromFolder: handleRemoveFromFolder,
        onUpdateName: handleUpdateName,
        onTagClick: handleTagClick,
        onSelectSample: handleSampleSelect,
        onFilterBySimilarity: handleFilterBySimilarity,
        onSampleDeleted: (_sampleId: number) => {
          // Clear selection when sample is deleted
          if (onWorkspaceStateChange) {
            onWorkspaceStateChange(null)
          }
        },
      })
    } else {
      // Fallback to old modal behavior
      setSelectedSampleId(id)
    }
  }

  const handleViewModeChange = (mode: 'grid' | 'list' | 'space') => {
    setViewMode(mode)
  }

  const handleToggleSelect = (id: number) => {
    setSelectedSampleIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
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

  const handleBatchDownload = (ids: number[]) => {
    if (ids.length === 0) return

    void (async () => {
      try {
        const { blob, contentDisposition } = await downloadBatchSlicesZip(ids)
        const objectUrl = window.URL.createObjectURL(blob)

        const fallbackName = `samples-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`
        const fileNameMatch = contentDisposition?.match(/filename\*?=(?:UTF-8''|"?)([^";]+)/i)
        const fileName = fileNameMatch?.[1]
          ? decodeURIComponent(fileNameMatch[1].replace(/"/g, ''))
          : fallbackName

        const link = document.createElement('a')
        link.href = objectUrl
        link.download = fileName
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        window.URL.revokeObjectURL(objectUrl)
      } catch (error) {
        console.error('Failed to batch download samples as ZIP:', error)
        window.alert('Failed to download selected samples as ZIP. Please try again.')
      }
    })()
  }

  const modifiedSelectedCount = useMemo(() => {
    if (selectedSampleIds.size === 0) return 0
    return samples.filter(sample => selectedSampleIds.has(sample.id) && sample.sampleModified).length
  }, [samples, selectedSampleIds])

  const handleDeleteSingle = (id: number) => {
    const sample = samples.find(s => s.id === id)
    if (sample && confirm(`Delete "${sample.name}"?`)) {
      deleteSlice.mutate(id)
      if (selectedSampleId === id) {
        setSelectedSampleId(null)
      }
    }
  }

  const handleBatchAddToFolder = (folderId: number, sampleIds: number[]) => {
    // Add each sample to the folder
    sampleIds.forEach(sliceId => {
      addSliceToFolder.mutate({ folderId, sliceId })
    })

    // Clear selection after adding
    setSelectedSampleIds(new Set())
  }

  const handlePlayModeChange = () => {
    setPlayMode((prev) => {
      if (prev === 'normal') return 'one-shot'
      if (prev === 'one-shot') return 'reproduce-while-clicking'
      return 'normal'
    })
  }

  const handleNextSample = () => {
    if (hasNextSample) {
      const nextSample = samples[selectedSampleIndex + 1]
      if (nextSample) {
        setSelectedSampleId(nextSample.id)
      }
    }
  }

  const handlePreviousSample = () => {
    if (hasPreviousSample) {
      const previousSample = samples[selectedSampleIndex - 1]
      if (previousSample) {
        setSelectedSampleId(previousSample.id)
      }
    }
  }

  const getPlayModeIcon = () => {
    if (playMode === 'one-shot') return <Repeat1 size={16} />
    if (playMode === 'reproduce-while-clicking') return <MousePointerClick size={16} />
    return <Play size={16} />
  }

  const getPlayModeLabel = () => {
    if (playMode === 'one-shot') return 'One-shot'
    if (playMode === 'reproduce-while-clicking') return 'Sample'
    return 'Normal'
  }

  // Get scope label for display
  const getScopeLabel = (): string => {
    switch (currentScope.type) {
      case 'all':
        return 'All Samples'
      case 'youtube':
        return 'YouTube'
      case 'youtube-video':
        const video = sourceTree?.youtube.find(v => v.id === currentScope.trackId)
        return video?.title || 'YouTube Video'
      case 'local':
        return 'Local Samples'
      case 'folder':
        return currentScope.path.split('/').pop() || 'Folder'
      case 'my-folder':
        const folder = folders.find(c => c.id === currentScope.folderId)
        return folder?.name || 'Folder'
      default:
        return 'Samples'
    }
  }

  return (
    <div className="h-full flex overflow-hidden bg-surface-base">
      {isTreeSidebarLocked ? (
        /* Locked Mode - Sidebar in flex layout */
        <aside
          className="border-r border-surface-border bg-surface-raised shadow-lg flex-shrink-0 overflow-hidden transition-all duration-300 ease-out relative"
          style={{
            width: isTreeSidebarCollapsed ? 14 : 256,
          }}
        >
          <div className="h-full flex flex-col pr-[14px]" style={{ width: 256 }}>
            {/* Lock/Unlock toggle button */}
            <div className="flex justify-end p-2 border-b border-surface-border/50">
              <button
                onClick={() => {
                  setIsTreeSidebarLocked(false)
                  setIsTreeSidebarOpen(false)
                }}
                className="p-1.5 rounded hover:bg-surface-overlay transition-colors text-slate-400 hover:text-white"
                title="Unlock (enable hover mode)"
              >
                <Lock size={14} />
              </button>
            </div>

            <div className="flex-1 overflow-hidden">
              <SourcesTree
                tree={sourceTree}
                folders={allFolders}
                currentScope={currentScope}
                onScopeChange={handleScopeChange}
                onCreateFolder={handleCreateFolder}
                onRenameFolder={handleRenameFolder}
                onDeleteFolder={handleDeleteFolder}
                onUpdateFolder={handleUpdateFolder}
                onBatchAddToFolder={handleBatchAddToFolder}
                onCreateTagFromFolder={handleCreateTagFromFolder}
                isLoading={isTreeLoading}
                collections={collections}
                activeCollectionId={activeCollectionId}
                onCollectionChange={setActiveCollectionId}
                onCreateCollection={handleCreateCollection}
                onRenameCollection={handleRenameCollection}
                onDeleteCollection={handleDeleteCollection}
                onMoveCollection={handleMoveCollection}
                onOpenAdvancedCategoryManagement={() => setShowCustomOrder(true)}
              />
            </div>
          </div>

          {/* Chevron handle */}
          <div className="absolute inset-y-0 right-0 w-[14px] border-l border-surface-border bg-surface-overlay/90 flex items-center justify-center">
            <button
              onClick={() => setIsTreeSidebarCollapsed(!isTreeSidebarCollapsed)}
              className="p-1 hover:bg-surface-border/50 transition-colors rounded"
              title={isTreeSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <ChevronRight
                size={12}
                className={`text-slate-400 transition-transform duration-300 ${
                  isTreeSidebarCollapsed ? '' : 'rotate-180'
                }`}
              />
            </button>
          </div>
        </aside>
      ) : (
        /* Unlocked Mode - Hover reveal with absolute positioning */
        <aside
          className={`absolute inset-y-0 left-0 z-20 w-64 border-r border-surface-border bg-surface-raised shadow-2xl transition-transform duration-300 ease-out ${
            isTreeSidebarOpen ? 'translate-x-0' : '-translate-x-[calc(100%-14px)]'
          }`}
          onMouseEnter={() => setIsTreeSidebarOpen(true)}
          onMouseLeave={() => setIsTreeSidebarOpen(false)}
        >
          <div className="h-full pr-[14px] overflow-hidden flex flex-col">
            {/* Lock/Unlock toggle button */}
            <div className="flex justify-end p-2 border-b border-surface-border/50">
              <button
                onClick={() => {
                  setIsTreeSidebarLocked(true)
                  setIsTreeSidebarCollapsed(false)
                }}
                className="p-1.5 rounded hover:bg-surface-overlay transition-colors text-slate-400 hover:text-white"
                title="Lock (keep sidebar visible)"
              >
                <Unlock size={14} />
              </button>
            </div>

            <div className="flex-1 overflow-hidden">
              <SourcesTree
                tree={sourceTree}
                folders={allFolders}
                currentScope={currentScope}
                onScopeChange={handleScopeChange}
                onCreateFolder={handleCreateFolder}
                onRenameFolder={handleRenameFolder}
                onDeleteFolder={handleDeleteFolder}
                onUpdateFolder={handleUpdateFolder}
                onBatchAddToFolder={handleBatchAddToFolder}
                onCreateTagFromFolder={handleCreateTagFromFolder}
                isLoading={isTreeLoading}
                collections={collections}
                activeCollectionId={activeCollectionId}
                onCollectionChange={setActiveCollectionId}
                onCreateCollection={handleCreateCollection}
                onRenameCollection={handleRenameCollection}
                onDeleteCollection={handleDeleteCollection}
                onMoveCollection={handleMoveCollection}
                onOpenAdvancedCategoryManagement={() => setShowCustomOrder(true)}
              />
            </div>
          </div>

          {/* Edge indicator */}
          <div className="absolute inset-y-0 right-0 w-[14px] border-l border-surface-border bg-surface-overlay/90 flex items-center justify-center">
            <ChevronRight
              size={12}
              className={`text-slate-400 transition-transform duration-300 ${isTreeSidebarOpen ? 'rotate-180' : ''}`}
            />
          </div>
        </aside>
      )}

      {/* Main content area */}
      <div className={`flex-1 flex flex-col overflow-hidden ${!isTreeSidebarLocked ? 'pl-[14px]' : ''}`}>
        {/* Search bar */}
        <div className="p-4 border-b border-surface-border bg-surface-raised">
          <div className="flex items-center gap-4">
            {/* Search input */}
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={`Search in ${getScopeLabel()}...`}
                className="w-full pl-10 pr-4 py-2 bg-surface-base border border-surface-border rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary transition-colors"
              />
            </div>

            {onWorkspaceTabChange && (
              <div className="flex items-center gap-1 bg-surface-base border border-surface-border rounded-lg p-1">
                <button
                  onClick={() => onWorkspaceTabChange('details')}
                  className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-wider transition-colors ${
                    workspaceTab === 'details'
                      ? 'border-slate-400/50 bg-slate-400/10 text-slate-200'
                      : 'border-surface-border bg-surface-base text-slate-500 hover:text-slate-200'
                  }`}
                  title="Show sample details"
                >
                  <X size={13} />
                  Details
                </button>

                <button
                  onClick={() => onWorkspaceTabChange('rack')}
                  className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-wider transition-colors ${
                    workspaceTab === 'rack'
                      ? 'border-accent-primary/50 bg-accent-primary/15 text-accent-primary'
                      : 'border-surface-border bg-surface-base text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Layers3 size={13} />
                  Rack
                </button>

                <button
                  onClick={() => onWorkspaceTabChange('lab')}
                  className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-wider transition-colors ${
                    workspaceTab === 'lab'
                      ? 'border-cyan-400/50 bg-cyan-400/10 text-cyan-300'
                      : 'border-surface-border bg-surface-base text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <FlaskConical size={13} />
                  Lab
                </button>
              </div>
            )}

            {/* View mode toggle */}
            <div className="flex items-center gap-1 bg-surface-base border border-surface-border rounded-lg p-0.5">
              <button
                onClick={() => handleViewModeChange('grid')}
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
                onClick={() => handleViewModeChange('list')}
                className={`p-1.5 rounded transition-colors ${
                  viewMode === 'list'
                    ? 'bg-accent-primary text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
                title="List view"
              >
                <List size={16} />
              </button>
              <button
                onClick={() => handleViewModeChange('space')}
                className={`p-1.5 rounded transition-colors ${
                  viewMode === 'space'
                    ? 'bg-accent-primary text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
                title="Space view"
              >
                <Sparkles size={16} />
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

            <button
              onClick={() => setShowTagCategories((prev) => !prev)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
                showTagCategories
                  ? 'bg-accent-primary/20 text-accent-primary border border-accent-primary/40'
                  : 'bg-surface-base text-slate-400 hover:text-slate-300 border border-surface-border'
              }`}
              title={showTagCategories ? 'Hide categories' : 'Show categories'}
            >
              <Layers3 size={16} />
              <span className="text-sm">Categories</span>
            </button>
          </div>

          {/* Tag filter bar */}
          <div className="mt-3">
            <SourcesTagFilter
              selectedTags={selectedTags}
              onTagsChange={setSelectedTags}
              selectedFolderIds={selectedFolderIds}
              onSelectedFolderIdsChange={setSelectedFolderIds}
              excludedTags={excludedTags}
              onExcludedTagsChange={setExcludedTags}
              allTags={allTags}
              allFolders={allFolders}
              excludedFolderIds={excludedFolderIds}
              onExcludedFolderIdsChange={setExcludedFolderIds}
              onCreateTag={handleCreateTag}
              onCreateFolderFromTag={handleCreateFolderFromTag}
              tagCounts={tagCounts.counts}
              tagNameCounts={tagCounts.countsByName}
              totalCount={totalCount}
              filteredCount={samples.length}
              showCategories={showTagCategories}
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
                      {/* Helper functions for exponential scaling */}
                      {(() => {
                        const MAX_DURATION = 600
                        const EXPONENT = 5.5

                        // Convert slider position (0-100) to actual duration (0-600)
                        const sliderToDuration = (sliderValue: number) => {
                          return MAX_DURATION * Math.pow(sliderValue / 100, EXPONENT)
                        }

                        // Convert actual duration (0-600) to slider position (0-100)
                        const durationToSlider = (duration: number) => {
                          return 100 * Math.pow(Math.min(duration, MAX_DURATION) / MAX_DURATION, 1 / EXPONENT)
                        }

                        const minSlider = durationToSlider(minDuration)
                        const maxSlider = durationToSlider(maxDuration)

                        const isMaxInfinity = maxDuration >= MAX_DURATION

                        return (
                          <>
                            {/* Number inputs */}
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

                            {/* Dual slider */}
                            <div className="flex-1 relative h-6 flex items-center min-w-[120px]">
                              {/* Track background */}
                              <div className="absolute left-0 right-0 h-0.5 bg-surface-raised rounded-full" />

                              {/* Active range */}
                              <div
                                className="absolute h-0.5 bg-accent-primary rounded-full pointer-events-none"
                                style={{
                                  left: `${minSlider}%`,
                                  right: `${100 - maxSlider}%`,
                                }}
                              />

                              {/* Min handle */}
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

                              {/* Max handle */}
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

                  {/* Separator */}
                  <div className="h-5 w-px bg-surface-border" />

                  {/* Play mode selector */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handlePlayModeChange}
                      className="flex items-center gap-1.5 px-2.5 py-1 bg-surface-raised border border-surface-border rounded-lg text-xs text-white hover:bg-surface-base transition-colors"
                      title="Click to cycle through play modes"
                    >
                      {getPlayModeIcon()}
                      <span>{getPlayModeLabel()}</span>
                    </button>

                    {/* Loop toggle */}
                    <button
                      onClick={() => setLoopEnabled(!loopEnabled)}
                      disabled={playMode === 'one-shot'}
                      className={`flex items-center gap-1.5 px-2.5 py-1 border rounded-lg text-xs transition-colors ${
                        playMode === 'one-shot'
                          ? 'bg-surface-raised border-surface-border text-slate-600 cursor-not-allowed'
                          : loopEnabled
                          ? 'bg-accent-primary border-accent-primary text-white'
                          : 'bg-surface-raised border-surface-border text-white hover:bg-surface-base'
                      }`}
                      title={playMode === 'one-shot' ? 'Loop not available in one-shot mode' : loopEnabled ? 'Loop enabled' : 'Loop disabled'}
                    >
                      <Repeat size={14} />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

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

        {/* Sample grid/list */}
        <div className="flex-1 overflow-hidden">
          {currentScope.type === 'youtube' ? (
            // YouTube grouped view
            viewMode === 'grid' ? (
              <div className="overflow-y-auto h-full">
                <SourcesYouTubeGroupedGrid
                  samples={samples}
                  selectedId={selectedSampleId}
                  selectedIds={selectedSampleIds}
                  onSelect={handleSampleSelect}
                  onToggleSelect={handleToggleSelect}
                  onToggleSelectAll={handleToggleSelectAll}
                  onToggleFavorite={handleToggleFavorite}
                  onEditTrack={setEditingTrackId}
                  onTagClick={handleTagClick}
                  isLoading={isSamplesLoading}
                  playMode={playMode}
                  loopEnabled={loopEnabled}
                  sourceTree={sourceTree}
                />
              </div>
            ) : viewMode === 'list' ? (
              <SourcesYouTubeGroupedList
                samples={samples}
                selectedId={selectedSampleId}
                selectedIds={selectedSampleIds}
                onSelect={handleSampleSelect}
                onToggleSelect={handleToggleSelect}
                onToggleSelectAll={handleToggleSelectAll}
                onToggleFavorite={handleToggleFavorite}
                onUpdateName={handleUpdateName}
                onDelete={handleDeleteSingle}
                onEditTrack={setEditingTrackId}
                onTagClick={handleTagClick}
                isLoading={isSamplesLoading}
                playMode={playMode}
                loopEnabled={loopEnabled}
                sourceTree={sourceTree}
              />
            ) : (
              <SampleSpaceView
                externalFilterState={spaceViewFilterState}
                selectedSliceId={selectedSampleId}
                onSliceSelect={(id) => {
                  if (id !== null) {
                    handleSampleSelect(id)
                  }
                }}
              />
            )
          ) : (
            // Standard view for all other scopes
            viewMode === 'grid' ? (
              <div className="overflow-y-auto h-full">
                <SourcesSampleGrid
                  samples={samples}
                  selectedId={selectedSampleId}
                  selectedIds={selectedSampleIds}
                  onSelect={handleSampleSelect}
                  onToggleSelect={handleToggleSelect}
                  onToggleSelectAll={handleToggleSelectAll}
                  onToggleFavorite={handleToggleFavorite}
                  onTagClick={handleTagClick}
                  isLoading={isSamplesLoading}
                  playMode={playMode}
                  loopEnabled={loopEnabled}
                  scaleDegreeGroups={scaleDegreeGroups}
                />
              </div>
            ) : viewMode === 'list' ? (
              <div className="flex flex-col h-full">
                {similarityMode?.enabled && (
                  <div className="bg-accent-primary/10 border-l-4 border-accent-primary px-4 py-3 flex items-center justify-between flex-shrink-0">
                    <div className="flex items-center gap-3">
                      <Sparkles size={16} className="text-accent-primary" />
                      <div>
                        <div className="text-sm font-medium text-white">
                          Similar to: {similarityMode.referenceSampleName}
                        </div>
                        <div className="text-xs text-slate-400">
                          {samples.length} samples above {Math.round(similarityMode.minSimilarity * 100)}% similarity
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      {/* Similarity threshold slider */}
                      <div className="flex items-center gap-2">
                        <label className="text-xs text-slate-400">Min Similarity:</label>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={5}
                          value={Math.round(similarityMode.minSimilarity * 100)}
                          onChange={(e) => setSimilarityMode({
                            ...similarityMode,
                            minSimilarity: parseInt(e.target.value) / 100
                          })}
                          className="w-32 h-1 appearance-none bg-surface-border rounded-full cursor-pointer"
                          style={{
                            background: `linear-gradient(to right, var(--accent-primary) 0%, var(--accent-primary) ${Math.round(similarityMode.minSimilarity * 100)}%, var(--surface-border) ${Math.round(similarityMode.minSimilarity * 100)}%, var(--surface-border) 100%)`
                          }}
                        />
                        <span className="text-xs text-slate-300 font-mono w-8">
                          {Math.round(similarityMode.minSimilarity * 100)}%
                        </span>
                      </div>

                      {/* Exit button */}
                      <button
                        onClick={() => setSimilarityMode(null)}
                        className="px-3 py-1 text-sm bg-surface-overlay hover:bg-surface-base rounded-lg text-slate-300 hover:text-white transition-colors flex items-center gap-1"
                      >
                        <X size={14} />
                        Exit
                      </button>
                    </div>
                  </div>
                )}
                <div className="flex-1 overflow-hidden">
                  <SourcesSampleList
                    samples={samples}
                    selectedId={selectedSampleId}
                    selectedIds={selectedSampleIds}
                    onSelect={handleSampleSelect}
                    onToggleSelect={handleToggleSelect}
                    onToggleSelectAll={handleToggleSelectAll}
                    onToggleFavorite={handleToggleFavorite}
                    onUpdateName={handleUpdateName}
                    onDelete={handleDeleteSingle}
                    onTagClick={handleTagClick}
                    isLoading={isSamplesLoading}
                    playMode={playMode}
                    loopEnabled={loopEnabled}
                    similarityMode={similarityMode?.enabled ? {
                      enabled: true,
                      referenceSampleId: similarityMode.referenceSampleId,
                      referenceSampleName: similarityMode.referenceSampleName,
                    } : null}
                  />
                </div>
              </div>
            ) : (
              <SampleSpaceView
                externalFilterState={spaceViewFilterState}
                selectedSliceId={selectedSampleId}
                onSliceSelect={(id) => {
                  if (id !== null) {
                    handleSampleSelect(id)
                  }
                }}
              />
            )
          )}
        </div>
      </div>

      {/* Sample Detail Modal */}
      {selectedSample && (
        <SourcesDetailModal
          sample={selectedSample}
          allTags={allTags}
          folders={folders}
          onClose={() => setSelectedSampleId(null)}
          onToggleFavorite={handleToggleFavorite}
          onAddTag={handleAddTag}
          onRemoveTag={handleRemoveTag}
          onAddToFolder={handleAddToFolder}
          onRemoveFromFolder={handleRemoveFromFolder}
          onUpdateName={handleUpdateName}
          onEdit={() => setEditingTrackId(selectedSample.trackId)}
          onTagClick={handleTagClick}
          onNext={handleNextSample}
          onPrevious={handlePreviousSample}
          hasNext={hasNextSample}
          hasPrevious={hasPreviousSample}
          onSelectSample={setSelectedSampleId}
          onFilterBySimilarity={handleFilterBySimilarity}
        />
      )}

      {/* Editing Modal */}
      {editingTrackId !== null && (
        <EditingModal
          trackId={editingTrackId}
          onClose={() => setEditingTrackId(null)}
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
