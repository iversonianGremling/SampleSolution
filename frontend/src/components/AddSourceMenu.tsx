import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createPortal } from 'react-dom'
import {
  FolderOpen,
  HardDrive,
  Link2,
  ListMusic,
  Loader2,
  Music2,
  Plus,
  X,
  Youtube,
} from 'lucide-react'
import type { Collection, Folder, ImportResult } from '../types'
import { getCollections, getFolders, getGoogleAuthUrl, getSpotifyAuthUrl } from '../api/client'
import {
  useAuthStatus,
  useBatchAddSlicesToFolder,
  useCreateFolder,
  useImportLinks,
  useImportLocalFiles,
  useImportSoundCloud,
  useImportSpotify,
  usePlaylists,
  useSpotifyPlaylists,
  useSpotifyStatus,
} from '../hooks/useTracks'
import { useToast } from '../contexts/ToastContext'
import { ImportDestinationPrompt, type ImportDestinationChoice } from './ImportDestinationPrompt'
import {
  isSpotdlIntegrationEnabled,
  SPOTDL_INTEGRATION_EVENT,
  SPOTDL_INTEGRATION_STORAGE_KEY,
} from '../utils/spotdlIntegration'
import { assignImportsPreservingStructure, type ImportStructureMode } from '../utils/importStructure'

type ActiveModal = 'link' | 'playlist' | null
type PlaylistTab = 'youtube' | 'spotify'

interface AddSourceMenuProps {
  onOpenLibraryImport?: () => void
}

const AUDIO_FILE_REGEX = /\.(wav|mp3|flac|aiff|ogg|m4a)$/i
const SPOTIFY_LINK_REGEX = /(?:open\.)?spotify\.com|spotify:/i
const SOUNDCLOUD_LINK_REGEX = /soundcloud\.com/i
const LARGE_IMPORT_PROMPT_FILE_THRESHOLD = 16
type ImportSourceKind = 'files' | 'folder'

type FileWithRelativePath = File & {
  webkitRelativePath?: string
}

type DataTransferItemWithEntry = DataTransferItem & {
  webkitGetAsEntry?: () => FileSystemEntry | null
}

function isFileDrag(dataTransfer: DataTransfer | null): dataTransfer is DataTransfer {
  if (!dataTransfer) return false
  return Array.from(dataTransfer.types || []).includes('Files')
}

function resolveDroppedSourceKind(dataTransfer: DataTransfer): ImportSourceKind {
  const droppedFiles = Array.from(dataTransfer.files || [])
  const droppedFolderFromRelativePath = droppedFiles.some((file) => {
    const localFile = file as FileWithRelativePath
    return Boolean(localFile.webkitRelativePath && localFile.webkitRelativePath.includes('/'))
  })
  const droppedFolderFromEntry = Array.from(dataTransfer.items || []).some((item) => {
    const entry = (item as DataTransferItemWithEntry).webkitGetAsEntry?.()
    return Boolean(entry?.isDirectory)
  })

  return droppedFolderFromRelativePath || droppedFolderFromEntry ? 'folder' : 'files'
}

function joinPathSegments(basePath: string, nextSegment: string): string {
  if (!basePath) return nextSegment
  return `${basePath}/${nextSegment}`
}

function assignWebkitRelativePath(file: File, relativePath: string): File {
  const localFile = file as FileWithRelativePath
  if (relativePath && !localFile.webkitRelativePath) {
    try {
      Object.defineProperty(localFile, 'webkitRelativePath', {
        value: relativePath,
        configurable: true,
      })
    } catch {
      // Best-effort fallback for browsers that allow direct assignment only.
      localFile.webkitRelativePath = relativePath
    }
  }
  return localFile
}

function readFileEntry(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file(resolve, reject)
  })
}

function readDirectoryEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    reader.readEntries(resolve, reject)
  })
}

async function readAllDirectoryEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  const allEntries: FileSystemEntry[] = []
  while (true) {
    const batch = await readDirectoryEntries(reader)
    if (batch.length === 0) break
    allEntries.push(...batch)
  }
  return allEntries
}

function isFileEntry(entry: FileSystemEntry): entry is FileSystemFileEntry {
  return entry.isFile
}

function isDirectoryEntry(entry: FileSystemEntry): entry is FileSystemDirectoryEntry {
  return entry.isDirectory
}

async function collectFilesFromEntry(entry: FileSystemEntry, basePath: string): Promise<File[]> {
  if (isFileEntry(entry)) {
    const file = await readFileEntry(entry)
    const relativePath = joinPathSegments(basePath, entry.name)
    return [assignWebkitRelativePath(file, relativePath)]
  }

  if (isDirectoryEntry(entry)) {
    const reader = entry.createReader()
    const entries = await readAllDirectoryEntries(reader)
    const directoryPath = joinPathSegments(basePath, entry.name)
    const nestedFiles = await Promise.all(entries.map((child) => collectFilesFromEntry(child, directoryPath)))
    return nestedFiles.flat()
  }

  return []
}

async function resolveDroppedFiles(dataTransfer: DataTransfer, sourceKind: ImportSourceKind): Promise<File[]> {
  const droppedFiles = Array.from(dataTransfer.files || [])
  if (sourceKind !== 'folder') {
    return droppedFiles
  }

  const entries = Array.from(dataTransfer.items || [])
    .map((item) => (item as DataTransferItemWithEntry).webkitGetAsEntry?.())
    .filter((entry): entry is FileSystemEntry => entry !== null)

  if (entries.length === 0) {
    return droppedFiles
  }

  const nestedFiles = (await Promise.all(entries.map((entry) => collectFilesFromEntry(entry, '')))).flat()
  if (nestedFiles.length === 0) {
    return droppedFiles
  }

  return nestedFiles
}

interface PendingImportRequest {
  files: File[]
  sourceKind: ImportSourceKind
  importType: 'sample' | 'track'
}

function createEmptyResult(): ImportResult {
  return {
    success: [],
    failed: [],
  }
}

function mergeImportResult(target: ImportResult, source: ImportResult) {
  target.success.push(...source.success)
  target.failed.push(...source.failed)
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return 'Import failed'
}

function ImportResultPanel({ result }: { result: ImportResult }) {
  return (
    <div className="mt-4 rounded-lg border border-surface-border bg-surface-overlay/40 p-3 text-xs space-y-2">
      <div className="text-slate-300">
        Imported: <span className="text-white">{result.success.length}</span>
      </div>
      <div className="text-slate-300">
        Failed: <span className="text-white">{result.failed.length}</span>
      </div>
      {result.failed.length > 0 && (
        <div className="max-h-28 overflow-y-auto space-y-1 text-red-300">
          {result.failed.map((failure, index) => (
            <div key={`${failure.url}-${index}`} className="truncate">
              {failure.url}: {failure.error}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function PlaylistRow({
  selected,
  title,
  subtitle,
  imageUrl,
  onClick,
}: {
  selected: boolean
  title: string
  subtitle: string
  imageUrl: string | null
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors ${
        selected
          ? 'border-accent-primary/60 bg-accent-primary/10 text-white'
          : 'border-surface-border bg-surface-overlay/40 text-slate-300 hover:bg-surface-overlay'
      }`}
    >
      {imageUrl ? (
        <img src={imageUrl} alt="" className="h-10 w-14 rounded object-cover shrink-0" />
      ) : (
        <div className="h-10 w-14 rounded shrink-0 bg-surface-base border border-surface-border" />
      )}
      <div className="min-w-0">
        <div className="truncate text-sm">{title}</div>
        <div className="truncate text-[11px] text-slate-400">{subtitle}</div>
      </div>
    </button>
  )
}

export function AddSourceMenu({ onOpenLibraryImport: _onOpenLibraryImport }: AddSourceMenuProps) {
  const { showToast } = useToast()
  const queryClient = useQueryClient()
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [activeModal, setActiveModal] = useState<ActiveModal>(null)
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null)
  const [playlistTab, setPlaylistTab] = useState<PlaylistTab>('youtube')
  const [linkText, setLinkText] = useState('')
  const [linkResult, setLinkResult] = useState<ImportResult | null>(null)
  const [playlistResult, setPlaylistResult] = useState<ImportResult | null>(null)
  const [selectedYouTubePlaylistId, setSelectedYouTubePlaylistId] = useState<string | null>(null)
  const [selectedSpotifyPlaylistId, setSelectedSpotifyPlaylistId] = useState<string | null>(null)
  const [isDropTarget, setIsDropTarget] = useState(false)
  const [isGlobalDropTarget, setIsGlobalDropTarget] = useState(false)
  const [pendingImportRequest, setPendingImportRequest] = useState<PendingImportRequest | null>(null)
  const [spotdlEnabled, setSpotdlEnabled] = useState(() => isSpotdlIntegrationEnabled())
  const windowFileDragDepthRef = useRef(0)
  const importSelectedFilesRef = useRef<(files: File[], sourceKind: ImportSourceKind) => Promise<void>>(
    async () => undefined,
  )
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const localFilesInputRef = useRef<HTMLInputElement | null>(null)
  const folderInputRef = useRef<HTMLInputElement | null>(null)

  const importLocalFiles = useImportLocalFiles()
  const batchAddSlicesToFolder = useBatchAddSlicesToFolder()
  const createFolder = useCreateFolder()
  const importLinks = useImportLinks()
  const importSpotify = useImportSpotify()
  const importSoundCloud = useImportSoundCloud()
  const { data: authStatus } = useAuthStatus()
  const { data: spotifyStatus, isLoading: isSpotifyStatusLoading } = useSpotifyStatus({
    enabled: spotdlEnabled && activeModal === 'playlist',
  })
  const { data: youTubePlaylists, isLoading: isYouTubePlaylistsLoading } = usePlaylists({
    enabled: activeModal === 'playlist' && playlistTab === 'youtube' && Boolean(authStatus?.authenticated),
  })
  const { data: spotifyPlaylists, isLoading: isSpotifyPlaylistsLoading } = useSpotifyPlaylists({
    enabled:
      spotdlEnabled &&
      activeModal === 'playlist' &&
      playlistTab === 'spotify' &&
      Boolean(spotifyStatus?.connected),
  })
  const shouldLoadImportDestinations = pendingImportRequest !== null
  const { data: destinationFolders = [], isLoading: isDestinationFoldersLoading } = useQuery({
    queryKey: ['folders'],
    queryFn: () => getFolders(),
    enabled: shouldLoadImportDestinations,
  })
  const { data: destinationCollections = [], isLoading: isDestinationCollectionsLoading } = useQuery({
    queryKey: ['collections'],
    queryFn: () => getCollections(),
    enabled: shouldLoadImportDestinations,
  })
  const destinationFolderMap = useMemo(
    () => new Map((destinationFolders as Folder[]).map((folder) => [folder.id, folder])),
    [destinationFolders],
  )

  const isAnyImportPending =
    importLocalFiles.isPending ||
    batchAddSlicesToFolder.isPending ||
    createFolder.isPending ||
    importLinks.isPending ||
    importSpotify.isPending ||
    importSoundCloud.isPending

  const updateMenuPosition = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return

    const rect = trigger.getBoundingClientRect()
    const menuWidth = 208 // Tailwind w-52
    const gap = 8
    const maxLeft = Math.max(8, window.innerWidth - menuWidth - 8)
    const top = Math.max(8, Math.min(rect.top, window.innerHeight - 8))
    const idealLeft = rect.right + gap
    const left = Math.max(8, Math.min(idealLeft, maxLeft))

    setMenuPosition({ top, left })
  }, [])

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setIsMenuOpen(false)
    }

    if (isMenuOpen) {
      document.addEventListener('pointerdown', handlePointerDown)
    }

    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [isMenuOpen])

  useEffect(() => {
    if (!isMenuOpen) {
      setMenuPosition(null)
      return
    }

    updateMenuPosition()

    const handleViewportChange = () => updateMenuPosition()
    window.addEventListener('resize', handleViewportChange)
    window.addEventListener('scroll', handleViewportChange, true)
    return () => {
      window.removeEventListener('resize', handleViewportChange)
      window.removeEventListener('scroll', handleViewportChange, true)
    }
  }, [isMenuOpen, updateMenuPosition])

  useEffect(() => {
    const onSpotdlChanged = (event: Event) => {
      const detail = (event as CustomEvent<boolean>).detail
      if (typeof detail === 'boolean') {
        setSpotdlEnabled(detail)
        return
      }
      setSpotdlEnabled(isSpotdlIntegrationEnabled())
    }

    const onStorage = (event: StorageEvent) => {
      if (event.key === SPOTDL_INTEGRATION_STORAGE_KEY) {
        setSpotdlEnabled(isSpotdlIntegrationEnabled())
      }
    }

    window.addEventListener(SPOTDL_INTEGRATION_EVENT, onSpotdlChanged)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(SPOTDL_INTEGRATION_EVENT, onSpotdlChanged)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  useEffect(() => {
    if (!activeModal) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActiveModal(null)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeModal])

  useEffect(() => {
    if (playlistTab !== 'spotify') return
    setSelectedYouTubePlaylistId(null)
  }, [playlistTab])

  useEffect(() => {
    if (playlistTab !== 'youtube') return
    setSelectedSpotifyPlaylistId(null)
  }, [playlistTab])

  const refreshSourceQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['tracks'] }),
      queryClient.invalidateQueries({ queryKey: ['allSlices'] }),
      queryClient.invalidateQueries({ queryKey: ['scopedSamples'] }),
      queryClient.invalidateQueries({ queryKey: ['sourceTree'] }),
    ])
  }

  const handleModalOpen = (modal: Exclude<ActiveModal, null>) => {
    setIsMenuOpen(false)
    setActiveModal(modal)
    if (modal === 'link') {
      setLinkResult(null)
    } else {
      setPlaylistResult(null)
    }
  }

  const shouldPromptForDestination = (sourceKind: ImportSourceKind, fileCount: number) =>
    sourceKind === 'folder' || fileCount >= LARGE_IMPORT_PROMPT_FILE_THRESHOLD

  const executeLocalImport = async ({
    files,
    destinationFolderId,
    destinationCollectionId,
    destinationFolder,
    importType,
    sourceKind,
    structureMode,
    bypassParentFolder,
  }: {
    files: File[]
    destinationFolderId: number | null
    destinationCollectionId: number | null
    destinationFolder: ImportDestinationChoice['destinationFolder']
    importType: 'sample' | 'track'
    sourceKind: ImportSourceKind
    structureMode: ImportStructureMode
    bypassParentFolder: boolean
  }) => {
    let assignedCount = 0
    let createdSubfolderCount = 0
    let usedPreservedStructure = false

    try {
      const result = await importLocalFiles.mutateAsync({ files, importType, sourceKind })
      const successfulImports = result.results
        .map((entry, index) =>
          entry.success && typeof entry.sliceId === 'number'
            ? { sliceId: entry.sliceId, file: files[index] }
            : null)
        .filter((entry): entry is { sliceId: number; file: File } => entry !== null)
      const importedSliceIds = successfulImports.map((entry) => entry.sliceId)

      const shouldAssignToCollectionRoot =
        destinationFolderId === null &&
        destinationCollectionId !== null &&
        sourceKind === 'folder' &&
        structureMode === 'preserve'

      if ((destinationFolderId !== null || shouldAssignToCollectionRoot) && importedSliceIds.length > 0) {
        const shouldPreserveStructure = sourceKind === 'folder' && structureMode === 'preserve'

        try {
          if (shouldPreserveStructure) {
            const resolvedDestinationFolder = destinationFolder ||
              (destinationFolderId !== null ? destinationFolderMap.get(destinationFolderId) || null : null)

            if (resolvedDestinationFolder) {
              const preserveResult = await assignImportsPreservingStructure({
                destinationFolder: {
                  id: resolvedDestinationFolder.id,
                  name: resolvedDestinationFolder.name,
                  parentId: resolvedDestinationFolder.parentId ?? null,
                  collectionId: resolvedDestinationFolder.collectionId ?? null,
                },
                successfulImports,
                existingFolders: destinationFolders as Folder[],
                createFolder: (data) => createFolder.mutateAsync(data),
                assignSlicesToFolder: (folderId, sliceIds) =>
                  batchAddSlicesToFolder.mutateAsync({ folderId, sliceIds }),
                bypassParentFolder,
              })
              assignedCount = preserveResult.assignedCount
              createdSubfolderCount = preserveResult.createdFolderCount
              usedPreservedStructure = true
            } else if (destinationCollectionId !== null) {
              const preserveResult = await assignImportsPreservingStructure({
                destinationCollectionId,
                successfulImports,
                existingFolders: destinationFolders as Folder[],
                createFolder: (data) => createFolder.mutateAsync(data),
                assignSlicesToFolder: (folderId, sliceIds) =>
                  batchAddSlicesToFolder.mutateAsync({ folderId, sliceIds }),
                bypassParentFolder,
              })
              assignedCount = preserveResult.assignedCount
              createdSubfolderCount = preserveResult.createdFolderCount
              usedPreservedStructure = true
            } else {
              if (destinationFolderId !== null) {
                await batchAddSlicesToFolder.mutateAsync({
                  folderId: destinationFolderId,
                  sliceIds: importedSliceIds,
                })
                assignedCount = importedSliceIds.length
              }
            }
          } else {
            if (destinationFolderId !== null) {
              await batchAddSlicesToFolder.mutateAsync({
                folderId: destinationFolderId,
                sliceIds: importedSliceIds,
              })
              assignedCount = importedSliceIds.length
            }
          }
        } catch (assignmentError) {
          showToast({
            kind: 'warning',
            message: shouldPreserveStructure
              ? `Imported files but failed to preserve folder structure: ${getErrorMessage(assignmentError)}`
              : `Imported files but failed to place them in the selected folder: ${getErrorMessage(assignmentError)}`,
          })
        }
      }

      if (result.successful > 0) {
        await refreshSourceQueries()
        const destinationFolderName = destinationFolderId !== null
          ? (destinationFolder?.name || destinationFolderMap.get(destinationFolderId)?.name || null)
          : null
        const assignmentText = destinationFolderName && assignedCount > 0
          ? usedPreservedStructure
            ? ` Assigned ${assignedCount} into preserved subfolders under "${destinationFolderName}"${createdSubfolderCount > 0 ? ` (${createdSubfolderCount} new ${createdSubfolderCount === 1 ? 'folder' : 'folders'} created).` : '.'}`
            : ` Added ${assignedCount} to "${destinationFolderName}".`
          : ''
        showToast({
          kind: 'success',
          message: `Imported ${result.successful} ${result.successful === 1 ? 'file' : 'files'}.${assignmentText}`,
        })
      }

      if (result.failed > 0) {
        showToast({
          kind: 'warning',
          message: `${result.failed} ${result.failed === 1 ? 'file failed' : 'files failed'} to import.`,
        })
      }
    } catch (error) {
      showToast({
        kind: 'error',
        message: getErrorMessage(error),
      })
    }
  }

  const handleImportSelectedFiles = async (
    files: File[],
    sourceKind: ImportSourceKind,
    importType: 'sample' | 'track' = 'sample',
  ) => {
    const audioFiles = files.filter((file) => AUDIO_FILE_REGEX.test(file.name))
    if (audioFiles.length === 0) {
      showToast({
        kind: 'warning',
        message: `No supported audio files were found in selected ${sourceKind}.`,
      })
      return
    }

    if (shouldPromptForDestination(sourceKind, audioFiles.length)) {
      setPendingImportRequest({ files: audioFiles, sourceKind, importType })
      return
    }

    await executeLocalImport({
      files: audioFiles,
      destinationFolderId: null,
      destinationCollectionId: null,
      destinationFolder: null,
      importType,
      sourceKind,
      structureMode: 'flatten',
      bypassParentFolder: false,
    })
  }

  useEffect(() => {
    importSelectedFilesRef.current = handleImportSelectedFiles
  }, [handleImportSelectedFiles])

  const triggerLocalFilesExplorer = () => {
    setIsMenuOpen(false)
    const input = localFilesInputRef.current
    if (!input) return
    input.value = ''
    input.click()
  }

  const triggerFolderExplorer = () => {
    setIsMenuOpen(false)
    const input = folderInputRef.current
    if (!input) return
    input.value = ''
    input.click()
  }

  const handleLocalFilesChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || [])
    await handleImportSelectedFiles(files, 'files')
    event.target.value = ''
  }

  const handleFolderChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || [])
    await handleImportSelectedFiles(files, 'folder')
    event.target.value = ''
  }

  const handleDestinationPromptConfirm = (choice: ImportDestinationChoice) => {
    if (!pendingImportRequest) return
    const request = pendingImportRequest
    setPendingImportRequest(null)
    void executeLocalImport({
      files: request.files,
      destinationFolderId: choice.folderId,
      destinationCollectionId: choice.collectionId,
      destinationFolder: choice.destinationFolder,
      importType: choice.importType,
      sourceKind: request.sourceKind,
      structureMode: choice.structureMode,
      bypassParentFolder: choice.bypassParentFolder,
    })
  }

  const handleDestinationPromptCancel = () => {
    setPendingImportRequest(null)
  }

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event.dataTransfer)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setIsDropTarget(true)
  }

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX
    const y = event.clientY
    if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) {
      setIsDropTarget(false)
    }
  }

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDropTarget(false)
    const dataTransfer = event.dataTransfer
    const sourceKind = resolveDroppedSourceKind(dataTransfer)
    void (async () => {
      let droppedFiles: File[] = []
      try {
        droppedFiles = await resolveDroppedFiles(dataTransfer, sourceKind)
      } catch {
        droppedFiles = Array.from(dataTransfer.files || [])
      }
      if (droppedFiles.length === 0) return
      await handleImportSelectedFiles(droppedFiles, sourceKind)
    })()
  }

  useEffect(() => {
    const handleWindowDragEnter = (event: DragEvent) => {
      if (!isFileDrag(event.dataTransfer)) return
      windowFileDragDepthRef.current += 1
      setIsGlobalDropTarget(true)
    }

    const handleWindowDragOver = (event: DragEvent) => {
      if (!isFileDrag(event.dataTransfer)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
      setIsGlobalDropTarget(true)
    }

    const handleWindowDragLeave = (event: DragEvent) => {
      if (!isFileDrag(event.dataTransfer)) return
      windowFileDragDepthRef.current = Math.max(0, windowFileDragDepthRef.current - 1)
      if (windowFileDragDepthRef.current === 0) {
        setIsGlobalDropTarget(false)
      }
    }

    const handleWindowDrop = (event: DragEvent) => {
      if (!isFileDrag(event.dataTransfer)) return

      const dataTransfer = event.dataTransfer
      windowFileDragDepthRef.current = 0
      setIsDropTarget(false)
      setIsGlobalDropTarget(false)

      if (event.defaultPrevented) return
      event.preventDefault()

      const sourceKind = resolveDroppedSourceKind(dataTransfer)
      void (async () => {
        let droppedFiles: File[] = []
        try {
          droppedFiles = await resolveDroppedFiles(dataTransfer, sourceKind)
        } catch {
          droppedFiles = Array.from(dataTransfer.files || [])
        }
        if (droppedFiles.length === 0) return
        await importSelectedFilesRef.current(droppedFiles, sourceKind)
      })()
    }

    window.addEventListener('dragenter', handleWindowDragEnter)
    window.addEventListener('dragover', handleWindowDragOver)
    window.addEventListener('dragleave', handleWindowDragLeave)
    window.addEventListener('drop', handleWindowDrop)
    return () => {
      window.removeEventListener('dragenter', handleWindowDragEnter)
      window.removeEventListener('dragover', handleWindowDragOver)
      window.removeEventListener('dragleave', handleWindowDragLeave)
      window.removeEventListener('drop', handleWindowDrop)
    }
  }, [])

  const handleLinkImport = async () => {
    const lines = linkText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)

    if (lines.length === 0) {
      showToast({ kind: 'warning', message: 'Paste at least one link.' })
      return
    }

    const spotifyLines = lines.filter((line) => SPOTIFY_LINK_REGEX.test(line))
    const soundCloudLines = lines.filter((line) => !SPOTIFY_LINK_REGEX.test(line) && SOUNDCLOUD_LINK_REGEX.test(line))
    const youtubeLines = lines.filter(
      (line) => !SPOTIFY_LINK_REGEX.test(line) && !SOUNDCLOUD_LINK_REGEX.test(line)
    )

    const mergedResult = createEmptyResult()

    if (spotifyLines.length > 0) {
      if (!spotdlEnabled) {
        for (const line of spotifyLines) {
          mergedResult.failed.push({
            url: line,
            error: 'This link type is currently disabled in settings.',
          })
        }
      } else {
        try {
          const spotifyResult = await importSpotify.mutateAsync(spotifyLines.join('\n'))
          mergeImportResult(mergedResult, spotifyResult)
        } catch (error) {
          const message = getErrorMessage(error)
          for (const line of spotifyLines) {
            mergedResult.failed.push({ url: line, error: message })
          }
        }
      }
    }

    if (soundCloudLines.length > 0) {
      try {
        const soundCloudResult = await importSoundCloud.mutateAsync(soundCloudLines.join('\n'))
        mergeImportResult(mergedResult, soundCloudResult)
      } catch (error) {
        const message = getErrorMessage(error)
        for (const line of soundCloudLines) {
          mergedResult.failed.push({ url: line, error: message })
        }
      }
    }

    if (youtubeLines.length > 0) {
      try {
        const youTubeResult = await importLinks.mutateAsync(youtubeLines.join('\n'))
        mergeImportResult(mergedResult, youTubeResult)
      } catch (error) {
        const message = getErrorMessage(error)
        for (const line of youtubeLines) {
          mergedResult.failed.push({ url: line, error: message })
        }
      }
    }

    setLinkResult(mergedResult)

    if (mergedResult.success.length > 0) {
      await refreshSourceQueries()
      showToast({
        kind: 'success',
        message: `Imported ${mergedResult.success.length} link${mergedResult.success.length === 1 ? '' : 's'}.`,
      })
    }

    if (mergedResult.failed.length > 0) {
      showToast({
        kind: 'warning',
        message: `${mergedResult.failed.length} link${mergedResult.failed.length === 1 ? '' : 's'} failed.`,
      })
    }
  }

  const handleImportYouTubePlaylist = async () => {
    if (!selectedYouTubePlaylistId) return
    try {
      const result = await importLinks.mutateAsync(
        `https://www.youtube.com/playlist?list=${selectedYouTubePlaylistId}`,
      )
      setPlaylistResult(result)
      if (result.success.length > 0) {
        await refreshSourceQueries()
        showToast({
          kind: 'success',
          message: `Imported ${result.success.length} tracks from YouTube playlist.`,
        })
      }
    } catch (error) {
      const message = getErrorMessage(error)
      setPlaylistResult({
        success: [],
        failed: [{ url: selectedYouTubePlaylistId, error: message }],
      })
      showToast({ kind: 'error', message })
    }
  }

  const handleImportSpotifyPlaylist = async () => {
    if (!selectedSpotifyPlaylistId) return

    try {
      const result = await importSpotify.mutateAsync(
        `https://open.spotify.com/playlist/${selectedSpotifyPlaylistId}`,
      )
      setPlaylistResult(result)
      if (result.success.length > 0) {
        await refreshSourceQueries()
        showToast({
          kind: 'success',
          message: `Imported ${result.success.length} tracks from selected playlist.`,
        })
      }
    } catch (error) {
      const message = getErrorMessage(error)
      setPlaylistResult({
        success: [],
        failed: [{ url: selectedSpotifyPlaylistId, error: message }],
      })
      showToast({ kind: 'error', message })
    }
  }

  const menuItemClassName =
    'w-full flex items-center gap-2 px-2.5 py-2 text-xs text-text-secondary hover:text-text-primary hover:bg-surface-overlay rounded-md transition-colors'

  const canPortal = typeof document !== 'undefined'

  const globalDropOverlayNode = canPortal && isGlobalDropTarget
    ? createPortal(
      <div className="pointer-events-none fixed inset-0 z-[280] bg-accent-primary/10 backdrop-blur-[1px]">
        <div className="absolute inset-4 rounded-2xl border-2 border-dashed border-accent-primary/70 bg-surface-base/70 flex items-center justify-center p-4">
          <div className="rounded-xl border border-accent-primary/40 bg-surface-raised/90 px-5 py-3 text-center shadow-lg">
            <div className="text-sm font-semibold text-white">Drop audio files or folders to import</div>
            <div className="mt-1 text-xs text-slate-300">WAV, MP3, FLAC, AIFF, OGG, M4A</div>
          </div>
        </div>
      </div>,
      document.body,
    )
    : null

  const dropdownNode = canPortal && isMenuOpen && menuPosition
    ? createPortal(
      <div
        ref={menuRef}
        data-preserve-sources-sidebar="true"
        className="fixed z-[290] w-52 rounded-lg border border-surface-border bg-surface-raised p-1.5 shadow-2xl"
        style={{ top: menuPosition.top, left: menuPosition.left }}
      >
        <button type="button" className={menuItemClassName} onClick={triggerLocalFilesExplorer}>
          <HardDrive size={14} />
          <span>Local files</span>
        </button>
        <button type="button" className={menuItemClassName} onClick={triggerFolderExplorer}>
          <FolderOpen size={14} />
          <span>Folder</span>
        </button>
        <button type="button" className={menuItemClassName} onClick={() => handleModalOpen('link')}>
          <Link2 size={14} />
          <span>Link</span>
        </button>
        <button type="button" className={menuItemClassName} onClick={() => handleModalOpen('playlist')}>
          <ListMusic size={14} />
          <span>Playlist</span>
        </button>
      </div>,
      document.body,
    )
    : null

  const modalNode = canPortal && activeModal
    ? createPortal(
      <div
        data-preserve-sources-sidebar="true"
        className="fixed inset-0 z-[300] flex items-center justify-center bg-surface-base/75 p-4"
        onClick={() => setActiveModal(null)}
      >
        <div
          className="w-full max-w-2xl rounded-xl border border-surface-border bg-surface-raised shadow-2xl"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b border-surface-border px-4 py-3">
            <div className="text-sm font-semibold text-white">
              {activeModal === 'link' ? 'Import from links' : 'Import from playlists'}
            </div>
            <button
              type="button"
              onClick={() => setActiveModal(null)}
              className="rounded-md p-1 text-slate-400 hover:bg-surface-overlay hover:text-white transition-colors"
              aria-label="Close import modal"
              title="Close"
            >
              <X size={15} />
            </button>
          </div>

          <div className="border-b border-surface-border px-4 py-2.5 text-xs text-slate-300 bg-surface-overlay/30">
            <span className="font-semibold text-slate-200">Hint:</span>{' '}
            {activeModal === 'link'
              ? 'Paste one link per line. Supported links are auto-detected and routed automatically.'
              : 'Choose a playlist tab, select one playlist, then import it directly into your library.'}
          </div>

          <div className="max-h-[70vh] overflow-y-auto p-4">
            {activeModal === 'link' && (
              <div className="space-y-3">
                <div className="rounded-lg border border-surface-border bg-surface-overlay/30 p-3 text-xs text-slate-300 space-y-1">
                  <div className="font-medium text-white">Features included</div>
                  <div>Supports YouTube URLs/IDs and playlist links.</div>
                  <div>Detects supported streaming links automatically.</div>
                  <div>You can mix supported providers in the same input.</div>
                </div>

                <textarea
                  value={linkText}
                  onChange={(event) => setLinkText(event.target.value)}
                  rows={9}
                  placeholder="Paste links here, one per line..."
                  className="w-full rounded-lg border border-surface-border bg-surface-base px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-accent-primary/60"
                />

                <div className="flex items-center justify-between">
                  <div className="text-xs text-slate-400">
                    {linkText.split('\n').map((line) => line.trim()).filter(Boolean).length} links
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleLinkImport()}
                    disabled={isAnyImportPending || linkText.trim().length === 0}
                    className="inline-flex items-center gap-2 rounded-lg bg-accent-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-surface-overlay disabled:text-slate-500"
                  >
                    {isAnyImportPending ? <Loader2 size={14} className="animate-spin" /> : null}
                    Import links
                  </button>
                </div>

                {linkResult && <ImportResultPanel result={linkResult} />}
              </div>
            )}

            {activeModal === 'playlist' && (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setPlaylistTab('youtube')}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                      playlistTab === 'youtube'
                        ? 'border-red-500/50 bg-red-500/15 text-red-300'
                        : 'border-surface-border bg-surface-overlay/30 text-slate-300 hover:bg-surface-overlay'
                    }`}
                  >
                    <Youtube size={13} />
                    YouTube
                  </button>
                  <button
                    type="button"
                    onClick={() => setPlaylistTab('spotify')}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                      playlistTab === 'spotify'
                        ? 'border-green-500/50 bg-green-500/15 text-green-300'
                        : 'border-surface-border bg-surface-overlay/30 text-slate-300 hover:bg-surface-overlay'
                    }`}
                  >
                    <Music2 size={13} />
                    Account
                  </button>
                </div>

                {playlistTab === 'youtube' && (
                  <div className="space-y-3">
                    {!authStatus?.authenticated ? (
                      <div className="rounded-lg border border-surface-border bg-surface-overlay/30 p-4 text-sm text-slate-300">
                        <div className="mb-2 font-medium text-white">Sign in required</div>
                        <div className="mb-3 text-xs text-slate-400">
                          Sign in with Google to list your YouTube playlists.
                        </div>
                        <a
                          href={getGoogleAuthUrl()}
                          className="inline-flex items-center gap-2 rounded-lg bg-accent-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-600 transition-colors"
                        >
                          Sign in with Google
                        </a>
                      </div>
                    ) : isYouTubePlaylistsLoading ? (
                      <div className="flex items-center gap-2 text-sm text-slate-300">
                        <Loader2 size={14} className="animate-spin" />
                        Loading YouTube playlists...
                      </div>
                    ) : youTubePlaylists && youTubePlaylists.length > 0 ? (
                      <>
                        <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                          {youTubePlaylists.map((playlist) => (
                            <PlaylistRow
                              key={playlist.id}
                              selected={selectedYouTubePlaylistId === playlist.id}
                              title={playlist.title}
                              subtitle={`${playlist.itemCount} videos`}
                              imageUrl={playlist.thumbnailUrl}
                              onClick={() => setSelectedYouTubePlaylistId(playlist.id)}
                            />
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleImportYouTubePlaylist()}
                          disabled={!selectedYouTubePlaylistId || isAnyImportPending}
                          className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 transition-colors disabled:cursor-not-allowed disabled:bg-surface-overlay disabled:text-slate-500"
                        >
                          {isAnyImportPending ? <Loader2 size={14} className="animate-spin" /> : null}
                          Import selected YouTube playlist
                        </button>
                      </>
                    ) : (
                      <div className="rounded-lg border border-surface-border bg-surface-overlay/30 p-3 text-xs text-slate-400">
                        No YouTube playlists found.
                      </div>
                    )}
                  </div>
                )}

                {playlistTab === 'spotify' && (
                  <div className="space-y-3">
                    {!spotdlEnabled ? (
                      <div className="rounded-lg border border-surface-border bg-surface-overlay/30 p-3 text-xs text-slate-400">
                        Streaming playlist import is disabled in settings.
                      </div>
                    ) : isSpotifyStatusLoading ? (
                      <div className="flex items-center gap-2 text-sm text-slate-300">
                        <Loader2 size={14} className="animate-spin" />
                        Checking account connection...
                      </div>
                    ) : !spotifyStatus?.configured ? (
                      <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-xs text-yellow-200">
                        Configure credentials to load account playlists.
                      </div>
                    ) : !spotifyStatus.connected ? (
                      <div className="rounded-lg border border-surface-border bg-surface-overlay/30 p-4 text-sm text-slate-300">
                        <div className="mb-2 font-medium text-white">Connect account</div>
                        <div className="mb-3 text-xs text-slate-400">
                          Connect your account to fetch your playlists.
                        </div>
                        <a
                          href={getSpotifyAuthUrl()}
                          className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-500 transition-colors"
                        >
                          Connect
                        </a>
                      </div>
                    ) : isSpotifyPlaylistsLoading ? (
                      <div className="flex items-center gap-2 text-sm text-slate-300">
                        <Loader2 size={14} className="animate-spin" />
                        Loading account playlists...
                      </div>
                    ) : spotifyPlaylists && spotifyPlaylists.length > 0 ? (
                      <>
                        <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                          {spotifyPlaylists.map((playlist) => (
                            <PlaylistRow
                              key={playlist.id}
                              selected={selectedSpotifyPlaylistId === playlist.id}
                              title={playlist.name}
                              subtitle={`${playlist.trackCount} tracks`}
                              imageUrl={playlist.thumbnailUrl}
                              onClick={() => setSelectedSpotifyPlaylistId(playlist.id)}
                            />
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleImportSpotifyPlaylist()}
                          disabled={!selectedSpotifyPlaylistId || isAnyImportPending}
                          className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-500 transition-colors disabled:cursor-not-allowed disabled:bg-surface-overlay disabled:text-slate-500"
                        >
                          {isAnyImportPending ? <Loader2 size={14} className="animate-spin" /> : null}
                          Import selected playlist
                        </button>
                      </>
                    ) : (
                      <div className="rounded-lg border border-surface-border bg-surface-overlay/30 p-3 text-xs text-slate-400">
                        No playlists found.
                      </div>
                    )}
                  </div>
                )}

                {playlistResult && <ImportResultPanel result={playlistResult} />}
              </div>
            )}
          </div>
        </div>
      </div>,
      document.body,
    )
    : null

  const importDestinationPromptNode = canPortal && pendingImportRequest
    ? createPortal(
      <ImportDestinationPrompt
        isOpen={Boolean(pendingImportRequest)}
        sourceKind={pendingImportRequest.sourceKind}
        importCount={pendingImportRequest.files.length}
        sourceFiles={pendingImportRequest.files}
        initialImportType={pendingImportRequest.importType}
        folders={destinationFolders as Folder[]}
        collections={destinationCollections as Collection[]}
        isLoading={isDestinationFoldersLoading || isDestinationCollectionsLoading}
        isSubmitting={importLocalFiles.isPending || batchAddSlicesToFolder.isPending || createFolder.isPending}
        onCancel={handleDestinationPromptCancel}
        onConfirm={handleDestinationPromptConfirm}
      />,
      document.body,
    )
    : null

  return (
    <>
      <div
        className={`relative rounded-sm transition-colors ${
          isDropTarget ? 'bg-accent-primary/15 ring-1 ring-accent-primary/50' : ''
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setIsMenuOpen((open) => !open)}
          className="w-full min-h-6 px-1.5 py-0.5 text-[12px] rounded-sm transition-colors flex items-center gap-1.5 text-text-secondary hover:text-text-primary hover:bg-surface-overlay"
        >
          <Plus size={14} />
          <span className="text-left">Add source</span>
        </button>

        <input
          ref={localFilesInputRef}
          type="file"
          multiple
          accept=".wav,.mp3,.flac,.aiff,.ogg,.m4a"
          onChange={handleLocalFilesChange}
          className="hidden"
        />
        <input
          ref={folderInputRef}
          type="file"
          // @ts-expect-error webkitdirectory is not in DOM types, but supported by browsers
          webkitdirectory=""
          directory=""
          multiple
          onChange={handleFolderChange}
          className="hidden"
        />
      </div>

      {dropdownNode}
      {globalDropOverlayNode}
      {modalNode}
      {importDestinationPromptNode}
    </>
  )
}
