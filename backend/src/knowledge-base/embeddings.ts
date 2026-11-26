// 副作用：条目向量优先读离线索引，缺失时调用 DashScope 兼容端点并进程内缓存
import type { KnowledgeEntry } from './types.js'
import { recordEmbeddingCall } from './metrics.js'
import { contentHash, embeddingText } from './vector-index.js'
import { readIndexedVector } from './vector-store.js'

const EMBEDDING_ENDPOINT = 'https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings'
const TIMEOUT_MS = 3000

interface EmbeddingResponse {
  data?: Array<{ embedding?: number[]; index?: number }>
  [key: string]: unknown
}

export function getEmbeddingModel(): string {
  return process.env.EMBEDDING_MODEL || 'text-embedding-v3'
}

const entryCache = new Map<string, number[]>()

// 批量向量化：3 秒超时，非 2xx / 超时 / 响应异常一律抛错，由 retrieval 层降级
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return []

  const apiKey = process.env.DASHSCOPE_API_KEY
  if (!apiKey) throw new Error('未配置 DASHSCOPE_API_KEY')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(EMBEDDING_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: getEmbeddingModel(),
        input: texts,
        encoding_format: 'float'
      }),
      signal: controller.signal
    })

    if (!res.ok) throw new Error(`embedding 请求失败: HTTP ${res.status}`)

    const json = (await res.json()) as EmbeddingResponse
    const data = json.data
    if (!Array.isArray(data) || data.length !== texts.length) {
      throw new Error('embedding 响应格式异常')
    }

    const vectors: number[][] = new Array(texts.length)
    data.forEach((item, i) => {
      const index = typeof item.index === 'number' ? item.index : i
      if (!Array.isArray(item.embedding) || index < 0 || index >= texts.length) {
        throw new Error('embedding 响应格式异常')
      }
      vectors[index] = item.embedding
    })

    if (vectors.some((v) => !Array.isArray(v))) throw new Error('embedding 响应格式异常')
    recordEmbeddingCall(texts.reduce((sum, text) => sum + text.length, 0))
    return vectors
  } finally {
    clearTimeout(timer)
  }
}

export async function getEntryEmbedding(entry: KnowledgeEntry): Promise<number[]> {
  const model = getEmbeddingModel()
  // key 带内容指纹：条目内容变更后不会误用旧向量
  const cacheKey = `${entry.id}::${model}::${contentHash(entry)}`
  const cached = entryCache.get(cacheKey)
  if (cached) return cached

  // 第一优先：构建期持久化的离线索引（无网络调用）
  const indexed = await readIndexedVector(entry, model)
  if (indexed) {
    entryCache.set(cacheKey, indexed)
    return indexed
  }

  // 兜底：索引缺失或已过期时实时向量化
  const [vector] = await embedTexts([embeddingText(entry)])
  if (!vector) throw new Error('embedding 返回空向量')

  entryCache.set(cacheKey, vector)
  return vector
}
