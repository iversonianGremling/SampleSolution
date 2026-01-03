import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import { resetDatabase, TEST_DATA_DIR } from './setup.js'
import { createTestTrack, createTestTag, createTestSlice } from './helpers.js'


describe('Tags API', () => {
  let app: any

  beforeEach(async () => {
    resetDatabase()
    const { createApp } = await import('../src/app.js')
    app = createApp({ dataDir: TEST_DATA_DIR })
  })

  describe('GET /api/tags', () => {
    it('returns empty array when no tags exist', async () => {
      const res = await request(app).get('/api/tags')

      expect(res.status).toBe(200)
      expect(res.body).toEqual([])
    })

    it('returns all tags ordered by name', async () => {
      await createTestTag('zebra', '#000000')
      await createTestTag('alpha', '#ffffff')

      const res = await request(app).get('/api/tags')

      expect(res.status).toBe(200)
      expect(res.body).toHaveLength(2)
      expect(res.body[0].name).toBe('alpha')
      expect(res.body[1].name).toBe('zebra')
    })
  })

  describe('POST /api/tags', () => {
    it('returns 400 when missing name', async () => {
      const res = await request(app)
        .post('/api/tags')
        .send({ color: '#ff0000' })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('Name and color required')
    })

    it('returns 400 when missing color', async () => {
      const res = await request(app)
        .post('/api/tags')
        .send({ name: 'test' })

      expect(res.status).toBe(400)
    })

    it('creates a tag successfully', async () => {
      const res = await request(app)
        .post('/api/tags')
        .send({ name: 'My Tag', color: '#3b82f6' })

      expect(res.status).toBe(200)
      expect(res.body).toHaveProperty('id')
      expect(res.body.name).toBe('my tag') // lowercase
      expect(res.body.color).toBe('#3b82f6')
    })

    it('returns 400 for duplicate tag name', async () => {
      await createTestTag('duplicate')

      const res = await request(app)
        .post('/api/tags')
        .send({ name: 'duplicate', color: '#ff0000' })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('Tag already exists')
    })
  })

  describe('DELETE /api/tags/:id', () => {
    it('deletes a tag', async () => {
      const tag = await createTestTag('to-delete')

      const res = await request(app).delete(`/api/tags/${tag.id}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)

      // Verify tag is gone
      const listRes = await request(app).get('/api/tags')
      expect(listRes.body).toHaveLength(0)
    })
  })

  describe('POST /api/tracks/:trackId/tags', () => {
    it('adds tag to track', async () => {
      const track = await createTestTrack(app)
      const tag = await createTestTag('my-tag')

      const res = await request(app)
        .post(`/api/tracks/${track.id}/tags`)
        .send({ tagId: tag.id })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)

      // Verify tag is attached
      const tracksRes = await request(app).get('/api/tracks')
      expect(tracksRes.body[0].tags).toHaveLength(1)
      expect(tracksRes.body[0].tags[0].name).toBe('my-tag')
    })

    it('handles duplicate tag assignment gracefully', async () => {
      const track = await createTestTrack(app)
      const tag = await createTestTag('my-tag')

      // Add twice
      await request(app)
        .post(`/api/tracks/${track.id}/tags`)
        .send({ tagId: tag.id })

      const res = await request(app)
        .post(`/api/tracks/${track.id}/tags`)
        .send({ tagId: tag.id })

      expect(res.status).toBe(200)

      // Should still only have one tag
      const tracksRes = await request(app).get('/api/tracks')
      expect(tracksRes.body[0].tags).toHaveLength(1)
    })
  })

  describe('DELETE /api/tracks/:trackId/tags/:tagId', () => {
    it('removes tag from track', async () => {
      const track = await createTestTrack(app)
      const tag = await createTestTag('my-tag')

      // Add tag
      await request(app)
        .post(`/api/tracks/${track.id}/tags`)
        .send({ tagId: tag.id })

      // Remove tag
      const res = await request(app)
        .delete(`/api/tracks/${track.id}/tags/${tag.id}`)

      expect(res.status).toBe(200)

      // Verify tag is removed from track
      const tracksRes = await request(app).get('/api/tracks')
      expect(tracksRes.body[0].tags).toHaveLength(0)
    })
  })

describe('POST /api/slices/:sliceId/tags', () => {
    it('adds tag to slice', async () => {
      const track = await createTestTrack(app)
      const slice = await createTestSlice(track.id)
      const tag = await createTestTag('slice-tag')

      const res = await request(app)
        .post(`/api/slices/${slice.id}/tags`)
        .send({ tagId: tag.id })

      expect(res.status).toBe(200)

      // Verify tag is attached
      const slicesRes = await request(app).get(`/api/tracks/${track.id}/slices`)
      expect(slicesRes.body[0].tags).toHaveLength(1)
      expect(slicesRes.body[0].tags[0].name).toBe('slice-tag')
    })
  })

  describe('DELETE /api/slices/:sliceId/tags/:tagId', () => {
    it('removes tag from slice', async () => {
      const track = await createTestTrack(app)
      const slice = await createTestSlice(track.id)
      const tag = await createTestTag('slice-tag')

      // Add tag
      await request(app)
        .post(`/api/slices/${slice.id}/tags`)
        .send({ tagId: tag.id })

      // Remove tag
      const res = await request(app)
        .delete(`/api/slices/${slice.id}/tags/${tag.id}`)

      expect(res.status).toBe(200)

      // Verify tag is removed
      const slicesRes = await request(app).get(`/api/tracks/${track.id}/slices`)
      expect(slicesRes.body[0].tags).toHaveLength(0)
    })
  })
})
