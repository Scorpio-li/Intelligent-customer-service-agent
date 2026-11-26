// 检索质量离线评测：BM25 / 向量 / RRF 融合 / 融合+rerank 四组对比
// 用法：npm run eval:retrieval（需要 DASHSCOPE_API_KEY；Qdrant 可用时走真实向量检索）
import 'dotenv/config'
import {
  classifyIntent,
  cosineSimilarity,
  embedTexts,
  getEntries,
  getEntryEmbedding,
  initRepository,
  metricsSnapshot,
  rankByBm25,
  resetMetrics,
  rerankDocuments,
  retrieve,
  rrfFuse,
  searchByVector,
  type Intent,
  type KnowledgeEntry
} from '../src/knowledge-base/index.js'

interface GoldenCase {
  query: string
  expected: string
}

// 每个意图 2-3 条，覆盖口语化与专业表述
const GOLDEN: GoldenCase[] = [
  { query: '多久发货', expected: 'KB-DELIVERY-01' },
  { query: '快递一直没更新怎么办', expected: 'KB-DELIVERY-01' },
  { query: '包邮吗运费多少', expected: 'KB-DELIVERY-01' },
  { query: '支付失败钱被扣了', expected: 'KB-PAYMENT-01' },
  { query: '花呗可以付款吗', expected: 'KB-PAYMENT-01' },
  { query: '怎么开增值税专票', expected: 'KB-INVOICE-01' },
  { query: '发票抬头写错了怎么办', expected: 'KB-INVOICE-01' },
  { query: '怎么升级金卡会员', expected: 'KB-MEMBERSHIP-01' },
  { query: '积分能兑换什么', expected: 'KB-MEMBERSHIP-01' },
  { query: '优惠券用不了', expected: 'KB-COUPON-01' },
  { query: '满减券能叠加吗', expected: 'KB-COUPON-01' },
  { query: '忘记密码登不上', expected: 'KB-ACCOUNT-01' },
  { query: '怎么换绑手机号', expected: 'KB-ACCOUNT-01' },
  { query: '收到商品破损了', expected: 'KB-AFTERSALE-01' },
  { query: '七天无理由怎么退', expected: 'KB-AFTERSALE-01' },
  { query: '转人工客服', expected: 'KB-HUMAN-01' },
  { query: '我要投诉', expected: 'KB-HUMAN-01' }
]

interface ModeResult {
  name: string
  recall1: number
  recall3: number
  mrr: number
  avgMs: number
  p95Ms: number
  embedCalls: number
  rerankCalls: number
  estimatedCny: number
}

function candidatesOf(entries: KnowledgeEntry[], intent: Intent): KnowledgeEntry[] {
  return intent === 'unknown' ? entries : entries.filter((entry) => entry.intent === intent)
}

function percentile(samples: number[], p: number): number {
  if (samples.length === 0) return 0
  const sorted = [...samples].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index]
}

function summarize(name: string, ranks: number[], latencies: number[]): ModeResult {
  const { cost } = metricsSnapshot()
  const hits1 = ranks.filter((rank) => rank > 0 && rank <= 1).length
  const hits3 = ranks.filter((rank) => rank > 0 && rank <= 3).length
  const mrr = ranks.reduce((sum, rank) => sum + (rank > 0 ? 1 / rank : 0), 0) / ranks.length

  return {
    name,
    recall1: hits1 / ranks.length,
    recall3: hits3 / ranks.length,
    mrr,
    avgMs: latencies.reduce((sum, ms) => sum + ms, 0) / latencies.length,
    p95Ms: percentile(latencies, 95),
    embedCalls: cost.embedCalls,
    rerankCalls: cost.rerankCalls,
    estimatedCny: cost.estimatedCny
  }
}

function rankOf(ids: string[], expected: string): number {
  const index = ids.indexOf(expected)
  return index < 0 ? 0 : index + 1
}

async function vectorRecall(query: string, intent: Intent, entries: KnowledgeEntry[]): Promise<string[]> {
  const [queryVector] = await embedTexts([query])
  if (!queryVector) return []

  const remote = await searchByVector(queryVector, intent, 10)
  if (remote) return remote.map((hit) => hit.entry.id)

  const candidates = candidatesOf(entries, intent)
  const vectors = await Promise.all(candidates.map((entry) => getEntryEmbedding(entry)))
  return candidates
    .map((entry, i) => ({ id: entry.id, score: cosineSimilarity(queryVector, vectors[i]) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map((hit) => hit.id)
}

async function runMode(
  name: string,
  entries: KnowledgeEntry[],
  run: (query: string, intent: Intent) => Promise<string[]>
): Promise<ModeResult> {
  resetMetrics()
  const ranks: number[] = []
  const latencies: number[] = []

  for (const item of GOLDEN) {
    const { intent } = classifyIntent(item.query)
    const started = performance.now()
    const ids = await run(item.query, intent)
    latencies.push(performance.now() - started)
    ranks.push(rankOf(ids, item.expected))
  }

  return summarize(name, ranks, latencies)
}

async function main(): Promise<void> {
  await initRepository()
  const entries = await getEntries()

  const results: ModeResult[] = []

  results.push(
    await runMode('bm25', entries, async (query, intent) =>
      rankByBm25(query, candidatesOf(entries, intent), 3).map((hit) => hit.entry.id)
    )
  )

  results.push(
    await runMode('vector', entries, async (query, intent) => vectorRecall(query, intent, entries))
  )

  results.push(
    await runMode('hybrid-rrf', entries, async (query, intent) => {
      const bm25 = rankByBm25(query, candidatesOf(entries, intent), 10).map((hit) => hit.entry.id)
      const vector = await vectorRecall(query, intent, entries)
      const byId = new Map(entries.map((entry) => [entry.id, entry]))
      return rrfFuse(
        [bm25, vector],
        (id) => id,
        60
      )
        .map((hit) => byId.get(hit.item))
        .filter((entry): entry is KnowledgeEntry => Boolean(entry))
        .slice(0, 3)
        .map((entry) => entry.id)
    })
  )

  results.push(
    await runMode('full(hybrid+rerank)', entries, async (query, intent) => {
      const result = await retrieve(query, intent)
      return result.entries.map((entry) => entry.id)
    })
  )

  console.log('\n模式                    recall@1  recall@3   MRR     avg(ms)  p95(ms)  embed  rerank  成本(元)')
  console.log('─'.repeat(96))
  for (const result of results) {
    console.log(
      [
        result.name.padEnd(22),
        result.recall1.toFixed(3).padStart(8),
        result.recall3.toFixed(3).padStart(9),
        result.mrr.toFixed(3).padStart(6),
        result.avgMs.toFixed(0).padStart(8),
        result.p95Ms.toFixed(0).padStart(8),
        String(result.embedCalls).padStart(6),
        String(result.rerankCalls).padStart(7),
        result.estimatedCny.toFixed(5).padStart(9)
      ].join(' ')
    )
  }

  // rerank 是否真正生效：失败会自动回退 RRF，通过一次直连调用确认
  const probe = await rerankDocuments('退货', ['七天无理由退换货', '发票开具'], 2)
  console.log(`\nrerank ${probe ? '可用' : '不可用（已回退 RRF 排序）'}：${probe ? 'gte-rerank 返回正常' : '检查 DASHSCOPE_API_KEY / RERANK_MODEL'}`)
}

main().catch((err) => {
  console.error('[eval] 评测失败:', err)
  process.exitCode = 1
})
