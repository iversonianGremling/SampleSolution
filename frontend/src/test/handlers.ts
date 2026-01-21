import { http, HttpResponse } from 'msw'
import type { Track, Slice, Tag, YouTubeSearchResult, AuthStatus, ImportResult } from '../types'

// Mock data
export const mockTracks: Track[] = [
  {
    id: 1,
    youtubeId: 'abc123',
    title: 'Test Track 1',
    description: 'A test track',
    thumbnailUrl: 'https://example.com/thumb1.jpg',
    duration: 180,
    audioPath: '/data/audio/abc123.mp3',
    peaksPath: '/data/peaks/abc123.json',
    status: 'ready',
    createdAt: '2024-01-01T00:00:00Z',
    tags: [{ id: 1, name: 'jazz', color: '#3b82f6' }],
  },
  {
    id: 2,
    youtubeId: 'def456',
    title: 'Test Track 2',
    description: 'Another test track',
    thumbnailUrl: 'https://example.com/thumb2.jpg',
    duration: 240,
    audioPath: null,
    peaksPath: null,
    status: 'downloading',
    createdAt: '2024-01-02T00:00:00Z',
    tags: [],
  },
]

export const mockSlices: Slice[] = [
  {
    id: 1,
    trackId: 1,
    name: 'Slice 1',
    startTime: 10,
    endTime: 25,
    filePath: '/data/slices/abc123_1.mp3',
    favorite: false,
    createdAt: '2024-01-01T00:00:00Z',
    tags: [],
  },
]

export const mockTags: Tag[] = [
  { id: 1, name: 'jazz', color: '#3b82f6' },
  { id: 2, name: 'piano', color: '#22c55e' },
  { id: 3, name: 'chill', color: '#f59e0b' },
]

export const mockSearchResults: YouTubeSearchResult[] = [
  {
    videoId: 'search1',
    title: 'Search Result 1',
    description: 'First search result',
    thumbnailUrl: 'https://example.com/search1.jpg',
    channelTitle: 'Test Channel',
    publishedAt: '2024-01-01T00:00:00Z',
  },
  {
    videoId: 'search2',
    title: 'Search Result 2',
    description: 'Second search result',
    thumbnailUrl: 'https://example.com/search2.jpg',
    channelTitle: 'Test Channel',
    publishedAt: '2024-01-02T00:00:00Z',
  },
]

export const handlers = [
  // Tracks
  http.get('/api/tracks', () => {
    return HttpResponse.json(mockTracks)
  }),

  http.post('/api/tracks', async ({ request }) => {
    const body = await request.json() as { urls: string[] }
    return HttpResponse.json({
      success: body.urls.map((url) => url.replace(/.*v=/, '').slice(0, 11)),
      failed: [],
    } as ImportResult)
  }),

  http.delete('/api/tracks/:id', () => {
    return HttpResponse.json({ success: true })
  }),

  http.get('/api/tracks/:id/audio', () => {
    return new HttpResponse(new Blob(), {
      headers: { 'Content-Type': 'audio/mpeg' },
    })
  }),

  http.get('/api/tracks/:id/peaks', () => {
    return HttpResponse.json([0.5, 0.7, 0.3, 0.8, 0.4, 0.6, 0.5, 0.7])
  }),

  // Slices
  http.get('/api/tracks/:trackId/slices', ({ params }) => {
    const trackId = parseInt(params.trackId as string)
    return HttpResponse.json(mockSlices.filter((s) => s.trackId === trackId))
  }),

  http.post('/api/tracks/:trackId/slices', async ({ params, request }) => {
    const trackId = parseInt(params.trackId as string)
    const body = await request.json() as { name: string; startTime: number; endTime: number }
    const newSlice: Slice = {
      id: Date.now(),
      trackId,
      name: body.name,
      startTime: body.startTime,
      endTime: body.endTime,
      filePath: '/data/slices/new.mp3',
      favorite: false,
      createdAt: new Date().toISOString(),
      tags: [],
    }
    return HttpResponse.json(newSlice)
  }),

  http.put('/api/slices/:id', async ({ params, request }) => {
    const body = await request.json() as Partial<Slice>
    return HttpResponse.json({ id: parseInt(params.id as string), ...body })
  }),

  http.delete('/api/slices/:id', () => {
    return HttpResponse.json({ success: true })
  }),

  // YouTube
  http.get('/api/youtube/search', ({ request }) => {
    const url = new URL(request.url)
    const query = url.searchParams.get('q')
    if (!query) {
      return HttpResponse.json({ error: 'Query required' }, { status: 400 })
    }
    return HttpResponse.json(mockSearchResults)
  }),

  http.get('/api/youtube/playlists', () => {
    return HttpResponse.json([
      {
        id: 'playlist1',
        title: 'My Playlist',
        description: 'A test playlist',
        thumbnailUrl: 'https://example.com/playlist.jpg',
        itemCount: 5,
      },
    ])
  }),

  http.get('/api/youtube/playlist/:id', () => {
    return HttpResponse.json(mockSearchResults)
  }),

  http.post('/api/youtube/import', async ({ request }) => {
    const body = await request.json() as { text: string }
    const lines = body.text.split('\n').filter(Boolean)
    return HttpResponse.json({
      success: lines.map((_, i) => `imported${i}`),
      failed: [],
    } as ImportResult)
  }),

  // Auth
  http.get('/api/auth/status', () => {
    return HttpResponse.json({ authenticated: false } as AuthStatus)
  }),

  http.post('/api/auth/logout', () => {
    return HttpResponse.json({ success: true })
  }),

  // Tags
  http.get('/api/tags', () => {
    return HttpResponse.json(mockTags)
  }),

  http.post('/api/tags', async ({ request }) => {
    const body = await request.json() as { name: string; color: string }
    return HttpResponse.json({
      id: Date.now(),
      name: body.name.toLowerCase(),
      color: body.color,
    } as Tag)
  }),

  http.delete('/api/tags/:id', () => {
    return HttpResponse.json({ success: true })
  }),

  http.post('/api/tracks/:trackId/tags', () => {
    return HttpResponse.json({ success: true })
  }),

  http.delete('/api/tracks/:trackId/tags/:tagId', () => {
    return HttpResponse.json({ success: true })
  }),

  http.post('/api/tracks/:trackId/ai-tags', () => {
    return HttpResponse.json({ tags: ['jazz', 'piano', 'chill'] })
  }),
]
