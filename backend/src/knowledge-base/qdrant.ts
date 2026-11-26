// 副作用：Qdrant 客户端、collection 生命周期与条目读写封装（无业务缓存逻辑）
import { QdrantClient } from '@qdrant/js-client-rest'
import type { Intent, KnowledgeEntry } from './types.js'
import { fromPayload, toPayload, toPointId, type StoredKnowledgeEntry } from './qdrant-payload.js'

const DEFAULT_URL = 'http://localhost:6333'
const DEFAULT_COLLECTION = 'knowledge_entries'
const DEFAULT_DIM = 1024
const SCROLL_LIMIT = 100
// 客户端 timeout 单位是毫秒（文档写秒，实现按毫秒直接传给 AbortController）
const REQUEST_TIMEOUT_MS = 5000

export interface VectorHit {
  entry: StoredKnowledgeEntry
  score: number
}

let client: QdrantClient | null = null

// KB_VECTOR_STORE=local 时完全跳过 Qdrant（本地种子 + 离线索引模式）
export function qdrantEnabled(): boolean {
  return process.env.KB_VECTOR_STORE !== 'local'
}

export function collectionName(): string {
  return process.env.QDRANT_COLLECTION || DEFAULT_COLLECTION
}

export function embeddingDim(): number {
  return Number(process.env.EMBEDDING_DIM) || DEFAULT_DIM
}

export function getClient(): QdrantClient {
  if (!client) {
    client = new QdrantClient({
      url: process.env.QDRANT_URL || DEFAULT_URL,
      apiKey: process.env.QDRANT_API_KEY || undefined,
      timeout: REQUEST_TIMEOUT_MS
    })
  }
  return client
}

function vectorSizeOf(vectors: unknown): number | null {
  if (!vectors || typeof vectors !== 'object') return null
  const size = (vectors as { size?: unknown }).size
  return typeof size === 'number' ? size : null
}

// 建 collection + payload 索引；已存在时校验维度，避免不同模型的向量混写
export async function ensureCollection(): Promise<void> {
  const c = getClient()
  const name = collectionName()
  const { exists } = await c.collectionExists(name)

  if (!exists) {
    await c.createCollection(name, { vectors: { size: embeddingDim(), distance: 'Cosine' } })
    await c.createPayloadIndex(name, { field_name: 'intent', field_schema: 'keyword', wait: true })
    await c.createPayloadIndex(name, { field_name: 'model_version', field_schema: 'keyword', wait: true })
    return
  }

  const info = await c.getCollection(name)
  const size = vectorSizeOf(info.config?.params?.vectors)
  if (size !== null && size !== embeddingDim()) {
    throw new Error(
      `collection "${name}" 向量维度 ${size} 与 EMBEDDING_DIM=${embeddingDim()} 不一致；` +
        '请执行 npm run kb:sync -- --recreate 重建'
    )
  }
}

// 换模型 / 换维度时使用：删除后重建（条目内容仍由种子或管理接口重新写入）
export async function recreateCollection(): Promise<void> {
  const c = getClient()
  const name = collectionName()
  if ((await c.collectionExists(name)).exists) {
    await c.deleteCollection(name)
  }
  await ensureCollection()
}

export async function countPoints(): Promise<number> {
  const result = await getClient().count(collectionName(), { exact: true })
  return result.count
}

export async function scrollEntries(): Promise<StoredKnowledgeEntry[]> {
  const c = getClient()
  const name = collectionName()
  const entries: StoredKnowledgeEntry[] = []
  let offset: string | number | null | undefined

  do {
    const page = await c.scroll(name, { limit: SCROLL_LIMIT, offset, with_payload: true, with_vector: false })
    for (const point of page.points) {
      const entry = fromPayload(point.payload)
      if (entry) entries.push(entry)
    }
    offset = page.next_page_offset as string | number | null | undefined
  } while (offset)

  return entries
}

export async function upsertEntries(
  items: Array<{ entry: KnowledgeEntry; vector: number[] }>,
  model: string
): Promise<void> {
  if (items.length === 0) return

  await getClient().upsert(collectionName(), {
    wait: true,
    points: items.map(({ entry, vector }) => ({
      id: toPointId(entry.id),
      vector,
      payload: { ...toPayload(entry, model) } as Record<string, unknown>
    }))
  })
}

export async function deleteEntryPoint(entryId: string): Promise<void> {
  await getClient().delete(collectionName(), { wait: true, points: [toPointId(entryId)] })
}

// 向量检索：payload 过滤 intent，并用 model_version 隔离不同模型产生的向量
export async function searchEntries(
  vector: number[],
  filter: { intent: Intent; modelVersion: string },
  limit = 5
): Promise<VectorHit[]> {
  const must = [{ key: 'model_version', match: { value: filter.modelVersion } }]
  if (filter.intent !== 'unknown') {
    must.push({ key: 'intent', match: { value: filter.intent } })
  }

  const result = await getClient().query(collectionName(), {
    query: vector,
    filter: { must },
    limit,
    with_payload: true
  })

  const hits: VectorHit[] = []
  for (const point of result.points) {
    const entry = fromPayload(point.payload)
    if (entry) hits.push({ entry, score: point.score })
  }
  return hits
}
