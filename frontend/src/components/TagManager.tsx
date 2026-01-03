import { useState } from 'react'
import { Plus, Trash2, Loader2 } from 'lucide-react'
import { useTags, useCreateTag } from '../hooks/useTracks'
import { deleteTag } from '../api/client'
import { useQueryClient } from '@tanstack/react-query'

const PRESET_COLORS = [
  '#ef4444', // red
  '#f97316', // orange
  '#f59e0b', // amber
  '#eab308', // yellow
  '#84cc16', // lime
  '#22c55e', // green
  '#10b981', // emerald
  '#14b8a6', // teal
  '#06b6d4', // cyan
  '#0ea5e9', // sky
  '#3b82f6', // blue
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#a855f7', // purple
  '#d946ef', // fuchsia
  '#ec4899', // pink
]

export function TagManager() {
  const [newTagName, setNewTagName] = useState('')
  const [selectedColor, setSelectedColor] = useState(PRESET_COLORS[0])
  const [deletingId, setDeletingId] = useState<number | null>(null)

  const { data: tags, isLoading } = useTags()
  const createTag = useCreateTag()
  const queryClient = useQueryClient()

  const handleCreateTag = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newTagName.trim()) return

    await createTag.mutateAsync({
      name: newTagName.trim(),
      color: selectedColor,
    })
    setNewTagName('')
  }

  const handleDeleteTag = async (id: number) => {
    setDeletingId(id)
    try {
      await deleteTag(id)
      queryClient.invalidateQueries({ queryKey: ['tags'] })
      queryClient.invalidateQueries({ queryKey: ['tracks'] })
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="px-2 py-1 border-b border-gray-700 text-center">
        <h1 className='text-6xl'>Under construction</h1>
      </div>
      {/* Create Tag Form */}
      <div className="bg-gray-800 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-700">
          <h2 className="font-semibold text-white">Create Tag</h2>
        </div>

        <form onSubmit={handleCreateTag} className="p-4 space-y-4">
          {/* Tag Name */}
          <input
            type="text"
            value={newTagName}
            onChange={(e) => setNewTagName(e.target.value)}
            placeholder="Tag name..."
            className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
          />

          {/* Color Picker */}
          <div className="space-y-2">
            <label className="text-sm text-gray-400">Color</label>
            <div className="flex flex-wrap gap-2">
              {PRESET_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setSelectedColor(color)}
                  className={`w-8 h-8 rounded-full transition-transform ${
                    selectedColor === color
                      ? 'ring-2 ring-white ring-offset-2 ring-offset-gray-800 scale-110'
                      : 'hover:scale-110'
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>

          {/* Preview & Submit */}
          <div className="flex items-center justify-between pt-2">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-400">Preview:</span>
              <span
                className="px-2 py-1 rounded text-sm font-medium"
                style={{
                  backgroundColor: selectedColor + '40',
                  color: selectedColor,
                }}
              >
                {newTagName || 'Tag name'}
              </span>
            </div>
            <button
              type="submit"
              disabled={!newTagName.trim() || createTag.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-700 text-white rounded-lg transition-colors"
            >
              {createTag.isPending ? (
                <Loader2 className="animate-spin" size={18} />
              ) : (
                <Plus size={18} />
              )}
              Create
            </button>
          </div>
        </form>
      </div>

      {/* Existing Tags */}
      <div className="bg-gray-800 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-700">
          <h2 className="font-semibold text-white">
            All Tags ({tags?.length || 0})
          </h2>
        </div>

        {isLoading ? (
          <div className="p-8 text-center">
            <Loader2 className="animate-spin mx-auto text-indigo-500" size={32} />
          </div>
        ) : tags && tags.length > 0 ? (
          <div className="p-4">
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => (
                <div
                  key={tag.id}
                  className="flex items-center gap-1 px-2 py-1 rounded group"
                  style={{
                    backgroundColor: tag.color + '40',
                  }}
                >
                  <span
                    className="text-sm font-medium"
                    style={{ color: tag.color }}
                  >
                    {tag.name}
                  </span>
                  <button
                    onClick={() => handleDeleteTag(tag.id)}
                    disabled={deletingId === tag.id}
                    className="p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ color: tag.color }}
                  >
                    {deletingId === tag.id ? (
                      <Loader2 className="animate-spin" size={14} />
                    ) : (
                      <Trash2 size={14} />
                    )}
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="p-8 text-center text-gray-500">
            No tags yet. Create one above.
          </div>
        )}
      </div>

      {/* Info */}
      <div className="bg-gray-800/50 rounded-lg p-4 text-sm text-gray-400">
        <p className="font-medium text-gray-300 mb-2">About Tags</p>
        <ul className="list-disc list-inside space-y-1">
          <li>Tags can be added to tracks and individual slices</li>
          <li>Use the sparkle icon on tracks to auto-generate tags with AI</li>
          <li>AI analyzes video titles and descriptions to suggest relevant tags</li>
          <li>Deleting a tag removes it from all tracks and slices</li>
        </ul>
      </div>
    </div>
  )
}
