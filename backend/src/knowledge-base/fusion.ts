// 纯函数：RRF（Reciprocal Rank Fusion）融合多路召回，按名次而非原始分加权
export interface FusedHit<T> {
  item: T
  score: number
  rank: number
}

// lists 按召回通道顺序传入；k 越大，名次差异被压得越平（业界常用 60）
export function rrfFuse<T>(lists: T[][], keyOf: (item: T) => string, k = 60): FusedHit<T>[] {
  const merged = new Map<string, FusedHit<T>>()

  lists.forEach((list) => {
    list.forEach((item, index) => {
      const id = keyOf(item)
      const rank = index + 1
      const existing = merged.get(id)
      if (existing) {
        existing.score += 1 / (k + rank)
        existing.rank = Math.min(existing.rank, rank)
        return
      }
      merged.set(id, { item, score: 1 / (k + rank), rank })
    })
  })

  return [...merged.values()].sort((a, b) => b.score - a.score)
}
