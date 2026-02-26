import { useState, useEffect } from 'react'
import DBSCAN from 'density-clustering/lib/DBSCAN'
import KMEANS from 'density-clustering/lib/KMEANS'

export type ClusterMethod = 'dbscan' | 'kmeans' | 'hdbscan'

interface UseClusteringOptions {
  method: ClusterMethod
  // DBSCAN params
  epsilon?: number
  minPoints?: number
  // K-means params
  k?: number
  // HDBSCAN params
  minClusterSize?: number
  minSamples?: number
}

interface UseClusteringResult {
  clusters: number[] // cluster index for each point (-1 = noise for DBSCAN)
  clusterCount: number
  isComputing: boolean
}

const DEFAULT_OPTIONS: UseClusteringOptions = {
  method: 'dbscan',
  epsilon: 0.15,
  minPoints: 2,
  k: 5,
  minClusterSize: 5,
  minSamples: 3,
}

// Vibrant cluster color palette - saturated, visually distinct colors
export const CLUSTER_COLORS = [
  '#3b82f6', // bright blue
  '#10b981', // vibrant green
  '#f59e0b', // golden amber
  '#ef4444', // vivid red
  '#8b5cf6', // purple
  '#06b6d4', // bright cyan
  '#ec4899', // hot pink
  '#84cc16', // lime
  '#f97316', // bright orange
  '#14b8a6', // turquoise
  '#d946ef', // magenta
  '#eab308', // bright yellow
]

export const NOISE_COLOR = '#475569' // slate gray

export function getClusterColor(clusterIndex: number): string {
  if (clusterIndex < 0) return NOISE_COLOR
  return CLUSTER_COLORS[clusterIndex % CLUSTER_COLORS.length]
}

export function useClustering(
  points: [number, number][],
  options: Partial<UseClusteringOptions> = {}
): UseClusteringResult {
  const [clusters, setClusters] = useState<number[]>([])
  const [clusterCount, setClusterCount] = useState(0)
  const [isComputing, setIsComputing] = useState(false)

  const opts = { ...DEFAULT_OPTIONS, ...options }

  useEffect(() => {
    if (points.length < 2) {
      setClusters(points.map(() => 0))
      setClusterCount(points.length > 0 ? 1 : 0)
      return
    }

    setIsComputing(true)

    // Run in setTimeout to not block UI
    const timeoutId = setTimeout(() => {
      try {
        let clusterAssignments: number[]

        if (opts.method === 'dbscan') {
          const dbscan = new DBSCAN()
          const clusterIndices = dbscan.run(points, opts.epsilon ?? 0.15, opts.minPoints ?? 2)

          // Convert cluster indices array to per-point assignments
          clusterAssignments = new Array(points.length).fill(-1) // -1 = noise
          clusterIndices.forEach((cluster: number[], clusterIdx: number) => {
            cluster.forEach((pointIdx: number) => {
              clusterAssignments[pointIdx] = clusterIdx
            })
          })

          setClusterCount(clusterIndices.length)
        } else if (opts.method === 'hdbscan') {
          // HDBSCAN: mutual reachability distance + single linkage + DBSCAN* extraction
          const minClusterSize = opts.minClusterSize ?? 5
          const minSamples = opts.minSamples ?? 3

          // Compute pairwise Euclidean distances
          const n = points.length
          const dist = Array.from({ length: n }, (_, i) =>
            Array.from({ length: n }, (_, j) => {
              if (i === j) return 0
              const dx = points[i][0] - points[j][0]
              const dy = points[i][1] - points[j][1]
              return Math.sqrt(dx * dx + dy * dy)
            })
          )

          // Core distances (distance to k-th nearest neighbor)
          const coreDistances = dist.map(row => {
            const sorted = [...row].sort((a, b) => a - b)
            return sorted[Math.min(minSamples, n - 1)]
          })

          // Mutual reachability distance
          const mrd = Array.from({ length: n }, (_, i) =>
            Array.from({ length: n }, (_, j) =>
              Math.max(coreDistances[i], coreDistances[j], dist[i][j])
            )
          )

          // Build MST using Prim's algorithm
          const inMST = new Array(n).fill(false)
          const mstEdges: { from: number; to: number; weight: number }[] = []
          const minEdge = new Array(n).fill(Infinity)
          const minFrom = new Array(n).fill(-1)
          inMST[0] = true
          for (let j = 1; j < n; j++) {
            minEdge[j] = mrd[0][j]
            minFrom[j] = 0
          }
          for (let iter = 0; iter < n - 1; iter++) {
            let bestIdx = -1
            let bestDist = Infinity
            for (let j = 0; j < n; j++) {
              if (!inMST[j] && minEdge[j] < bestDist) {
                bestDist = minEdge[j]
                bestIdx = j
              }
            }
            if (bestIdx === -1) break
            inMST[bestIdx] = true
            mstEdges.push({ from: minFrom[bestIdx], to: bestIdx, weight: bestDist })
            for (let j = 0; j < n; j++) {
              if (!inMST[j] && mrd[bestIdx][j] < minEdge[j]) {
                minEdge[j] = mrd[bestIdx][j]
                minFrom[j] = bestIdx
              }
            }
          }

          // Sort MST edges by weight descending for single-linkage dendrogram cutting
          mstEdges.sort((a, b) => b.weight - a.weight)

          // Extract clusters using simplified DBSCAN* approach:
          // Cut edges from largest to smallest, form connected components,
          // keep components >= minClusterSize
          const parent = Array.from({ length: n }, (_, i) => i)
          const size = new Array(n).fill(1)
          const find = (x: number): number => {
            while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] }
            return x
          }
          const union = (a: number, b: number) => {
            a = find(a); b = find(b)
            if (a === b) return
            if (size[a] < size[b]) [a, b] = [b, a]
            parent[b] = a
            size[a] += size[b]
          }

          // Add all MST edges (they're sorted desc, but union order doesn't matter for final components)
          for (const edge of mstEdges) {
            union(edge.from, edge.to)
          }

          // Now iteratively remove the heaviest edges and check stability
          // Simpler approach: use DBSCAN with adaptive epsilon based on MST edge distribution
          const edgeWeights = mstEdges.map(e => e.weight).sort((a, b) => a - b)
          const medianEdge = edgeWeights[Math.floor(edgeWeights.length * 0.5)]
          const mergeThresholdFactor = 1.6

          // Reset and rebuild with only edges below threshold
          for (let i = 0; i < n; i++) { parent[i] = i; size[i] = 1 }
          for (const edge of mstEdges) {
            // Lower factor means fewer long-range merges and more local clusters.
            if (edge.weight <= medianEdge * mergeThresholdFactor) {
              union(edge.from, edge.to)
            }
          }

          // Assign clusters, mark small components as noise
          const componentMap = new Map<number, number>()
          let nextCluster = 0
          clusterAssignments = new Array(n).fill(-1)
          for (let i = 0; i < n; i++) {
            const root = find(i)
            if (size[root] >= minClusterSize) {
              if (!componentMap.has(root)) {
                componentMap.set(root, nextCluster++)
              }
              clusterAssignments[i] = componentMap.get(root)!
            }
          }

          setClusterCount(nextCluster)
        } else {
          // K-means
          const kmeans = new KMEANS()
          const k = Math.min(opts.k ?? 5, points.length)
          const clusterIndices = kmeans.run(points, k)

          // Convert cluster indices array to per-point assignments
          clusterAssignments = new Array(points.length).fill(0)
          clusterIndices.forEach((cluster: number[], clusterIdx: number) => {
            cluster.forEach((pointIdx: number) => {
              clusterAssignments[pointIdx] = clusterIdx
            })
          })

          setClusterCount(k)
        }

        setClusters(clusterAssignments)
        setIsComputing(false)
      } catch (err) {
        console.error('Clustering error:', err)
        // Fallback: assign all to cluster 0
        setClusters(points.map(() => 0))
        setClusterCount(1)
        setIsComputing(false)
      }
    }, 10)

    return () => clearTimeout(timeoutId)
  }, [points, opts.method, opts.epsilon, opts.minPoints, opts.k, opts.minClusterSize, opts.minSamples])

  return { clusters, clusterCount, isComputing }
}
