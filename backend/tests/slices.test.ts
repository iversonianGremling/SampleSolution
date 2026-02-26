import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import { resetDatabase, TEST_DATA_DIR, getAppDb } from './setup.js'
import { createTestTrack, createTestTrackWithAudio, createTestSlice } from './helpers.js'
import fs from 'fs'
import path from 'path'
import type { Express } from 'express'
import { convertAudioFile } from '../src/services/ffmpeg.js'

// Mock ffmpeg to avoid actual audio processing
vi.mock('../src/services/ffmpeg.js', () => ({
  extractSlice: vi.fn().mockResolvedValue('/tmp/slice.mp3'),
  convertAudioFile: vi.fn().mockImplementation(async (inputPath: string, outputPath: string) => {
    fs.copyFileSync(inputPath, outputPath)
    return outputPath
  }),
  generatePeaks: vi.fn().mockResolvedValue([0.5, 0.7]),
  getAudioDuration: vi.fn().mockResolvedValue(180),
  getAudioFileMetadata: vi.fn().mockImplementation(async (inputPath: string) => {
    const extension = path.extname(inputPath).replace(/^\./, '').toLowerCase() || 'mp3'
    return {
      sampleRate: 44100,
      bitDepth: 16,
      channels: 2,
      format: extension,
      modifiedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    }
  }),
}))

describe('Slices API', () => {
  let app: Express

  beforeEach(async () => {
    resetDatabase()
    const { createApp } = await import('../src/app.js')
    app = createApp({ dataDir: TEST_DATA_DIR })
    vi.mocked(convertAudioFile).mockClear()
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

  describe('POST /api/slices/batch-download', () => {
    it('returns 400 when sliceIds is missing', async () => {
      const res = await request(app)
        .post('/api/slices/batch-download')
        .send({})

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('sliceIds array required')
    })

    it('returns a zip archive for selected slices', async () => {
      const track = await createTestTrack(app)
      const sliceA = await createTestSlice(track.id, { name: 'Kick' })
      const sliceB = await createTestSlice(track.id, { name: 'Snare' })

      const slicesDir = path.join(TEST_DATA_DIR, 'slices')
      const fileA = path.join(slicesDir, 'kick.mp3')
      const fileB = path.join(slicesDir, 'snare.mp3')

      fs.writeFileSync(fileA, Buffer.from('kick-audio-data'))
      fs.writeFileSync(fileB, Buffer.from('snare-audio-data'))

      const db = await getAppDb()
      db.prepare('UPDATE slices SET file_path = ? WHERE id = ?').run(fileA, sliceA.id)
      db.prepare('UPDATE slices SET file_path = ? WHERE id = ?').run(fileB, sliceB.id)

      const res = await request(app)
        .post('/api/slices/batch-download')
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = []
          res.on('data', (chunk) => chunks.push(chunk))
          res.on('end', () => callback(null, Buffer.concat(chunks)))
        })
        .send({ sliceIds: [sliceA.id, sliceB.id] })

      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toContain('application/zip')
      expect(res.headers['content-disposition']).toContain('attachment; filename="samples-')
      expect(res.body).toBeInstanceOf(Buffer)
      expect(res.body.length).toBeGreaterThan(0)
      // ZIP local file header signature PK\x03\x04
      expect(res.body.subarray(0, 4).toString('hex')).toBe('504b0304')
    })
  })

  describe('POST /api/slices/batch-convert', () => {
    it('returns 400 when sliceIds is missing', async () => {
      const res = await request(app)
        .post('/api/slices/batch-convert')
        .send({ targetFormat: 'wav' })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('sliceIds array required')
    })

    it('returns 400 for invalid sampleRate', async () => {
      const res = await request(app)
        .post('/api/slices/batch-convert')
        .send({ sliceIds: [1], targetFormat: 'wav', sampleRate: 7999 })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('sampleRate must be an integer')
    })

    it('returns 400 for invalid bitDepth', async () => {
      const res = await request(app)
        .post('/api/slices/batch-convert')
        .send({ sliceIds: [1], targetFormat: 'wav', bitDepth: 20 })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('bitDepth must be one of')
    })

    it('returns 400 when bitDepth is used with unsupported target formats', async () => {
      const res = await request(app)
        .post('/api/slices/batch-convert')
        .send({ sliceIds: [1], targetFormat: 'mp3', bitDepth: 24 })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('bitDepth is only supported')
    })

    it('converts selected slices and updates file path + modified flag', async () => {
      const track = await createTestTrack(app)
      const slice = await createTestSlice(track.id, { name: 'Convert Me' })

      const slicesDir = path.join(TEST_DATA_DIR, 'slices')
      const originalPath = path.join(slicesDir, 'convert-me.mp3')
      fs.writeFileSync(originalPath, Buffer.from('audio-source-data'))

      const db = await getAppDb()
      db.prepare('UPDATE slices SET file_path = ? WHERE id = ?').run(originalPath, slice.id)
      db.prepare(`
        INSERT INTO audio_features (slice_id, duration, analysis_version, created_at, file_format)
        VALUES (?, ?, ?, ?, ?)
      `).run(slice.id, 1.0, 'test', new Date().toISOString(), 'mp3')

      const res = await request(app)
        .post('/api/slices/batch-convert')
        .send({
          sliceIds: [slice.id],
          targetFormat: 'wav',
          sampleRate: 48000,
          bitDepth: 24,
        })

      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({
        targetFormat: 'wav',
        sampleRate: 48000,
        bitDepth: 24,
        total: 1,
        converted: 1,
        skipped: 0,
        failed: 0,
      })
      expect(res.body.results).toHaveLength(1)
      expect(res.body.results[0]).toMatchObject({
        sliceId: slice.id,
        success: true,
        skipped: false,
      })

      const persistedSlice = db
        .prepare('SELECT file_path as filePath, sample_modified as sampleModified FROM slices WHERE id = ?')
        .get(slice.id) as { filePath: string; sampleModified: number }

      expect(persistedSlice.filePath).toContain(`${path.sep}slices${path.sep}`)
      expect(persistedSlice.filePath.endsWith('.wav')).toBe(true)
      expect(persistedSlice.sampleModified).toBe(1)
      expect(fs.existsSync(persistedSlice.filePath)).toBe(true)
      expect(fs.existsSync(originalPath)).toBe(false)
      expect(convertAudioFile).toHaveBeenCalledWith(
        originalPath,
        expect.stringContaining(`${path.sep}slices${path.sep}`),
        'wav',
        { sampleRate: 48000, bitDepth: 24 },
      )
    })

    it('supports quality-only conversion when target format is unchanged', async () => {
      const track = await createTestTrack(app)
      const slice = await createTestSlice(track.id, { name: 'Quality Upgrade' })

      const slicesDir = path.join(TEST_DATA_DIR, 'slices')
      const originalPath = path.join(slicesDir, 'quality-upgrade.wav')
      fs.writeFileSync(originalPath, Buffer.from('audio-source-data'))

      const db = await getAppDb()
      db.prepare('UPDATE slices SET file_path = ? WHERE id = ?').run(originalPath, slice.id)
      db.prepare(`
        INSERT INTO audio_features (slice_id, duration, analysis_version, created_at, file_format)
        VALUES (?, ?, ?, ?, ?)
      `).run(slice.id, 1.0, 'test', new Date().toISOString(), 'wav')

      const res = await request(app)
        .post('/api/slices/batch-convert')
        .send({
          sliceIds: [slice.id],
          targetFormat: 'wav',
          sampleRate: 48000,
        })

      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({
        targetFormat: 'wav',
        sampleRate: 48000,
        bitDepth: null,
        total: 1,
        converted: 1,
        skipped: 0,
        failed: 0,
      })
      expect(convertAudioFile).toHaveBeenCalledWith(
        originalPath,
        expect.stringContaining(`${path.sep}slices${path.sep}`),
        'wav',
        { sampleRate: 48000, bitDepth: undefined },
      )
    })
  })

  describe('GET /api/slices/:id/similar', () => {
    it('does not include the current slice in similar results', async () => {
      const track = await createTestTrack(app)
      const targetSlice = await createTestSlice(track.id, { name: 'Target slice' })
      const similarSlice = await createTestSlice(track.id, {
        name: 'Similar slice',
        startTime: 21,
        endTime: 31,
      })

      const db = await getAppDb()

      // Target embedding and a close-by embedding (> 0.5 cosine similarity)
      db.prepare(`
        INSERT INTO audio_features (slice_id, duration, analysis_version, created_at, yamnet_embeddings)
        VALUES (?, ?, ?, ?, ?)
      `).run(targetSlice.id, 1.0, 'test', new Date().toISOString(), JSON.stringify([1, 0, 0]))

      db.prepare(`
        INSERT INTO audio_features (slice_id, duration, analysis_version, created_at, yamnet_embeddings)
        VALUES (?, ?, ?, ?, ?)
      `).run(similarSlice.id, 1.0, 'test', new Date().toISOString(), JSON.stringify([0.9, 0.1, 0]))

      const res = await request(app).get(`/api/slices/${targetSlice.id}/similar?limit=10`)

      expect(res.status).toBe(200)
      expect(Array.isArray(res.body)).toBe(true)
      expect(res.body.some((row: { id: number }) => row.id === targetSlice.id)).toBe(false)
      expect(res.body.some((row: { id: number }) => row.id === similarSlice.id)).toBe(true)
    })
  })

  describe('GET /api/sources/samples', () => {
    it('returns extended metadata fields for list-view metrics', async () => {
      const track = await createTestTrack(app, { status: 'ready' })
      const slice = await createTestSlice(track.id, {
        name: 'Meta Slice',
        startTime: 0,
        endTime: 2,
      })

      const db = await getAppDb()
      const addedAt = '2024-05-20T10:15:00.000Z'
      db.prepare('UPDATE slices SET created_at = ? WHERE id = ?').run(addedAt, slice.id)

      db.prepare(`
        INSERT INTO audio_features (
          slice_id, duration, analysis_version, created_at,
          sample_rate, channels, file_format, source_mtime, source_ctime,
          loudness, polyphony, key_estimate, scale
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        slice.id,
        2,
        'test',
        addedAt,
        48000,
        2,
        'wav',
        '2024-05-19T08:00:00.000Z',
        '2024-01-15T09:30:00.000Z',
        -12.4,
        3,
        'C minor',
        'minor'
      )

      const res = await request(app).get('/api/sources/samples')

      expect(res.status).toBe(200)
      expect(res.body.total).toBe(1)
      expect(res.body.samples[0]).toMatchObject({
        id: slice.id,
        sampleRate: 48000,
        channels: 2,
        format: 'wav',
        loudness: -12.4,
        polyphony: 3,
        dateAdded: addedAt,
        dateCreated: '2024-01-15T09:30:00.000Z',
        dateModified: '2024-05-19T08:00:00.000Z',
      })
    })

    it('filters samples by date added and file creation date', async () => {
      const track = await createTestTrack(app, { status: 'ready' })
      const slice = await createTestSlice(track.id, {
        name: 'Date Filter Slice',
        startTime: 0,
        endTime: 2,
      })

      const db = await getAppDb()
      const addedAt = '2024-06-15T12:00:00.000Z'
      const createdAt = '2023-12-01T00:00:00.000Z'

      db.prepare('UPDATE slices SET created_at = ? WHERE id = ?').run(addedAt, slice.id)
      db.prepare(`
        INSERT INTO audio_features (
          slice_id, duration, analysis_version, created_at, source_ctime
        ) VALUES (?, ?, ?, ?, ?)
      `).run(slice.id, 2, 'test', addedAt, createdAt)

      const includeByAdded = await request(app)
        .get('/api/sources/samples')
        .query({ dateAddedFrom: '2024-06-01', dateAddedTo: '2024-06-30' })
      expect(includeByAdded.status).toBe(200)
      expect(includeByAdded.body.total).toBe(1)

      const excludeByAdded = await request(app)
        .get('/api/sources/samples')
        .query({ dateAddedFrom: '2024-07-01', dateAddedTo: '2024-07-31' })
      expect(excludeByAdded.status).toBe(200)
      expect(excludeByAdded.body.total).toBe(0)

      const includeByCreated = await request(app)
        .get('/api/sources/samples')
        .query({ dateCreatedFrom: '2023-11-01', dateCreatedTo: '2023-12-31' })
      expect(includeByCreated.status).toBe(200)
      expect(includeByCreated.body.total).toBe(1)

      const excludeByCreated = await request(app)
        .get('/api/sources/samples')
        .query({ dateCreatedFrom: '2024-01-01', dateCreatedTo: '2024-12-31' })
      expect(excludeByCreated.status).toBe(200)
      expect(excludeByCreated.body.total).toBe(0)
    })

    it('filters imported folder scopes using nested relative paths', async () => {
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

      const kickTrack = insertTrack.run(
        `local-scope-kick-${Date.now()}`,
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
      insertSlice.run(kickTrack.lastInsertRowid as number, 'Kick', 0, 1, now)

      const snareTrack = insertTrack.run(
        `local-scope-snare-${Date.now()}`,
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
      insertSlice.run(snareTrack.lastInsertRowid as number, 'Snare', 0, 1, now)

      const hihatTrack = insertTrack.run(
        `local-scope-hihat-${Date.now()}`,
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
      insertSlice.run(hihatTrack.lastInsertRowid as number, 'Hihat', 0, 1, now)

      const res = await request(app)
        .get('/api/sources/samples')
        .query({ scope: 'folder:/library/drums/electronic' })

      expect(res.status).toBe(200)
      expect(res.body.total).toBe(2)
      const returnedNames = res.body.samples.map((sample: { name: string }) => sample.name).sort()
      expect(returnedNames).toEqual(['Kick', 'Snare'])
    })

    it('filters by density using fallback metrics when event density is missing', async () => {
      const track = await createTestTrack(app, { status: 'ready' })
      const lowDensitySlice = await createTestSlice(track.id, {
        name: 'Low Density',
        startTime: 1,
        endTime: 3,
      })
      const highDensitySlice = await createTestSlice(track.id, {
        name: 'High Density',
        startTime: 1,
        endTime: 3,
      })

      const db = await getAppDb()
      const now = new Date().toISOString()

      db.prepare(`
        INSERT INTO audio_features (
          slice_id, duration, analysis_version, created_at, event_count, event_density, onset_rate
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(lowDensitySlice.id, 2, 'test', now, 2, null, null)

      db.prepare(`
        INSERT INTO audio_features (
          slice_id, duration, analysis_version, created_at, event_count, event_density, onset_rate
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(highDensitySlice.id, 2, 'test', now, null, null, 6)

      const res = await request(app)
        .get('/api/sources/samples')
        .query({ densityMin: '0.5' })

      expect(res.status).toBe(200)
      expect(res.body.total).toBe(1)
      expect(res.body.samples[0]).toMatchObject({
        id: highDensitySlice.id,
        name: 'High Density',
      })
      expect(res.body.samples[0].dimensionNormalized?.density).toBeCloseTo(1, 5)
    })
  })

  describe('POST /api/slices/:id/render', () => {
    it('returns 400 when audio payload is missing', async () => {
      const track = await createTestTrackWithAudio(app)
      const slice = await createTestSlice(track.id)

      const res = await request(app)
        .post(`/api/slices/${slice.id}/render`)
        .field('mode', 'copy')

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('Audio file is required')
    })

    it('overwrites slice audio and updates modified flags', async () => {
      const track = await createTestTrackWithAudio(app)
      const slice = await createTestSlice(track.id, {
        name: 'Overwrite Target',
        startTime: 10,
        endTime: 20,
      })

      const slicesDir = path.join(TEST_DATA_DIR, 'slices')
      const originalPath = path.join(slicesDir, 'overwrite-target.mp3')
      fs.writeFileSync(originalPath, Buffer.from('original-audio'))

      const db = await getAppDb()
      db.prepare('UPDATE slices SET file_path = ? WHERE id = ?').run(originalPath, slice.id)

      const renderBuffer = Buffer.from('RIFF-rendered-overwrite-data')

      const res = await request(app)
        .post(`/api/slices/${slice.id}/render`)
        .field('mode', 'overwrite')
        .field('duration', '2.75')
        .field('hqPitchRequested', 'true')
        .attach('audio', renderBuffer, { filename: 'render.wav', contentType: 'audio/wav' })

      expect(res.status).toBe(200)
      expect(res.body.mode).toBe('overwrite')
      expect(res.body.sourceSliceId).toBe(slice.id)
      expect(res.body.slice.id).toBe(slice.id)
      expect(res.body.slice.sampleModified).toBe(1)
      expect(res.body.slice.endTime).toBeCloseTo(2.75, 4)
      expect(res.body.hqPitchRequested).toBe(true)

      const persisted = db
        .prepare('SELECT file_path as filePath, end_time as endTime, sample_modified as sampleModified FROM slices WHERE id = ?')
        .get(slice.id) as { filePath: string; endTime: number; sampleModified: number }

      expect(persisted.filePath).toBe(originalPath)
      expect(persisted.endTime).toBeCloseTo(2.75, 4)
      expect(persisted.sampleModified).toBe(1)

      const fileContent = fs.readFileSync(originalPath)
      expect(fileContent.toString()).toContain('rendered-overwrite-data')
    })

    it('creates a new track and slice copy when mode is copy', async () => {
      const track = await createTestTrackWithAudio(app)
      const slice = await createTestSlice(track.id, {
        name: 'Copy Source',
        startTime: 0,
        endTime: 4,
      })

      const slicesDir = path.join(TEST_DATA_DIR, 'slices')
      const sourceSlicePath = path.join(slicesDir, 'copy-source.mp3')
      fs.writeFileSync(sourceSlicePath, Buffer.from('source-copy-audio'))

      const db = await getAppDb()
      db.prepare('UPDATE slices SET file_path = ? WHERE id = ?').run(sourceSlicePath, slice.id)

      const tagInsert = db.prepare('INSERT INTO tags (name, color, category) VALUES (?, ?, ?)').run('lab-test-tag', '#ffffff', 'general')
      const tagId = Number(tagInsert.lastInsertRowid)
      db.prepare('INSERT INTO slice_tags (slice_id, tag_id) VALUES (?, ?)').run(slice.id, tagId)

      const renderBuffer = Buffer.from('RIFF-rendered-copy-data')

      const res = await request(app)
        .post(`/api/slices/${slice.id}/render`)
        .field('mode', 'copy')
        .field('fileName', 'My Lab Copy.wav')
        .field('duration', '3.5')
        .attach('audio', renderBuffer, { filename: 'copy.wav', contentType: 'audio/wav' })

      expect(res.status).toBe(200)
      expect(res.body.mode).toBe('copy')
      expect(res.body.sourceSliceId).toBe(slice.id)
      expect(res.body.createdTrack).toBeTruthy()
      expect(res.body.slice).toBeTruthy()
      expect(res.body.slice.id).not.toBe(slice.id)
      expect(res.body.slice.trackId).toBe(res.body.createdTrack.id)
      expect(res.body.slice.name).toBe('My Lab Copy.wav')
      expect(res.body.slice.sampleModified).toBe(1)
      expect(res.body.slice.endTime).toBeCloseTo(3.5, 4)

      const createdTrackId = Number(res.body.createdTrack.id)
      const createdSliceId = Number(res.body.slice.id)

      const createdTrack = db
        .prepare('SELECT id, source, status, audio_path as audioPath, duration FROM tracks WHERE id = ?')
        .get(createdTrackId) as { id: number; source: string; status: string; audioPath: string; duration: number }

      expect(createdTrack.source).toBe('local')
      expect(createdTrack.status).toBe('ready')
      expect(createdTrack.duration).toBeCloseTo(3.5, 4)
      expect(fs.existsSync(createdTrack.audioPath)).toBe(true)

      const createdSlice = db
        .prepare('SELECT id, file_path as filePath, track_id as trackId, sample_modified as sampleModified FROM slices WHERE id = ?')
        .get(createdSliceId) as { id: number; filePath: string; trackId: number; sampleModified: number }

      expect(createdSlice.trackId).toBe(createdTrackId)
      expect(createdSlice.sampleModified).toBe(1)
      expect(fs.existsSync(createdSlice.filePath)).toBe(true)

      const createdFileContent = fs.readFileSync(createdSlice.filePath)
      expect(createdFileContent.toString()).toContain('rendered-copy-data')

      const copiedTagRows = db
        .prepare('SELECT tag_id as tagId FROM slice_tags WHERE slice_id = ?')
        .all(createdSliceId) as Array<{ tagId: number }>

      expect(copiedTagRows.some((row) => row.tagId === tagId)).toBe(true)
    })
  })
})
