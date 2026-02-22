import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import { resetDatabase, TEST_DATA_DIR, getAppDb } from './setup.js'
import { createTestTrack, createTestTrackWithAudio } from './helpers.js'

// Mock yt-dlp service to avoid actual YouTube calls
vi.mock('../src/services/ytdlp.js', () => ({
  getVideoInfo: vi.fn().mockResolvedValue({
    videoId: 'dQw4w9WgXcQ',
    title: 'Test Video',
    description: 'Test description',
    thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    channelTitle: 'Test Channel',
    duration: 213,
  }),
  downloadAudio: vi.fn().mockResolvedValue('/tmp/test.mp3'),
  extractVideoId: vi.fn().mockImplementation((input: string) => {
    const match = input.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/)
    return match ? match[1] : input.length === 11 ? input : null
  }),
  extractPlaylistId: vi.fn().mockReturnValue(null),
}))

// Mock processor to avoid actual downloads
vi.mock('../src/services/processor.js', () => ({
  processTrack: vi.fn().mockResolvedValue(undefined),
}))

describe('Tracks API', () => {
  let app: any

  beforeEach(async () => {
    // Clear module cache to get fresh imports
    vi.resetModules()

    // Reset database
    resetDatabase()

    // Re-import app to get fresh database connection
    const { createApp } = await import('../src/app.js')
    app = createApp({ dataDir: TEST_DATA_DIR })
  })

  describe('GET /api/tracks', () => {
    it('returns empty array when no tracks exist', async () => {
      const res = await request(app).get('/api/tracks')

      expect(res.status).toBe(200)
      expect(res.body).toEqual([])
    })

    it('returns all tracks with tags', async () => {
      await createTestTrack(app, { title: 'Track 1' })
      await createTestTrack(app, { title: 'Track 2', youtubeId: 'video2' })

      const res = await request(app).get('/api/tracks')

      expect(res.status).toBe(200)
      expect(res.body).toHaveLength(2)
      expect(res.body[0]).toHaveProperty('title', 'Track 1')
      expect(res.body[0]).toHaveProperty('tags')
      expect(res.body[1]).toHaveProperty('title', 'Track 2')
    })
  })

  describe('GET /api/sources/tree', () => {
    it('builds imported folder nodes from nested relative paths', async () => {
      const db = await getAppDb()
      const now = new Date().toISOString()
      const rootPath = '/library/drums'

      const insertTrack = db.prepare(`
        INSERT INTO tracks (
          youtube_id, title, description, thumbnail_url, duration, status, source, folder_path, relative_path, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      const insertSlice = db.prepare(`
        INSERT INTO slices (track_id, name, start_time, end_time, created_at)
        VALUES (?, ?, ?, ?, ?)
      `)

      const trackKick = insertTrack.run(
        `local-tree-kick-${Date.now()}`,
        'Kick source',
        '',
        '',
        1,
        'ready',
        'local',
        rootPath,
        'electronic/kicks/kick.wav',
        now
      )
      insertSlice.run(trackKick.lastInsertRowid as number, 'Kick', 0, 1, now)

      const trackSnare = insertTrack.run(
        `local-tree-snare-${Date.now()}`,
        'Snare source',
        '',
        '',
        1,
        'ready',
        'local',
        rootPath,
        'electronic/snares/snare.wav',
        now
      )
      insertSlice.run(trackSnare.lastInsertRowid as number, 'Snare', 0, 1, now)

      const trackHihat = insertTrack.run(
        `local-tree-hihat-${Date.now()}`,
        'Hihat source',
        '',
        '',
        1,
        'ready',
        'local',
        rootPath,
        'acoustic/hihat.wav',
        now
      )
      insertSlice.run(trackHihat.lastInsertRowid as number, 'Hihat', 0, 1, now)

      const findNodeByPath = (
        nodes: Array<{ path: string; sampleCount: number; children: any[] }>,
        expectedPath: string
      ): { path: string; sampleCount: number; children: any[] } | undefined => {
        for (const node of nodes) {
          if (node.path === expectedPath) return node
          const childMatch = findNodeByPath(node.children || [], expectedPath)
          if (childMatch) return childMatch
        }
        return undefined
      }

      const res = await request(app).get('/api/sources/tree')

      expect(res.status).toBe(200)
      const rootNode = findNodeByPath(res.body.folders, '/library/drums')
      const electronicNode = findNodeByPath(res.body.folders, '/library/drums/electronic')
      const kicksNode = findNodeByPath(res.body.folders, '/library/drums/electronic/kicks')
      const snaresNode = findNodeByPath(res.body.folders, '/library/drums/electronic/snares')
      const acousticNode = findNodeByPath(res.body.folders, '/library/drums/acoustic')

      expect(rootNode).toBeTruthy()
      expect(rootNode?.sampleCount).toBe(3)
      expect(electronicNode?.sampleCount).toBe(2)
      expect(kicksNode?.sampleCount).toBe(1)
      expect(snaresNode?.sampleCount).toBe(1)
      expect(acousticNode?.sampleCount).toBe(1)
    })
  })

  describe('DELETE /api/sources', () => {
    it('deletes one YouTube source by track id scope', async () => {
      const trackA = await createTestTrack(app, { youtubeId: 'yt-delete-a1', title: 'Delete A' })
      const trackB = await createTestTrack(app, { youtubeId: 'yt-delete-b1', title: 'Keep B' })
      const db = await getAppDb()
      const now = new Date().toISOString()

      db.prepare(`
        INSERT INTO slices (track_id, name, start_time, end_time, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(trackA.id, 'Slice A', 0, 1, now)

      const res = await request(app)
        .delete('/api/sources')
        .send({ scope: `youtube:${trackA.id}` })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.deletedTracks).toBe(1)

      const remainingTracks = db.prepare('SELECT id FROM tracks ORDER BY id').all() as Array<{ id: number }>
      expect(remainingTracks.map((row) => row.id)).toEqual([trackB.id])
    })

    it('deletes only local non-folder sources for local scope', async () => {
      const db = await getAppDb()
      const now = new Date().toISOString()
      const insertTrack = db.prepare(`
        INSERT INTO tracks (
          youtube_id, title, description, thumbnail_url, duration, status, source, folder_path, relative_path, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)

      const localStandalone = insertTrack.run(
        `local-standalone-${Date.now()}`,
        'Local Standalone',
        '',
        '',
        1,
        'ready',
        'local',
        null,
        null,
        now
      )
      insertTrack.run(
        `local-folder-${Date.now()}`,
        'Local Folder',
        '',
        '',
        1,
        'ready',
        'local',
        '/library/drums',
        'kick.wav',
        now
      )
      insertTrack.run(
        `yt-${Date.now()}`,
        'YouTube',
        '',
        '',
        1,
        'ready',
        'youtube',
        null,
        null,
        now
      )

      const res = await request(app)
        .delete('/api/sources')
        .send({ scope: 'local' })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.deletedTracks).toBe(1)

      const deletedId = Number(localStandalone.lastInsertRowid)
      const deletedTrack = db.prepare('SELECT id FROM tracks WHERE id = ?').get(deletedId) as { id: number } | undefined
      expect(deletedTrack).toBeUndefined()
    })

    it('accepts scope from query string when delete request body is missing', async () => {
      const db = await getAppDb()
      const now = new Date().toISOString()
      const insertTrack = db.prepare(`
        INSERT INTO tracks (
          youtube_id, title, description, thumbnail_url, duration, status, source, folder_path, relative_path, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)

      const localStandalone = insertTrack.run(
        `local-query-${Date.now()}`,
        'Local Query',
        '',
        '',
        1,
        'ready',
        'local',
        null,
        null,
        now
      )

      const res = await request(app).delete('/api/sources?scope=local')

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.deletedTracks).toBe(1)

      const deletedId = Number(localStandalone.lastInsertRowid)
      const deletedTrack = db.prepare('SELECT id FROM tracks WHERE id = ?').get(deletedId) as { id: number } | undefined
      expect(deletedTrack).toBeUndefined()
    })

    it('deletes imported folder sources recursively by folder scope', async () => {
      const db = await getAppDb()
      const now = new Date().toISOString()
      const insertTrack = db.prepare(`
        INSERT INTO tracks (
          youtube_id, title, description, thumbnail_url, duration, status, source, folder_path, relative_path, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)

      insertTrack.run(
        `local-electronic-${Date.now()}`,
        'Electronic Kick',
        '',
        '',
        1,
        'ready',
        'local',
        '/library/drums',
        'electronic/kicks/kick.wav',
        now
      )
      insertTrack.run(
        `local-acoustic-${Date.now()}`,
        'Acoustic Snare',
        '',
        '',
        1,
        'ready',
        'local',
        '/library/drums',
        'acoustic/snare.wav',
        now
      )
      insertTrack.run(
        `local-other-${Date.now()}`,
        'Other Folder',
        '',
        '',
        1,
        'ready',
        'local',
        '/library/bass',
        'subs/sub.wav',
        now
      )

      const res = await request(app)
        .delete('/api/sources')
        .send({ scope: 'folder:/library/drums' })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.deletedTracks).toBe(2)

      const remainingTitles = (
        db.prepare('SELECT title FROM tracks ORDER BY title').all() as Array<{ title: string }>
      ).map((row) => row.title)
      expect(remainingTitles).toEqual(['Other Folder'])
    })
  })

  describe('POST /api/tracks', () => {
    it('returns 400 when no URLs provided', async () => {
      const res = await request(app)
        .post('/api/tracks')
        .send({})

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('URLs array required')
    })

    it('returns 400 when URLs is empty array', async () => {
      const res = await request(app)
        .post('/api/tracks')
        .send({ urls: [] })

      expect(res.status).toBe(400)
    })

    it('adds a track from valid YouTube URL', async () => {
      const res = await request(app)
        .post('/api/tracks')
        .send({ urls: ['https://www.youtube.com/watch?v=dQw4w9WgXcQ'] })

      expect(res.status).toBe(200)
      expect(res.body.success).toContain('dQw4w9WgXcQ')
      expect(res.body.failed).toHaveLength(0)
    })

    it('reports failure for invalid URL', async () => {
      const res = await request(app)
        .post('/api/tracks')
        .send({ urls: ['not-a-valid-url'] })

      expect(res.status).toBe(200)
      expect(res.body.success).toHaveLength(0)
      expect(res.body.failed).toHaveLength(1)
      expect(res.body.failed[0].url).toBe('not-a-valid-url')
    })

    it('handles duplicate tracks gracefully', async () => {
      // First add
      await request(app)
        .post('/api/tracks')
        .send({ urls: ['https://www.youtube.com/watch?v=dQw4w9WgXcQ'] })

      // Second add - should succeed without error
      const res = await request(app)
        .post('/api/tracks')
        .send({ urls: ['https://www.youtube.com/watch?v=dQw4w9WgXcQ'] })

      expect(res.status).toBe(200)
      expect(res.body.success).toContain('dQw4w9WgXcQ')
    })
  })

  describe('DELETE /api/tracks/:id', () => {
    it('returns 404 for non-existent track', async () => {
      const res = await request(app).delete('/api/tracks/9999')

      expect(res.status).toBe(404)
      expect(res.body.error).toBe('Track not found')
    })

    it('deletes an existing track', async () => {
      const track = await createTestTrack(app)

      const res = await request(app).delete(`/api/tracks/${track.id}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)

      // Verify track is gone
      const listRes = await request(app).get('/api/tracks')
      expect(listRes.body).toHaveLength(0)
    })
  })

  describe('GET /api/tracks/:id/audio', () => {
    it('returns 404 when track has no audio', async () => {
      const track = await createTestTrack(app, { status: 'pending' })

      const res = await request(app).get(`/api/tracks/${track.id}/audio`)

      expect(res.status).toBe(404)
    })

    it('streams audio file when available', async () => {
      const track = await createTestTrackWithAudio(app)

      const res = await request(app).get(`/api/tracks/${track.id}/audio`)

      expect(res.status).toBe(200)
    })
  })

  describe('GET /api/tracks/:id/peaks', () => {
    it('returns 404 when track has no peaks', async () => {
      const track = await createTestTrack(app, { status: 'pending' })

      const res = await request(app).get(`/api/tracks/${track.id}/peaks`)

      expect(res.status).toBe(404)
    })

    it('returns peaks array when available', async () => {
      const track = await createTestTrackWithAudio(app)

      const res = await request(app).get(`/api/tracks/${track.id}/peaks`)

      expect(res.status).toBe(200)
      expect(Array.isArray(res.body)).toBe(true)
      expect(res.body).toEqual([0.5, 0.7, 0.3, 0.8, 0.4])
    })
  })
})
