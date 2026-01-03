import { useState } from 'react'
import { Search, Plus, Loader2, ExternalLink } from 'lucide-react'
import { useYouTubeSearch, useAddTracks } from '../hooks/useTracks'

interface YouTubeSearchProps {
  onTrackAdded: () => void
}

export function YouTubeSearch({ onTrackAdded }: YouTubeSearchProps) {
  const [query, setQuery] = useState('')
  const [searchTerm, setSearchTerm] = useState('')

  const { data: results, isLoading, error } = useYouTubeSearch(searchTerm)
  const addTracks = useAddTracks()

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setSearchTerm(query)
  }

  const handleAddTrack = async (videoId: string) => {
    await addTracks.mutateAsync([`https://www.youtube.com/watch?v=${videoId}`])
    onTrackAdded()
  }

  return (
    <div className="space-y-4">
      {/* Search Form */}
      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="relative flex-1">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
            size={18}
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search YouTube..."
            className="w-full pl-10 pr-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
          />
        </div>
        <button
          type="submit"
          disabled={!query.trim() || isLoading}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-700 text-white rounded-lg transition-colors"
        >
          {isLoading ? <Loader2 className="animate-spin" size={20} /> : 'Search'}
        </button>
      </form>

      {/* Results */}
      <div className="bg-gray-800 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-700">
          <h2 className="font-semibold text-white">
            {searchTerm ? `Results for "${searchTerm}"` : 'Search Results'}
          </h2>
        </div>

        {error ? (
          <div className="p-8 text-center text-red-400">
            Error searching YouTube. Please check your API key.
          </div>
        ) : results && results.length > 0 ? (
          <div className="divide-y divide-gray-700 max-h-[600px] overflow-y-auto">
            {results.map((result) => (
              <div
                key={result.videoId}
                className="flex items-center gap-3 p-3 hover:bg-gray-700/50 transition-colors"
              >
                {/* Thumbnail */}
                <img
                  src={result.thumbnailUrl}
                  alt={result.title}
                  className="w-24 h-16 object-cover rounded"
                />

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-white truncate">
                    {result.title}
                  </h3>
                  <p className="text-sm text-gray-400 truncate">
                    {result.channelTitle}
                  </p>
                  <p className="text-xs text-gray-500 line-clamp-1">
                    {result.description}
                  </p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1">
                  <a
                    href={`https://www.youtube.com/watch?v=${result.videoId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2 text-gray-400 hover:text-white transition-colors"
                    title="Open in YouTube"
                  >
                    <ExternalLink size={16} />
                  </a>
                  <button
                    onClick={() => handleAddTrack(result.videoId)}
                    disabled={addTracks.isPending}
                    className="p-2 text-gray-400 hover:text-green-400 transition-colors"
                    title="Add to tracks"
                  >
                    {addTracks.isPending ? (
                      <Loader2 className="animate-spin" size={16} />
                    ) : (
                      <Plus size={16} />
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : searchTerm ? (
          <div className="p-8 text-center text-gray-500">
            No results found for "{searchTerm}"
          </div>
        ) : (
          <div className="p-8 text-center text-gray-500">
            Enter a search term to find YouTube videos
          </div>
        )}
      </div>
    </div>
  )
}
