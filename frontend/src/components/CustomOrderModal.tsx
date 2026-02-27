import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { getSelectionChangeCount, useCustomOrderState } from '../hooks/useCustomOrderState'
import { useAllSlices, useFolders, useCollections, useTags, useBatchCreateFolders, useBatchApplyTagToSlices, useBatchAddSlicesToFolder } from '../hooks/useTracks'
import type { DestinationFolder } from '../hooks/useCustomOrderState'
import type { SliceWithTrack, Folder, Tag, Collection } from '../types'
import { CustomOrderSourcePane } from './CustomOrderSourcePane'
import { CustomOrderDestinationPane } from './CustomOrderDestinationPane'
import { CustomOrderConfirmDialog } from './CustomOrderConfirmDialog'

interface Props {
  onClose: () => void
  activeCollectionId: number | null
}

function computeSliceIdsForFolder(folder: DestinationFolder, allSlices: SliceWithTrack[]) {
  const selected = new Set<number>()

  if (folder.sourceSelection.selectedFolderIds.size > 0) {
    for (const slice of allSlices) {
      if (slice.folderIds?.some(id => folder.sourceSelection.selectedFolderIds.has(id))) {
        selected.add(slice.id)
      }
    }
  }

  if (folder.sourceSelection.selectedTagIds.size > 0) {
    for (const slice of allSlices) {
      if (slice.tags?.some(tag => folder.sourceSelection.selectedTagIds.has(tag.id))) {
        selected.add(slice.id)
      }
    }
  }

  if (folder.sourceSelection.excludedFolderIds.size > 0 || folder.sourceSelection.excludedTagIds.size > 0) {
    for (const slice of allSlices) {
      const inExcludedFolder =
        folder.sourceSelection.excludedFolderIds.size > 0 &&
        slice.folderIds?.some(id => folder.sourceSelection.excludedFolderIds.has(id))

      const inExcludedTag =
        folder.sourceSelection.excludedTagIds.size > 0 &&
        slice.tags?.some(tag => folder.sourceSelection.excludedTagIds.has(tag.id))

      if (inExcludedFolder || inExcludedTag) {
        selected.delete(slice.id)
      }
    }
  }

  for (const id of folder.sourceSelection.individuallySelectedIds) {
    selected.add(id)
  }

  for (const id of folder.sourceSelection.excludedSampleIds) {
    selected.delete(id)
  }

  return Array.from(selected)
}

function hasSelectionChanges(folder: DestinationFolder) {
  return (
    folder.sourceSelection.selectedFolderIds.size > 0 ||
    folder.sourceSelection.selectedTagIds.size > 0 ||
    folder.sourceSelection.excludedFolderIds.size > 0 ||
    folder.sourceSelection.excludedTagIds.size > 0 ||
    folder.sourceSelection.individuallySelectedIds.size > 0 ||
    folder.sourceSelection.excludedSampleIds.size > 0
  )
}

function orderFoldersForCreate(folders: DestinationFolder[]): DestinationFolder[] {
  const byParent = new Map<string | null, DestinationFolder[]>()
  for (const folder of folders) {
    const key = folder.parentTempId ?? null
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key)!.push(folder)
  }

  const result: DestinationFolder[] = []
  const visit = (parentId: string | null) => {
    const nodes = byParent.get(parentId) || []
    for (const node of nodes) {
      result.push(node)
      visit(node.tempId)
    }
  }

  visit(null)
  return result
}

export function CustomOrderModal({ onClose, activeCollectionId }: Props) {
  const [state, dispatch] = useCustomOrderState(activeCollectionId)
  const [isClosing, setIsClosing] = useState(false)
  const [isEntering, setIsEntering] = useState(true)
  const [showDiscardWarning, setShowDiscardWarning] = useState(false)
  const [layoutMode] = useState<'destination-first' | 'source-first'>('source-first')

  const { data: collections = [] } = useCollections()
  const { data: allFolders = [] } = useFolders()
  const { data: allTags = [] } = useTags()
  const { data: allSlices = [], isLoading: isSlicesLoading } = useAllSlices()

  const batchCreateFolders = useBatchCreateFolders()
  const batchApplyTagToSlices = useBatchApplyTagToSlices()
  const batchAddSlicesToFolder = useBatchAddSlicesToFolder()

  useEffect(() => {
    setIsEntering(true)
    const timer = setTimeout(() => setIsEntering(false), 10)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (activeCollectionId && !state.targetCollectionId) {
      dispatch({ type: 'SET_TARGET_COLLECTION', collectionId: activeCollectionId })
    }
  }, [activeCollectionId, state.targetCollectionId, dispatch])

  const finalizeClose = () => {
    setIsClosing(true)
    setTimeout(() => {
      onClose()
      setIsClosing(false)
    }, 250)
  }

  const destinationChangeSummary = useMemo(() => {
    return state.destinationFolders
      .map(folder => {
        const changeCount = getSelectionChangeCount(folder.sourceSelection)
        if (changeCount === 0) return null
        const typeLabel = folder.destinationType === 'tag' ? 'instrument' : 'folder'
        return {
          id: folder.tempId,
          label: `${typeLabel} "${folder.name || 'Untitled'}"`,
          changeCount,
        }
      })
      .filter(Boolean) as Array<{ id: string; label: string; changeCount: number }>
  }, [state.destinationFolders])

  const stagedChangeCount = getSelectionChangeCount(state.stagedSelection)
  const hasUnsavedChanges = stagedChangeCount > 0 || destinationChangeSummary.length > 0

  const requestClose = () => {
    if (hasUnsavedChanges) {
      setShowDiscardWarning(true)
      return
    }
    finalizeClose()
  }

  const hasNamedDestinations = state.destinationFolders.every(f => f.name.trim().length > 0)
  const hasAnySelection = state.destinationFolders.some(f => (
    f.sourceSelection.selectedFolderIds.size > 0 ||
    f.sourceSelection.selectedTagIds.size > 0 ||
    f.sourceSelection.individuallySelectedIds.size > 0
  ))
  const hasNewFolderDestinations = state.destinationFolders.some(f => f.destinationType === 'folder')
  const canReview = (!hasNewFolderDestinations || !!state.targetCollectionId) && hasNamedDestinations && hasAnySelection

  const handleConfirm = () => {
    if (isSlicesLoading) return

    const actionableDestinations = state.destinationFolders.filter(hasSelectionChanges)
    const newFolderDestinations = actionableDestinations.filter(f => f.destinationType === 'folder')
    const existingFolderDestinations = actionableDestinations.filter(f => f.destinationType === 'existing-folder')
    const tagDestinations = actionableDestinations.filter(f => f.destinationType === 'tag')

    if (newFolderDestinations.length > 0 && !state.targetCollectionId) return

    const orderedFolders = orderFoldersForCreate(newFolderDestinations)
    const foldersPayload = orderedFolders
      .map(folder => {
        const sliceIds = computeSliceIdsForFolder(folder, allSlices)
        if (sliceIds.length === 0) return null
        return {
          tempId: folder.tempId,
          name: folder.name.trim(),
          color: folder.color,
          parentTempId: folder.parentTempId ?? undefined,
          parentId: folder.parentFolderId ?? undefined,
          sliceIds,
        }
      })
      .filter(Boolean) as Array<{
      tempId: string
      name: string
      color: string
      parentTempId?: string
      parentId?: number
      sliceIds: number[]
    }>

    const applyTags = async () => {
      if (tagDestinations.length === 0) return
      for (const tagDest of tagDestinations) {
        const sliceIds = computeSliceIdsForFolder(tagDest, allSlices)
        if (sliceIds.length === 0) continue
        await batchApplyTagToSlices.mutateAsync({
          tagId: tagDest.destinationTagId ?? undefined,
          name: tagDest.destinationTagId ? undefined : tagDest.name.trim(),
          color: tagDest.color,
          sliceIds,
        })
      }
    }

    const applyToExistingFolders = async () => {
      if (existingFolderDestinations.length === 0) return
      for (const dest of existingFolderDestinations) {
        if (!dest.destinationFolderId) continue
        const sliceIds = computeSliceIdsForFolder(dest, allSlices)
        if (sliceIds.length === 0) continue
        await batchAddSlicesToFolder.mutateAsync({
          folderId: dest.destinationFolderId,
          sliceIds,
        })
      }
    }

    if (foldersPayload.length > 0) {
      batchCreateFolders.mutate(
        { collectionId: state.targetCollectionId!, folders: foldersPayload },
        { onSuccess: () => applyToExistingFolders().then(() => applyTags().then(finalizeClose)) }
      )
    } else {
      applyToExistingFolders().then(() => applyTags().then(finalizeClose))
    }
  }

  return (
    <>
      <div
        className={`fixed inset-0 bg-surface-base/50 z-40 transition-opacity duration-300 ${
          isClosing || isEntering ? 'opacity-0' : 'opacity-100'
        }`}
        onClick={requestClose}
      />

      <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
        <div
          className={`bg-surface-raised rounded-xl overflow-hidden flex flex-col w-[92vw] h-[92vh] max-w-7xl pointer-events-auto shadow-2xl border border-surface-border transition-all duration-300 ease-out ${
            isClosing || isEntering ? 'opacity-0 scale-95' : 'opacity-100 scale-100'
          }`}
          data-tour="advanced-category-modal"
        >
          <div className="flex items-center gap-3 px-4 py-4 border-b border-surface-border flex-shrink-0 bg-surface-raised">
            <div className="flex items-center gap-3 flex-1">
              <h2 className="text-lg font-semibold text-white" data-tour="advanced-category-title">Advanced Order</h2>
              <span className="text-xs text-slate-500">Select samples from your sources and organize them into folders or instruments</span>
            </div>
            <button
              onClick={requestClose}
              className="p-2 text-slate-400 hover:text-white rounded-lg transition-colors hover:bg-surface-base"
              data-tour="advanced-category-close"
            >
              <X size={18} />
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-hidden">
            {state.step === 'confirm' ? (
              <CustomOrderConfirmDialog
                state={state}
                collections={collections as Collection[]}
                folders={allFolders as Folder[]}
                tags={allTags as Tag[]}
                slices={allSlices as SliceWithTrack[]}
                isSubmitting={batchCreateFolders.isPending}
                onBack={() => dispatch({ type: 'GO_BACK_TO_EDIT' })}
                onConfirm={handleConfirm}
              />
            ) : (
              <div className="grid grid-cols-2 h-full min-h-0">
                {layoutMode === 'destination-first' ? (
                  <>
                    <div className="border-r border-surface-border h-full">
                      <CustomOrderDestinationPane
                        key="dest-left"
                        state={state}
                        dispatch={dispatch}
                        collections={collections as Collection[]}
                        side="left"
                      />
                    </div>
                    <div className="flex flex-col h-full min-h-0">
                      <div className="flex-1 overflow-hidden min-h-0">
                        <CustomOrderSourcePane
                          state={state}
                          dispatch={dispatch}
                          onClearSelection={() => dispatch({ type: 'CLEAR_ACTIVE_SELECTION' })}
                        />
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="border-r border-surface-border h-full min-h-0">
                      <CustomOrderSourcePane
                        state={state}
                        dispatch={dispatch}
                        onClearSelection={() => dispatch({ type: 'CLEAR_ACTIVE_SELECTION' })}
                        allowViewWithoutDestination
                      />
                    </div>
                    <div className="flex flex-col h-full min-h-0">
                      <div className="flex-1 overflow-hidden min-h-0">
                        <CustomOrderDestinationPane
                          key="dest-right"
                          state={state}
                          dispatch={dispatch}
                          collections={collections as Collection[]}
                          side="right"
                        />
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {state.step === 'edit' && (
            <div className="px-6 py-4 border-t border-surface-border flex items-center justify-between">
              <div className="text-xs text-slate-500">
                {isSlicesLoading ? 'Loading samples...' : ''}
              </div>
              <button
                className="px-4 py-2 text-sm rounded-lg bg-accent-primary text-white hover:bg-accent-primary/80 disabled:opacity-50"
                onClick={() => dispatch({ type: 'GO_TO_CONFIRM' })}
                disabled={!canReview || isSlicesLoading}
                data-tour="custom-order-review-confirm"
              >
                Review &amp; Confirm
              </button>
            </div>
          )}
        </div>
      </div>

      {showDiscardWarning && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-surface-base/65">
          <div className="w-full max-w-lg rounded-xl border border-surface-border bg-surface-raised p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold text-white">Discard unconfirmed changes?</h3>
              <button
                className="p-1 text-slate-400 hover:text-white"
                onClick={() => setShowDiscardWarning(false)}
              >
                <X size={16} />
              </button>
            </div>
            <p className="text-sm text-slate-300 mb-2">Do you want to discard these changes?</p>
            <ul className="text-xs text-slate-400 space-y-1 max-h-56 overflow-y-auto mb-4">
              {stagedChangeCount > 0 && (
                <li>• staged selection (not assigned): {stagedChangeCount} {stagedChangeCount === 1 ? 'change' : 'changes'}</li>
              )}
              {destinationChangeSummary.map(item => (
                <li key={item.id}>• {item.label}: {item.changeCount} {item.changeCount === 1 ? 'change' : 'changes'}</li>
              ))}
            </ul>
            <div className="flex items-center justify-end gap-2">
              <button
                className="px-3 py-1.5 text-sm text-slate-300 hover:text-white"
                onClick={() => setShowDiscardWarning(false)}
              >
                Go back
              </button>
              <button
                className="px-3 py-1.5 text-sm rounded-lg bg-red-600 text-white hover:bg-red-500"
                onClick={finalizeClose}
              >
                Discard changes
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
