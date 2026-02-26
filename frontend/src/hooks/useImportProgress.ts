import { useSyncExternalStore } from 'react'
import {
  getImportProgressSnapshot,
  subscribeImportProgress,
} from '../services/importProgress'

export function useImportProgress() {
  return useSyncExternalStore(
    subscribeImportProgress,
    getImportProgressSnapshot,
    getImportProgressSnapshot,
  )
}
