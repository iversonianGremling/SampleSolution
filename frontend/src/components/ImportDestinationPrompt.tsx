import { useEffect, useMemo, useState } from 'react'
import { FolderOpen, FolderPlus, Layers3, Loader2, Plus, Search, X } from 'lucide-react'
import { useCreateCollection, useCreateFolder } from '../hooks/useTracks'
import type { Collection, Folder } from '../types'
import type { ImportStructureMode } from '../utils/importStructure'
import { getDefaultCollectionNameForFolderImport } from '../utils/importCollectionStrategy'

type ImportSourceKind = 'files' | 'folder'
type ImportType = 'sample' | 'track'
export type ImportCollectionMode = 'existing' | 'new-collection' | 'split-by-folder'

export interface ImportDestinationChoice {
  folderId: number | null
  collectionId: number | null
  importType: ImportType
  structureMode: ImportStructureMode
  bypassParentFolder: boolean
  collectionMode: ImportCollectionMode
  newCollectionName: string | null
  destinationFolder: Pick<Folder, 'id' | 'name' | 'collectionId' | 'parentId'> | null
}

interface ImportDestinationPromptProps {
  isOpen: boolean
  sourceKind: ImportSourceKind
  importCount: number
  sourceFiles?: File[]
  folders: Folder[]
  collections: Collection[]
  isLoading?: boolean
  isSubmitting?: boolean
  initialImportType?: ImportType
  showImportTypeSelector?: boolean
  onCancel: () => void
  onConfirm: (choice: ImportDestinationChoice) => void
}

interface FolderTreeNode {
  folder: Folder
  children: FolderTreeNode[]
}

interface FolderCreationTarget {
  parentId: number | null
  collectionId: number | null
  label: string
}

type FileWithRelativePath = File & {
  webkitRelativePath?: string
}

interface StructurePreviewNode {
  name: string
  fileCount: number
  children: StructurePreviewNode[]
}

interface FolderSourceSnapshot {
  rootFolderNames: string[]
  firstSubfolders: string[]
  rootLevelFileCount: number
}

interface PreservedStructurePreview {
  tree: StructurePreviewNode[]
  folderCount: number
  rootFileCount: number
}

interface AutoCollectionPreviewGroup {
  collectionName: string
  fileCount: number
  preservePreview: PreservedStructurePreview
}

interface MutableStructurePreviewNode {
  name: string
  fileCount: number
  children: Map<string, MutableStructurePreviewNode>
}

interface MergedFolderTreeNode {
  name: string
  existingNode: FolderTreeNode | null
  previewNode: StructurePreviewNode | null
}

const FALLBACK_IMPORT_COLLECTION_NAME = 'Imported Files'

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return 'Request failed'
}

function mergeById<T extends { id: number }>(base: T[], added: T[]): T[] {
  const merged = new Map<number, T>()
  for (const item of base) merged.set(item.id, item)
  for (const item of added) merged.set(item.id, item)
  return Array.from(merged.values())
}

function normalizeFolderName(name: string): string {
  return name.trim().toLowerCase()
}

function mergeFolderNodesWithPreview(
  nodes: FolderTreeNode[],
  previewNodes: StructurePreviewNode[],
): MergedFolderTreeNode[] {
  const previewByName = new Map<string, StructurePreviewNode>()
  for (const previewNode of previewNodes) {
    const key = normalizeFolderName(previewNode.name)
    if (!key || previewByName.has(key)) continue
    previewByName.set(key, previewNode)
  }

  const consumedPreviewNames = new Set<string>()
  const mergedExistingNodes = nodes.map((node): MergedFolderTreeNode => {
    const key = normalizeFolderName(node.folder.name)
    const previewNode = consumedPreviewNames.has(key) ? null : (previewByName.get(key) || null)
    if (previewNode) consumedPreviewNames.add(key)
    return {
      name: node.folder.name,
      existingNode: node,
      previewNode,
    }
  })

  const previewOnlyNodes = Array.from(previewByName.entries())
    .filter(([key]) => !consumedPreviewNames.has(key))
    .map(([, previewNode]): MergedFolderTreeNode => ({
      name: previewNode.name,
      existingNode: null,
      previewNode,
    }))

  return [...mergedExistingNodes, ...previewOnlyNodes]
    .sort((a, b) => a.name.localeCompare(b.name))
}

function buildFolderPath(folder: Folder, folderMap: Map<number, Folder>): string {
  const names = [folder.name]
  let parentId = folder.parentId
  let guard = 0

  while (parentId !== null && guard < 200) {
    const parent = folderMap.get(parentId)
    if (!parent) break
    names.unshift(parent.name)
    parentId = parent.parentId
    guard += 1
  }

  return names.join(' / ')
}

function buildFolderTree(folders: Folder[], collectionId: number | null): FolderTreeNode[] {
  const collectionFolders = folders.filter((folder) => folder.collectionId === collectionId)
  if (collectionFolders.length === 0) return []

  const folderIds = new Set(collectionFolders.map((folder) => folder.id))
  const childrenByParent = new Map<number | null, Folder[]>()

  for (const folder of collectionFolders) {
    const parentId = folder.parentId !== null && folderIds.has(folder.parentId) ? folder.parentId : null
    const list = childrenByParent.get(parentId) || []
    list.push(folder)
    childrenByParent.set(parentId, list)
  }

  for (const list of childrenByParent.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name))
  }

  const build = (parentId: number | null, visited: Set<number>): FolderTreeNode[] => {
    const children = childrenByParent.get(parentId) || []

    return children.map((folder) => {
      if (visited.has(folder.id)) {
        return { folder, children: [] }
      }

      visited.add(folder.id)
      const descendants = build(folder.id, visited)
      visited.delete(folder.id)
      return {
        folder,
        children: descendants,
      }
    })
  }

  return build(null, new Set<number>())
}

function filterFolderTree(
  nodes: FolderTreeNode[],
  normalizedSearch: string,
  ancestors: string[] = [],
): FolderTreeNode[] {
  if (!normalizedSearch) return nodes

  const result: FolderTreeNode[] = []
  for (const node of nodes) {
    const nextAncestors = [...ancestors, node.folder.name]
    const pathLabel = nextAncestors.join(' / ').toLowerCase()
    const filteredChildren = filterFolderTree(node.children, normalizedSearch, nextAncestors)
    if (pathLabel.includes(normalizedSearch) || filteredChildren.length > 0) {
      result.push({
        folder: node.folder,
        children: filteredChildren,
      })
    }
  }
  return result
}

function resolveFilePathSegments(file: File): string[] {
  const relativePath = (file as FileWithRelativePath).webkitRelativePath
  const candidatePath = relativePath && relativePath.trim().length > 0 ? relativePath : file.name
  if (!candidatePath) return []

  return candidatePath
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part !== '.' && part !== '..')
}

function resolvePreservedDirectorySegments(pathSegments: string[], bypassParentFolder: boolean): string[] {
  if (pathSegments.length < 2) return []

  const startIndex = bypassParentFolder ? 1 : 0
  if (startIndex >= pathSegments.length - 1) return []

  return pathSegments.slice(startIndex, -1)
}

function pushUniqueName(map: Map<string, string>, name: string) {
  const normalized = name.trim().toLowerCase()
  if (!normalized || map.has(normalized)) return
  map.set(normalized, name.trim())
}

function buildFolderSourceSnapshot(sourceFiles: File[]): FolderSourceSnapshot {
  const rootFolderNames = new Map<string, string>()
  const firstSubfolders = new Map<string, string>()
  let rootLevelFileCount = 0

  for (const file of sourceFiles) {
    const pathSegments = resolveFilePathSegments(file)
    if (pathSegments.length < 2) continue

    pushUniqueName(rootFolderNames, pathSegments[0])

    if (pathSegments.length > 2) {
      pushUniqueName(firstSubfolders, pathSegments[1])
    } else {
      rootLevelFileCount += 1
    }
  }

  return {
    rootFolderNames: Array.from(rootFolderNames.values()).sort((a, b) => a.localeCompare(b)),
    firstSubfolders: Array.from(firstSubfolders.values()).sort((a, b) => a.localeCompare(b)),
    rootLevelFileCount,
  }
}

function buildStructurePreviewFromDirectorySegments(
  directorySegmentsList: string[][],
): PreservedStructurePreview {
  const root = new Map<string, MutableStructurePreviewNode>()
  let folderCount = 0
  let rootFileCount = 0

  for (const directories of directorySegmentsList) {
    if (directories.length === 0) {
      rootFileCount += 1
      continue
    }

    let children = root
    for (const segment of directories) {
      const key = segment.toLowerCase()
      let node = children.get(key)
      if (!node) {
        node = {
          name: segment,
          fileCount: 0,
          children: new Map<string, MutableStructurePreviewNode>(),
        }
        children.set(key, node)
        folderCount += 1
      }

      node.fileCount += 1
      children = node.children
    }
  }

  const buildNodes = (children: Map<string, MutableStructurePreviewNode>): StructurePreviewNode[] =>
    Array.from(children.values())
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((node) => ({
        name: node.name,
        fileCount: node.fileCount,
        children: buildNodes(node.children),
      }))

  return {
    tree: buildNodes(root),
    folderCount,
    rootFileCount,
  }
}

function buildPreservedStructurePreview(sourceFiles: File[], bypassParentFolder: boolean): PreservedStructurePreview {
  const directorySegmentsList = sourceFiles.map((file) => {
    const pathSegments = resolveFilePathSegments(file)
    return resolvePreservedDirectorySegments(pathSegments, bypassParentFolder)
  })

  return buildStructurePreviewFromDirectorySegments(directorySegmentsList)
}

function buildSplitCollectionPreviewGroups(sourceFiles: File[]): AutoCollectionPreviewGroup[] {
  const groups = new Map<
    string,
    { collectionName: string; fileCount: number; preservedDirectories: string[][] }
  >()

  for (const file of sourceFiles) {
    const segments = resolveFilePathSegments(file)
    const rootName = segments.length >= 2 ? segments[0] : null
    const firstSubfolderName = segments.length >= 3 ? segments[1] : null
    const collectionName = (firstSubfolderName || rootName || FALLBACK_IMPORT_COLLECTION_NAME).trim() || FALLBACK_IMPORT_COLLECTION_NAME
    const key = normalizeFolderName(collectionName) || normalizeFolderName(FALLBACK_IMPORT_COLLECTION_NAME)
    const preservedDirectories = firstSubfolderName ? segments.slice(2, -1) : []
    const existing = groups.get(key)
    if (existing) {
      existing.fileCount += 1
      existing.preservedDirectories.push(preservedDirectories)
      continue
    }

    groups.set(key, {
      collectionName,
      fileCount: 1,
      preservedDirectories: [preservedDirectories],
    })
  }

  return Array.from(groups.values())
    .sort((a, b) => a.collectionName.localeCompare(b.collectionName))
    .map((group) => ({
      collectionName: group.collectionName,
      fileCount: group.fileCount,
      preservePreview: buildStructurePreviewFromDirectorySegments(group.preservedDirectories),
    }))
}

export function ImportDestinationPrompt({
  isOpen,
  sourceKind,
  importCount,
  sourceFiles = [],
  folders,
  collections,
  isLoading = false,
  isSubmitting = false,
  initialImportType = 'sample',
  showImportTypeSelector = true,
  onCancel,
  onConfirm,
}: ImportDestinationPromptProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null)
  const [selectedCollectionId, setSelectedCollectionId] = useState<number | null>(null)
  const [selectedImportType, setSelectedImportType] = useState<ImportType>(initialImportType)
  const [structureMode, setStructureMode] = useState<ImportStructureMode>('flatten')
  const [bypassParentFolder, setBypassParentFolder] = useState(false)
  const [collectionMode, setCollectionMode] = useState<ImportCollectionMode>('existing')
  const [newImportCollectionName, setNewImportCollectionName] = useState('')
  const [createdCollections, setCreatedCollections] = useState<Collection[]>([])
  const [createdFolders, setCreatedFolders] = useState<Folder[]>([])
  const [showCreateCollection, setShowCreateCollection] = useState(false)
  const [newCollectionName, setNewCollectionName] = useState('')
  const [folderCreationTarget, setFolderCreationTarget] = useState<FolderCreationTarget | null>(null)
  const [newFolderName, setNewFolderName] = useState('')
  const [creationError, setCreationError] = useState<string | null>(null)
  const createCollection = useCreateCollection()
  const createFolder = useCreateFolder()

  useEffect(() => {
    if (!isOpen) return

    setSearchQuery('')
    setSelectedFolderId(null)
    setSelectedCollectionId(null)
    setSelectedImportType(initialImportType)
    setStructureMode(sourceKind === 'folder' ? 'preserve' : 'flatten')
    setBypassParentFolder(false)
    setCollectionMode('existing')
    setNewImportCollectionName(sourceKind === 'folder' ? getDefaultCollectionNameForFolderImport(sourceFiles) || '' : '')
    setCreatedCollections([])
    setCreatedFolders([])
    setShowCreateCollection(false)
    setNewCollectionName('')
    setFolderCreationTarget(null)
    setNewFolderName('')
    setCreationError(null)
  }, [initialImportType, isOpen, sourceFiles, sourceKind])

  const mergedCollections = useMemo(
    () =>
      mergeById(collections, createdCollections)
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    [collections, createdCollections],
  )

  const mergedFolders = useMemo(() => mergeById(folders, createdFolders), [folders, createdFolders])
  const collectionMap = useMemo(
    () => new Map(mergedCollections.map((collection) => [collection.id, collection])),
    [mergedCollections],
  )

  const folderMap = useMemo(
    () => new Map(mergedFolders.map((folder) => [folder.id, folder])),
    [mergedFolders],
  )

  const collectionTrees = useMemo(
    () =>
      mergedCollections.map((collection) => ({
        collection,
        tree: buildFolderTree(mergedFolders, collection.id),
      })),
    [mergedCollections, mergedFolders],
  )

  const ungroupedTree = useMemo(() => buildFolderTree(mergedFolders, null), [mergedFolders])

  const normalizedSearch = searchQuery.trim().toLowerCase()
  const visibleCollectionTrees = useMemo(() => {
    if (!normalizedSearch) return collectionTrees

    return collectionTrees
      .map(({ collection, tree }) => {
        const collectionMatches = collection.name.toLowerCase().includes(normalizedSearch)
        const visibleTree = collectionMatches ? tree : filterFolderTree(tree, normalizedSearch)
        if (!collectionMatches && visibleTree.length === 0) return null
        return { collection, tree: visibleTree }
      })
      .filter((entry): entry is { collection: Collection; tree: FolderTreeNode[] } => entry !== null)
  }, [collectionTrees, normalizedSearch])

  const visibleUngroupedTree = useMemo(() => {
    if (!normalizedSearch) return ungroupedTree
    if ('ungrouped'.includes(normalizedSearch)) return ungroupedTree
    return filterFolderTree(ungroupedTree, normalizedSearch)
  }, [normalizedSearch, ungroupedTree])

  const selectedFolder = selectedFolderId !== null ? folderMap.get(selectedFolderId) || null : null
  const selectedCollection = selectedCollectionId !== null ? collectionMap.get(selectedCollectionId) || null : null
  const sourceFolderSnapshot = useMemo(() => buildFolderSourceSnapshot(sourceFiles), [sourceFiles])
  const preservedStructurePreview = useMemo(
    () => buildPreservedStructurePreview(sourceFiles, bypassParentFolder),
    [sourceFiles, bypassParentFolder],
  )
  const autoCollectionPreservedPreview = useMemo(
    () => buildPreservedStructurePreview(sourceFiles, bypassParentFolder),
    [sourceFiles, bypassParentFolder],
  )
  const splitCollectionPreviewGroups = useMemo(
    () => buildSplitCollectionPreviewGroups(sourceFiles),
    [sourceFiles],
  )
  const defaultCollectionNameFromSource = useMemo(
    () => getDefaultCollectionNameForFolderImport(sourceFiles) || '',
    [sourceFiles],
  )
  const autoCollectionNamePreview = (newImportCollectionName.trim() || defaultCollectionNameFromSource || FALLBACK_IMPORT_COLLECTION_NAME).trim()
  const autoFlatDestinationFolderName = `Imported ${new Date().toISOString().slice(0, 10)}`
  const hasAutoCollectionDestination = sourceKind === 'folder' && collectionMode !== 'existing'
  const isBypassParentFolderDisabled = sourceKind === 'folder' && collectionMode === 'split-by-folder'
  const shouldAssignAtCollectionRoot =
    sourceKind === 'folder' && structureMode === 'preserve'
  const hasDestinationSelection =
    hasAutoCollectionDestination || selectedFolderId !== null || selectedCollectionId !== null
  const shouldRenderMergedTreePreview =
    sourceKind === 'folder' &&
    structureMode === 'preserve' &&
    !hasAutoCollectionDestination &&
    hasDestinationSelection &&
    preservedStructurePreview.tree.length > 0
  const visibleSourceSubfolders = sourceFolderSnapshot.firstSubfolders.slice(0, 8)
  const hiddenSourceSubfolderCount = sourceFolderSnapshot.firstSubfolders.length - visibleSourceSubfolders.length

  const isDestinationMutating = createCollection.isPending || createFolder.isPending
  const hasVisibleDestinations = visibleCollectionTrees.length > 0 || visibleUngroupedTree.length > 0
  const hasAnyFolders = mergedFolders.length > 0

  if (!isOpen) return null

  const startFolderCreation = (target: FolderCreationTarget) => {
    setFolderCreationTarget(target)
    setNewFolderName('')
    setCreationError(null)
  }

  const handleCreateCollection = async () => {
    const name = newCollectionName.trim()
    if (!name) return

    setCreationError(null)
    try {
      const created = await createCollection.mutateAsync({ name })
      setCreatedCollections((prev) => [...prev, created])
      setShowCreateCollection(false)
      setNewCollectionName('')
      startFolderCreation({
        parentId: null,
        collectionId: created.id,
        label: `${created.name} (root)`,
      })
    } catch (error) {
      setCreationError(getErrorMessage(error))
    }
  }

  const handleCreateFolder = async () => {
    if (!folderCreationTarget) return
    const name = newFolderName.trim()
    if (!name) return

    setCreationError(null)
    try {
      const created = await createFolder.mutateAsync({
        name,
        parentId: folderCreationTarget.parentId ?? undefined,
        collectionId: folderCreationTarget.collectionId ?? undefined,
      })
      setCreatedFolders((prev) => [...prev, created])
      setSelectedFolderId(created.id)
      setSelectedCollectionId(null)
      setFolderCreationTarget(null)
      setNewFolderName('')
    } catch (error) {
      setCreationError(getErrorMessage(error))
    }
  }

  const resolveChoice = (folderId: number | null): ImportDestinationChoice => {
    const destinationFolder = folderId === null
      ? null
      : (() => {
          const folder = folderMap.get(folderId)
          if (!folder) return null
          return {
            id: folder.id,
            name: folder.name,
            collectionId: folder.collectionId,
            parentId: folder.parentId,
          }
        })()

    return {
      folderId,
      collectionId:
        collectionMode === 'existing' && folderId === null
          ? selectedCollectionId
          : null,
      importType: selectedImportType,
      structureMode: sourceKind === 'folder' ? structureMode : 'flatten',
      bypassParentFolder:
        sourceKind === 'folder' && structureMode === 'preserve' && collectionMode !== 'split-by-folder'
          ? bypassParentFolder
          : false,
      collectionMode: sourceKind === 'folder' ? collectionMode : 'existing',
      newCollectionName:
        sourceKind === 'folder' && collectionMode === 'new-collection'
          ? newImportCollectionName.trim() || defaultCollectionNameFromSource || null
          : null,
      destinationFolder,
    }
  }

  const handleConfirmAssign = async () => {
    if (sourceKind === 'folder' && collectionMode !== 'existing') {
      if (collectionMode === 'new-collection') {
        const resolvedName = newImportCollectionName.trim() || defaultCollectionNameFromSource
        if (!resolvedName) {
          setCreationError('Collection name is required.')
          return
        }
      }

      onConfirm(resolveChoice(null))
      return
    }

    if (selectedFolderId !== null) {
      onConfirm(resolveChoice(selectedFolderId))
      return
    }

    if (selectedCollectionId !== null) {
      const collection = collectionMap.get(selectedCollectionId)
      if (!collection) {
        setCreationError('Selected collection is no longer available. Please choose again.')
        return
      }

      if (shouldAssignAtCollectionRoot) {
        onConfirm(resolveChoice(null))
        return
      }

      setCreationError(null)
      try {
        const created = await createFolder.mutateAsync({
          name: `Imported ${new Date().toISOString().slice(0, 10)}`,
          collectionId: collection.id,
        })
        setCreatedFolders((prev) => [...prev, created])
        onConfirm(resolveChoice(created.id))
      } catch (error) {
        setCreationError(getErrorMessage(error))
      }
    }
  }

  const renderFolderNodes = (
    nodes: FolderTreeNode[],
    depth: number,
    previewNodes: StructurePreviewNode[] = [],
    parentKey: string,
  ): React.ReactNode =>
    mergeFolderNodesWithPreview(nodes, previewNodes).map((mergedNode) => {
      if (mergedNode.existingNode) {
        const node = mergedNode.existingNode
        const selectedFolderPreviewChildren =
          shouldRenderMergedTreePreview && selectedFolderId === node.folder.id
            ? preservedStructurePreview.tree
            : []
        const inheritedPreviewChildren = mergedNode.previewNode?.children || []
        const childPreviewNodes = selectedFolderPreviewChildren.length > 0
          ? selectedFolderPreviewChildren
          : inheritedPreviewChildren
        const key = `${parentKey}/folder-${node.folder.id}`

        return (
          <div key={key} className="space-y-1">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  setSelectedFolderId(node.folder.id)
                  setSelectedCollectionId(null)
                }}
                className={`flex-1 rounded-md border py-1.5 pr-2 text-left text-xs transition-colors ${
                  selectedFolderId === node.folder.id
                    ? 'border-accent-primary/60 bg-accent-primary/10 text-white'
                    : 'border-surface-border bg-surface-overlay/30 text-slate-300 hover:bg-surface-overlay'
                }`}
                style={{ paddingLeft: `${depth * 14 + 8}px` }}
              >
                <div className="flex items-center gap-2">
                  <FolderOpen size={12} className="text-amber-400" />
                  <span className="truncate">{node.folder.name}</span>
                </div>
              </button>
              <button
                type="button"
                onClick={() =>
                  startFolderCreation({
                    parentId: node.folder.id,
                    collectionId: node.folder.collectionId,
                    label: buildFolderPath(node.folder, folderMap),
                  })}
                disabled={isSubmitting || isDestinationMutating}
                className="inline-flex items-center justify-center rounded-md border border-surface-border bg-surface-overlay/30 p-1.5 text-slate-300 transition-colors hover:bg-surface-overlay hover:text-white disabled:opacity-50"
                aria-label={`Create subfolder under ${node.folder.name}`}
                title="Create subfolder"
              >
                <FolderPlus size={12} />
              </button>
            </div>

            {node.children.length > 0 || childPreviewNodes.length > 0 ? (
              <div className="space-y-1">
                {renderFolderNodes(node.children, depth + 1, childPreviewNodes, key)}
              </div>
            ) : null}
          </div>
        )
      }

      if (!mergedNode.previewNode) return null
      const previewNode = mergedNode.previewNode
      const key = `${parentKey}/preview-${normalizeFolderName(previewNode.name)}`

      return (
        <div key={key} className="space-y-1">
          <div
            className="flex items-center gap-2 rounded-md border border-dashed border-emerald-500/40 bg-emerald-500/10 py-1.5 pr-2 text-left text-xs text-emerald-100"
            style={{ paddingLeft: `${depth * 14 + 8}px` }}
          >
            <FolderOpen size={12} className="text-emerald-300" />
            <span className="truncate">{previewNode.name}</span>
            <span className="text-[10px] text-emerald-200/80">
              {previewNode.fileCount} {previewNode.fileCount === 1 ? 'file' : 'files'}
            </span>
            <span className="rounded border border-emerald-500/50 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-200">
              New
            </span>
          </div>
          {previewNode.children.length > 0 ? (
            <div className="space-y-1">
              {renderFolderNodes([], depth + 1, previewNode.children, key)}
            </div>
          ) : null}
        </div>
      )
    })

  return (
    <div className="fixed inset-0 z-[320] flex items-start justify-center overflow-y-auto bg-surface-base/75 p-3 sm:items-center sm:p-4">
      <div
        className="my-4 flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-surface-border bg-surface-raised shadow-2xl"
        data-tour="import-destination-prompt"
      >
        <div className="flex items-start justify-between gap-3 border-b border-surface-border px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-white">Choose Where and How to Import</h3>
            <p className="mt-1 text-xs text-slate-400">
              {sourceKind === 'folder'
                ? 'Pick a destination and choose whether to preserve source subfolders.'
                : `You are importing ${importCount} files. Optionally place imported files into an existing folder.`}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="rounded-md p-1 text-slate-400 transition-colors hover:bg-surface-overlay hover:text-white disabled:opacity-50"
            aria-label="Close import destination prompt"
            title="Close"
          >
            <X size={15} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {showImportTypeSelector && (
            <div className="rounded-lg border border-surface-border bg-surface-overlay/20 p-3" data-tour="import-method-section">
              <div className="text-xs font-semibold text-white">Import method</div>
              <div className="mt-2 space-y-1.5">
                {(['sample', 'track'] as const).map((value) => (
                  <label
                    key={value}
                    data-tour={value === 'sample' ? 'import-method-analysis' : undefined}
                    className="flex items-center gap-3 rounded-md border border-surface-border bg-surface-overlay/30 px-2.5 py-2 text-sm text-slate-200 transition-colors hover:bg-surface-overlay cursor-pointer"
                  >
                    <input
                      type="radio"
                      name="importDestinationImportType"
                      value={value}
                      checked={selectedImportType === value}
                      onChange={() => setSelectedImportType(value)}
                      className="h-4 w-4 cursor-pointer"
                    />
                    <div>
                      <div className="font-medium text-white">
                        {value === 'sample' ? 'Sample (auto-analyze)' : 'Track (no analysis)'}
                      </div>
                      <div className="text-xs text-slate-400">
                        {value === 'sample' ? 'Analyze audio features immediately.' : 'Skip analysis during import.'}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {sourceKind === 'folder' && (
            <div className="rounded-lg border border-surface-border bg-surface-overlay/20 p-3" data-tour="import-collection-strategy">
              <div className="text-xs font-semibold text-white">Collection strategy</div>
              <div className="mt-2 space-y-1.5">
                <label className="flex cursor-pointer items-start gap-2 rounded-md border border-surface-border bg-surface-overlay/30 px-2 py-1.5 text-xs text-slate-200 transition-colors hover:bg-surface-overlay">
                  <input
                    type="radio"
                    name="importDestinationCollectionMode"
                    checked={collectionMode === 'existing'}
                    onChange={() => {
                      setCollectionMode('existing')
                      setCreationError(null)
                    }}
                    className="mt-0.5 h-3.5 w-3.5"
                  />
                  <span>Assign into an existing collection or folder</span>
                </label>
                <label
                  className="flex cursor-pointer items-start gap-2 rounded-md border border-surface-border bg-surface-overlay/30 px-2 py-1.5 text-xs text-slate-200 transition-colors hover:bg-surface-overlay"
                  data-tour="import-collection-mode-new"
                >
                  <input
                    type="radio"
                    name="importDestinationCollectionMode"
                    checked={collectionMode === 'new-collection'}
                    onChange={() => {
                      setCollectionMode('new-collection')
                      setSelectedFolderId(null)
                      setSelectedCollectionId(null)
                      setCreationError(null)
                      if (!newImportCollectionName.trim() && defaultCollectionNameFromSource) {
                        setNewImportCollectionName(defaultCollectionNameFromSource)
                      }
                    }}
                    className="mt-0.5 h-3.5 w-3.5"
                  />
                  <span>Create one new collection for this import</span>
                </label>
                <label
                  className="flex cursor-pointer items-start gap-2 rounded-md border border-surface-border bg-surface-overlay/30 px-2 py-1.5 text-xs text-slate-200 transition-colors hover:bg-surface-overlay"
                  data-tour="import-collection-mode-split"
                >
                  <input
                    type="radio"
                    name="importDestinationCollectionMode"
                    checked={collectionMode === 'split-by-folder'}
                    onChange={() => {
                      setCollectionMode('split-by-folder')
                      setSelectedFolderId(null)
                      setSelectedCollectionId(null)
                      setCreationError(null)
                    }}
                    className="mt-0.5 h-3.5 w-3.5"
                  />
                  <span>Create a collection for each first source subfolder</span>
                </label>
              </div>

              {collectionMode === 'new-collection' && (
                <div className="mt-2 rounded-md border border-surface-border bg-surface-base/50 p-2">
                  <div className="mb-1 text-[11px] text-slate-400">New collection name</div>
                  <input
                    value={newImportCollectionName}
                    onChange={(event) => setNewImportCollectionName(event.target.value)}
                    placeholder={defaultCollectionNameFromSource || 'Collection name'}
                    className="w-full rounded-md border border-surface-border bg-surface-base px-2 py-1 text-xs text-white placeholder-slate-500 focus:border-accent-primary/60 focus:outline-none"
                  />
                  {defaultCollectionNameFromSource && (
                    <div className="mt-1 text-[11px] text-slate-500">
                      Default from imported folder: {defaultCollectionNameFromSource}
                    </div>
                  )}
                </div>
              )}

              {collectionMode === 'split-by-folder' && (
                <div className="mt-2 rounded-md border border-surface-border bg-surface-base/50 p-2">
                  <div className="text-[11px] text-slate-400">
                    {sourceFolderSnapshot.firstSubfolders.length > 0
                      ? `Collections will be created for ${sourceFolderSnapshot.firstSubfolders.length} first-level subfolders.`
                      : 'No first-level subfolders detected; root files will use the imported folder name.'}
                  </div>
                  {visibleSourceSubfolders.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {visibleSourceSubfolders.map((name) => (
                        <span
                          key={`collection-preview-${name}`}
                          className="rounded border border-surface-border bg-surface-overlay/40 px-1.5 py-0.5 text-[11px] text-slate-200"
                        >
                          {name}
                        </span>
                      ))}
                      {hiddenSourceSubfolderCount > 0 && (
                        <span className="rounded border border-surface-border bg-surface-overlay/30 px-1.5 py-0.5 text-[11px] text-slate-500">
                          +{hiddenSourceSubfolderCount} more
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {collectionMode !== 'existing' && creationError && (
                <div className="mt-2 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 text-[11px] text-red-200">
                  {creationError}
                </div>
              )}
            </div>
          )}

          {sourceKind !== 'folder' || collectionMode === 'existing' ? (
            <div className="rounded-lg border border-surface-border bg-surface-overlay/20 p-3" data-tour="import-destination-tree">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs font-semibold text-white">Destination tree</div>
              <button
                type="button"
                onClick={() => {
                  setShowCreateCollection((open) => {
                    const next = !open
                    if (next) {
                      setNewCollectionName((current) => current.trim() || defaultCollectionNameFromSource)
                    }
                    return next
                  })
                  setCreationError(null)
                }}
                disabled={isSubmitting || isDestinationMutating}
                data-tour="import-destination-new-collection"
                className="inline-flex items-center gap-1 rounded-md border border-surface-border bg-surface-overlay px-2 py-1 text-[11px] text-slate-200 transition-colors hover:bg-surface-border disabled:opacity-50"
              >
                <Plus size={12} />
                New collection
              </button>
            </div>

            {showCreateCollection && (
              <div className="mb-2 flex items-center gap-2 rounded-md border border-surface-border bg-surface-base/60 p-2">
                <input
                  value={newCollectionName}
                  onChange={(event) => setNewCollectionName(event.target.value)}
                  placeholder="Collection name"
                  className="flex-1 rounded-md border border-surface-border bg-surface-base px-2 py-1 text-xs text-white placeholder-slate-500 focus:border-accent-primary/60 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => void handleCreateCollection()}
                  disabled={!newCollectionName.trim() || isSubmitting || isDestinationMutating}
                  className="rounded-md bg-accent-primary px-2 py-1 text-[11px] font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-50"
                >
                  {createCollection.isPending ? <Loader2 size={12} className="animate-spin" /> : 'Create'}
                </button>
              </div>
            )}

            {folderCreationTarget && (
              <div className="mb-2 rounded-md border border-surface-border bg-surface-base/60 p-2">
                <div className="mb-1 text-[11px] text-slate-400">
                  Creating folder in <span className="text-slate-200">{folderCreationTarget.label}</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    value={newFolderName}
                    onChange={(event) => setNewFolderName(event.target.value)}
                    placeholder="Folder name"
                    className="flex-1 rounded-md border border-surface-border bg-surface-base px-2 py-1 text-xs text-white placeholder-slate-500 focus:border-accent-primary/60 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => void handleCreateFolder()}
                    disabled={!newFolderName.trim() || isSubmitting || isDestinationMutating}
                    className="rounded-md bg-accent-primary px-2 py-1 text-[11px] font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-50"
                  >
                    {createFolder.isPending ? <Loader2 size={12} className="animate-spin" /> : 'Create'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setFolderCreationTarget(null)
                      setNewFolderName('')
                      setCreationError(null)
                    }}
                    disabled={isSubmitting || isDestinationMutating}
                    className="rounded-md border border-surface-border px-2 py-1 text-[11px] text-slate-300 transition-colors hover:bg-surface-overlay disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {creationError && (
              <div className="mb-2 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 text-[11px] text-red-200">
                {creationError}
              </div>
            )}

            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search collections or folders..."
                className="w-full rounded-lg border border-surface-border bg-surface-base px-8 py-2 text-sm text-white placeholder-slate-500 focus:border-accent-primary/60 focus:outline-none"
              />
            </div>

            {sourceKind === 'folder' && structureMode === 'preserve' && hasDestinationSelection && (
              <div className="mt-2 text-[11px] text-slate-400">
                {shouldRenderMergedTreePreview
                  ? 'Import preview is merged below. New folders are shown with dashed green rows.'
                  : 'No new subfolders are expected for this destination.'}
              </div>
            )}

            <div className="mt-2 max-h-52 space-y-2 overflow-y-auto rounded-lg border border-surface-border bg-surface-base/40 p-2 sm:max-h-64">
              <button
                type="button"
                onClick={() => {
                  setSelectedFolderId(null)
                  setSelectedCollectionId(null)
                }}
                className={`w-full rounded-md border px-2.5 py-2 text-left text-xs transition-colors ${
                  selectedFolderId === null && selectedCollectionId === null
                    ? 'border-accent-primary/60 bg-accent-primary/10 text-white'
                    : 'border-surface-border bg-surface-overlay/30 text-slate-300 hover:bg-surface-overlay'
                }`}
              >
                No destination (import only)
              </button>

              {isLoading ? (
                <div className="px-2 py-4 text-center text-xs text-slate-400">Loading collections and folders...</div>
              ) : !hasVisibleDestinations ? (
                <div className="space-y-2 px-2 py-4 text-center text-xs text-slate-400">
                  <div>
                    {hasAnyFolders
                      ? 'No collections or folders match your search.'
                      : 'No folders available yet. Create a collection and folder to assign imports.'}
                  </div>
                  {!hasAnyFolders && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowCreateCollection(true)
                        setCreationError(null)
                        setNewCollectionName((current) => current.trim() || defaultCollectionNameFromSource)
                      }}
                      disabled={isSubmitting || isDestinationMutating}
                      className="inline-flex items-center gap-1 rounded-md border border-surface-border bg-surface-overlay px-2 py-1 text-[11px] text-slate-200 transition-colors hover:bg-surface-border disabled:opacity-50"
                    >
                      <Plus size={12} />
                      Create collection
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  {visibleCollectionTrees.map(({ collection, tree }) => {
                    const previewNodesAtCollectionRoot =
                      shouldRenderMergedTreePreview && selectedCollectionId === collection.id
                        ? preservedStructurePreview.tree
                        : []
                    const hasRenderableTreeNodes = tree.length > 0 || previewNodesAtCollectionRoot.length > 0

                    return (
                      <div key={collection.id} className="rounded-md border border-surface-border/80 bg-surface-overlay/20 p-1.5">
                        <div className="mb-1 flex items-center gap-2 rounded-md bg-surface-overlay/40 px-2 py-1">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedCollectionId(collection.id)
                              setSelectedFolderId(null)
                            }}
                            className={`min-w-0 flex-1 rounded border px-1.5 py-1 text-left text-xs font-semibold transition-colors ${
                              selectedCollectionId === collection.id
                                ? 'border-accent-primary/60 bg-accent-primary/10 text-white'
                                : 'border-surface-border/70 text-slate-100 hover:bg-surface-overlay'
                            }`}
                            title={`Assign to ${collection.name}`}
                          >
                            <span className="inline-flex items-center gap-2">
                              <Layers3 size={12} className="text-sky-300" />
                              <span className="min-w-0 flex-1 truncate">{collection.name}</span>
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              startFolderCreation({
                                parentId: null,
                                collectionId: collection.id,
                                label: `${collection.name} (root)`,
                              })}
                            disabled={isSubmitting || isDestinationMutating}
                            className="inline-flex items-center justify-center rounded-md border border-surface-border bg-surface-overlay/40 p-1 text-slate-300 transition-colors hover:bg-surface-overlay hover:text-white disabled:opacity-50"
                            aria-label={`Create folder in ${collection.name}`}
                            title="Create folder in collection"
                          >
                            <FolderPlus size={12} />
                          </button>
                        </div>

                        {hasRenderableTreeNodes ? (
                          <div className="space-y-1">
                            {renderFolderNodes(tree, 1, previewNodesAtCollectionRoot, `collection-${collection.id}`)}
                          </div>
                        ) : (
                          <div className="px-2 py-1 text-[11px] text-slate-500">No folders yet.</div>
                        )}
                      </div>
                    )
                  })}

                  {visibleUngroupedTree.length > 0 && (
                    <div className="rounded-md border border-surface-border/80 bg-surface-overlay/20 p-1.5">
                      <div className="mb-1 flex items-center gap-2 rounded-md bg-surface-overlay/40 px-2 py-1">
                        <Layers3 size={12} className="text-slate-400" />
                        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-100">Ungrouped</span>
                        <button
                          type="button"
                          onClick={() =>
                            startFolderCreation({
                              parentId: null,
                              collectionId: null,
                              label: 'Ungrouped root',
                            })}
                          disabled={isSubmitting || isDestinationMutating}
                          className="inline-flex items-center justify-center rounded-md border border-surface-border bg-surface-overlay/40 p-1 text-slate-300 transition-colors hover:bg-surface-overlay hover:text-white disabled:opacity-50"
                          aria-label="Create ungrouped folder"
                          title="Create ungrouped folder"
                        >
                          <FolderPlus size={12} />
                        </button>
                      </div>
                      <div className="space-y-1">{renderFolderNodes(visibleUngroupedTree, 1, [], 'ungrouped')}</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          ) : (
            <div className="rounded-lg border border-surface-border bg-surface-overlay/20 p-3" data-tour="import-destination-tree">
              <div className="mb-1 text-xs font-semibold text-white">Destination preview</div>
              <div className="text-[11px] text-slate-400">
                Existing collections are ignored for this import mode. Collections will be created automatically after import.
              </div>

              <div className="mt-2 max-h-52 space-y-2 overflow-y-auto rounded-lg border border-surface-border bg-surface-base/40 p-2 sm:max-h-64">
                {collectionMode === 'new-collection' ? (
                  <div className="rounded-md border border-surface-border/80 bg-surface-overlay/20 p-1.5">
                    <div className="mb-1 flex items-center gap-2 rounded-md bg-surface-overlay/40 px-2 py-1">
                      <Layers3 size={12} className="text-sky-300" />
                      <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-100">{autoCollectionNamePreview}</span>
                      <span className="text-[10px] text-slate-400">
                        {importCount} {importCount === 1 ? 'file' : 'files'}
                      </span>
                      <span className="rounded border border-emerald-500/50 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-200">
                        New
                      </span>
                    </div>
                    <div className="space-y-1">
                      {renderFolderNodes(
                        [],
                        1,
                        structureMode === 'preserve'
                          ? autoCollectionPreservedPreview.tree
                          : [{ name: autoFlatDestinationFolderName, fileCount: importCount, children: [] }],
                        'auto-new-collection',
                      )}
                    </div>
                    {structureMode === 'preserve' && autoCollectionPreservedPreview.tree.length === 0 && (
                      <div className="px-2 py-1 text-[11px] text-slate-500">
                        {bypassParentFolder
                          ? 'No nested subfolders detected after bypassing the first source folder level.'
                          : 'No nested subfolders detected in selected source folders.'}
                      </div>
                    )}
                  </div>
                ) : splitCollectionPreviewGroups.length > 0 ? (
                  splitCollectionPreviewGroups.map((group) => (
                    <div key={`split-preview-${normalizeFolderName(group.collectionName)}`} className="rounded-md border border-surface-border/80 bg-surface-overlay/20 p-1.5">
                      <div className="mb-1 flex items-center gap-2 rounded-md bg-surface-overlay/40 px-2 py-1">
                        <Layers3 size={12} className="text-sky-300" />
                        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-100">{group.collectionName}</span>
                        <span className="text-[10px] text-slate-400">
                          {group.fileCount} {group.fileCount === 1 ? 'file' : 'files'}
                        </span>
                        <span className="rounded border border-emerald-500/50 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-200">
                          New
                        </span>
                      </div>
                      <div className="space-y-1">
                        {renderFolderNodes(
                          [],
                          1,
                          structureMode === 'preserve'
                            ? group.preservePreview.tree
                            : [{ name: autoFlatDestinationFolderName, fileCount: group.fileCount, children: [] }],
                          `auto-split-collection-${normalizeFolderName(group.collectionName)}`,
                        )}
                      </div>
                      {structureMode === 'preserve' && group.preservePreview.tree.length === 0 && (
                        <div className="px-2 py-1 text-[11px] text-slate-500">
                          No nested subfolders detected after split.
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="px-2 py-3 text-center text-xs text-slate-500">
                    No source folders found to split into collections.
                  </div>
                )}
              </div>
            </div>
          )}

          {selectedFolder && (
            <div className="rounded-md border border-accent-primary/30 bg-accent-primary/10 px-2.5 py-1.5 text-[11px] text-slate-200">
              Destination: <span className="text-white">{buildFolderPath(selectedFolder, folderMap)}</span>
            </div>
          )}
          {!selectedFolder && selectedCollection && (
            <div className="rounded-md border border-accent-primary/30 bg-accent-primary/10 px-2.5 py-1.5 text-[11px] text-slate-200">
              Destination collection: <span className="text-white">{selectedCollection.name}</span>
              <span className="ml-1 text-slate-300">
                {shouldAssignAtCollectionRoot
                  ? '(subfolders will be created directly in this collection)'
                  : '(a folder will be created automatically)'}
              </span>
            </div>
          )}

          {sourceKind === 'folder' && (
            <div className="rounded-lg border border-surface-border bg-surface-overlay/20 p-3" data-tour="import-folder-structure-handling">
              <div className="text-xs font-semibold text-white">Folder structure handling</div>
              <div className="mt-2 space-y-1.5">
                <label className="flex cursor-pointer items-center gap-2 rounded-md border border-surface-border bg-surface-overlay/30 px-2 py-1.5 text-xs text-slate-200 transition-colors hover:bg-surface-overlay">
                  <input
                    type="radio"
                    name="importDestinationStructureMode"
                    checked={structureMode === 'preserve'}
                    onChange={() => setStructureMode('preserve')}
                    className="h-3.5 w-3.5"
                  />
                  <span>Preserve source subfolders inside destination</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2 rounded-md border border-surface-border bg-surface-overlay/30 px-2 py-1.5 text-xs text-slate-200 transition-colors hover:bg-surface-overlay">
                  <input
                    type="radio"
                    name="importDestinationStructureMode"
                    checked={structureMode === 'flatten'}
                    onChange={() => setStructureMode('flatten')}
                    className="h-3.5 w-3.5"
                  />
                  <span>
                    {collectionMode === 'existing'
                      ? 'Flatten everything into the selected destination folder'
                      : 'Flatten everything inside each created collection'}
                  </span>
                </label>
              </div>
              {structureMode === 'preserve' && (
                <div className="mt-2 rounded-md border border-surface-border bg-surface-base/50 px-2 py-1.5">
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-200">
                    <input
                      type="checkbox"
                      checked={isBypassParentFolderDisabled ? false : bypassParentFolder}
                      disabled={isBypassParentFolderDisabled}
                      onChange={(event) => setBypassParentFolder(event.target.checked)}
                      className="h-3.5 w-3.5"
                    />
                    <span>Bypass first source folder level</span>
                  </label>
                  <div className="mt-1 text-[11px] text-slate-500">
                    {isBypassParentFolderDisabled
                      ? 'Disabled for this mode because each first source subfolder already becomes its own collection.'
                      : bypassParentFolder
                      ? 'Skip the selected parent folder and place its children directly under the destination.'
                      : 'Keep the full folder path, including the selected parent folder.'}
                  </div>
                </div>
              )}
              <div className="mt-1 text-[11px] text-slate-500">
                {hasAutoCollectionDestination
                  ? 'This setting will be applied while creating collections during import.'
                  : selectedFolderId === null && selectedCollectionId === null
                  ? 'Select a destination folder to apply this after import.'
                  : 'This setting only affects folder imports when assigning to a destination.'}
              </div>
            </div>
          )}

          {/*
          {sourceKind === 'folder' && (
            <div className="rounded-lg border border-surface-border bg-surface-overlay/20 p-3">
              <div className="text-xs font-semibold text-white">Import preview</div>
              <div className="mt-1 text-[11px] text-slate-500">
                Snapshot of source folders and expected destination result.
              </div>

              <div className="mt-2 rounded-md border border-surface-border bg-surface-base/50 px-2 py-1.5">
                <div className="text-[11px] text-slate-400">
                  Source roots:{' '}
                  {sourceFolderSnapshot.rootFolderNames.length > 0
                    ? sourceFolderSnapshot.rootFolderNames.slice(0, 3).join(', ')
                    : 'not detected'}
                </div>
                {visibleSourceSubfolders.length > 0 ? (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {visibleSourceSubfolders.map((name) => (
                      <span
                        key={name}
                        className="rounded border border-surface-border bg-surface-overlay/40 px-1.5 py-0.5 text-[11px] text-slate-200"
                      >
                        {name}
                      </span>
                    ))}
                    {hiddenSourceSubfolderCount > 0 && (
                      <span className="rounded border border-surface-border bg-surface-overlay/30 px-1.5 py-0.5 text-[11px] text-slate-500">
                        +{hiddenSourceSubfolderCount} more
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="mt-1 text-[11px] text-slate-500">No nested subfolders detected in selected files.</div>
                )}
              </div>

              {!hasDestinationSelection || !destinationPreviewLabel ? (
                <div className="mt-2 text-[11px] text-slate-500">
                  Select a destination folder or collection to preview the final imported layout.
                </div>
              ) : structureMode === 'flatten' ? (
                <div className="mt-2 rounded-md border border-surface-border bg-surface-base/50 px-2 py-1.5 text-[11px] text-slate-300">
                  <span className="text-slate-400">After import into </span>
                  <span className="text-white">{destinationPreviewLabel}</span>
                  <span className="text-slate-400">: all </span>
                  <span className="text-white">{previewFileCount}</span>
                  <span className="text-slate-400"> files go directly into that destination.</span>
                </div>
              ) : (
                <div className="mt-2 rounded-md border border-surface-border bg-surface-base/50 px-2 py-1.5">
                  <div className="text-[11px] text-slate-300">
                    <span className="text-slate-400">After import into </span>
                    <span className="text-white">{destinationPreviewLabel}</span>
                  </div>

                  {visibleFirstLevelPreviewFolders.length > 0 ? (
                    <div className="mt-1 text-[11px] text-slate-400">
                      First subfolders: {visibleFirstLevelPreviewFolders.join(', ')}
                      {hiddenFirstLevelPreviewFolderCount > 0 ? ` (+${hiddenFirstLevelPreviewFolderCount} more)` : ''}
                    </div>
                  ) : (
                    <div className="mt-1 text-[11px] text-slate-500">No new subfolders will be created.</div>
                  )}
                  <div className="mt-1 text-[11px] text-slate-500">
                    {shouldRenderMergedTreePreview
                      ? 'Preview folders are merged into the destination tree above.'
                      : 'No preview folders need to be added to the destination tree.'}
                  </div>

                  <div className="mt-1 text-[11px] text-slate-500">
                    {preservedStructurePreview.folderCount} {preservedStructurePreview.folderCount === 1 ? 'folder' : 'folders'} expected
                    {preservedStructurePreview.rootFileCount > 0
                      ? `, plus ${preservedStructurePreview.rootFileCount} ${preservedStructurePreview.rootFileCount === 1 ? 'file' : 'files'} directly in destination`
                      : ''}
                    .
                  </div>
                </div>
              )}

              {sourceFolderSnapshot.rootLevelFileCount > 0 && (
                <div className="mt-1 text-[11px] text-slate-500">
                  {sourceFolderSnapshot.rootLevelFileCount} {sourceFolderSnapshot.rootLevelFileCount === 1 ? 'file' : 'files'} already sit at the source root level.
                </div>
              )}
            </div>
          )}
          */}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-surface-border px-4 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="rounded-lg border border-surface-border bg-surface-overlay px-3 py-1.5 text-xs text-slate-300 transition-colors hover:bg-surface-border disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onConfirm({
                ...resolveChoice(null),
                collectionId: null,
                collectionMode: 'existing',
                newCollectionName: null,
              })
            }}
            disabled={isSubmitting || isDestinationMutating}
            className="rounded-lg border border-surface-border bg-surface-overlay px-3 py-1.5 text-xs text-slate-300 transition-colors hover:bg-surface-border disabled:opacity-50"
          >
            Import Only
          </button>
          <button
            type="button"
            data-tour="import-assign-button"
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              void handleConfirmAssign()
            }}
            disabled={isSubmitting || isDestinationMutating || !hasDestinationSelection}
            className="rounded-lg bg-accent-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-surface-overlay disabled:text-slate-500"
          >
            Import + Assign
          </button>
        </div>
      </div>
    </div>
  )
}
