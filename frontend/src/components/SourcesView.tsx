import { useState, useMemo, useRef, useEffect, type Dispatch, type SetStateAction } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  X,
  Info,
  Search,
  Square,
  MinusSquare,
  CheckSquare,
  Copy,
  RefreshCw,
  CheckCircle2,
  LayoutGrid,
  List,
  Sparkles,
  ChevronRight,
  ChevronDown,
  Layers3,
  FlaskConical,
  Trash2,
} from 'lucide-react'
import { SourcesTree } from './SourcesTree'
import { SourcesRuleFilterBuilder } from './SourcesRuleFilterBuilder'
import { SourcesSampleGrid } from './SourcesSampleGrid'
import { SourcesSampleList } from './SourcesSampleList'
import { SourcesYouTubeGroupedGrid } from './SourcesYouTubeGroupedGrid'
import { SourcesYouTubeGroupedList } from './SourcesYouTubeGroupedList'
import { SourcesBatchActions } from './SourcesBatchActions'
import { EditingModal } from './EditingModal'
import { SampleSpaceView } from './SampleSpaceView'
import { CustomOrderModal } from './CustomOrderModal'
import { BulkRenamePanel } from './BulkRenamePanel'
import { ResizableDivider } from './ResizableDivider'
import { SourcesAudioFilter, AudioFilterState } from './SourcesAudioFilter'
import { SourcesDimensionFilter, type DimensionCategory } from './SourcesDimensionFilter'
import { LibraryImportModal } from './LibraryImportModal'
import { SampleSearchScopeMenu } from './SampleSearchScopeMenu'
import { SampleSortMenu } from './SampleSortMenu'
import { useSourceTree } from '../hooks/useSourceTree'
import { useScopedSamples } from '../hooks/useScopedSamples'
import { useResizablePanel } from '../hooks/useResizablePanel'
import { useAppDialog } from '../hooks/useAppDialog'
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
  useDeleteSliceGlobal,
  useBatchDeleteSlices,
  useBatchReanalyzeSlices,
  useCreateTagFromFolder,
  useCollections,
  useCreateCollection,
  useUpdateCollection,
  useDeleteCollection,
  useCreateImportedFolder,
  useDeleteSource,
} from '../hooks/useTracks'
import type { SourceScope, SliceWithTrackExtended } from '../types'
import { downloadBatchSlicesZip, getDuplicateSlices, importLibrary } from '../api/client'
import type { DuplicateGroup, LibraryImportOptions } from '../api/client'
import {
  getRelatedKeys,
  getRelatedNotes,
  getScaleDegree,
  freqToNoteName,
  calcSemitoneShift,
  extractTonic,
} from '../utils/musicTheory'
import {
  getTunePlaybackMode,
  TUNE_PLAYBACK_MODE_EVENT,
  TUNE_PLAYBACK_MODE_STORAGE_KEY,
  type TunePlaybackMode,
} from '../utils/tunePlaybackMode'
import {
  buildFilterRuleEvaluationContext,
  matchesFilterRuleQuery,
  type FilterRule,
  type FilterRuleSuggestionMap,
} from '../utils/filterRuleQuery'
import {
  buildFolderCollectionNameMap,
  DEFAULT_SAMPLE_SEARCH_CUSTOM_FIELDS,
  getSampleSearchScopeDescriptor,
  getSampleSearchScopeHint,
  matchesSampleSearchTerm,
  normalizeSampleSearchTerm,
  type SampleSearchCustomField,
  type SampleSearchScope,
} from '../utils/sampleSearch'
import {
  applyBulkRenameRules,
  DEFAULT_BULK_RENAME_RULES,
  type BulkRenameRules,
} from '../utils/bulkRename'
import type { CollectionOverview, WorkspaceState, WorkspaceTab } from '../types/workspace'

export type PlayMode = 'normal' | 'one-shot' | 'reproduce-while-clicking'

type DuplicateMatchFilter = 'all' | 'exact' | 'content' | 'file'
type DuplicateKeepStrategy = 'oldest' | 'newest' | 'prefer-lossless' | 'highest-quality'
type DuplicateScopeFilter = 'all' | 'current'
type DuplicateModeFilter = 'all-duplicates' | 'smart-remove'
type FilterDockTab =
  | 'advanced'
  | 'categories'
  | 'dimensions'
  | 'features'
  | 'duplicates'
  | 'bulkActions'

interface DuplicatePair {
  id: string
  matchType: DuplicateGroup['matchType']
  hashSimilarity: number
  keepSample: DuplicateGroup['samples'][number]
  duplicateSample: DuplicateGroup['samples'][number]
  keepFormat: string
  duplicateFormat: string
  keepQualityLabel: string
  duplicateQualityLabel: string
  keepInCurrentScope: boolean
  duplicateInCurrentScope: boolean
  keepAssignmentScore: number
  duplicateAssignmentScore: number
  defaultDeleteSampleId: number | null
}

interface DuplicatePairDecision extends DuplicatePair {
  canDeleteKeepSample: boolean
  canDeleteDuplicateSample: boolean
  selectedDeleteSampleId: number | null
  selectedDeleteSampleRole: 'keep' | 'duplicate' | null
  isManualChoice: boolean
}

interface DuplicatePairRenderMeta {
  pairId: string
  pairIndex: number
  role: 'keep' | 'duplicate'
  partnerSampleId: number
  selectedForDelete: boolean
  selectedDeleteSampleId: number | null
  canDelete: boolean
  matchType: DuplicateGroup['matchType']
  similarityPercent: number
}

interface BulkRenamePreviewEntry {
  nextName: string
  hasChange: boolean
}

interface LoudnessPreset {
  id: string
  label: string
  min: number
  max: number
}

const LOSSLESS_DUPLICATE_FORMATS = new Set(['wav', 'flac', 'aif', 'aiff'])
const DEFAULT_VIEWPORT_WIDTH = 1366
const LOUDNESS_PRESETS: ReadonlyArray<LoudnessPreset> = [
  { id: 'all', label: 'All', min: -60, max: 0 },
  { id: 'quiet', label: 'Quiet', min: -42, max: -20 },
  { id: 'balanced', label: 'Balanced', min: -24, max: -12 },
  { id: 'loud', label: 'Loud', min: -14, max: -6 },
  { id: 'extreme', label: 'Extreme', min: -6, max: 0 },
]

function getViewportWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_VIEWPORT_WIDTH
  return window.innerWidth
}

function getDuplicateFormatLabel(format: string): string {
  return format === 'unknown' ? 'Unknown format' : `.${format}`
}

function getDuplicateMatchTypeLabel(matchType: DuplicateGroup['matchType']): string {
  if (matchType === 'exact') return 'Exact fingerprint'
  if (matchType === 'content') return 'Exact file content'
  return 'File identity'
}

function getSampleFormat(sample: DuplicateGroup['samples'][number]): string {
  if (sample.format && sample.format.trim()) {
    return sample.format.trim().toLowerCase()
  }
  const candidate = sample.filePath || sample.name || ''
  const extension = candidate.match(/\.([a-z0-9]+)$/i)?.[1]
  return extension ? extension.toLowerCase() : 'unknown'
}

function isSampleLossless(sample: DuplicateGroup['samples'][number]): boolean {
  return LOSSLESS_DUPLICATE_FORMATS.has(getSampleFormat(sample))
}

function getSampleQualityScore(sample: DuplicateGroup['samples'][number]): number {
  const sampleRate = Math.max(0, Number(sample.sampleRate) || 0)
  const channels = Math.max(0, Number(sample.channels) || 0)
  const losslessBonus = isSampleLossless(sample) ? 1_000_000 : 0
  return losslessBonus + sampleRate * 100 + channels * 10_000
}

function getSampleCreatedAtTimestamp(sample: DuplicateGroup['samples'][number]): number {
  const parsed = sample.createdAt ? new Date(sample.createdAt).getTime() : NaN
  return Number.isFinite(parsed) ? parsed : sample.id
}

function getSampleAssignmentScore(sample: DuplicateGroup['samples'][number]): number {
  const tagCount = Number(sample.tagsCount) || 0
  const folderCount = Number(sample.folderCount) || 0
  return tagCount + folderCount
}

function formatSampleQuality(sample: DuplicateGroup['samples'][number]): string {
  const sampleRate = Number(sample.sampleRate) || 0
  const channels = Number(sample.channels) || 0
  const parts: string[] = []

  if (sampleRate > 0) parts.push(`${(sampleRate / 1000).toFixed(1)}kHz`)
  if (channels > 0) parts.push(`${channels}ch`)
  if (isSampleLossless(sample)) parts.push('lossless')

  return parts.length > 0 ? parts.join(' / ') : 'quality unknown'
}

function normalizeTagCategory(category: string | null | undefined): string {
  const normalized = (category || 'general').trim().toLowerCase()
  return normalized.length > 0 ? normalized : 'general'
}

function formatTagCategoryLabel(categoryKey: string): string {
  return categoryKey
    .split(/[\s_-]+/)
    .filter((segment) => segment.length > 0)
    .map((segment) => segment[0].toUpperCase() + segment.slice(1))
    .join(' ')
}

function pickSampleToKeep(
  samples: DuplicateGroup['samples'],
  options: {
    strategy: DuplicateKeepStrategy
    protectFavorites: boolean
    preferAssigned: boolean
  }
): DuplicateGroup['samples'][number] {
  const byId = [...samples].sort((a, b) => {
    if (options.protectFavorites) {
      const favoriteDiff = Number(Boolean(b.favorite)) - Number(Boolean(a.favorite))
      if (favoriteDiff !== 0) return favoriteDiff
    }

    if (options.preferAssigned) {
      const assignedDiff = getSampleAssignmentScore(b) - getSampleAssignmentScore(a)
      if (assignedDiff !== 0) return assignedDiff
    }

    if (options.strategy === 'highest-quality') {
      const qualityDiff = getSampleQualityScore(b) - getSampleQualityScore(a)
      if (qualityDiff !== 0) return qualityDiff
    }

    if (options.strategy === 'prefer-lossless') {
      const losslessDiff = Number(isSampleLossless(b)) - Number(isSampleLossless(a))
      if (losslessDiff !== 0) return losslessDiff

      const qualityDiff = getSampleQualityScore(b) - getSampleQualityScore(a)
      if (qualityDiff !== 0) return qualityDiff
    }

    if (options.strategy === 'newest') {
      const createdAtDiff = getSampleCreatedAtTimestamp(b) - getSampleCreatedAtTimestamp(a)
      if (createdAtDiff !== 0) return createdAtDiff
    } else {
      const createdAtDiff = getSampleCreatedAtTimestamp(a) - getSampleCreatedAtTimestamp(b)
      if (createdAtDiff !== 0) return createdAtDiff
    }

    return a.id - b.id
  })

  if (byId.length === 0) {
    return { id: -1, name: '', trackTitle: '', filePath: null }
  }

  return byId[0]
}

interface SourcesViewProps {
  workspaceTab?: WorkspaceTab
  tuneTargetNote?: string | null
  onTuneToNote?: (note: string | null) => void
  playMode?: PlayMode
  loopEnabled?: boolean
  bulkRenameMode?: boolean
  bulkRenameRules?: BulkRenameRules
  onBulkRenameRulesChange: Dispatch<SetStateAction<BulkRenameRules>>
  onOpenAddSource?: () => void
  onWorkspaceTabChange?: (tab: WorkspaceTab) => void
  onWorkspaceStateChange?: (state: WorkspaceState | null) => void
  onCollectionOverviewChange?: (overview: CollectionOverview) => void
  onVisibleSamplesChange?: (samples: SliceWithTrackExtended[]) => void
  onSamplesLoadingChange?: (isLoading: boolean) => void
}

export function SourcesView({
  workspaceTab = 'details',
  tuneTargetNote = null,
  onTuneToNote,
  playMode = 'normal',
  loopEnabled = false,
  bulkRenameMode = false,
  bulkRenameRules = DEFAULT_BULK_RENAME_RULES,
  onBulkRenameRulesChange,
  onOpenAddSource,
  onWorkspaceTabChange,
  onWorkspaceStateChange,
  onCollectionOverviewChange,
  onVisibleSamplesChange,
  onSamplesLoadingChange,
}: SourcesViewProps) {
  // State
  const [currentScope, setCurrentScope] = useState<SourceScope>({ type: 'all' })
  const [selectedTags, setSelectedTags] = useState<number[]>([])
  const [selectedFolderIds, setSelectedFolderIds] = useState<number[]>([])
  const [excludedTags] = useState<number[]>([])
  const [excludedFolderIds, setExcludedFolderIds] = useState<number[]>([])
  const [queryRules, setQueryRules] = useState<FilterRule[]>([])
  const [activeFilterDockTab, setActiveFilterDockTab] = useState<FilterDockTab>('categories')
  const [isFilterDockOpen, setIsFilterDockOpen] = useState(true)
  const [activeDimensionCategory, setActiveDimensionCategory] = useState<DimensionCategory>('spectral')
  const [tagFilterSearchQuery, setTagFilterSearchQuery] = useState('')
  const [activeTagCategory, setActiveTagCategory] = useState<string>('all')
  const [isTagCategoryMoreOpen, setIsTagCategoryMoreOpen] = useState(false)
  const [tagCategoryStripWidth, setTagCategoryStripWidth] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchScope, setSearchScope] = useState<SampleSearchScope>('all')
  const [customSearchFields, setCustomSearchFields] = useState<SampleSearchCustomField[]>(
    DEFAULT_SAMPLE_SEARCH_CUSTOM_FIELDS,
  )
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false)
  const [selectedSampleId, setSelectedSampleId] = useState<number | null>(null)
  const isBulkRenameMode = bulkRenameMode
  const previousSelectedSampleBeforeBulkRenameRef = useRef<number | null>(null)
  const wasBulkRenameModeRef = useRef(isBulkRenameMode)
  const [viewMode, setViewMode] = useState<'grid' | 'list' | 'space'>('grid')
  const [selectedSampleIds, setSelectedSampleIds] = useState<Set<number>>(new Set())
  const [editingTrackId, setEditingTrackId] = useState<number | null>(null)
  const [showCustomOrder, setShowCustomOrder] = useState(false)
  const [showLibraryImportModal, setShowLibraryImportModal] = useState(false)
  const [isImportingLibrary, setIsImportingLibrary] = useState(false)
  const [isTreeSidebarOpen, setIsTreeSidebarOpen] = useState(() => getViewportWidth() >= 1024)
  const [treeSidebarTargetOpen, setTreeSidebarTargetOpen] = useState(() => getViewportWidth() >= 1024)
  const [isTreeSidebarTransitioning, setIsTreeSidebarTransitioning] = useState(false)
  const [isTreeSidebarLocked] = useState(() => getViewportWidth() >= 1024)
  const [isTreeSidebarCollapsed, setIsTreeSidebarCollapsed] = useState(false)
  const { confirm, alert: showAlert, dialogNode } = useAppDialog()

  // Similarity mode state
  const [similarityMode, setSimilarityMode] = useState<{
    enabled: boolean
    referenceSampleId: number
    referenceSampleName: string
    minSimilarity: number  // 0-1 range
  } | null>(null)

  // Advanced filters
  const [minDuration, setMinDuration] = useState<number>(0)
  const [maxDuration, setMaxDuration] = useState<number>(300)
  const [minLoudness, setMinLoudness] = useState<number>(-60)
  const [maxLoudness, setMaxLoudness] = useState<number>(0)
  const [duplicateMatchFilter, setDuplicateMatchFilter] = useState<DuplicateMatchFilter>('all')
  const [duplicateFormatFilter, setDuplicateFormatFilter] = useState<string>('all')
  const [duplicateKeepStrategy, setDuplicateKeepStrategy] = useState<DuplicateKeepStrategy>('highest-quality')
  const [duplicateScopeFilter, setDuplicateScopeFilter] = useState<DuplicateScopeFilter>('all')
  const [duplicateProtectFavorites, setDuplicateProtectFavorites] = useState(true)
  const [duplicatePreferAssigned, setDuplicatePreferAssigned] = useState(true)
  const [duplicatePairDeletionOverrides, setDuplicatePairDeletionOverrides] = useState<Record<string, number | null>>({})
  const [isDuplicateModeActive, setIsDuplicateModeActive] = useState(false)
  const [duplicateModeFilter, setDuplicateModeFilter] = useState<DuplicateModeFilter>('all-duplicates')
  const duplicateModePreviousSelectionRef = useRef<Set<number> | null>(null)
  const duplicateModePreviousSampleRef = useRef<number | null>(null)
  const tagCategoryStripRef = useRef<HTMLDivElement | null>(null)
  const tagCategoryMoreRef = useRef<HTMLDivElement | null>(null)
  const [tunePlaybackMode, setTunePlaybackMode] = useState<TunePlaybackMode>(() => getTunePlaybackMode())
  const queryClient = useQueryClient()
  const mainPanelRef = useRef<HTMLDivElement>(null)
  const overlaySidebarRef = useRef<HTMLElement | null>(null)
  const [panelWidth, setPanelWidth] = useState(9999)
  const [viewportWidth, setViewportWidth] = useState(() => getViewportWidth())
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 900
  const advancedFilterPanel = useResizablePanel({
    direction: 'vertical',
    initialSize: Math.max(220, Math.floor(viewportHeight * 0.44)),
    minSize: 120,
    maxSize: Math.max(260, Math.floor(viewportHeight * 0.62)),
    storageKey: 'sources-advanced-filter-height',
  })
  const filterDockPanel = useResizablePanel({
    direction: 'vertical',
    initialSize: Math.max(220, Math.floor(viewportHeight * 0.34)),
    minSize: 180,
    maxSize: Math.max(300, Math.floor(viewportHeight * 0.72)),
    storageKey: 'sources-filter-dock-height',
    dragMultiplier: -1,
  })
  const treeSidebarMinWidth = viewportWidth < 480 ? 148 : viewportWidth < 768 ? 164 : 184
  const treeSidebarMaxWidth = Math.max(
    treeSidebarMinWidth + 48,
    Math.min(
      360,
      viewportWidth < 768
        ? Math.floor(viewportWidth * 0.78)
        : viewportWidth < 1200
          ? Math.floor(viewportWidth * 0.44)
          : Math.floor(viewportWidth * 0.32),
    ),
  )
  const treeSidebarInitialWidth = Math.max(
    treeSidebarMinWidth,
    Math.min(
      treeSidebarMaxWidth,
      viewportWidth < 700 ? 208 : viewportWidth < 1100 ? 232 : 256,
    ),
  )
  const treeSidebarPanel = useResizablePanel({
    direction: 'horizontal',
    initialSize: treeSidebarInitialWidth,
    minSize: treeSidebarMinWidth,
    maxSize: treeSidebarMaxWidth,
    storageKey: 'sources-tree-sidebar-width',
  })

  useEffect(() => {
    const handleTunePlaybackModeChanged = (event: Event) => {
      const detail = (event as CustomEvent<TunePlaybackMode>).detail
      if (detail) {
        setTunePlaybackMode(detail)
      } else {
        setTunePlaybackMode(getTunePlaybackMode())
      }
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key === TUNE_PLAYBACK_MODE_STORAGE_KEY) {
        setTunePlaybackMode(getTunePlaybackMode())
      }
    }

    window.addEventListener(TUNE_PLAYBACK_MODE_EVENT, handleTunePlaybackModeChanged)
    window.addEventListener('storage', handleStorage)

    return () => {
      window.removeEventListener(TUNE_PLAYBACK_MODE_EVENT, handleTunePlaybackModeChanged)
      window.removeEventListener('storage', handleStorage)
    }
  }, [])

  useEffect(() => {
    const handleResize = () => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    const el = mainPanelRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      setPanelWidth(entry.contentRect.width)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

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
    dateUpdatedFrom: '',
    dateUpdatedTo: '',
    pitchFilterMode: 'fundamental',
    selectedNotes: [],
    relatedNotesLevels: [],
    selectedKeys: [],
    selectedEnvelopeTypes: [],
    minBrightness: 0,
    maxBrightness: 1,
    minHarmonicity: 0,
    maxHarmonicity: 1,
    minNoisiness: 0,
    maxNoisiness: 1,
    minAttack: 0,
    maxAttack: 1,
    minDynamics: 0,
    maxDynamics: 1,
    minSaturation: 0,
    maxSaturation: 1,
    minSurface: 0,
    maxSurface: 1,
    minDensity: 0,
    maxDensity: 1,
    minAmbience: 0,
    maxAmbience: 1,
    minStereoWidth: 0,
    maxStereoWidth: 1,
    minDepth: 0,
    maxDepth: 1,
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
  const toDimensionMin = (value: number | undefined) => {
    const normalized = Number.isFinite(value) ? (value as number) : 0
    return normalized > 0 ? normalized : undefined
  }
  const toDimensionMax = (value: number | undefined) => {
    const normalized = Number.isFinite(value) ? (value as number) : 1
    return normalized < 1 ? normalized : undefined
  }
  const { data: samplesData, isLoading: isSamplesLoading } = useScopedSamples(
    currentScope,
    selectedTags,
    '',
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
      dateUpdatedFrom: audioFilter.dateUpdatedFrom || undefined,
      dateUpdatedTo: audioFilter.dateUpdatedTo || undefined,
      similarTo: similarityMode?.enabled ? similarityMode.referenceSampleId : undefined,
      minSimilarity: similarityMode?.enabled ? similarityMode.minSimilarity : undefined,
      brightnessMin: toDimensionMin(audioFilter.minBrightness),
      brightnessMax: toDimensionMax(audioFilter.maxBrightness),
      harmonicityMin: toDimensionMin(audioFilter.minHarmonicity),
      harmonicityMax: toDimensionMax(audioFilter.maxHarmonicity),
      noisinessMin: toDimensionMin(audioFilter.minNoisiness),
      noisinessMax: toDimensionMax(audioFilter.maxNoisiness),
      attackMin: toDimensionMin(audioFilter.minAttack),
      attackMax: toDimensionMax(audioFilter.maxAttack),
      dynamicsMin: toDimensionMin(audioFilter.minDynamics),
      dynamicsMax: toDimensionMax(audioFilter.maxDynamics),
      saturationMin: toDimensionMin(audioFilter.minSaturation),
      saturationMax: toDimensionMax(audioFilter.maxSaturation),
      surfaceMin: toDimensionMin(audioFilter.minSurface),
      surfaceMax: toDimensionMax(audioFilter.maxSurface),
      densityMin: toDimensionMin(audioFilter.minDensity),
      densityMax: toDimensionMax(audioFilter.maxDensity),
      ambienceMin: toDimensionMin(audioFilter.minAmbience),
      ambienceMax: toDimensionMax(audioFilter.maxAmbience),
      stereoWidthMin: toDimensionMin(audioFilter.minStereoWidth),
      stereoWidthMax: toDimensionMax(audioFilter.maxStereoWidth),
      depthMin: toDimensionMin(audioFilter.minDepth),
      depthMax: toDimensionMax(audioFilter.maxDepth),
    }
  )
  const { data: overviewSamplesData } = useScopedSamples(currentScope, [], '', false)
  const { data: allTags = [] } = useTags()
  const [activeCollectionId, setActiveCollectionId] = useState<number | null>(null)
  const { data: allFolders = [] } = useFolders()
  const {
    data: duplicateData,
    isFetching: isDuplicateScanRunning,
    refetch: refetchDuplicates,
  } = useQuery({
    queryKey: ['duplicates'],
    queryFn: getDuplicateSlices,
    enabled: false,
  })

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
  const deleteSlice = useDeleteSliceGlobal()
  const batchDeleteSlices = useBatchDeleteSlices()
  const batchReanalyzeSlices = useBatchReanalyzeSlices()
  const createTagFromFolder = useCreateTagFromFolder()
  const createImportedFolder = useCreateImportedFolder()
  const deleteSource = useDeleteSource()

  // Derived data
  const allSamples = useMemo(() => {
    const incoming = samplesData?.samples || []
    return Array.from(new Map(incoming.map((sample) => [sample.id, sample])).values())
  }, [samplesData?.samples])
  const overviewBaseSamples = useMemo(() => {
    const incoming = overviewSamplesData?.samples || []
    return Array.from(new Map(incoming.map((sample) => [sample.id, sample])).values())
  }, [overviewSamplesData?.samples])

  const ruleEvaluationContext = useMemo(
    () => buildFilterRuleEvaluationContext(allFolders, collections),
    [allFolders, collections],
  )

  const ruleSuggestions = useMemo<FilterRuleSuggestionMap>(() => {
    const toSortedUnique = (values: Array<string | null | undefined>, limit = 120) => {
      const unique = Array.from(
        new Set(
          values
            .map((value) => (value || '').trim())
            .filter((value) => value.length > 0)
        )
      )
      unique.sort((a, b) => a.localeCompare(b))
      return unique.slice(0, limit)
    }

    const sourceSuggestions = toSortedUnique(allSamples.map((sample) => sample.track.source || ''))

    return {
      artist: toSortedUnique(allSamples.map((sample) => sample.track.artist || '')),
      sample_name: toSortedUnique(allSamples.map((sample) => sample.name || '')),
      track_title: toSortedUnique(allSamples.map((sample) => sample.track.title || '')),
      instrument: toSortedUnique(allSamples.map((sample) => sample.instrumentType || sample.instrumentPrimary || '')),
      genre: toSortedUnique(allSamples.map((sample) => sample.genrePrimary || '')),
      key: toSortedUnique(allSamples.map((sample) => sample.keyEstimate || '')),
      source: sourceSuggestions.length > 0 ? sourceSuggestions : ['local', 'youtube'],
      tag: toSortedUnique(allTags.map((tag) => tag.name)),
      folder: toSortedUnique(allFolders.map((folder) => folder.name)),
      collection: toSortedUnique(collections.map((collection) => collection.name)),
    }
  }, [allSamples, allTags, allFolders, collections])

  const folderCollectionNameById = useMemo(
    () => buildFolderCollectionNameMap(allFolders, collections),
    [allFolders, collections],
  )

  const normalizedSearchTerm = useMemo(
    () => normalizeSampleSearchTerm(searchQuery),
    [searchQuery],
  )

  const duplicateFormats = useMemo(() => {
    if (!duplicateData) return []
    const formats = new Set<string>()
    for (const group of duplicateData.groups) {
      for (const sample of group.samples) {
        formats.add(getSampleFormat(sample))
      }
    }
    return Array.from(formats.values()).sort((a, b) => a.localeCompare(b))
  }, [duplicateData])

  const currentScopeSampleIds = useMemo(() => {
    const ids = new Set<number>()
    const collectionFolderIds =
      currentScope.type === 'collection'
        ? new Set(
            allFolders
              .filter((folder) => folder.collectionId === currentScope.collectionId)
              .map((folder) => folder.id),
          )
        : null

    for (const sample of overviewBaseSamples) {
      if (currentScope.type === 'my-folder') {
        if ((sample.folderIds ?? []).includes(currentScope.folderId)) {
          ids.add(sample.id)
        }
        continue
      }

      if (currentScope.type === 'collection') {
        const folderIds = sample.folderIds ?? []
        if (collectionFolderIds && folderIds.some((id) => collectionFolderIds.has(id))) {
          ids.add(sample.id)
        }
        continue
      }

      ids.add(sample.id)
    }

    return ids
  }, [overviewBaseSamples, currentScope, allFolders])

  const duplicatePairs = useMemo<DuplicatePair[]>(() => {
    if (!duplicateData) return []

    const pairs: DuplicatePair[] = []

    duplicateData.groups.forEach((group, groupIndex) => {
      if (duplicateMatchFilter !== 'all' && group.matchType !== duplicateMatchFilter) return
      if (group.samples.length < 2) return

      const keepSample = pickSampleToKeep(group.samples, {
        strategy: duplicateKeepStrategy,
        protectFavorites: duplicateProtectFavorites,
        preferAssigned: duplicatePreferAssigned,
      })
      if (keepSample.id <= 0) return

      const keepFormat = getSampleFormat(keepSample)
      const keepQualityLabel = formatSampleQuality(keepSample)
      const keepInCurrentScope = currentScopeSampleIds.has(keepSample.id)
      const keepAssignmentScore = getSampleAssignmentScore(keepSample)
      group.samples
        .filter((sample) => sample.id !== keepSample.id)
        .sort((a, b) => a.id - b.id)
        .forEach((duplicateSample, pairIndex) => {
          const duplicateFormat = getSampleFormat(duplicateSample)
          const duplicateInCurrentScope = currentScopeSampleIds.has(duplicateSample.id)
          if (duplicateScopeFilter === 'current' && !duplicateInCurrentScope) return

          const duplicateProtectedByFavorite = duplicateProtectFavorites && Boolean(duplicateSample.favorite)
          const duplicateAssignmentScore = getSampleAssignmentScore(duplicateSample)
          const defaultMarkedForDeletion =
            (duplicateFormatFilter === 'all' || duplicateFormat === duplicateFormatFilter) &&
            !duplicateProtectedByFavorite

          pairs.push({
            id: `${groupIndex}:${pairIndex}:${keepSample.id}:${duplicateSample.id}`,
            matchType: group.matchType,
            hashSimilarity: group.hashSimilarity,
            keepSample,
            duplicateSample,
            keepFormat,
            duplicateFormat,
            keepQualityLabel,
            duplicateQualityLabel: formatSampleQuality(duplicateSample),
            keepInCurrentScope,
            duplicateInCurrentScope,
            keepAssignmentScore,
            duplicateAssignmentScore,
            defaultDeleteSampleId: defaultMarkedForDeletion ? duplicateSample.id : null,
          })
        })
    })

    return pairs
  }, [
    currentScopeSampleIds,
    duplicateData,
    duplicateFormatFilter,
    duplicateKeepStrategy,
    duplicateMatchFilter,
    duplicatePreferAssigned,
    duplicateProtectFavorites,
    duplicateScopeFilter,
  ])

  const duplicatePairDecisions = useMemo<DuplicatePairDecision[]>(() => {
    return duplicatePairs.map((pair) => {
      const canDeleteKeepSample = !(duplicateProtectFavorites && Boolean(pair.keepSample.favorite))
      const canDeleteDuplicateSample = !(duplicateProtectFavorites && Boolean(pair.duplicateSample.favorite))
      const overrideChoiceRaw = duplicatePairDeletionOverrides[pair.id]
      const overrideChoice =
        overrideChoiceRaw === null ||
        overrideChoiceRaw === pair.keepSample.id ||
        overrideChoiceRaw === pair.duplicateSample.id
          ? overrideChoiceRaw
          : undefined
      const defaultChoice = pair.defaultDeleteSampleId
      const requestedChoice = overrideChoice !== undefined ? overrideChoice : defaultChoice

      let selectedDeleteSampleId: number | null = null
      if (requestedChoice === pair.keepSample.id && canDeleteKeepSample) {
        selectedDeleteSampleId = pair.keepSample.id
      } else if (requestedChoice === pair.duplicateSample.id && canDeleteDuplicateSample) {
        selectedDeleteSampleId = pair.duplicateSample.id
      }

      return {
        ...pair,
        canDeleteKeepSample,
        canDeleteDuplicateSample,
        selectedDeleteSampleId,
        selectedDeleteSampleRole:
          selectedDeleteSampleId === pair.keepSample.id
            ? 'keep'
            : selectedDeleteSampleId === pair.duplicateSample.id
              ? 'duplicate'
              : null,
        isManualChoice:
          overrideChoice !== undefined &&
          overrideChoice !== defaultChoice,
      }
    })
  }, [duplicatePairDeletionOverrides, duplicatePairs, duplicateProtectFavorites])

  useEffect(() => {
    setDuplicatePairDeletionOverrides((prev) => {
      const pairsById = new Map(duplicatePairs.map((pair) => [pair.id, pair]))
      let changed = false
      const next: Record<string, number | null> = {}

      for (const [pairId, choice] of Object.entries(prev)) {
        const pair = pairsById.get(pairId)
        if (!pair) {
          changed = true
          continue
        }

        const isValidChoice =
          choice === null ||
          choice === pair.keepSample.id ||
          choice === pair.duplicateSample.id

        if (!isValidChoice) {
          changed = true
          continue
        }

        next[pairId] = choice
      }

      return changed ? next : prev
    })
  }, [duplicatePairs])

  const duplicateIdsToDelete = useMemo(
    () =>
      Array.from(
        new Set(
          duplicatePairDecisions
            .map((pair) => pair.selectedDeleteSampleId)
            .filter((id): id is number => typeof id === 'number' && id > 0),
        ),
      ),
    [duplicatePairDecisions],
  )
  const duplicateIdsToDeleteSet = useMemo(
    () => new Set<number>(duplicateIdsToDelete),
    [duplicateIdsToDelete],
  )
  const duplicateFilteredSampleIds = useMemo(() => {
    const ids = new Set<number>()
    duplicatePairDecisions.forEach((pair) => {
      ids.add(pair.keepSample.id)
      ids.add(pair.duplicateSample.id)
    })
    return ids
  }, [duplicatePairDecisions])
  const duplicateModeTargetIds = useMemo(() => {
    if (duplicateModeFilter === 'smart-remove') {
      return duplicateIdsToDeleteSet
    }
    return duplicateFilteredSampleIds
  }, [duplicateIdsToDeleteSet, duplicateFilteredSampleIds, duplicateModeFilter])
  const duplicateSamplesInScopeCount = useMemo(
    () => allSamples.filter((sample) => duplicateFilteredSampleIds.has(sample.id)).length,
    [allSamples, duplicateFilteredSampleIds],
  )
  const smartRemoveSamplesInScopeCount = useMemo(
    () => allSamples.filter((sample) => duplicateIdsToDeleteSet.has(sample.id)).length,
    [allSamples, duplicateIdsToDeleteSet],
  )
  const activeDuplicateModeCount =
    duplicateModeFilter === 'smart-remove' ? smartRemoveSamplesInScopeCount : duplicateSamplesInScopeCount
  const duplicatePairsMarkedForDeletionCount = useMemo(
    () => duplicatePairDecisions.filter((pair) => pair.selectedDeleteSampleId !== null).length,
    [duplicatePairDecisions],
  )
  const duplicateManualChoiceCount = useMemo(
    () => duplicatePairDecisions.filter((pair) => pair.isManualChoice).length,
    [duplicatePairDecisions],
  )
  const duplicateProtectedFavoriteCount = useMemo(() => {
    if (!duplicateProtectFavorites) return 0

    const protectedIds = new Set<number>()
    duplicatePairDecisions.forEach((pair) => {
      if (pair.keepSample.favorite && !pair.canDeleteKeepSample) {
        protectedIds.add(pair.keepSample.id)
      }
      if (pair.duplicateSample.favorite && !pair.canDeleteDuplicateSample) {
        protectedIds.add(pair.duplicateSample.id)
      }
    })

    return protectedIds.size
  }, [duplicatePairDecisions, duplicateProtectFavorites])

  useEffect(() => {
    if (!isDuplicateModeActive) return

    setSelectedSampleIds((prev) => {
      if (prev.size === 0) return prev
      const next = new Set(Array.from(prev).filter((id) => duplicateModeTargetIds.has(id)))
      return next.size === prev.size ? prev : next
    })

    if (selectedSampleId !== null && !duplicateModeTargetIds.has(selectedSampleId)) {
      setSelectedSampleId(null)
      onWorkspaceStateChange?.(null)
    }
  }, [duplicateModeTargetIds, isDuplicateModeActive, onWorkspaceStateChange, selectedSampleId])

  useEffect(() => {
    if (duplicateFormatFilter === 'all') return
    if (!duplicateFormats.includes(duplicateFormatFilter)) {
      setDuplicateFormatFilter('all')
    }
  }, [duplicateFormatFilter, duplicateFormats])

  const scopeCollectionFolderIds = useMemo(() => {
    if (currentScope.type !== 'collection') return null
    return new Set(
      allFolders
        .filter((folder) => folder.collectionId === currentScope.collectionId)
        .map((folder) => folder.id),
    )
  }, [allFolders, currentScope])

  const matchesScopeFallback = (sample: SliceWithTrackExtended) => {
    if (currentScope.type === 'my-folder') {
      return (sample.folderIds ?? []).includes(currentScope.folderId)
    }

    if (currentScope.type === 'collection') {
      const itemFolderIds = sample.folderIds ?? []
      if (!scopeCollectionFolderIds || scopeCollectionFolderIds.size === 0) return false
      return itemFolderIds.some((id) => scopeCollectionFolderIds.has(id))
    }

    return true
  }

  const overviewSamples = useMemo(
    () => overviewBaseSamples.filter((sample) => matchesScopeFallback(sample)),
    [overviewBaseSamples, currentScope, scopeCollectionFolderIds],
  )

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
    const isRangeActive = (min: number | undefined, max: number | undefined) =>
      (min ?? 0) > 0 || (max ?? 1) < 1

    const matchesNormalizedRange = (
      value: number | null | undefined,
      min: number | undefined,
      max: number | undefined,
    ) => {
      if (!isRangeActive(min, max)) return true
      if (typeof value !== 'number' || !Number.isFinite(value)) return false
      const minValue = min ?? 0
      const maxValue = max ?? 1
      return value >= minValue && value <= maxValue
    }

    const matchesDateRange = (
      value: string | null | undefined,
      from: string,
      to: string,
    ) => {
      if (!from && !to) return true
      if (!value) return false
      if (from && value < from) return false
      if (to && value > `${to}T23:59:59`) return false
      return true
    }

    return allSamples.filter(sample => {
      if (!matchesScopeFallback(sample)) return false

      if (isDuplicateModeActive && !duplicateModeTargetIds.has(sample.id)) {
        return false
      }

      if (
        !matchesSampleSearchTerm(sample, normalizedSearchTerm, searchScope, {
          folderCollectionNameById,
          customFields: customSearchFields,
        })
      ) {
        return false
      }

      const applyFolderFilters =
        currentScope.type === 'all' ||
        currentScope.type === 'youtube' ||
        currentScope.type === 'youtube-video' ||
        currentScope.type === 'local' ||
        currentScope.type === 'library'

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

      // Loudness filter (dB)
      if (minLoudness > -60 || maxLoudness < 0) {
        if (typeof sample.loudness !== 'number') return false
        if (sample.loudness < minLoudness || sample.loudness > maxLoudness) {
          return false
        }
      }

      // Envelope type filter
      if (audioFilter.selectedEnvelopeTypes.length > 0) {
        if (!sample.envelopeType || !audioFilter.selectedEnvelopeTypes.includes(sample.envelopeType)) {
          return false
        }
      }

      if (!matchesDateRange(sample.dateAdded, audioFilter.dateAddedFrom, audioFilter.dateAddedTo)) {
        return false
      }
      if (!matchesDateRange(sample.dateCreated, audioFilter.dateCreatedFrom, audioFilter.dateCreatedTo)) {
        return false
      }
      if (!matchesDateRange(sample.dateModified, audioFilter.dateUpdatedFrom, audioFilter.dateUpdatedTo)) {
        return false
      }

      const normalizedDimensions = sample.dimensionNormalized
      const normalizedSubjective = sample.subjectiveNormalized
      const normalizedWarmth = normalizedSubjective?.warmth ?? sample.warmth
      const normalizedHardness = normalizedSubjective?.hardness ?? sample.hardness
      const normalizedBrightness = normalizedDimensions?.brightness ?? normalizedSubjective?.brightness ?? sample.brightness
      const normalizedHarmonicity = normalizedDimensions?.harmonicity
      const normalizedNoisiness =
        normalizedDimensions?.noisiness ??
        normalizedSubjective?.noisiness ??
        sample.noisiness ??
        sample.roughness
      const normalizedAttack = normalizedDimensions?.attack ?? normalizedSubjective?.hardness ?? sample.hardness
      const normalizedDynamics = normalizedDimensions?.dynamics
      const normalizedSaturation = normalizedDimensions?.saturation ?? sample.roughness
      const normalizedSurface = normalizedDimensions?.surface ?? sample.roughness
      const normalizedDensity = normalizedDimensions?.density
      const normalizedAmbience = normalizedDimensions?.ambience
      const normalizedStereoWidth = normalizedDimensions?.stereoWidth
      const normalizedDepth = normalizedDimensions?.depth

      if (!matchesNormalizedRange(normalizedBrightness, audioFilter.minBrightness, audioFilter.maxBrightness)) {
        return false
      }
      if (!matchesNormalizedRange(normalizedWarmth, audioFilter.minWarmth, audioFilter.maxWarmth)) {
        return false
      }
      if (!matchesNormalizedRange(normalizedHardness, audioFilter.minHardness, audioFilter.maxHardness)) {
        return false
      }
      if (!matchesNormalizedRange(normalizedHarmonicity, audioFilter.minHarmonicity, audioFilter.maxHarmonicity)) {
        return false
      }
      if (!matchesNormalizedRange(normalizedNoisiness, audioFilter.minNoisiness, audioFilter.maxNoisiness)) {
        return false
      }
      if (!matchesNormalizedRange(normalizedAttack, audioFilter.minAttack, audioFilter.maxAttack)) {
        return false
      }
      if (!matchesNormalizedRange(normalizedDynamics, audioFilter.minDynamics, audioFilter.maxDynamics)) {
        return false
      }
      if (!matchesNormalizedRange(normalizedSaturation, audioFilter.minSaturation, audioFilter.maxSaturation)) {
        return false
      }
      if (!matchesNormalizedRange(normalizedSurface, audioFilter.minSurface, audioFilter.maxSurface)) {
        return false
      }
      if (!matchesNormalizedRange(normalizedDensity, audioFilter.minDensity, audioFilter.maxDensity)) {
        return false
      }
      if (!matchesNormalizedRange(normalizedAmbience, audioFilter.minAmbience, audioFilter.maxAmbience)) {
        return false
      }
      if (!matchesNormalizedRange(normalizedStereoWidth, audioFilter.minStereoWidth, audioFilter.maxStereoWidth)) {
        return false
      }
      if (!matchesNormalizedRange(normalizedDepth, audioFilter.minDepth, audioFilter.maxDepth)) {
        return false
      }

      // Database-style rule builder filters
      if (!matchesFilterRuleQuery(sample, queryRules, ruleEvaluationContext)) {
        return false
      }

      return true
    })
  }, [
    allSamples,
    currentScope,
    selectedFolderIds,
    excludedTags,
    excludedFolderIds,
    minDuration,
    maxDuration,
    minLoudness,
    maxLoudness,
    audioFilter,
    scopeCollectionFolderIds,
    normalizedSearchTerm,
    searchScope,
    customSearchFields,
    folderCollectionNameById,
    queryRules,
    ruleEvaluationContext,
    isDuplicateModeActive,
    duplicateModeTargetIds,
  ])

  const duplicatePairRender = useMemo(() => {
    const pairMetaBySampleId = new Map<number, DuplicatePairRenderMeta>()
    if (!isDuplicateModeActive || duplicatePairDecisions.length === 0 || samples.length === 0) {
      return {
        orderedSamples: samples,
        pairMetaBySampleId,
      }
    }

    const samplesById = new Map(samples.map((sample) => [sample.id, sample]))
    const orderedSamples: SliceWithTrackExtended[] = []
    const usedSampleIds = new Set<number>()
    let pairIndex = 0

    for (const pair of duplicatePairDecisions) {
      const keepSample = samplesById.get(pair.keepSample.id)
      const duplicateSample = samplesById.get(pair.duplicateSample.id)
      if (!keepSample || !duplicateSample) continue

      pairIndex += 1
      const similarityPercent = Math.round(pair.hashSimilarity * 100)
      orderedSamples.push(keepSample, duplicateSample)
      usedSampleIds.add(keepSample.id)
      usedSampleIds.add(duplicateSample.id)

      pairMetaBySampleId.set(keepSample.id, {
        pairId: pair.id,
        pairIndex,
        role: 'keep',
        partnerSampleId: duplicateSample.id,
        selectedForDelete: pair.selectedDeleteSampleRole === 'keep',
        selectedDeleteSampleId: pair.selectedDeleteSampleId,
        canDelete: pair.canDeleteKeepSample,
        matchType: pair.matchType,
        similarityPercent,
      })

      pairMetaBySampleId.set(duplicateSample.id, {
        pairId: pair.id,
        pairIndex,
        role: 'duplicate',
        partnerSampleId: keepSample.id,
        selectedForDelete: pair.selectedDeleteSampleRole === 'duplicate',
        selectedDeleteSampleId: pair.selectedDeleteSampleId,
        canDelete: pair.canDeleteDuplicateSample,
        matchType: pair.matchType,
        similarityPercent,
      })
    }

    for (const sample of samples) {
      if (!usedSampleIds.has(sample.id)) {
        orderedSamples.push(sample)
      }
    }

    return {
      orderedSamples: orderedSamples.length > 0 ? orderedSamples : samples,
      pairMetaBySampleId,
    }
  }, [duplicatePairDecisions, isDuplicateModeActive, samples])

  const displaySamples = duplicatePairRender.orderedSamples
  const duplicatePairMetaBySampleId = duplicatePairRender.pairMetaBySampleId
  const hasDuplicatePairRender = duplicatePairMetaBySampleId.size > 0
  const duplicatePairDecisionBySampleId = useMemo(() => {
    const bySampleId = new Map<number, DuplicatePairDecision>()
    duplicatePairDecisions.forEach((pair) => {
      bySampleId.set(pair.keepSample.id, pair)
      bySampleId.set(pair.duplicateSample.id, pair)
    })
    return bySampleId
  }, [duplicatePairDecisions])

  useEffect(() => {
    onVisibleSamplesChange?.(displaySamples)
  }, [displaySamples, onVisibleSamplesChange])

  useEffect(() => {
    onSamplesLoadingChange?.(isSamplesLoading)
  }, [isSamplesLoading, onSamplesLoadingChange])

  const bulkRenamePreview = useMemo(() => {
    const byId = new Map<number, BulkRenamePreviewEntry>()
    if (!isBulkRenameMode) {
      return { byId, changedCount: 0 }
    }

    let changedCount = 0
    displaySamples.forEach((sample, index) => {
      const nextName = applyBulkRenameRules(sample.name, bulkRenameRules, index)
      const hasChange = nextName !== sample.name
      if (hasChange) changedCount += 1
      byId.set(sample.id, { nextName, hasChange })
    })

    return { byId, changedCount }
  }, [isBulkRenameMode, bulkRenameRules, displaySamples])

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

  const currentViewSampleIds = useMemo(
    () => new Set(displaySamples.map((sample) => sample.id)),
    [displaySamples],
  )
  const selectedSampleIdsInCurrentView = useMemo(() => {
    if (selectedSampleIds.size === 0) return new Set<number>()
    return new Set(
      Array.from(selectedSampleIds).filter((id) => currentViewSampleIds.has(id)),
    )
  }, [selectedSampleIds, currentViewSampleIds])

  const selectedSample = useMemo<SliceWithTrackExtended | null>(() => {
    if (!selectedSampleId) return null
    return displaySamples.find(s => s.id === selectedSampleId) || null
  }, [selectedSampleId, displaySamples])

  useEffect(() => {
    if (isBulkRenameMode === wasBulkRenameModeRef.current) return

    if (isBulkRenameMode) {
      previousSelectedSampleBeforeBulkRenameRef.current = selectedSampleId
      if (selectedSampleId !== null) {
        setSelectedSampleId(null)
        onWorkspaceStateChange?.(null)
      }
    } else {
      const previousSelectedSampleId = previousSelectedSampleBeforeBulkRenameRef.current
      previousSelectedSampleBeforeBulkRenameRef.current = null
      if (selectedSampleId === null && previousSelectedSampleId !== null) {
        setSelectedSampleId(previousSelectedSampleId)
      }
    }

    wasBulkRenameModeRef.current = isBulkRenameMode
  }, [isBulkRenameMode, onWorkspaceStateChange, selectedSampleId])

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

  // Keep Space view aligned with the exact list/grid dataset.
  // This avoids double-filtering mismatches when some optional fields are not
  // present in /slices/features payloads.
  const spaceViewSliceIds = useMemo(() => displaySamples.map((sample) => sample.id), [displaySamples])

  // Clear selected sample if it's no longer in the list
  useEffect(() => {
    if (selectedSampleId && !selectedSample && displaySamples.length > 0) {
      setSelectedSampleId(null)
      onWorkspaceStateChange?.(null)
    }
  }, [selectedSampleId, selectedSample, displaySamples.length, onWorkspaceStateChange])

  // Handlers
  const handleScopeChange = (scope: SourceScope) => {
    setCurrentScope(scope)
    if (scope.type === 'collection' || scope.type === 'my-folder' || scope.type === 'folder') {
      setSelectedFolderIds([])
      setExcludedFolderIds([])
    }
    setSelectedSampleId(null)
    onWorkspaceStateChange?.(null)
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

  const handleCreateTagFromFolder = (folderId: number, name: string, color: string) => {
    createTagFromFolder.mutate({ folderId, name, color })
  }

  const handleCreateImportedFolder = async (parentPath: string, name: string) => {
    await createImportedFolder.mutateAsync({ parentPath, name })
  }

  const normalizeSourcePath = (value: string) =>
    value
      .replace(/\\+/g, '/')
      .replace(/\/+/g, '/')
      .replace(/\/+$/, '')
      .toLowerCase()

  const getSourceFolderDisplayName = (value: string) => {
    const normalized = value.replace(/\\+/g, '/').replace(/\/+$/, '')
    const segments = normalized.split('/').filter(Boolean)
    return segments[segments.length - 1] || value
  }

  const currentScopeDeleteAction = useMemo(() => {
    if (currentScope.type === 'local') {
      return {
        scope: 'local',
        label: 'all local sample sources',
        buttonLabel: 'Delete Local Sources',
      }
    }

    if (currentScope.type === 'folder') {
      const folderName = getSourceFolderDisplayName(currentScope.path)
      return {
        scope: `folder:${currentScope.path}`,
        label: `imported folder "${folderName}"`,
        buttonLabel: `Delete Folder Source: ${folderName}`,
      }
    }

    if (currentScope.type === 'library') {
      const libraryName =
        sourceTree?.libraries?.find((library) => library.id === currentScope.libraryId)?.name ||
        currentScope.libraryId
      return {
        scope: `library:${currentScope.libraryId}`,
        label: `library source "${libraryName}"`,
        buttonLabel: `Delete Library Source: ${libraryName}`,
      }
    }

    return null
  }, [currentScope, sourceTree])

  const handleDeleteSource = (scope: string, label: string) => {
    if (!scope.trim()) return
    void (async () => {
      const confirmed = await confirm({
        title: 'Delete Source',
        message: `Delete ${label}? This will remove its imported tracks and slices from the library.`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        isDestructive: true,
      })
      if (!confirmed) return

      try {
        await deleteSource.mutateAsync({ scope })

        const shouldResetScope =
          (scope === 'youtube' && (currentScope.type === 'youtube' || currentScope.type === 'youtube-video')) ||
          (scope.startsWith('youtube:') &&
            currentScope.type === 'youtube-video' &&
            String(currentScope.trackId) === scope.slice('youtube:'.length)) ||
          (scope === 'local' && currentScope.type === 'local') ||
          (scope.startsWith('library:') &&
            currentScope.type === 'library' &&
            currentScope.libraryId === scope.slice('library:'.length)) ||
          (scope.startsWith('folder:') &&
            currentScope.type === 'folder' &&
            (() => {
              const deletedFolderPath = normalizeSourcePath(scope.slice('folder:'.length))
              const activeFolderPath = normalizeSourcePath(currentScope.path)
              return activeFolderPath === deletedFolderPath || activeFolderPath.startsWith(`${deletedFolderPath}/`)
            })())

        if (shouldResetScope) {
          setCurrentScope({ type: 'all' })
          setSelectedSampleId(null)
          onWorkspaceStateChange?.(null)
        }
      } catch (error) {
        console.error('Failed to delete source:', error)
        await showAlert({
          title: 'Delete Failed',
          message: 'Failed to delete source. Please try again.',
          isDestructive: true,
        })
      }
    })()
  }

  const handleImportLibrary = async (payload: {
    libraryPath: string
    mode: 'replace' | 'source'
    importCollections: boolean
    collectionNames: string[]
    collectionNameSuffix: string
  }) => {
    if (payload.mode === 'replace') {
      const firstConfirmed = await confirm({
        title: 'Replace Library',
        message: 'This will replace your current library metadata (tracks, slices, tags, folders, and collections). Continue?',
        confirmText: 'Continue',
        cancelText: 'Cancel',
        isDestructive: true,
      })
      if (!firstConfirmed) return

      const secondConfirmed = await confirm({
        title: 'Final Confirmation',
        message: 'Final check: replace your current library now? A backup will be created automatically.',
        confirmText: 'Replace Library',
        cancelText: 'Cancel',
        isDestructive: true,
      })
      if (!secondConfirmed) return
    }

    const options: LibraryImportOptions = { mode: payload.mode }
    if (payload.mode === 'source') {
      if (payload.importCollections) options.importCollections = true
      if (payload.collectionNames.length > 0) options.collectionNames = payload.collectionNames
      if (payload.collectionNameSuffix.trim()) options.collectionNameSuffix = payload.collectionNameSuffix.trim()
    }

    setIsImportingLibrary(true)
    try {
      const result = await importLibrary(payload.libraryPath, options)
      setShowLibraryImportModal(false)

      if (payload.mode === 'replace') {
        window.location.reload()
        return
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['tracks'] }),
        queryClient.invalidateQueries({ queryKey: ['allSlices'] }),
        queryClient.invalidateQueries({ queryKey: ['scopedSamples'] }),
        queryClient.invalidateQueries({ queryKey: ['sourceTree'] }),
        queryClient.invalidateQueries({ queryKey: ['folders'] }),
        queryClient.invalidateQueries({ queryKey: ['folder-facets'] }),
        queryClient.invalidateQueries({ queryKey: ['collection-facets'] }),
        queryClient.invalidateQueries({ queryKey: ['collections'] }),
        queryClient.invalidateQueries({ queryKey: ['tags'] }),
      ])

      const sourceId = result.sourceId ? String(result.sourceId).trim() : ''
      if (sourceId) {
        setCurrentScope({ type: 'library', libraryId: sourceId })
      }
      setSelectedSampleId(null)
      onWorkspaceStateChange?.(null)
    } catch (error) {
      console.error('Failed to import library:', error)
      await showAlert({
        title: 'Import Failed',
        message: error instanceof Error ? error.message : 'Failed to import library. Please try again.',
        isDestructive: true,
      })
    } finally {
      setIsImportingLibrary(false)
    }
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

    void (async () => {
      const confirmed = await confirm({
        title: 'Delete Collection',
        message: `Delete collection "${target.name}"?`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        isDestructive: true,
      })
      if (!confirmed) return

      const fallback = collections.find(p => p.id !== id)
      if (activeCollectionId === id) {
        setActiveCollectionId(fallback?.id ?? null)
        setCurrentScope(fallback ? { type: 'collection', collectionId: fallback.id } : { type: 'all' })
      }
      deleteCollection.mutate(id)
    })()
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

  const computePitchForSample = (sample: SliceWithTrackExtended, tuneNote: string | null): number => {
    if (!tuneNote) return 0
    const sourceNote =
      (sample.fundamentalFrequency ? freqToNoteName(sample.fundamentalFrequency) : null) ||
      (sample.keyEstimate ? extractTonic(sample.keyEstimate) : null)
    if (!sourceNote) return 0
    return calcSemitoneShift(sourceNote, tuneNote)
  }

  const buildWorkspaceState = (sample: SliceWithTrackExtended, tuneNote: string | null): WorkspaceState => ({
    selectedSample: sample,
    allTags,
    folders,
    pitchSemitones: computePitchForSample(sample, tuneNote),
    tuneTargetNote: tuneNote,
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
      onWorkspaceStateChange?.(null)
    },
    onTuneToNote: (note) => onTuneToNote?.(note),
  })

  const handleSampleSelect = (id: number) => {
    setSelectedSampleId(id)
    const sample = samples.find(s => s.id === id) ?? allSamples.find(s => s.id === id)
    if (sample && onWorkspaceStateChange) {
      onWorkspaceStateChange(buildWorkspaceState(sample, tuneTargetNote))
    }
  }

  useEffect(() => {
    if (selectedSampleId === null) return
    const sample = samples.find(s => s.id === selectedSampleId) ?? allSamples.find(s => s.id === selectedSampleId)
    if (sample && onWorkspaceStateChange) {
      onWorkspaceStateChange(buildWorkspaceState(sample, tuneTargetNote))
    }
  }, [tuneTargetNote, selectedSampleId, samples, allSamples, onWorkspaceStateChange, allTags, folders])

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
    if (samples.length === 0) return

    const allCurrentViewSelected = selectedSampleIdsInCurrentView.size === samples.length
    setSelectedSampleIds((prev) => {
      const next = new Set(prev)
      if (allCurrentViewSelected) {
        currentViewSampleIds.forEach((id) => next.delete(id))
      } else {
        currentViewSampleIds.forEach((id) => next.add(id))
      }
      return next
    })
  }

  const handleBatchDelete = (ids: number[]) => {
    void (async () => {
      const confirmed = await confirm({
        title: 'Delete Samples',
        message: `Delete ${ids.length} selected samples?`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        isDestructive: true,
      })
      if (!confirmed) return

      batchDeleteSlices.mutate(ids, {
        onSuccess: () => setSelectedSampleIds(new Set()),
      })
    })()
  }

  const enterDuplicateMode = () => {
    if (!isDuplicateModeActive) {
      duplicateModePreviousSelectionRef.current = new Set(selectedSampleIds)
      duplicateModePreviousSampleRef.current = selectedSampleId
      setDuplicateModeFilter('all-duplicates')
    }
    setActiveFilterDockTab('duplicates')
    setIsFilterDockOpen(true)
    setIsDuplicateModeActive(true)
    if (viewMode === 'space') {
      setViewMode('list')
    }
  }

  const handleExitDuplicateMode = () => {
    if (!isDuplicateModeActive) return

    const previousSelection = duplicateModePreviousSelectionRef.current
    const previousSelectedSampleId = duplicateModePreviousSampleRef.current
    const hasSelectionInMode = selectedSampleIds.size > 0
    const hasFocusedSampleInMode = selectedSampleId !== null
    duplicateModePreviousSelectionRef.current = null
    duplicateModePreviousSampleRef.current = null

    setIsDuplicateModeActive(false)

    if (!hasSelectionInMode && previousSelection) {
      setSelectedSampleIds(new Set(previousSelection))
    }

    if (!hasFocusedSampleInMode) {
      if (previousSelectedSampleId !== null) {
        setSelectedSampleId(previousSelectedSampleId)
      } else {
        setSelectedSampleId(null)
        onWorkspaceStateChange?.(null)
      }
    }
  }

  const handleFindDuplicates = () => {
    void (async () => {
      const result = await refetchDuplicates()
      const total = result.data?.total ?? 0
      if (total > 0) {
        enterDuplicateMode()
      } else {
        handleExitDuplicateMode()
      }
    })()
  }

  const setDuplicatePairDeleteChoice = (pair: DuplicatePairDecision, sampleId: number | null) => {
    setDuplicatePairDeletionOverrides((prev) => {
      const currentOverride = prev[pair.id]
      const normalizedChoice =
        sampleId === pair.keepSample.id || sampleId === pair.duplicateSample.id
          ? sampleId
          : null
      const defaultChoice = pair.defaultDeleteSampleId
      const nextChoiceMatchesDefault = normalizedChoice === defaultChoice

      if (nextChoiceMatchesDefault) {
        if (currentOverride === undefined) return prev
        const next = { ...prev }
        delete next[pair.id]
        return next
      }

      if (currentOverride === normalizedChoice) return prev
      return {
        ...prev,
        [pair.id]: normalizedChoice,
      }
    })
  }

  const handleToggleDuplicateDeleteTarget = (pair: DuplicatePairDecision, target: 'keep' | 'duplicate') => {
    if (target === 'keep' && !pair.canDeleteKeepSample) return
    if (target === 'duplicate' && !pair.canDeleteDuplicateSample) return

    const targetSampleId = target === 'keep' ? pair.keepSample.id : pair.duplicateSample.id
    const nextChoice = pair.selectedDeleteSampleId === targetSampleId ? null : targetSampleId
    setDuplicatePairDeleteChoice(pair, nextChoice)
  }

  const handleToggleDuplicateDeleteTargetBySampleId = (sampleId: number) => {
    const pair = duplicatePairDecisionBySampleId.get(sampleId)
    if (!pair) return
    if (sampleId === pair.keepSample.id) {
      handleToggleDuplicateDeleteTarget(pair, 'keep')
      return
    }
    if (sampleId === pair.duplicateSample.id) {
      handleToggleDuplicateDeleteTarget(pair, 'duplicate')
    }
  }

  const handleDeleteDuplicates = () => {
    if (duplicateIdsToDelete.length === 0) return

    const idsToDelete = [...duplicateIdsToDelete]
    const formatSummary =
      duplicateFormatFilter === 'all'
        ? 'all formats'
        : getDuplicateFormatLabel(duplicateFormatFilter)
    const matchSummary =
      duplicateMatchFilter === 'all'
        ? 'all match types'
        : getDuplicateMatchTypeLabel(duplicateMatchFilter)

    const keepSummary =
      duplicateKeepStrategy === 'oldest'
        ? 'oldest import'
        : duplicateKeepStrategy === 'newest'
          ? 'newest import'
          : duplicateKeepStrategy === 'prefer-lossless'
            ? 'lossless sample when available'
            : 'highest quality sample'
    const scopeSummary =
      duplicateScopeFilter === 'current' ? 'current source scope only' : 'all sources'
    const favoriteSummary =
      duplicateProtectFavorites ? 'favorites protected' : 'favorites can be deleted'
    const assignmentSummary =
      duplicatePreferAssigned ? 'prefer assigned samples' : 'ignore assignment metadata'
    const manualSummary =
      duplicateManualChoiceCount > 0
        ? `${duplicateManualChoiceCount} pair choice${duplicateManualChoiceCount !== 1 ? 's' : ''} manually overridden`
        : 'no manual pair overrides'

    void (async () => {
      const confirmed = await confirm({
        title: 'Delete Duplicates',
        message: `Delete ${idsToDelete.length} duplicate samples across ${duplicatePairsMarkedForDeletionCount} pair${duplicatePairsMarkedForDeletionCount !== 1 ? 's' : ''} (${formatSummary}, ${matchSummary}, ${scopeSummary}) while keeping ${keepSummary} (${favoriteSummary}, ${assignmentSummary}, ${manualSummary})?`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        isDestructive: true,
      })
      if (!confirmed) return

      batchDeleteSlices.mutate(idsToDelete, {
        onSuccess: () => {
          setSelectedSampleIds((prev) => {
            if (prev.size === 0) return prev
            const next = new Set(prev)
            idsToDelete.forEach((id) => next.delete(id))
            return next
          })

          void queryClient.invalidateQueries({ queryKey: ['duplicates'] })
          void queryClient.invalidateQueries({ queryKey: ['scopedSamples'] })
          void refetchDuplicates()
        },
      })
    })()
  }

  const handleAnalyzeSelected = (ids: number[]) => {
    if (ids.length === 0) {
      return
    }

    const modifiedCount = samples.filter(sample => ids.includes(sample.id) && sample.sampleModified).length

    void (async () => {
      const confirmed = await confirm({
        title: 'Analyze Samples',
        message: modifiedCount > 0
          ? `Analyze ${ids.length} selected samples? (${modifiedCount} modified)`
          : `Analyze ${ids.length} selected samples?`,
        confirmText: 'Analyze',
        cancelText: 'Cancel',
      })
      if (!confirmed) return

      batchReanalyzeSlices.mutate(
        {
          sliceIds: ids,
          analysisLevel: 'advanced',
          concurrency: 2,
          includeFilenameTags: true,
        },
        {
          onSuccess: async (result) => {
            if (result.warnings && result.warnings.totalWithWarnings > 0) {
              const preview = result.warnings.messages.slice(0, 3)
              const extra = Math.max(0, result.warnings.messages.length - preview.length)
              const details = preview.map((m) => `• ${m}`).join('\n')
              await showAlert({
                title: 'Analysis Warning',
                message: [
                  `Warning: ${result.warnings.totalWithWarnings} sample(s) had potential custom state before re-analysis.`,
                  details,
                  extra > 0 ? `...and ${extra} more warning(s).` : '',
                ]
                  .filter(Boolean)
                  .join('\n'),
              })
            }
            setSelectedSampleIds(new Set())
          },
        }
      )
    })()
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
        await showAlert({
          title: 'Download Failed',
          message: 'Failed to download selected samples as ZIP. Please try again.',
          isDestructive: true,
        })
      }
    })()
  }

  const modifiedSelectedCount = useMemo(() => {
    if (selectedSampleIdsInCurrentView.size === 0) return 0
    return samples.filter((sample) => selectedSampleIdsInCurrentView.has(sample.id) && sample.sampleModified).length
  }, [samples, selectedSampleIdsInCurrentView])

  const handleDeleteSingle = (id: number) => {
    const sample = samples.find(s => s.id === id)
    if (!sample) return

    void (async () => {
      const confirmed = await confirm({
        title: 'Delete Sample',
        message: `Delete "${sample.name}"?`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        isDestructive: true,
      })
      if (!confirmed) return

      deleteSlice.mutate(id)
      if (selectedSampleId === id) {
        setSelectedSampleId(null)
      }
    })()
  }

  const handleBatchAddToFolder = (folderId: number, sampleIds: number[]) => {
    // Add each sample to the folder
    sampleIds.forEach(sliceId => {
      addSliceToFolder.mutate({ folderId, sliceId })
    })

    // Clear selection after adding
    setSelectedSampleIds(new Set())
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
      case 'library':
        return (
          sourceTree?.libraries?.find((library) => library.id === currentScope.libraryId)?.name ||
          'Library Source'
        )
      case 'my-folder':
        const folder = folders.find(c => c.id === currentScope.folderId)
        return folder?.name || 'Folder'
      case 'collection':
        const collection = collections.find(c => c.id === currentScope.collectionId)
        return collection?.name || 'Collection'
      default:
        return 'Samples'
    }
  }

  const scopeLabel = getScopeLabel()
  const searchScopeDescriptor = getSampleSearchScopeDescriptor(searchScope, customSearchFields)
  const searchScopeHint = getSampleSearchScopeHint(searchScope, customSearchFields)
  const selectAllChecked = selectedSampleIdsInCurrentView.size === samples.length && samples.length > 0
  const selectAllIndeterminate =
    selectedSampleIdsInCurrentView.size > 0 && selectedSampleIdsInCurrentView.size < samples.length

  const toggleCustomSearchField = (field: SampleSearchCustomField) => {
    setCustomSearchFields((currentFields) =>
      currentFields.includes(field)
        ? currentFields.filter((value) => value !== field)
        : [...currentFields, field],
    )
  }

  const handleSortByChange = (sortBy: AudioFilterState['sortBy']) => {
    setAudioFilter((current) => ({
      ...current,
      sortBy,
      sortOrder: sortBy ? (current.sortBy === sortBy ? current.sortOrder : 'asc') : 'asc',
    }))
  }

  const handleSortOrderChange = (sortOrder: AudioFilterState['sortOrder']) => {
    setAudioFilter((current) => {
      if (!current.sortBy) return current
      return {
        ...current,
        sortOrder,
      }
    })
  }

  useEffect(() => {
    if (selectedSampleId !== null) return
    setAudioFilter((current) => {
      if (current.sortBy !== 'similarity') return current
      return {
        ...current,
        sortBy: null,
        sortOrder: 'asc',
      }
    })
  }, [selectedSampleId])

  const normalizedTagFilterSearch = tagFilterSearchQuery.trim().toLowerCase()

  const getTagUsageCount = (tag: { id: number; name: string }) =>
    tagCounts.counts[tag.id] ?? tagCounts.countsByName[tag.name.toLowerCase()] ?? 0

  const tagCategoryTabs = useMemo(() => {
    const stats = new Map<string, { key: string; label: string; total: number; matching: number; selected: number }>()

    for (const tag of allTags) {
      const usageCount = getTagUsageCount(tag)
      if (usageCount <= 0) {
        continue
      }

      const key = normalizeTagCategory(tag.category)
      const existing = stats.get(key) ?? {
        key,
        label: formatTagCategoryLabel(key),
        total: 0,
        matching: 0,
        selected: 0,
      }
      existing.total += 1
      if (!normalizedTagFilterSearch || tag.name.toLowerCase().includes(normalizedTagFilterSearch)) {
        existing.matching += 1
      }
      if (selectedTags.includes(tag.id)) {
        existing.selected += 1
      }
      stats.set(key, existing)
    }

    const categories = Array.from(stats.values()).sort((a, b) => a.label.localeCompare(b.label))
    const matchingAll = categories.reduce((sum, category) => sum + category.matching, 0)
    const selectedAll = categories.reduce((sum, category) => sum + category.selected, 0)
    const totalAll = categories.reduce((sum, category) => sum + category.total, 0)

    return [
      {
        key: 'all',
        label: 'All',
        total: totalAll,
        matching: matchingAll,
        selected: selectedAll,
      },
      ...categories,
    ]
  }, [allTags, getTagUsageCount, normalizedTagFilterSearch, selectedTags])

  useEffect(() => {
    if (activeTagCategory === 'all') return
    if (!tagCategoryTabs.some((category) => category.key === activeTagCategory)) {
      setActiveTagCategory('all')
    }
  }, [activeTagCategory, tagCategoryTabs])

  const { inlineTagCategories, overflowTagCategories } = useMemo(() => {
    if (tagCategoryTabs.length <= 1) {
      return {
        inlineTagCategories: tagCategoryTabs,
        overflowTagCategories: [] as typeof tagCategoryTabs,
      }
    }

    if (tagCategoryStripWidth <= 0) {
      const fallbackInline = tagCategoryTabs.slice(0, 3)
      return {
        inlineTagCategories: fallbackInline,
        overflowTagCategories: tagCategoryTabs.slice(fallbackInline.length),
      }
    }

    const minButtonWidth = 68
    const maxButtonWidth = 124
    const moreButtonWidth = 78
    const gapWidth = 6
    const stripSafetyPadding = 4
    let usedWidth = 0
    const inline: typeof tagCategoryTabs = []

    for (let index = 0; index < tagCategoryTabs.length; index += 1) {
      const category = tagCategoryTabs[index]
      const remainingCategories = tagCategoryTabs.length - (index + 1)
      const reserveForMore = remainingCategories > 0 ? moreButtonWidth + gapWidth : 0
      const nextGap = inline.length > 0 ? gapWidth : 0
      const estimatedButtonWidth = Math.max(
        minButtonWidth,
        Math.min(
          maxButtonWidth,
          Math.round(
            category.label.length * 7.2 +
            (category.matching > 999 ? 56 : category.matching > 99 ? 50 : category.matching > 9 ? 44 : 38),
          ),
        ),
      )

      if (
        usedWidth +
        nextGap +
        estimatedButtonWidth +
        reserveForMore >
        tagCategoryStripWidth - stripSafetyPadding
      ) {
        break
      }

      inline.push(category)
      usedWidth += nextGap + estimatedButtonWidth
    }

    if (inline.length === 0) {
      inline.push(tagCategoryTabs[0])
    }

    let overflow = tagCategoryTabs.slice(inline.length)

    if (
      overflow.length > 0 &&
      inline.length > 0 &&
      !inline.some((category) => category.key === activeTagCategory)
    ) {
      const activeOverflowIndex = overflow.findIndex((category) => category.key === activeTagCategory)
      if (activeOverflowIndex >= 0) {
        const replacedCategory = inline[inline.length - 1]
        inline[inline.length - 1] = overflow[activeOverflowIndex]
        overflow = [
          replacedCategory,
          ...overflow.slice(0, activeOverflowIndex),
          ...overflow.slice(activeOverflowIndex + 1),
        ]
      }
    }

    return {
      inlineTagCategories: inline,
      overflowTagCategories: overflow,
    }
  }, [activeTagCategory, tagCategoryStripWidth, tagCategoryTabs])

  useEffect(() => {
    if (activeFilterDockTab !== 'categories') {
      setIsTagCategoryMoreOpen(false)
    }
  }, [activeFilterDockTab])

  useEffect(() => {
    if (!isTagCategoryMoreOpen) return

    const handlePointerDownOutsideMoreMenu = (event: PointerEvent) => {
      const moreMenu = tagCategoryMoreRef.current
      if (!moreMenu) return
      if (moreMenu.contains(event.target as Node)) return
      setIsTagCategoryMoreOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDownOutsideMoreMenu)
    return () => document.removeEventListener('pointerdown', handlePointerDownOutsideMoreMenu)
  }, [isTagCategoryMoreOpen])

  useEffect(() => {
    if (activeFilterDockTab !== 'categories') return
    const stripElement = tagCategoryStripRef.current
    if (!stripElement) return

    const updateWidth = () => setTagCategoryStripWidth(stripElement.clientWidth)
    updateWidth()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateWidth)
      return () => window.removeEventListener('resize', updateWidth)
    }

    const observer = new ResizeObserver(() => {
      updateWidth()
    })
    observer.observe(stripElement)
    return () => observer.disconnect()
  }, [activeFilterDockTab, tagCategoryTabs.length])

  const visibleTagTiles = useMemo(() => {
    const source = allTags.filter((tag) => {
      if (getTagUsageCount(tag) <= 0) {
        return false
      }
      if (normalizedTagFilterSearch && !tag.name.toLowerCase().includes(normalizedTagFilterSearch)) {
        return false
      }
      if (activeTagCategory !== 'all' && normalizeTagCategory(tag.category) !== activeTagCategory) {
        return false
      }
      return true
    })

    return [...source].sort((a, b) => {
      const aSelected = Number(selectedTags.includes(a.id))
      const bSelected = Number(selectedTags.includes(b.id))
      if (aSelected !== bSelected) return bSelected - aSelected
      const aCount = tagCounts.counts[a.id] ?? tagCounts.countsByName[a.name.toLowerCase()] ?? 0
      const bCount = tagCounts.counts[b.id] ?? tagCounts.countsByName[b.name.toLowerCase()] ?? 0
      if (aCount !== bCount) return bCount - aCount
      return a.name.localeCompare(b.name)
    })
  }, [activeTagCategory, allTags, getTagUsageCount, normalizedTagFilterSearch, selectedTags, tagCounts.counts, tagCounts.countsByName])

  const activeFilterCount = useMemo(() => {
    let count = 0
    const isRangeActive = (min: number | undefined, max: number | undefined) =>
      (min ?? 0) > 0 || (max ?? 1) < 1
    count += selectedTags.length
    count += queryRules.filter((rule) => rule.value.trim().length > 0).length
    if (minDuration > 0 || maxDuration < 300) count += 1
    if (minLoudness > -60 || maxLoudness < 0) count += 1
    if (audioFilter.minBpm > 0 || audioFilter.maxBpm < 300) count += 1
    if ((audioFilter.selectedNotes || []).length > 0) count += 1
    if (audioFilter.selectedKeys.length > 0) count += 1
    if (audioFilter.selectedEnvelopeTypes.length > 0) count += 1
    if (
      audioFilter.dateAddedFrom ||
      audioFilter.dateAddedTo ||
      audioFilter.dateCreatedFrom ||
      audioFilter.dateCreatedTo ||
      audioFilter.dateUpdatedFrom ||
      audioFilter.dateUpdatedTo
    ) {
      count += 1
    }
    if (isRangeActive(audioFilter.minBrightness, audioFilter.maxBrightness)) count += 1
    if (isRangeActive(audioFilter.minWarmth, audioFilter.maxWarmth)) count += 1
    if (isRangeActive(audioFilter.minHardness, audioFilter.maxHardness)) count += 1
    if (isRangeActive(audioFilter.minHarmonicity, audioFilter.maxHarmonicity)) count += 1
    if (isRangeActive(audioFilter.minNoisiness, audioFilter.maxNoisiness)) count += 1
    if (isRangeActive(audioFilter.minAttack, audioFilter.maxAttack)) count += 1
    if (isRangeActive(audioFilter.minDynamics, audioFilter.maxDynamics)) count += 1
    if (isRangeActive(audioFilter.minSaturation, audioFilter.maxSaturation)) count += 1
    if (isRangeActive(audioFilter.minSurface, audioFilter.maxSurface)) count += 1
    if (isRangeActive(audioFilter.minDensity, audioFilter.maxDensity)) count += 1
    if (isRangeActive(audioFilter.minAmbience, audioFilter.maxAmbience)) count += 1
    if (isRangeActive(audioFilter.minStereoWidth, audioFilter.maxStereoWidth)) count += 1
    if (isRangeActive(audioFilter.minDepth, audioFilter.maxDepth)) count += 1
    return count
  }, [audioFilter, maxDuration, maxLoudness, minDuration, minLoudness, queryRules, selectedTags.length])

  const dimensionCategoryTabs = useMemo(
    () => [
      { key: 'spectral' as const, label: 'Spectral' },
      { key: 'energy' as const, label: 'Energy' },
      { key: 'texture' as const, label: 'Texture' },
      { key: 'space' as const, label: 'Space' },
    ],
    [],
  )

  const collectionOverview = useMemo<CollectionOverview>(() => {
    const trackIds = new Set<number>()
    const folderIds = new Set<number>()
    const tagIds = new Set<number>()
    const tagCounts = new Map<number, { id: number; name: string; color: string; count: number }>()
    const instrumentCounts = new Map<string, number>()
    const keyCounts = new Map<string, number>()

    let totalDurationSec = 0
    let favoriteSamples = 0
    let modifiedSamples = 0
    let bpmTotal = 0
    let bpmCount = 0

    for (const sample of overviewSamples) {
      trackIds.add(sample.trackId)

      for (const folderId of sample.folderIds ?? []) {
        folderIds.add(folderId)
      }

      for (const tag of sample.tags ?? []) {
        tagIds.add(tag.id)
        const existing = tagCounts.get(tag.id)
        if (existing) {
          existing.count += 1
        } else {
          tagCounts.set(tag.id, {
            id: tag.id,
            name: tag.name,
            color: tag.color || '#64748b',
            count: 1,
          })
        }
      }

      const duration = Math.max(0, sample.endTime - sample.startTime)
      totalDurationSec += duration

      if (sample.favorite) favoriteSamples += 1
      if (sample.sampleModified) modifiedSamples += 1

      if (sample.bpm != null && Number.isFinite(sample.bpm)) {
        bpmTotal += sample.bpm
        bpmCount += 1
      }

      const instrument = sample.instrumentType || sample.instrumentPrimary
      if (instrument) {
        instrumentCounts.set(instrument, (instrumentCounts.get(instrument) || 0) + 1)
      }

      if (sample.keyEstimate) {
        keyCounts.set(sample.keyEstimate, (keyCounts.get(sample.keyEstimate) || 0) + 1)
      }
    }

    const toTopMetrics = (source: Map<string, number>) => {
      return Array.from(source.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
        .slice(0, 6)
    }

    const totalSamples = overviewSamples.length
    const averageDurationSec = totalSamples > 0 ? totalDurationSec / totalSamples : 0

    return {
      scopeLabel,
      totalSamples,
      totalTracks: trackIds.size,
      totalFolders: folderIds.size,
      totalTags: tagIds.size,
      favoriteSamples,
      modifiedSamples,
      totalDurationSec,
      averageDurationSec,
      averageBpm: bpmCount > 0 ? bpmTotal / bpmCount : null,
      topTags: Array.from(tagCounts.values())
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
        .slice(0, 6),
      topInstruments: toTopMetrics(instrumentCounts),
      topKeys: toTopMetrics(keyCounts),
    }
  }, [overviewSamples, scopeLabel])

  useEffect(() => {
    onCollectionOverviewChange?.(collectionOverview)
  }, [collectionOverview, onCollectionOverviewChange])

  useEffect(() => {
    if (
      isTreeSidebarLocked ||
      isTreeSidebarTransitioning ||
      isTreeSidebarOpen === treeSidebarTargetOpen
    ) {
      return
    }

    setIsTreeSidebarOpen(treeSidebarTargetOpen)
    setIsTreeSidebarTransitioning(true)
  }, [
    isTreeSidebarLocked,
    isTreeSidebarOpen,
    isTreeSidebarTransitioning,
    treeSidebarTargetOpen,
  ])

  useEffect(() => {
    if (isTreeSidebarLocked || !isTreeSidebarOpen) return

    const handlePointerDownOutsideSidebar = (event: PointerEvent) => {
      const sidebarElement = overlaySidebarRef.current
      if (!sidebarElement) return
      if (sidebarElement.contains(event.target as Node)) return

      setIsTreeSidebarTransitioning(false)
      setTreeSidebarTargetOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDownOutsideSidebar)
    return () => document.removeEventListener('pointerdown', handlePointerDownOutsideSidebar)
  }, [isTreeSidebarLocked, isTreeSidebarOpen])

  const handleTreeSidebarTransitionEnd = (
    event: React.TransitionEvent<HTMLElement>,
  ) => {
    if (event.target !== event.currentTarget || event.propertyName !== 'transform') {
      return
    }
    setIsTreeSidebarTransitioning(false)
  }

  const isNarrow = panelWidth < 580
  const treeSidebarWidth = treeSidebarPanel.size
  const overlaySidebarOffset =
    !isTreeSidebarLocked && isTreeSidebarOpen ? Math.max(treeSidebarWidth - 14, 0) : 0
  const isYouTubeGroupedScope = currentScope.type === 'youtube' || currentScope.type === 'youtube-video'

  return (
    <div className="relative h-full flex overflow-hidden bg-surface-base">
      {isTreeSidebarLocked ? (
        /* Locked Mode - Sidebar in flex layout */
        <aside
          className={`border-r border-surface-border bg-surface-raised shadow-lg flex-shrink-0 overflow-hidden relative ${
            treeSidebarPanel.isDragging ? '' : 'transition-[width] duration-200 ease-out'
          }`}
          style={{
            width: isTreeSidebarCollapsed ? 14 : treeSidebarWidth,
          }}
        >
          <div className="h-full flex flex-col pr-[14px]" style={{ width: treeSidebarWidth }}>
            <div className="flex-1 overflow-hidden">
              <SourcesTree
                tree={sourceTree}
                folders={allFolders}
                currentScope={currentScope}
                onScopeChange={handleScopeChange}
                onDeleteSource={handleDeleteSource}
                onCreateFolder={handleCreateFolder}
                onRenameFolder={handleRenameFolder}
                onDeleteFolder={handleDeleteFolder}
                onUpdateFolder={handleUpdateFolder}
                onBatchAddToFolder={handleBatchAddToFolder}
                onCreateTagFromFolder={handleCreateTagFromFolder}
                onCreateImportedFolder={handleCreateImportedFolder}
                isLoading={isTreeLoading}
                collections={collections}
                activeCollectionId={activeCollectionId}
                onCollectionChange={setActiveCollectionId}
                onCreateCollection={handleCreateCollection}
                onRenameCollection={handleRenameCollection}
                onDeleteCollection={handleDeleteCollection}
                onMoveCollection={handleMoveCollection}
                onOpenAdvancedCategoryManagement={() => setShowCustomOrder(true)}
                onOpenAddSource={onOpenAddSource}
                onOpenLibraryImport={() => setShowLibraryImportModal(true)}
                showFavoritesOnly={showFavoritesOnly}
                onToggleFavoritesOnly={() => setShowFavoritesOnly((prev) => !prev)}
              />
            </div>
          </div>

          {!isTreeSidebarCollapsed && (
            <div className="absolute inset-y-0 right-[14px] flex">
              <ResizableDivider
                direction="horizontal"
                isDragging={treeSidebarPanel.isDragging}
                isCollapsed={treeSidebarPanel.isCollapsed}
                onMouseDown={treeSidebarPanel.dividerProps.onMouseDown}
                onDoubleClick={treeSidebarPanel.dividerProps.onDoubleClick}
                onExpand={treeSidebarPanel.restore}
              />
            </div>
          )}

          {/* Chevron handle */}
          <button
            type="button"
            onClick={() => setIsTreeSidebarCollapsed(!isTreeSidebarCollapsed)}
            className="absolute inset-y-0 right-0 w-[14px] border-l border-surface-border bg-surface-overlay flex items-center justify-center transition-colors hover:bg-surface-border/80"
            title={isTreeSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={isTreeSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
              <ChevronRight
                size={12}
                className={`text-slate-400 transition-transform duration-300 ${
                  isTreeSidebarCollapsed ? '' : 'rotate-180'
                }`}
              />
          </button>
        </aside>
      ) : (
        /* Unlocked Mode - Overlay panel with persistent edge toggle */
        <aside
          ref={overlaySidebarRef}
          className={`absolute inset-y-0 left-0 z-20 border-r border-surface-border bg-surface-raised shadow-2xl transition-transform duration-300 ease-out ${
            isTreeSidebarOpen ? 'translate-x-0' : '-translate-x-[calc(100%-14px)]'
          }`}
          style={{ width: treeSidebarWidth }}
          onTransitionEnd={handleTreeSidebarTransitionEnd}
        >
          <div className="h-full pr-[14px] overflow-hidden flex flex-col">
            <div className="flex-1 overflow-hidden">
              <SourcesTree
                tree={sourceTree}
                folders={allFolders}
                currentScope={currentScope}
                onScopeChange={handleScopeChange}
                onDeleteSource={handleDeleteSource}
                onCreateFolder={handleCreateFolder}
                onRenameFolder={handleRenameFolder}
                onDeleteFolder={handleDeleteFolder}
                onUpdateFolder={handleUpdateFolder}
                onBatchAddToFolder={handleBatchAddToFolder}
                onCreateTagFromFolder={handleCreateTagFromFolder}
                onCreateImportedFolder={handleCreateImportedFolder}
                isLoading={isTreeLoading}
                collections={collections}
                activeCollectionId={activeCollectionId}
                onCollectionChange={setActiveCollectionId}
                onCreateCollection={handleCreateCollection}
                onRenameCollection={handleRenameCollection}
                onDeleteCollection={handleDeleteCollection}
                onMoveCollection={handleMoveCollection}
                onOpenAdvancedCategoryManagement={() => setShowCustomOrder(true)}
                onOpenAddSource={onOpenAddSource}
                onOpenLibraryImport={() => setShowLibraryImportModal(true)}
                showFavoritesOnly={showFavoritesOnly}
                onToggleFavoritesOnly={() => setShowFavoritesOnly((prev) => !prev)}
              />
            </div>
          </div>

          {isTreeSidebarOpen && (
            <div className="absolute inset-y-0 right-[14px] flex">
              <ResizableDivider
                direction="horizontal"
                isDragging={treeSidebarPanel.isDragging}
                isCollapsed={treeSidebarPanel.isCollapsed}
                onMouseDown={treeSidebarPanel.dividerProps.onMouseDown}
                onDoubleClick={treeSidebarPanel.dividerProps.onDoubleClick}
                onExpand={treeSidebarPanel.restore}
              />
            </div>
          )}

          {/* Persistent toggle handle */}
          <button
            type="button"
            onClick={() => {
              setIsTreeSidebarTransitioning(false)
              setTreeSidebarTargetOpen(!isTreeSidebarOpen)
            }}
            className="absolute inset-y-0 right-0 z-10 w-[14px] border-l border-surface-border bg-surface-overlay flex items-center justify-center transition-colors hover:bg-surface-border/80"
            title={isTreeSidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
            aria-label={isTreeSidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
          >
            <ChevronRight
              size={12}
              className={`text-slate-400 transition-transform duration-300 ${isTreeSidebarOpen ? 'rotate-180' : ''}`}
            />
          </button>
        </aside>
      )}

      {/* Main content area */}
      <div
        ref={mainPanelRef}
        className={`flex-1 min-h-0 flex flex-col overflow-hidden min-w-0 transition-[margin-left] duration-300 ease-out ${!isTreeSidebarLocked ? 'pl-[14px]' : ''}`}
        style={{
          marginLeft: overlaySidebarOffset,
        }}
      >
        {/* Top controls */}
        <div className="sticky top-0 z-20 px-3 py-0 border-b border-surface-border bg-surface-raised flex-shrink-0">
          {/* Row 1: search + controls */}
          <div className="flex flex-wrap items-center gap-2 min-w-0 w-full">
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button
                type="button"
                onClick={handleToggleSelectAll}
                disabled={samples.length === 0}
                className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] font-medium transition-colors ${
                  samples.length === 0
                    ? 'cursor-not-allowed border-surface-border text-text-muted/40'
                    : selectAllChecked
                      ? 'border-accent-primary/50 bg-accent-primary/15 text-accent-primary'
                      : 'border-surface-border bg-surface-base text-text-secondary hover:text-text-primary'
                }`}
                title={selectAllChecked ? 'Clear selection' : 'Select all samples'}
              >
                {selectAllChecked ? (
                  <CheckSquare size={13} className="shrink-0" />
                ) : selectAllIndeterminate ? (
                  <MinusSquare size={13} className="shrink-0" />
                ) : (
                  <Square size={13} className="shrink-0" />
                )}
                <span>{selectAllChecked ? 'Clear all' : 'Select all'}</span>
              </button>
              <SampleSortMenu
                sortBy={audioFilter.sortBy}
                sortOrder={audioFilter.sortOrder}
                onSortByChange={handleSortByChange}
                onSortOrderChange={handleSortOrderChange}
                similarityEnabled={selectedSampleId !== null}
              />
            </div>

            {/* Search input with scope controls */}
            <div className={`min-w-0 ${isNarrow ? 'w-full' : 'flex-1'}`}>
              <div className="relative min-w-0">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={15} />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={`Search ${searchScopeDescriptor} in ${scopeLabel}...`}
                  className="w-full pl-9 pr-44 py-1.5 bg-surface-base border border-surface-border rounded-lg text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-primary/60 transition-colors"
                />
                <SampleSearchScopeMenu
                  searchScope={searchScope}
                  searchScopeHint={searchScopeHint}
                  customSearchFields={customSearchFields}
                  onScopeChange={setSearchScope}
                  onToggleCustomField={toggleCustomSearchField}
                  onResetCustomFields={() => setCustomSearchFields(DEFAULT_SAMPLE_SEARCH_CUSTOM_FIELDS)}
                />
              </div>
            </div>

            {/* Workspace tab switcher */}
            {onWorkspaceTabChange && (
              <div className="flex items-center gap-0.5 bg-surface-base border border-surface-border rounded-lg p-0.5 flex-shrink-0">
                <button
                  onClick={() => onWorkspaceTabChange('details')}
                  className={`inline-flex items-center gap-1 rounded-md border px-2 py-1.5 text-[11px] font-medium uppercase tracking-wider transition-colors ${
                    workspaceTab === 'details'
                      ? 'border-text-secondary/30 bg-text-secondary/10 text-text-primary'
                      : 'border-transparent text-text-muted hover:text-text-secondary'
                  }`}
                  title="Details"
                >
                  <Info size={12} />
                  {!isNarrow && <span>Details</span>}
                </button>
                <button
                  onClick={() => onWorkspaceTabChange('rack')}
                  className={`inline-flex items-center gap-1 rounded-md border px-2 py-1.5 text-[11px] font-medium uppercase tracking-wider transition-colors ${
                    workspaceTab === 'rack'
                      ? 'border-accent-primary/50 bg-accent-primary/15 text-accent-primary'
                      : 'border-transparent text-text-muted hover:text-text-secondary'
                  }`}
                  title="Rack"
                >
                  <Layers3 size={12} />
                  {!isNarrow && <span>Rack</span>}
                </button>
                <button
                  onClick={() => onWorkspaceTabChange('lab')}
                  className={`inline-flex items-center gap-1 rounded-md border px-2 py-1.5 text-[11px] font-medium uppercase tracking-wider transition-colors ${
                    workspaceTab === 'lab'
                      ? 'border-cyan-400/50 bg-cyan-400/10 text-cyan-300'
                      : 'border-transparent text-text-muted hover:text-text-secondary'
                  }`}
                  title="Lab"
                >
                  <FlaskConical size={12} />
                  {!isNarrow && <span>Lab</span>}
                </button>
              </div>
            )}

            {/* View mode toggle */}
            <div className="flex items-center gap-0.5 bg-surface-base border border-surface-border rounded-lg p-0.5 flex-shrink-0">
              <button
                onClick={() => handleViewModeChange('grid')}
                className={`p-1.5 rounded-md transition-colors ${
                  viewMode === 'grid' ? 'bg-surface-overlay text-text-primary' : 'text-text-muted hover:text-text-secondary'
                }`}
                title="Grid view"
              >
                <LayoutGrid size={14} />
              </button>
              <button
                onClick={() => handleViewModeChange('list')}
                className={`p-1.5 rounded-md transition-colors ${
                  viewMode === 'list' ? 'bg-surface-overlay text-text-primary' : 'text-text-muted hover:text-text-secondary'
                }`}
                title="List view"
              >
                <List size={14} />
              </button>
              <button
                onClick={() => handleViewModeChange('space')}
                disabled={isDuplicateModeActive}
                className={`p-1.5 rounded-md transition-colors ${
                  isDuplicateModeActive
                    ? 'text-text-muted/40 cursor-not-allowed'
                    : viewMode === 'space'
                      ? 'bg-surface-overlay text-text-primary'
                      : 'text-text-muted hover:text-text-secondary'
                }`}
                title={isDuplicateModeActive ? 'Space view is disabled in duplicate mode for easier sample selection' : 'Space view'}
              >
                <Sparkles size={14} />
              </button>
            </div>

          </div>

          {isDuplicateModeActive && (
            <div className="mt-3 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-300">
                  Duplicate Filter Mode
                </div>
                <div className="text-xs text-slate-300">
                  Showing {activeDuplicateModeCount} sample{activeDuplicateModeCount === 1 ? '' : 's'} in {scopeLabel}.
                  Smart remove behaves as a live filter in this mode.
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setDuplicateModeFilter('all-duplicates')}
                  className={`px-2 py-1 rounded border text-[11px] font-medium transition-colors ${
                    duplicateModeFilter === 'all-duplicates'
                      ? 'border-accent-primary/60 bg-accent-primary/20 text-accent-primary'
                      : 'border-surface-border bg-surface-base text-slate-300 hover:text-white'
                  }`}
                >
                  All duplicates ({duplicateSamplesInScopeCount})
                </button>
                <button
                  type="button"
                  onClick={() => setDuplicateModeFilter('smart-remove')}
                  className={`px-2 py-1 rounded border text-[11px] font-medium transition-colors ${
                    duplicateModeFilter === 'smart-remove'
                      ? 'border-red-500/50 bg-red-500/15 text-red-200'
                      : 'border-surface-border bg-surface-base text-slate-300 hover:text-white'
                  }`}
                >
                  Smart remove ({smartRemoveSamplesInScopeCount})
                </button>
                <button
                  type="button"
                  onClick={handleExitDuplicateMode}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded border border-surface-border bg-surface-base text-[11px] font-medium text-slate-300 hover:text-white transition-colors"
                >
                  <X size={12} />
                  Exit mode
                </button>
              </div>
            </div>
          )}

        </div>

        {/* Batch actions bar */}
        {selectedSampleIdsInCurrentView.size > 0 && (
          <SourcesBatchActions
            selectedCount={selectedSampleIdsInCurrentView.size}
            selectedIds={selectedSampleIdsInCurrentView}
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
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
            {isYouTubeGroupedScope ? (
              // YouTube grouped view
              viewMode === 'grid' ? (
                <div className="overflow-y-auto h-full">
                  <SourcesYouTubeGroupedGrid
                    samples={samples}
                    selectedId={selectedSampleId}
                    selectedIds={selectedSampleIdsInCurrentView}
                    onSelect={handleSampleSelect}
                    onToggleSelect={handleToggleSelect}
                    onToggleSelectAll={handleToggleSelectAll}
                    onToggleFavorite={handleToggleFavorite}
                    onEditTrack={setEditingTrackId}
                    onTagClick={handleTagClick}
                    isLoading={isSamplesLoading}
                    playMode={playMode}
                    loopEnabled={loopEnabled}
                    tuneTargetNote={tuneTargetNote}
                    tunePlaybackMode={tunePlaybackMode}
                    sourceTree={sourceTree}
                    onDeleteSource={handleDeleteSource}
                  />
                </div>
              ) : viewMode === 'list' ? (
                <SourcesYouTubeGroupedList
                  samples={samples}
                  selectedId={selectedSampleId}
                  selectedIds={selectedSampleIdsInCurrentView}
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
                  tuneTargetNote={tuneTargetNote}
                  tunePlaybackMode={tunePlaybackMode}
                  sourceTree={sourceTree}
                  onDeleteSource={handleDeleteSource}
                />
              ) : (
                <div className="flex-1 min-h-0 relative">
                  <SampleSpaceView
                    externalFilterState={spaceViewFilterState}
                    externalAudioFilter={audioFilter}
                    tuneTargetNote={tuneTargetNote}
                    tunePlaybackMode={tunePlaybackMode}
                    externalSliceIds={spaceViewSliceIds}
                    selectedSliceId={selectedSampleId}
                    onSliceSelect={(id) => {
                      if (id !== null) {
                        handleSampleSelect(id)
                      }
                    }}
                  />
                </div>
              )
            ) : (
              // Standard view for all other scopes
              <div className="h-full min-h-0 flex flex-col">
                {currentScopeDeleteAction && (
                  <div className="px-3 py-2 border-b border-surface-border bg-surface-raised/80 flex items-center justify-end flex-shrink-0">
                    <button
                      onClick={() => handleDeleteSource(currentScopeDeleteAction.scope, currentScopeDeleteAction.label)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                      title={currentScopeDeleteAction.buttonLabel}
                    >
                      <Trash2 size={14} />
                      <span className="text-sm">{currentScopeDeleteAction.buttonLabel}</span>
                    </button>
                  </div>
                )}

                {viewMode === 'grid' ? (
                  <div className="flex-1 overflow-y-auto min-h-0">
                    <SourcesSampleGrid
                      samples={displaySamples}
                      selectedId={selectedSampleId}
                      selectedIds={selectedSampleIdsInCurrentView}
                      onSelect={handleSampleSelect}
                      onToggleSelect={handleToggleSelect}
                      onToggleSelectAll={handleToggleSelectAll}
                      showSelectAllControl={false}
                      showSortControls={false}
                      onToggleFavorite={handleToggleFavorite}
                      onTagClick={handleTagClick}
                      isLoading={isSamplesLoading}
                      playMode={playMode}
                      loopEnabled={loopEnabled}
                      tuneTargetNote={tuneTargetNote}
                      tunePlaybackMode={tunePlaybackMode}
                      scaleDegreeGroups={hasDuplicatePairRender ? null : scaleDegreeGroups}
                      bulkRenamePreviewById={bulkRenamePreview.byId}
                      duplicatePairMetaBySampleId={hasDuplicatePairRender ? duplicatePairMetaBySampleId : undefined}
                      onToggleDuplicateDeleteTarget={
                        hasDuplicatePairRender ? handleToggleDuplicateDeleteTargetBySampleId : undefined
                      }
                    />
                  </div>
                ) : viewMode === 'list' ? (
                  <div className="flex-1 flex flex-col overflow-hidden min-h-0">
                    {similarityMode?.enabled && (
                      <div className="bg-accent-primary/10 border-l-4 border-accent-primary px-4 py-3 flex items-center justify-between flex-shrink-0">
                        <div className="flex items-center gap-3">
                          <Sparkles size={16} className="text-accent-primary" />
                          <div>
                            <div className="text-sm font-medium text-white">
                              Similar to: {similarityMode.referenceSampleName}
                            </div>
                            <div className="text-xs text-slate-400">
                              {displaySamples.length} samples above {Math.round(similarityMode.minSimilarity * 100)}% similarity
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
                        samples={displaySamples}
                        selectedId={selectedSampleId}
                        selectedIds={selectedSampleIdsInCurrentView}
                        onSelect={handleSampleSelect}
                        onToggleSelect={handleToggleSelect}
                        onToggleSelectAll={handleToggleSelectAll}
                        showSelectAllControl={false}
                        onToggleFavorite={handleToggleFavorite}
                        onUpdateName={handleUpdateName}
                        onDelete={handleDeleteSingle}
                        onTagClick={handleTagClick}
                        isLoading={isSamplesLoading}
                        playMode={playMode}
                        loopEnabled={loopEnabled}
                        tuneTargetNote={tuneTargetNote}
                        tunePlaybackMode={tunePlaybackMode}
                        bulkRenamePreviewById={bulkRenamePreview.byId}
                        similarityMode={similarityMode?.enabled ? {
                          enabled: true,
                          referenceSampleId: similarityMode.referenceSampleId,
                          referenceSampleName: similarityMode.referenceSampleName,
                        } : null}
                        duplicatePairMetaBySampleId={hasDuplicatePairRender ? duplicatePairMetaBySampleId : undefined}
                        onToggleDuplicateDeleteTarget={
                          hasDuplicatePairRender ? handleToggleDuplicateDeleteTargetBySampleId : undefined
                        }
                      />
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 min-h-0 relative">
                    <SampleSpaceView
                      externalFilterState={spaceViewFilterState}
                      externalAudioFilter={audioFilter}
                      tuneTargetNote={tuneTargetNote}
                      tunePlaybackMode={tunePlaybackMode}
                      externalSliceIds={spaceViewSliceIds}
                      selectedSliceId={selectedSampleId}
                      onSliceSelect={(id) => {
                        if (id !== null) {
                          handleSampleSelect(id)
                        }
                      }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex-shrink-0 border-t border-surface-border bg-surface-raised/95 backdrop-blur-sm flex flex-col">
            <button
              type="button"
              onClick={() => setIsFilterDockOpen((open) => !open)}
              className="h-[14px] w-full border-b border-surface-border bg-surface-overlay flex items-center justify-center transition-colors hover:bg-surface-border/80"
              title={isFilterDockOpen ? 'Hide filters' : 'Show filters'}
              aria-label={isFilterDockOpen ? 'Hide filters' : 'Show filters'}
            >
              <ChevronRight
                size={12}
                className={`text-slate-400 transition-transform duration-300 ${
                  isFilterDockOpen ? 'rotate-90' : '-rotate-90'
                }`}
              />
            </button>

            <div
              className={`grid overflow-hidden transition-[grid-template-rows,opacity,transform] duration-300 ease-out ${
                isFilterDockOpen
                  ? 'grid-rows-[1fr] opacity-100 translate-y-0'
                  : 'grid-rows-[0fr] opacity-0 translate-y-2 pointer-events-none'
              }`}
            >
              <div className="min-h-0 overflow-hidden">
                <ResizableDivider
                  direction="vertical"
                  isDragging={filterDockPanel.isDragging}
                  isCollapsed={filterDockPanel.isCollapsed}
                  onMouseDown={filterDockPanel.dividerProps.onMouseDown}
                  onDoubleClick={filterDockPanel.dividerProps.onDoubleClick}
                  onExpand={filterDockPanel.restore}
                />
                <div
                  className={filterDockPanel.isDragging ? 'panel-animate dragging overflow-hidden' : 'panel-animate overflow-hidden'}
                  style={{ height: filterDockPanel.size }}
                >
                  <div className="h-full overflow-hidden flex flex-col">
                    {isFilterDockOpen && (
                <>
                  <div className="pl-3 pr-4 py-2 border-b border-surface-border/70 bg-surface-base/80">
                    <div className="flex items-center gap-2">
                      <div className="inline-flex items-center gap-1.5 rounded-sm border border-accent-primary/45 bg-accent-primary/10 px-2 py-1 text-[11px] font-semibold tracking-wide text-slate-200 uppercase">
                        Filters
                        <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-sm bg-surface-base border border-surface-border text-[10px] text-slate-300">
                          {activeFilterCount}
                        </span>
                      </div>

                      <div className="flex-1 min-w-0 overflow-x-auto">
                        <div className="inline-flex items-center gap-0.5 rounded-md border border-surface-border bg-surface-base p-0.5 min-w-max">
                          {[
                            { id: 'categories' as const, label: 'Tags' },
                            { id: 'dimensions' as const, label: 'Dimensions' },
                            { id: 'features' as const, label: 'Features' },
                            { id: 'advanced' as const, label: 'Advanced' },
                            { id: 'bulkActions' as const, label: 'Bulk Actions' },
                            { id: 'duplicates' as const, label: 'Duplicates' },
                          ].map((tab) => (
                            <button
                              key={tab.id}
                              type="button"
                              onClick={() => {
                                setActiveFilterDockTab(tab.id)
                                setIsFilterDockOpen(true)
                              }}
                              className={`px-3 py-1 rounded-sm text-xs font-medium transition-colors ${
                                activeFilterDockTab === tab.id
                                  ? 'bg-accent-primary/20 text-accent-primary'
                                  : 'text-slate-400 hover:text-white'
                              }`}
                            >
                              {tab.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {activeFilterDockTab === 'categories' && (
                    <div className="pl-2 pr-3 py-1 border-b border-surface-border/70 bg-surface-base/80 space-y-2 rounded-e">
                      <div className="flex items-center gap-2">
                        <div className="relative w-52 shrink-0">
                          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
                          <input
                            type="text"
                            value={tagFilterSearchQuery}
                            onChange={(e) => setTagFilterSearchQuery(e.target.value)}
                            placeholder="Search tags..."
                            className="w-full pl-8 pr-2 py-1.5 text-sm bg-surface-base border border-surface-border rounded-sm text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-accent-primary/60"
                          />
                        </div>

                        <div ref={tagCategoryStripRef} className="relative flex-1 min-w-0">
                          <div className="flex items-center justify-start gap-1.5 overflow-hidden">
                            {inlineTagCategories.map((category) => {
                              const isActive = activeTagCategory === category.key
                              const hasMatches = category.matching > 0
                              return (
                                <button
                                  key={category.key}
                                  type="button"
                                  onClick={() => {
                                    setActiveTagCategory(category.key)
                                    setIsTagCategoryMoreOpen(false)
                                  }}
                                  className={`inline-flex max-w-[134px] items-center gap-1 rounded-sm border px-2 py-1 text-[11px] transition-colors ${
                                    isActive
                                      ? 'border-accent-primary/45 bg-accent-primary/20 text-accent-primary'
                                      : hasMatches
                                        ? 'border-surface-border text-slate-300 hover:text-white hover:border-slate-400/40'
                                        : 'border-surface-border/60 text-slate-500 hover:text-slate-400'
                                  }`}
                                >
                                  <span className="truncate uppercase tracking-wide">{category.label}</span>
                                  <span className="text-[10px] text-slate-500">{category.matching}</span>
                                </button>
                              )
                            })}

                            {overflowTagCategories.length > 0 && (
                              <div ref={tagCategoryMoreRef} className="relative shrink-0">
                                <button
                                  type="button"
                                  onClick={() => setIsTagCategoryMoreOpen((open) => !open)}
                                  className={`inline-flex items-center gap-1 rounded-sm border px-2 py-1 text-[11px] transition-colors ${
                                    isTagCategoryMoreOpen || overflowTagCategories.some((category) => category.key === activeTagCategory)
                                      ? 'border-accent-primary/45 bg-accent-primary/20 text-accent-primary'
                                      : 'border-surface-border text-slate-300 hover:text-white hover:border-slate-400/40'
                                  }`}
                                >
                                  <span className="uppercase tracking-wide">More</span>
                                  <ChevronDown size={12} className={isTagCategoryMoreOpen ? 'rotate-180 transition-transform' : 'transition-transform'} />
                                </button>

                                {isTagCategoryMoreOpen && (
                                  <div className="absolute right-0 bottom-full mb-1.5 w-52 rounded-sm border border-surface-border bg-surface-base shadow-xl z-20 p-1 max-h-56 overflow-y-auto origin-bottom-right">
                                    {overflowTagCategories.map((category) => {
                                      const isActive = activeTagCategory === category.key
                                      const hasMatches = category.matching > 0
                                      return (
                                        <button
                                          key={category.key}
                                          type="button"
                                          onClick={() => {
                                            setActiveTagCategory(category.key)
                                            setIsTagCategoryMoreOpen(false)
                                          }}
                                          className={`w-full text-left px-2 py-1.5 rounded-sm text-xs transition-colors ${
                                            isActive
                                              ? 'bg-accent-primary/20 text-accent-primary border border-accent-primary/35'
                                              : hasMatches
                                                ? 'text-slate-300 hover:text-white hover:bg-surface-overlay border border-transparent'
                                                : 'text-slate-500 hover:text-slate-400 border border-transparent'
                                          }`}
                                        >
                                          <span className="flex items-center justify-between gap-2">
                                            <span className="truncate uppercase tracking-wide">{category.label}</span>
                                            <span className="text-[10px] text-slate-500">{category.matching}</span>
                                          </span>
                                        </button>
                                      )
                                    })}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-end gap-2 text-xs text-slate-400">
                        {selectedTags.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setSelectedTags([])}
                            className="text-slate-300 hover:text-white transition-colors"
                          >
                            Clear selected
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  <div
                    className={`flex-1 min-h-0 ${
                      activeFilterDockTab === 'bulkActions'
                        ? 'overflow-hidden'
                        : activeFilterDockTab === 'categories'
                          ? 'overflow-hidden pl-1 pr-2 py-1'
                          : 'overflow-y-auto px-1 py-1'
                    }`}
                  >
                    {activeFilterDockTab === 'categories' && (
                      <div className="space-y-2 h-full min-h-0 flex flex-col">
                        <div className="border-surface-border bg-surface-base min-h-0 overflow-y-auto flex-1">
                          <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))]">
                            {visibleTagTiles.map((tag) => {
                              const isSelected = selectedTags.includes(tag.id)
                              const usageCount =
                                tagCounts.counts[tag.id] ??
                                tagCounts.countsByName[tag.name.toLowerCase()] ??
                                0
                              return (
                                <button
                                  key={tag.id}
                                  type="button"
                                  onClick={() => {
                                    setSelectedTags((prev) =>
                                      prev.includes(tag.id)
                                        ? prev.filter((id) => id !== tag.id)
                                        : [...prev, tag.id],
                                    )
                                  }}
                                  className={`relative h-10 border pl-3 pr-2 text-center transition-colors overflow-hidden ${
                                    isSelected
                                      ? 'border-accent-primary/60 bg-accent-primary/15'
                                      : 'border-surface-border bg-surface-base hover:bg-surface-overlay'
                                  }`}
                                >
                                  <span
                                    className="absolute left-0 top-0 h-full w-1"
                                    style={{ backgroundColor: tag.color }}
                                    aria-hidden="true"
                                  />
                                  <span className="block truncate text-sm font-medium text-white leading-10">
                                    {tag.name.toUpperCase()}
                                  </span>
                                  <span className="absolute right-0.5 bottom-0.5 z-10 inline-flex items-center rounded-sm bg-surface-base/85 px-1 text-[10px] leading-none text-slate-400 pointer-events-none">
                                    {usageCount}
                                  </span>
                                </button>
                              )
                            })}
                          </div>
                        </div>

                        {visibleTagTiles.length === 0 && (
                          <div className="rounded-md border border-surface-border bg-surface-base px-3 py-4 text-sm text-slate-500">
                            No tags match this search.
                          </div>
                        )}
                      </div>
                    )}

                    {activeFilterDockTab === 'features' && (
                      <div className="rounded-lg border border-surface-border bg-surface-base p-3">
                        <div className="space-y-1.5">
                          <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
                            <div className="space-y-1.5">
                              <div className="text-[11px] text-slate-400 uppercase tracking-wide">Duration (seconds)</div>
                              <div className="flex flex-wrap items-center gap-1.5">
                                <input
                                  type="number"
                                  value={minDuration.toFixed(1)}
                                  onChange={(e) => {
                                    const val = parseFloat(e.target.value) || 0
                                    setMinDuration(Math.max(0, Math.min(val, maxDuration)))
                                  }}
                                  className="w-20 px-2 py-0.5 text-xs bg-surface-raised border border-surface-border rounded text-white focus:outline-none focus:border-accent-primary no-spinner"
                                  min="0"
                                  max={maxDuration}
                                  step="0.1"
                                />
                                <span className="text-xs text-slate-500">to</span>
                                <input
                                  type="number"
                                  value={maxDuration.toFixed(1)}
                                  onChange={(e) => {
                                    const val = parseFloat(e.target.value) || 0
                                    setMaxDuration(Math.max(minDuration, Math.min(val, 600)))
                                  }}
                                  className="w-20 px-2 py-0.5 text-xs bg-surface-raised border border-surface-border rounded text-white focus:outline-none focus:border-accent-primary no-spinner"
                                  min={minDuration}
                                  max="600"
                                  step="0.1"
                                />
                                {(minDuration > 0 || maxDuration < 300) && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setMinDuration(0)
                                      setMaxDuration(300)
                                    }}
                                    className="text-xs text-slate-400 hover:text-white transition-colors"
                                  >
                                    Reset
                                  </button>
                                )}
                              </div>
                            </div>

                            <div className="space-y-1.5">
                              <div className="text-[11px] text-slate-400 uppercase tracking-wide">Loudness (dB)</div>
                              <div className="flex flex-wrap items-center gap-1.5">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <input
                                    type="number"
                                    value={minLoudness.toFixed(1)}
                                    onChange={(e) => {
                                      const val = parseFloat(e.target.value)
                                      if (Number.isNaN(val)) return
                                      setMinLoudness(Math.max(-80, Math.min(val, maxLoudness)))
                                    }}
                                    className="w-20 px-2 py-0.5 text-xs bg-surface-raised border border-surface-border rounded text-white focus:outline-none focus:border-accent-primary no-spinner"
                                    min="-80"
                                    max={maxLoudness}
                                    step="0.1"
                                  />
                                  <span className="text-xs text-slate-500">to</span>
                                  <input
                                    type="number"
                                    value={maxLoudness.toFixed(1)}
                                    onChange={(e) => {
                                      const val = parseFloat(e.target.value)
                                      if (Number.isNaN(val)) return
                                      setMaxLoudness(Math.min(6, Math.max(val, minLoudness)))
                                    }}
                                    className="w-20 px-2 py-0.5 text-xs bg-surface-raised border border-surface-border rounded text-white focus:outline-none focus:border-accent-primary no-spinner"
                                    min={minLoudness}
                                    max="6"
                                    step="0.1"
                                  />
                                  {(minLoudness > -60 || maxLoudness < 0) && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setMinLoudness(-60)
                                        setMaxLoudness(0)
                                      }}
                                      className="text-xs text-slate-400 hover:text-white transition-colors"
                                    >
                                      Reset
                                    </button>
                                  )}
                                </div>
                                <div className="flex flex-wrap gap-1 md:ml-auto">
                                  {LOUDNESS_PRESETS.map((preset) => {
                                    const isActive =
                                      Math.abs(minLoudness - preset.min) < 0.05 &&
                                      Math.abs(maxLoudness - preset.max) < 0.05
                                    return (
                                      <button
                                        key={preset.id}
                                        type="button"
                                        onClick={() => {
                                          setMinLoudness(preset.min)
                                          setMaxLoudness(preset.max)
                                        }}
                                        className={`px-2 py-0.5 rounded text-[11px] transition-colors ${
                                          isActive
                                            ? 'bg-accent-primary/20 text-accent-primary border border-accent-primary/45'
                                            : 'bg-surface-raised text-slate-300 border border-surface-border hover:text-white'
                                        }`}
                                      >
                                        {preset.label}
                                      </button>
                                    )
                                  })}
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="h-px bg-surface-border/70 my-0.5" />

                          <SourcesAudioFilter
                            mode="musical"
                            showBpmControl
                            showEnvelopeControl
                            showPitchControl
                            showDatesControl
                            filterState={audioFilter}
                            onChange={setAudioFilter}
                            availableKeys={[...new Set(samples.map(s => s.keyEstimate).filter(Boolean) as string[])]}
                            availableEnvelopeTypes={[...new Set(samples.map(s => s.envelopeType).filter(Boolean) as string[])]}
                            showSortControls={false}
                          />
                        </div>
                      </div>
                    )}

                    {activeFilterDockTab === 'dimensions' && (
                      <div className="rounded-lg border border-surface-border bg-surface-base p-3 space-y-3">
                        <div className="inline-flex items-center gap-1 rounded-sm border border-surface-border bg-surface-raised p-0.5">
                          {dimensionCategoryTabs.map((tab) => (
                            <button
                              key={tab.key}
                              type="button"
                              onClick={() => setActiveDimensionCategory(tab.key)}
                              className={`inline-flex items-center gap-1 px-2 py-1 rounded-sm text-[11px] transition-colors ${
                                activeDimensionCategory === tab.key
                                  ? 'border border-accent-primary/45 bg-accent-primary/20 text-accent-primary'
                                  : 'border border-transparent text-slate-300 hover:text-white'
                              }`}
                            >
                              <span className="uppercase tracking-wide">{tab.label}</span>
                            </button>
                          ))}
                        </div>
                        <SourcesDimensionFilter
                          category={activeDimensionCategory}
                          filterState={audioFilter}
                          onChange={setAudioFilter}
                        />
                      </div>
                    )}

                    {activeFilterDockTab === 'advanced' && (
                      <div className="rounded-lg border border-surface-border bg-surface-base p-3 space-y-2">
                        <div className="text-xs text-slate-400">
                          Build exact metadata query rules for fields like BPM, key, artist, or path.
                        </div>
                        <SourcesRuleFilterBuilder
                          rules={queryRules}
                          onChange={setQueryRules}
                          suggestions={ruleSuggestions}
                        />
                      </div>
                    )}

                    {activeFilterDockTab === 'bulkActions' && (
                      <BulkRenamePanel
                        samples={samples}
                        isSamplesLoading={isSamplesLoading}
                        rules={bulkRenameRules}
                        onRulesChange={onBulkRenameRulesChange}
                      />
                    )}

                    {activeFilterDockTab === 'duplicates' && (
                      <div className="bg-surface-base border border-surface-border rounded-xl overflow-hidden">
                        <div
                          className={advancedFilterPanel.isDragging ? 'panel-animate dragging overflow-hidden' : 'panel-animate overflow-hidden'}
                          style={{ height: advancedFilterPanel.size }}
                        >
                          <div className="h-full overflow-y-auto p-3 pr-2 space-y-3">
                            {/* Duplicates */}
                            <div className="space-y-3">
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                  <div className="text-xs uppercase tracking-wide text-slate-500">Duplicates</div>
                                  <p className="text-xs text-slate-400 mt-1">
                                    Scan your library, review duplicate pairs, and remove duplicates with smart rules.
                                  </p>
                                </div>

                                <div className="flex items-center gap-2">
                                  {duplicateData && duplicateData.total > 0 && !isDuplicateModeActive && (
                                    <button
                                      type="button"
                                      onClick={enterDuplicateMode}
                                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-accent-primary/45 bg-accent-primary/15 text-accent-primary hover:bg-accent-primary/25 transition-colors"
                                    >
                                      Show duplicates only
                                    </button>
                                  )}

                                  {isDuplicateModeActive && (
                                    <button
                                      type="button"
                                      onClick={handleExitDuplicateMode}
                                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-surface-border bg-surface-base text-slate-300 hover:text-white transition-colors"
                                    >
                                      <X size={13} />
                                      Exit mode
                                    </button>
                                  )}

                                  <button
                                    onClick={handleFindDuplicates}
                                    disabled={isDuplicateScanRunning}
                                    className={`inline-flex items-center gap-2 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                                      isDuplicateScanRunning
                                        ? 'bg-surface-overlay text-slate-500 cursor-not-allowed'
                                        : 'bg-accent-primary hover:bg-accent-primary/90 text-white'
                                    }`}
                                  >
                                    {isDuplicateScanRunning ? <RefreshCw size={13} className="animate-spin" /> : <Copy size={13} />}
                                    {isDuplicateScanRunning ? 'Scanning...' : duplicateData ? 'Refresh duplicates' : 'Find duplicates'}
                                  </button>
                                </div>
                              </div>

                              {isDuplicateScanRunning && (
                                <div className="rounded border border-accent-primary/40 bg-accent-primary/10 px-3 py-2 text-xs text-slate-300">
                                  Scanning fingerprints and file identities...
                                </div>
                              )}

                              {duplicateData && duplicateData.total === 0 && !isDuplicateScanRunning && (
                                <div className="rounded border border-surface-border bg-surface-raised px-3 py-2 text-xs text-slate-300 flex items-center gap-2">
                                  <CheckCircle2 size={14} className="text-green-400 flex-shrink-0" />
                                  No duplicate groups found.
                                </div>
                              )}

                              {duplicateData && duplicateData.total > 0 && (
                                <div className="space-y-3">
                                  <div className="rounded border border-surface-border bg-surface-raised px-3 py-2 text-xs text-slate-300">
                                    Found <span className="text-white font-medium">{duplicateData.total}</span> duplicate group{duplicateData.total !== 1 ? 's' : ''} and{' '}
                                    <span className="text-white font-medium">{duplicatePairDecisions.length}</span> pair{duplicatePairDecisions.length !== 1 ? 's' : ''}.
                                  </div>

                                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
                                    <label className="text-xs text-slate-400">
                                      Match type
                                      <select
                                        value={duplicateMatchFilter}
                                        onChange={(e) => setDuplicateMatchFilter(e.target.value as DuplicateMatchFilter)}
                                        className="mt-1 w-full px-2 py-1.5 bg-surface-raised border border-surface-border rounded text-xs text-white focus:outline-none focus:border-accent-primary"
                                      >
                                        <option value="all">All</option>
                                        <option value="exact">Exact fingerprint</option>
                                        <option value="content">Exact file content</option>
                                        <option value="file">File identity</option>
                                      </select>
                                    </label>

                                    <label className="text-xs text-slate-400">
                                      Keep strategy
                                      <select
                                        value={duplicateKeepStrategy}
                                        onChange={(e) => setDuplicateKeepStrategy(e.target.value as DuplicateKeepStrategy)}
                                        className="mt-1 w-full px-2 py-1.5 bg-surface-raised border border-surface-border rounded text-xs text-white focus:outline-none focus:border-accent-primary"
                                      >
                                        <option value="oldest">Keep oldest import</option>
                                        <option value="newest">Keep newest import</option>
                                        <option value="prefer-lossless">Prefer lossless format</option>
                                        <option value="highest-quality">Keep highest quality</option>
                                      </select>
                                    </label>

                                    <label className="text-xs text-slate-400">
                                      Scope
                                      <select
                                        value={duplicateScopeFilter}
                                        onChange={(e) => setDuplicateScopeFilter(e.target.value as DuplicateScopeFilter)}
                                        className="mt-1 w-full px-2 py-1.5 bg-surface-raised border border-surface-border rounded text-xs text-white focus:outline-none focus:border-accent-primary"
                                      >
                                        <option value="all">All sources</option>
                                        <option value="current">Current source/folder only</option>
                                      </select>
                                    </label>

                                    <label className="text-xs text-slate-400">
                                      Delete format
                                      <select
                                        value={duplicateFormatFilter}
                                        onChange={(e) => setDuplicateFormatFilter(e.target.value)}
                                        className="mt-1 w-full px-2 py-1.5 bg-surface-raised border border-surface-border rounded text-xs text-white focus:outline-none focus:border-accent-primary"
                                      >
                                        <option value="all">All formats</option>
                                        {duplicateFormats.map((format) => (
                                          <option key={format} value={format}>
                                            {getDuplicateFormatLabel(format)}
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                  </div>

                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                    <label className="flex items-center gap-2 rounded border border-surface-border bg-surface-raised px-2 py-1.5 text-xs text-slate-300 cursor-pointer">
                                      <input
                                        type="checkbox"
                                        checked={duplicateProtectFavorites}
                                        onChange={(e) => setDuplicateProtectFavorites(e.target.checked)}
                                        className="accent-accent-primary"
                                      />
                                      Protect favorites from delete
                                    </label>
                                    <label className="flex items-center gap-2 rounded border border-surface-border bg-surface-raised px-2 py-1.5 text-xs text-slate-300 cursor-pointer">
                                      <input
                                        type="checkbox"
                                        checked={duplicatePreferAssigned}
                                        onChange={(e) => setDuplicatePreferAssigned(e.target.checked)}
                                        className="accent-accent-primary"
                                      />
                                      Keep tagged/folder-assigned first
                                    </label>
                                  </div>

                                  <div className="flex items-center justify-between gap-2 rounded border border-red-500/25 bg-red-500/5 px-3 py-2">
                                    <div className="text-xs text-slate-300 space-y-0.5">
                                      <div>
                                        {duplicateIdsToDelete.length} sample{duplicateIdsToDelete.length !== 1 ? 's' : ''} in{' '}
                                        {duplicatePairsMarkedForDeletionCount} pair{duplicatePairsMarkedForDeletionCount !== 1 ? 's' : ''} marked for deletion.
                                      </div>
                                      <div className="text-[11px] text-slate-400">
                                        Pair view: <span className="text-slate-200">{viewMode === 'list' ? 'List' : 'Card'}</span>
                                        {viewMode === 'space' && ' (space mode uses card pair layout)'}
                                      </div>
                                      {duplicateManualChoiceCount > 0 && (
                                        <div className="text-[11px] text-cyan-300">
                                          {duplicateManualChoiceCount} pair choice{duplicateManualChoiceCount !== 1 ? 's' : ''} manually overridden.
                                        </div>
                                      )}
                                      {duplicateProtectFavorites && duplicateProtectedFavoriteCount > 0 && (
                                        <div className="text-[11px] text-amber-300">
                                          {duplicateProtectedFavoriteCount} favorite sample{duplicateProtectedFavoriteCount !== 1 ? 's' : ''} protected.
                                        </div>
                                      )}
                                    </div>
                                    <button
                                      onClick={handleDeleteDuplicates}
                                      disabled={duplicateIdsToDelete.length === 0 || batchDeleteSlices.isPending}
                                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                                        duplicateIdsToDelete.length === 0 || batchDeleteSlices.isPending
                                          ? 'bg-surface-overlay text-slate-500 cursor-not-allowed'
                                          : 'bg-red-600/85 hover:bg-red-600 text-white'
                                      }`}
                                    >
                                      <Trash2 size={13} />
                                      {batchDeleteSlices.isPending ? 'Deleting...' : 'Delete duplicates'}
                                    </button>
                                  </div>

                                  {duplicatePairDecisions.length > 0 ? (
                                    <div className="rounded border border-surface-border bg-surface-raised px-3 py-2 text-xs text-slate-300 space-y-1">
                                      <div>
                                        Pair controls are now rendered directly in the main{' '}
                                        <span className="text-slate-200">{viewMode === 'list' ? 'list' : 'card'}</span> view.
                                      </div>
                                      <div className="text-[11px] text-slate-500">
                                        Scroll to load/unload entries and use each pair row/card action to choose what gets deleted.
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="rounded border border-surface-border bg-surface-raised px-3 py-2 text-xs text-slate-400">
                                      No duplicate pairs match the current smart filters.
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                        <ResizableDivider
                          direction="vertical"
                          isDragging={advancedFilterPanel.isDragging}
                          isCollapsed={advancedFilterPanel.isCollapsed}
                          onMouseDown={advancedFilterPanel.dividerProps.onMouseDown}
                          onDoubleClick={advancedFilterPanel.dividerProps.onDoubleClick}
                          onExpand={advancedFilterPanel.restore}
                        />
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

                </div>
              </div>
            </div>

          </div>
        </div>
      </div>

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

      {showLibraryImportModal && (
        <LibraryImportModal
          isSubmitting={isImportingLibrary}
          onClose={() => {
            if (isImportingLibrary) return
            setShowLibraryImportModal(false)
          }}
          onSubmit={handleImportLibrary}
        />
      )}

      {dialogNode}
    </div>
  )
}
