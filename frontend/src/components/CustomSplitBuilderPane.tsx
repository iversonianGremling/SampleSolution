import { useMemo } from 'react'
import { Plus, X } from 'lucide-react'
import type { Folder, Collection } from '../types'
import type { CustomSplitState, CustomSplitAction, SplitCategory } from '../hooks/useCustomSplitState'

interface FolderNode extends Folder {
  children: FolderNode[]
}

function buildTree(folders: Folder[], parentId: number | null = null): FolderNode[] {
  return folders
    .filter(c => c.parentId === parentId)
    .map(c => ({
      ...c,
      children: buildTree(folders, c.id),
    }))
}

function flattenTree(nodes: FolderNode[], depth = 0): Array<{ id: number; name: string; depth: number }> {
  const result: Array<{ id: number; name: string; depth: number }> = []
  for (const node of nodes) {
    result.push({ id: node.id, name: node.name, depth })
    if (node.children.length > 0) {
      result.push(...flattenTree(node.children, depth + 1))
    }
  }
  return result
}

interface Props {
  state: CustomSplitState
  dispatch: React.Dispatch<CustomSplitAction>
  collections: Collection[]
  folders: Folder[]
  foldersByCollection: Map<number, Folder[]>
  tags: Array<{ id: number; name: string }>
}

export function CustomSplitBuilderPane({ state, dispatch, collections, folders, foldersByCollection, tags }: Props) {
  const activeCategory = state.categories.find(cat => cat.tempId === state.activeCategoryId) || null
  const foldersMap = useMemo(() => {
    const map = new Map<number, Folder>()
    for (const c of folders) map.set(c.id, c)
    return map
  }, [folders])

  const handleAutoFlip = () => {
    if (!activeCategory) return
    const selectedIds = Array.from(activeCategory.sourceSelection.selectedFolderIds)
    if (selectedIds.length === 0) return

    const groups = new Map<string, { parentName: string; childIds: number[] }>()
    for (const id of selectedIds) {
      const child = foldersMap.get(id)
      if (!child || !child.parentId) continue
      const parent = foldersMap.get(child.parentId)
      if (!parent) continue
      const key = child.name
      if (!groups.has(key)) groups.set(key, { parentName: child.name, childIds: [] })
      groups.get(key)!.childIds.push(id)
    }

    const payload: Array<{
      tempId?: string
      name: string
      color?: string
      destinationType?: 'folder'
      destinationCollectionId?: number | null
      parentFolderId?: number | null
      parentTempId?: string | null
      isVirtualParent?: boolean
      selectedFolderIds?: number[]
    }> = []

    for (const [childName, data] of groups.entries()) {
      const parentTempId = `auto-parent-${childName}-${Date.now()}`
      const parentName = childName.endsWith('s') ? `${childName}es` : `${childName}s`

      payload.push({
        tempId: parentTempId,
        name: parentName,
        destinationType: 'folder',
        isVirtualParent: true,
        selectedFolderIds: [],
      })

      for (const childId of data.childIds) {
        const child = foldersMap.get(childId)
        if (!child || !child.parentId) continue
        const parent = foldersMap.get(child.parentId)
        if (!parent) continue
        payload.push({
          name: parent.name,
          destinationType: 'folder',
          parentTempId,
          selectedFolderIds: [childId],
        })
      }
    }

    if (payload.length > 0) {
      dispatch({ type: 'BULK_ADD_CATEGORIES', categories: payload })
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-surface-border flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-slate-200">Categories</h3>
          <p className="text-xs text-slate-500">Create named splits and choose destinations.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="flex items-center gap-2 px-3 py-1.5 text-xs bg-surface-base border border-surface-border rounded-lg text-slate-300 hover:text-white"
            onClick={() => dispatch({ type: 'ADD_CATEGORY' })}
          >
            <Plus size={14} />
            Add Category
          </button>
          <button
            className="px-3 py-1.5 text-xs bg-surface-base border border-surface-border rounded-lg text-slate-300 hover:text-white"
            onClick={handleAutoFlip}
            title="Create parent folder and swap parent/child names from selected folders"
          >
            Auto Flip
          </button>
        </div>
      </div>

      {state.categories.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-sm text-slate-500">
          Add a category to start building a custom split.
        </div>
      )}

      {state.categories.length > 0 && (
        <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
          {state.categories.map(category => (
            <CategoryCard
              key={category.tempId}
              category={category}
              isActive={category.tempId === state.activeCategoryId}
              collections={collections}
              foldersByCollection={foldersByCollection}
              tags={tags}
              onActivate={() => dispatch({ type: 'SET_ACTIVE_CATEGORY', tempId: category.tempId })}
              onMerge={(sourceId, targetId) => dispatch({ type: 'MERGE_CATEGORIES', sourceId, targetId })}
              onRename={(name) => dispatch({ type: 'RENAME_CATEGORY', tempId: category.tempId, name })}
              onColorChange={(color) => dispatch({ type: 'SET_CATEGORY_COLOR', tempId: category.tempId, color })}
              onRemove={() => dispatch({ type: 'REMOVE_CATEGORY', tempId: category.tempId })}
              onSetDestinationType={(type) => dispatch({ type: 'SET_DESTINATION_TYPE', tempId: category.tempId, destinationType: type })}
              onSetCollection={(id) => dispatch({ type: 'SET_DESTINATION_COLLECTION', tempId: category.tempId, collectionId: id })}
              onSetParent={(id) => dispatch({ type: 'SET_DESTINATION_PARENT', tempId: category.tempId, parentFolderId: id })}
              onSetTag={(id) => dispatch({ type: 'SET_DESTINATION_TAG', tempId: category.tempId, tagId: id })}
            />
          ))}
        </div>
      )}

      {activeCategory && (
        <div className="border-t border-surface-border px-4 py-2 text-xs text-slate-400">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1 bg-surface-base border border-surface-border rounded-full px-2 py-0.5">
              Collections {activeCategory.sourceSelection.selectedCollectionIds.size}
              <button onClick={() => dispatch({ type: 'CLEAR_SELECTED_COLLECTIONS' })} className="text-slate-500 hover:text-white"><X size={10} /></button>
            </div>
            <div className="flex items-center gap-1 bg-surface-base border border-surface-border rounded-full px-2 py-0.5">
              Folders {activeCategory.sourceSelection.selectedFolderIds.size}
              <button onClick={() => dispatch({ type: 'CLEAR_SELECTED_FOLDERS' })} className="text-slate-500 hover:text-white"><X size={10} /></button>
            </div>
            <div className="flex items-center gap-1 bg-surface-base border border-surface-border rounded-full px-2 py-0.5">
              Instruments {activeCategory.sourceSelection.selectedTagIds.size}
              <button onClick={() => dispatch({ type: 'CLEAR_SELECTED_TAGS' })} className="text-slate-500 hover:text-white"><X size={10} /></button>
            </div>
            <div className="flex items-center gap-1 bg-surface-base border border-surface-border rounded-full px-2 py-0.5">
              Samples {activeCategory.sourceSelection.individuallySelectedIds.size}
              <button onClick={() => dispatch({ type: 'CLEAR_SELECTED_SAMPLES' })} className="text-slate-500 hover:text-white"><X size={10} /></button>
            </div>
            <div className="flex items-center gap-1 bg-surface-base border border-surface-border rounded-full px-2 py-0.5 text-red-400">
              Excluded {activeCategory.sourceSelection.excludedSampleIds.size}
              <button onClick={() => dispatch({ type: 'CLEAR_EXCLUDED_SAMPLES' })} className="text-red-300 hover:text-red-200"><X size={10} /></button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function CategoryCard({
  category,
  isActive,
  collections,
  foldersByCollection,
  tags,
  onActivate,
  onMerge,
  onRename,
  onColorChange,
  onRemove,
  onSetDestinationType,
  onSetCollection,
  onSetParent,
  onSetTag,
}: {
  category: SplitCategory
  isActive: boolean
  collections: Collection[]
  foldersByCollection: Map<number, Folder[]>
  tags: Array<{ id: number; name: string }>
  onActivate: () => void
  onMerge: (sourceId: string, targetId: string) => void
  onRename: (name: string) => void
  onColorChange: (color: string) => void
  onRemove: () => void
  onSetDestinationType: (type: 'folder' | 'tag') => void
  onSetCollection: (id: number | null) => void
  onSetParent: (id: number | null) => void
  onSetTag: (id: number | null) => void
}) {
  const folders = useMemo(() => {
    if (!category.destinationCollectionId) return []
    const list = foldersByCollection.get(category.destinationCollectionId) || []
    const tree = buildTree(list)
    return flattenTree(tree)
  }, [category.destinationCollectionId, foldersByCollection])

  return (
    <div
      className={`border rounded-lg p-3 transition-colors ${
        isActive ? 'border-accent-primary/60 bg-accent-primary/5' : 'border-surface-border bg-surface-base'
      }`}
      onClick={onActivate}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', category.tempId)
        event.dataTransfer.effectAllowed = 'move'
      }}
      onDragOver={(event) => {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
      }}
      onDrop={(event) => {
        event.preventDefault()
        const sourceId = event.dataTransfer.getData('text/plain')
        if (sourceId && sourceId !== category.tempId) {
          onMerge(sourceId, category.tempId)
        }
      }}
    >
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={category.color}
          onChange={(e) => onColorChange(e.target.value)}
          className="w-6 h-6 border border-surface-border rounded"
        />
        <input
          type="text"
          value={category.name}
          onChange={(e) => onRename(e.target.value)}
          placeholder="Category name"
          className="flex-1 px-2 py-1.5 text-sm bg-surface-base border border-surface-border rounded text-white placeholder-slate-500 focus:outline-none focus:border-accent-primary"
        />
        {category.isVirtualParent && (
          <span className="text-[10px] uppercase tracking-wide text-emerald-400 border border-emerald-500/40 rounded px-1.5 py-0.5">
            Parent
          </span>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          className="p-1 text-slate-500 hover:text-white"
        >
          <X size={14} />
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500">Destination</label>
          <select
            value={category.destinationType}
            onChange={(e) => onSetDestinationType(e.target.value as 'folder' | 'tag')}
            className="text-sm bg-surface-base border border-surface-border rounded px-2 py-1.5 text-slate-200"
          >
            <option value="folder">Folder</option>
            <option value="tag">Instrument</option>
          </select>
        </div>

      {category.destinationType === 'folder' && (
          <>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500">Collection</label>
              <select
                value={category.destinationCollectionId ?? ''}
                onChange={(e) => onSetCollection(e.target.value ? Number(e.target.value) : null)}
                disabled={!!category.parentTempId}
                className="text-sm bg-surface-base border border-surface-border rounded px-2 py-1.5 text-slate-200"
              >
                <option value="">Select collection</option>
                {collections.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500">Parent folder</label>
              <select
                value={category.parentFolderId ?? ''}
                onChange={(e) => onSetParent(e.target.value ? Number(e.target.value) : null)}
                disabled={!category.destinationCollectionId || !!category.parentTempId}
                className="text-sm bg-surface-base border border-surface-border rounded px-2 py-1.5 text-slate-200 disabled:opacity-50"
              >
                <option value="">Root</option>
                {folders.map(c => (
                  <option key={c.id} value={c.id}>{`${'—'.repeat(c.depth)} ${c.name}`}</option>
                ))}
              </select>
              {category.parentTempId && (
                <span className="text-[11px] text-slate-500">Using auto parent folder</span>
              )}
            </div>
          </>
        )}

        {category.destinationType === 'tag' && (
          <div className="flex flex-col gap-1 col-span-1">
            <label className="text-xs text-slate-500">Instrument target</label>
            <select
              value={category.destinationTagId ?? ''}
              onChange={(e) => onSetTag(e.target.value ? Number(e.target.value) : null)}
              className="text-sm bg-surface-base border border-surface-border rounded px-2 py-1.5 text-slate-200"
            >
              <option value="">Use category name (create if needed)</option>
              {tags.map(tag => (
                <option key={tag.id} value={tag.id}>{tag.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>
    </div>
  )
}
