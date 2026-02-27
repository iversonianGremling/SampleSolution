import type { SuccessfulLocalImport } from './importStructure'

type FileWithRelativePath = File & {
  webkitRelativePath?: string
}

const SYNTHETIC_IMPORT_ROOT = '__import_root__'
const FALLBACK_COLLECTION_NAME = 'Imported Files'

function normalizeName(value: string): string {
  return value.trim().toLowerCase()
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

function withRelativePath(file: File, relativePath: string): File {
  const localFile = file as FileWithRelativePath
  if (localFile.webkitRelativePath === relativePath) return localFile

  try {
    Object.defineProperty(localFile, 'webkitRelativePath', {
      value: relativePath,
      configurable: true,
    })
  } catch {
    localFile.webkitRelativePath = relativePath
  }

  return localFile
}

export function getDefaultCollectionNameForFolderImport(files: File[]): string | null {
  const roots = new Map<string, string>()

  for (const file of files) {
    const segments = resolveFilePathSegments(file)
    if (segments.length < 2) continue
    const rootName = segments[0]
    const key = normalizeName(rootName)
    if (!key || roots.has(key)) continue
    roots.set(key, rootName)
  }

  if (roots.size === 0) return null
  return Array.from(roots.values()).sort((a, b) => a.localeCompare(b))[0]
}

export interface CollectionSubdivisionGroup {
  collectionName: string
  originalImports: SuccessfulLocalImport[]
  preserveReadyImports: SuccessfulLocalImport[]
}

export function buildCollectionSubdivisionGroups(
  successfulImports: SuccessfulLocalImport[],
): CollectionSubdivisionGroup[] {
  const grouped = new Map<string, CollectionSubdivisionGroup>()

  for (const imported of successfulImports) {
    const segments = resolveFilePathSegments(imported.file)
    const fileName = segments[segments.length - 1] || imported.file.name
    const rootName = segments.length >= 2 ? segments[0] : null
    const firstSubfolderName = segments.length >= 3 ? segments[1] : null
    const collectionName = (firstSubfolderName || rootName || FALLBACK_COLLECTION_NAME).trim() || FALLBACK_COLLECTION_NAME
    const key = normalizeName(collectionName)

    const remainingDirectories = firstSubfolderName ? segments.slice(2, -1) : []
    const syntheticRelativePath = [SYNTHETIC_IMPORT_ROOT, ...remainingDirectories, fileName].join('/')
    const preserveReadyFile = withRelativePath(imported.file, syntheticRelativePath)

    const existing = grouped.get(key)
    if (existing) {
      existing.originalImports.push(imported)
      existing.preserveReadyImports.push({ sliceId: imported.sliceId, file: preserveReadyFile })
      continue
    }

    grouped.set(key, {
      collectionName,
      originalImports: [imported],
      preserveReadyImports: [{ sliceId: imported.sliceId, file: preserveReadyFile }],
    })
  }

  return Array.from(grouped.values()).sort((a, b) => a.collectionName.localeCompare(b.collectionName))
}
