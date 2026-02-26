import { useState, useEffect, useRef } from 'react'
import * as druid from '@saehrimnir/druidjs'

export type ReductionMethod = 'umap' | 'tsne' | 'pca'

interface UseDimensionReductionOptions {
  method: ReductionMethod
  // UMAP params
  nNeighbors?: number
  minDist?: number
  // t-SNE params
  perplexity?: number
  // General
  seed?: number
}

interface UseDimensionReductionResult {
  points: [number, number][]
  isComputing: boolean
  error: string | null
  progress: number
}

const DEFAULT_OPTIONS: UseDimensionReductionOptions = {
  method: 'umap',
  nNeighbors: 15,
  minDist: 0.2,
  perplexity: 30,
  seed: 42,
}

function getQuantile(sortedValues: number[], quantile: number): number {
  if (sortedValues.length === 0) return 0
  const clampedQuantile = Math.max(0, Math.min(1, quantile))
  const position = (sortedValues.length - 1) * clampedQuantile
  const lowerIndex = Math.floor(position)
  const upperIndex = Math.ceil(position)
  if (lowerIndex === upperIndex) return sortedValues[lowerIndex]
  const blend = position - lowerIndex
  return sortedValues[lowerIndex] * (1 - blend) + sortedValues[upperIndex] * blend
}

function normalizeProjectionAxis(value: number, low: number, high: number): number {
  if (high <= low) return 0
  const clampedValue = Math.max(low, Math.min(high, value))
  return ((clampedValue - low) / (high - low)) * 2 - 1
}

export function useDimensionReduction(
  matrix: number[][],
  options: Partial<UseDimensionReductionOptions> = {}
): UseDimensionReductionResult {
  const [points, setPoints] = useState<[number, number][]>([])
  const [isComputing, setIsComputing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const computeIdRef = useRef(0)

  const opts = { ...DEFAULT_OPTIONS, ...options }

  useEffect(() => {
    if (matrix.length < 3) {
      setPoints([])
      setError(matrix.length > 0 ? 'Need at least 3 samples for visualization' : null)
      return
    }

    const computeId = ++computeIdRef.current
    setIsComputing(true)
    setError(null)
    setProgress(0)

    // Run in a setTimeout to not block the UI
    const timeoutId = setTimeout(() => {
      try {
        const druidMatrix = druid.Matrix.from(matrix)
        let result: druid.Matrix

        switch (opts.method) {
          case 'umap': {
            const umap = new druid.UMAP(druidMatrix, {
              n_neighbors: Math.min(opts.nNeighbors!, matrix.length - 1),
              min_dist: opts.minDist,
              d: 2,
              seed: opts.seed,
            })
            result = umap.transform()
            break
          }
          case 'tsne': {
            const tsne = new druid.TSNE(druidMatrix, {
              perplexity: Math.min(opts.perplexity!, Math.floor(matrix.length / 3)),
              d: 2,
              seed: opts.seed,
            })
            result = tsne.transform()
            break
          }
          case 'pca': {
            const pca = new druid.PCA(druidMatrix, { d: 2 })
            result = pca.transform()
            break
          }
          default:
            throw new Error(`Unknown method: ${opts.method}`)
        }

        // Check if this computation is still valid
        if (computeId !== computeIdRef.current) return

        // Convert result matrix to array of [x, y] points
        const resultPoints: [number, number][] = []
        for (let i = 0; i < result.shape[0]; i++) {
          resultPoints.push([result.entry(i, 0), result.entry(i, 1)])
        }

        // Robustly normalize to reduce outlier-driven stretching.
        // Use central quantiles instead of hard min/max so dense structure
        // remains readable and points do not over-spread.
        const xValues = resultPoints.map((p) => p[0])
        const yValues = resultPoints.map((p) => p[1])
        const sortedXValues = [...xValues].sort((a, b) => a - b)
        const sortedYValues = [...yValues].sort((a, b) => a - b)
        let xLow = getQuantile(sortedXValues, 0.02)
        let xHigh = getQuantile(sortedXValues, 0.98)
        let yLow = getQuantile(sortedYValues, 0.02)
        let yHigh = getQuantile(sortedYValues, 0.98)

        if (xHigh <= xLow) {
          xLow = sortedXValues[0] ?? 0
          xHigh = sortedXValues[sortedXValues.length - 1] ?? 0
        }
        if (yHigh <= yLow) {
          yLow = sortedYValues[0] ?? 0
          yHigh = sortedYValues[sortedYValues.length - 1] ?? 0
        }

        const viewportScale = 0.85

        const normalized = resultPoints.map(([x, y]) => [
          normalizeProjectionAxis(x, xLow, xHigh) * viewportScale,
          normalizeProjectionAxis(y, yLow, yHigh) * viewportScale,
        ] as [number, number])

        setPoints(normalized)
        setProgress(100)
        setIsComputing(false)
      } catch (err) {
        if (computeId !== computeIdRef.current) return
        setError(err instanceof Error ? err.message : 'Failed to compute projection')
        setIsComputing(false)
      }
    }, 10)

    return () => {
      clearTimeout(timeoutId)
    }
  }, [matrix, opts.method, opts.nNeighbors, opts.minDist, opts.perplexity, opts.seed])

  return { points, isComputing, error, progress }
}
