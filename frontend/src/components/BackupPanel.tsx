import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import {
  HardDrive,
  Cloud,
  Server,
  Wifi,
  FolderOpen,
  Download,
  Play,
  Trash2,
  Plus,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Clock,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  ToggleLeft,
  ToggleRight,
  Key,
  Copy,
  X,
  ShieldCheck,
} from 'lucide-react'
import * as api from '../api/client'
import type { BackupType, BackupSchedule, BackupConfigSummary, BackupStatus } from '../api/client'

// ── Helpers ────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`
}

function formatRatio(ratio: number | null | undefined): string | null {
  if (!ratio || ratio <= 1) return null
  return `${ratio.toFixed(1)}× smaller`
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return 'Never'
  const delta = Date.now() - new Date(iso).getTime()
  const min = Math.floor(delta / 60000)
  if (min < 1) return 'Just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  return `${Math.floor(hr / 24)}d ago`
}

const TYPE_META: Record<BackupType, { label: string; icon: React.ReactNode; color: string }> = {
  gdrive: { label: 'Google Drive', icon: <Cloud size={16} />, color: 'text-blue-400' },
  webdav: { label: 'Nextcloud / WebDAV', icon: <Wifi size={16} />, color: 'text-green-400' },
  s3: { label: 'S3 storage', icon: <Server size={16} />, color: 'text-orange-400' },
  sftp: { label: 'SFTP', icon: <HardDrive size={16} />, color: 'text-purple-400' },
  local: { label: 'This machine', icon: <FolderOpen size={16} />, color: 'text-slate-400' },
}

const SCHEDULE_OPTIONS: { value: BackupSchedule; label: string }[] = [
  { value: 'manual', label: 'Only when I click Run' },
  { value: 'hourly', label: 'Every hour' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
]

const EMPTY_BACKUP_STATUS: BackupStatus = {
  configs: [],
  rcloneAvailable: false,
}

// ── Status badge ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-xs text-slate-500">—</span>
  if (status === 'success') return <span className="flex items-center gap-1 text-xs text-green-400"><CheckCircle2 size={12} />Done</span>
  if (status === 'running') return <span className="flex items-center gap-1 text-xs text-yellow-400"><RefreshCw size={12} className="animate-spin" />In progress</span>
  return <span className="flex items-center gap-1 text-xs text-red-400"><AlertCircle size={12} />Failed</span>
}

// ── Add/Edit form ──────────────────────────────────────────────────────────

interface FormState {
  name: string
  type: BackupType
  schedule: BackupSchedule
  remote_path: string
  // gdrive: nothing extra (OAuth)
  // webdav
  webdav_url: string
  webdav_vendor: 'nextcloud' | 'owncloud' | 'other'
  webdav_user: string
  webdav_pass: string
  // s3
  s3_provider: string
  s3_access_key: string
  s3_secret_key: string
  s3_region: string
  s3_endpoint: string
  s3_bucket: string
  // sftp
  sftp_host: string
  sftp_port: string
  sftp_user: string
  sftp_pass: string
  // local
  local_target_dir: string
  local_keep_count: string
}

const DEFAULT_FORM: FormState = {
  name: '',
  type: 'gdrive',
  schedule: 'daily',
  remote_path: 'sample_solution',
  webdav_url: '',
  webdav_vendor: 'nextcloud',
  webdav_user: '',
  webdav_pass: '',
  s3_provider: 'Backblaze',
  s3_access_key: '',
  s3_secret_key: '',
  s3_region: '',
  s3_endpoint: '',
  s3_bucket: '',
  sftp_host: '',
  sftp_port: '22',
  sftp_user: '',
  sftp_pass: '',
  local_target_dir: '/app/data/backups',
  local_keep_count: '7',
}

function buildParams(form: FormState): Record<string, unknown> {
  switch (form.type) {
    case 'gdrive': return {}  // OAuth handled separately
    case 'webdav': return { url: form.webdav_url, vendor: form.webdav_vendor, user: form.webdav_user, pass: form.webdav_pass }
    case 's3': return { provider: form.s3_provider, accessKeyId: form.s3_access_key, secretAccessKey: form.s3_secret_key, region: form.s3_region, endpoint: form.s3_endpoint, bucket: form.s3_bucket }
    case 'sftp': return { host: form.sftp_host, port: parseInt(form.sftp_port || '22', 10), user: form.sftp_user, pass: form.sftp_pass }
    case 'local': return { targetDir: form.local_target_dir, keepCount: parseInt(form.local_keep_count || '7', 10) }
    default: return {}
  }
}

function AddBackupForm({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState<FormState>(DEFAULT_FORM)
  const [gdriveStep, setGdriveStep] = useState<'idle' | 'waiting'>('idle')
  const queryClient = useQueryClient()

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  const createMutation = useMutation({
    mutationFn: (data: Parameters<typeof api.createBackupConfig>[0]) => api.createBackupConfig(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backupStatus'] })
      onClose()
    },
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (form.type === 'gdrive') {
      // For gdrive: first create the config, then initiate OAuth
      const res = await api.createBackupConfig({ name: form.name || 'Google Drive', type: 'gdrive', params: {}, remote_path: form.remote_path, schedule: form.schedule })
      const { authUrl } = await api.getGdriveAuthUrl(res.id)
      setGdriveStep('waiting')
      window.open(authUrl, '_blank', 'width=600,height=700')
      // Poll for completion
      const poll = setInterval(async () => {
        await queryClient.invalidateQueries({ queryKey: ['backupStatus'] })
        clearInterval(poll)
        onClose()
      }, 3000)
      return
    }
    createMutation.mutate({ name: form.name, type: form.type, params: buildParams(form), remote_path: form.remote_path, schedule: form.schedule })
  }

  const inputCls = 'w-full bg-surface-base border border-surface-border rounded px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary'
  const labelCls = 'block text-xs text-slate-400 mb-1'

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-4 bg-surface-base border border-surface-border rounded-lg">
      <h3 className="text-sm font-semibold text-white">Add Backup Location</h3>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Name</label>
          <input className={inputCls} placeholder="My Backup" value={form.name} onChange={set('name')} required />
        </div>
        <div>
          <label className={labelCls}>Where to save</label>
          <select className={inputCls} value={form.type} onChange={set('type')}>
            {(Object.keys(TYPE_META) as BackupType[]).map((t) => (
              <option key={t} value={t}>{TYPE_META[t].label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>When to run</label>
          <select className={inputCls} value={form.schedule} onChange={set('schedule')}>
            {SCHEDULE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        {form.type !== 'local' && (
          <div>
            <label className={labelCls}>Folder name</label>
            <input className={inputCls} value={form.remote_path} onChange={set('remote_path')} placeholder="sample_solution" />
          </div>
        )}
      </div>

      {/* Type-specific fields */}
      {form.type === 'gdrive' && (
        <div className="rounded bg-blue-500/10 border border-blue-500/30 p-3 text-sm text-blue-300 space-y-1">
          <p className="font-medium">Google Drive</p>
          <p className="text-xs text-slate-400">Backups are saved in the app's hidden folder in Drive. This still uses your Drive storage space.</p>
          {gdriveStep === 'waiting' && <p className="text-xs text-yellow-400">Waiting for sign-in. Finish in the popup window.</p>}
        </div>
      )}

      {form.type === 'webdav' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>WebDAV URL</label>
              <input className={inputCls} placeholder="https://cloud.example.com/remote.php/dav/files/user" value={form.webdav_url} onChange={set('webdav_url')} required />
            </div>
            <div>
              <label className={labelCls}>Service type</label>
              <select className={inputCls} value={form.webdav_vendor} onChange={set('webdav_vendor')}>
                <option value="nextcloud">Nextcloud</option>
                <option value="owncloud">ownCloud</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Username</label>
              <input className={inputCls} value={form.webdav_user} onChange={set('webdav_user')} />
            </div>
            <div>
              <label className={labelCls}>App password (or token)</label>
              <input className={inputCls} type="password" value={form.webdav_pass} onChange={set('webdav_pass')} />
            </div>
          </div>
        </div>
      )}

      {form.type === 's3' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Provider</label>
              <select className={inputCls} value={form.s3_provider} onChange={set('s3_provider')}>
                <option value="Backblaze">Backblaze B2 (very cheap)</option>
                <option value="Cloudflare">Cloudflare R2 (free 10 GB)</option>
                <option value="AWS">Amazon S3</option>
                <option value="Wasabi">Wasabi</option>
                <option value="DigitalOcean">DigitalOcean Spaces</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Bucket name</label>
              <input className={inputCls} value={form.s3_bucket} onChange={set('s3_bucket')} required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Access key</label>
              <input className={inputCls} value={form.s3_access_key} onChange={set('s3_access_key')} required />
            </div>
            <div>
              <label className={labelCls}>Secret key</label>
              <input className={inputCls} type="password" value={form.s3_secret_key} onChange={set('s3_secret_key')} required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Region (optional)</label>
              <input className={inputCls} placeholder="us-east-1" value={form.s3_region} onChange={set('s3_region')} />
            </div>
            <div>
              <label className={labelCls}>Custom endpoint (optional)</label>
              <input className={inputCls} placeholder="s3.us-west-004.backblazeb2.com" value={form.s3_endpoint} onChange={set('s3_endpoint')} />
            </div>
          </div>
        </div>
      )}

      {form.type === 'sftp' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Host</label>
              <input className={inputCls} placeholder="backup.example.com" value={form.sftp_host} onChange={set('sftp_host')} required />
            </div>
            <div>
              <label className={labelCls}>Port</label>
              <input className={inputCls} type="number" value={form.sftp_port} onChange={set('sftp_port')} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Username</label>
              <input className={inputCls} value={form.sftp_user} onChange={set('sftp_user')} required />
            </div>
            <div>
              <label className={labelCls}>Password</label>
              <input className={inputCls} type="password" value={form.sftp_pass} onChange={set('sftp_pass')} />
            </div>
          </div>
        </div>
      )}

      {form.type === 'local' && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Folder path on this machine</label>
            <input className={inputCls} value={form.local_target_dir} onChange={set('local_target_dir')} required />
          </div>
          <div>
            <label className={labelCls}>Keep last N copies</label>
            <input className={inputCls} type="number" min={1} max={50} value={form.local_keep_count} onChange={set('local_keep_count')} />
          </div>
        </div>
      )}

      {createMutation.error && (
        <p className="text-xs text-red-400">{String(createMutation.error)}</p>
      )}

      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-slate-400 hover:text-white transition-colors">Cancel</button>
        <button type="submit" disabled={createMutation.isPending} className="px-4 py-1.5 text-sm bg-accent-primary text-white rounded hover:bg-accent-primary/80 disabled:opacity-50 transition-colors">
          {createMutation.isPending ? 'Saving…' : form.type === 'gdrive' ? 'Connect Google Drive' : 'Save'}
        </button>
      </div>
    </form>
  )
}

// ── Recovery key modal ─────────────────────────────────────────────────────

function RecoveryKeyModal({ configId, onClose }: { configId: number; onClose: () => void }) {
  const [copied, setCopied] = useState<string | null>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['recoveryKey', configId],
    queryFn: () => api.getRecoveryKey(configId),
  })

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(label)
      setTimeout(() => setCopied(null), 2000)
    })
  }

  const codeCls = 'block w-full bg-surface-base/40 border border-surface-border rounded p-2 font-mono text-xs text-slate-300 break-all select-all'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-base/60 p-4">
      <div className="bg-surface-raised border border-surface-border rounded-xl shadow-2xl w-full max-w-lg space-y-4 p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} className="text-yellow-400" />
            <h3 className="text-sm font-semibold text-white">Restore Info</h3>
            {data && <span className="text-xs text-slate-500">— {data.name}</span>}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors"><X size={16} /></button>
        </div>

        {isLoading && <p className="text-xs text-slate-400">Loading…</p>}

        {error && (
          <div className="rounded bg-yellow-500/10 border border-yellow-500/30 p-3 text-xs text-yellow-300">
            No restore key yet. Run at least one backup first.
          </div>
        )}

        {data && (
          <div className="space-y-4">
            <div className="rounded bg-yellow-500/10 border border-yellow-500/30 p-3 text-xs text-yellow-300">
              <strong>Save this somewhere safe.</strong> If you need to recover later, this password is required.
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400 font-medium">Backup password</span>
                <button
                  onClick={() => copy(data.repoPassword, 'password')}
                  className="flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors"
                >
                  <Copy size={11} />
                  {copied === 'password' ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <code className={codeCls}>{data.repoPassword}</code>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400 font-medium">Backup location</span>
                <button
                  onClick={() => copy(data.repoUrl, 'url')}
                  className="flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors"
                >
                  <Copy size={11} />
                  {copied === 'url' ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <code className={codeCls}>{data.repoUrl}</code>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400 font-medium">Command: list backups</span>
                <button
                  onClick={() => copy(data.listCommand, 'list')}
                  className="flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors"
                >
                  <Copy size={11} />
                  {copied === 'list' ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <code className={codeCls}>{data.listCommand}</code>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400 font-medium">Command: restore latest backup</span>
                <button
                  onClick={() => copy(data.restoreCommand, 'restore')}
                  className="flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors"
                >
                  <Copy size={11} />
                  {copied === 'restore' ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <code className={codeCls}>{data.restoreCommand}</code>
            </div>

            <p className="text-xs text-slate-600">You need `restic` installed on the computer you restore on. <code className="font-mono">brew install restic</code> / <code className="font-mono">apt install restic</code></p>
          </div>
        )}

        <div className="flex justify-end pt-1">
          <button onClick={onClose} className="px-4 py-1.5 text-sm bg-surface-base border border-surface-border rounded hover:border-slate-500 text-slate-300 transition-colors">Close</button>
        </div>
      </div>
    </div>
  )
}

// ── Config card ────────────────────────────────────────────────────────────

function ConfigCard({ config, onDeleted }: { config: BackupConfigSummary; onDeleted: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const [running, setRunning] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const queryClient = useQueryClient()

  const meta = TYPE_META[config.type]

  const toggleMutation = useMutation({
    mutationFn: () => api.updateBackupConfig(config.id, { enabled: !config.enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['backupStatus'] }),
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteBackupConfig(config.id),
    onSuccess: onDeleted,
  })

  const handleRun = async () => {
    setRunning(true)
    try {
      await api.runBackup(config.id)
      queryClient.invalidateQueries({ queryKey: ['backupStatus'] })
      queryClient.invalidateQueries({ queryKey: ['backupLogs', config.id] })
    } finally {
      setRunning(false)
    }
  }

  const handleReauth = async () => {
    const { authUrl } = await api.getGdriveAuthUrl(config.id)
    window.open(authUrl, '_blank', 'width=600,height=700')
  }

  const { data: logs } = useQuery({
    queryKey: ['backupLogs', config.id],
    queryFn: () => api.getBackupLogs(config.id, 5),
    enabled: expanded,
  })

  return (
    <div className={`border rounded-lg transition-colors ${config.enabled ? 'border-surface-border' : 'border-surface-border/40 opacity-60'}`}>
      <div className="flex items-center gap-3 p-3">
        <span className={meta.color}>{meta.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-white truncate">{config.name}</span>
            <span className="text-xs text-slate-500">{meta.label}</span>
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            <StatusBadge status={config.last_backup_status} />
            <span className="text-xs text-slate-500 flex items-center gap-1"><Clock size={10} />{formatRelativeTime(config.last_backup_at)}</span>
            <span className="text-xs text-slate-600">{SCHEDULE_OPTIONS.find(o => o.value === config.schedule)?.label}</span>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {config.type === 'gdrive' && (
            <button onClick={handleReauth} title="Reconnect" className="p-1.5 text-slate-400 hover:text-blue-400 transition-colors">
              <ExternalLink size={14} />
            </button>
          )}
          <button
            onClick={handleRun}
            disabled={running}
            title="Back up now"
            className="p-1.5 text-slate-400 hover:text-accent-primary transition-colors disabled:opacity-40"
          >
            {running ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
          </button>
          <button
            onClick={() => toggleMutation.mutate()}
            title={config.enabled ? 'Disable' : 'Enable'}
            className="p-1.5 text-slate-400 hover:text-white transition-colors"
          >
            {config.enabled ? <ToggleRight size={16} className="text-accent-primary" /> : <ToggleLeft size={16} />}
          </button>
          <button
            onClick={() => setShowKey(true)}
            title="Restore info"
            className="p-1.5 text-slate-400 hover:text-yellow-400 transition-colors"
          >
            <Key size={14} />
          </button>
          <button
            onClick={() => deleteMutation.mutate()}
            title="Delete"
            className="p-1.5 text-slate-400 hover:text-red-400 transition-colors"
          >
            <Trash2 size={14} />
          </button>
          <button onClick={() => setExpanded(e => !e)} className="p-1.5 text-slate-400 hover:text-white transition-colors">
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {config.last_backup_error && (
        <div className="mx-3 mb-2 px-2 py-1 bg-red-500/10 rounded text-xs text-red-400 truncate">{config.last_backup_error}</div>
      )}

      {showKey && <RecoveryKeyModal configId={config.id} onClose={() => setShowKey(false)} />}

      {expanded && (
        <div className="border-t border-surface-border/50 p-3 space-y-2">
          <p className="text-xs text-slate-500">Folder: <span className="text-slate-300 font-mono">{config.remote_path}</span></p>
          {logs && logs.length > 0 ? (
            <div className="space-y-1">
              <p className="text-xs text-slate-500 font-medium">Recent backups</p>
              {logs.map((log) => {
                const details = log.details_json ? (() => { try { return JSON.parse(log.details_json) } catch { return {} } })() : {}
                const ratio = details.compressionRatio as number | undefined
                const ratioStr = formatRatio(ratio)
                const processed = details.dataBytesProcessed as number | undefined
                const added = details.dataBytesAdded as number | undefined
                return (
                  <div key={log.id} className="space-y-0.5">
                    <div className="flex items-center gap-3 text-xs">
                      <StatusBadge status={log.status} />
                      <span className="text-slate-500">{new Date(log.started_at).toLocaleString()}</span>
                      {(log.files_transferred > 0 || details.filesNew) && (
                        <span className="text-slate-400">
                          {(details.filesNew as number ?? 0) + (details.filesChanged as number ?? 0)} changed · {details.filesUnmodified as number ?? log.files_transferred} unchanged
                        </span>
                      )}
                      {log.error_message && <span className="text-red-400 truncate">{log.error_message}</span>}
                    </div>
                    {processed !== undefined && added !== undefined && added > 0 && (
                      <div className="flex items-center gap-3 text-xs text-slate-600 pl-4">
                        <span>{formatBytes(processed)} → {formatBytes(added)} stored</span>
                        {ratioStr && <span className="text-green-500/70">{ratioStr}</span>}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-xs text-slate-600">No backups yet</p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main panel ─────────────────────────────────────────────────────────────

interface BackupPanelProps {
  title?: string
  description?: string
  showDownloadSection?: boolean
  showInfoFooter?: boolean
}

export function BackupPanel({
  title = 'Backup',
  description = 'Keep your library safe with automatic backups that only upload changes.',
  showDownloadSection = true,
  showInfoFooter = true,
}: BackupPanelProps = {}) {
  const [showAdd, setShowAdd] = useState(false)
  const queryClient = useQueryClient()
  const statusEndpointBrokenRef = useRef(false)

  const {
    data: status,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['backupStatus'],
    queryFn: async () => {
      const loadConfigsFallback = async (): Promise<BackupStatus> => {
        try {
          const configs = await api.getBackupConfigs()
          return { configs, rcloneAvailable: false }
        } catch (fallbackErr) {
          // If backup routes are unhealthy (common when backend schema is behind),
          // degrade to an empty state instead of a permanent blocking error banner.
          if (isAxiosError(fallbackErr) && (fallbackErr.response?.status ?? 0) >= 500) {
            return EMPTY_BACKUP_STATUS
          }
          throw fallbackErr
        }
      }

      if (statusEndpointBrokenRef.current) {
        return loadConfigsFallback()
      }

      try {
        return await api.getBackupStatus()
      } catch (err) {
        if (isAxiosError(err) && err.response?.status === 500) {
          statusEndpointBrokenRef.current = true
          return loadConfigsFallback()
        }
        throw err
      }
    },
    retry: (failureCount, err) => {
      if (isAxiosError(err) && (err.response?.status ?? 0) >= 500) return false
      return failureCount < 1
    },
    refetchInterval: (query) => {
      const queryError = query.state.error
      if (isAxiosError(queryError) && (queryError.response?.status ?? 0) >= 500) return false
      return 15000
    },
    refetchOnWindowFocus: false,
    placeholderData: (previousData) => previousData,
  })

  const isServerError = isAxiosError(error) && (error.response?.status ?? 0) >= 500

  const configs = status?.configs ?? []
  const hasConfigs = configs.length > 0
  const showInitialLoading = isLoading && !status
  const showEmptyState = !showInitialLoading && !isError && !showAdd && Boolean(status) && !hasConfigs

  // Handle OAuth redirect result
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('backup_gdrive_linked')) {
      queryClient.invalidateQueries({ queryKey: ['backupStatus'] })
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [queryClient])

  const downloadBackup = (includeAudio: boolean) => {
    const url = api.getBackupDownloadUrl(includeAudio)
    window.open(url, '_blank')
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-white">{title}</h2>
          <p className="text-xs text-slate-400 mt-0.5">{description}</p>
        </div>
        <div className="flex items-center gap-2">
          {status && !status.rcloneAvailable && !statusEndpointBrokenRef.current && (
            <span className="text-xs text-yellow-400 flex items-center gap-1"><AlertCircle size={12} />Backup helper not found</span>
          )}
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-accent-primary text-white rounded hover:bg-accent-primary/80 transition-colors"
          >
            <Plus size={14} />
            Add location
          </button>
        </div>
      </div>

      {/* Client-side download */}
      {showDownloadSection && (
        <div className="rounded-lg border border-surface-border p-4 space-y-2">
          <div className="flex items-center gap-2 mb-1">
            <Download size={15} className="text-slate-400" />
            <span className="text-sm font-medium text-white">Download a backup copy</span>
            <span className="text-xs text-slate-500">ZIP in browser</span>
          </div>
          <p className="text-xs text-slate-500">Download a ZIP file to your browser. Includes app data, slices, and waveforms.</p>
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => downloadBackup(false)}
              className="px-3 py-1.5 text-xs bg-surface-raised border border-surface-border rounded hover:border-accent-primary/50 text-slate-300 transition-colors"
            >
              Download (app data + samples)
            </button>
            <button
              onClick={() => downloadBackup(true)}
              className="px-3 py-1.5 text-xs bg-surface-raised border border-surface-border rounded hover:border-accent-primary/50 text-slate-300 transition-colors"
            >
              Download (include source audio)
            </button>
          </div>
        </div>
      )}

      {/* Add form */}
      {showAdd && <AddBackupForm onClose={() => setShowAdd(false)} />}

      {/* Configured destinations */}
      {showInitialLoading && <p className="text-xs text-slate-500">Loading…</p>}

      {isError && !status && (
        <div className="rounded border border-red-500/25 bg-red-500/5 px-3 py-2 text-xs text-red-300 flex items-center justify-between gap-3">
          <span className="truncate">
            {isServerError
              ? 'Backup details are temporarily unavailable.'
              : 'Could not load backup details.'}
          </span>
          <button
            onClick={() => {
              statusEndpointBrokenRef.current = false
              void refetch()
            }}
            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-red-500/35 text-red-300 hover:bg-red-500/10 transition-colors"
          >
            <RefreshCw size={11} />
            Retry
          </button>
        </div>
      )}

      {hasConfigs ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Backup locations</p>
            <button
              onClick={() => api.runAllBackups()}
              className="flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors"
            >
              <Play size={11} />
              Back up all
            </button>
          </div>
          {configs.map((cfg) => (
            <ConfigCard
              key={cfg.id}
              config={cfg}
              onDeleted={() => queryClient.invalidateQueries({ queryKey: ['backupStatus'] })}
            />
          ))}
        </div>
      ) : showEmptyState ? (
        <div className="text-center py-8 text-slate-500 text-sm">
          No backups are configured or scheduled yet.
        </div>
      ) : null}

      {/* Info footer */}
      {showInfoFooter && (
        <div className="rounded-lg bg-surface-raised border border-surface-border/50 p-3 space-y-1.5 text-xs text-slate-500">
          <p className="font-medium text-slate-400">How backups work</p>
          <p>• <span className="text-slate-300">Fast uploads</span> — only new or changed files are sent.</p>
          <p>• <span className="text-slate-300">Space saving</span> — files are compressed when it helps.</p>
          <p>• <span className="text-slate-300">No duplicates</span> — matching data is stored once to save space.</p>
          <p>• <span className="text-slate-300">Private</span> — backups are encrypted.</p>
          <p>• <span className="text-slate-300">Google Drive</span> — stored in an app folder so it does not clutter your main Drive files.</p>
          <p>• <span className="text-slate-300">Low-cost options</span> — Backblaze B2, Cloudflare R2, or your own SFTP server.</p>
        </div>
      )}
    </div>
  )
}
