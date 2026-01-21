declare module '@saehrimnir/druidjs' {
  export class Matrix {
    static from(data: number[][]): Matrix
    shape: [number, number]
    entry(row: number, col: number): number
  }

  export class UMAP {
    constructor(
      data: Matrix,
      options?: {
        n_neighbors?: number
        min_dist?: number
        d?: number
        seed?: number
      }
    )
    transform(): Matrix
  }

  export class TSNE {
    constructor(
      data: Matrix,
      options?: {
        perplexity?: number
        d?: number
        seed?: number
      }
    )
    transform(): Matrix
  }

  export class PCA {
    constructor(data: Matrix, options?: { d?: number })
    transform(): Matrix
  }
}
