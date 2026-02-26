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
