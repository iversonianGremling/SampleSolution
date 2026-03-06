import { useState } from 'react'
import { X, Folder as FolderIcon, FolderPlus, ChevronRight, ChevronDown, Loader2 } from 'lucide-react'
import type { Collection, Folder, SliceWithTrack } from '../types'

interface MoveToFolderModalProps {
  selectedSlices: SliceWithTrack[]
  folders: Folder[]
  collections: Collection[]
  onMove: (targetFolderId: number, removeFromCurrentFolders: boolean) => Promise<void>
  onCreateFolder: (name: string, collectionId: number | null) => Promise<Folder>
  onCancel: () => void
}

export function MoveToFolderModal({
  selectedSlices,
  folders,
  collections,
  onMove,
  onCreateFolder,
  onCancel,
}: MoveToFolderModalProps) {
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null)
  const [removeFromCurrentFolders, setRemoveFromCurrentFolders] = useState(false)
  const [expandedCollectionIds, setExpandedCollectionIds] = useState<Set<number>>(new Set())
  const [creatingFolderInCollectionId, setCreatingFolderInCollectionId] = useState<number | 'ungrouped' | null>(null)
  const [newFolderName, setNewFolderName] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  // Inline warning for when user tries to select a collection directly
  const [collectionWarningId, setCollectionWarningId] = useState<number | null>(null)

  // Collect all folder IDs the selected slices currently belong to
  const currentFolderIds = new Set<number>()
  for (const slice of selectedSlices) {
    for (const fid of slice.folderIds) {
      currentFolderIds.add(fid)
    }
  }
  const hasExistingFolders = currentFolderIds.size > 0

  // Group folders
  const ungroupedFolders = folders.filter((f) => f.collectionId === null && f.parentId === null)
  const foldersByCollection: Record<number, Folder[]> = {}
  for (const f of folders) {
    if (f.collectionId !== null && f.parentId === null) {
      if (!foldersByCollection[f.collectionId]) foldersByCollection[f.collectionId] = []
      foldersByCollection[f.collectionId].push(f)
    }
  }

  const toggleCollection = (collectionId: number) => {
    setCollectionWarningId(null)
    setExpandedCollectionIds((prev) => {
      const next = new Set(prev)
      if (next.has(collectionId)) next.delete(collectionId)
      else next.add(collectionId)
      return next
    })
  }

  const handleConfirm = async () => {
    if (selectedFolderId === null) return
    setIsProcessing(true)
    try {
      await onMove(selectedFolderId, removeFromCurrentFolders)
    } finally {
      setIsProcessing(false)
    }
  }

  const handleCreateFolder = async () => {
    if (!newFolderName.trim() || creatingFolderInCollectionId === null) return
    const collectionId = creatingFolderInCollectionId === 'ungrouped' ? null : creatingFolderInCollectionId
    setIsProcessing(true)
    try {
      const created = await onCreateFolder(newFolderName.trim(), collectionId)
      setSelectedFolderId(created.id)
      setCreatingFolderInCollectionId(null)
      setNewFolderName('')
      // Auto-expand the collection if needed
      if (collectionId !== null) {
        setExpandedCollectionIds((prev) => new Set([...prev, collectionId]))
      }
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onCancel} />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none p-4">
        <div className="bg-gray-800 rounded-xl overflow-hidden flex flex-col w-full max-w-md pointer-events-auto shadow-2xl border border-gray-700 max-h-[80vh]">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 flex-shrink-0">
            <h2 className="text-base font-semibold text-white">
              Move {selectedSlices.length} sample{selectedSlices.length !== 1 ? 's' : ''} to…
            </h2>
            <button
              onClick={onCancel}
              className="p-1 text-gray-400 hover:text-white rounded-lg transition-colors hover:bg-gray-700"
            >
              <X size={18} />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto min-h-0 p-3 space-y-1">

            {/* Ungrouped folders */}
            {ungroupedFolders.length > 0 && (
              <div className="mb-1">
                <p className="text-xs text-gray-500 uppercase tracking-wider px-2 mb-1">My Folders</p>
                {ungroupedFolders.map((folder) => (
                  <FolderRow
                    key={folder.id}
                    folder={folder}
                    isSelected={selectedFolderId === folder.id}
                    onClick={() => setSelectedFolderId(folder.id)}
                  />
                ))}
              </div>
            )}

            {/* Collections — expandable, folders selectable inside */}
            {collections.map((collection) => {
              const colFolders = foldersByCollection[collection.id] ?? []
              const isExpanded = expandedCollectionIds.has(collection.id)
              const isWarning = collectionWarningId === collection.id

              return (
                <div key={collection.id}>
                  {/* Collection header row — click to expand, not to select */}
                  <button
                    onClick={() => toggleCollection(collection.id)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
                  >
                    {isExpanded
                      ? <ChevronDown size={14} className="text-gray-500 flex-shrink-0" />
                      : <ChevronRight size={14} className="text-gray-500 flex-shrink-0" />
                    }
                    <div
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: collection.color }}
                    />
                    <span className="font-medium flex-1 text-left">{collection.name}</span>
                    <span className="text-xs text-gray-500">
                      {colFolders.length} folder{colFolders.length !== 1 ? 's' : ''}
                    </span>
                  </button>

                  {/* Expanded: folders inside collection */}
                  {isExpanded && (
                    <div className="ml-4 mt-0.5 space-y-0.5">
                      {isWarning && (
                        <p className="text-xs text-amber-400 px-2 py-1">
                          Select a folder inside this collection, not the collection itself.
                        </p>
                      )}

                      {colFolders.length === 0 && creatingFolderInCollectionId !== collection.id && (
                        <p className="text-xs text-gray-500 px-2 py-1">No folders yet</p>
                      )}

                      {colFolders.map((folder) => (
                        <FolderRow
                          key={folder.id}
                          folder={folder}
                          isSelected={selectedFolderId === folder.id}
                          onClick={() => setSelectedFolderId(folder.id)}
                        />
                      ))}

                      {creatingFolderInCollectionId === collection.id ? (
                        <NewFolderInput
                          value={newFolderName}
                          onChange={setNewFolderName}
                          onConfirm={handleCreateFolder}
                          onCancel={() => { setCreatingFolderInCollectionId(null); setNewFolderName('') }}
                          isProcessing={isProcessing}
                        />
                      ) : (
                        <button
                          onClick={() => { setCreatingFolderInCollectionId(collection.id); setNewFolderName('') }}
                          className="flex items-center gap-1.5 px-2 py-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                        >
                          <FolderPlus size={12} />
                          New folder
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}

            {ungroupedFolders.length === 0 && collections.length === 0 && (
              <p className="text-sm text-gray-500 text-center py-4">No folders yet</p>
            )}

            {/* Create new ungrouped folder */}
            {creatingFolderInCollectionId === 'ungrouped' ? (
              <NewFolderInput
                value={newFolderName}
                onChange={setNewFolderName}
                onConfirm={handleCreateFolder}
                onCancel={() => { setCreatingFolderInCollectionId(null); setNewFolderName('') }}
                isProcessing={isProcessing}
              />
            ) : (
              <button
                onClick={() => { setCreatingFolderInCollectionId('ungrouped'); setNewFolderName('') }}
                className="flex items-center gap-1.5 px-2 py-1.5 text-sm text-indigo-400 hover:text-indigo-300 transition-colors"
              >
                <FolderPlus size={14} />
                New folder
              </button>
            )}
          </div>

          {/* Footer */}
          <div className="flex-shrink-0 border-t border-gray-700 px-5 py-4 space-y-3">
            {hasExistingFolders && selectedFolderId !== null && (
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={removeFromCurrentFolders}
                  onChange={(e) => setRemoveFromCurrentFolders(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-gray-600 bg-gray-700 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-sm text-gray-300">
                  Remove from current folder{currentFolderIds.size !== 1 ? 's' : ''} (move instead of copy)
                </span>
              </label>
            )}

            <div className="flex gap-3">
              <button
                onClick={onCancel}
                disabled={isProcessing}
                className="flex-1 px-4 py-2 rounded-lg text-sm font-medium text-gray-300 bg-gray-700 hover:bg-gray-600 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={selectedFolderId === null || isProcessing}
                className="flex-1 px-4 py-2 rounded-lg text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isProcessing && <Loader2 size={14} className="animate-spin" />}
                {removeFromCurrentFolders ? 'Move' : 'Add to folder'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

function FolderRow({
  folder,
  isSelected,
  onClick,
}: {
  folder: Folder
  isSelected: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors ${
        isSelected
          ? 'bg-indigo-600 text-white'
          : 'text-gray-300 hover:bg-gray-700 hover:text-white'
      }`}
    >
      <div
        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
        style={{ backgroundColor: folder.color }}
      />
      <FolderIcon size={14} className="flex-shrink-0 text-gray-400" />
      <span className="flex-1 text-left">{folder.name}</span>
      <span className="text-xs text-gray-500">{folder.sliceCount} samples</span>
    </button>
  )
}

function NewFolderInput({
  value,
  onChange,
  onConfirm,
  onCancel,
  isProcessing,
}: {
  value: string
  onChange: (v: string) => void
  onConfirm: () => void
  onCancel: () => void
  isProcessing: boolean
}) {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5">
      <FolderPlus size={14} className="text-indigo-400 flex-shrink-0" />
      <input
        autoFocus
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onConfirm()
          if (e.key === 'Escape') onCancel()
        }}
        placeholder="Folder name…"
        className="flex-1 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
      />
      <button
        onClick={onConfirm}
        disabled={!value.trim() || isProcessing}
        className="px-2 py-1 text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded disabled:opacity-50"
      >
        {isProcessing ? <Loader2 size={12} className="animate-spin" /> : 'Create'}
      </button>
      <button
        onClick={onCancel}
        className="px-2 py-1 text-xs text-gray-400 hover:text-white"
      >
        <X size={12} />
      </button>
    </div>
  )
}
