import type { AnalysisLevel } from '../types'

const ANALYSIS_LEVEL_KEY = 'defaultAnalysisLevel'

export function getDefaultAnalysisLevel(): AnalysisLevel {
  const saved = localStorage.getItem(ANALYSIS_LEVEL_KEY)
  return (saved as AnalysisLevel) || 'standard'
}

export function setDefaultAnalysisLevel(level: AnalysisLevel): void {
  localStorage.setItem(ANALYSIS_LEVEL_KEY, level)
}
