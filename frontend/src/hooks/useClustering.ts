import { useState, useEffect } from 'react'
import DBSCAN from 'density-clustering/lib/DBSCAN'
import KMEANS from 'density-clustering/lib/KMEANS'

export type ClusterMethod = 'dbscan' | 'kmeans'

interface UseClusteringOptions {
  method: ClusterMethod
  // DBSCAN params
  epsilon?: number
  minPoints?: number
  // K-means params
  k?: number
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
  }, [points, opts.method, opts.epsilon, opts.minPoints, opts.k])

  return { clusters, clusterCount, isComputing }
}
