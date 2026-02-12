import { useMemo } from 'react'
import { FolderOpen, Tag as TagIcon, Users, MinusCircle } from 'lucide-react'
import type { Folder, Tag, SliceWithTrack } from '../types'
import type { CustomOrderState } from '../hooks/useCustomOrderState'

interface Props {
  state: CustomOrderState
  folders: Folder[]
  tags: Tag[]
  slices: SliceWithTrack[]
}

function buildMap<T extends { id: number }>(items: T[]) {
  const map = new Map<number, T>()
  for (const item of items) map.set(item.id, item)
  return map
}

export function CustomOrderSelectionSummary({ state, folders, tags, slices }: Props) {
  const activeFolder = state.destinationFolders.find(f => f.tempId === state.activeFolderId)

  const folderMap = useMemo(() => buildMap(folders), [folders])
  const tagMap = useMemo(() => buildMap(tags), [tags])
  const sliceMap = useMemo(() => buildMap(slices), [slices])

  const selectedFolders = useMemo(() => {
    if (!activeFolder) return []
    return Array.from(activeFolder.sourceSelection.selectedFolderIds)
      .map(id => folderMap.get(id))
      .filter(Boolean) as Folder[]
  }, [activeFolder, folderMap])

  const selectedTags = useMemo(() => {
    if (!activeFolder) return []
    return Array.from(activeFolder.sourceSelection.selectedTagIds)
      .map(id => tagMap.get(id))
      .filter(Boolean) as Tag[]
  }, [activeFolder, tagMap])

  const selectedSamples = useMemo(() => {
    if (!activeFolder) return []
    return Array.from(activeFolder.sourceSelection.individuallySelectedIds)
      .map(id => sliceMap.get(id))
      .filter(Boolean) as SliceWithTrack[]
  }, [activeFolder, sliceMap])

  const excludedSamples = useMemo(() => {
    if (!activeFolder) return []
    return Array.from(activeFolder.sourceSelection.excludedSampleIds)
      .map(id => sliceMap.get(id))
      .filter(Boolean) as SliceWithTrack[]
  }, [activeFolder, sliceMap])

  if (!activeFolder) {
    return (
      <div className="px-4 py-3 border-b border-surface-border">
        <p className="text-sm text-slate-500">Select or create a destination folder to begin.</p>
      </div>
    )
  }

  const renderList = (items: Array<{ id: number; name: string }>, max = 6) => {
    if (items.length === 0) return <p className="text-xs text-slate-500">None selected</p>
    const visible = items.slice(0, max)
    return (
      <div className="flex flex-wrap gap-1">
        {visible.map(item => (
          <span key={item.id} className="px-2 py-0.5 rounded-full text-xs bg-surface-base border border-surface-border text-slate-300">
            {item.name}
          </span>
        ))}
        {items.length > max && (
          <span className="px-2 py-0.5 rounded-full text-xs bg-surface-base border border-surface-border text-slate-500">
            +{items.length - max} more
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="px-4 py-3 border-b border-surface-border">
      <h4 className="text-sm font-medium text-slate-200 mb-2">Selected Sources</h4>
      <div className="space-y-2">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
            <FolderOpen size={12} />
            Folders ({selectedFolders.length})
          </div>
          {renderList(selectedFolders)}
        </div>
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
            <TagIcon size={12} />
            Tags ({selectedTags.length})
          </div>
          {renderList(selectedTags)}
        </div>
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
            <Users size={12} />
            Samples ({selectedSamples.length})
          </div>
          {renderList(selectedSamples)}
        </div>
        <div>
          <div className="flex items-center gap-2 text-xs text-red-400 mb-1">
            <MinusCircle size={12} />
            Excluded ({excludedSamples.length})
          </div>
          {excludedSamples.length === 0 ? (
            <p className="text-xs text-slate-500">None excluded</p>
          ) : (
            <div className="flex flex-wrap gap-1">
              {excludedSamples.slice(0, 6).map(sample => (
                <span key={sample.id} className="px-2 py-0.5 rounded-full text-xs bg-red-500/10 border border-red-500/30 text-red-300">
                  {sample.name}
                </span>
              ))}
              {excludedSamples.length > 6 && (
                <span className="px-2 py-0.5 rounded-full text-xs bg-red-500/10 border border-red-500/30 text-red-400">
                  +{excludedSamples.length - 6} more
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
