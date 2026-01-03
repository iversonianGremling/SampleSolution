import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import { resetDatabase, TEST_DATA_DIR } from './setup.js'
import { createTestTrack, createTestTrackWithAudio, createTestSlice } from './helpers.js'

// Mock ffmpeg to avoid actual audio processing
vi.mock('../src/services/ffmpeg.js', () => ({
  extractSlice: vi.fn().mockResolvedValue('/tmp/slice.mp3'),
  generatePeaks: vi.fn().mockResolvedValue([0.5, 0.7]),
  getAudioDuration: vi.fn().mockResolvedValue(180),
}))

describe('Slices API', () => {
  let app: any

  beforeEach(async () => {
    resetDatabase()
    const { createApp } = await import('../src/app.js')
    app = createApp({ dataDir: TEST_DATA_DIR })
  })

  describe('GET /api/tracks/:trackId/slices', () => {
    it('returns empty array when no slices exist', async () => {
      const track = await createTestTrack(app)

      const res = await request(app).get(`/api/tracks/${track.id}/slices`)

      expect(res.status).toBe(200)
      expect(res.body).toEqual([])
    })

    it('returns slices for a track with tags', async () => {
      const track = await createTestTrack(app)
      await createTestSlice(track.id, { name: 'Slice 1', startTime: 0, endTime: 10 })
      await createTestSlice(track.id, { name: 'Slice 2', startTime: 20, endTime: 30 })

      const res = await request(app).get(`/api/tracks/${track.id}/slices`)

      expect(res.status).toBe(200)
      expect(res.body).toHaveLength(2)
      expect(res.body[0]).toHaveProperty('name', 'Slice 1')
      expect(res.body[0]).toHaveProperty('tags')
      expect(res.body[1]).toHaveProperty('name', 'Slice 2')
    })

    it('returns slices ordered by start time', async () => {
      const track = await createTestTrack(app)
      await createTestSlice(track.id, { name: 'Second', startTime: 20, endTime: 30 })
      await createTestSlice(track.id, { name: 'First', startTime: 5, endTime: 10 })

      const res = await request(app).get(`/api/tracks/${track.id}/slices`)

      expect(res.body[0].name).toBe('First')
      expect(res.body[1].name).toBe('Second')
    })
  })

  describe('POST /api/tracks/:trackId/slices', () => {
    it('returns 400 when missing required fields', async () => {
      const track = await createTestTrackWithAudio(app)

      const res = await request(app)
        .post(`/api/tracks/${track.id}/slices`)
        .send({ name: 'Test' })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('Name, startTime, and endTime required')
    })

    it('returns 400 when startTime >= endTime', async () => {
      const track = await createTestTrackWithAudio(app)

      const res = await request(app)
        .post(`/api/tracks/${track.id}/slices`)
        .send({ name: 'Test', startTime: 20, endTime: 10 })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('startTime must be less than endTime')
    })

    it('returns 404 for non-existent track', async () => {
      const res = await request(app)
        .post('/api/tracks/9999/slices')
        .send({ name: 'Test', startTime: 0, endTime: 10 })

      expect(res.status).toBe(404)
    })

    it('returns 400 when track audio not ready', async () => {
      const track = await createTestTrack(app, { status: 'pending' })

      const res = await request(app)
        .post(`/api/tracks/${track.id}/slices`)
        .send({ name: 'Test', startTime: 0, endTime: 10 })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('Track audio not ready')
    })

    it('creates a slice successfully', async () => {
      const track = await createTestTrackWithAudio(app)

      const res = await request(app)
        .post(`/api/tracks/${track.id}/slices`)
        .send({ name: 'My Slice', startTime: 10, endTime: 25 })

      expect(res.status).toBe(200)
      expect(res.body).toHaveProperty('id')
      expect(res.body.name).toBe('My Slice')
      expect(res.body.startTime).toBe(10)
      expect(res.body.endTime).toBe(25)
      expect(res.body.trackId).toBe(track.id)
    })
  })

  describe('PUT /api/slices/:id', () => {
    it('returns 404 for non-existent slice', async () => {
      const res = await request(app)
        .put('/api/slices/9999')
        .send({ name: 'Updated' })

      expect(res.status).toBe(404)
    })

    it('updates slice name', async () => {
      const track = await createTestTrack(app)
      const slice = await createTestSlice(track.id, { name: 'Original' })

      const res = await request(app)
        .put(`/api/slices/${slice.id}`)
        .send({ name: 'Updated Name' })

      expect(res.status).toBe(200)
      expect(res.body.name).toBe('Updated Name')
    })

    it('updates slice times', async () => {
      const track = await createTestTrackWithAudio(app)
      const slice = await createTestSlice(track.id, { startTime: 10, endTime: 20 })

      const res = await request(app)
        .put(`/api/slices/${slice.id}`)
        .send({ startTime: 15, endTime: 30 })

      expect(res.status).toBe(200)
      expect(res.body.startTime).toBe(15)
      expect(res.body.endTime).toBe(30)
    })
  })

  describe('DELETE /api/slices/:id', () => {
    it('returns 404 for non-existent slice', async () => {
      const res = await request(app).delete('/api/slices/9999')

      expect(res.status).toBe(404)
    })

    it('deletes a slice', async () => {
      const track = await createTestTrack(app)
      const slice = await createTestSlice(track.id)

      const res = await request(app).delete(`/api/slices/${slice.id}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)

      // Verify slice is gone
      const listRes = await request(app).get(`/api/tracks/${track.id}/slices`)
      expect(listRes.body).toHaveLength(0)
    })
  })

  describe('GET /api/slices/:id/download', () => {
    it('returns 404 for non-existent slice', async () => {
      const res = await request(app).get('/api/slices/9999/download')

      expect(res.status).toBe(404)
    })

    it('returns 404 when slice has no file', async () => {
      const track = await createTestTrack(app)
      const slice = await createTestSlice(track.id)

      const res = await request(app).get(`/api/slices/${slice.id}/download`)

      expect(res.status).toBe(404)
    })
  })
})
