import { Check, MinusCircle, FolderOpen, Tag as TagIcon, Users } from 'lucide-react'
import type { CustomOrderState } from '../hooks/useCustomOrderState'
import type { Folder, Tag, SliceWithTrack, Collection } from '../types'

interface Props {
  state: CustomOrderState
  collections: Collection[]
  folders: Folder[]
  tags: Tag[]
  slices: SliceWithTrack[]
  isSubmitting: boolean
  onBack: () => void
  onConfirm: () => void
}

function buildMap<T extends { id: number }>(items: T[]) {
  const map = new Map<number, T>()
  for (const item of items) map.set(item.id, item)
  return map
}

export function CustomOrderConfirmDialog({
  state,
  collections,
  folders,
  tags,
  slices,
  isSubmitting,
  onBack,
  onConfirm,
}: Props) {
  const folderMap = buildMap(folders)
  const tagMap = buildMap(tags)
  const sliceMap = buildMap(slices)
  const collectionName = collections.find(p => p.id === state.targetCollectionId)?.name || 'Unknown collection'
  const hasSelectionChanges = (folder: CustomOrderState['destinationFolders'][number]) => (
    folder.sourceSelection.selectedFolderIds.size > 0 ||
    folder.sourceSelection.selectedTagIds.size > 0 ||
    folder.sourceSelection.individuallySelectedIds.size > 0 ||
    folder.sourceSelection.excludedSampleIds.size > 0
  )

  const actionableDestinations = state.destinationFolders.filter(hasSelectionChanges)
  const folderDestinations = actionableDestinations.filter(f => f.destinationType === 'folder')
  const existingFolderDestinations = actionableDestinations.filter(f => f.destinationType === 'existing-folder')
  const tagDestinations = actionableDestinations.filter(f => f.destinationType === 'tag')
  const totalDestinations = folderDestinations.length + existingFolderDestinations.length + tagDestinations.length

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-surface-border">
        <h3 className="text-lg font-semibold text-white">Confirm Custom Order</h3>
        <p className="text-sm text-slate-400 mt-1">
          You are about to apply {totalDestinations} destination change{totalDestinations === 1 ? '' : 's'}.
          {folderDestinations.length > 0 && ` ${folderDestinations.length} new folder${folderDestinations.length === 1 ? '' : 's'} in ${collectionName}.`}
          {existingFolderDestinations.length > 0 && ` ${existingFolderDestinations.length} existing folder${existingFolderDestinations.length === 1 ? '' : 's'} to update.`}
          {tagDestinations.length > 0 && ` ${tagDestinations.length} instrument${tagDestinations.length === 1 ? '' : 's'} to apply.`}
        </p>
      </div>

      <div className="flex-1 overflow-auto px-6 py-4 space-y-4">
        {actionableDestinations.map(folder => {
          const foldersList = Array.from(folder.sourceSelection.selectedFolderIds)
            .map(id => folderMap.get(id))
            .filter(Boolean) as Folder[]
          const tagsList = Array.from(folder.sourceSelection.selectedTagIds)
            .map(id => tagMap.get(id))
            .filter(Boolean) as Tag[]
          const samplesList = Array.from(folder.sourceSelection.individuallySelectedIds)
            .map(id => sliceMap.get(id))
            .filter(Boolean) as SliceWithTrack[]
          const excludedList = Array.from(folder.sourceSelection.excludedSampleIds)
            .map(id => sliceMap.get(id))
            .filter(Boolean) as SliceWithTrack[]

          const parentFolderById = folder.parentFolderId ? folderMap.get(folder.parentFolderId) : null
          const parentFolderByTempId = folder.parentTempId
            ? state.destinationFolders.find(f => f.tempId === folder.parentTempId)
            : null
          const parentFolder = parentFolderById || parentFolderByTempId

          return (
            <div key={folder.tempId} className="border border-surface-border rounded-lg bg-surface-base p-4">
              <div className="flex items-center gap-2 mb-2">
                {folder.destinationType === 'tag' ? (
                  <TagIcon size={16} className="text-slate-400" />
                ) : (
                  <FolderOpen size={16} className="text-slate-400" />
                )}
                <h4 className="text-sm font-semibold text-white">{folder.name || 'Untitled'}</h4>
                {folder.destinationType === 'tag' && (
                  <span className="text-[11px] text-slate-500">Instrument</span>
                )}
                {folder.destinationType === 'existing-folder' && (
                  <span className="text-[11px] text-slate-500">Existing folder</span>
                )}
              </div>
              {folder.destinationType === 'folder' && (
                <div className="text-xs text-slate-500 mb-3">
                  Parent: {parentFolder?.name || 'Root'}
                </div>
              )}

              <div className="space-y-2">
                <div>
                  <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
                    <FolderOpen size={12} />
                    Folders ({foldersList.length})
                  </div>
                  {foldersList.length === 0 ? (
                    <p className="text-xs text-slate-500">None</p>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {foldersList.map(c => (
                        <span key={c.id} className="px-2 py-0.5 rounded-full text-xs bg-surface-base border border-surface-border text-slate-300">
                          {c.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
                    <TagIcon size={12} />
                    Instruments ({tagsList.length})
                  </div>
                  {tagsList.length === 0 ? (
                    <p className="text-xs text-slate-500">None</p>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {tagsList.map(t => (
                        <span key={t.id} className="px-2 py-0.5 rounded-full text-xs bg-surface-base border border-surface-border text-slate-300">
                          {t.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
                    <Users size={12} />
                    Samples ({samplesList.length})
                  </div>
                  {samplesList.length === 0 ? (
                    <p className="text-xs text-slate-500">None</p>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {samplesList.map(s => (
                        <span key={s.id} className="px-2 py-0.5 rounded-full text-xs bg-surface-base border border-surface-border text-slate-300">
                          {s.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <div className="flex items-center gap-2 text-xs text-red-400 mb-1">
                    <MinusCircle size={12} />
                    Excluded ({excludedList.length})
                  </div>
                  {excludedList.length === 0 ? (
                    <p className="text-xs text-slate-500">None</p>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {excludedList.map(s => (
                        <span key={s.id} className="px-2 py-0.5 rounded-full text-xs bg-red-500/10 border border-red-500/30 text-red-300">
                          {s.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="px-6 py-4 border-t border-surface-border flex items-center gap-3 justify-end">
        <button
          className="px-4 py-2 text-sm rounded-lg bg-surface-base border border-surface-border text-slate-300 hover:text-white"
          onClick={onBack}
          disabled={isSubmitting}
        >
          Back
        </button>
        <button
          className="px-4 py-2 text-sm rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50 flex items-center gap-2"
          onClick={onConfirm}
          disabled={isSubmitting}
        >
          <Check size={14} />
          {isSubmitting ? 'Applying...' : 'Apply changes'}
        </button>
      </div>
    </div>
  )
}
