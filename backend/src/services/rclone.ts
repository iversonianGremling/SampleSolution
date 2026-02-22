import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export interface RcloneResult {
  success: boolean
  stdout: string
  stderr: string
  bytesTransferred?: number
  filesTransferred?: number
}

export async function checkRcloneAvailable(): Promise<boolean> {
  try {
    await execFileAsync('rclone', ['version'])
    return true
  } catch {
    return false
  }
}

async function rcloneExec(args: string[], timeoutMs = 30 * 60 * 1000): Promise<RcloneResult> {
  try {
    const { stdout, stderr } = await execFileAsync('rclone', args, { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 })
    const bytes = parseStatFromLogs(stderr, 'Transferred:')
    const files = parseTransferCount(stderr)
    return { success: true, stdout, stderr, bytesTransferred: bytes, filesTransferred: files }
  } catch (err: any) {
    return {
      success: false,
      stdout: err.stdout || '',
      stderr: err.stderr || err.message || '',
    }
  }
}

function parseStatFromLogs(log: string, _label: string): number | undefined {
  // rclone --stats-one-line outputs: "1.234 GiB / 1.234 GiB, 100%, ..."
  const match = log.match(/Transferred:\s+([\d.]+)\s*([KMGT]?i?B)/i)
  if (!match) return undefined
  const val = parseFloat(match[1])
  const unit = match[2].toUpperCase()
  const multipliers: Record<string, number> = { B: 1, KB: 1e3, KIB: 1024, MB: 1e6, MIB: 1024 ** 2, GB: 1e9, GIB: 1024 ** 3, TB: 1e12, TIB: 1024 ** 4 }
  return Math.round(val * (multipliers[unit] || 1))
}

function parseTransferCount(log: string): number | undefined {
  const match = log.match(/Transferred:\s+(\d+)\s*\/\s*\d+/i)
  return match ? parseInt(match[1], 10) : undefined
}

// ── Backend flag builders ──────────────────────────────────────────────────

export interface GdriveConfig {
  clientId: string
  clientSecret: string
  token: string  // rclone JSON token: { access_token, token_type, refresh_token, expiry }
  scope?: string // default: drive.appdata
}

export function buildGdriveFlags(cfg: GdriveConfig): string[] {
  const scope = cfg.scope ?? 'drive.appdata'
  const flags = [
    `--drive-client-id=${cfg.clientId}`,
    `--drive-client-secret=${cfg.clientSecret}`,
    `--drive-token=${cfg.token}`,
    `--drive-scope=${scope}`,
    '--drive-use-trash=false',
  ]
  if (scope === 'drive.appdata') {
    flags.push('--drive-root-folder-id=appDataFolder')
  }
  return flags
}

export interface WebdavConfig {
  url: string
  vendor: 'nextcloud' | 'owncloud' | 'other'
  user?: string
  pass?: string  // rclone obscured password (use rclone obscure) or plain
}

export function buildWebdavFlags(cfg: WebdavConfig): string[] {
  const flags = [
    `--webdav-url=${cfg.url}`,
    `--webdav-vendor=${cfg.vendor}`,
  ]
  if (cfg.user) flags.push(`--webdav-user=${cfg.user}`)
  if (cfg.pass) flags.push(`--webdav-pass=${cfg.pass}`)
  return flags
}

export interface S3Config {
  provider: 'AWS' | 'Backblaze' | 'Cloudflare' | 'Wasabi' | 'DigitalOcean' | 'Other'
  accessKeyId: string
  secretAccessKey: string
  region?: string
  endpoint?: string  // for non-AWS providers
  bucket: string
}

export function buildS3Flags(cfg: S3Config): string[] {
  const flags = [
    `--s3-provider=${cfg.provider}`,
    `--s3-access-key-id=${cfg.accessKeyId}`,
    `--s3-secret-access-key=${cfg.secretAccessKey}`,
  ]
  if (cfg.region) flags.push(`--s3-region=${cfg.region}`)
  if (cfg.endpoint) flags.push(`--s3-endpoint=${cfg.endpoint}`)
  return flags
}

export interface SftpConfig {
  host: string
  port?: number
  user: string
  pass?: string
  keyFile?: string
}

export function buildSftpFlags(cfg: SftpConfig): string[] {
  const flags = [
    `--sftp-host=${cfg.host}`,
    `--sftp-user=${cfg.user}`,
    '--sftp-known-hosts-file=/dev/null',
    '--sftp-host-key-algorithms=ssh-rsa,ssh-ed25519,ecdsa-sha2-nistp256',
  ]
  if (cfg.port && cfg.port !== 22) flags.push(`--sftp-port=${cfg.port}`)
  if (cfg.pass) flags.push(`--sftp-pass=${cfg.pass}`)
  if (cfg.keyFile) flags.push(`--sftp-key-file=${cfg.keyFile}`)
  return flags
}

// ── Core rclone operations ─────────────────────────────────────────────────

type BackendType = 'gdrive' | 'webdav' | 's3' | 'sftp'

function remotePrefix(type: BackendType): string {
  const map: Record<BackendType, string> = {
    gdrive: ':drive',
    webdav: ':webdav',
    s3: ':s3',
    sftp: ':sftp',
  }
  return map[type]
}

/**
 * Incremental copy: uploads only new or changed files (by size+mtime, with
 * --checksum for hash verification). Never deletes on destination.
 */
export async function rcloneCopy(
  srcPath: string,
  type: BackendType,
  destPath: string,
  backendFlags: string[],
): Promise<RcloneResult> {
  const dst = `${remotePrefix(type)}:${destPath}`
  return rcloneExec([
    'copy',
    srcPath,
    dst,
    '--checksum',
    '--transfers=4',
    '--stats=1s',
    '--stats-one-line',
    '--no-traverse',
    ...backendFlags,
  ])
}

/**
 * Copy a single file to a remote destination directory.
 */
export async function rcloneCopyFile(
  srcFile: string,
  type: BackendType,
  destDir: string,
  backendFlags: string[],
): Promise<RcloneResult> {
  const dst = `${remotePrefix(type)}:${destDir}`
  return rcloneExec([
    'copyto',
    srcFile,
    dst,
    '--checksum',
    ...backendFlags,
  ])
}

/**
 * For S3: srcPath is local, destPath is "bucket/path/to/dir"
 */
export async function rcloneCopyS3(
  srcPath: string,
  cfg: S3Config,
  destSubPath: string,
): Promise<RcloneResult> {
  const dst = `:s3:${cfg.bucket}/${destSubPath}`
  return rcloneExec([
    'copy',
    srcPath,
    dst,
    '--checksum',
    '--transfers=4',
    '--stats-one-line',
    ...buildS3Flags(cfg),
  ])
}

export async function rcloneCopyFileS3(
  srcFile: string,
  cfg: S3Config,
  destKey: string,
): Promise<RcloneResult> {
  const dst = `:s3:${cfg.bucket}/${destKey}`
  return rcloneExec([
    'copyto',
    srcFile,
    dst,
    '--checksum',
    ...buildS3Flags(cfg),
  ])
}

/**
 * Obscure a plaintext password for use with rclone --sftp-pass or --webdav-pass.
 * rclone uses its own reversible obscuring (not encryption), purely to avoid
 * storing plaintext in config files. We store encrypted in our DB, so we call
 * this right before passing to rclone.
 */
export async function rcloneObscure(plaintext: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('rclone', ['obscure', plaintext])
    return stdout.trim()
  } catch {
    return plaintext  // fallback: pass as-is (rclone accepts plain too)
  }
}
