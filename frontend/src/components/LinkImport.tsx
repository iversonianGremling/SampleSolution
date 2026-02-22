import { useState, useRef, useCallback, useEffect } from 'react'
import {
  Upload,
  Loader2,
  CheckCircle,
  XCircle,
  Link,
  HardDrive,
  FolderOpen,
  Music2,
  Waves,
  HelpCircle,
  RefreshCw,
  X,
  AlertCircle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import {
  useImportLinks,
  useImportLocalFiles,
  useImportSpotify,
  useImportSoundCloud,
  useSpotifyStatus,
  useDisconnectSpotify,
  useToolVersions,
  useUpdateYtdlp,
  useUpdateSpotdl,
} from '../hooks/useTracks'
import { getSpotifyAuthUrl } from '../api/client'
import type { ImportResult } from '../types'
import type { BatchImportResult } from '../api/client'
import {
  isDownloadToolsUiVisible,
  isSpotdlIntegrationEnabled,
  SPOTDL_INTEGRATION_EVENT,
  SPOTDL_INTEGRATION_STORAGE_KEY,
} from '../utils/spotdlIntegration'

type ImportMode = 'youtube' | 'spotify' | 'soundcloud' | 'local' | 'folder'

interface LinkImportProps {
  onTracksAdded: () => void
}

const isRequestAbortError = (error: unknown): boolean => {
  if (!error) return false

  if (error instanceof DOMException && error.name === 'AbortError') {
    return true
  }

  if (error instanceof Error) {
    const name = error.name.toLowerCase()
    const message = error.message.toLowerCase()
    return (
      name === 'aborterror' ||
      name === 'cancelederror' ||
      message.includes('aborted') ||
      message.includes('canceled') ||
      message.includes('cancelled')
    )
  }

  const maybe = error as { code?: string; name?: string }
  return maybe.code === 'ERR_CANCELED' || maybe.name === 'CanceledError'
}

// ── Help Modal ────────────────────────────────────────────────────────────────
const YTDLP_SITES = [
  'YouTube, YouTube Music, YouTube Shorts, YouTube Live',
  'SoundCloud (tracks, playlists, user pages)',
  'Bandcamp (tracks, albums)',
  'Vimeo',
  'Dailymotion',
  'Twitch VODs & clips',
  'Reddit (video posts)',
  'Twitter / X (videos)',
  'Instagram (reels, posts)',
  'Facebook videos',
  'TikTok',
  'Mixcloud',
  'Audiomack',
  'Rumble',
  'BitChute',
  'Odysee / LBRY',
  'PeerTube instances',
  'Streamable',
  'Generic direct audio/video URLs',
  '1000+ more extractors…',
]

function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-base/60" onClick={onClose}>
      <div
        className="bg-surface-raised border border-surface-border rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
          <h3 className="font-semibold text-white text-base">Supported Sites</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <p className="text-sm text-slate-400">
            The importer supports <span className="text-white font-medium">1000+</span> sites. Paste any
            URL from the list below (and many more) into the YouTube or SoundCloud tabs.
          </p>

          <ul className="space-y-1.5">
            {YTDLP_SITES.map((site) => (
              <li key={site} className="flex items-start gap-2 text-sm text-slate-300">
                <CheckCircle size={14} className="text-accent-primary mt-0.5 flex-shrink-0" />
                {site}
              </li>
            ))}
          </ul>

          <div className="bg-surface-overlay/40 rounded-lg p-3 text-xs text-slate-400 space-y-1 border border-surface-border">
            <div className="font-medium text-slate-300">YouTube URL formats supported:</div>
            <div className="font-mono space-y-0.5">
              <div>https://www.youtube.com/watch?v=VIDEO_ID</div>
              <div>https://youtu.be/VIDEO_ID</div>
              <div>https://youtube.com/shorts/VIDEO_ID</div>
              <div>https://www.youtube.com/playlist?list=PLAYLIST_ID</div>
              <div>VIDEO_ID (11-char ID only)</div>
              <div>Video ID,Timestamp (YouTube Takeout CSV)</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Tools Panel ───────────────────────────────────────────────────────────────
type UpdateTool = 'ytdlp' | 'spotdl'
type UpdateStatus = 'running' | 'success' | 'error' | 'stopped' | null

const getUpdateToolLabel = (tool: UpdateTool | null): string => {
  if (tool === 'ytdlp') return 'yt-dlp'
  if (tool === 'spotdl') return 'spotdl'
  return 'tools'
}

function ToolsPanel() {
  const { data: versions, isLoading, refetch } = useToolVersions()
  const updateYtdlp = useUpdateYtdlp()
  const updateSpotdl = useUpdateSpotdl()
  const [updateLog, setUpdateLog] = useState('')
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>(null)
  const [activeTool, setActiveTool] = useState<UpdateTool | null>(null)
  const [isLogOpen, setIsLogOpen] = useState(false)
  const [isStoppingUpdate, setIsStoppingUpdate] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [spotdlEnabled, setSpotdlEnabled] = useState(() => isSpotdlIntegrationEnabled())
  const logRef = useRef<HTMLPreElement>(null)
  const updateAbortRef = useRef<AbortController | null>(null)

  const hasYtdlpUpdate =
    versions?.ytdlp.current &&
    versions?.ytdlp.latest &&
    !versions.ytdlp.current.includes(versions.ytdlp.latest)

  const hasSpotdlUpdate =
    spotdlEnabled &&
    versions?.spotdl.current &&
    versions?.spotdl.latest &&
    !versions.spotdl.current.includes(versions.spotdl.latest)

  const hasAnyUpdate = hasYtdlpUpdate || hasSpotdlUpdate
  const isUpdating = updateYtdlp.isPending || updateSpotdl.isPending
  const hasLogContent = updateLog.trim().length > 0
  const showBottomLogBar = isUpdating || hasLogContent || Boolean(activeTool)
  const runningTool: UpdateTool | null = updateYtdlp.isPending
    ? 'ytdlp'
    : updateSpotdl.isPending
      ? 'spotdl'
      : activeTool
  const statusText = isUpdating
    ? `Updating ${getUpdateToolLabel(runningTool)}...`
    : updateStatus === 'error'
      ? 'Update failed'
      : updateStatus === 'stopped'
        ? 'Update stopped'
      : updateStatus === 'success'
        ? 'Update completed'
        : 'Ready'
  const statusClassName = isUpdating
    ? 'text-accent-primary'
    : updateStatus === 'error'
      ? 'text-red-400'
      : updateStatus === 'stopped'
        ? 'text-amber-300'
      : updateStatus === 'success'
        ? 'text-green-400'
        : 'text-slate-400'

  async function handleUpdate(tool: UpdateTool) {
    if (isUpdating) return
    if (tool === 'spotdl' && !spotdlEnabled) return
    const label = getUpdateToolLabel(tool)
    const startedAt = new Date().toLocaleTimeString()
    const abortController = new AbortController()

    setActiveTool(tool)
    setUpdateStatus('running')
    setIsStoppingUpdate(false)
    setIsLogOpen(true)
    updateAbortRef.current = abortController
    setUpdateLog((current) => {
      const prefix = current.trim().length > 0 ? `${current}\n\n` : ''
      return `${prefix}=== ${label} update (${startedAt}) ===\n`
    })

    const fn = tool === 'ytdlp' ? updateYtdlp : updateSpotdl
    try {
      await fn.mutateAsync({
        onChunk: (chunk) => {
          setUpdateLog((current) => current + chunk)
        },
        signal: abortController.signal,
      })
      setUpdateStatus('success')
      refetch()
    } catch (err) {
      if (isRequestAbortError(err)) {
        setUpdateStatus('stopped')
        setUpdateLog((current) => `${current}\nStopped by user.\n`)
        return
      }
      const message = err instanceof Error ? err.message : String(err)
      setUpdateStatus('error')
      setUpdateLog((current) => `${current}\nError: ${message}\n`)
    } finally {
      updateAbortRef.current = null
      setIsStoppingUpdate(false)
    }
  }

  const handleStopUpdate = () => {
    if (!isUpdating) return
    setIsStoppingUpdate(true)
    updateAbortRef.current?.abort()
  }

  useEffect(() => {
    const el = logRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [updateLog, isLogOpen])

  useEffect(() => {
    const handleIntegrationChanged = (event: Event) => {
      const detail = (event as CustomEvent<boolean>).detail
      if (typeof detail === 'boolean') {
        setSpotdlEnabled(detail)
        return
      }
      setSpotdlEnabled(isSpotdlIntegrationEnabled())
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key === SPOTDL_INTEGRATION_STORAGE_KEY) {
        setSpotdlEnabled(isSpotdlIntegrationEnabled())
      }
    }

    window.addEventListener(SPOTDL_INTEGRATION_EVENT, handleIntegrationChanged)
    window.addEventListener('storage', handleStorage)
    return () => {
      window.removeEventListener(SPOTDL_INTEGRATION_EVENT, handleIntegrationChanged)
      window.removeEventListener('storage', handleStorage)
    }
  }, [])

  useEffect(() => {
    if (!isLogOpen) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsLogOpen(false)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isLogOpen])

  useEffect(() => {
    return () => {
      updateAbortRef.current?.abort()
    }
  }, [])

  return (
    <>
      <div className="bg-surface-raised rounded-lg border border-surface-border overflow-hidden">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-slate-300 hover:text-white hover:bg-surface-overlay/30 transition-colors"
        >
          <span className="flex items-center gap-2">
            <RefreshCw size={15} />
            Tool Versions &amp; Updates
            {hasAnyUpdate && (
              <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" title="Updates available" />
            )}
          </span>
          {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>

        {expanded && (
          <div className="px-4 pb-4 space-y-3 border-t border-surface-border pt-3">
            {isLoading ? (
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <Loader2 className="animate-spin" size={14} />
                Checking versions…
              </div>
            ) : (
              <>
                {/* yt-dlp row */}
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-white">yt-dlp</div>
                    <div className="text-xs text-slate-400">
                      {versions?.ytdlp.current ?? 'Not installed'}{' '}
                      {versions?.ytdlp.latest && (
                        <>
                          →{' '}
                          <span className={hasYtdlpUpdate ? 'text-yellow-400' : 'text-slate-500'}>
                            latest: {versions.ytdlp.latest}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => handleUpdate('ytdlp')}
                    disabled={isUpdating || !hasYtdlpUpdate}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-surface-overlay hover:bg-surface-border border border-surface-border text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                  >
                    {updateYtdlp.isPending ? <Loader2 className="animate-spin" size={12} /> : <RefreshCw size={12} />}
                    Update
                  </button>
                </div>

                {spotdlEnabled && (
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-white">spotdl</div>
                      <div className="text-xs text-slate-400">
                        {versions?.spotdl.current ?? 'Not installed'}{' '}
                        {versions?.spotdl.latest && (
                          <>
                            →{' '}
                            <span className={hasSpotdlUpdate ? 'text-yellow-400' : 'text-slate-500'}>
                              latest: {versions.spotdl.latest}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => handleUpdate('spotdl')}
                      disabled={isUpdating || !hasSpotdlUpdate}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-surface-overlay hover:bg-surface-border border border-surface-border text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                    >
                      {updateSpotdl.isPending ? <Loader2 className="animate-spin" size={12} /> : <RefreshCw size={12} />}
                      Update
                    </button>
                  </div>
                )}

                <button
                  onClick={() => refetch()}
                  className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
                >
                  Refresh versions
                </button>
                {isUpdating && (
                  <button
                    onClick={handleStopUpdate}
                    disabled={isStoppingUpdate}
                    className={`
                      text-xs px-2.5 py-1.5 rounded-md border transition-colors
                      ${isStoppingUpdate
                        ? 'bg-surface-base text-slate-400 border-surface-border cursor-not-allowed'
                        : 'bg-red-500/15 hover:bg-red-500/25 text-red-300 border-red-500/40'}
                    `}
                  >
                    {isStoppingUpdate ? 'Stopping...' : 'Stop update'}
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {showBottomLogBar && (
        <>
          {isLogOpen && (
            <button
              type="button"
              aria-label="Close update progress panel"
              className="fixed inset-0 z-40 bg-surface-base/40"
              onClick={() => setIsLogOpen(false)}
            />
          )}

          <div className="fixed inset-x-0 bottom-0 z-50 pointer-events-none px-3 pb-3">
            <div className="mx-auto max-w-4xl pointer-events-auto">
              <div className="rounded-xl border border-surface-border bg-surface-raised shadow-2xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => setIsLogOpen((open) => !open)}
                  aria-expanded={isLogOpen}
                  className="w-full px-4 py-3 flex items-center justify-between gap-3 hover:bg-surface-overlay/80 transition-colors text-left"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium text-white">
                      <RefreshCw size={14} className={isUpdating ? 'animate-spin text-accent-primary' : 'text-slate-400'} />
                      <span>Update Progress</span>
                      {runningTool && (
                        <span className="text-xs text-slate-400 font-normal">({getUpdateToolLabel(runningTool)})</span>
                      )}
                    </div>
                    <div className={`text-xs mt-0.5 ${statusClassName}`}>
                      {statusText}
                    </div>
                  </div>
                  <div className="text-slate-400">
                    {isLogOpen ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                  </div>
                </button>

                <div
                  className={`
                    border-t border-surface-border overflow-hidden transition-all duration-200 ease-out
                    ${isLogOpen ? 'max-h-[50vh] opacity-100' : 'max-h-0 opacity-0'}
                  `}
                >
                  <pre
                    ref={logRef}
                    className="bg-surface-base p-3 text-xs font-mono text-slate-300 whitespace-pre-wrap max-h-[46vh] overflow-y-auto"
                  >
                    {updateLog || 'Waiting for update output...'}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  )
}

// ── Shared result displays ────────────────────────────────────────────────────
function ImportResultDisplay({ result }: { result: ImportResult }) {
  return (
    <div className="border-t border-surface-border pt-4 space-y-3">
      {result.success.length > 0 && (
        <div className="flex items-start gap-2 text-green-400">
          <CheckCircle size={18} className="mt-0.5 flex-shrink-0" />
          <div>
            <div className="font-medium">{result.success.length} imported successfully</div>
            <div className="text-sm text-green-400/70 max-h-24 overflow-y-auto">
              {result.success.join(', ')}
            </div>
          </div>
        </div>
      )}
      {result.failed.length > 0 && (
        <div className="flex items-start gap-2 text-red-400">
          <XCircle size={18} className="mt-0.5 flex-shrink-0" />
          <div>
            <div className="font-medium">{result.failed.length} failed</div>
            <div className="text-sm text-red-400/70 max-h-24 overflow-y-auto">
              {result.failed.map((f, i) => (
                <div key={i}>
                  {f.url}: {f.error}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function BatchResultDisplay({ result }: { result: BatchImportResult }) {
  return (
    <div className="border-t border-surface-border pt-4 space-y-3">
      {result.successful > 0 && (
        <div className="flex items-start gap-2 text-green-400">
          <CheckCircle size={18} className="mt-0.5 flex-shrink-0" />
          <div className="font-medium">
            {result.successful} of {result.total} imported successfully
          </div>
        </div>
      )}
      {result.failed > 0 && (
        <div className="flex items-start gap-2 text-red-400">
          <XCircle size={18} className="mt-0.5 flex-shrink-0" />
          <div>
            <div className="font-medium">{result.failed} failed</div>
            <div className="text-sm text-red-400/70 max-h-24 overflow-y-auto">
              {result.results
                .filter((r) => !r.success)
                .map((r, i) => (
                  <div key={i}>
                    {r.filename}: {r.error}
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export function LinkImport({ onTracksAdded }: LinkImportProps) {
  const [mode, setMode] = useState<ImportMode>('youtube')
  const [text, setText] = useState('')
  const [result, setResult] = useState<ImportResult | null>(null)
  const [localResult, setLocalResult] = useState<BatchImportResult | null>(null)
  const [folderResult, setFolderResult] = useState<BatchImportResult | null>(null)
  const [selectedFolderName, setSelectedFolderName] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [localImportType, setLocalImportType] = useState<'sample' | 'track'>('sample')
  const [folderImportType, setFolderImportType] = useState<'sample' | 'track'>('sample')
  const [showHelp, setShowHelp] = useState(false)
  const [spotdlEnabled, setSpotdlEnabled] = useState(() => isSpotdlIntegrationEnabled())
  const showDownloadToolsUi = isDownloadToolsUiVisible()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

  const importLinks = useImportLinks()
  const importLocalFiles = useImportLocalFiles()
  const importSpotify = useImportSpotify()
  const importSoundCloud = useImportSoundCloud()
  const { data: spotifyStatus, refetch: refetchSpotifyStatus } = useSpotifyStatus()
  const disconnectSpotify = useDisconnectSpotify()

  // Handle Spotify OAuth redirect back
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('spotify_connected') === '1') {
      refetchSpotifyStatus()
      window.history.replaceState({}, '', window.location.pathname)
      setMode('spotify')
    }
  }, [])

  useEffect(() => {
    const handleIntegrationChanged = (event: Event) => {
      const detail = (event as CustomEvent<boolean>).detail
      if (typeof detail === 'boolean') {
        setSpotdlEnabled(detail)
        return
      }
      setSpotdlEnabled(isSpotdlIntegrationEnabled())
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key === SPOTDL_INTEGRATION_STORAGE_KEY) {
        setSpotdlEnabled(isSpotdlIntegrationEnabled())
      }
    }

    window.addEventListener(SPOTDL_INTEGRATION_EVENT, handleIntegrationChanged)
    window.addEventListener('storage', handleStorage)
    return () => {
      window.removeEventListener(SPOTDL_INTEGRATION_EVENT, handleIntegrationChanged)
      window.removeEventListener('storage', handleStorage)
    }
  }, [])

  useEffect(() => {
    if (!spotdlEnabled && mode === 'spotify') {
      setMode('youtube')
      setText('')
      setResult(null)
    }
  }, [spotdlEnabled, mode])

  const handleYouTubeImport = async () => {
    if (!text.trim()) return
    const res = await importLinks.mutateAsync(text)
    setResult(res)
    if (res.success.length > 0) onTracksAdded()
  }

  const handleSpotifyImport = async () => {
    if (!text.trim()) return
    const res = await importSpotify.mutateAsync(text)
    setResult(res)
    if (res.success.length > 0) onTracksAdded()
  }

  const handleSoundCloudImport = async () => {
    if (!text.trim()) return
    const res = await importSoundCloud.mutateAsync(text)
    setResult(res)
    if (res.success.length > 0) onTracksAdded()
  }

  const handleLocalFilesImport = async (files: File[]) => {
    if (files.length === 0) return
    const res = await importLocalFiles.mutateAsync({ files, importType: localImportType })
    setLocalResult(res)
    if (res.successful > 0) onTracksAdded()
  }

  const handleFolderSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    const audioFiles = files.filter((f) => /\.(wav|mp3|flac|aiff|ogg|m4a)$/i.test(f.name))

    if (audioFiles.length === 0) {
      setFolderResult({ total: 0, successful: 0, failed: 0, results: [] })
      return
    }

    const pathParts = files[0].webkitRelativePath.split('/')
    setSelectedFolderName(pathParts[0] || 'Selected folder')

    const res = await importLocalFiles.mutateAsync({ files: audioFiles, importType: folderImportType })
    setFolderResult(res)
    if (res.successful > 0) onTracksAdded()
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleLocalFilesImport(Array.from(e.target.files || []))
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const files = Array.from(e.dataTransfer.files).filter((f) =>
      /\.(wav|mp3|flac|aiff|ogg|m4a)$/i.test(f.name)
    )
    if (files.length > 0) handleLocalFilesImport(files)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleClear = () => {
    setText('')
    setResult(null)
    setLocalResult(null)
    setFolderResult(null)
    setSelectedFolderName(null)
    if (folderInputRef.current) folderInputRef.current.value = ''
  }

  const modes: { id: ImportMode; label: string; icon: React.ReactNode }[] = [
    { id: 'youtube', label: 'YouTube', icon: <Link size={14} /> },
    ...(spotdlEnabled ? [{ id: 'spotify' as const, label: 'Spotify', icon: <Music2 size={14} /> }] : []),
    { id: 'soundcloud', label: 'SoundCloud', icon: <Waves size={14} /> },
    { id: 'local', label: 'Local Files', icon: <HardDrive size={14} /> },
    { id: 'folder', label: 'Folder', icon: <FolderOpen size={14} /> },
  ]

  const isPending =
    importLinks.isPending ||
    importSpotify.isPending ||
    importSoundCloud.isPending ||
    importLocalFiles.isPending

  return (
    <>
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}

      <div className="space-y-3">
        {/* Main import card */}
        <div className="bg-surface-raised rounded-lg overflow-hidden border border-surface-border">
          <div className="px-4 py-3 border-b border-surface-border flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-white">Import Samples</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {spotdlEnabled
                  ? 'YouTube, Spotify, SoundCloud, or local files'
                  : 'YouTube, SoundCloud, or local files'}
              </p>
            </div>
            <button
              onClick={() => setShowHelp(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-slate-400 hover:text-white bg-surface-overlay hover:bg-surface-border border border-surface-border rounded-lg transition-colors"
              title="Supported sites"
            >
              <HelpCircle size={13} />
              Help
            </button>
          </div>

          {/* Mode tabs */}
          <div className="flex border-b border-surface-border overflow-x-auto">
            {modes.map((m) => (
              <button
                key={m.id}
                onClick={() => {
                  setMode(m.id)
                  handleClear()
                }}
                className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  mode === m.id
                    ? 'text-accent-primary border-b-2 border-accent-primary bg-surface-overlay/30'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {m.icon}
                {m.label}
              </button>
            ))}
          </div>

          <div className="p-4 space-y-4">
            {/* ── YouTube ── */}
            {mode === 'youtube' && (
              <>
                <div className="text-xs text-slate-500 bg-surface-overlay/30 rounded-lg p-3 border border-surface-border space-y-1">
                  <div className="font-medium text-slate-400">Supported formats (one per line):</div>
                  <div className="font-mono space-y-0.5">
                    <div>https://www.youtube.com/watch?v=VIDEO_ID</div>
                    <div>https://youtu.be/VIDEO_ID &nbsp;·&nbsp; youtube.com/shorts/VIDEO_ID</div>
                    <div>https://www.youtube.com/playlist?list=PLAYLIST_ID</div>
                    <div>VIDEO_ID &nbsp;·&nbsp; Video ID,Timestamp (CSV export)</div>
                  </div>
                </div>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Paste YouTube URLs, video IDs, or playlist links…"
                  rows={8}
                  className="w-full px-4 py-3 bg-surface-base border border-surface-border rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary font-mono text-sm resize-none"
                />
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500">
                    {text.trim().split('\n').filter(Boolean).length} lines
                  </span>
                  <div className="flex gap-2">
                    <button onClick={handleClear} className="px-3 py-1.5 text-sm bg-surface-overlay hover:bg-surface-border text-white rounded-lg border border-surface-border transition-colors">
                      Clear
                    </button>
                    <button
                      onClick={handleYouTubeImport}
                      disabled={!text.trim() || importLinks.isPending}
                      className="flex items-center gap-2 px-4 py-1.5 text-sm bg-accent-primary hover:bg-blue-600 disabled:bg-surface-overlay disabled:text-slate-500 text-white rounded-lg transition-colors"
                    >
                      {importLinks.isPending ? <Loader2 className="animate-spin" size={15} /> : <Upload size={15} />}
                      Import
                    </button>
                  </div>
                </div>
                {result && <ImportResultDisplay result={result} />}
              </>
            )}

            {/* ── Spotify ── */}
            {mode === 'spotify' && spotdlEnabled && (
              <>
                <div className="text-xs text-slate-500 bg-surface-overlay/30 rounded-lg p-3 border border-surface-border space-y-1.5">
                  <div className="font-medium text-slate-400">How it works:</div>
                  <ul className="space-y-1">
                    <li>• Downloading is handled by the backend import engine</li>
                    <li>• Paste track, playlist, or album URLs — one per line</li>
                    <li>• Connect your account to import <span className="text-white">private playlists</span></li>
                    <li>• Public links work without connecting</li>
                  </ul>
                  <div className="font-mono mt-2 space-y-0.5">
                    <div>https://open.spotify.com/track/TRACK_ID</div>
                    <div>https://open.spotify.com/playlist/PLAYLIST_ID</div>
                    <div>https://open.spotify.com/album/ALBUM_ID</div>
                  </div>
                </div>

                {/* OAuth connect / disconnect */}
                {spotifyStatus?.configured ? (
                  <div className="flex items-center justify-between bg-surface-overlay/30 rounded-lg px-3 py-2.5 border border-surface-border">
                    <span className="text-sm text-slate-300 flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${spotifyStatus.connected ? 'bg-green-500' : 'bg-slate-500'}`} />
                      {spotifyStatus.connected ? 'Connected to Spotify' : 'Not connected'}
                    </span>
                    {spotifyStatus.connected ? (
                      <button
                        onClick={() => disconnectSpotify.mutate()}
                        className="text-xs text-slate-400 hover:text-red-400 transition-colors"
                      >
                        Disconnect
                      </button>
                    ) : (
                      <a
                        href={getSpotifyAuthUrl()}
                        className="text-xs px-3 py-1 bg-green-600 hover:bg-green-500 text-white rounded-lg transition-colors"
                      >
                        Connect Spotify
                      </a>
                    )}
                  </div>
                ) : (
                  <div className="flex items-start gap-2 text-xs text-yellow-400 bg-yellow-400/10 rounded-lg p-3 border border-yellow-400/20">
                    <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                    <div>
                      <div className="font-medium">Spotify credentials not configured</div>
                      <div className="text-yellow-400/70 mt-0.5">
                        Set <code className="font-mono">SPOTIFY_CLIENT_ID</code> and{' '}
                        <code className="font-mono">SPOTIFY_CLIENT_SECRET</code> in your{' '}
                        <code className="font-mono">.env</code> to enable OAuth &amp; private playlists.
                        Public URLs still work without OAuth.
                      </div>
                    </div>
                  </div>
                )}

                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Paste Spotify track, playlist, or album URLs…"
                  rows={7}
                  className="w-full px-4 py-3 bg-surface-base border border-surface-border rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary font-mono text-sm resize-none"
                />
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500">
                    {text.trim().split('\n').filter(Boolean).length} lines
                  </span>
                  <div className="flex gap-2">
                    <button onClick={handleClear} className="px-3 py-1.5 text-sm bg-surface-overlay hover:bg-surface-border text-white rounded-lg border border-surface-border transition-colors">
                      Clear
                    </button>
                    <button
                      onClick={handleSpotifyImport}
                      disabled={!text.trim() || importSpotify.isPending}
                      className="flex items-center gap-2 px-4 py-1.5 text-sm bg-green-600 hover:bg-green-500 disabled:bg-surface-overlay disabled:text-slate-500 text-white rounded-lg transition-colors"
                    >
                      {importSpotify.isPending ? <Loader2 className="animate-spin" size={15} /> : <Upload size={15} />}
                      Import
                    </button>
                  </div>
                </div>
                {result && <ImportResultDisplay result={result} />}
              </>
            )}

            {/* ── SoundCloud ── */}
            {mode === 'soundcloud' && (
              <>
                <div className="text-xs text-slate-500 bg-surface-overlay/30 rounded-lg p-3 border border-surface-border space-y-1.5">
                  <div className="font-medium text-slate-400">How it works:</div>
                  <ul className="space-y-1">
                    <li>• Downloading is handled by the backend import engine</li>
                    <li>• Paste track or playlist URLs — one per line</li>
                    <li>• Playlist URLs contain <code className="font-mono text-slate-300">/sets/</code> in the path</li>
                  </ul>
                  <div className="font-mono mt-2 space-y-0.5">
                    <div>https://soundcloud.com/artist/track-name</div>
                    <div>https://soundcloud.com/artist/sets/playlist-name</div>
                  </div>
                </div>

                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Paste SoundCloud track or playlist URLs…"
                  rows={8}
                  className="w-full px-4 py-3 bg-surface-base border border-surface-border rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary font-mono text-sm resize-none"
                />
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500">
                    {text.trim().split('\n').filter(Boolean).length} lines
                  </span>
                  <div className="flex gap-2">
                    <button onClick={handleClear} className="px-3 py-1.5 text-sm bg-surface-overlay hover:bg-surface-border text-white rounded-lg border border-surface-border transition-colors">
                      Clear
                    </button>
                    <button
                      onClick={handleSoundCloudImport}
                      disabled={!text.trim() || importSoundCloud.isPending}
                      className="flex items-center gap-2 px-4 py-1.5 text-sm bg-orange-500 hover:bg-orange-400 disabled:bg-surface-overlay disabled:text-slate-500 text-white rounded-lg transition-colors"
                    >
                      {importSoundCloud.isPending ? <Loader2 className="animate-spin" size={15} /> : <Upload size={15} />}
                      Import
                    </button>
                  </div>
                </div>
                {result && <ImportResultDisplay result={result} />}
              </>
            )}

            {/* ── Local Files ── */}
            {mode === 'local' && (
              <>
                <div className="bg-surface-overlay/30 rounded-lg p-3 space-y-2 border border-surface-border">
                  <div className="text-xs font-semibold text-white">Import as:</div>
                  <div className="space-y-1.5">
                    {(['sample', 'track'] as const).map((v) => (
                      <label key={v} className="flex items-center gap-3 cursor-pointer hover:bg-surface-overlay/50 p-2 rounded transition-colors">
                        <input
                          type="radio"
                          name="localImportType"
                          value={v}
                          checked={localImportType === v}
                          onChange={() => setLocalImportType(v)}
                          className="w-4 h-4 cursor-pointer"
                        />
                        <div>
                          <div className="text-sm font-medium text-white">
                            {v === 'sample' ? 'Sample (auto-analyze)' : 'Track (no analysis)'}
                          </div>
                          <div className="text-xs text-slate-400">
                            {v === 'sample' ? 'Audio features analyzed immediately' : 'Import without analysis'}
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                    isDragging
                      ? 'border-accent-primary bg-accent-primary/10'
                      : 'border-surface-border hover:border-slate-500 hover:bg-surface-overlay/30'
                  }`}
                >
                  <HardDrive className="mx-auto mb-3 text-slate-400" size={36} />
                  <div className="text-white font-medium text-sm">
                    {isDragging ? 'Drop files here' : 'Click to select or drag & drop'}
                  </div>
                  <div className="text-xs text-slate-400 mt-1">WAV · MP3 · FLAC · AIFF · OGG · M4A</div>
                  <input ref={fileInputRef} type="file" multiple accept=".wav,.mp3,.flac,.aiff,.ogg,.m4a" onChange={handleFileSelect} className="hidden" />
                </div>

                {isPending && (
                  <div className="flex items-center justify-center gap-2 text-accent-primary text-sm">
                    <Loader2 className="animate-spin" size={16} />
                    Importing files…
                  </div>
                )}
                {localResult && <BatchResultDisplay result={localResult} />}
              </>
            )}

            {/* ── Local Folder ── */}
            {mode === 'folder' && (
              <>
                <div className="bg-surface-overlay/30 rounded-lg p-3 space-y-2 border border-surface-border">
                  <div className="text-xs font-semibold text-white">Import as:</div>
                  <div className="space-y-1.5">
                    {(['sample', 'track'] as const).map((v) => (
                      <label key={v} className="flex items-center gap-3 cursor-pointer hover:bg-surface-overlay/50 p-2 rounded transition-colors">
                        <input
                          type="radio"
                          name="folderImportType"
                          value={v}
                          checked={folderImportType === v}
                          onChange={() => setFolderImportType(v)}
                          className="w-4 h-4 cursor-pointer"
                        />
                        <div>
                          <div className="text-sm font-medium text-white">
                            {v === 'sample' ? 'Sample (auto-analyze)' : 'Track (no analysis)'}
                          </div>
                          <div className="text-xs text-slate-400">
                            {v === 'sample' ? 'Audio features analyzed immediately' : 'Import without analysis'}
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                <div
                  onClick={() => folderInputRef.current?.click()}
                  className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors border-surface-border hover:border-slate-500 hover:bg-surface-overlay/30"
                >
                  <FolderOpen className="mx-auto mb-3 text-yellow-500" size={36} />
                  <div className="text-white font-medium text-sm">
                    {selectedFolderName ? `Selected: ${selectedFolderName}` : 'Click to select a folder'}
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    All audio files in the folder will be imported
                  </div>
                  <input
                    ref={folderInputRef}
                    type="file"
                    // @ts-expect-error webkitdirectory is not in the types but works in browsers
                    webkitdirectory=""
                    directory=""
                    multiple
                    onChange={handleFolderSelect}
                    className="hidden"
                  />
                </div>

                {isPending && (
                  <div className="flex items-center justify-center gap-2 text-accent-primary text-sm">
                    <Loader2 className="animate-spin" size={16} />
                    Importing folder contents…
                  </div>
                )}

                {folderResult && (
                  folderResult.total === 0 ? (
                    <div className="border-t border-surface-border pt-4 flex items-start gap-2 text-yellow-400">
                      <XCircle size={18} className="mt-0.5 flex-shrink-0" />
                      <div className="font-medium text-sm">No audio files found in the selected folder</div>
                    </div>
                  ) : (
                    <BatchResultDisplay result={folderResult} />
                  )
                )}
              </>
            )}
          </div>
        </div>

        {showDownloadToolsUi && <ToolsPanel />}
      </div>
    </>
  )
}
