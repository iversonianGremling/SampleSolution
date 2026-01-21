declare module 'density-clustering/lib/DBSCAN' {
  export default class DBSCAN {
    run(dataset: number[][], epsilon: number, minPoints: number): number[][]
  }
}

declare module 'density-clustering/lib/KMEANS' {
  export default class KMEANS {
    run(dataset: number[][], k: number, maxIterations?: number): number[][]
  }
}

declare module 'density-clustering' {
  export class DBSCAN {
    run(dataset: number[][], epsilon: number, minPoints: number): number[][]
  }

  export class KMEANS {
    run(dataset: number[][], k: number, maxIterations?: number): number[][]
  }
}
