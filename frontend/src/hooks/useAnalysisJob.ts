import axios from 'axios'
import { useCallback } from 'react'
import { QueryClient, useQueryClient } from '@tanstack/react-query'
import {
  cancelBatchReanalyze,
  startBatchReanalyzeSamples,
  type BatchReanalyzeStatusResponse,
} from '../api/client'
import { getStoredAnalysisConcurrency } from '../utils/analysisPreferences'

interface StartAnalysisJobInput {
  sliceIds?: number[]
  concurrency?: number
  includeFilenameTags?: boolean
  allowAiTagging?: boolean
  jobLabel?: string
}

function syncAnalysisStatus(
  queryClient: QueryClient,
  status: BatchReanalyzeStatusResponse,
) {
  queryClient.setQueryData(['batch-reanalyze-status'], status)
  void queryClient.invalidateQueries({ queryKey: ['batch-reanalyze-status'] })
}

export function getAnalysisJobErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data
    if (typeof data?.error === 'string' && data.error.trim()) {
      return data.error
    }
    if (typeof data?.message === 'string' && data.message.trim()) {
      return data.message
    }
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  return fallback
}

export function useAnalysisJobControls() {
  const queryClient = useQueryClient()

  const startAnalysisJob = useCallback(async ({
    sliceIds,
    concurrency,
    includeFilenameTags = true,
    allowAiTagging = true,
    jobLabel,
  }: StartAnalysisJobInput) => {
    const result = await startBatchReanalyzeSamples(
      sliceIds,
      'advanced',
      concurrency ?? getStoredAnalysisConcurrency(),
      includeFilenameTags,
      allowAiTagging,
      jobLabel,
    )
    syncAnalysisStatus(queryClient, result.status)
    return result
  }, [queryClient])

  const cancelAnalysisJob = useCallback(async () => {
    const result = await cancelBatchReanalyze()
    syncAnalysisStatus(queryClient, result.status)
    return result
  }, [queryClient])

  return {
    startAnalysisJob,
    cancelAnalysisJob,
  }
}
