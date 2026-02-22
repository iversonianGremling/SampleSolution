import { Router } from 'express'
import fs from 'fs/promises'
import fss from 'fs'
import { google } from 'googleapis'
import {
  runBackup,
  runAllEnabledBackups,
  encryptConfig,
  decryptConfig,
  googleapisTokenToRclone,
  createDownloadArchive,
  type BackupConfig,
} from '../services/backup.js'
import { checkRcloneAvailable } from '../services/rclone.js'

const router = Router()
const FRONTEND_URL = () => process.env.FRONTEND_URL || 'http://localhost:3000'
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET
const GDRIVE_REDIRECT_URI = () =>
  process.env.GDRIVE_BACKUP_REDIRECT_URI ||
  `${process.env.API_URL || 'http://localhost:4000'}/api/backup/gdrive/callback`

let backupSchemaEnsured = false

// ── Helper: get raw DB synchronously ───────────────────────────────────────

function getDb() {
  // Avoid circular import by importing at call time
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getRawDb } = require('../db/index.js')
  const db = getRawDb() as import('better-sqlite3').Database
  ensureBackupSchema(db)
  return db
}

function ensureBackupSchema(db: import('better-sqlite3').Database) {
  if (backupSchemaEnsured) return

  db.exec(`
    CREATE TABLE IF NOT EXISTS backup_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      config_json TEXT NOT NULL DEFAULT '{}',
      remote_path TEXT NOT NULL DEFAULT 'sample_solution',
      schedule TEXT NOT NULL DEFAULT 'manual',
      last_backup_at TEXT,
      last_backup_status TEXT,
      last_backup_error TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS backup_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      config_id INTEGER REFERENCES backup_configs(id) ON DELETE CASCADE,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      bytes_transferred INTEGER DEFAULT 0,
      files_transferred INTEGER DEFAULT 0,
      error_message TEXT,
      details_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_backup_logs_config_id ON backup_logs(config_id);
    CREATE INDEX IF NOT EXISTS idx_backup_logs_created_at ON backup_logs(created_at);
  `)

  const configColumns = new Set(
    (db.prepare('PRAGMA table_info(backup_configs)').all() as Array<{ name: string }>).map((c) => c.name),
  )

  if (!configColumns.has('config_json')) db.exec("ALTER TABLE backup_configs ADD COLUMN config_json TEXT NOT NULL DEFAULT '{}'")
  if (!configColumns.has('remote_path')) db.exec("ALTER TABLE backup_configs ADD COLUMN remote_path TEXT NOT NULL DEFAULT 'sample_solution'")
  if (!configColumns.has('schedule')) db.exec("ALTER TABLE backup_configs ADD COLUMN schedule TEXT NOT NULL DEFAULT 'manual'")
  if (!configColumns.has('last_backup_at')) db.exec('ALTER TABLE backup_configs ADD COLUMN last_backup_at TEXT')
  if (!configColumns.has('last_backup_status')) db.exec('ALTER TABLE backup_configs ADD COLUMN last_backup_status TEXT')
  if (!configColumns.has('last_backup_error')) db.exec('ALTER TABLE backup_configs ADD COLUMN last_backup_error TEXT')
  if (!configColumns.has('created_at')) {
    db.exec("ALTER TABLE backup_configs ADD COLUMN created_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z'")
  }

  const logColumns = new Set(
    (db.prepare('PRAGMA table_info(backup_logs)').all() as Array<{ name: string }>).map((c) => c.name),
  )

  if (!logColumns.has('bytes_transferred')) db.exec('ALTER TABLE backup_logs ADD COLUMN bytes_transferred INTEGER DEFAULT 0')
  if (!logColumns.has('files_transferred')) db.exec('ALTER TABLE backup_logs ADD COLUMN files_transferred INTEGER DEFAULT 0')
  if (!logColumns.has('error_message')) db.exec('ALTER TABLE backup_logs ADD COLUMN error_message TEXT')
  if (!logColumns.has('details_json')) db.exec('ALTER TABLE backup_logs ADD COLUMN details_json TEXT')

  backupSchemaEnsured = true
}

// ── Config CRUD ────────────────────────────────────────────────────────────

// GET /api/backup/configs
router.get('/backup/configs', (_req, res) => {
  try {
    const db = getDb()
    const rows = db.prepare('SELECT * FROM backup_configs ORDER BY created_at DESC').all() as BackupConfig[]
    // Strip sensitive data from config_json before returning
    const safe = rows.map((r) => {
      const params = decryptConfig(r.config_json)
      const sanitized = sanitizeParams(r.type as BackupConfig['type'], params)
      return { ...r, config_json: undefined, params: sanitized }
    })
    res.json(safe)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/backup/configs
router.post('/backup/configs', (req, res) => {
  try {
    const { name, type, params, remote_path, schedule } = req.body as {
      name: string
      type: string
      params: Record<string, unknown>
      remote_path?: string
      schedule?: string
    }
    if (!name || !type || !params) return res.status(400).json({ error: 'name, type, params required' })

    const db = getDb()
    const encryptedConfig = encryptConfig(params)
    const now = new Date().toISOString()
    const result = db.prepare(`
      INSERT INTO backup_configs (name, type, enabled, config_json, remote_path, schedule, created_at)
      VALUES (?, ?, 1, ?, ?, ?, ?)
    `).run(name, type, encryptedConfig, remote_path || 'sample_solution', schedule || 'manual', now)

    const row = db.prepare('SELECT * FROM backup_configs WHERE id = ?').get(result.lastInsertRowid) as BackupConfig
    res.json({ ...row, config_json: undefined, params: sanitizeParams(type as BackupConfig['type'], params) })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/backup/configs/:id
router.put('/backup/configs/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    const { name, params, remote_path, schedule, enabled } = req.body as {
      name?: string
      params?: Record<string, unknown>
      remote_path?: string
      schedule?: string
      enabled?: boolean
    }
    const db = getDb()
    const existing = db.prepare('SELECT * FROM backup_configs WHERE id = ?').get(id) as BackupConfig | undefined
    if (!existing) return res.status(404).json({ error: 'Not found' })

    const encryptedConfig = params ? encryptConfig(params) : existing.config_json
    db.prepare(`
      UPDATE backup_configs SET
        name = ?,
        config_json = ?,
        remote_path = ?,
        schedule = ?,
        enabled = ?
      WHERE id = ?
    `).run(
      name ?? existing.name,
      encryptedConfig,
      remote_path ?? existing.remote_path,
      schedule ?? existing.schedule,
      enabled !== undefined ? (enabled ? 1 : 0) : existing.enabled,
      id,
    )

    const updated = db.prepare('SELECT * FROM backup_configs WHERE id = ?').get(id) as BackupConfig
    const resolvedParams = params ?? decryptConfig(existing.config_json)
    res.json({ ...updated, config_json: undefined, params: sanitizeParams(updated.type as BackupConfig['type'], resolvedParams) })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/backup/configs/:id
router.delete('/backup/configs/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    const db = getDb()
    db.prepare('DELETE FROM backup_configs WHERE id = ?').run(id)
    res.json({ success: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ── Run backups ────────────────────────────────────────────────────────────

// POST /api/backup/run/:id
router.post('/backup/run/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    const result = await runBackup(id)
    res.json(result)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/backup/run  (run all enabled)
router.post('/backup/run', async (_req, res) => {
  try {
    // Fire-and-forget; return immediately
    runAllEnabledBackups().catch((err) => console.error('[backup] run-all error:', err))
    res.json({ message: 'Backup started for all enabled configs' })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ── Logs ───────────────────────────────────────────────────────────────────

// GET /api/backup/logs?configId=&limit=
router.get('/backup/logs', (req, res) => {
  try {
    const configId = req.query.configId ? parseInt(req.query.configId as string, 10) : null
    const limit = Math.min(parseInt((req.query.limit as string) || '50', 10), 200)
    const db = getDb()
    const rows = configId
      ? db.prepare('SELECT * FROM backup_logs WHERE config_id = ? ORDER BY created_at DESC LIMIT ?').all(configId, limit)
      : db.prepare('SELECT * FROM backup_logs ORDER BY created_at DESC LIMIT ?').all(limit)
    res.json(rows)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ── Recovery key ───────────────────────────────────────────────────────────

// GET /api/backup/configs/:id/recovery-key
// Returns the restic repo password and the repo URL so users can restore
// without the app if needed. Store this somewhere safe!
router.get('/backup/configs/:id/recovery-key', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    const db = getDb()
    const row = db.prepare('SELECT * FROM backup_configs WHERE id = ?').get(id) as { config_json: string; type: string; remote_path: string; name: string } | undefined
    if (!row) return res.status(404).json({ error: 'Not found' })

    const params = decryptConfig(row.config_json)
    const repoPassword = params.repoPassword as string | undefined
    if (!repoPassword) {
      return res.status(404).json({ error: 'No recovery key yet — run a backup first to generate one.' })
    }

    // Build the repo URL for the user (so they can run restic manually)
    const repoUrl = buildRepoUrl(row.type, params, row.remote_path)

    res.json({
      name: row.name,
      repoPassword,
      repoUrl,
      restoreCommand: `RESTIC_PASSWORD="${repoPassword}" restic -r "${repoUrl}" restore latest --target /path/to/restore`,
      listCommand: `RESTIC_PASSWORD="${repoPassword}" restic -r "${repoUrl}" snapshots`,
      warning: 'Save this key somewhere safe. If you lose your database, you need this key to access your backup.',
    })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

function buildRepoUrl(type: string, params: Record<string, unknown>, remotePath: string): string {
  switch (type) {
    case 'local': return `${params.targetDir ?? '/data/backups'}/restic_repo`
    case 's3': {
      const host = (params.endpoint as string) || 's3.amazonaws.com'
      return `s3:${host}/${params.bucket ?? 'bucket'}/${remotePath}/restic_repo`
    }
    case 'sftp': return `sftp:${params.user ?? 'user'}@${params.host ?? 'host'}:${remotePath}/restic_repo`
    case 'gdrive': return `rclone:backup:${remotePath}/restic_repo  (rclone remote named 'backup', gdrive type)`
    case 'webdav': return `rclone:backup:${remotePath}/restic_repo  (rclone remote named 'backup', webdav url: ${params.url ?? ''})`
    default: return `unknown:${remotePath}/restic_repo`
  }
}

// ── Status summary ─────────────────────────────────────────────────────────

// GET /api/backup/status
router.get('/backup/status', async (_req, res) => {
  try {
    const db = getDb()
    const configs = db.prepare('SELECT id, name, type, enabled, remote_path, schedule, last_backup_at, last_backup_status, last_backup_error FROM backup_configs ORDER BY created_at DESC').all()
    const rcloneAvailable = await checkRcloneAvailable()
    res.json({ configs, rcloneAvailable })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ── Client-side download ───────────────────────────────────────────────────

// GET /api/backup/download?includeAudio=true
router.get('/backup/download', async (req, res) => {
  const includeAudio = req.query.includeAudio === 'true'
  let archivePath: string | null = null
  try {
    archivePath = await createDownloadArchive(includeAudio)
    const filename = `sample_solution_backup_${new Date().toISOString().slice(0, 10)}.zip`
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    const stat = await fs.stat(archivePath)
    res.setHeader('Content-Length', stat.size)
    const stream = fss.createReadStream(archivePath)
    stream.pipe(res)
    stream.on('end', () => {
      fs.rm(archivePath!, { force: true }).catch(() => {})
    })
    stream.on('error', () => {
      fs.rm(archivePath!, { force: true }).catch(() => {})
    })
  } catch (err: any) {
    if (archivePath) fs.rm(archivePath, { force: true }).catch(() => {})
    res.status(500).json({ error: err.message })
  }
})

// ── Google Drive OAuth for Backup ─────────────────────────────────────────

function createDriveOAuthClient() {
  return new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GDRIVE_REDIRECT_URI(),
  )
}

// GET /api/backup/gdrive/auth?configId=  (or without configId for new)
router.get('/backup/gdrive/auth', (req, res) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return res.status(400).json({ error: 'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in .env' })
  }
  const configId = req.query.configId as string | undefined
  const client = createDriveOAuthClient()
  const url = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/drive.appdata'],
    state: configId || 'new',
  })
  res.json({ authUrl: url })
})

// GET /api/backup/gdrive/callback  (OAuth redirect)
router.get('/backup/gdrive/callback', async (req, res) => {
  const { code, state } = req.query as { code: string; state: string }
  if (!code) return res.redirect(`${FRONTEND_URL()}?backup_error=no_code`)

  try {
    const client = createDriveOAuthClient()
    const { tokens } = await client.getToken(code)
    const rcloneToken = googleapisTokenToRclone(tokens)

    const db = getDb()

    if (state && state !== 'new') {
      // Update existing config
      const id = parseInt(state, 10)
      const existing = db.prepare('SELECT config_json FROM backup_configs WHERE id = ?').get(id) as { config_json: string } | undefined
      if (existing) {
        const currentParams = decryptConfig(existing.config_json) as Record<string, unknown>
        currentParams.token = rcloneToken
        currentParams.clientId = GOOGLE_CLIENT_ID
        currentParams.clientSecret = GOOGLE_CLIENT_SECRET
        db.prepare('UPDATE backup_configs SET config_json = ? WHERE id = ?').run(encryptConfig(currentParams), id)
        return res.redirect(`${FRONTEND_URL()}?backup_gdrive_linked=true&configId=${id}`)
      }
    }

    // Create new config
    const params = {
      clientId: GOOGLE_CLIENT_ID,
      clientSecret: GOOGLE_CLIENT_SECRET,
      token: rcloneToken,
      scope: 'drive.appdata',
    }
    const now = new Date().toISOString()
    const result = db.prepare(`
      INSERT INTO backup_configs (name, type, enabled, config_json, remote_path, schedule, created_at)
      VALUES (?, 'gdrive', 1, ?, 'sample_solution', 'daily', ?)
    `).run('Google Drive', encryptConfig(params), now)

    res.redirect(`${FRONTEND_URL()}?backup_gdrive_linked=true&configId=${result.lastInsertRowid}`)
  } catch (err: any) {
    console.error('[backup] Google Drive OAuth callback error:', err)
    res.redirect(`${FRONTEND_URL()}?backup_error=auth_failed`)
  }
})

// ── Helpers ────────────────────────────────────────────────────────────────

type BackendType = BackupConfig['type']

function sanitizeParams(_type: BackendType, params: Record<string, unknown>): Record<string, unknown> {
  const out = { ...params }
  // Redact sensitive fields
  if (out.token) out.token = '[stored]'
  if (out.pass) out.pass = '[stored]'
  if (out.secretAccessKey) out.secretAccessKey = '[stored]'
  if (out.clientSecret) out.clientSecret = '[stored]'
  return out
}

export default router
