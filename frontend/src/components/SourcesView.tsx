import { useState, useMemo, useRef, useEffect, type Dispatch, type KeyboardEvent, type SetStateAction } from 'react'
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
  Layers3,
  FlaskConical,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import { SourcesTree } from './SourcesTree'
import { SourcesRuleFilterBuilder } from './SourcesRuleFilterBuilder'
import { SourcesSampleGrid } from './SourcesSampleGrid'
import { SourcesSampleList } from './SourcesSampleList'
import { SourcesYouTubeGroupedGrid } from './SourcesYouTubeGroupedGrid'
import { SourcesYouTubeGroupedList } from './SourcesYouTubeGroupedList'
import { SourcesBatchActions } from './SourcesBatchActions'
import { SampleBulkEditModal, type SampleBulkEditRequest } from './SampleBulkEditModal'
import { EditingModal } from './EditingModal'
import { SampleSpaceView } from './SampleSpaceView'
import { CustomOrderModal } from './CustomOrderModal'
import { BulkRenamePanel } from './BulkRenamePanel'
import { CustomCheckbox } from './CustomCheckbox'
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
import type { SourceScope, SliceWithTrackExtended, Tag } from '../types'
import {
  downloadBatchSlicesZip,
  deleteTag as deleteTagRequest,
  getDuplicateSlices,
  importLibrary,
  mergeTags as mergeTagsRequest,
  updateTag as updateTagRequest,
  updateSlice as updateSliceRequest,
  addTagToSlice as addTagToSliceRequest,
  removeTagFromSlice as removeTagFromSliceRequest,
} from '../api/client'
import type { DuplicateGroup, LibraryImportOptions, UpdateSlicePayload } from '../api/client'
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
  getFilterRuleField,
  getFilterRuleOperators,
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
  hydratePersistedSettingFromElectron,
  readPersistedSetting,
  writePersistedSetting,
} from '../utils/persistentSettings'
import { isElectron } from '../utils/platform'
import {
  applyBulkRenameRules,
  DEFAULT_BULK_RENAME_RULES,
  getBulkRenameReplacementHighlightRanges,
  matchesBulkRenameSearchText,
  type BulkRenameHighlightRange,
  type BulkRenameRules,
} from '../utils/bulkRename'
import { matchesStereoChannelMode as matchesStereoChannelModeFilter } from '../utils/stereoChannelMode'
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
  canDeletePartner: boolean
  matchType: DuplicateGroup['matchType']
  similarityPercent: number
}

interface BulkRenamePreviewEntry {
  nextName: string
  hasChange: boolean
  highlightRanges: BulkRenameHighlightRange[]
}

interface ActiveFilterListItem {
  id: string
  label: string
  tab: FilterDockTab
  onRemove: () => void
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
const SOURCES_VIEW_PREFERENCES_STORAGE_KEY = 'sources-view-preferences-v1'
const ELECTRON_REFERENCE_DELETE_WARNING_DISMISSED_KEY = 'sources.electron.reference-delete-warning.dismissed'
const SEARCH_SCOPES = new Set<SampleSearchScope>([
  'all',
  'name',
  'tags',
  'custom',
  'artists',
  'collections',
])
const VIEW_MODES = new Set<'grid' | 'list' | 'space'>(['grid', 'list', 'space'])
const CUSTOM_SEARCH_FIELDS = new Set<SampleSearchCustomField>([
  'sample_name',
  'track_title',
  'tags',
  'artist',
  'album',
  'album_artist',
  'genre',
  'composer',
  'collection',
  'path',
])

interface SourcesViewPreferences {
  viewMode: 'grid' | 'list' | 'space'
  searchScope: SampleSearchScope
  customSearchFields: SampleSearchCustomField[]
}

function normalizeCustomSearchFields(
  fields: unknown,
): SampleSearchCustomField[] {
  if (!Array.isArray(fields)) return DEFAULT_SAMPLE_SEARCH_CUSTOM_FIELDS
  const next: SampleSearchCustomField[] = []
  for (const field of fields) {
    if (typeof field !== 'string') continue
    if (!CUSTOM_SEARCH_FIELDS.has(field as SampleSearchCustomField)) continue
    if (next.includes(field as SampleSearchCustomField)) continue
    next.push(field as SampleSearchCustomField)
  }
  return next
}

function parseSourcesViewPreferences(raw: string | null): SourcesViewPreferences | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as {
      viewMode?: unknown
      searchScope?: unknown
      customSearchFields?: unknown
    }
    return {
      viewMode: VIEW_MODES.has(parsed.viewMode as 'grid' | 'list' | 'space')
        ? (parsed.viewMode as 'grid' | 'list' | 'space')
        : 'grid',
      searchScope: SEARCH_SCOPES.has(parsed.searchScope as SampleSearchScope)
        ? (parsed.searchScope as SampleSearchScope)
        : 'all',
      customSearchFields: normalizeCustomSearchFields(parsed.customSearchFields),
    }
  } catch {
    return null
  }
}

function loadSourcesViewPreferences(): SourcesViewPreferences {
  return (
    parseSourcesViewPreferences(readPersistedSetting(SOURCES_VIEW_PREFERENCES_STORAGE_KEY)) ?? {
      viewMode: 'grid',
      searchScope: 'all',
      customSearchFields: DEFAULT_SAMPLE_SEARCH_CUSTOM_FIELDS,
    }
  )
}

function parseBooleanPersistedSetting(value: string | null): boolean {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

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

function handleCheckboxTileKeyDown(event: KeyboardEvent<HTMLDivElement>, onToggle: () => void) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    onToggle()
  }
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

function normalizeTagName(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase()
}

function isOneShotName(value: string | null | undefined): boolean {
  const normalized = normalizeTagName(value)
  return normalized === 'oneshot' || normalized === 'one-shot' || normalized === 'one shot'
}

function isLoopName(value: string | null | undefined): boolean {
  const normalized = normalizeTagName(value)
  return normalized === 'loop' || normalized === 'loops'
}

function isSampleTypeTag(tag: Pick<Tag, 'name' | 'category'>): boolean {
  return normalizeTagCategory(tag.category) === 'sample-type' || isOneShotName(tag.name) || isLoopName(tag.name)
}

function matchesOneShotType(sample: SliceWithTrackExtended): boolean {
  if (isOneShotName(sample.sampleType)) {
    return true
  }

  return (sample.tags || []).some((tag) => isOneShotName(tag.name))
}

function matchesLoopType(sample: SliceWithTrackExtended): boolean {
  if (isLoopName(sample.sampleType)) {
    return true
  }

  return (sample.tags || []).some((tag) => isLoopName(tag.name))
}

function normalizeTagCategory(category: string | null | undefined): string {
  const normalized = (category || 'instrument').trim().toLowerCase()
  if (
    normalized === 'sample-type' ||
    normalized === 'sample type' ||
    normalized === 'sample_type' ||
    normalized === 'type'
  ) {
    return 'sample-type'
  }
  if (normalized === 'instrument' || normalized === 'filename') return normalized
  return 'instrument'
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
  onWorkspaceTabChange?: (tab: WorkspaceTab) => void
  onWorkspaceStateChange?: (state: WorkspaceState | null) => void
  onCollectionOverviewChange?: (overview: CollectionOverview) => void
  onVisibleSamplesChange?: (samples: SliceWithTrackExtended[]) => void
  onSelectedSamplesChange?: (samples: SliceWithTrackExtended[]) => void
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
  onWorkspaceTabChange,
  onWorkspaceStateChange,
  onCollectionOverviewChange,
  onVisibleSamplesChange,
  onSelectedSamplesChange,
  onSamplesLoadingChange,
}: SourcesViewProps) {
  const [initialSourcesViewPreferences] = useState<SourcesViewPreferences>(() => loadSourcesViewPreferences())

  // State
  const [currentScope, setCurrentScope] = useState<SourceScope>({ type: 'all' })
  const [selectedTags, setSelectedTags] = useState<number[]>([])
  const [sampleTypeFilter, setSampleTypeFilter] = useState<'one-shot' | 'loop' | null>(null)
  const [selectedFolderIds, setSelectedFolderIds] = useState<number[]>([])
  const [excludedTags] = useState<number[]>([])
  const [excludedFolderIds, setExcludedFolderIds] = useState<number[]>([])
  const [queryRules, setQueryRules] = useState<FilterRule[]>([])
  const [activeFilterDockTab, setActiveFilterDockTab] = useState<FilterDockTab>('categories')
  const [isFilterDockOpen, setIsFilterDockOpen] = useState(true)
  const [isEnabledFiltersListOpen, setIsEnabledFiltersListOpen] = useState(false)
  const [activeDimensionCategory, setActiveDimensionCategory] = useState<DimensionCategory>('spectral')
  const [tagFilterSearchQuery, setTagFilterSearchQuery] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchScope, setSearchScope] = useState<SampleSearchScope>(initialSourcesViewPreferences.searchScope)
  const [customSearchFields, setCustomSearchFields] = useState<SampleSearchCustomField[]>(
    initialSourcesViewPreferences.customSearchFields,
  )
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false)
  const [selectedSampleId, setSelectedSampleId] = useState<number | null>(null)
  const isBulkRenameMode = bulkRenameMode
  const previousSelectedSampleBeforeBulkRenameRef = useRef<number | null>(null)
  const wasBulkRenameModeRef = useRef(isBulkRenameMode)
  const [viewMode, setViewMode] = useState<'grid' | 'list' | 'space'>(initialSourcesViewPreferences.viewMode)
  const [isSourcesViewPreferencesReady, setIsSourcesViewPreferencesReady] = useState(
    () => typeof window === 'undefined' || !window.electron?.getSetting
  )
  const [isElectronReferenceDeleteWarningDismissed, setIsElectronReferenceDeleteWarningDismissed] = useState(() =>
    parseBooleanPersistedSetting(readPersistedSetting(ELECTRON_REFERENCE_DELETE_WARNING_DISMISSED_KEY))
  )
  const [selectedSampleIds, setSelectedSampleIds] = useState<Set<number>>(new Set())
  const [showBulkEditModal, setShowBulkEditModal] = useState(false)
  const [isBulkEditSubmitting, setIsBulkEditSubmitting] = useState(false)
  const [editingTrackId, setEditingTrackId] = useState<number | null>(null)
  const [showCustomOrder, setShowCustomOrder] = useState(false)
  const [showLibraryImportModal, setShowLibraryImportModal] = useState(false)
  const [isImportingLibrary, setIsImportingLibrary] = useState(false)
  const [isTreeSidebarOpen, setIsTreeSidebarOpen] = useState(() => getViewportWidth() >= 1024)
  const [treeSidebarTargetOpen, setTreeSidebarTargetOpen] = useState(() => getViewportWidth() >= 1024)
  const [isTreeSidebarTransitioning, setIsTreeSidebarTransitioning] = useState(false)
  const [isTreeSidebarLocked] = useState(() => getViewportWidth() >= 1024)
  const [isTreeSidebarCollapsed, setIsTreeSidebarCollapsed] = useState(false)
  const [draggingTagId, setDraggingTagId] = useState<number | null>(null)
  const [dragOverTagId, setDragOverTagId] = useState<number | null>(null)
  const { confirm, alert: showAlert, prompt, choose, dialogNode } = useAppDialog()

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
  const duplicateModeExitVersionRef = useRef(0)
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
    if (typeof window === 'undefined' || !window.electron?.getSetting) {
      return
    }

    let cancelled = false

    const hydrateElectronReferenceDeleteWarningPreference = async () => {
      const rawValue = await hydratePersistedSettingFromElectron(ELECTRON_REFERENCE_DELETE_WARNING_DISMISSED_KEY)
      if (cancelled) return
      setIsElectronReferenceDeleteWarningDismissed(parseBooleanPersistedSetting(rawValue))
    }

    void hydrateElectronReferenceDeleteWarningPreference()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined' || !window.electron?.getSetting) {
      setIsSourcesViewPreferencesReady(true)
      return
    }

    let cancelled = false

    const hydrateSourcesViewPreferences = async () => {
      const raw = await hydratePersistedSettingFromElectron(SOURCES_VIEW_PREFERENCES_STORAGE_KEY)
      if (cancelled) return

      const parsed = parseSourcesViewPreferences(raw)
      if (parsed) {
        setViewMode(parsed.viewMode)
        setSearchScope(parsed.searchScope)
        setCustomSearchFields(parsed.customSearchFields)
      }

      setIsSourcesViewPreferencesReady(true)
    }

    void hydrateSourcesViewPreferences()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!isSourcesViewPreferencesReady) return
    writePersistedSetting(
      SOURCES_VIEW_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        viewMode,
        searchScope,
        customSearchFields,
      }),
    )
  }, [
    isSourcesViewPreferencesReady,
    viewMode,
    searchScope,
    customSearchFields,
  ])

  useEffect(() => {
    const handleResize = () => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    if (!isFilterDockOpen) {
      setIsEnabledFiltersListOpen(false)
    }
  }, [isFilterDockOpen])

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
    minRhythmic: 0,
    maxRhythmic: 1,
    minDensity: 0,
    maxDensity: 1,
    minAmbience: 0,
    maxAmbience: 1,
    minStereoWidth: 0,
    maxStereoWidth: 1,
    stereoChannelMode: 'all',
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
  const backendTagFilterIds = useMemo(
    () => selectedTags.filter((tagId) => tagId > 0),
    [selectedTags],
  )

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
    backendTagFilterIds,
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
      rhythmicMin: toDimensionMin(audioFilter.minRhythmic),
      rhythmicMax: toDimensionMax(audioFilter.maxRhythmic),
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

  const myFolderScopeFolderIds = useMemo(() => {
    if (currentScope.type !== 'my-folder') return null

    const childrenByParent = new Map<number, number[]>()
    for (const folder of allFolders) {
      if (folder.parentId === null) continue
      const siblings = childrenByParent.get(folder.parentId) || []
      siblings.push(folder.id)
      childrenByParent.set(folder.parentId, siblings)
    }

    const descendantIds = new Set<number>([currentScope.folderId])
    const queue = [currentScope.folderId]
    while (queue.length > 0) {
      const nextParentId = queue.shift() as number
      const childIds = childrenByParent.get(nextParentId) || []
      for (const childId of childIds) {
        if (descendantIds.has(childId)) continue
        descendantIds.add(childId)
        queue.push(childId)
      }
    }

    return descendantIds
  }, [allFolders, currentScope])

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
        const itemFolderIds = sample.folderIds ?? []
        if (myFolderScopeFolderIds && itemFolderIds.some((id) => myFolderScopeFolderIds.has(id))) {
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
  }, [overviewBaseSamples, currentScope, allFolders, myFolderScopeFolderIds])

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
  const hasDuplicateGroups = (duplicateData?.total ?? 0) > 0
  const isDuplicatePanelCompact = !hasDuplicateGroups
  const duplicatePanelHeight = isDuplicatePanelCompact
    ? 'auto'
    : `min(100%, ${advancedFilterPanel.size}px)`

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
      const itemFolderIds = sample.folderIds ?? []
      if (!myFolderScopeFolderIds || myFolderScopeFolderIds.size === 0) return false
      return itemFolderIds.some((id) => myFolderScopeFolderIds.has(id))
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
    [overviewBaseSamples, currentScope, scopeCollectionFolderIds, myFolderScopeFolderIds],
  )

  const showOnlyOneShotType = sampleTypeFilter === 'one-shot'
  const showOnlyLoopType = sampleTypeFilter === 'loop'

  const samplesForTagCounts = useMemo(() => {
    return allSamples.filter((sample) => {
      const isOneShot = matchesOneShotType(sample)
      const isLoop = matchesLoopType(sample)

      if (showOnlyOneShotType) {
        return isOneShot
      }
      if (showOnlyLoopType) {
        return isLoop
      }
      return true
    })
  }, [allSamples, showOnlyLoopType, showOnlyOneShotType])

  const tagCounts = useMemo(() => {
    const counts: Record<number, number> = {}
    const countsByName: Record<string, number> = {}

    for (const sample of samplesForTagCounts) {
      for (const tag of sample.tags || []) {
        counts[tag.id] = (counts[tag.id] || 0) + 1
        const key = tag.name.toLowerCase()
        countsByName[key] = (countsByName[key] || 0) + 1
      }
    }

    return { counts, countsByName }
  }, [samplesForTagCounts])

  // Filter samples by duration and advanced features
  const samples = useMemo(() => {
    const isRangeActive = (min: number | undefined, max: number | undefined) =>
      (min ?? 0) > 0 || (max ?? 1) < 1

    const normalizeDimensionValue = (value: number | null | undefined) => {
      if (typeof value !== 'number' || !Number.isFinite(value)) return null
      if (value >= 0 && value <= 1) return value
      // Some legacy payloads can report ambience on a 0-100 scale.
      if (value > 1 && value <= 100) return value / 100
      return Math.max(0, Math.min(1, value))
    }

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

    const stereoChannelMode = audioFilter.stereoChannelMode ?? 'all'

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

      const isOneShot = matchesOneShotType(sample)
      const isLoop = matchesLoopType(sample)
      if (showOnlyOneShotType) {
        if (!isOneShot) {
          return false
        }
      } else if (showOnlyLoopType && !isLoop) {
        return false
      }

      const applyFolderFilters =
        currentScope.type === 'all' ||
        currentScope.type === 'youtube' ||
        currentScope.type === 'youtube-video' ||
        currentScope.type === 'local' ||
        currentScope.type === 'soundcloud' ||
        currentScope.type === 'soundcloud-track' ||
        currentScope.type === 'spotify' ||
        currentScope.type === 'spotify-track' ||
        currentScope.type === 'bandcamp' ||
        currentScope.type === 'bandcamp-track' ||
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
      const normalizedNoisiness =
        normalizedDimensions?.noisiness ??
        normalizedSubjective?.noisiness ??
        sample.noisiness ??
        sample.roughness
      const normalizedAttack = normalizedDimensions?.attack ?? normalizedSubjective?.hardness ?? sample.hardness
      const normalizedDynamics = normalizedDimensions?.dynamics
      const normalizedSaturation = normalizedDimensions?.saturation ?? sample.roughness
      const normalizedSurface = normalizedDimensions?.surface ?? sample.roughness
      const normalizedRhythmic = normalizedDimensions?.rhythmic ?? sample.rhythmicRegularity
      const normalizedDensity = normalizedDimensions?.density
      const normalizedAmbience = normalizeDimensionValue(normalizedDimensions?.ambience)
      const normalizedStereoWidth = normalizedDimensions?.stereoWidth
      const normalizedDepth = normalizedDimensions?.depth

      if (!matchesStereoChannelModeFilter(stereoChannelMode, sample, normalizedStereoWidth)) {
        return false
      }

      if (!matchesNormalizedRange(normalizedBrightness, audioFilter.minBrightness, audioFilter.maxBrightness)) {
        return false
      }
      if (!matchesNormalizedRange(normalizedWarmth, audioFilter.minWarmth, audioFilter.maxWarmth)) {
        return false
      }
      if (!matchesNormalizedRange(normalizedHardness, audioFilter.minHardness, audioFilter.maxHardness)) {
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
      if (!matchesNormalizedRange(normalizedRhythmic, audioFilter.minRhythmic, audioFilter.maxRhythmic)) {
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
    showOnlyOneShotType,
    showOnlyLoopType,
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
        canDeletePartner: pair.canDeleteDuplicateSample,
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
        canDeletePartner: pair.canDeleteKeepSample,
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
  const hasDuplicatePairRender = isDuplicateModeActive && duplicatePairMetaBySampleId.size > 0
  const isBulkActionsTabActive = activeFilterDockTab === 'bulkActions'
  const isBulkRenamePreviewActive = isBulkRenameMode || isBulkActionsTabActive
  const bulkRenameSearchText = bulkRenameRules.searchText.trim()
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
    if (!isBulkRenamePreviewActive) {
      return { byId, changedCount: 0 }
    }

    const selectedOrMatchedSamplesForBulkRename = displaySamples.filter((sample) =>
      selectedSampleIds.has(sample.id) || matchesBulkRenameSearchText(sample.name, bulkRenameRules),
    )

    let changedCount = 0
    selectedOrMatchedSamplesForBulkRename.forEach((sample, index) => {
      const nextName = applyBulkRenameRules(sample.name, bulkRenameRules, index)
      const hasChange = nextName !== sample.name
      if (hasChange) changedCount += 1
      byId.set(sample.id, {
        nextName,
        hasChange,
        highlightRanges: hasChange
          ? getBulkRenameReplacementHighlightRanges(nextName, bulkRenameRules)
          : [],
      })
    })

    return { byId, changedCount }
  }, [isBulkRenamePreviewActive, bulkRenameRules, displaySamples, selectedSampleIds])

  const renderedSamples = useMemo(() => {
    if (!isBulkRenamePreviewActive || bulkRenameSearchText.length === 0) {
      return displaySamples
    }

    return displaySamples.filter((sample) => matchesBulkRenameSearchText(sample.name, bulkRenameRules))
  }, [
    isBulkRenamePreviewActive,
    bulkRenameSearchText,
    bulkRenameRules.caseSensitive,
    displaySamples,
    bulkRenameRules,
  ])

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

  const selectedSamplesInCurrentView = useMemo(() => {
    if (selectedSampleIds.size === 0) return [] as SliceWithTrackExtended[]
    return displaySamples.filter((sample) => selectedSampleIds.has(sample.id))
  }, [displaySamples, selectedSampleIds])
  const selectedSampleIdsInCurrentView = useMemo(
    () => new Set(selectedSamplesInCurrentView.map((sample) => sample.id)),
    [selectedSamplesInCurrentView],
  )
  const selectedSampleIdsInRenderedView = useMemo(
    () => new Set(renderedSamples.filter((sample) => selectedSampleIds.has(sample.id)).map((sample) => sample.id)),
    [renderedSamples, selectedSampleIds],
  )

  useEffect(() => {
    onSelectedSamplesChange?.(selectedSamplesInCurrentView)
  }, [onSelectedSamplesChange, selectedSamplesInCurrentView])

  const selectedSample = useMemo<SliceWithTrackExtended | null>(() => {
    if (selectedSampleId === null) return null
    return allSamples.find((sample) => sample.id === selectedSampleId) || null
  }, [selectedSampleId, allSamples])

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
  const spaceViewSliceIds = useMemo(() => renderedSamples.map((sample) => sample.id), [renderedSamples])

  // Clear selected sample if it's no longer in the current scoped dataset.
  // Keep the similarity reference sample selected even when the backend excludes
  // it from similarity result rows.
  useEffect(() => {
    if (selectedSampleId === null) return
    const keepSimilarityReferenceSelected =
      similarityMode?.enabled === true &&
      similarityMode.referenceSampleId === selectedSampleId &&
      currentScopeSampleIds.has(selectedSampleId)

    if (!selectedSample && allSamples.length > 0) {
      if (keepSimilarityReferenceSelected) {
        return
      }
      setSelectedSampleId(null)
      onWorkspaceStateChange?.(null)
    }
  }, [
    selectedSampleId,
    selectedSample,
    allSamples.length,
    onWorkspaceStateChange,
    similarityMode,
    currentScopeSampleIds,
  ])

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

  const handleUpdateSample = (sliceId: number, data: UpdateSlicePayload) => {
    updateSlice.mutate({ id: sliceId, data })
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

  const handleSelectInstrumentTagFromTree = (tagId: number) => {
    setCurrentScope({ type: 'all' })
    setSelectedTags((prev) => (prev.length === 1 && prev[0] === tagId ? [] : [tagId]))
    setSelectedFolderIds([])
    setExcludedFolderIds([])
    setSelectedSampleId(null)
    setActiveFilterDockTab('categories')
    setIsFilterDockOpen(true)
    onWorkspaceStateChange?.(null)
  }

  const handleClearInstrumentSelectionFromTree = () => {
    setSelectedTags([])
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

  const currentScopeDeleteAction = useMemo(() => {
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
      const isElectronReferenceSourceScope =
        isElectron() && (scope === 'local' || scope.startsWith('folder:') || scope.startsWith('library:'))

      let skipFutureWarning = false
      const confirmed = await confirm(
        isElectronReferenceSourceScope && !isElectronReferenceDeleteWarningDismissed
          ? {
              title: 'Delete Source Reference',
              message:
                `Delete ${label}? In Electron, this removes imported track references from the library only. ` +
                'Original files on disk are kept.',
              confirmText: 'Delete Reference',
              cancelText: 'Cancel',
              isDestructive: true,
              checkboxLabel: "Don't show this again",
              checkboxDefaultChecked: false,
              onCheckboxChange: (checked) => {
                skipFutureWarning = checked
              },
            }
          : {
              title: 'Delete Source',
              message: `Delete ${label}? This will remove its imported tracks and slices from the library.`,
              confirmText: 'Delete',
              cancelText: 'Cancel',
              isDestructive: true,
            },
      )
      if (!confirmed) return

      if (isElectronReferenceSourceScope && !isElectronReferenceDeleteWarningDismissed && skipFutureWarning) {
        setIsElectronReferenceDeleteWarningDismissed(true)
        writePersistedSetting(ELECTRON_REFERENCE_DELETE_WARNING_DISMISSED_KEY, '1')
      }

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
        message: 'This will replace your current library metadata (tracks, slices, instruments, folders, and collections). Continue?',
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

  const getApiErrorMessage = (error: unknown, fallback: string) => {
    if (!error || typeof error !== 'object') {
      return fallback
    }

    const responseData = (error as { response?: { data?: { error?: unknown } } }).response?.data
    const errorMessage = responseData?.error
    if (typeof errorMessage === 'string' && errorMessage.trim().length > 0) {
      return errorMessage.trim()
    }

    if (error instanceof Error && error.message.trim().length > 0) {
      return error.message
    }

    return fallback
  }

  const invalidateTagRelatedQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['tags'] }),
      queryClient.invalidateQueries({ queryKey: ['allSlices'] }),
      queryClient.invalidateQueries({ queryKey: ['slices'] }),
      queryClient.invalidateQueries({ queryKey: ['scopedSamples'] }),
      queryClient.invalidateQueries({ queryKey: ['tracks'] }),
    ])
  }

  const handleRenameTag = (tag: Tag) => {
    void (async () => {
      const nextName = await prompt({
        title: 'Rename Instrument',
        message: `Rename "${tag.name}" to:`,
        defaultValue: tag.name,
        placeholder: 'Instrument name',
        confirmText: 'Save',
        cancelText: 'Cancel',
        validate: (value) => {
          const normalized = value.trim().toLowerCase()
          if (!normalized) return 'Name required'
          if (normalized === tag.name.toLowerCase()) return 'Name unchanged'
          const alreadyExists = allTags.some(
            (candidate) => candidate.id !== tag.id && candidate.name.toLowerCase() === normalized,
          )
          if (alreadyExists) return 'Instrument already exists'
          return null
        },
      })

      if (nextName === null) return

      const normalizedName = nextName.trim()
      if (!normalizedName || normalizedName.toLowerCase() === tag.name.toLowerCase()) return

      try {
        await updateTagRequest(tag.id, { name: normalizedName })
        await invalidateTagRelatedQueries()
      } catch (error) {
        await showAlert({
          title: 'Rename Failed',
          message: getApiErrorMessage(error, 'Failed to rename instrument.'),
          isDestructive: true,
        })
      }
    })()
  }

  const handleDeleteTag = (tag: Tag) => {
    void (async () => {
      const confirmed = await confirm({
        title: 'Delete Instrument',
        message: `Delete "${tag.name}"? This removes it from all tracks and samples.`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        isDestructive: true,
      })
      if (!confirmed) return

      try {
        await deleteTagRequest(tag.id)
        setSelectedTags((prev) => prev.filter((tagId) => tagId !== tag.id))
        if (draggingTagId === tag.id) {
          setDraggingTagId(null)
          setDragOverTagId(null)
        }
        await invalidateTagRelatedQueries()
      } catch (error) {
        await showAlert({
          title: 'Delete Failed',
          message: getApiErrorMessage(error, 'Failed to delete instrument.'),
          isDestructive: true,
        })
      }
    })()
  }

  const handleMergeTags = (sourceTagId: number, targetTagId: number) => {
    if (!Number.isInteger(sourceTagId) || !Number.isInteger(targetTagId) || sourceTagId === targetTagId) {
      return
    }

    const sourceTag = allTags.find((tag) => tag.id === sourceTagId)
    const targetTag = allTags.find((tag) => tag.id === targetTagId)
    if (!sourceTag || !targetTag) return

    void (async () => {
      const keepOriginalChoice = await choose<'yes' | 'no'>({
        title: 'Merge Instruments',
        message: `Merge "${sourceTag.name}" into "${targetTag.name}"? Do you want to keep the original tag?`,
        options: [
          { value: 'yes', label: 'Yes' },
          { value: 'no', label: 'No', isDestructive: true },
        ],
        cancelText: 'Cancel',
      })

      if (keepOriginalChoice === null) return

      const shouldDeleteSourceTag = keepOriginalChoice === 'no'

      try {
        await mergeTagsRequest({
          sourceTagId,
          targetTagId,
          deleteSourceTag: shouldDeleteSourceTag,
        })

        if (shouldDeleteSourceTag) {
          setSelectedTags((prev) => prev.filter((tagId) => tagId !== sourceTagId))
        }

        await invalidateTagRelatedQueries()
      } catch (error) {
        await showAlert({
          title: 'Merge Failed',
          message: getApiErrorMessage(error, 'Failed to merge instruments.'),
          isDestructive: true,
        })
      }
    })()
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
    onUpdateSample: handleUpdateSample,
    onTagClick: handleTagClick,
    onSelectSample: handleSampleSelect,
    onFilterBySimilarity: handleFilterBySimilarity,
    onSampleDeleted: (_sampleId: number) => {
      onWorkspaceStateChange?.(null)
    },
    onTuneToNote: (note) => onTuneToNote?.(note),
  })

  const handleSampleSelect = (id: number) => {
    const sample = samples.find(s => s.id === id) ?? allSamples.find(s => s.id === id)
    if (!sample) {
      return
    }

    setSelectedSampleId(id)
    if (onWorkspaceStateChange) {
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
        samples.forEach((sample) => next.delete(sample.id))
      } else {
        samples.forEach((sample) => next.add(sample.id))
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

    // Invalidate any in-flight "find duplicates" request from re-enabling mode after manual exit.
    duplicateModeExitVersionRef.current += 1

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
    const exitVersionAtStart = duplicateModeExitVersionRef.current
    void (async () => {
      const result = await refetchDuplicates()
      if (duplicateModeExitVersionRef.current !== exitVersionAtStart) {
        return
      }
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

  const handleSetDuplicateDeleteTarget = (pair: DuplicatePairDecision, target: 'keep' | 'duplicate') => {
    if (target === 'keep' && !pair.canDeleteKeepSample) return
    if (target === 'duplicate' && !pair.canDeleteDuplicateSample) return

    const targetSampleId = target === 'keep' ? pair.keepSample.id : pair.duplicateSample.id
    setDuplicatePairDeleteChoice(pair, targetSampleId)
  }

  const handleToggleDuplicateDeleteTargetBySampleId = (sampleId: number) => {
    const pair = duplicatePairDecisionBySampleId.get(sampleId)
    if (!pair) return
    if (sampleId === pair.keepSample.id) {
      handleSetDuplicateDeleteTarget(pair, 'keep')
      return
    }
    if (sampleId === pair.duplicateSample.id) {
      handleSetDuplicateDeleteTarget(pair, 'duplicate')
    }
  }

  const handleKeepDuplicateSampleBySampleId = (sampleId: number) => {
    const pair = duplicatePairDecisionBySampleId.get(sampleId)
    if (!pair) return

    if (sampleId === pair.keepSample.id) {
      if (!pair.canDeleteDuplicateSample) return
      setDuplicatePairDeleteChoice(pair, pair.duplicateSample.id)
      return
    }

    if (sampleId === pair.duplicateSample.id) {
      if (!pair.canDeleteKeepSample) return
      setDuplicatePairDeleteChoice(pair, pair.keepSample.id)
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

  const applyBulkTagUpdateForSample = async (
    sample: SliceWithTrackExtended,
    tagRequest: NonNullable<SampleBulkEditRequest['tags']>,
  ) => {
    const currentTagIds = new Set(sample.tags.map((tag) => tag.id))
    const requestedTagIds = new Set(tagRequest.tagIds)
    const tagIdsToAdd: number[] = []
    const tagIdsToRemove: number[] = []

    if (tagRequest.mode === 'replace' || tagRequest.mode === 'add') {
      requestedTagIds.forEach((tagId) => {
        if (!currentTagIds.has(tagId)) {
          tagIdsToAdd.push(tagId)
        }
      })
    }

    if (tagRequest.mode === 'replace') {
      currentTagIds.forEach((tagId) => {
        if (!requestedTagIds.has(tagId)) {
          tagIdsToRemove.push(tagId)
        }
      })
    } else if (tagRequest.mode === 'remove') {
      requestedTagIds.forEach((tagId) => {
        if (currentTagIds.has(tagId)) {
          tagIdsToRemove.push(tagId)
        }
      })
    }

    await Promise.all([
      ...tagIdsToAdd.map((tagId) => addTagToSliceRequest(sample.id, tagId)),
      ...tagIdsToRemove.map((tagId) => removeTagFromSliceRequest(sample.id, tagId)),
    ])
  }

  const handleBulkEditSubmit = async (request: SampleBulkEditRequest) => {
    const ids = Array.from(selectedSampleIdsInCurrentView)
    if (ids.length === 0) return

    const hasPatch = Object.keys(request.patch).length > 0
    const sampleById = new Map(allSamples.map((sample) => [sample.id, sample]))

    setIsBulkEditSubmitting(true)
    try {
      if (hasPatch) {
        await Promise.all(
          ids.map((id) => updateSliceRequest(id, request.patch)),
        )
      }

      if (request.tags) {
        for (const id of ids) {
          const sample = sampleById.get(id)
          if (!sample) continue
          await applyBulkTagUpdateForSample(sample, request.tags)
        }
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['allSlices'] }),
        queryClient.invalidateQueries({ queryKey: ['slices'] }),
        queryClient.invalidateQueries({ queryKey: ['scopedSamples'] }),
        queryClient.invalidateQueries({ queryKey: ['tags'] }),
      ])

      setSelectedSampleIds(new Set())
      setShowBulkEditModal(false)
    } catch (error) {
      console.error('Failed to apply bulk sample edits:', error)
      await showAlert({
        title: 'Bulk Edit Failed',
        message: error instanceof Error ? error.message : 'Failed to apply selected edits.',
        isDestructive: true,
      })
      throw error
    } finally {
      setIsBulkEditSubmitting(false)
    }
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
      case 'soundcloud':
        return 'SoundCloud'
      case 'soundcloud-track':
        return (
          sourceTree?.streaming?.soundcloud?.tracks?.find((track) => track.id === currentScope.trackId)?.title ||
          'SoundCloud Track'
        )
      case 'spotify':
        return 'Spotify'
      case 'spotify-track':
        return (
          sourceTree?.streaming?.spotify?.tracks?.find((track) => track.id === currentScope.trackId)?.title ||
          'Spotify Track'
        )
      case 'bandcamp':
        return 'Bandcamp'
      case 'bandcamp-track':
        return (
          sourceTree?.streaming?.bandcamp?.tracks?.find((track) => track.id === currentScope.trackId)?.title ||
          'Bandcamp Track'
        )
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
  const totalSamplesInSourceTree = useMemo(() => {
    if (!sourceTree) return 0

    const youtubeCount = (sourceTree.youtube ?? []).reduce(
      (sum, track) => sum + Number(track.sliceCount || 0),
      0,
    )
    const localCount = Number(sourceTree.local?.count || 0)
    const soundcloudCount = Number(sourceTree.streaming?.soundcloud?.count || 0)
    const spotifyCount = Number(sourceTree.streaming?.spotify?.count || 0)
    const bandcampCount = Number(sourceTree.streaming?.bandcamp?.count || 0)
    const importedFolderCount = (sourceTree.folders ?? []).reduce(
      (sum, folder) => sum + Number(folder.sampleCount || 0),
      0,
    )
    const libraryCount = (sourceTree.libraries ?? []).reduce(
      (sum, library) => sum + Number(library.sampleCount || 0),
      0,
    )

    return (
      youtubeCount +
      localCount +
      soundcloudCount +
      spotifyCount +
      bandcampCount +
      importedFolderCount +
      libraryCount
    )
  }, [sourceTree])
  const showEmptyDatabaseWelcome = Boolean(sourceTree) && !isTreeLoading && !isSamplesLoading && totalSamplesInSourceTree === 0
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

  const filterableTags = useMemo(
    () => allTags.filter((tag) => !isSampleTypeTag(tag)),
    [allTags],
  )

  const instrumentTagsForTree = useMemo(
    () =>
      filterableTags.filter((tag) => normalizeTagCategory(tag.category) === 'instrument'),
    [filterableTags],
  )

  const instrumentTagCountsForTree = useMemo(() => {
    const counts: Record<number, number> = {}

    for (const sample of overviewSamples) {
      for (const tag of sample.tags || []) {
        if (normalizeTagCategory(tag.category) !== 'instrument' || isSampleTypeTag(tag)) continue
        counts[tag.id] = (counts[tag.id] || 0) + 1
      }
    }

    // Ensure all instrument tags are visible even when usage is zero in current scope.
    for (const tag of instrumentTagsForTree) {
      if (counts[tag.id] === undefined) {
        counts[tag.id] = tagCounts.counts[tag.id] ?? tagCounts.countsByName[tag.name.toLowerCase()] ?? 0
      }
    }

    return counts
  }, [overviewSamples, instrumentTagsForTree, tagCounts.counts, tagCounts.countsByName])

  const sampleTypeCounts = useMemo(() => {
    let oneShot = 0
    let loop = 0

    for (const sample of allSamples) {
      if (!matchesScopeFallback(sample)) continue
      if (matchesOneShotType(sample)) oneShot += 1
      if (matchesLoopType(sample)) loop += 1
    }

    return {
      oneShot,
      loop,
    }
  }, [allSamples, currentScope, scopeCollectionFolderIds, myFolderScopeFolderIds])

  const visibleTagTiles = useMemo(() => {
    const source = filterableTags.filter((tag) => {
      if (getTagUsageCount(tag) <= 0) {
        return false
      }
      if (normalizedTagFilterSearch && !tag.name.toLowerCase().includes(normalizedTagFilterSearch)) {
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
  }, [filterableTags, getTagUsageCount, normalizedTagFilterSearch, selectedTags, tagCounts.counts, tagCounts.countsByName])

  const activeFilters = useMemo<ActiveFilterListItem[]>(() => {
    const items: ActiveFilterListItem[] = []
    const isRangeActive = (min: number | undefined, max: number | undefined) =>
      (min ?? 0) > 0 || (max ?? 1) < 1
    const clampFilterLabel = (value: string, maxChars = 40) =>
      value.length > maxChars ? `${value.slice(0, maxChars - 3)}...` : value
    const joinFilterValues = (values: string[]) => clampFilterLabel(values.join(', '))
    const formatRangeValue = (value: number | undefined, digits = 2) => (Number(value ?? 0)).toFixed(digits)
    const tagNameById = new Map(allTags.map((tag) => [tag.id, tag.name]))

    for (const tagId of selectedTags) {
      items.push({
        id: `tag-${tagId}`,
        label: `Instrument: ${tagNameById.get(tagId) || `Tag #${tagId}`}`,
        tab: 'categories',
        onRemove: () => setSelectedTags((prev) => prev.filter((id) => id !== tagId)),
      })
    }

    if (sampleTypeFilter !== null) {
      items.push({
        id: `sample-type-${sampleTypeFilter}`,
        label: sampleTypeFilter === 'one-shot' ? 'Type: One-shot' : 'Type: Loop',
        tab: 'categories',
        onRemove: () => setSampleTypeFilter(null),
      })
    }

    if (isBulkRenamePreviewActive && bulkRenameSearchText.length > 0) {
      const matchModeLabel = bulkRenameRules.matchRegex ? 'regex' : 'text'
      const caseModeLabel = bulkRenameRules.caseSensitive ? 'case-sensitive' : 'case-insensitive'
      const replaceModeLabel = bulkRenameRules.replaceMatches ? 'replace on' : 'replace off'
      items.push({
        id: 'bulk-rename-find-text',
        label: `Bulk Find (${matchModeLabel}, ${caseModeLabel}, ${replaceModeLabel}): ${clampFilterLabel(bulkRenameSearchText)}`,
        tab: 'bulkActions',
        onRemove: () =>
          onBulkRenameRulesChange((prev) => ({
            ...prev,
            searchText: '',
          })),
      })
    }

    for (const rule of queryRules) {
      const ruleValue = rule.value.trim()
      if (ruleValue.length === 0) continue
      const fieldLabel = getFilterRuleField(rule.field).label
      const operatorLabel =
        getFilterRuleOperators(rule.field).find((operator) => operator.id === rule.operator)?.label || rule.operator
      items.push({
        id: `rule-${rule.id}`,
        label: `Rule: ${fieldLabel} ${operatorLabel} ${clampFilterLabel(ruleValue)}`,
        tab: 'advanced',
        onRemove: () => setQueryRules((prev) => prev.filter((entry) => entry.id !== rule.id)),
      })
    }

    if (minDuration > 0 || maxDuration < 300) {
      items.push({
        id: 'duration',
        label: `Duration: ${minDuration.toFixed(1)}s - ${maxDuration.toFixed(1)}s`,
        tab: 'features',
        onRemove: () => {
          setMinDuration(0)
          setMaxDuration(300)
        },
      })
    }

    if (minLoudness > -60 || maxLoudness < 0) {
      items.push({
        id: 'loudness',
        label: `Loudness: ${minLoudness.toFixed(1)} dB - ${maxLoudness.toFixed(1)} dB`,
        tab: 'dimensions',
        onRemove: () => {
          setMinLoudness(-60)
          setMaxLoudness(0)
        },
      })
    }

    if (audioFilter.minBpm > 0 || audioFilter.maxBpm < 300) {
      items.push({
        id: 'bpm',
        label: `BPM: ${audioFilter.minBpm.toFixed(1)} - ${audioFilter.maxBpm.toFixed(1)}`,
        tab: 'features',
        onRemove: () => setAudioFilter((prev) => ({ ...prev, minBpm: 0, maxBpm: 300 })),
      })
    }

    if ((audioFilter.selectedNotes || []).length > 0) {
      items.push({
        id: 'notes',
        label: `Notes: ${joinFilterValues(audioFilter.selectedNotes || [])}`,
        tab: 'features',
        onRemove: () =>
          setAudioFilter((prev) => ({ ...prev, selectedNotes: [], relatedNotesLevels: [] })),
      })
    }

    if (audioFilter.selectedKeys.length > 0) {
      items.push({
        id: 'keys',
        label: `Keys: ${joinFilterValues(audioFilter.selectedKeys)}`,
        tab: 'features',
        onRemove: () =>
          setAudioFilter((prev) => ({
            ...prev,
            selectedKeys: [],
            relatedKeysLevels: [],
            groupByScaleDegree: false,
          })),
      })
    }

    if (audioFilter.selectedEnvelopeTypes.length > 0) {
      items.push({
        id: 'envelope',
        label: `Envelope: ${joinFilterValues(audioFilter.selectedEnvelopeTypes)}`,
        tab: 'features',
        onRemove: () => setAudioFilter((prev) => ({ ...prev, selectedEnvelopeTypes: [] })),
      })
    }

    if (
      audioFilter.dateAddedFrom ||
      audioFilter.dateAddedTo ||
      audioFilter.dateCreatedFrom ||
      audioFilter.dateCreatedTo ||
      audioFilter.dateUpdatedFrom ||
      audioFilter.dateUpdatedTo
    ) {
      const dateSegments: string[] = []
      if (audioFilter.dateAddedFrom || audioFilter.dateAddedTo) {
        dateSegments.push(`Added ${audioFilter.dateAddedFrom || '...'} to ${audioFilter.dateAddedTo || '...'}`)
      }
      if (audioFilter.dateCreatedFrom || audioFilter.dateCreatedTo) {
        dateSegments.push(`Created ${audioFilter.dateCreatedFrom || '...'} to ${audioFilter.dateCreatedTo || '...'}`)
      }
      if (audioFilter.dateUpdatedFrom || audioFilter.dateUpdatedTo) {
        dateSegments.push(`Updated ${audioFilter.dateUpdatedFrom || '...'} to ${audioFilter.dateUpdatedTo || '...'}`)
      }
      items.push({
        id: 'dates',
        label: `Dates: ${clampFilterLabel(dateSegments.join(' | '), 64)}`,
        tab: 'features',
        onRemove: () =>
          setAudioFilter((prev) => ({
            ...prev,
            dateAddedFrom: '',
            dateAddedTo: '',
            dateCreatedFrom: '',
            dateCreatedTo: '',
            dateUpdatedFrom: '',
            dateUpdatedTo: '',
          })),
      })
    }

    const dimensionRangeFilters: Array<{
      id: string
      label: string
      min: number | undefined
      max: number | undefined
      reset: Partial<AudioFilterState>
    }> = [
      {
        id: 'brightness',
        label: 'Brightness',
        min: audioFilter.minBrightness,
        max: audioFilter.maxBrightness,
        reset: { minBrightness: 0, maxBrightness: 1 },
      },
      {
        id: 'warmth',
        label: 'Warmth',
        min: audioFilter.minWarmth,
        max: audioFilter.maxWarmth,
        reset: { minWarmth: 0, maxWarmth: 1 },
      },
      {
        id: 'hardness',
        label: 'Hardness',
        min: audioFilter.minHardness,
        max: audioFilter.maxHardness,
        reset: { minHardness: 0, maxHardness: 1 },
      },
      {
        id: 'noisiness',
        label: 'Noisiness',
        min: audioFilter.minNoisiness,
        max: audioFilter.maxNoisiness,
        reset: { minNoisiness: 0, maxNoisiness: 1 },
      },
      {
        id: 'attack',
        label: 'Attack',
        min: audioFilter.minAttack,
        max: audioFilter.maxAttack,
        reset: { minAttack: 0, maxAttack: 1 },
      },
      {
        id: 'dynamics',
        label: 'Dynamics',
        min: audioFilter.minDynamics,
        max: audioFilter.maxDynamics,
        reset: { minDynamics: 0, maxDynamics: 1 },
      },
      {
        id: 'saturation',
        label: 'Saturation',
        min: audioFilter.minSaturation,
        max: audioFilter.maxSaturation,
        reset: { minSaturation: 0, maxSaturation: 1 },
      },
      {
        id: 'surface',
        label: 'Surface',
        min: audioFilter.minSurface,
        max: audioFilter.maxSurface,
        reset: { minSurface: 0, maxSurface: 1 },
      },
      {
        id: 'rhythmic',
        label: 'Rhythmic',
        min: audioFilter.minRhythmic,
        max: audioFilter.maxRhythmic,
        reset: { minRhythmic: 0, maxRhythmic: 1 },
      },
      {
        id: 'density',
        label: 'Density',
        min: audioFilter.minDensity,
        max: audioFilter.maxDensity,
        reset: { minDensity: 0, maxDensity: 1 },
      },
      {
        id: 'ambience',
        label: 'Ambience',
        min: audioFilter.minAmbience,
        max: audioFilter.maxAmbience,
        reset: { minAmbience: 0, maxAmbience: 1 },
      },
      {
        id: 'stereo-width',
        label: 'Stereo Width',
        min: audioFilter.minStereoWidth,
        max: audioFilter.maxStereoWidth,
        reset: { minStereoWidth: 0, maxStereoWidth: 1 },
      },
      {
        id: 'depth',
        label: 'Depth',
        min: audioFilter.minDepth,
        max: audioFilter.maxDepth,
        reset: { minDepth: 0, maxDepth: 1 },
      },
    ]

    for (const dimensionFilter of dimensionRangeFilters) {
      if (!isRangeActive(dimensionFilter.min, dimensionFilter.max)) continue
      items.push({
        id: dimensionFilter.id,
        label: `${dimensionFilter.label}: ${formatRangeValue(dimensionFilter.min)} - ${formatRangeValue(dimensionFilter.max)}`,
        tab: 'dimensions',
        onRemove: () => setAudioFilter((prev) => ({ ...prev, ...dimensionFilter.reset })),
      })
    }

    if ((audioFilter.stereoChannelMode ?? 'all') !== 'all') {
      items.push({
        id: 'stereo-channel-mode',
        label: `Channel Mode: ${audioFilter.stereoChannelMode === 'mono' ? 'Mono' : 'Stereo'}`,
        tab: 'dimensions',
        onRemove: () => setAudioFilter((prev) => ({ ...prev, stereoChannelMode: 'all' })),
      })
    }

    return items
  }, [
    allTags,
    audioFilter,
    bulkRenameRules.caseSensitive,
    bulkRenameRules.matchRegex,
    bulkRenameRules.replaceMatches,
    bulkRenameSearchText,
    isBulkRenamePreviewActive,
    maxDuration,
    maxLoudness,
    minDuration,
    minLoudness,
    onBulkRenameRulesChange,
    queryRules,
    sampleTypeFilter,
    selectedTags,
  ])

  const activeFilterCount = activeFilters.length
  const handleClearAllFilters = () => {
    for (const filter of activeFilters) {
      filter.onRemove()
    }
  }

  const dimensionCategoryTabs = useMemo(
    () => [
      { key: 'spectral' as const, label: 'Spectral' },
      { key: 'energy' as const, label: 'Energy' },
      { key: 'texture' as const, label: 'Texture' },
      { key: 'space' as const, label: 'Space' },
    ],
    [],
  )
  const stereoChannelMode = audioFilter.stereoChannelMode === 'mono' || audioFilter.stereoChannelMode === 'stereo'
    ? audioFilter.stereoChannelMode
    : 'all'
  const setStereoChannelMode = (mode: 'mono' | 'stereo') => {
    setAudioFilter((prev) => ({
      ...prev,
      stereoChannelMode: (prev.stereoChannelMode ?? 'all') === mode ? 'all' : mode,
    }))
  }

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
  const handleShowSourcesSidebar = () => {
    setIsTreeSidebarCollapsed(false)
    if (!isTreeSidebarLocked) {
      setIsTreeSidebarTransitioning(false)
      setTreeSidebarTargetOpen(true)
      setIsTreeSidebarOpen(true)
    }
  }

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
                instrumentTags={instrumentTagsForTree}
                instrumentTagCounts={instrumentTagCountsForTree}
                selectedInstrumentTagIds={selectedTags}
                onSelectInstrumentTag={handleSelectInstrumentTagFromTree}
                onClearInstrumentSelection={handleClearInstrumentSelectionFromTree}
                isLoading={isTreeLoading}
                collections={collections}
                activeCollectionId={activeCollectionId}
                onCollectionChange={setActiveCollectionId}
                onCreateCollection={handleCreateCollection}
                onRenameCollection={handleRenameCollection}
                onDeleteCollection={handleDeleteCollection}
                onMoveCollection={handleMoveCollection}
                onOpenAdvancedCategoryManagement={() => setShowCustomOrder(true)}
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
            data-tour="sources-sidebar-toggle"
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
                instrumentTags={instrumentTagsForTree}
                instrumentTagCounts={instrumentTagCountsForTree}
                selectedInstrumentTagIds={selectedTags}
                onSelectInstrumentTag={handleSelectInstrumentTagFromTree}
                onClearInstrumentSelection={handleClearInstrumentSelectionFromTree}
                isLoading={isTreeLoading}
                collections={collections}
                activeCollectionId={activeCollectionId}
                onCollectionChange={setActiveCollectionId}
                onCreateCollection={handleCreateCollection}
                onRenameCollection={handleRenameCollection}
                onDeleteCollection={handleDeleteCollection}
                onMoveCollection={handleMoveCollection}
                onOpenAdvancedCategoryManagement={() => setShowCustomOrder(true)}
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
            data-tour="sources-sidebar-toggle"
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
        <div
          className="sticky top-0 z-20 px-3 py-0 border-b border-surface-border bg-surface-raised flex-shrink-0"
          data-tour="samples-main-controls"
        >
          {/* Row 1: search + controls */}
          <div className="flex flex-wrap items-center gap-2 min-w-0 w-full">
            <div className={`flex items-center gap-1.5 flex-shrink-0 ${isNarrow ? 'order-2 mt-1' : ''}`}>
              <button
                type="button"
                onClick={handleToggleSelectAll}
                disabled={samples.length === 0}
                data-tour="samples-select-all"
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
                triggerTourId="samples-sort-button"
              />
            </div>

            {/* Search input with scope controls */}
            <div className={`min-w-0 ${isNarrow ? 'order-1 w-full' : 'flex-1'}`}>
              <div className="relative min-w-0">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={15} />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={`Search ${searchScopeDescriptor} in ${scopeLabel}...`}
                  data-tour="samples-search-input"
                  className="w-full pl-9 pr-44 py-1.5 bg-surface-base border border-surface-border rounded-lg text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-primary/60 transition-colors"
                />
                <SampleSearchScopeMenu
                  searchScope={searchScope}
                  searchScopeHint={searchScopeHint}
                  customSearchFields={customSearchFields}
                  onScopeChange={setSearchScope}
                  onToggleCustomField={toggleCustomSearchField}
                  onResetCustomFields={() => setCustomSearchFields(DEFAULT_SAMPLE_SEARCH_CUSTOM_FIELDS)}
                  triggerTourId="samples-search-fields-menu"
                />
              </div>
            </div>

            {/* Workspace tab switcher */}
            {onWorkspaceTabChange && (
              <div
                className={`flex items-center gap-0.5 bg-surface-base border border-surface-border rounded-lg p-0.5 ${
                  isNarrow ? 'order-4 w-full mt-1 justify-start' : 'flex-shrink-0'
                }`}
              >
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
                      ? 'border-accent-secondary/55 bg-accent-secondary/15 text-accent-secondary'
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
            <div
              className={`flex items-center gap-0.5 bg-surface-base border border-surface-border rounded-lg p-0.5 ${
                isNarrow ? 'order-3 mt-1 ml-auto' : 'flex-shrink-0'
              }`}
              data-tour="samples-view-toggle"
            >
              <button
                onClick={() => handleViewModeChange('grid')}
                data-tour="samples-view-card"
                className={`p-1.5 rounded-md transition-colors ${
                  viewMode === 'grid' ? 'bg-surface-overlay text-text-primary' : 'text-text-muted hover:text-text-secondary'
                }`}
                title="Grid view"
              >
                <LayoutGrid size={14} />
              </button>
              <button
                onClick={() => handleViewModeChange('list')}
                data-tour="samples-view-list"
                className={`p-1.5 rounded-md transition-colors ${
                  viewMode === 'list' ? 'bg-surface-overlay text-text-primary' : 'text-text-muted hover:text-text-secondary'
                }`}
                title="List view"
              >
                <List size={14} />
              </button>
              <button
                onClick={() => handleViewModeChange('space')}
                data-tour="samples-view-space"
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
                  {duplicateModeFilter === 'smart-remove'
                    ? ' Smart remove shows only samples currently marked for deletion (updates live as pair choices change).'
                    : ' All duplicates shows both samples from each duplicate pair.'}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setDuplicateModeFilter('all-duplicates')}
                  title="Show both samples from each duplicate pair."
                  className={`px-2 py-1 rounded border text-[11px] font-medium transition-colors ${
                    duplicateModeFilter === 'all-duplicates'
                      ? 'border-accent-primary/60 bg-accent-primary/20 text-accent-primary'
                      : 'border-surface-border bg-surface-base text-slate-300 hover:text-white'
                  }`}
                >
                  All pair samples ({duplicateSamplesInScopeCount})
                </button>
                <button
                  type="button"
                  onClick={() => setDuplicateModeFilter('smart-remove')}
                  title="Show only samples currently marked for deletion."
                  className={`px-2 py-1 rounded border text-[11px] font-medium transition-colors ${
                    duplicateModeFilter === 'smart-remove'
                      ? 'border-red-500/50 bg-red-500/15 text-red-200'
                      : 'border-surface-border bg-surface-base text-slate-300 hover:text-white'
                  }`}
                >
                  Smart remove: marked for delete ({smartRemoveSamplesInScopeCount})
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
            onBulkEdit={() => {
              if (isBulkEditSubmitting) return
              setShowBulkEditModal(true)
            }}
            onBatchDelete={handleBatchDelete}
            onBatchDownload={handleBatchDownload}
            onAnalyzeSelected={handleAnalyzeSelected}
            onClearSelection={() => setSelectedSampleIds(new Set())}
            isEditing={isBulkEditSubmitting}
            isDeleting={batchDeleteSlices.isPending}
            isAnalyzing={batchReanalyzeSlices.isPending}
          />
        )}

        {/* Sample grid/list */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden" data-tour="samples-main-pane">
          <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
            {showEmptyDatabaseWelcome ? (
              <div className="h-full min-h-0 flex items-center justify-center p-6">
                <div className="w-full max-w-2xl rounded-xl border border-surface-border bg-surface-raised/80 p-6 text-center shadow-lg">
                  <h2 className="text-2xl font-semibold text-text-primary">Welcome to Sample Solution</h2>
                  <p className="mt-2 text-sm text-text-secondary">
                    Your database is empty. Open the left panel to manage your sources there.
                  </p>
                  <div className="mt-5 flex justify-center">
                    <button
                      type="button"
                      onClick={handleShowSourcesSidebar}
                      className="inline-flex items-center gap-2 rounded-lg border border-accent-primary/50 bg-accent-primary/15 px-4 py-2 text-sm font-medium text-accent-primary transition-colors hover:bg-accent-primary/25"
                    >
                      <Plus size={15} />
                      Add source
                    </button>
                  </div>
                </div>
              </div>
            ) : isYouTubeGroupedScope ? (
              // YouTube grouped view
              viewMode === 'grid' ? (
                <div className="overflow-y-auto h-full">
                  <SourcesYouTubeGroupedGrid
                    samples={samples}
                    selectedYouTubeTrackId={currentScope.type === 'youtube-video' ? currentScope.trackId : null}
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
                  selectedYouTubeTrackId={currentScope.type === 'youtube-video' ? currentScope.trackId : null}
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
                <div className="h-full min-h-0 flex flex-col relative">
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
                      key={hasDuplicatePairRender ? 'duplicate-pairs-on' : 'duplicate-pairs-off'}
                      samples={renderedSamples}
                      selectedId={selectedSampleId}
                      selectedIds={selectedSampleIdsInRenderedView}
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
                      onKeepDuplicateSample={
                        hasDuplicatePairRender ? handleKeepDuplicateSampleBySampleId : undefined
                      }
                    />
                  </div>
                ) : viewMode === 'list' ? (
                  <div className="flex-1 flex flex-col overflow-hidden min-h-0">
                    {similarityMode?.enabled && (
                      <div
                        className="bg-accent-primary/10 border-l-4 border-accent-primary px-4 py-3 flex items-center justify-between flex-shrink-0"
                        data-tour="samples-similarity-banner"
                      >
                        <div className="flex items-center gap-3">
                          <Sparkles size={16} className="text-accent-primary" />
                          <div>
                            <div className="text-sm font-medium text-white">
                              Similar to: {similarityMode.referenceSampleName}
                            </div>
                            <div className="text-xs text-slate-400">
                              {renderedSamples.length} samples above {Math.round(similarityMode.minSimilarity * 100)}% similarity
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
                            data-tour="samples-similarity-exit"
                            className="px-3 py-1 text-sm bg-surface-overlay hover:bg-surface-base rounded-lg text-slate-300 hover:text-white transition-colors flex items-center gap-1"
                          >
                            <X size={14} />
                            Exit
                          </button>
                        </div>
                      </div>
                    )}
                    <div className="flex-1 min-h-0 overflow-hidden">
                      <SourcesSampleList
                        key={hasDuplicatePairRender ? 'duplicate-pairs-on' : 'duplicate-pairs-off'}
                        samples={renderedSamples}
                        selectedId={selectedSampleId}
                        selectedIds={selectedSampleIdsInRenderedView}
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
                        onKeepDuplicateSample={
                          hasDuplicatePairRender ? handleKeepDuplicateSampleBySampleId : undefined
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
              data-tour="filters-dock-toggle"
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
                      <button
                        type="button"
                        onClick={() => setIsEnabledFiltersListOpen((open) => !open)}
                        data-tour="filters-enabled-list-toggle"
                        className="inline-flex items-center gap-1.5 rounded-sm border border-accent-primary/45 bg-accent-primary/10 px-2 py-1 text-[11px] font-semibold tracking-wide text-slate-200 uppercase transition-colors hover:bg-accent-primary/20"
                        aria-expanded={isEnabledFiltersListOpen}
                        aria-controls="sources-enabled-filters-list"
                      >
                        Filters
                        <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-sm text-[10px] text-slate-300">
                          {activeFilterCount}
                        </span>
                        <ChevronRight
                          size={11}
                          className={`text-slate-400 transition-transform ${isEnabledFiltersListOpen ? 'rotate-90' : ''}`}
                        />
                      </button>

                      <div className="flex-1 min-w-0 overflow-x-auto">
                        <div
                          className="inline-flex items-center gap-0.5 rounded-md border border-surface-border bg-surface-base p-0.5 min-w-max"
                          data-tour="filters-tab-strip"
                        >
                          {[
                            { id: 'categories' as const, label: 'Instruments', tourId: 'filters-tab-instruments' },
                            { id: 'dimensions' as const, label: 'Dimensions', tourId: 'filters-tab-dimensions' },
                            { id: 'features' as const, label: 'Features', tourId: 'filters-tab-features' },
                            { id: 'advanced' as const, label: 'Advanced', tourId: 'filters-tab-advanced' },
                            { id: 'bulkActions' as const, label: 'Bulk Actions', tourId: 'filters-tab-bulk-actions' },
                            { id: 'duplicates' as const, label: 'Duplicates', tourId: 'filters-tab-duplicates' },
                          ].map((tab) => (
                            <button
                              key={tab.id}
                              type="button"
                              data-tour={tab.tourId}
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

                    {isEnabledFiltersListOpen && (
                      <div
                        id="sources-enabled-filters-list"
                        className="mt-2 rounded-md border border-surface-border bg-surface-base/95 px-2 py-2"
                      >
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                            Active filters
                          </div>
                          {activeFilterCount > 0 && (
                            <button
                              type="button"
                              onClick={handleClearAllFilters}
                              data-tour="filters-clear-all"
                              className="inline-flex items-center rounded-sm border border-surface-border px-2 py-0.5 text-[10px] font-medium text-slate-300 transition-colors hover:border-slate-400/60 hover:text-white"
                            >
                              Clear all
                            </button>
                          )}
                        </div>
                        {activeFilters.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {activeFilters.map((filter) => (
                              <div
                                key={filter.id}
                                className="inline-flex max-w-[280px] items-center gap-1 rounded border border-surface-border bg-surface-raised px-2 py-1 text-[11px] text-slate-200"
                              >
                                <button
                                  type="button"
                                  onClick={() => setActiveFilterDockTab(filter.tab)}
                                  className="truncate text-left hover:text-white transition-colors"
                                  title={`Open ${filter.tab} filters`}
                                >
                                  {filter.label}
                                </button>
                                <button
                                  type="button"
                                  onClick={filter.onRemove}
                                  className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-slate-400 transition-colors hover:bg-surface-overlay hover:text-red-300"
                                  title={`Remove ${filter.label}`}
                                  aria-label={`Remove ${filter.label}`}
                                >
                                  <X size={11} />
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-xs text-slate-500">No filters enabled.</div>
                        )}
                      </div>
                    )}
                  </div>

                  {activeFilterDockTab === 'categories' && (
                    <div
                      className="pl-2 pr-3 py-1 border-b border-surface-border/70 bg-surface-base/80 space-y-2 rounded-e"
                      data-tour="filters-instruments-panel"
                    >
                      <div className="flex items-center gap-2">
                        <div className="relative w-52 shrink-0">
                          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
                          <input
                            type="text"
                            value={tagFilterSearchQuery}
                            onChange={(e) => setTagFilterSearchQuery(e.target.value)}
                            placeholder="Search instruments..."
                            className="w-full pl-8 pr-2 py-1.5 text-sm bg-surface-base border border-surface-border rounded-sm text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-accent-primary/60"
                          />
                        </div>

                        <div className="inline-flex items-center gap-1.5 rounded-md bg-surface-base p-0.5">
                          <button
                            type="button"
                            onClick={() =>
                              setSampleTypeFilter((current) => (current === 'one-shot' ? null : 'one-shot'))
                            }
                            data-tour="filters-type-one-shot"
                            aria-pressed={sampleTypeFilter === 'one-shot'}
                            className={`inline-flex items-center gap-1 rounded-sm border px-2 py-1 text-[11px] transition-colors ${
                              sampleTypeFilter === 'one-shot'
                                ? 'border border-accent-primary/45 bg-accent-primary/20 text-accent-primary'
                                : sampleTypeCounts.oneShot > 0
                                  ? 'border-surface-border text-slate-300 hover:text-white hover:border-slate-400/40'
                                  : 'border-surface-border/60 text-slate-500 hover:text-slate-400'
                            }`}
                          >
                            <span className="uppercase tracking-wide">One-shot</span>
                            <span className="text-[10px] text-slate-500">{sampleTypeCounts.oneShot}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setSampleTypeFilter((current) => (current === 'loop' ? null : 'loop'))
                            }
                            data-tour="filters-type-loop"
                            aria-pressed={sampleTypeFilter === 'loop'}
                            className={`inline-flex items-center gap-1 rounded-sm border px-2 py-1 text-[11px] transition-colors ${
                              sampleTypeFilter === 'loop'
                                ? 'border border-accent-primary/45 bg-accent-primary/20 text-accent-primary'
                                : sampleTypeCounts.loop > 0
                                  ? 'border-surface-border text-slate-300 hover:text-white hover:border-slate-400/40'
                                  : 'border-surface-border/60 text-slate-500 hover:text-slate-400'
                            }`}
                          >
                            <span className="uppercase tracking-wide">Loop</span>
                            <span className="text-[10px] text-slate-500">{sampleTypeCounts.loop}</span>
                          </button>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
                        <span className="text-slate-500">
                          Drag one instrument onto another to merge.
                        </span>
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
                          : activeFilterDockTab === 'duplicates'
                            ? 'overflow-hidden px-1 py-1'
                          : 'overflow-y-auto px-1 py-1'
                    }`}
                  >
                    {activeFilterDockTab === 'categories' && (
                      <div className="space-y-2 h-full min-h-0 flex flex-col">
                        <div className="border-surface-border bg-surface-base min-h-0 overflow-y-auto flex-1">
                          <div
                            className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))]"
                            data-tour="filters-tag-grid"
                          >
                            {visibleTagTiles.map((tag) => {
                              const isSelected = selectedTags.includes(tag.id)
                              const usageCount =
                                tagCounts.counts[tag.id] ??
                                tagCounts.countsByName[tag.name.toLowerCase()] ??
                                0
                              const isDragSource = draggingTagId === tag.id
                              const isDropTarget =
                                dragOverTagId === tag.id && draggingTagId !== null && draggingTagId !== tag.id
                              return (
                                <div
                                  key={tag.id}
                                  className={`group relative h-10 border transition-colors overflow-hidden ${
                                    isDropTarget
                                      ? 'border-accent-warm/80 bg-accent-warm/20'
                                      : isSelected
                                        ? 'border-accent-primary/60 bg-accent-primary/15'
                                        : 'border-surface-border bg-surface-base hover:bg-surface-overlay'
                                  } ${isDragSource ? 'opacity-60' : ''}`}
                                >
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSelectedTags((prev) =>
                                        prev.includes(tag.id)
                                          ? prev.filter((id) => id !== tag.id)
                                          : [...prev, tag.id],
                                      )
                                    }}
                                    title={tag.name}
                                    aria-label={tag.name}
                                    draggable
                                    onDragStart={(event) => {
                                      setDraggingTagId(tag.id)
                                      setDragOverTagId(null)
                                      event.dataTransfer.effectAllowed = 'move'
                                      event.dataTransfer.setData('text/tag-id', String(tag.id))
                                      event.dataTransfer.setData('text/plain', String(tag.id))
                                    }}
                                    onDragEnd={() => {
                                      setDraggingTagId(null)
                                      setDragOverTagId(null)
                                    }}
                                    onDragOver={(event) => {
                                      if (draggingTagId === null || draggingTagId === tag.id) return
                                      event.preventDefault()
                                      event.dataTransfer.dropEffect = 'move'
                                      setDragOverTagId(tag.id)
                                    }}
                                    onDragLeave={(event) => {
                                      const relatedTarget = event.relatedTarget as Node | null
                                      if (relatedTarget && event.currentTarget.contains(relatedTarget)) return
                                      if (dragOverTagId === tag.id) {
                                        setDragOverTagId(null)
                                      }
                                    }}
                                    onDrop={(event) => {
                                      event.preventDefault()
                                      event.stopPropagation()
                                      const rawTagId =
                                        event.dataTransfer.getData('text/tag-id') ||
                                        event.dataTransfer.getData('text/plain')
                                      const droppedTagId = Number.parseInt(rawTagId, 10)
                                      const sourceTagId = Number.isInteger(droppedTagId) ? droppedTagId : draggingTagId
                                      setDraggingTagId(null)
                                      setDragOverTagId(null)
                                      if (sourceTagId === null || sourceTagId === tag.id) return
                                      handleMergeTags(sourceTagId, tag.id)
                                    }}
                                    className={`absolute inset-0 px-3 text-center ${
                                      isDropTarget ? 'cursor-copy' : 'cursor-pointer'
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
                                  </button>

                                  <span className="absolute right-0.5 bottom-0.5 z-10 inline-flex items-center rounded-sm bg-surface-base/85 px-1 text-[10px] leading-none text-slate-400 pointer-events-none">
                                    {usageCount}
                                  </span>

                                  <div
                                    className={`absolute right-0.5 top-0.5 z-20 inline-flex items-center gap-0.5 transition-opacity ${
                                      draggingTagId !== null
                                        ? 'opacity-0 pointer-events-none'
                                        : 'opacity-0 group-hover:opacity-100'
                                    }`}
                                  >
                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.preventDefault()
                                        event.stopPropagation()
                                        handleRenameTag(tag)
                                      }}
                                      className="inline-flex h-5 w-5 items-center justify-center rounded bg-surface-base/85 text-slate-300 hover:text-white hover:bg-surface-raised transition-colors"
                                      title={`Rename ${tag.name}`}
                                      aria-label={`Rename ${tag.name}`}
                                    >
                                      <Pencil size={12} />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.preventDefault()
                                        event.stopPropagation()
                                        handleDeleteTag(tag)
                                      }}
                                      className="inline-flex h-5 w-5 items-center justify-center rounded bg-surface-base/85 text-red-300 hover:text-red-100 hover:bg-red-500/60 transition-colors"
                                      title={`Delete ${tag.name}`}
                                      aria-label={`Delete ${tag.name}`}
                                    >
                                      <Trash2 size={12} />
                                    </button>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>

                        {visibleTagTiles.length === 0 && (
                          <div className="rounded-md border border-surface-border bg-surface-base px-3 py-4 text-sm text-slate-500">
                            No instruments match this search.
                          </div>
                        )}
                      </div>
                    )}

                    {activeFilterDockTab === 'features' && (
                      <div
                        className="rounded-lg border border-surface-border bg-surface-base p-3"
                        data-tour="filters-features-panel"
                      >
                        <div className="space-y-1.5">
                          <div className="space-y-1.5" data-tour="filters-features-duration">
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
                      <div
                        className="rounded-lg border border-surface-border bg-surface-base p-3 space-y-3"
                        data-tour="filters-dimensions-panel"
                      >
                        <div className="flex items-center gap-2">
                          <div
                            className="inline-flex items-center gap-1 rounded-sm border border-surface-border bg-surface-raised p-0.5"
                            data-tour="filters-dimensions-categories"
                          >
                            {dimensionCategoryTabs.map((tab) => (
                              <button
                                key={tab.key}
                                type="button"
                                data-tour={`filters-dimensions-category-${tab.key}`}
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

                          {activeDimensionCategory === 'energy' && (
                            <div
                              className="ml-auto flex items-center gap-1.5 overflow-x-auto whitespace-nowrap"
                              data-tour="filters-dimensions-loudness"
                            >
                              <span className="text-[11px] text-slate-400 uppercase tracking-wide">Loudness (dB)</span>
                              <input
                                type="number"
                                value={minLoudness.toFixed(1)}
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value)
                                  if (Number.isNaN(val)) return
                                  setMinLoudness(Math.max(-80, Math.min(val, maxLoudness)))
                                }}
                                className="w-16 px-2 py-0.5 text-xs bg-surface-raised border border-surface-border rounded text-white focus:outline-none focus:border-accent-primary no-spinner"
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
                                className="w-16 px-2 py-0.5 text-xs bg-surface-raised border border-surface-border rounded text-white focus:outline-none focus:border-accent-primary no-spinner"
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
                          )}

                          {activeDimensionCategory === 'space' && (
                            <div
                              className="ml-auto inline-flex items-center gap-1 rounded-sm border border-surface-border bg-surface-raised p-0.5"
                              data-tour="filters-dimensions-stereo-mode"
                            >
                              <button
                                type="button"
                                onClick={() => setStereoChannelMode('mono')}
                                className={`inline-flex items-center px-2 py-1 rounded-sm text-[11px] transition-colors ${
                                  stereoChannelMode === 'mono'
                                    ? 'border border-accent-primary/45 bg-accent-primary/20 text-accent-primary'
                                    : 'border border-transparent text-slate-300 hover:text-white'
                                }`}
                              >
                                <span className="uppercase tracking-wide">Mono</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => setStereoChannelMode('stereo')}
                                className={`inline-flex items-center px-2 py-1 rounded-sm text-[11px] transition-colors ${
                                  stereoChannelMode === 'stereo'
                                    ? 'border border-accent-primary/45 bg-accent-primary/20 text-accent-primary'
                                    : 'border border-transparent text-slate-300 hover:text-white'
                                }`}
                              >
                                <span className="uppercase tracking-wide">Stereo</span>
                              </button>
                            </div>
                          )}
                        </div>
                        <SourcesDimensionFilter
                          category={activeDimensionCategory}
                          filterState={audioFilter}
                          onChange={setAudioFilter}
                        />
                      </div>
                    )}

                    {activeFilterDockTab === 'advanced' && (
                      <div
                        className="rounded-lg border border-surface-border bg-surface-base p-3 space-y-2"
                        data-tour="filters-advanced-panel"
                      >
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
                        scopedSamples={displaySamples}
                        selectedSamples={selectedSamplesInCurrentView}
                        isSamplesLoading={isSamplesLoading}
                        rules={bulkRenameRules}
                        onRulesChange={onBulkRenameRulesChange}
                      />
                    )}

                    {activeFilterDockTab === 'duplicates' && (
                      <div
                        data-tour="filters-duplicates-panel"
                        className={`bg-surface-base border border-surface-border rounded-xl overflow-hidden ${
                          isDuplicatePanelCompact ? '' : 'h-full min-h-0 flex flex-col'
                        }`}
                      >
                        <div
                          className={advancedFilterPanel.isDragging ? 'panel-animate dragging overflow-hidden' : 'panel-animate overflow-hidden'}
                          style={{ height: duplicatePanelHeight }}
                        >
                          <div className={isDuplicatePanelCompact ? 'p-3 pr-2 space-y-3' : 'h-full overflow-y-auto p-3 pr-2 space-y-3'}>
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
                                    data-tour="filters-duplicates-find-button"
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
                                    <div
                                      role="checkbox"
                                      aria-checked={duplicateProtectFavorites}
                                      tabIndex={0}
                                      onClick={() => setDuplicateProtectFavorites((prev) => !prev)}
                                      onKeyDown={(event) =>
                                        handleCheckboxTileKeyDown(event, () =>
                                          setDuplicateProtectFavorites((prev) => !prev)
                                        )
                                      }
                                      className="flex items-center gap-2 rounded border border-surface-border bg-surface-raised px-2 py-1.5 text-xs text-slate-300 cursor-pointer select-none"
                                    >
                                      <CustomCheckbox
                                        checked={duplicateProtectFavorites}
                                        onChange={(e) => setDuplicateProtectFavorites(e.target.checked)}
                                        className="flex-shrink-0"
                                      />
                                      <span>Protect favorites from delete</span>
                                    </div>
                                    <div
                                      role="checkbox"
                                      aria-checked={duplicatePreferAssigned}
                                      tabIndex={0}
                                      onClick={() => setDuplicatePreferAssigned((prev) => !prev)}
                                      onKeyDown={(event) =>
                                        handleCheckboxTileKeyDown(event, () =>
                                          setDuplicatePreferAssigned((prev) => !prev)
                                        )
                                      }
                                      className="flex items-center gap-2 rounded border border-surface-border bg-surface-raised px-2 py-1.5 text-xs text-slate-300 cursor-pointer select-none"
                                    >
                                      <CustomCheckbox
                                        checked={duplicatePreferAssigned}
                                        onChange={(e) => setDuplicatePreferAssigned(e.target.checked)}
                                        className="flex-shrink-0"
                                      />
                                      <span>Keep tagged/folder-assigned first</span>
                                    </div>
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
                        {!isDuplicatePanelCompact && (
                          <ResizableDivider
                            direction="vertical"
                            isDragging={advancedFilterPanel.isDragging}
                            isCollapsed={advancedFilterPanel.isCollapsed}
                            onMouseDown={advancedFilterPanel.dividerProps.onMouseDown}
                            onDoubleClick={advancedFilterPanel.dividerProps.onDoubleClick}
                            onExpand={advancedFilterPanel.restore}
                          />
                        )}
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

      {showBulkEditModal && selectedSampleIdsInCurrentView.size > 0 && (
        <SampleBulkEditModal
          selectedCount={selectedSampleIdsInCurrentView.size}
          allTags={allTags}
          isSubmitting={isBulkEditSubmitting}
          onCancel={() => {
            if (isBulkEditSubmitting) return
            setShowBulkEditModal(false)
          }}
          onSubmit={handleBulkEditSubmit}
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
