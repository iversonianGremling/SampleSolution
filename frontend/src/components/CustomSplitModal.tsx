import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { useCustomSplitState } from '../hooks/useCustomSplitState'
import { useAllSlices, useFolders, useCollections, useTags, useBatchCreateFolders } from '../hooks/useTracks'
import type { Folder, Collection, SliceWithTrack, Tag } from '../types'
import { CustomSplitSourcePane } from './CustomSplitSourcePane'
import { CustomSplitBuilderPane } from './CustomSplitBuilderPane'
import { CustomSplitSampleSelectPanel, SplitSampleContext } from './CustomSplitFilterPane'

interface Props {
  onClose: () => void
}

function computeSliceIdsForCategory(
  selection: {
    selectedCollectionIds: Set<number>
    selectedFolderIds: Set<number>
    selectedTagIds: Set<number>
    individuallySelectedIds: Set<number>
    excludedSampleIds: Set<number>
  },
  allSlices: SliceWithTrack[],
  folderCollectionMap: Map<number, number>
) {
  const selected = new Set<number>()

  if (
    selection.selectedFolderIds.size > 0 ||
    selection.selectedTagIds.size > 0 ||
    selection.selectedCollectionIds.size > 0
  ) {
    for (const slice of allSlices) {
      const inFolder = slice.folderIds?.some(id => selection.selectedFolderIds.has(id))
      const inTag = slice.tags?.some(tag => selection.selectedTagIds.has(tag.id))
      const inCollection = slice.folderIds?.some(id => {
        const collectionId = folderCollectionMap.get(id)
        return collectionId ? selection.selectedCollectionIds.has(collectionId) : false
      })
      if (inFolder || inTag || inCollection) {
        selected.add(slice.id)
      }
    }
  }

  for (const id of selection.individuallySelectedIds) {
    selected.add(id)
  }

  for (const id of selection.excludedSampleIds) {
    selected.delete(id)
  }

  return Array.from(selected)
}

export function CustomSplitModal({ onClose }: Props) {
  const [state, dispatch] = useCustomSplitState()
  const [isClosing, setIsClosing] = useState(false)
  const [isEntering, setIsEntering] = useState(true)
  const [sampleContext, setSampleContext] = useState<SplitSampleContext | null>(null)
  const [isSampleSelectOpen, setIsSampleSelectOpen] = useState(false)
  const [isSampleSelectClosing, setIsSampleSelectClosing] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const { data: collections = [] } = useCollections()
  const { data: allFolders = [] } = useFolders()
  const { data: allTags = [] } = useTags()
  const { data: allSlices = [], isLoading: isSlicesLoading } = useAllSlices()

  const batchCreateFolders = useBatchCreateFolders()

  useEffect(() => {
    setIsEntering(true)
    const timer = setTimeout(() => setIsEntering(false), 10)
    return () => clearTimeout(timer)
  }, [])

  const handleClose = () => {
    setIsClosing(true)
    setTimeout(() => {
      onClose()
      setIsClosing(false)
    }, 250)
  }

  const folderCollectionMap = useMemo(() => {
    const map = new Map<number, number>()
    for (const folder of allFolders as Folder[]) {
      if (folder.collectionId) map.set(folder.id, folder.collectionId)
    }
    return map
  }, [allFolders])

  const foldersByCollection = useMemo(() => {
    const map = new Map<number, Folder[]>()
    for (const folder of allFolders as Folder[]) {
      if (!folder.collectionId) continue
      if (!map.has(folder.collectionId)) map.set(folder.collectionId, [])
      map.get(folder.collectionId)!.push(folder)
    }
    return map
  }, [allFolders])

  const activeCategory = state.categories.find(cat => cat.tempId === state.activeCategoryId) || null

  const validCategories = state.categories.filter(cat => {
    const hasName = cat.name.trim().length > 0
    const hasDestination = cat.destinationType === 'tag' ? true : !!cat.destinationCollectionId
    const hasSelection =
      cat.sourceSelection.selectedFolderIds.size > 0 ||
      cat.sourceSelection.selectedTagIds.size > 0 ||
      cat.sourceSelection.selectedCollectionIds.size > 0 ||
      cat.sourceSelection.individuallySelectedIds.size > 0
    const isParentOnly = cat.isVirtualParent && cat.destinationType === 'folder'
    return hasName && hasDestination && (hasSelection || isParentOnly)
  })

  const canCreate = validCategories.length > 0 && !isSlicesLoading && !isSubmitting

  const handleCreate = async () => {
    if (validCategories.length === 0 || isSlicesLoading) return
    setIsSubmitting(true)
    try {
      const grouped = new Map<number, typeof validCategories>()
      const tagCategories = validCategories.filter(cat => cat.destinationType === 'tag')
      const folderCategories = validCategories.filter(cat => cat.destinationType === 'folder')

      for (const category of folderCategories) {
        const collectionId = category.destinationCollectionId!
        if (!grouped.has(collectionId)) grouped.set(collectionId, [])
        grouped.get(collectionId)!.push(category)
      }

      for (const [collectionId, categories] of grouped.entries()) {
        const payload = categories.map(category => ({
          tempId: category.tempId,
          name: category.name.trim(),
          color: category.color,
          parentId: category.parentFolderId ?? undefined,
          parentTempId: category.parentTempId ?? undefined,
          sliceIds: computeSliceIdsForCategory(category.sourceSelection, allSlices as SliceWithTrack[], folderCollectionMap),
        }))
        await batchCreateFolders.mutateAsync({ collectionId, folders: payload })
      }

      // Tag categories are handled by the caller in CustomOrderModal for now.
      if (tagCategories.length > 0) {
        console.warn('Tag destinations are not yet wired in this modal.')
      }
      handleClose()
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      <div
        className={`fixed inset-0 bg-black/50 z-40 transition-opacity duration-300 ${
          isClosing || isEntering ? 'opacity-0' : 'opacity-100'
        }`}
        onClick={handleClose}
      />

      <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
        <div
          className={`bg-surface-raised rounded-xl overflow-hidden flex flex-col w-[94vw] h-[94vh] max-w-[1500px] pointer-events-auto shadow-2xl border border-surface-border transition-all duration-300 ease-out ${
            isClosing || isEntering ? 'opacity-0 scale-95' : 'opacity-100 scale-100'
          }`}
        >
          <div className="flex items-center gap-3 px-4 py-4 border-b border-surface-border flex-shrink-0 bg-surface-raised">
            <h2 className="flex-1 text-lg font-semibold text-white">Custom Split</h2>
            <button
              onClick={handleClose}
              className="p-2 text-slate-400 hover:text-white rounded-lg transition-colors hover:bg-surface-base"
            >
              <X size={18} />
            </button>
          </div>

          <div className="flex-1 overflow-hidden">
            <div className="grid grid-cols-2 h-full min-h-0">
              <div className="border-r border-surface-border h-full">
                <CustomSplitBuilderPane
                  state={state}
                  dispatch={dispatch}
                  collections={collections as Collection[]}
                  folders={allFolders as Folder[]}
                  foldersByCollection={foldersByCollection}
                  tags={allTags as Tag[]}
                />
              </div>
              <div className="h-full relative">
                <CustomSplitSourcePane
                  state={state}
                  dispatch={dispatch}
                  activeCategory={activeCategory}
                  onOpenSamples={(context) => {
                    setSampleContext(context)
                    setIsSampleSelectClosing(false)
                    setIsSampleSelectOpen(false)
                    setTimeout(() => setIsSampleSelectOpen(true), 10)
                  }}
                />
                <CustomSplitSampleSelectPanel
                  context={sampleContext}
                  activeCategory={activeCategory}
                  dispatch={dispatch}
                  allTags={allTags as Tag[]}
                  folderCollectionMap={folderCollectionMap}
                  isOpen={isSampleSelectOpen}
                  isClosing={isSampleSelectClosing}
                  onClose={() => {
                    setIsSampleSelectClosing(true)
                    setTimeout(() => {
                      setIsSampleSelectOpen(false)
                      setIsSampleSelectClosing(false)
                      setSampleContext(null)
                    }, 250)
                  }}
                />
              </div>
            </div>
          </div>

          <div className="px-6 py-4 border-t border-surface-border flex items-center justify-between">
            <div className="text-xs text-slate-500">
              {isSlicesLoading ? 'Loading samples...' : `${validCategories.length} ready to create`}
            </div>
            <button
              className="px-4 py-2 text-sm rounded-lg bg-accent-primary text-white hover:bg-accent-primary/80 disabled:opacity-50"
              onClick={handleCreate}
              disabled={!canCreate}
            >
              {isSubmitting ? 'Creating...' : 'Create Folders'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
