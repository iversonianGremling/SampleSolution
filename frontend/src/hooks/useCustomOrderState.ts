import { useReducer } from 'react'

export interface SourceSelection {
  selectedFolderIds: Set<number>
  selectedTagIds: Set<number>
  excludedFolderIds: Set<number>
  excludedTagIds: Set<number>
  individuallySelectedIds: Set<number>
  excludedSampleIds: Set<number>
}

export interface DestinationFolder {
  tempId: string
  name: string
  color: string
  destinationType: 'folder' | 'tag' | 'existing-folder'
  destinationTagId: number | null
  destinationFolderId: number | null
  parentTempId: string | null
  parentFolderId: number | null
  sourceSelection: SourceSelection
}

export interface CustomOrderState {
  step: 'edit' | 'confirm'
  targetCollectionId: number | null
  destinationFolders: DestinationFolder[]
  activeFolderId: string | null
  stagedSelection: SourceSelection
  sourceSearchQuery: string
  folderSearchQuery: string
  destinationSearchQuery: string
  expandedSourceCollections: Set<number>
  expandedSourceFolders: Set<number>
  individualModeFolders: Set<number>
}

function createEmptySourceSelection(): SourceSelection {
  return {
    selectedFolderIds: new Set(),
    selectedTagIds: new Set(),
    excludedFolderIds: new Set(),
    excludedTagIds: new Set(),
    individuallySelectedIds: new Set(),
    excludedSampleIds: new Set(),
  }
}

let tempIdCounter = 0
function generateTempId(): string {
  return `temp-${++tempIdCounter}-${Date.now()}`
}

export type CustomOrderAction =
  | { type: 'SET_TARGET_COLLECTION'; collectionId: number }
  | { type: 'ADD_DESTINATION_FOLDER'; parentTempId?: string | null; parentFolderId?: number | null }
  | { type: 'ADD_DESTINATION_TAG' }
  | { type: 'ADD_DESTINATION_TAG_FROM_EXISTING'; tagId: number; name: string; color: string }
  | { type: 'ADD_DESTINATION_FROM_EXISTING_FOLDER'; folderId: number; name: string; color: string; collectionId: number }
  | {
      type: 'BULK_ADD_DESTINATION_FOLDERS'
      folders: Array<{
        name: string
        color?: string
        parentTempId?: string | null
        parentFolderId?: number | null
        destinationType?: 'folder' | 'tag'
        destinationTagId?: number | null
        destinationFolderId?: number | null
        selectedFolderIds?: number[]
        selectedTagIds?: number[]
        selectedSampleIds?: number[]
      }>
    }
  | { type: 'REMOVE_DESTINATION_FOLDER'; tempId: string }
  | { type: 'RENAME_DESTINATION_FOLDER'; tempId: string; name: string }
  | { type: 'SET_FOLDER_COLOR'; tempId: string; color: string }
  | { type: 'SET_DESTINATION_TYPE'; tempId: string; destinationType: 'folder' | 'tag' | 'existing-folder' }
  | { type: 'SET_DESTINATION_TAG'; tempId: string; tagId: number | null }
  | { type: 'SET_DESTINATION_PARENT'; tempId: string; parentTempId?: string | null; parentFolderId?: number | null }
  | { type: 'SET_ACTIVE_FOLDER'; tempId: string }
  | { type: 'COMMIT_STAGED_TO_ACTIVE' }
  | { type: 'TOGGLE_SOURCE_FOLDER'; folderId: number }
  | { type: 'SELECT_ALL_IN_FOLDER'; folderId: number }
  | { type: 'DESELECT_ALL_IN_FOLDER'; folderId: number }
  | { type: 'TOGGLE_SOURCE_TAG'; tagId: number }
  | { type: 'TOGGLE_EXCLUDED_SOURCE_FOLDER'; folderId: number }
  | { type: 'TOGGLE_EXCLUDED_SOURCE_TAG'; tagId: number }
  | { type: 'TOGGLE_INDIVIDUAL_SAMPLE'; sampleId: number }
  | { type: 'EXCLUDE_SAMPLE'; sampleId: number }
  | { type: 'INCLUDE_SAMPLE'; sampleId: number }
  | { type: 'TOGGLE_INDIVIDUAL_MODE'; folderId: number }
  | { type: 'SET_SOURCE_SEARCH'; query: string }
  | { type: 'SET_FOLDER_SEARCH'; query: string }
  | { type: 'SET_DESTINATION_SEARCH'; query: string }
  | { type: 'TOGGLE_EXPAND_FOLDER'; folderId: number }
  | { type: 'TOGGLE_EXPAND_COLLECTION'; collectionId: number }
  | { type: 'GO_TO_CONFIRM' }
  | { type: 'GO_BACK_TO_EDIT' }
  | { type: 'CLEAR_ACTIVE_SELECTION' }
  | { type: 'CLEAR_SELECTED_FOLDERS' }
  | { type: 'CLEAR_SELECTED_TAGS' }
  | { type: 'CLEAR_EXCLUDED_FOLDERS' }
  | { type: 'CLEAR_EXCLUDED_TAGS' }
  | { type: 'CLEAR_SELECTED_SAMPLES' }
  | { type: 'CLEAR_EXCLUDED_SAMPLES' }
  | { type: 'RESET' }

function updateStagedSelection(
  state: CustomOrderState,
  updater: (sel: SourceSelection) => SourceSelection
): CustomOrderState {
  return { ...state, stagedSelection: updater(state.stagedSelection) }
}

function toggleInSet<T>(set: Set<T>, item: T): Set<T> {
  const next = new Set(set)
  if (next.has(item)) next.delete(item)
  else next.add(item)
  return next
}

function reducer(state: CustomOrderState, action: CustomOrderAction): CustomOrderState {
  switch (action.type) {
    case 'SET_TARGET_COLLECTION':
      return { ...state, targetCollectionId: action.collectionId }

    case 'ADD_DESTINATION_FOLDER': {
      const tempId = generateTempId()
      const newFolder: DestinationFolder = {
        tempId,
        name: '',
        color: '#6366f1',
        destinationType: 'folder',
        destinationTagId: null,
        destinationFolderId: null,
        parentTempId: action.parentTempId || null,
        parentFolderId: action.parentFolderId ?? null,
        sourceSelection: createEmptySourceSelection(),
      }
      return {
        ...state,
        destinationFolders: [...state.destinationFolders, newFolder],
        activeFolderId: tempId,
      }
    }

    case 'ADD_DESTINATION_TAG': {
      const tempId = generateTempId()
      const newFolder: DestinationFolder = {
        tempId,
        name: '',
        color: '#6366f1',
        destinationType: 'tag',
        destinationTagId: null,
        destinationFolderId: null,
        parentTempId: null,
        parentFolderId: null,
        sourceSelection: createEmptySourceSelection(),
      }
      return {
        ...state,
        destinationFolders: [...state.destinationFolders, newFolder],
        activeFolderId: tempId,
      }
    }

    case 'ADD_DESTINATION_TAG_FROM_EXISTING': {
      const tempId = generateTempId()
      const newFolder: DestinationFolder = {
        tempId,
        name: action.name,
        color: action.color,
        destinationType: 'tag',
        destinationTagId: action.tagId,
        destinationFolderId: null,
        parentTempId: null,
        parentFolderId: null,
        sourceSelection: createEmptySourceSelection(),
      }
      return {
        ...state,
        destinationFolders: [...state.destinationFolders, newFolder],
        activeFolderId: tempId,
      }
    }

    case 'ADD_DESTINATION_FROM_EXISTING_FOLDER': {
      const existing = state.destinationFolders.find(
        f => f.destinationType === 'existing-folder' && f.destinationFolderId === action.folderId
      )
      if (existing) {
        const remaining = state.destinationFolders.filter(f => f.tempId !== existing.tempId)
        return {
          ...state,
          destinationFolders: remaining,
          activeFolderId: state.activeFolderId === existing.tempId ? null : state.activeFolderId,
        }
      }
      const tempId = generateTempId()
      const newFolder: DestinationFolder = {
        tempId,
        name: action.name,
        color: action.color,
        destinationType: 'existing-folder',
        destinationTagId: null,
        destinationFolderId: action.folderId,
        parentTempId: null,
        parentFolderId: null,
        sourceSelection: createEmptySourceSelection(),
      }
      return {
        ...state,
        destinationFolders: [...state.destinationFolders, newFolder],
        activeFolderId: tempId,
      }
    }

    case 'BULK_ADD_DESTINATION_FOLDERS': {
      const newFolders: DestinationFolder[] = action.folders.map(folder => ({
        tempId: generateTempId(),
        name: folder.name,
        color: folder.color || '#6366f1',
        destinationType: folder.destinationType || 'folder',
        destinationTagId: folder.destinationTagId ?? null,
        destinationFolderId: folder.destinationFolderId ?? null,
        parentTempId: folder.parentTempId ?? null,
        parentFolderId: folder.parentFolderId ?? null,
        sourceSelection: {
          selectedFolderIds: new Set(folder.selectedFolderIds || []),
          selectedTagIds: new Set(folder.selectedTagIds || []),
          excludedFolderIds: new Set(),
          excludedTagIds: new Set(),
          individuallySelectedIds: new Set(folder.selectedSampleIds || []),
          excludedSampleIds: new Set(),
        },
      }))

      const lastId = newFolders.length > 0 ? newFolders[newFolders.length - 1].tempId : state.activeFolderId

      return {
        ...state,
        destinationFolders: [...state.destinationFolders, ...newFolders],
        activeFolderId: lastId ?? state.activeFolderId,
      }
    }

    case 'REMOVE_DESTINATION_FOLDER': {
      // Also remove children
      const idsToRemove = new Set<string>()
      const collectChildren = (id: string) => {
        idsToRemove.add(id)
        state.destinationFolders
          .filter(f => f.parentTempId === id)
          .forEach(f => collectChildren(f.tempId))
      }
      collectChildren(action.tempId)

      const remaining = state.destinationFolders.filter(f => !idsToRemove.has(f.tempId))
      return {
        ...state,
        destinationFolders: remaining,
        activeFolderId: state.activeFolderId && idsToRemove.has(state.activeFolderId)
          ? (remaining.length > 0 ? remaining[remaining.length - 1].tempId : null)
          : state.activeFolderId,
      }
    }

    case 'RENAME_DESTINATION_FOLDER':
      return {
        ...state,
        destinationFolders: state.destinationFolders.map(f =>
          f.tempId === action.tempId ? { ...f, name: action.name } : f
        ),
      }

    case 'SET_FOLDER_COLOR':
      return {
        ...state,
        destinationFolders: state.destinationFolders.map(f =>
          f.tempId === action.tempId ? { ...f, color: action.color } : f
        ),
      }

    case 'SET_DESTINATION_TYPE':
      return {
        ...state,
        destinationFolders: state.destinationFolders.map(f =>
          f.tempId === action.tempId
            ? {
                ...f,
                destinationType: action.destinationType,
                destinationTagId: action.destinationType === 'tag' ? f.destinationTagId : null,
                destinationFolderId: action.destinationType === 'existing-folder' ? f.destinationFolderId : null,
                parentTempId: action.destinationType === 'folder' ? f.parentTempId : null,
                parentFolderId: action.destinationType === 'folder' ? f.parentFolderId : null,
              }
            : f
        ),
      }

    case 'SET_DESTINATION_TAG':
      return {
        ...state,
        destinationFolders: state.destinationFolders.map(f =>
          f.tempId === action.tempId ? { ...f, destinationTagId: action.tagId } : f
        ),
      }

    case 'SET_DESTINATION_PARENT':
      return {
        ...state,
        destinationFolders: state.destinationFolders.map(f =>
          f.tempId === action.tempId
            ? {
                ...f,
                parentTempId: action.parentTempId ?? null,
                parentFolderId: action.parentFolderId ?? null,
              }
            : f
        ),
      }

    case 'SET_ACTIVE_FOLDER':
      return { ...state, activeFolderId: action.tempId }

    case 'COMMIT_STAGED_TO_ACTIVE': {
      if (!state.activeFolderId) return state
      const staged = state.stagedSelection
      const hasStaged =
        staged.selectedFolderIds.size > 0 ||
        staged.selectedTagIds.size > 0 ||
        staged.excludedFolderIds.size > 0 ||
        staged.excludedTagIds.size > 0 ||
        staged.individuallySelectedIds.size > 0 ||
        staged.excludedSampleIds.size > 0
      if (!hasStaged) return state

      return {
        ...state,
        stagedSelection: createEmptySourceSelection(),
        destinationFolders: state.destinationFolders.map(folder => {
          if (folder.tempId !== state.activeFolderId) return folder
          return {
            ...folder,
            sourceSelection: {
              selectedFolderIds: new Set([
                ...folder.sourceSelection.selectedFolderIds,
                ...staged.selectedFolderIds,
              ]),
              selectedTagIds: new Set([
                ...folder.sourceSelection.selectedTagIds,
                ...staged.selectedTagIds,
              ]),
              excludedFolderIds: new Set([
                ...folder.sourceSelection.excludedFolderIds,
                ...staged.excludedFolderIds,
              ]),
              excludedTagIds: new Set([
                ...folder.sourceSelection.excludedTagIds,
                ...staged.excludedTagIds,
              ]),
              individuallySelectedIds: new Set([
                ...folder.sourceSelection.individuallySelectedIds,
                ...staged.individuallySelectedIds,
              ]),
              excludedSampleIds: new Set([
                ...folder.sourceSelection.excludedSampleIds,
                ...staged.excludedSampleIds,
              ]),
            },
          }
        }),
      }
    }

    case 'TOGGLE_SOURCE_FOLDER':
      return updateStagedSelection(state, sel => {
        const selectedFolderIds = toggleInSet(sel.selectedFolderIds, action.folderId)
        const excludedFolderIds = new Set(sel.excludedFolderIds)
        if (selectedFolderIds.has(action.folderId)) {
          excludedFolderIds.delete(action.folderId)
        }
        return {
          ...sel,
          selectedFolderIds,
          excludedFolderIds,
        }
      })

    case 'SELECT_ALL_IN_FOLDER':
      return updateStagedSelection(state, sel => {
        const excludedFolderIds = new Set(sel.excludedFolderIds)
        excludedFolderIds.delete(action.folderId)
        return {
          ...sel,
          selectedFolderIds: new Set([...sel.selectedFolderIds, action.folderId]),
          excludedFolderIds,
        }
      })

    case 'DESELECT_ALL_IN_FOLDER':
      return updateStagedSelection(state, sel => {
        const next = new Set(sel.selectedFolderIds)
        next.delete(action.folderId)
        return { ...sel, selectedFolderIds: next }
      })

    case 'TOGGLE_SOURCE_TAG':
      return updateStagedSelection(state, sel => {
        const selectedTagIds = toggleInSet(sel.selectedTagIds, action.tagId)
        const excludedTagIds = new Set(sel.excludedTagIds)
        if (selectedTagIds.has(action.tagId)) {
          excludedTagIds.delete(action.tagId)
        }
        return {
          ...sel,
          selectedTagIds,
          excludedTagIds,
        }
      })

    case 'TOGGLE_EXCLUDED_SOURCE_FOLDER':
      return updateStagedSelection(state, sel => {
        const excludedFolderIds = toggleInSet(sel.excludedFolderIds, action.folderId)
        const selectedFolderIds = new Set(sel.selectedFolderIds)
        if (excludedFolderIds.has(action.folderId)) {
          selectedFolderIds.delete(action.folderId)
        }
        return {
          ...sel,
          selectedFolderIds,
          excludedFolderIds,
        }
      })

    case 'TOGGLE_EXCLUDED_SOURCE_TAG':
      return updateStagedSelection(state, sel => {
        const excludedTagIds = toggleInSet(sel.excludedTagIds, action.tagId)
        const selectedTagIds = new Set(sel.selectedTagIds)
        if (excludedTagIds.has(action.tagId)) {
          selectedTagIds.delete(action.tagId)
        }
        return {
          ...sel,
          selectedTagIds,
          excludedTagIds,
        }
      })

    case 'TOGGLE_INDIVIDUAL_SAMPLE':
      return updateStagedSelection(state, sel => ({
        ...sel,
        individuallySelectedIds: toggleInSet(sel.individuallySelectedIds, action.sampleId),
      }))

    case 'EXCLUDE_SAMPLE':
      return updateStagedSelection(state, sel => ({
        ...sel,
        excludedSampleIds: new Set([...sel.excludedSampleIds, action.sampleId]),
      }))

    case 'INCLUDE_SAMPLE':
      return updateStagedSelection(state, sel => {
        const next = new Set(sel.excludedSampleIds)
        next.delete(action.sampleId)
        return { ...sel, excludedSampleIds: next }
      })

    case 'TOGGLE_INDIVIDUAL_MODE':
      return {
        ...state,
        individualModeFolders: toggleInSet(state.individualModeFolders, action.folderId),
      }

    case 'SET_SOURCE_SEARCH':
      return { ...state, sourceSearchQuery: action.query }

    case 'SET_FOLDER_SEARCH':
      return { ...state, folderSearchQuery: action.query }

    case 'SET_DESTINATION_SEARCH':
      return { ...state, destinationSearchQuery: action.query }

    case 'TOGGLE_EXPAND_FOLDER':
      return {
        ...state,
        expandedSourceFolders: toggleInSet(state.expandedSourceFolders, action.folderId),
      }

    case 'TOGGLE_EXPAND_COLLECTION':
      return {
        ...state,
        expandedSourceCollections: toggleInSet(state.expandedSourceCollections, action.collectionId),
      }

    case 'GO_TO_CONFIRM':
      return { ...state, step: 'confirm' }

    case 'GO_BACK_TO_EDIT':
      return { ...state, step: 'edit' }

    case 'CLEAR_ACTIVE_SELECTION':
      return updateStagedSelection(state, () => createEmptySourceSelection())

    case 'CLEAR_SELECTED_FOLDERS':
      return updateStagedSelection(state, (sel: SourceSelection) => ({ ...sel, selectedFolderIds: new Set() }))

    case 'CLEAR_SELECTED_TAGS':
      return updateStagedSelection(state, (sel: SourceSelection) => ({ ...sel, selectedTagIds: new Set() }))

    case 'CLEAR_EXCLUDED_FOLDERS':
      return updateStagedSelection(state, (sel: SourceSelection) => ({ ...sel, excludedFolderIds: new Set() }))

    case 'CLEAR_EXCLUDED_TAGS':
      return updateStagedSelection(state, (sel: SourceSelection) => ({ ...sel, excludedTagIds: new Set() }))

    case 'CLEAR_SELECTED_SAMPLES':
      return updateStagedSelection(state, (sel: SourceSelection) => ({ ...sel, individuallySelectedIds: new Set() }))

    case 'CLEAR_EXCLUDED_SAMPLES':
      return updateStagedSelection(state, (sel: SourceSelection) => ({ ...sel, excludedSampleIds: new Set() }))

    case 'RESET':
      return createInitialState(null)

    default:
      return state
  }
}

function createInitialState(collectionId: number | null): CustomOrderState {
  return {
    step: 'edit',
    targetCollectionId: collectionId,
    destinationFolders: [],
    activeFolderId: null,
    stagedSelection: createEmptySourceSelection(),
    sourceSearchQuery: '',
    folderSearchQuery: '',
    destinationSearchQuery: '',
    expandedSourceCollections: new Set(),
    expandedSourceFolders: new Set(),
    individualModeFolders: new Set(),
  }
}

export function hasSelectionContent(sel: SourceSelection): boolean {
  return (
    sel.selectedFolderIds.size > 0 ||
    sel.selectedTagIds.size > 0 ||
    sel.excludedFolderIds.size > 0 ||
    sel.excludedTagIds.size > 0 ||
    sel.individuallySelectedIds.size > 0 ||
    sel.excludedSampleIds.size > 0
  )
}

export function getSourceCount(sel: SourceSelection): number {
  return (
    sel.selectedFolderIds.size +
    sel.selectedTagIds.size +
    sel.excludedFolderIds.size +
    sel.excludedTagIds.size +
    sel.individuallySelectedIds.size
  )
}

export function getSelectionChangeCount(sel: SourceSelection): number {
  return (
    sel.selectedFolderIds.size +
    sel.selectedTagIds.size +
    sel.excludedFolderIds.size +
    sel.excludedTagIds.size +
    sel.individuallySelectedIds.size +
    sel.excludedSampleIds.size
  )
}

export function useCustomOrderState(initialCollectionId: number | null) {
  return useReducer(reducer, initialCollectionId, createInitialState)
}
