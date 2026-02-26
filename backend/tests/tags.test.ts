import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import { resetDatabase, TEST_DATA_DIR, getAppDb } from './setup.js'
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

  describe('POST /api/tags/from-folder', () => {
    it('creates an instrument tag and applies it to slices in the folder subtree', async () => {
      const track = await createTestTrack(app)
      const parentSlice = await createTestSlice(track.id, { name: 'parent-slice' })
      const childSliceOne = await createTestSlice(track.id, { name: 'child-slice-1' })
      const childSliceTwo = await createTestSlice(track.id, { name: 'child-slice-2' })
      const db = await getAppDb()

      const parentFolderInsert = db
        .prepare(`
          INSERT INTO folders (name, color, parent_id, created_at)
          VALUES (?, ?, ?, ?)
        `)
        .run('drums-root', '#22c55e', null, new Date().toISOString())
      const parentFolderId = Number(parentFolderInsert.lastInsertRowid)

      const childFolderInsert = db
        .prepare(`
          INSERT INTO folders (name, color, parent_id, created_at)
          VALUES (?, ?, ?, ?)
        `)
        .run('drums-child', '#22c55e', parentFolderId, new Date().toISOString())
      const childFolderId = Number(childFolderInsert.lastInsertRowid)

      db
        .prepare(`
          INSERT INTO folder_slices (folder_id, slice_id)
          VALUES (?, ?)
        `)
        .run(parentFolderId, parentSlice.id)
      db
        .prepare(`
          INSERT INTO folder_slices (folder_id, slice_id)
          VALUES (?, ?)
        `)
        .run(childFolderId, childSliceOne.id)
      db
        .prepare(`
          INSERT INTO folder_slices (folder_id, slice_id)
          VALUES (?, ?)
        `)
        .run(childFolderId, childSliceTwo.id)

      const res = await request(app)
        .post('/api/tags/from-folder')
        .send({ folderId: parentFolderId, name: 'Drums', color: '#3b82f6' })

      expect(res.status).toBe(200)
      expect(res.body.name).toBe('drums')
      expect(res.body.category).toBe('instrument')
      expect(res.body.slicesTagged).toBe(3)

      const taggedSliceRows = db
        .prepare(`
          SELECT slice_id as sliceId
          FROM slice_tags
          WHERE tag_id = ?
          ORDER BY slice_id
        `)
        .all(res.body.id) as { sliceId: number }[]
      expect(taggedSliceRows.map((row) => row.sliceId)).toEqual(
        [parentSlice.id, childSliceOne.id, childSliceTwo.id].sort((a, b) => a - b)
      )
    })

    it('accepts a numeric folderId passed as a string', async () => {
      const track = await createTestTrack(app)
      const slice = await createTestSlice(track.id)
      const db = await getAppDb()

      const folderInsert = db
        .prepare(`
          INSERT INTO folders (name, color, parent_id, created_at)
          VALUES (?, ?, ?, ?)
        `)
        .run('string-folder-id', '#22c55e', null, new Date().toISOString())
      const folderId = Number(folderInsert.lastInsertRowid)

      db
        .prepare(`
          INSERT INTO folder_slices (folder_id, slice_id)
          VALUES (?, ?)
        `)
        .run(folderId, slice.id)

      const res = await request(app)
        .post('/api/tags/from-folder')
        .send({ folderId: String(folderId), name: 'snare', color: '#10b981' })

      expect(res.status).toBe(200)
      expect(res.body.name).toBe('snare')
      expect(res.body.slicesTagged).toBe(1)
    })

    it('returns 400 for invalid folderId values', async () => {
      const res = await request(app)
        .post('/api/tags/from-folder')
        .send({ folderId: 'not-a-number', name: 'invalid', color: '#ef4444' })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('Valid folderId is required')
    })
  })

  describe('POST /api/tags/merge', () => {
    it('merges links into target and deletes source when requested', async () => {
      const track = await createTestTrack(app)
      const slice = await createTestSlice(track.id)
      const sourceTag = await createTestTag('source-tag')
      const targetTag = await createTestTag('target-tag')

      await request(app)
        .post(`/api/tracks/${track.id}/tags`)
        .send({ tagId: sourceTag.id })

      await request(app)
        .post(`/api/slices/${slice.id}/tags`)
        .send({ tagId: sourceTag.id })

      const res = await request(app)
        .post('/api/tags/merge')
        .send({
          sourceTagId: sourceTag.id,
          targetTagId: targetTag.id,
          deleteSourceTag: true,
        })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.deletedSourceTag).toBe(true)

      const tagsRes = await request(app).get('/api/tags')
      const tagNames = tagsRes.body.map((tag: { name: string }) => tag.name)
      expect(tagNames).toContain('target-tag')
      expect(tagNames).not.toContain('source-tag')

      const tracksRes = await request(app).get('/api/tracks')
      const trackTagNames = tracksRes.body[0].tags.map((tag: { name: string }) => tag.name)
      expect(trackTagNames).toContain('target-tag')
      expect(trackTagNames).not.toContain('source-tag')

      const slicesRes = await request(app).get(`/api/tracks/${track.id}/slices`)
      const sliceTagNames = slicesRes.body[0].tags.map((tag: { name: string }) => tag.name)
      expect(sliceTagNames).toContain('target-tag')
      expect(sliceTagNames).not.toContain('source-tag')
    })

    it('keeps source tag when deleteSourceTag is false', async () => {
      const track = await createTestTrack(app)
      const slice = await createTestSlice(track.id)
      const sourceTag = await createTestTag('source-tag-2')
      const targetTag = await createTestTag('target-tag-2')

      await request(app)
        .post(`/api/slices/${slice.id}/tags`)
        .send({ tagId: sourceTag.id })

      const res = await request(app)
        .post('/api/tags/merge')
        .send({
          sourceTagId: sourceTag.id,
          targetTagId: targetTag.id,
          deleteSourceTag: false,
        })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.deletedSourceTag).toBe(false)

      const tagsRes = await request(app).get('/api/tags')
      const tagNames = tagsRes.body.map((tag: { name: string }) => tag.name)
      expect(tagNames).toContain('source-tag-2')
      expect(tagNames).toContain('target-tag-2')

      const slicesRes = await request(app).get(`/api/tracks/${track.id}/slices`)
      const sliceTagNames = slicesRes.body[0].tags.map((tag: { name: string }) => tag.name)
      expect(sliceTagNames).toContain('source-tag-2')
      expect(sliceTagNames).toContain('target-tag-2')
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
