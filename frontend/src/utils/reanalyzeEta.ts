export interface ReanalyzeEtaInput {
  isStopping: boolean
  startedAt: string | null | undefined
  processed: number
  total: number
  nowMs?: number
}

export function formatDurationCompact(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s'

  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

export function computeReanalyzeEtaMs(input: ReanalyzeEtaInput): number | null {
  if (input.isStopping) return null
  if (!Number.isFinite(input.total) || input.total <= 0) return null
  if (!Number.isFinite(input.processed) || input.processed <= 0) return null
  if (input.processed >= input.total) return null
  if (!input.startedAt) return null

  const startedAtMs = new Date(input.startedAt).getTime()
  if (!Number.isFinite(startedAtMs)) return null

  const nowMs = Number.isFinite(input.nowMs) ? input.nowMs! : Date.now()
  const elapsedMs = Math.max(0, nowMs - startedAtMs)
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return null

  const averageMsPerSample = elapsedMs / input.processed
  if (!Number.isFinite(averageMsPerSample) || averageMsPerSample <= 0) return null

  const remainingSamples = input.total - input.processed
  const etaMs = averageMsPerSample * remainingSamples
  if (!Number.isFinite(etaMs) || etaMs < 0) return null

  return etaMs
}

export function formatReanalyzeEtaLabel(input: ReanalyzeEtaInput): string | null {
  const etaMs = computeReanalyzeEtaMs(input)
  if (etaMs === null) return null
  return formatDurationCompact(etaMs)
}
