// 混合检索编排：BM25 与向量并行召回 → RRF 融合 → rerank 精排；向量不可用时降级本地索引
import { rankByBm25 } from './bm25.js'
import { embedTexts, getEntryEmbedding } from './embeddings.js'
import { rrfFuse } from './fusion.js'
import { recordRetrieval } from './metrics.js'
import { rerankDocuments } from './rerank.js'
import { getEntries, searchByVector } from './repository.js'
import { cosineSimilarity } from './similarity.js'
import type { Intent, KnowledgeEntry, RetrievalResult, RetrievalScores, RetrievalStage } from './types.js'

const DEFAULT_BM25_TOP_K = 10
const DEFAULT_VECTOR_TOP_K = 10
const DEFAULT_RERANK_TOP_N = 5
const DEFAULT_FINAL_TOP_K = 3
const DEFAULT_RRF_K = 60
const DEFAULT_BM25_THRESHOLD = 0.4
const DEFAULT_EMBEDDING_THRESHOLD = 0.6
// gte-rerank-v2 的相关性分普遍偏低（相关结果约 0.12~0.9），阈值按实测校准
const DEFAULT_RERANK_THRESHOLD = 0.1
// BM25 原始分展示归一的近似上限，仅影响 rag-hit 里给前端的 score
const BM25_DISPLAY_CAP = 2.5

interface ScoredEntry {
  entry: KnowledgeEntry
  score: number
}

interface VectorRecall {
  hits: ScoredEntry[]
  degraded: boolean
}

const now = () => performance.now()

function envNumber(key: string, fallback: number): number {
  const raw = Number(process.env[key])
  return Number.isFinite(raw) && raw >= 0 ? raw : fallback
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

function miss(): RetrievalResult {
  return { hit: false, stage: 'none', score: 0, entries: [] }
}

function stageOf(entryId: string, bm25: ScoredEntry[], vector: ScoredEntry[]): RetrievalStage {
  const inBm25 = bm25.some((hit) => hit.entry.id === entryId)
  const inVector = vector.some((hit) => hit.entry.id === entryId)
  if (inBm25 && inVector) return 'hybrid'
  return inVector ? 'vector' : 'bm25'
}

// 向量召回：Qdrant 优先，Qdrant 不可用时用本地离线索引做余弦比对
async function recallVectors(query: string, intent: Intent, candidates: KnowledgeEntry[]): Promise<VectorRecall> {
  if (process.env.KB_EMBEDDING_ENABLED === 'false' || candidates.length === 0) {
    return { hits: [], degraded: false }
  }

  try {
    const [queryVector] = await embedTexts([query])
    if (!queryVector) return { hits: [], degraded: false }

    const topK = envNumber('KB_VECTOR_TOP_K', DEFAULT_VECTOR_TOP_K)
    const remote = await searchByVector(queryVector, intent, topK)
    if (remote) return { hits: remote, degraded: false }

    const entryVectors = await Promise.all(candidates.map((entry) => getEntryEmbedding(entry)))
    const hits = candidates
      .map((entry, i) => ({ entry, score: cosineSimilarity(queryVector, entryVectors[i]) }))
      .filter((hit) => hit.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)

    return { hits, degraded: true }
  } catch (err) {
    console.warn('[kb] 向量召回失败，仅使用 BM25:', err)
    return { hits: [], degraded: true }
  }
}

export async function retrieve(query: string, intent: Intent): Promise<RetrievalResult> {
  const started = now()
  const q = query.trim()
  if (!q || intent === 'unknown') {
    recordRetrieval({ hit: false, stage: 'none', degraded: false, latencyMs: { total: now() - started } })
    return miss()
  }

  const entries = await getEntries()
  const candidates = entries.filter((entry) => entry.intent === intent)

  // 并行召回：BM25 在进程内，向量走网络，两条通道互不阻塞
  const bm25Start = now()
  const bm25Hits = rankByBm25(q, candidates, envNumber('KB_BM25_TOP_K', DEFAULT_BM25_TOP_K))
  const bm25Ms = now() - bm25Start

  const vectorStart = now()
  const vector = await recallVectors(q, intent, candidates)
  const vectorMs = now() - vectorStart

  // 无候选直接结束，避免无谓的 rerank 调用
  if (bm25Hits.length === 0 && vector.hits.length === 0) {
    recordRetrieval({
      hit: false,
      stage: 'none',
      degraded: vector.degraded,
      latencyMs: { bm25: bm25Ms, vector: vectorMs, total: now() - started }
    })
    return miss()
  }

  const fused = rrfFuse(
    [bm25Hits.map((hit) => hit.entry), vector.hits.map((hit) => hit.entry)],
    (entry) => entry.id,
    envNumber('KB_RRF_K', DEFAULT_RRF_K)
  ).slice(0, envNumber('KB_RERANK_TOP_N', DEFAULT_RERANK_TOP_N))

  const rerankStart = now()
  const reranked = await rerankDocuments(
    q,
    fused.map((fusedHit) => `${fusedHit.item.title}\n${fusedHit.item.content}`),
    envNumber('KB_FINAL_TOP_K', DEFAULT_FINAL_TOP_K)
  )
  const rerankMs = now() - rerankStart

  if (reranked === null) {
    const refined = fallbackRank(fused, bm25Hits, vector.hits)
    const best = refined[0]
    const hit = Boolean(best)
    const latencyMs = { bm25: bm25Ms, vector: vectorMs, rerank: rerankMs, total: now() - started }
    recordRetrieval({ hit, stage: best ? stageOf(best.entry.id, bm25Hits, vector.hits) : 'none', degraded: vector.degraded, latencyMs })

    return hit
      ? {
          hit: true,
          stage: stageOf(best.entry.id, bm25Hits, vector.hits),
          score: best.displayScore,
          entries: refined.map((item) => item.entry),
          scores: best.scores
        }
      : miss()
  }

  const refined = rerankRank(fused, reranked, bm25Hits, vector.hits)
  const best = refined[0]
  const latencyMs = { bm25: bm25Ms, vector: vectorMs, rerank: rerankMs, total: now() - started }
  recordRetrieval({ hit: Boolean(best), stage: best ? stageOf(best.entry.id, bm25Hits, vector.hits) : 'none', degraded: vector.degraded, latencyMs })

  if (!best) return miss()

  return {
    hit: true,
    stage: stageOf(best.entry.id, bm25Hits, vector.hits),
    score: best.displayScore,
    entries: refined.map((item) => item.entry),
    scores: best.scores
  }
}

interface RefinedEntry {
  entry: KnowledgeEntry
  displayScore: number
  scores: RetrievalScores
}

// rerank 成功：按精排分排序，过滤低于阈值的结果
function rerankRank(
  fused: Array<{ item: KnowledgeEntry; score: number }>,
  reranked: Array<{ index: number; score: number }>,
  bm25Hits: ScoredEntry[],
  vectorHits: ScoredEntry[]
): RefinedEntry[] {
  const threshold = envNumber('KB_RERANK_THRESHOLD', DEFAULT_RERANK_THRESHOLD)
  const bm25ById = new Map(bm25Hits.map((hit) => [hit.entry.id, hit.score]))
  const vectorById = new Map(vectorHits.map((hit) => [hit.entry.id, hit.score]))
  const refined: RefinedEntry[] = []

  for (const hit of reranked) {
    const fusedHit = fused[hit.index]
    if (!fusedHit || hit.score < threshold) continue

    const scores: RetrievalScores = { rrf: round3(fusedHit.score), rerank: round3(hit.score) }
    const bm25Score = bm25ById.get(fusedHit.item.id)
    const vectorScore = vectorById.get(fusedHit.item.id)
    if (bm25Score !== undefined) scores.bm25 = round3(bm25Score)
    if (vectorScore !== undefined) scores.vector = round3(vectorScore)

    refined.push({ entry: fusedHit.item, displayScore: round3(hit.score), scores })
  }

  return refined
}

// rerank 不可用：用单路原始证据判定，丢弃弱候选
function fallbackRank(
  fused: Array<{ item: KnowledgeEntry; score: number }>,
  bm25Hits: ScoredEntry[],
  vectorHits: ScoredEntry[]
): RefinedEntry[] {
  const bm25ById = new Map(bm25Hits.map((hit) => [hit.entry.id, hit.score]))
  const vectorById = new Map(vectorHits.map((hit) => [hit.entry.id, hit.score]))
  const bm25Threshold = envNumber('KB_BM25_THRESHOLD', DEFAULT_BM25_THRESHOLD)
  const embeddingThreshold = envNumber('KB_EMBEDDING_THRESHOLD', DEFAULT_EMBEDDING_THRESHOLD)

  return fused
    .map((fusedHit) => {
      const bm25Score = bm25ById.get(fusedHit.item.id) ?? 0
      const vectorScore = vectorById.get(fusedHit.item.id) ?? 0
      const evidence = Math.max(vectorScore, Math.min(1, bm25Score / BM25_DISPLAY_CAP))
      const scores: RetrievalScores = { rrf: round3(fusedHit.score) }
      if (bm25Score > 0) scores.bm25 = round3(bm25Score)
      if (vectorScore > 0) scores.vector = round3(vectorScore)
      return { entry: fusedHit.item, displayScore: round3(evidence), scores, bm25Score, vectorScore }
    })
    .filter((item) => item.vectorScore >= embeddingThreshold || item.bm25Score >= bm25Threshold)
    .map(({ entry, displayScore, scores }) => ({ entry, displayScore, scores }))
}
