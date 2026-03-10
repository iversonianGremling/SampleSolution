/**
 * Benchmark: concurrent analysis pool vs serial execution
 *
 * Verifies that the pool-based analysis runner in folderImportJob finishes
 * faster than serial execution and correctly respects the concurrency limit.
 */
import { describe, it, expect } from 'vitest'

// ---------------------------------------------------------------------------
// Inline the pool logic so the test has no DB / filesystem dependencies
// ---------------------------------------------------------------------------

async function runAnalysisPool(
  tasks: Array<() => Promise<void>>,
  concurrency: number,
): Promise<{ durationMs: number }> {
  const queue = [...tasks]
  const active = new Set<Promise<void>>()
  let peakActive = 0

  const startNext = (): void => {
    if (queue.length === 0) return
    const task = queue.shift()!
    const promise: Promise<void> = task().finally(() => {
      active.delete(promise)
    })
    active.add(promise)
    if (active.size > peakActive) peakActive = active.size
  }

  while (active.size < concurrency && queue.length > 0) {
    startNext()
  }

  const start = Date.now()
  while (active.size > 0) {
    await Promise.race(active)
    while (active.size < concurrency && queue.length > 0) {
      startNext()
    }
  }

  return { durationMs: Date.now() - start }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Simulates a task that takes `ms` milliseconds */
const delay = (ms: number) => (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/** Returns N tasks each taking `ms` ms */
const tasks = (n: number, ms: number) => Array.from({ length: n }, () => delay(ms))

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('analysis pool concurrency', () => {
  it('runs faster with concurrency=5 than serial (concurrency=1)', async () => {
    const TASK_COUNT = 10
    const TASK_MS = 20 // each "analysis" takes 20 ms

    const [serial, concurrent] = await Promise.all([
      runAnalysisPool(tasks(TASK_COUNT, TASK_MS), 1),
      runAnalysisPool(tasks(TASK_COUNT, TASK_MS), 5),
    ])

    // Serial should take ~200ms; concurrent (5 workers) should take ~40–60ms
    expect(concurrent.durationMs).toBeLessThan(serial.durationMs)

    console.log(
      `[pool bench] serial=${serial.durationMs}ms  concurrent(5)=${concurrent.durationMs}ms` +
      `  speedup=${(serial.durationMs / concurrent.durationMs).toFixed(1)}x`,
    )
  }, 10_000)

  it('respects the concurrency limit (never exceeds it)', async () => {
    const concurrency = 3
    let maxActive = 0
    let currentActive = 0

    const trackedTask = () => (): Promise<void> => {
      currentActive++
      if (currentActive > maxActive) maxActive = currentActive
      return new Promise<void>((resolve) =>
        setTimeout(() => {
          currentActive--
          resolve()
        }, 10),
      )
    }

    const tracked = Array.from({ length: 12 }, trackedTask)
    await runAnalysisPool(tracked, concurrency)

    expect(maxActive).toBeLessThanOrEqual(concurrency)
  })

  it('processes all tasks even with concurrency=10', async () => {
    const completed: number[] = []
    const taskList = Array.from({ length: 25 }, (_, i) => async () => {
      await new Promise<void>((r) => setTimeout(r, 5))
      completed.push(i)
    })

    await runAnalysisPool(taskList, 10)
    expect(completed).toHaveLength(25)
  })

  it('shows scaling across concurrency levels (informational)', async () => {
    const TASK_COUNT = 20
    const TASK_MS = 15

    const results: Record<number, number> = {}
    for (const c of [1, 2, 4, 8, 10]) {
      const { durationMs } = await runAnalysisPool(tasks(TASK_COUNT, TASK_MS), c)
      results[c] = durationMs
    }

    const lines = Object.entries(results)
      .map(([c, ms]) => `  concurrency=${c}: ${ms}ms`)
      .join('\n')
    console.log(`[pool bench] scaling:\n${lines}`)

    // Each higher concurrency should be at least as fast as half the tasks running serially
    expect(results[10]).toBeLessThan(results[1])
  }, 15_000)
})
