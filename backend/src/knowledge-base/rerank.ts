// 副作用：DashScope gte-rerank 精排；未启用或失败返回 null，由检索层保持 RRF 顺序
import { recordRerankCall } from './metrics.js'

const ENDPOINT = 'https://dashscope.aliyuncs.com/api/v1/services/rerank/text-rerank/text-rerank'
const TIMEOUT_MS = 3000

interface RerankResponse {
  output?: { results?: Array<{ index?: number; relevance_score?: number }> }
  usage?: { total_tokens?: number }
  [key: string]: unknown
}

export interface RerankHit {
  index: number
  score: number
}

export function rerankEnabled(): boolean {
  return process.env.KB_RERANK_ENABLED !== 'false'
}

function rerankModel(): string {
  return process.env.RERANK_MODEL || 'gte-rerank-v2'
}

export async function rerankDocuments(
  query: string,
  documents: string[],
  topN: number
): Promise<RerankHit[] | null> {
  if (!rerankEnabled() || documents.length === 0) return null

  const apiKey = process.env.DASHSCOPE_API_KEY
  if (!apiKey) return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: rerankModel(),
        input: { query, documents },
        parameters: { return_documents: false, top_n: topN }
      }),
      signal: controller.signal
    })

    if (!res.ok) throw new Error(`rerank 请求失败: HTTP ${res.status}`)

    const json = (await res.json()) as RerankResponse
    const results = json.output?.results
    if (!Array.isArray(results)) throw new Error('rerank 响应格式异常')

    const hits: RerankHit[] = []
    for (const item of results) {
      if (typeof item.index !== 'number' || typeof item.relevance_score !== 'number') continue
      if (item.index < 0 || item.index >= documents.length) continue
      hits.push({ index: item.index, score: item.relevance_score })
    }
    if (hits.length === 0) throw new Error('rerank 返回空结果')

    recordRerankCall(documents.length, json.usage?.total_tokens)
    return hits
  } catch (err) {
    console.warn('[kb] rerank 失败，保持 RRF 顺序:', err)
    return null
  } finally {
    clearTimeout(timer)
  }
}
