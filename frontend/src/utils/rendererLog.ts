type RendererLogLevel = 'log' | 'warn' | 'error'

function toMessage(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Error) {
    return `${value.name}: ${value.message}\n${value.stack || ''}`.trim()
  }
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function logRenderer(level: RendererLogLevel, context: string, message: unknown): void {
  const text = toMessage(message)

  try {
    window.electron?.logRenderer?.({ level, context, message: text })
  } catch {
    // best-effort diagnostics only
  }

  if (level === 'error') {
    console.error(`[${context}] ${text}`)
  } else if (level === 'warn') {
    console.warn(`[${context}] ${text}`)
  } else {
    console.log(`[${context}] ${text}`)
  }
}

export function logRendererInfo(context: string, message: unknown): void {
  logRenderer('log', context, message)
}

export function logRendererWarn(context: string, message: unknown): void {
  logRenderer('warn', context, message)
}

export function logRendererError(context: string, message: unknown): void {
  logRenderer('error', context, message)
}

/**
 * Log a performance measurement.
 * Usage:
 *   const t = perfStart()
 *   // ... do work ...
 *   logRendererPerf('AudioManager', 'loadFile', t)
 */
export function perfStart(): number {
  return performance.now()
}

export function logRendererPerf(context: string, label: string, startMs: number): number {
  const elapsed = Math.round(performance.now() - startMs)
  logRenderer('log', context, `PERF ${label}: ${elapsed}ms`)
  return elapsed
}
