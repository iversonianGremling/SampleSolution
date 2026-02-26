import type { Folder } from '../types'

type FileWithRelativePath = File & {
  webkitRelativePath?: string
}

export type ImportStructureMode = 'flatten' | 'preserve'

export interface SuccessfulLocalImport {
  sliceId: number
  file: File
}

export interface DestinationFolderRef {
  id: number
  name?: string
  collectionId: number | null
  parentId?: number | null
}

export interface PreserveImportStructureOptions {
  destinationFolder?: DestinationFolderRef | null
  destinationCollectionId?: number | null
  successfulImports: SuccessfulLocalImport[]
  existingFolders: Folder[]
  createFolder: (data: { name: string; parentId?: number; collectionId?: number }) => Promise<Folder>
  assignSlicesToFolder: (folderId: number, sliceIds: number[]) => Promise<unknown>
  bypassParentFolder?: boolean
}

export interface PreserveImportStructureResult {
  assignedCount: number
  createdFolderCount: number
}

interface FolderReference {
  id: number
  name: string
  parentId: number | null
  collectionId: number | null
}

function normalizeFolderLookupKey(name: string): string {
  return name.trim().toLowerCase()
}

function resolveNestedDirectorySegments(file: File, bypassParentFolder: boolean): string[] {
  const relativePath = (file as FileWithRelativePath).webkitRelativePath
  if (!relativePath || !relativePath.includes('/')) return []

  const parts = relativePath
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)

  if (parts.length < 2) return []

  const startIndex = bypassParentFolder ? 1 : 0
  if (startIndex >= parts.length - 1) return []

  return parts
    .slice(startIndex, -1)
    .filter((segment) => segment !== '.' && segment !== '..')
}

export async function assignImportsPreservingStructure({
  destinationFolder,
  destinationCollectionId,
  successfulImports,
  existingFolders,
  createFolder,
  assignSlicesToFolder,
  bypassParentFolder = false,
}: PreserveImportStructureOptions): Promise<PreserveImportStructureResult> {
  if (!destinationFolder && destinationCollectionId === undefined) {
    throw new Error('A destination folder or destination collection is required to preserve structure.')
  }

  const foldersById = new Map<number, FolderReference>()
  const childrenByParentId = new Map<number, Map<string, FolderReference>>()
  const rootChildrenByCollectionId = new Map<string, Map<string, FolderReference>>()
  let createdFolderCount = 0
  const rootCollectionKey = (collectionId: number | null) => `root:${collectionId === null ? 'ungrouped' : collectionId}`

  const registerFolder = (folder: FolderReference) => {
    foldersById.set(folder.id, folder)
    if (folder.parentId === null) {
      const collectionKey = rootCollectionKey(folder.collectionId)
      let roots = rootChildrenByCollectionId.get(collectionKey)
      if (!roots) {
        roots = new Map<string, FolderReference>()
        rootChildrenByCollectionId.set(collectionKey, roots)
      }

      const lookupKey = normalizeFolderLookupKey(folder.name)
      if (!roots.has(lookupKey)) {
        roots.set(lookupKey, folder)
      }
      return
    }

    let children = childrenByParentId.get(folder.parentId)
    if (!children) {
      children = new Map<string, FolderReference>()
      childrenByParentId.set(folder.parentId, children)
    }

    const lookupKey = normalizeFolderLookupKey(folder.name)
    if (!children.has(lookupKey)) {
      children.set(lookupKey, folder)
    }
  }

  for (const folder of existingFolders) {
    registerFolder({
      id: folder.id,
      name: folder.name,
      parentId: folder.parentId,
      collectionId: folder.collectionId,
    })
  }

  if (destinationFolder && !foldersById.has(destinationFolder.id)) {
    registerFolder({
      id: destinationFolder.id,
      name: destinationFolder.name ?? `Folder ${destinationFolder.id}`,
      parentId: destinationFolder.parentId ?? null,
      collectionId: destinationFolder.collectionId ?? null,
    })
  }

  const rootCollectionId = destinationFolder?.collectionId ?? destinationCollectionId ?? null

  const ensureChildFolder = async (
    parentId: number | null,
    collectionId: number | null,
    childName: string,
  ): Promise<number> => {
    const normalizedName = normalizeFolderLookupKey(childName)
    if (!normalizedName) {
      if (parentId !== null) return parentId
      throw new Error('Cannot create folder with empty name at collection root.')
    }

    if (parentId === null) {
      const collectionKey = rootCollectionKey(collectionId)
      let roots = rootChildrenByCollectionId.get(collectionKey)
      if (!roots) {
        roots = new Map<string, FolderReference>()
        rootChildrenByCollectionId.set(collectionKey, roots)
      }

      const existing = roots.get(normalizedName)
      if (existing) return existing.id

      const createdFolder = await createFolder({
        name: childName.trim(),
        collectionId: collectionId ?? undefined,
      })

      const createdReference: FolderReference = {
        id: createdFolder.id,
        name: createdFolder.name,
        parentId: createdFolder.parentId ?? null,
        collectionId: createdFolder.collectionId ?? collectionId,
      }
      registerFolder(createdReference)
      roots.set(normalizedName, createdReference)
      createdFolderCount += 1
      return createdReference.id
    }

    let children = childrenByParentId.get(parentId)
    if (!children) {
      children = new Map<string, FolderReference>()
      childrenByParentId.set(parentId, children)
    }

    const existing = children.get(normalizedName)
    if (existing) return existing.id

    const parentFolder = foldersById.get(parentId)
    const resolvedCollectionId = parentFolder?.collectionId ?? collectionId ?? null

    const createdFolder = await createFolder({
      name: childName.trim(),
      parentId,
      collectionId: resolvedCollectionId ?? undefined,
    })

    const createdReference: FolderReference = {
      id: createdFolder.id,
      name: createdFolder.name,
      parentId: createdFolder.parentId ?? parentId,
      collectionId: createdFolder.collectionId ?? resolvedCollectionId,
    }
    registerFolder(createdReference)
    children.set(normalizedName, createdReference)
    createdFolderCount += 1

    return createdReference.id
  }

  const sliceIdsByFolder = new Map<number, number[]>()
  for (const imported of successfulImports) {
    const directorySegments = resolveNestedDirectorySegments(imported.file, bypassParentFolder)
    let targetFolderId = destinationFolder?.id ?? null

    for (const segment of directorySegments) {
      targetFolderId = await ensureChildFolder(targetFolderId, rootCollectionId, segment)
    }

    if (targetFolderId === null) {
      targetFolderId = await ensureChildFolder(null, rootCollectionId, 'Imported Files')
    }

    const list = sliceIdsByFolder.get(targetFolderId) || []
    list.push(imported.sliceId)
    sliceIdsByFolder.set(targetFolderId, list)
  }

  let assignedCount = 0
  for (const [folderId, sliceIds] of sliceIdsByFolder) {
    if (sliceIds.length === 0) continue
    await assignSlicesToFolder(folderId, sliceIds)
    assignedCount += sliceIds.length
  }

  return {
    assignedCount,
    createdFolderCount,
  }
}
