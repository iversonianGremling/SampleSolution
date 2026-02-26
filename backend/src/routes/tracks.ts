import { Router } from 'express'
import { eq, inArray, isNull, isNotNull, and, sql } from 'drizzle-orm'
import fs from 'fs/promises'
import path from 'path'
import { db, schema } from '../db/index.js'
import { getVideoInfo, extractVideoId } from '../services/ytdlp.js'
import { processTrack } from '../services/processor.js'

const router = Router()
const DATA_DIR = process.env.DATA_DIR || './data'
const RESOLVED_DATA_DIR = path.resolve(DATA_DIR)

function isManagedDataPath(filePath: string): boolean {
  const resolved = path.resolve(filePath)
  return resolved === RESOLVED_DATA_DIR || resolved.startsWith(`${RESOLVED_DATA_DIR}${path.sep}`)
}

async function unlinkManagedPath(filePath: string | null | undefined): Promise<void> {
  if (!filePath) return
  if (!isManagedDataPath(filePath)) return
  await fs.unlink(filePath).catch(() => {})
}

// Types for source tree
interface YouTubeSourceNode {
  id: number
  title: string
  thumbnailUrl: string
  sliceCount: number
}

interface FolderNode {
  path: string
  name: string
  children: FolderNode[]
  sampleCount: number
}

interface SourceTree {
  youtube: YouTubeSourceNode[]
  local: { count: number }
  streaming: {
    soundcloud: { count: number; tracks: YouTubeSourceNode[] }
    spotify: { count: number; tracks: YouTubeSourceNode[] }
    bandcamp: { count: number; tracks: YouTubeSourceNode[] }
  }
  folders: FolderNode[]
}

interface FolderCountEntry {
  folderPath: string
  rootPath: string
  sampleCount: number
}

type StreamingProvider = 'soundcloud' | 'spotify' | 'bandcamp'

function detectStreamingProviderFromTrackKey(trackKey: string | null | undefined): StreamingProvider | null {
  if (!trackKey) return null
  const normalized = trackKey.trim().toLowerCase()
  if (!normalized) return null

  if (normalized.startsWith('sc_')) return 'soundcloud'
  if (normalized.startsWith('spotify_')) return 'spotify'
  if (normalized.startsWith('bandcamp_') || normalized.startsWith('bc_')) return 'bandcamp'

  return null
}

function normalizeSourcePathValue(value: string): string {
  return value
    .replace(/\\+/g, '/')
    .replace(/\/+/g, '/')
    .replace(/\/+$/, '')
}

function normalizeSourcePathIdentity(value: string): string {
  return normalizeSourcePathValue(value).toLowerCase()
}

function isPathInFolderScope(candidatePath: string | null, scopePath: string): boolean {
  if (!candidatePath) return false
  const normalizedCandidate = normalizeSourcePathIdentity(candidatePath)
  const normalizedScope = normalizeSourcePathIdentity(scopePath)
  if (!normalizedCandidate || !normalizedScope) return false
  return (
    normalizedCandidate === normalizedScope ||
    normalizedCandidate.startsWith(`${normalizedScope}/`)
  )
}

function deriveImportedFolderScope(rootPath: string, relativePath: string | null): string {
  const normalizedRoot = normalizeSourcePathValue(rootPath)
  if (!relativePath || !relativePath.trim()) {
    return normalizedRoot
  }

  const normalizedRelative = normalizeSourcePathValue(relativePath)
  if (!normalizedRelative) return normalizedRoot

  const relativeDir = path.posix.dirname(normalizedRelative)
  if (!relativeDir || relativeDir === '.') {
    return normalizedRoot
  }

  return normalizeSourcePathValue(path.posix.join(normalizedRoot, relativeDir))
}

function getImportedTrackFolderScopePath(
  folderPath: string | null,
  relativePath: string | null,
  originalPath: string | null
): string | null {
  if (!folderPath || !folderPath.trim()) return null
  const normalizedFolderPath = normalizeSourcePathValue(folderPath)
  if (!normalizedFolderPath) return null

  if (relativePath && relativePath.trim()) {
    const normalizedRelativePath = normalizeSourcePathValue(relativePath)
    if (normalizedRelativePath) {
      const relativeDir = path.posix.dirname(normalizedRelativePath)
      if (!relativeDir || relativeDir === '.') return normalizedFolderPath
      return normalizeSourcePathValue(path.posix.join(normalizedFolderPath, relativeDir))
    }
  }

  if (originalPath && originalPath.trim()) {
    const normalizedOriginal = normalizeSourcePathValue(originalPath)
    if (isPathInFolderScope(normalizedOriginal, normalizedFolderPath)) {
      const relativeToRoot = path.posix.relative(normalizedFolderPath, normalizedOriginal)
      if (relativeToRoot && relativeToRoot !== '.' && !relativeToRoot.startsWith('..')) {
        const relativeDir = path.posix.dirname(relativeToRoot)
        if (relativeDir && relativeDir !== '.') {
          return normalizeSourcePathValue(path.posix.join(normalizedFolderPath, relativeDir))
        }
      }
    }
  }

  return normalizedFolderPath
}

async function collectDirectoriesRecursively(rootPath: string): Promise<string[]> {
  const normalizedRoot = normalizeSourcePathValue(rootPath)
  if (!normalizedRoot) return []

  const collected = new Set<string>([normalizedRoot])

  async function walk(currentDir: string) {
    let entries: import('fs').Dirent[]
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const nextDir = path.join(currentDir, entry.name)
      const normalized = normalizeSourcePathValue(nextDir)
      if (!normalized || collected.has(normalized)) continue
      collected.add(normalized)
      await walk(nextDir)
    }
  }

  await walk(rootPath)
  return Array.from(collected)
}

// Helper function to build folder tree from imported folder roots + relative paths.
function buildFolderTree(folderEntries: FolderCountEntry[]): FolderNode[] {
  if (folderEntries.length === 0) return []

  const directCounts = new Map<string, number>()
  const allPaths = new Set<string>()
  const parentByPath = new Map<string, string | null>()

  const setParent = (childPath: string, parentPath: string | null) => {
    const existingParent = parentByPath.get(childPath)
    if (existingParent === undefined || (existingParent === null && parentPath !== null)) {
      parentByPath.set(childPath, parentPath)
    }
  }

  const registerChain = (folderPath: string, rootPath: string) => {
    let currentPath = folderPath
    const normalizedRoot = normalizeSourcePathValue(rootPath)

    while (true) {
      allPaths.add(currentPath)

      if (currentPath === normalizedRoot) {
        setParent(currentPath, null)
        break
      }

      const parentPath = normalizeSourcePathValue(path.posix.dirname(currentPath))
      if (!parentPath || parentPath === '.' || parentPath === currentPath) {
        setParent(currentPath, null)
        break
      }

      setParent(currentPath, parentPath)
      currentPath = parentPath
    }
  }

  for (const entry of folderEntries) {
    const normalizedFolderPath = normalizeSourcePathValue(entry.folderPath)
    const normalizedRootPath = normalizeSourcePathValue(entry.rootPath)

    if (!normalizedFolderPath || !normalizedRootPath) continue

    directCounts.set(
      normalizedFolderPath,
      (directCounts.get(normalizedFolderPath) || 0) + Number(entry.sampleCount || 0)
    )
    registerChain(normalizedFolderPath, normalizedRootPath)
  }

  const sortedPaths = Array.from(allPaths).sort((a, b) => {
    const depthA = a.split('/').length
    const depthB = b.split('/').length
    if (depthA !== depthB) return depthA - depthB
    return a.localeCompare(b)
  })

  const nodesByPath = new Map<string, FolderNode>()
  for (const folderPath of sortedPaths) {
    nodesByPath.set(folderPath, {
      path: folderPath,
      name: path.posix.basename(folderPath) || folderPath,
      children: [],
      sampleCount: directCounts.get(folderPath) || 0,
    })
  }

  const rootNodes: FolderNode[] = []
  for (const folderPath of sortedPaths) {
    const node = nodesByPath.get(folderPath)
    if (!node) continue

    const parentPath = parentByPath.get(folderPath) ?? null
    const parent = parentPath ? nodesByPath.get(parentPath) : undefined

    if (parent) {
      parent.children.push(node)
    } else {
      rootNodes.push(node)
    }
  }

  const sortChildren = (nodes: FolderNode[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name))
    for (const node of nodes) {
      if (node.children.length > 0) sortChildren(node.children)
    }
  }

  const aggregateCounts = (node: FolderNode): number => {
    let total = node.sampleCount
    for (const child of node.children) {
      total += aggregateCounts(child)
    }
    node.sampleCount = total
    return total
  }

  sortChildren(rootNodes)
  for (const root of rootNodes) {
    aggregateCounts(root)
  }

  return rootNodes
}

type TrackRow = typeof schema.tracks.$inferSelect

async function deleteTrackWithManagedAssets(track: TrackRow): Promise<void> {
  if (track.audioPath) {
    await unlinkManagedPath(track.audioPath)
  }
  if (track.peaksPath) {
    await unlinkManagedPath(track.peaksPath)
  }

  const trackSlices = await db
    .select()
    .from(schema.slices)
    .where(eq(schema.slices.trackId, track.id))

  for (const slice of trackSlices) {
    if (slice.filePath) {
      await unlinkManagedPath(slice.filePath)
    }
  }

  await db.delete(schema.tracks).where(eq(schema.tracks.id, track.id))
}

// GET /api/sources/tree - Returns hierarchical source tree
router.get('/sources/tree', async (_req, res) => {
  try {
    // Get YouTube tracks with slice counts
    const youtubeTracks = await db
      .select({
        id: schema.tracks.id,
        title: schema.tracks.title,
        thumbnailUrl: schema.tracks.thumbnailUrl,
      })
      .from(schema.tracks)
      .where(eq(schema.tracks.source, 'youtube'))
      .orderBy(schema.tracks.createdAt)

    // Get slice counts for each YouTube track
    const youtubeTrackIds = youtubeTracks.map(t => t.id)
    const sliceCounts = youtubeTrackIds.length > 0
      ? await db
          .select({
            trackId: schema.slices.trackId,
            count: sql<number>`count(*)`.as('count'),
          })
          .from(schema.slices)
          .where(inArray(schema.slices.trackId, youtubeTrackIds))
          .groupBy(schema.slices.trackId)
      : []

    const sliceCountMap = new Map(sliceCounts.map(s => [s.trackId, Number(s.count)]))

    const youtube: YouTubeSourceNode[] = youtubeTracks.map(t => ({
      id: t.id,
      title: t.title,
      thumbnailUrl: t.thumbnailUrl,
      sliceCount: sliceCountMap.get(t.id) || 0,
    }))

    // Get standalone local tracks (non-folder) and split them by provider.
    const localStandaloneTracks = await db
      .select({
        id: schema.tracks.id,
        title: schema.tracks.title,
        thumbnailUrl: schema.tracks.thumbnailUrl,
        trackKey: schema.tracks.youtubeId,
      })
      .from(schema.tracks)
      .where(and(
        eq(schema.tracks.source, 'local'),
        isNull(schema.tracks.folderPath)
      ))
      .orderBy(schema.tracks.createdAt)

    const localStandaloneTrackIds = localStandaloneTracks.map((track) => track.id)
    const localStandaloneSliceCounts = localStandaloneTrackIds.length > 0
      ? await db
          .select({
            trackId: schema.slices.trackId,
            count: sql<number>`count(*)`.as('count'),
          })
          .from(schema.slices)
          .where(inArray(schema.slices.trackId, localStandaloneTrackIds))
          .groupBy(schema.slices.trackId)
      : []
    const localStandaloneSliceCountMap = new Map(
      localStandaloneSliceCounts.map((row) => [row.trackId, Number(row.count)]),
    )

    const streaming: SourceTree['streaming'] = {
      soundcloud: { count: 0, tracks: [] },
      spotify: { count: 0, tracks: [] },
      bandcamp: { count: 0, tracks: [] },
    }
    let localCount = 0

    for (const track of localStandaloneTracks) {
      const sliceCount = localStandaloneSliceCountMap.get(track.id) || 0
      const provider = detectStreamingProviderFromTrackKey(track.trackKey)
      if (provider) {
        if (sliceCount > 0) {
          streaming[provider].count += sliceCount
          streaming[provider].tracks.push({
            id: track.id,
            title: track.title,
            thumbnailUrl: track.thumbnailUrl,
            sliceCount,
          })
        }
      } else {
        localCount += sliceCount
      }
    }

    // Get imported folder paths with sample counts.
    // Group by both root folder path and relative path so nested folder structure is preserved.
    const folderResults = await db
      .select({
        folderPath: schema.tracks.folderPath,
        relativePath: schema.tracks.relativePath,
        count: sql<number>`count(*)`.as('count'),
      })
      .from(schema.slices)
      .innerJoin(schema.tracks, eq(schema.slices.trackId, schema.tracks.id))
      .where(and(
        eq(schema.tracks.source, 'local'),
        isNotNull(schema.tracks.folderPath)
      ))
      .groupBy(schema.tracks.folderPath, schema.tracks.relativePath)

    const folderEntries: FolderCountEntry[] = []
    const importedRootPaths = new Set<string>()
    for (const row of folderResults) {
      if (row.folderPath) {
        const rootPath = normalizeSourcePathValue(row.folderPath)
        if (!rootPath) continue
        importedRootPaths.add(rootPath)
        const folderPath = deriveImportedFolderScope(rootPath, row.relativePath ?? null)
        folderEntries.push({
          folderPath,
          rootPath,
          sampleCount: Number(row.count),
        })
      }
    }

    // Include on-disk directory structure under imported roots so empty folders
    // are visible in Sources and newly-created folders appear immediately.
    for (const rootPath of importedRootPaths) {
      if (!path.isAbsolute(rootPath)) continue
      const directories = await collectDirectoriesRecursively(rootPath)
      for (const directoryPath of directories) {
        folderEntries.push({
          folderPath: directoryPath,
          rootPath,
          sampleCount: 0,
        })
      }
    }

    const folders = buildFolderTree(folderEntries)

    const tree: SourceTree = {
      youtube,
      local: { count: localCount },
      streaming,
      folders,
    }

    res.json(tree)
  } catch (error) {
    console.error('Error fetching sources tree:', error)
    res.status(500).json({ error: 'Failed to fetch sources tree' })
  }
})

// DELETE /api/sources - Delete tracks/slices for a source scope
router.delete('/sources', async (req, res) => {
  const scopeRaw = req.body?.scope ?? req.query?.scope
  const scope = typeof scopeRaw === 'string' ? scopeRaw.trim() : ''

  if (!scope) {
    return res.status(400).json({ error: 'scope required' })
  }

  try {
    let tracksToDelete: TrackRow[] = []

    if (scope === 'youtube') {
      tracksToDelete = await db
        .select()
        .from(schema.tracks)
        .where(eq(schema.tracks.source, 'youtube'))
    } else if (scope.startsWith('youtube:')) {
      const youtubeScopeValue = scope.slice('youtube:'.length).trim()
      if (!youtubeScopeValue) {
        return res.status(400).json({ error: 'Invalid youtube scope' })
      }

      const parsedTrackId = Number.parseInt(youtubeScopeValue, 10)
      if (Number.isInteger(parsedTrackId) && String(parsedTrackId) === youtubeScopeValue) {
        tracksToDelete = await db
          .select()
          .from(schema.tracks)
          .where(eq(schema.tracks.id, parsedTrackId))
          .limit(1)
      } else {
        tracksToDelete = await db
          .select()
          .from(schema.tracks)
          .where(eq(schema.tracks.youtubeId, youtubeScopeValue))
          .limit(1)
      }
    } else if (scope === 'local') {
      tracksToDelete = await db
        .select()
        .from(schema.tracks)
        .where(and(
          eq(schema.tracks.source, 'local'),
          isNull(schema.tracks.folderPath)
        ))
    } else if (scope === 'soundcloud' || scope === 'spotify' || scope === 'bandcamp') {
      const providerCondition =
        scope === 'soundcloud'
          ? sql`${schema.tracks.youtubeId} GLOB 'sc_*'`
          : scope === 'spotify'
          ? sql`${schema.tracks.youtubeId} GLOB 'spotify_*'`
          : sql`(${schema.tracks.youtubeId} GLOB 'bandcamp_*' OR ${schema.tracks.youtubeId} GLOB 'bc_*')`

      tracksToDelete = await db
        .select()
        .from(schema.tracks)
        .where(and(
          eq(schema.tracks.source, 'local'),
          isNull(schema.tracks.folderPath),
          providerCondition
        ))
    } else if (scope.startsWith('folder:')) {
      const folderScopeValue = normalizeSourcePathValue(scope.slice('folder:'.length).trim())
      if (!folderScopeValue) {
        return res.status(400).json({ error: 'Invalid folder scope' })
      }

      const importedFolderTracks = await db
        .select()
        .from(schema.tracks)
        .where(and(
          eq(schema.tracks.source, 'local'),
          isNotNull(schema.tracks.folderPath)
        ))

      tracksToDelete = importedFolderTracks.filter((track) => {
        const trackFolderScopePath = getImportedTrackFolderScopePath(
          track.folderPath,
          track.relativePath,
          track.originalPath
        )
        return isPathInFolderScope(trackFolderScopePath, folderScopeValue)
      })
    } else {
      return res.status(400).json({ error: `Unsupported source scope: ${scope}` })
    }

    for (const track of tracksToDelete) {
      await deleteTrackWithManagedAssets(track)
    }

    res.json({
      success: true,
      scope,
      deletedTracks: tracksToDelete.length,
    })
  } catch (error) {
    console.error('Error deleting source scope:', error)
    res.status(500).json({ error: 'Failed to delete source' })
  }
})

// Get all tracks with their tags
router.get('/', async (req, res) => {
  try {
    const tracks = await db.select().from(schema.tracks).orderBy(schema.tracks.createdAt)

    // Get tags for each track
    const trackIds = tracks.map((t) => t.id)
    const trackTagsResult =
      trackIds.length > 0
        ? await db
            .select()
            .from(schema.trackTags)
            .innerJoin(schema.tags, eq(schema.trackTags.tagId, schema.tags.id))
            .where(inArray(schema.trackTags.trackId, trackIds))
        : []

    const tagsByTrack = new Map<number, typeof schema.tags.$inferSelect[]>()
    for (const row of trackTagsResult) {
      const trackId = row.track_tags.trackId
      if (!tagsByTrack.has(trackId)) {
        tagsByTrack.set(trackId, [])
      }
      tagsByTrack.get(trackId)!.push(row.tags)
    }

    const result = tracks.map((track) => ({
      ...track,
      tags: tagsByTrack.get(track.id) || [],
    }))

    res.json(result)
  } catch (error) {
    console.error('Error fetching tracks:', error)
    res.status(500).json({ error: 'Failed to fetch tracks' })
  }
})

// Add tracks by URLs
router.post('/', async (req, res) => {
  const { urls } = req.body as { urls: string[] }

  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'URLs array required' })
  }

  const success: string[] = []
  const failed: { url: string; error: string }[] = []

  for (const url of urls) {
    try {
      const videoId = extractVideoId(url)
      if (!videoId) {
        failed.push({ url, error: 'Invalid YouTube URL or video ID' })
        continue
      }

      // Check if already exists
      const existing = await db
        .select()
        .from(schema.tracks)
        .where(eq(schema.tracks.youtubeId, videoId))
        .limit(1)

      if (existing.length > 0) {
        success.push(videoId) // Already exists, count as success
        continue
      }

      // Get video info
      const info = await getVideoInfo(videoId)

      // Insert track
      await db.insert(schema.tracks).values({
        youtubeId: videoId,
        title: info.title,
        description: info.description,
        thumbnailUrl: info.thumbnailUrl,
        duration: info.duration,
        status: 'pending',
        createdAt: new Date().toISOString(),
      })

      success.push(videoId)

      // Start download in background
      processTrack(videoId).catch((err) => {
        console.error(`Failed to process track ${videoId}:`, err)
      })
    } catch (error) {
      failed.push({ url, error: String(error) })
    }
  }

  res.json({ success, failed })
})

// Update track
router.put('/:id', async (req, res) => {
  const id = parseInt(req.params.id)
  const {
    title,
    artist,
    album,
    year,
    albumArtist,
    genre,
    composer,
    trackNumber,
    discNumber,
    trackComment,
    musicalKey,
    tagBpm,
    isrc,
    metadataRaw,
  } = req.body as {
    title?: string
    artist?: string | null
    album?: string | null
    year?: number | null
    albumArtist?: string | null
    genre?: string | null
    composer?: string | null
    trackNumber?: number | null
    discNumber?: number | null
    trackComment?: string | null
    musicalKey?: string | null
    tagBpm?: number | null
    isrc?: string | null
    metadataRaw?: string | null
  }

  try {
    const track = await db
      .select()
      .from(schema.tracks)
      .where(eq(schema.tracks.id, id))
      .limit(1)

    if (track.length === 0) {
      return res.status(404).json({ error: 'Track not found' })
    }

    const updates: Partial<typeof schema.tracks.$inferSelect> = {}
    if (title !== undefined) updates.title = title
    if (artist !== undefined) updates.artist = artist
    if (album !== undefined) updates.album = album
    if (year !== undefined) updates.year = year
    if (albumArtist !== undefined) updates.albumArtist = albumArtist
    if (genre !== undefined) updates.genre = genre
    if (composer !== undefined) updates.composer = composer
    if (trackNumber !== undefined) updates.trackNumber = trackNumber
    if (discNumber !== undefined) updates.discNumber = discNumber
    if (trackComment !== undefined) updates.trackComment = trackComment
    if (musicalKey !== undefined) updates.musicalKey = musicalKey
    if (tagBpm !== undefined) updates.tagBpm = tagBpm
    if (isrc !== undefined) updates.isrc = isrc
    if (metadataRaw !== undefined) updates.metadataRaw = metadataRaw

    const [updated] = await db
      .update(schema.tracks)
      .set(updates)
      .where(eq(schema.tracks.id, id))
      .returning()

    res.json(updated)
  } catch (error) {
    console.error('Error updating track:', error)
    res.status(500).json({ error: 'Failed to update track' })
  }
})

// Delete track
router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id)

  try {
    const track = await db
      .select()
      .from(schema.tracks)
      .where(eq(schema.tracks.id, id))
      .limit(1)

    if (track.length === 0) {
      return res.status(404).json({ error: 'Track not found' })
    }

    await deleteTrackWithManagedAssets(track[0])

    res.json({ success: true })
  } catch (error) {
    console.error('Error deleting track:', error)
    res.status(500).json({ error: 'Failed to delete track' })
  }
})

// Stream audio file
router.get('/:id/audio', async (req, res) => {
  const id = parseInt(req.params.id)

  try {
    const track = await db
      .select()
      .from(schema.tracks)
      .where(eq(schema.tracks.id, id))
      .limit(1)

    if (track.length === 0 || !track[0].audioPath) {
      return res.status(404).json({ error: 'Audio not found' })
    }

    res.sendFile(path.resolve(track[0].audioPath))
  } catch (error) {
    console.error('Error streaming audio:', error)
    res.status(500).json({ error: 'Failed to stream audio' })
  }
})

// Get waveform peaks
router.get('/:id/peaks', async (req, res) => {
  const id = parseInt(req.params.id)

  try {
    const track = await db
      .select()
      .from(schema.tracks)
      .where(eq(schema.tracks.id, id))
      .limit(1)

    if (track.length === 0 || !track[0].peaksPath) {
      return res.status(404).json({ error: 'Peaks not found' })
    }

    const peaks = JSON.parse(await fs.readFile(track[0].peaksPath, 'utf-8'))
    res.json(peaks)
  } catch (error) {
    console.error('Error fetching peaks:', error)
    res.status(500).json({ error: 'Failed to fetch peaks' })
  }
})

export default router
