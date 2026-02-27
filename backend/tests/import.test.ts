import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import fs from 'fs'
import path from 'path'
import type { Express } from 'express'
import { resetDatabase, TEST_DATA_DIR, getAppDb } from './setup.js'

async function createZipArchiveFromDirectory(sourceDir: string, zipPath: string, rootName: string): Promise<void> {
  const archiver = (await import('archiver')).default

  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(zipPath)
    const archive = archiver('zip', { zlib: { level: 6 } })

    output.on('close', resolve)
    archive.on('error', reject)
    archive.pipe(output)
    archive.directory(sourceDir, rootName)
    archive.finalize().catch(reject)
  })
}

describe('Import API', () => {
  let app: Express

  beforeEach(async () => {
    resetDatabase()
    const { createApp } = await import('../src/app.js')
    app = createApp({ dataDir: TEST_DATA_DIR })
  })

  it('returns method guidance for GET /api/import/files', async () => {
    const res = await request(app).get('/api/import/files?importType=sample&allowAiTagging=true')

    expect(res.status).toBe(405)
    expect(res.body.error).toBe('Method not allowed. Use POST /api/import/files with multipart/form-data.')
  })

  it('imports a single local file by absolute path reference without creating a copy', async () => {
    const sourcePath = path.join(TEST_DATA_DIR, 'electron-reference-single.wav')
    fs.writeFileSync(sourcePath, 'not-real-audio')

    const slicesDir = path.join(TEST_DATA_DIR, 'slices')
    const uploadsDir = path.join(TEST_DATA_DIR, 'uploads')
    const slicesBefore = fs.readdirSync(slicesDir)
    const uploadsBefore = fs.existsSync(uploadsDir) ? fs.readdirSync(uploadsDir) : []

    const res = await request(app)
      .post('/api/import/file?importType=sample')
      .send({ absolutePath: sourcePath })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.track?.source).toBe('local')

    const db = await getAppDb()
    const trackRow = db.prepare(`
      SELECT audio_path AS audioPath, original_path AS originalPath, full_path_hint AS fullPathHint
      FROM tracks
      ORDER BY id DESC
      LIMIT 1
    `).get() as { audioPath: string | null; originalPath: string | null; fullPathHint: string | null }

    const sliceRow = db.prepare(`
      SELECT file_path AS filePath
      FROM slices
      ORDER BY id DESC
      LIMIT 1
    `).get() as { filePath: string | null }

    expect(trackRow.audioPath).toBe(sourcePath)
    expect(trackRow.originalPath).toBe(sourcePath)
    expect(trackRow.fullPathHint).toBe(sourcePath)
    expect(sliceRow.filePath).toBe(sourcePath)

    const slicesAfter = fs.readdirSync(slicesDir)
    const uploadsAfter = fs.existsSync(uploadsDir) ? fs.readdirSync(uploadsDir) : []
    expect(slicesAfter).toEqual(slicesBefore)
    expect(uploadsAfter).toEqual(uploadsBefore)
  })

  it('imports multiple files by absolute path references without multipart uploads', async () => {
    const referenceRoot = path.join(TEST_DATA_DIR, 'electron-reference-batch')
    const nestedDir = path.join(referenceRoot, 'sub')
    fs.mkdirSync(nestedDir, { recursive: true })

    const firstPath = path.join(referenceRoot, 'kick.wav')
    const secondPath = path.join(nestedDir, 'snare.wav')
    fs.writeFileSync(firstPath, 'kick')
    fs.writeFileSync(secondPath, 'snare')

    const slicesDir = path.join(TEST_DATA_DIR, 'slices')
    const uploadsDir = path.join(TEST_DATA_DIR, 'uploads')
    const slicesBefore = fs.readdirSync(slicesDir)
    const uploadsBefore = fs.existsSync(uploadsDir) ? fs.readdirSync(uploadsDir) : []

    const res = await request(app)
      .post('/api/import/files?importType=sample')
      .send({
        referencePaths: [firstPath, secondPath],
        relativePaths: ['pack-root/kick.wav', 'pack-root/sub/snare.wav'],
      })

    expect(res.status).toBe(200)
    expect(res.body.total).toBe(2)
    expect(res.body.successful).toBe(2)
    expect(res.body.failed).toBe(0)

    const db = await getAppDb()
    const tracks = db.prepare(`
      SELECT audio_path AS audioPath, original_path AS originalPath, folder_path AS folderPath, relative_path AS relativePath
      FROM tracks
      ORDER BY id ASC
    `).all() as Array<{ audioPath: string | null; originalPath: string | null; folderPath: string | null; relativePath: string | null }>

    const importedTracks = tracks.filter((track) => track.audioPath === firstPath || track.audioPath === secondPath)
    expect(importedTracks).toHaveLength(2)

    const expectedFolderPath = referenceRoot.replace(/\\/g, '/')
    expect(importedTracks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        audioPath: firstPath,
        originalPath: firstPath,
        folderPath: expectedFolderPath,
        relativePath: 'kick.wav',
      }),
      expect.objectContaining({
        audioPath: secondPath,
        originalPath: secondPath,
        folderPath: expectedFolderPath,
        relativePath: 'sub/snare.wav',
      }),
    ]))

    const slices = db.prepare(`
      SELECT file_path AS filePath
      FROM slices
      ORDER BY id ASC
    `).all() as Array<{ filePath: string | null }>
    expect(slices.some((slice) => slice.filePath === firstPath)).toBe(true)
    expect(slices.some((slice) => slice.filePath === secondPath)).toBe(true)

    const slicesAfter = fs.readdirSync(slicesDir)
    const uploadsAfter = fs.existsSync(uploadsDir) ? fs.readdirSync(uploadsDir) : []
    expect(slicesAfter).toEqual(slicesBefore)
    expect(uploadsAfter).toEqual(uploadsBefore)
  })

  it('creates a folder inside an imported source root and exposes it in sources tree', async () => {
    const importedRoot = path.join(TEST_DATA_DIR, 'import-root')
    const existingFolder = path.join(importedRoot, 'existing')
    fs.mkdirSync(existingFolder, { recursive: true })

    const db = await getAppDb()
    const now = new Date().toISOString()

    const trackInsert = db.prepare(`
      INSERT INTO tracks (
        youtube_id, title, description, thumbnail_url, duration, status, source, folder_path, relative_path, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `local-import-test-${Date.now()}`,
      'Imported sample',
      '',
      '',
      1,
      'ready',
      'local',
      importedRoot,
      'existing/kick.wav',
      now
    )

    db.prepare(`
      INSERT INTO slices (track_id, name, start_time, end_time, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(trackInsert.lastInsertRowid as number, 'Kick', 0, 1, now)

    const createRes = await request(app)
      .post('/api/import/folders')
      .send({ parentPath: importedRoot, name: 'new-subfolder' })

    expect(createRes.status).toBe(200)
    expect(createRes.body.success).toBe(true)

    const createdPath = path.join(importedRoot, 'new-subfolder')
    expect(fs.existsSync(createdPath)).toBe(true)

    const treeRes = await request(app).get('/api/sources/tree')
    expect(treeRes.status).toBe(200)

    const findNodeByPath = (
      nodes: Array<{ path: string; children: any[] }>,
      expectedPath: string
    ): { path: string; children: any[] } | undefined => {
      for (const node of nodes) {
        if (node.path === expectedPath) return node
        const child = findNodeByPath(node.children || [], expectedPath)
        if (child) return child
      }
      return undefined
    }

    const createdNode = findNodeByPath(treeRes.body.folders, createdPath)
    expect(createdNode).toBeTruthy()
  })

  it('rejects creating folders outside imported roots', async () => {
    const importedRoot = path.join(TEST_DATA_DIR, 'safe-root')
    const outsidePath = path.join(TEST_DATA_DIR, 'outside-root')
    fs.mkdirSync(importedRoot, { recursive: true })
    fs.mkdirSync(outsidePath, { recursive: true })

    const db = await getAppDb()
    const now = new Date().toISOString()

    const trackInsert = db.prepare(`
      INSERT INTO tracks (
        youtube_id, title, description, thumbnail_url, duration, status, source, folder_path, relative_path, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `local-import-safe-${Date.now()}`,
      'Imported sample',
      '',
      '',
      1,
      'ready',
      'local',
      importedRoot,
      'kick.wav',
      now
    )

    db.prepare(`
      INSERT INTO slices (track_id, name, start_time, end_time, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(trackInsert.lastInsertRowid as number, 'Kick', 0, 1, now)

    const res = await request(app)
      .post('/api/import/folders')
      .send({ parentPath: outsidePath, name: 'should-fail' })

    expect(res.status).toBe(403)
    expect(res.body.error).toBe('parentPath must be inside an imported source folder')
    expect(fs.existsSync(path.join(outsidePath, 'should-fail'))).toBe(false)
  })

  it('imports a backup ZIP by extracting it and replacing the library', async () => {
    // Ensure database file exists in test data dir.
    await getAppDb()

    const sourcePackageDir = path.join(TEST_DATA_DIR, 'zip-library-source')
    fs.mkdirSync(path.join(sourcePackageDir, 'slices'), { recursive: true })
    fs.mkdirSync(path.join(sourcePackageDir, 'peaks'), { recursive: true })

    fs.copyFileSync(
      path.join(TEST_DATA_DIR, 'database.sqlite'),
      path.join(sourcePackageDir, 'database.sqlite')
    )
    fs.writeFileSync(
      path.join(sourcePackageDir, 'library-manifest.json'),
      JSON.stringify({
        version: 1,
        exportedAt: new Date().toISOString(),
        includes: {
          database: 'database.sqlite',
          directories: ['audio', 'slices', 'peaks', 'uploads'],
          optionalFiles: ['learned_weights.json'],
        },
      }, null, 2),
      'utf-8'
    )

    const zipPath = path.join(TEST_DATA_DIR, 'library-backup.zip')
    await createZipArchiveFromDirectory(sourcePackageDir, zipPath, 'backup-folder')

    const res = await request(app)
      .post('/api/library/import')
      .send({ libraryPath: zipPath })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.importedFrom).toBe(zipPath)
    expect(res.body.extractedFromZip).toBe(true)
    expect(typeof res.body.resolvedLibraryPath).toBe('string')
    expect(fs.existsSync(res.body.backupPath)).toBe(true)
  })
})
