import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import { resetDatabase, TEST_DATA_DIR } from './setup.js'

// Mock YouTube API
vi.mock('../src/services/youtube-api.js', () => ({
  searchYouTube: vi.fn().mockResolvedValue([
    {
      videoId: 'abc123',
      title: 'Test Video 1',
      description: 'Description 1',
      thumbnailUrl: 'https://example.com/thumb1.jpg',
      channelTitle: 'Test Channel',
      publishedAt: '2024-01-01T00:00:00Z',
    },
    {
      videoId: 'def456',
      title: 'Test Video 2',
      description: 'Description 2',
      thumbnailUrl: 'https://example.com/thumb2.jpg',
      channelTitle: 'Test Channel',
      publishedAt: '2024-01-02T00:00:00Z',
    },
  ]),
  getUserPlaylists: vi.fn().mockResolvedValue([
    {
      id: 'playlist1',
      title: 'My Playlist',
      description: 'Playlist description',
      thumbnailUrl: 'https://example.com/playlist.jpg',
      itemCount: 10,
    },
  ]),
  getPlaylistItems: vi.fn().mockResolvedValue([
    {
      videoId: 'vid1',
      title: 'Playlist Video 1',
      description: '',
      thumbnailUrl: 'https://example.com/vid1.jpg',
      channelTitle: 'Channel',
      publishedAt: '2024-01-01T00:00:00Z',
    },
  ]),
  createOAuth2Client: vi.fn().mockReturnValue({
    setCredentials: vi.fn(),
  }),
  getAuthUrl: vi.fn().mockReturnValue('https://accounts.google.com/oauth'),
  getUserInfo: vi.fn().mockResolvedValue({
    name: 'Test User',
    email: 'test@example.com',
    picture: 'https://example.com/avatar.jpg',
  }),
}))

// Mock yt-dlp
vi.mock('../src/services/ytdlp.js', () => ({
  getVideoInfo: vi.fn().mockResolvedValue({
    videoId: 'test123',
    title: 'Test Video',
    description: 'Test description',
    thumbnailUrl: 'https://example.com/thumb.jpg',
    channelTitle: 'Test Channel',
    duration: 180,
  }),
  extractVideoId: vi.fn().mockImplementation((input: string) => {
    // Simple extraction for testing
    if (input.includes('youtube.com/watch?v=')) {
      const match = input.match(/v=([a-zA-Z0-9_-]+)/)
      return match ? match[1] : null
    }
    if (input.includes('youtu.be/')) {
      const match = input.match(/youtu\.be\/([a-zA-Z0-9_-]+)/)
      return match ? match[1] : null
    }
    if (/^[a-zA-Z0-9_-]{11}$/.test(input)) {
      return input
    }
    return null
  }),
  extractPlaylistId: vi.fn().mockImplementation((input: string) => {
    const match = input.match(/list=([a-zA-Z0-9_-]+)/)
    return match ? match[1] : null
  }),
}))

// Mock processor
vi.mock('../src/services/processor.js', () => ({
  processTrack: vi.fn().mockResolvedValue(undefined),
}))

describe('YouTube API', () => {
  let app: any

  beforeEach(async () => {
    resetDatabase()
    const { createApp } = await import('../src/app.js')
    app = createApp({ dataDir: TEST_DATA_DIR })
  })

  describe('GET /api/youtube/search', () => {
    it('returns 400 when no query provided', async () => {
      const res = await request(app).get('/api/youtube/search')

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('Query required')
    })

    it('returns search results', async () => {
      const res = await request(app)
        .get('/api/youtube/search')
        .query({ q: 'jazz samples' })

      expect(res.status).toBe(200)
      expect(res.body).toHaveLength(2)
      expect(res.body[0]).toHaveProperty('videoId', 'abc123')
      expect(res.body[0]).toHaveProperty('title', 'Test Video 1')
    })
  })

  describe('GET /api/youtube/playlists', () => {
    it('returns 401 when not authenticated', async () => {
      const res = await request(app).get('/api/youtube/playlists')

      expect(res.status).toBe(401)
      expect(res.body.error).toBe('Not authenticated')
    })
  })

  describe('POST /api/youtube/import', () => {
    it('returns 400 when no text provided', async () => {
      const res = await request(app)
        .post('/api/youtube/import')
        .send({})

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('Text required')
    })

    it('imports from YouTube URLs', async () => {
      const text = `https://www.youtube.com/watch?v=abc123
https://youtu.be/def456`

      const res = await request(app)
        .post('/api/youtube/import')
        .send({ text })

      expect(res.status).toBe(200)
      expect(res.body.success).toContain('abc123')
      expect(res.body.success).toContain('def456')
    })

    it('imports from plain video IDs', async () => {
      const text = `abc12345678
def12345678`

      const res = await request(app)
        .post('/api/youtube/import')
        .send({ text })

      expect(res.status).toBe(200)
      expect(res.body.success).toContain('abc12345678')
      expect(res.body.success).toContain('def12345678')
    })

    it('skips header lines in CSV format', async () => {
      const text = `Video ID,Timestamp
abc12345678,2024-01-01`

      const res = await request(app)
        .post('/api/youtube/import')
        .send({ text })

      expect(res.status).toBe(200)
      expect(res.body.success).toContain('abc12345678')
      expect(res.body.success).toHaveLength(1) // Header was skipped
    })

    it('handles mixed valid and invalid URLs', async () => {
      const text = `https://www.youtube.com/watch?v=validvideo1
not-a-valid-url
https://www.youtube.com/watch?v=validvideo2`

      const res = await request(app)
        .post('/api/youtube/import')
        .send({ text })

      expect(res.status).toBe(200)
      expect(res.body.success).toContain('validvideo1')
      expect(res.body.success).toContain('validvideo2')
    })
  })
})

describe('Auth API', () => {
  let app: any

  beforeEach(async () => {
    resetDatabase()
    const { createApp } = await import('../src/app.js')
    app = createApp({ dataDir: TEST_DATA_DIR })
  })

  describe('GET /api/auth/status', () => {
    it('returns unauthenticated when no session', async () => {
      const res = await request(app).get('/api/auth/status')

      expect(res.status).toBe(200)
      expect(res.body.authenticated).toBe(false)
    })
  })

  describe('GET /api/auth/google', () => {
    it('redirects to Google OAuth', async () => {
      const res = await request(app).get('/api/auth/google')

      expect(res.status).toBe(302)
      expect(res.headers.location).toContain('accounts.google.com')
    })
  })

  describe('POST /api/auth/logout', () => {
    it('returns success even when not logged in', async () => {
      const res = await request(app).post('/api/auth/logout')

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })
  })
})
