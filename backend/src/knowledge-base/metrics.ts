// 副作用：进程内监控指标注册表（召回率代理指标 / 分阶段延迟 / API 成本估算）
import type { RetrievalStage } from './types.js'

const MAX_SAMPLES = 500
// 外部 API 价格默认值（元 / 千 token），可在 .env 覆盖，仅用于粗略成本估算
const DEFAULT_EMBED_PRICE = 0.0007
const DEFAULT_RERANK_PRICE = 0.0008
// rerank 响应未带 usage 时，按平均每条文档 80 token 估算
const FALLBACK_TOKENS_PER_DOC = 80

interface LatencyBucket {
  count: number
  sum: number
  max: number
  samples: number[]
}

interface RetrievalCounters {
  total: number
  hit: number
  degraded: number
  byStage: Record<RetrievalStage, number>
}

function emptyBucket(): LatencyBucket {
  return { count: 0, sum: 0, max: 0, samples: [] }
}

const latency: Record<'bm25' | 'vector' | 'rerank' | 'total', LatencyBucket> = {
  bm25: emptyBucket(),
  vector: emptyBucket(),
  rerank: emptyBucket(),
  total: emptyBucket()
}

const retrieval: RetrievalCounters = {
  total: 0,
  hit: 0,
  degraded: 0,
  byStage: { bm25: 0, vector: 0, hybrid: 0, none: 0 }
}

const cost = {
  embedCalls: 0,
  embedChars: 0,
  rerankCalls: 0,
  rerankDocs: 0,
  rerankTokens: 0
}

const startedAt = Date.now()

function push(bucket: LatencyBucket, ms: number): void {
  bucket.count += 1
  bucket.sum += ms
  bucket.max = Math.max(bucket.max, ms)
  bucket.samples.push(ms)
  if (bucket.samples.length > MAX_SAMPLES) bucket.samples.shift()
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index]
}

function summary(bucket: LatencyBucket) {
  const sorted = [...bucket.samples].sort((a, b) => a - b)
  return {
    count: bucket.count,
    avgMs: bucket.count === 0 ? 0 : round(bucket.sum / bucket.count),
    p50Ms: round(percentile(sorted, 50)),
    p95Ms: round(percentile(sorted, 95)),
    maxMs: round(bucket.max)
  }
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}

function price(envKey: string, fallback: number): number {
  const raw = Number(process.env[envKey])
  return Number.isFinite(raw) && raw >= 0 ? raw : fallback
}

export function recordEmbeddingCall(chars: number): void {
  cost.embedCalls += 1
  cost.embedChars += chars
}

export function recordRerankCall(documents: number, tokens?: number): void {
  cost.rerankCalls += 1
  cost.rerankDocs += documents
  cost.rerankTokens += tokens && tokens > 0 ? tokens : documents * FALLBACK_TOKENS_PER_DOC
}

export interface RetrievalMetricInput {
  hit: boolean
  stage: RetrievalStage
  degraded: boolean
  latencyMs: { bm25?: number; vector?: number; rerank?: number; total: number }
}

export function recordRetrieval(input: RetrievalMetricInput): void {
  retrieval.total += 1
  if (input.hit) retrieval.hit += 1
  if (input.degraded) retrieval.degraded += 1
  retrieval.byStage[input.stage] += 1

  const { bm25, vector, rerank, total } = input.latencyMs
  if (bm25 !== undefined) push(latency.bm25, bm25)
  if (vector !== undefined) push(latency.vector, vector)
  if (rerank !== undefined) push(latency.rerank, rerank)
  push(latency.total, total)
}

export function metricsSnapshot() {
  const embedCny = (cost.embedChars / 1000) * price('KB_COST_EMBED_CNY_PER_1K', DEFAULT_EMBED_PRICE)
  const rerankCny = (cost.rerankTokens / 1000) * price('KB_COST_RERANK_CNY_PER_1K', DEFAULT_RERANK_PRICE)

  return {
    uptimeMs: Date.now() - startedAt,
    retrieval: {
      total: retrieval.total,
      hit: retrieval.hit,
      miss: retrieval.total - retrieval.hit,
      hitRate: retrieval.total === 0 ? 0 : round((retrieval.hit / retrieval.total) * 100) / 100,
      degraded: retrieval.degraded,
      byStage: { ...retrieval.byStage }
    },
    latencyMs: {
      bm25: summary(latency.bm25),
      vector: summary(latency.vector),
      rerank: summary(latency.rerank),
      total: summary(latency.total)
    },
    cost: {
      embedCalls: cost.embedCalls,
      embedChars: cost.embedChars,
      rerankCalls: cost.rerankCalls,
      rerankDocs: cost.rerankDocs,
      rerankTokens: cost.rerankTokens,
      estimatedCny: Math.round((embedCny + rerankCny) * 1e6) / 1e6
    },
    config: {
      bm25TopK: Number(process.env.KB_BM25_TOP_K) || 10,
      vectorTopK: Number(process.env.KB_VECTOR_TOP_K) || 10,
      rerankTopN: Number(process.env.KB_RERANK_TOP_N) || 5,
      finalTopK: Number(process.env.KB_FINAL_TOP_K) || 3,
      rrfK: Number(process.env.KB_RRF_K) || 60,
      rerankEnabled: process.env.KB_RERANK_ENABLED !== 'false'
    }
  }
}

// 离线评测脚本使用：每种模式跑前清零
export function resetMetrics(): void {
  latency.bm25 = emptyBucket()
  latency.vector = emptyBucket()
  latency.rerank = emptyBucket()
  latency.total = emptyBucket()
  retrieval.total = 0
  retrieval.hit = 0
  retrieval.degraded = 0
  retrieval.byStage = { bm25: 0, vector: 0, hybrid: 0, none: 0 }
  cost.embedCalls = 0
  cost.embedChars = 0
  cost.rerankCalls = 0
  cost.rerankDocs = 0
  cost.rerankTokens = 0
}
