/**
 * Backup service
 *
 * Uses restic for all remote and local backups:
 *   • Incremental  – only new/changed content chunks are uploaded
 *   • Compressed   – zstd (--compression auto: skips already-compressed files)
 *   • Deduplicated – content-defined chunking; identical audio segments stored once
 *   • Encrypted    – AES-256 + Poly1305, key unique per config
 *
 * Transport layer:
 *   gdrive / webdav → restic's rclone backend (rclone handles the protocol)
 *   s3              → restic native S3 (faster, no rclone needed)
 *   sftp            → restic native SFTP
 *   local           → restic local repo (rolling snapshot window)
 *
 * Client-side download (browser ZIP) still uses archiver, unchanged.
 */

import fs from 'fs/promises'
import fss from 'fs'
import path from 'path'
import crypto from 'crypto'
import { getRawDb } from '../db/index.js'
import {
  buildResticBackend,
  resticInit,
  resticBackup,
  resticForget,
  generateRepoPassword,
  checkResticAvailable,
  type ResticResult,
} from './restic.js'

// ── Types ──────────────────────────────────────────────────────────────────

export type BackupType = 'gdrive' | 'webdav' | 's3' | 'sftp' | 'local'
export type BackupSchedule = 'manual' | 'hourly' | 'daily' | 'weekly'

export interface BackupConfig {
  id: number
  name: string
  type: BackupType
  enabled: number
  config_json: string
  remote_path: string
  schedule: BackupSchedule
  last_backup_at: string | null
  last_backup_status: string | null
  last_backup_error: string | null
  created_at: string
}

export interface BackupResult {
  success: boolean
  bytesTransferred: number
  filesTransferred: number
  errorMessage?: string
  details: Record<string, unknown>
}

// ── Encryption helpers (AES-256-GCM) ──────────────────────────────────────

function getEncryptionKey(): Buffer {
  const secret = process.env.SESSION_SECRET || 'dev-secret-change-me'
  return crypto.createHash('sha256').update(secret).digest()
}

export function encryptConfig(obj: Record<string, unknown>): string {
  const key = getEncryptionKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const plain = JSON.stringify(obj)
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted]).toString('base64')
}

export function decryptConfig(encoded: string): Record<string, unknown> {
  try {
    const buf = Buffer.from(encoded, 'base64')
    const iv = buf.subarray(0, 12)
    const tag = buf.subarray(12, 28)
    const encrypted = buf.subarray(28)
    const key = getEncryptionKey()
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
    return JSON.parse(plain)
  } catch {
    try { return JSON.parse(encoded) } catch { return {} }
  }
}

// ── SQLite snapshot ────────────────────────────────────────────────────────

const DATA_DIR = () => process.env.DATA_DIR || './data'

async function createSQLiteSnapshot(destPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const raw = getRawDb()
    raw.backup(destPath)
      .then(() => resolve())
      .catch(reject)
  })
}

// ── Log helpers ────────────────────────────────────────────────────────────

function getSqlite() {
  return getRawDb()
}

function logStart(configId: number): number {
  const db = getSqlite()
  const now = new Date().toISOString()
  const result = db.prepare(`
    INSERT INTO backup_logs (config_id, started_at, status, created_at)
    VALUES (?, ?, 'running', ?)
  `).run(configId, now, now)
  return result.lastInsertRowid as number
}

function logFinish(logId: number, result: BackupResult): void {
  const db = getSqlite()
  db.prepare(`
    UPDATE backup_logs SET
      completed_at = ?,
      status = ?,
      bytes_transferred = ?,
      files_transferred = ?,
      error_message = ?,
      details_json = ?
    WHERE id = ?
  `).run(
    new Date().toISOString(),
    result.success ? 'success' : 'failed',
    result.bytesTransferred,
    result.filesTransferred,
    result.errorMessage ?? null,
    JSON.stringify(result.details),
    logId,
  )
}

function updateConfigStatus(configId: number, success: boolean, errorMsg?: string): void {
  const db = getSqlite()
  db.prepare(`
    UPDATE backup_configs SET
      last_backup_at = ?,
      last_backup_status = ?,
      last_backup_error = ?
    WHERE id = ?
  `).run(
    new Date().toISOString(),
    success ? 'success' : 'failed',
    errorMsg ?? null,
    configId,
  )
}

// ── Core backup runner (all backends share this) ───────────────────────────

/**
 * Snapshot SQLite to a temp file, then run `restic backup` over:
 *   /tmp/snapshot/database.sqlite  (the consistent DB copy)
 *   DATA_DIR/slices/
 *   DATA_DIR/audio/
 *   DATA_DIR/peaks/
 *
 * restic handles the rest: dedup, zstd compression, incremental upload.
 */
async function runResticBackup(
  config: BackupConfig,
  params: Record<string, unknown>,
): Promise<BackupResult> {
  const available = await checkResticAvailable()
  if (!available) {
    return { success: false, bytesTransferred: 0, filesTransferred: 0, errorMessage: 'restic binary not found in PATH', details: {} }
  }

  const dataDir = DATA_DIR()
  const tmpDir = path.join(dataDir, `.backup_tmp_${config.id}`)
  await fs.mkdir(tmpDir, { recursive: true })

  let backend
  try {
    // Ensure the repo password exists in config; generate one if missing
    const repoPassword = (params.repoPassword as string) || generateRepoPassword()
    if (!params.repoPassword) {
      // Persist the generated password back to the config
      const db = getSqlite()
      const updated = { ...params, repoPassword }
      db.prepare('UPDATE backup_configs SET config_json = ? WHERE id = ?')
        .run(encryptConfig(updated), config.id)
      params = updated
    }

    backend = await buildResticBackend(config.type, params, config.remote_path, repoPassword)

    // Init repo (idempotent)
    await resticInit(backend)

    // SQLite snapshot into tmp dir so restic sees it as a normal file
    const snapshotPath = path.join(tmpDir, 'database.sqlite')
    await createSQLiteSnapshot(snapshotPath)

    // Collect paths to back up
    const backupPaths: string[] = [snapshotPath]
    for (const dir of ['slices', 'audio', 'peaks']) {
      const p = path.join(dataDir, dir)
      if (fss.existsSync(p)) backupPaths.push(p)
    }

    // Run incremental compressed backup
    const result: ResticResult = await resticBackup(backend, backupPaths, [`config:${config.id}`])

    // Prune old snapshots (keep last 30 by default)
    await resticForget(backend, 30).catch((err) =>
      console.warn(`[backup] prune failed for config ${config.id}:`, err),
    )

    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})

    return {
      success: result.success,
      bytesTransferred: result.dataBytesAdded,
      filesTransferred: result.filesNew + result.filesChanged,
      errorMessage: result.error,
      details: {
        filesNew: result.filesNew,
        filesChanged: result.filesChanged,
        filesUnmodified: result.filesUnmodified,
        dataBytesProcessed: result.dataBytesProcessed,
        dataBytesAdded: result.dataBytesAdded,
        compressionRatio: result.compressionRatio,
        snapshotId: result.snapshotId,
      },
    }
  } catch (err: any) {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    return { success: false, bytesTransferred: 0, filesTransferred: 0, errorMessage: err.message, details: {} }
  } finally {
    await backend?.cleanup?.()
  }
}

// ── Public: run a backup by config ID ─────────────────────────────────────

export async function runBackup(configId: number): Promise<BackupResult> {
  const db = getSqlite()
  const row = db.prepare('SELECT * FROM backup_configs WHERE id = ?').get(configId) as BackupConfig | undefined
  if (!row) return { success: false, bytesTransferred: 0, filesTransferred: 0, errorMessage: 'Config not found', details: {} }

  db.prepare(`UPDATE backup_configs SET last_backup_status = 'running' WHERE id = ?`).run(configId)
  const logId = logStart(configId)

  const params = decryptConfig(row.config_json)
  let result: BackupResult

  try {
    result = await runResticBackup(row, params)
  } catch (err: any) {
    result = { success: false, bytesTransferred: 0, filesTransferred: 0, errorMessage: err.message, details: {} }
  }

  logFinish(logId, result)
  updateConfigStatus(configId, result.success, result.errorMessage)
  return result
}

export async function runAllEnabledBackups(): Promise<void> {
  const db = getSqlite()
  const configs = db.prepare(`SELECT id FROM backup_configs WHERE enabled = 1`).all() as { id: number }[]
  for (const { id } of configs) {
    await runBackup(id).catch((err) => console.error(`[backup] config ${id} failed:`, err))
  }
}

// ── Scheduler ─────────────────────────────────────────────────────────────

const SCHEDULE_MS: Record<string, number> = {
  hourly: 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
}

export function startBackupScheduler(): void {
  setInterval(async () => {
    try {
      const db = getSqlite()
      const configs = db.prepare(
        `SELECT * FROM backup_configs WHERE enabled = 1 AND schedule != 'manual'`
      ).all() as BackupConfig[]
      const now = Date.now()
      for (const cfg of configs) {
        const interval = SCHEDULE_MS[cfg.schedule]
        if (!interval) continue
        const lastRun = cfg.last_backup_at ? new Date(cfg.last_backup_at).getTime() : 0
        if (now - lastRun >= interval) {
          console.log(`[backup] Scheduled backup: config ${cfg.id} (${cfg.name})`)
          runBackup(cfg.id).catch((err) => console.error(`[backup] Scheduled run failed for ${cfg.id}:`, err))
        }
      }
    } catch (err) {
      console.error('[backup] Scheduler error:', err)
    }
  }, 5 * 60 * 1000)
}

// ── Google Drive OAuth token conversion ───────────────────────────────────

/**
 * Convert a googleapis token to rclone's expected JSON format.
 * googleapis: { access_token, refresh_token, expiry_date (ms) }
 * rclone:     { access_token, token_type, refresh_token, expiry (RFC3339) }
 */
export function googleapisTokenToRclone(tokens: {
  access_token?: string | null
  refresh_token?: string | null
  token_type?: string | null
  expiry_date?: number | null
}): string {
  return JSON.stringify({
    access_token: tokens.access_token ?? '',
    token_type: tokens.token_type ?? 'Bearer',
    refresh_token: tokens.refresh_token ?? '',
    expiry: tokens.expiry_date
      ? new Date(tokens.expiry_date).toISOString()
      : new Date(Date.now() + 3600 * 1000).toISOString(),
  })
}

// ── Client-side download archive ──────────────────────────────────────────

export async function createDownloadArchive(includeAudio = false): Promise<string> {
  const archiver = (await import('archiver')).default
  const dataDir = DATA_DIR()
  const tmpPath = path.join(dataDir, `.download_${Date.now()}.zip`)

  await new Promise<void>((resolve, reject) => {
    const output = fss.createWriteStream(tmpPath)
    const archive = archiver('zip', { zlib: { level: 6 } })

    output.on('close', resolve)
    archive.on('error', reject)
    archive.pipe(output)

    const snapshotPath = path.join(dataDir, '.dl_snapshot.sqlite')
    getRawDb().backup(snapshotPath).then(() => {
      archive.file(snapshotPath, { name: 'database.sqlite' })
      archive.directory(path.join(dataDir, 'slices'), 'slices')
      archive.directory(path.join(dataDir, 'peaks'), 'peaks')
      if (includeAudio) archive.directory(path.join(dataDir, 'audio'), 'audio')
      archive.append(
        JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), includesAudio: includeAudio }, null, 2),
        { name: 'library-manifest.json' },
      )
      archive.finalize()
    }).catch(reject)
  })

  await fs.rm(path.join(dataDir, '.dl_snapshot.sqlite'), { force: true }).catch(() => {})
  return tmpPath
}
