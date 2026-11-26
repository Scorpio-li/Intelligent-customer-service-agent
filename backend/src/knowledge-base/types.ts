// 知识库对外类型定义：意图、知识条目、检索结果
export type Intent =
  | 'delivery'
  | 'payment'
  | 'invoice'
  | 'membership'
  | 'coupon'
  | 'account'
  | 'aftersale'
  | 'human'
  | 'unknown'

export interface KnowledgeEntry {
  id: string
  title: string
  intent: Intent
  keywords: string[]
  content: string
  updatedAt: string
}

export type RetrievalStage = 'bm25' | 'vector' | 'hybrid' | 'none'

// 各阶段原始分：bm25 为稀疏分，vector 为余弦，rrf 为融合分，rerank 为精排分
export interface RetrievalScores {
  bm25?: number
  vector?: number
  rrf?: number
  rerank?: number
}

export interface RetrievalResult {
  hit: boolean
  stage: RetrievalStage
  score: number
  entries: KnowledgeEntry[]
  scores?: RetrievalScores
}
