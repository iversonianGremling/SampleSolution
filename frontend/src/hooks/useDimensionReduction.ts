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
  minDist: 0.1,
  perplexity: 30,
  seed: 42,
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

        // Normalize to -1 to 1 range for easier rendering
        const xValues = resultPoints.map((p) => p[0])
        const yValues = resultPoints.map((p) => p[1])
        const xMin = Math.min(...xValues)
        const xMax = Math.max(...xValues)
        const yMin = Math.min(...yValues)
        const yMax = Math.max(...yValues)

        const normalized = resultPoints.map(([x, y]) => [
          xMax !== xMin ? ((x - xMin) / (xMax - xMin)) * 2 - 1 : 0,
          yMax !== yMin ? ((y - yMin) / (yMax - yMin)) * 2 - 1 : 0,
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
