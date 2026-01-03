import { useState } from 'react'
import { Upload, Loader2, CheckCircle, XCircle } from 'lucide-react'
import { useImportLinks } from '../hooks/useTracks'
import type { ImportResult } from '../types'

interface LinkImportProps {
  onTracksAdded: () => void
}

export function LinkImport({ onTracksAdded }: LinkImportProps) {
  const [text, setText] = useState('')
  const [result, setResult] = useState<ImportResult | null>(null)

  const importLinks = useImportLinks()

  const handleImport = async () => {
    if (!text.trim()) return
    const res = await importLinks.mutateAsync(text)
    setResult(res)
    if (res.success.length > 0) {
      onTracksAdded()
    }
  }

  const handleClear = () => {
    setText('')
    setResult(null)
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

  return (
    <div className="space-y-4">
      <div className="bg-gray-800 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-700">
          <h2 className="font-semibold text-white">Import Links</h2>
          <p className="text-sm text-gray-400 mt-1">
            Paste YouTube URLs, video IDs, or exported playlist data
          </p>
        </div>

        <div className="p-4 space-y-4">
          {/* Text Area */}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={exampleFormats}
            rows={12}
            className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 font-mono text-sm resize-none"
          />

          {/* Actions */}
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-500">
              {text.trim().split('\n').filter(Boolean).length} lines
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleClear}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
              >
                Clear
              </button>
              <button
                onClick={handleImport}
                disabled={!text.trim() || importLinks.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-700 text-white rounded-lg transition-colors"
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

          {/* Results */}
          {result && (
            <div className="border-t border-gray-700 pt-4 space-y-3">
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
        </div>
      </div>
    </div>
  )
}
