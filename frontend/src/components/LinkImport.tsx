import { useState, useRef, useCallback } from 'react'
import { Upload, Loader2, CheckCircle, XCircle, Link, HardDrive, FolderOpen } from 'lucide-react'
import { useImportLinks, useImportLocalFiles } from '../hooks/useTracks'
import type { ImportResult } from '../types'
import type { BatchImportResult } from '../api/client'

type ImportMode = 'youtube' | 'local' | 'folder'

interface LinkImportProps {
  onTracksAdded: () => void
}

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
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

  const importLinks = useImportLinks()
  const importLocalFiles = useImportLocalFiles()

  const handleYouTubeImport = async () => {
    if (!text.trim()) return
    const res = await importLinks.mutateAsync(text)
    setResult(res)
    if (res.success.length > 0) {
      onTracksAdded()
    }
  }

  const handleLocalFilesImport = async (files: File[]) => {
    if (files.length === 0) return
    const res = await importLocalFiles.mutateAsync({ files, importType: localImportType })
    setLocalResult(res)
    if (res.successful > 0) {
      onTracksAdded()
    }
  }

  const handleFolderSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    // Filter only audio files
    const audioFiles = files.filter((f) =>
      /\.(wav|mp3|flac|aiff|ogg|m4a)$/i.test(f.name)
    )

    if (audioFiles.length === 0) {
      setFolderResult({
        total: 0,
        successful: 0,
        failed: 0,
        results: [],
      })
      return
    }

    // Get folder name from the first file's path
    const firstFile = files[0]
    const pathParts = firstFile.webkitRelativePath.split('/')
    setSelectedFolderName(pathParts[0] || 'Selected folder')

    const res = await importLocalFiles.mutateAsync({ files: audioFiles, importType: folderImportType })
    setFolderResult(res)
    if (res.successful > 0) {
      onTracksAdded()
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    handleLocalFilesImport(files)
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const files = Array.from(e.dataTransfer.files).filter((f) =>
      /\.(wav|mp3|flac|aiff|ogg|m4a)$/i.test(f.name)
    )
    if (files.length > 0) {
      handleLocalFilesImport(files)
    }
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
    if (folderInputRef.current) {
      folderInputRef.current.value = ''
    }
  }

  const exampleFormats = `Examples of supported formats:

• YouTube URLs (one per line):
  https://www.youtube.com/watch?v=dQw4w9WgXcQ
  https://youtu.be/dQw4w9WgXcQ

• Video IDs:
  dQw4w9WgXcQ

• YouTube Takeout/Export format (CSV):
  Video ID,Timestamp
  dQw4w9WgXcQ,2024-01-15

• Playlist URLs:
  https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf`

  const modes: { id: ImportMode; label: string; icon: React.ReactNode }[] = [
    { id: 'youtube', label: 'YouTube Links', icon: <Link size={16} /> },
    { id: 'local', label: 'Local Files', icon: <HardDrive size={16} /> },
    { id: 'folder', label: 'Local Folder', icon: <FolderOpen size={16} /> },
  ]

  return (
    <div className="space-y-4">
      <div className="bg-surface-raised rounded-lg overflow-hidden border border-surface-border">
        <div className="px-4 py-3 border-b border-surface-border">
          <h2 className="font-semibold text-white">Import Samples</h2>
          <p className="text-sm text-slate-400 mt-1">
            Import from YouTube, local audio files, or a folder
          </p>
        </div>

        {/* Mode Tabs */}
        <div className="flex border-b border-surface-border">
          {modes.map((m) => (
            <button
              key={m.id}
              onClick={() => {
                setMode(m.id)
                handleClear()
              }}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors ${
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
          {/* YouTube Links Mode */}
          {mode === 'youtube' && (
            <>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={exampleFormats}
                rows={12}
                className="w-full px-4 py-3 bg-surface-base border border-surface-border rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary font-mono text-sm resize-none"
              />

              <div className="flex items-center justify-between">
                <div className="text-sm text-slate-500">
                  {text.trim().split('\n').filter(Boolean).length} lines
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleClear}
                    className="px-4 py-2 bg-surface-overlay hover:bg-surface-border text-white rounded-lg transition-colors border border-surface-border"
                  >
                    Clear
                  </button>
                  <button
                    onClick={handleYouTubeImport}
                    disabled={!text.trim() || importLinks.isPending}
                    className="flex items-center gap-2 px-4 py-2 bg-accent-primary hover:bg-blue-600 disabled:bg-surface-overlay disabled:text-slate-500 text-white rounded-lg transition-colors"
                  >
                    {importLinks.isPending ? (
                      <Loader2 className="animate-spin" size={18} />
                    ) : (
                      <Upload size={18} />
                    )}
                    Import
                  </button>
                </div>
              </div>

              {result && (
                <div className="border-t border-surface-border pt-4 space-y-3">
                  {result.success.length > 0 && (
                    <div className="flex items-start gap-2 text-green-400">
                      <CheckCircle size={18} className="mt-0.5 flex-shrink-0" />
                      <div>
                        <div className="font-medium">
                          {result.success.length} imported successfully
                        </div>
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
                        <div className="font-medium">
                          {result.failed.length} failed to import
                        </div>
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
              )}
            </>
          )}

          {/* Local Files Mode */}
          {mode === 'local' && (
            <>
              <div className="bg-surface-overlay/30 rounded-lg p-3 space-y-3 border border-surface-border">
                <div className="text-sm font-semibold text-white">Import as:</div>
                <div className="space-y-2">
                  <label className="flex items-center gap-3 cursor-pointer hover:bg-surface-overlay/50 p-2 rounded transition-colors">
                    <input
                      type="radio"
                      name="localImportType"
                      value="sample"
                      checked={localImportType === 'sample'}
                      onChange={(e) => setLocalImportType(e.target.value as 'sample' | 'track')}
                      className="w-5 h-5 cursor-pointer"
                    />
                    <div>
                      <div className="text-sm font-medium text-white">Sample (auto-analyze)</div>
                      <div className="text-xs text-slate-400">Audio features analyzed immediately</div>
                    </div>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer hover:bg-surface-overlay/50 p-2 rounded transition-colors">
                    <input
                      type="radio"
                      name="localImportType"
                      value="track"
                      checked={localImportType === 'track'}
                      onChange={(e) => setLocalImportType(e.target.value as 'sample' | 'track')}
                      className="w-5 h-5 cursor-pointer"
                    />
                    <div>
                      <div className="text-sm font-medium text-white">Track (no analysis)</div>
                      <div className="text-xs text-slate-400">Import without analysis</div>
                    </div>
                  </label>
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
                <HardDrive className="mx-auto mb-3 text-slate-400" size={40} />
                <div className="text-white font-medium">
                  {isDragging ? 'Drop files here' : 'Click to select or drag & drop'}
                </div>
                <div className="text-sm text-slate-400 mt-1">
                  Supported: WAV, MP3, FLAC, AIFF, OGG, M4A
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".wav,.mp3,.flac,.aiff,.ogg,.m4a"
                  onChange={handleFileSelect}
                  className="hidden"
                />
              </div>

              {importLocalFiles.isPending && (
                <div className="flex items-center justify-center gap-2 text-accent-primary">
                  <Loader2 className="animate-spin" size={18} />
                  Importing files...
                </div>
              )}

              {localResult && (
                <div className="border-t border-surface-border pt-4 space-y-3">
                  {localResult.successful > 0 && (
                    <div className="flex items-start gap-2 text-green-400">
                      <CheckCircle size={18} className="mt-0.5 flex-shrink-0" />
                      <div>
                        <div className="font-medium">
                          {localResult.successful} of {localResult.total} imported successfully
                        </div>
                      </div>
                    </div>
                  )}

                  {localResult.failed > 0 && (
                    <div className="flex items-start gap-2 text-red-400">
                      <XCircle size={18} className="mt-0.5 flex-shrink-0" />
                      <div>
                        <div className="font-medium">
                          {localResult.failed} failed to import
                        </div>
                        <div className="text-sm text-red-400/70 max-h-24 overflow-y-auto">
                          {localResult.results
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
              )}
            </>
          )}

          {/* Local Folder Mode */}
          {mode === 'folder' && (
            <>
              <div className="bg-surface-overlay/30 rounded-lg p-3 space-y-3 border border-surface-border">
                <div className="text-sm font-semibold text-white">Import as:</div>
                <div className="space-y-2">
                  <label className="flex items-center gap-3 cursor-pointer hover:bg-surface-overlay/50 p-2 rounded transition-colors">
                    <input
                      type="radio"
                      name="folderImportType"
                      value="sample"
                      checked={folderImportType === 'sample'}
                      onChange={(e) => setFolderImportType(e.target.value as 'sample' | 'track')}
                      className="w-5 h-5 cursor-pointer"
                    />
                    <div>
                      <div className="text-sm font-medium text-white">Sample (auto-analyze)</div>
                      <div className="text-xs text-slate-400">Audio features analyzed immediately</div>
                    </div>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer hover:bg-surface-overlay/50 p-2 rounded transition-colors">
                    <input
                      type="radio"
                      name="folderImportType"
                      value="track"
                      checked={folderImportType === 'track'}
                      onChange={(e) => setFolderImportType(e.target.value as 'sample' | 'track')}
                      className="w-5 h-5 cursor-pointer"
                    />
                    <div>
                      <div className="text-sm font-medium text-white">Track (no analysis)</div>
                      <div className="text-xs text-slate-400">Import without analysis</div>
                    </div>
                  </label>
                </div>
              </div>

              <div
                onClick={() => folderInputRef.current?.click()}
                className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors border-surface-border hover:border-slate-500 hover:bg-surface-overlay/30"
              >
                <FolderOpen className="mx-auto mb-3 text-yellow-500" size={40} />
                <div className="text-white font-medium">
                  {selectedFolderName ? `Selected: ${selectedFolderName}` : 'Click to select a folder'}
                </div>
                <div className="text-sm text-slate-400 mt-1">
                  All audio files in the folder will be imported (WAV, MP3, FLAC, AIFF, OGG, M4A)
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

              {importLocalFiles.isPending && (
                <div className="flex items-center justify-center gap-2 text-accent-primary">
                  <Loader2 className="animate-spin" size={18} />
                  Importing folder contents...
                </div>
              )}

              {folderResult && (
                <div className="border-t border-surface-border pt-4 space-y-3">
                  {folderResult.total === 0 ? (
                    <div className="flex items-start gap-2 text-yellow-400">
                      <XCircle size={18} className="mt-0.5 flex-shrink-0" />
                      <div className="font-medium">
                        No audio files found in the selected folder
                      </div>
                    </div>
                  ) : (
                    <>
                      {folderResult.successful > 0 && (
                        <div className="flex items-start gap-2 text-green-400">
                          <CheckCircle size={18} className="mt-0.5 flex-shrink-0" />
                          <div>
                            <div className="font-medium">
                              {folderResult.successful} of {folderResult.total} imported successfully
                            </div>
                          </div>
                        </div>
                      )}

                      {folderResult.failed > 0 && (
                        <div className="flex items-start gap-2 text-red-400">
                          <XCircle size={18} className="mt-0.5 flex-shrink-0" />
                          <div>
                            <div className="font-medium">
                              {folderResult.failed} failed to import
                            </div>
                            <div className="text-sm text-red-400/70 max-h-24 overflow-y-auto">
                              {folderResult.results
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
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
