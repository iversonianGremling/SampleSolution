/**
 * restic service
 *
 * restic provides incremental + deduplicated + compressed (zstd) backups.
 * It runs on top of several backends:
 *   local  – direct filesystem path
 *   s3     – native S3/B2/R2/Wasabi support (fast, no rclone needed)
 *   sftp   – native SFTP support
 *   rclone – restic uses rclone as a subprocess for Google Drive & WebDAV
 *
 * Compression note:
 *   --compression auto  skips data that's already compressed (MP3, FLAC, etc.)
 *   --compression max   always tries (best for WAV / SQLite / mixed libraries)
 *   We use 'auto' by default — it detects compressibility per-chunk.
 *
 * Deduplication:
 *   restic uses content-defined chunking (~4 MB average) with SHA-256 hashes.
 *   If two samples share audio segments, the chunks are only stored once.
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import crypto from 'crypto'

const execFileAsync = promisify(execFile)

export interface ResticResult {
  success: boolean
  /** New files added this run */
  filesNew: number
  /** Files changed since last snapshot */
  filesChanged: number
  /** Files identical to last snapshot (skipped) */
  filesUnmodified: number
  /** Total bytes scanned */
  dataBytesProcessed: number
  /** Bytes actually written to repo (compressed + deduped) */
  dataBytesAdded: number
  /** Compression ratio = dataBytesProcessed / dataBytesAdded */
  compressionRatio?: number
  snapshotId?: string
  error?: string
}

// ── restic executor ────────────────────────────────────────────────────────

async function resticExec(
  args: string[],
  env: Record<string, string>,
  timeoutMs = 60 * 60 * 1000,
): Promise<{ success: boolean; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('restic', ['--json', ...args], {
      env: { ...process.env, ...env },
      timeout: timeoutMs,
      maxBuffer: 20 * 1024 * 1024,
    })
    return { success: true, stdout, stderr }
  } catch (err: any) {
    return { success: false, stdout: err.stdout || '', stderr: err.stderr || err.message || '' }
  }
}

export async function checkResticAvailable(): Promise<boolean> {
  try {
    await execFileAsync('restic', ['version'])
    return true
  } catch {
    return false
  }
}

// ── rclone config file generator (for gdrive / webdav backends) ────────────

interface TempRcloneConfig {
  configPath: string
  remoteName: string
  cleanup: () => Promise<void>
}

async function writeTempRcloneConfig(
  type: 'gdrive' | 'webdav',
  params: Record<string, unknown>,
): Promise<TempRcloneConfig> {
  const remoteName = 'backup'
  let lines: string[] = [`[${remoteName}]`]

  if (type === 'gdrive') {
    lines = lines.concat([
      'type = drive',
      `client_id = ${params.clientId ?? ''}`,
      `client_secret = ${params.clientSecret ?? ''}`,
      `token = ${typeof params.token === 'string' ? params.token : JSON.stringify(params.token)}`,
      `scope = ${params.scope ?? 'drive.appdata'}`,
      'root_folder_id = appDataFolder',
    ])
  } else {
    lines = lines.concat([
      'type = webdav',
      `url = ${params.url ?? ''}`,
      `vendor = ${params.vendor ?? 'nextcloud'}`,
      `user = ${params.user ?? ''}`,
      `pass = ${params.pass ?? ''}`,
    ])
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ssol-rclone-'))
  const configPath = path.join(tmpDir, 'rclone.conf')
  await fs.writeFile(configPath, lines.join('\n') + '\n', { mode: 0o600 })

  return {
    configPath,
    remoteName,
    cleanup: () => fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {}),
  }
}

// ── Backend config builder ─────────────────────────────────────────────────

export interface ResticBackend {
  repo: string
  env: Record<string, string>
  /** Call after backup completes to delete temp rclone config */
  cleanup?: () => Promise<void>
}

/**
 * Build a restic repository string and the environment variables needed to
 * access it, for each backend type.
 */
export async function buildResticBackend(
  type: string,
  params: Record<string, unknown>,
  remotePath: string,
  repoPassword: string,
): Promise<ResticBackend> {
  const baseEnv: Record<string, string> = {
    RESTIC_PASSWORD: repoPassword,
  }

  switch (type) {
    case 'local': {
      const targetDir = (params.targetDir as string) || '/tmp/restic_backup'
      return { repo: path.join(targetDir, 'restic_repo'), env: baseEnv }
    }

    case 's3': {
      const { accessKeyId = '', secretAccessKey = '', region = 'auto', endpoint = '', bucket = '' } = params as Record<string, string>
      // restic s3 format: s3:endpoint/bucket/path  OR  s3:s3.amazonaws.com/bucket/path
      const host = endpoint || `s3.amazonaws.com`
      const repo = `s3:${host}/${bucket}/${remotePath}/restic_repo`
      return {
        repo,
        env: {
          ...baseEnv,
          AWS_ACCESS_KEY_ID: accessKeyId,
          AWS_SECRET_ACCESS_KEY: secretAccessKey,
          AWS_DEFAULT_REGION: region,
        },
      }
    }

    case 'sftp': {
      const { host = '', user = '', port = 22 } = params as Record<string, string | number>
      // restic sftp format: sftp:user@host:/path
      const portFlag = port && Number(port) !== 22 ? `-p ${port}` : ''
      const repo = `sftp:${user}@${host}:${remotePath}/restic_repo`
      return {
        repo,
        env: {
          ...baseEnv,
          // Pass SSH options for non-standard ports / no host checking in containers
          RESTIC_SFTP_COMMAND: `ssh -o StrictHostKeyChecking=no ${portFlag || ''}`.trim(),
        },
      }
    }

    case 'gdrive':
    case 'webdav': {
      const { configPath, remoteName, cleanup } = await writeTempRcloneConfig(
        type as 'gdrive' | 'webdav',
        params,
      )
      return {
        repo: `rclone:${remoteName}:${remotePath}/restic_repo`,
        env: { ...baseEnv, RCLONE_CONFIG: configPath },
        cleanup,
      }
    }

    default:
      throw new Error(`Unknown backup type: ${type}`)
  }
}

// ── restic operations ──────────────────────────────────────────────────────

/**
 * Initialize a restic repository. Safe to call multiple times — skips if
 * the repo already exists.
 */
export async function resticInit(backend: ResticBackend): Promise<void> {
  // `restic snapshots` returns exit code 0 if repo exists, non-zero if not
  const check = await resticExec(['snapshots', '-r', backend.repo], backend.env)
  if (check.success) return  // already initialized

  const init = await resticExec(['init', '-r', backend.repo], backend.env)
  if (!init.success) {
    // Might already be initialized by a race — one final check
    const recheck = await resticExec(['snapshots', '-r', backend.repo], backend.env)
    if (!recheck.success) {
      throw new Error(`restic init failed: ${init.stderr.slice(0, 400)}`)
    }
  }
}

/**
 * Run an incremental compressed backup.
 *
 * restic automatically:
 *   • skips unchanged chunks (deduplication)
 *   • compresses with zstd (--compression auto)
 *   • only uploads new/changed chunks (incremental)
 */
export async function resticBackup(
  backend: ResticBackend,
  paths: string[],
  tags: string[] = [],
  compressionLevel: 'auto' | 'max' | 'off' = 'auto',
): Promise<ResticResult> {
  const args = [
    'backup',
    '-r', backend.repo,
    `--compression=${compressionLevel}`,
    '--exclude-caches',
    '--one-file-system',
    ...tags.flatMap((t) => ['--tag', t]),
    ...paths,
  ]

  const res = await resticExec(args, backend.env)

  if (!res.success) {
    return {
      success: false,
      filesNew: 0, filesChanged: 0, filesUnmodified: 0,
      dataBytesProcessed: 0, dataBytesAdded: 0,
      error: res.stderr.slice(0, 600),
    }
  }

  // Parse the JSON summary line from stdout
  const summary = parseResticSummary(res.stdout)
  if (!summary) {
    return { success: true, filesNew: 0, filesChanged: 0, filesUnmodified: 0, dataBytesProcessed: 0, dataBytesAdded: 0 }
  }

  const processed = (summary.total_bytes_processed as number) ?? 0
  const added = (summary.data_added as number) ?? 0
  return {
    success: true,
    filesNew: (summary.files_new as number) ?? 0,
    filesChanged: (summary.files_changed as number) ?? 0,
    filesUnmodified: (summary.files_unmodified as number) ?? 0,
    dataBytesProcessed: processed,
    dataBytesAdded: added,
    compressionRatio: added > 0 && processed > 0 ? processed / added : undefined,
    snapshotId: (summary.snapshot_id as string) ?? undefined,
  }
}

/**
 * Remove old snapshots and free up space.
 * Keeps the last `keepLast` snapshots; prunes unreferenced data.
 */
export async function resticForget(
  backend: ResticBackend,
  keepLast = 30,
): Promise<void> {
  await resticExec(
    ['forget', '-r', backend.repo, '--keep-last', String(keepLast), '--prune'],
    backend.env,
  )
}

/** List snapshots for a repo (useful for UI status display). */
export async function resticSnapshots(backend: ResticBackend): Promise<unknown[]> {
  const res = await resticExec(['snapshots', '-r', backend.repo], backend.env)
  if (!res.success) return []
  try { return JSON.parse(res.stdout) } catch { return [] }
}

// ── Parser helpers ─────────────────────────────────────────────────────────

function parseResticSummary(stdout: string): Record<string, unknown> | null {
  const lines = stdout.trim().split('\n').filter(Boolean)
  // restic --json emits one JSON object per line; the last is the summary
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const obj = JSON.parse(lines[i])
      if (obj.message_type === 'summary') return obj
    } catch { /* continue */ }
  }
  return null
}

// ── Password derivation ────────────────────────────────────────────────────

/**
 * Derive a stable, unique restic repository password from the config ID.
 * Stored encrypted inside config_json so changing SESSION_SECRET doesn't
 * break existing repos.
 */
export function generateRepoPassword(): string {
  return crypto.randomBytes(32).toString('hex')
}
