import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import { resetDatabase, TEST_DATA_DIR } from './setup.js'
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
